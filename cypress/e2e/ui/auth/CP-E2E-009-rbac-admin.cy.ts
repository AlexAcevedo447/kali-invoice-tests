import { createTenant, createUser } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensureRoleWithPermissions, grantRoleToUserByEmail } from "../../../support/api/auth/rbac";
import { loginToUIAs } from "../../../support/ui/session";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-E2E-009 - Roles y permisos desde la interfaz (incremento 2).
 * Se trabaja en una empresa creada por la prueba (repetible, sin tocar la plataforma).
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const PASSWORD = "UiRbac!Kali2026";
const toast = (text: string) => cy.contains(".p-toast-message", text, { timeout: 8000 });

/** Selecciona en un <select> la opción cuyo texto contiene `text`. */
const selectByText = (cy_: string, text: string) =>
  cy
    .get(`[data-cy="${cy_}"] option`)
    .contains(text)
    .then((option) => cy.get(`[data-cy="${cy_}"]`).select(String(option.val())));

/**
 * Intercepta una petición y mide en el navegador cuánto tarda su respuesta (ms), para
 * distinguir una demora real del servicio de un problema de sincronización de la prueba.
 */
const timedIntercept = (method: string, url: string, alias: string) => {
  const timing: { ms?: number; status?: number } = {};
  cy.intercept({ method, url }, (req) => {
    const start = Date.now();
    req.continue((res) => {
      timing.ms = Date.now() - start;
      timing.status = res.statusCode;
    });
  }).as(alias);
  return timing;
};

/** Deja las duraciones en el registro de Cypress y en results/timings/CP-E2E-009.jsonl. */
const recordTimings = (timings: Record<string, { ms?: number; status?: number }>) =>
  cy.then(() => {
    Object.entries(timings).forEach(([name, t]) => cy.log(`${name}: HTTP ${t.status} en ${t.ms} ms`));
    const line = JSON.stringify({ at: new Date().toISOString(), test: "CP-E2E-009 permisos del rol", ...timings });
    cy.writeFile("results/timings/CP-E2E-009.jsonl", `${line}\n`, { flag: "a+" });
  });

describe("CP-E2E-009 - Roles y permisos (UI)", () => {
  const admin = uniqueEmail("cp-e2e-009-admin");
  const viewer = uniqueEmail("cp-e2e-009-lector");
  const outsider = uniqueEmail("cp-e2e-009-sin-roles");
  const employee = uniqueEmail("cp-e2e-009-empleado");

  before(() => {
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-e2e-009") }).then((t) => {
        const tenantId = t.body.Id;
        [admin, viewer, outsider, employee].forEach((email) =>
          createUser(AUTH(), ptoken, idempotencyKey(), {
            tenant_id: tenantId,
            identification_number: uniqueIdentificationNumber(),
            username: email.split("@")[0].slice(0, 40),
            email,
            password: PASSWORD,
          }).its("status").should("eq", 201)
        );
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "administrador", [["*", "*"]]).then((r) =>
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, admin, r.Id)
        );
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "consulta", [
          ["roles", "read"],
          ["permissions", "read"],
        ]).then((r) => grantRoleToUserByEmail(AUTH(), ptoken, tenantId, viewer, r.Id));
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "solo-usuarios", [["users", "read"]]).then((r) =>
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, outsider, r.Id)
        );
      });
    });
  });

  it("administrador: crea, valida y elimina permisos", () => {
    loginToUIAs(admin, PASSWORD);
    cy.visit("/admin/permissions");
    cy.get('[data-cy="nav-permissions"]').should("be.visible");
    cy.get('[data-cy="permission-create-resource"]').select("customers");
    cy.get('[data-cy="permission-create-action"]').select("read");
    cy.get('[data-cy="permission-create-submit"]').click();
    toast("Permiso creado");
    cy.contains('[data-cy="permissions-table"] tr', "customers").should("contain.text", "read");

    // Duplicado → 409 en español.
    cy.get('[data-cy="permission-create-resource"]').select("customers");
    cy.get('[data-cy="permission-create-action"]').select("read");
    cy.get('[data-cy="permission-create-submit"]').click();
    toast("Ya existe un permiso con ese recurso y acción");

    // Con recurso "*" solo se ofrecen *, read y manage.
    cy.get('[data-cy="permission-create-resource"]').select("*");
    cy.get('[data-cy="permission-create-action"] option').then((opts) => {
      const values = [...opts].map((o) => (o as HTMLOptionElement).value).filter(Boolean);
      expect(values.sort()).to.deep.eq(["*", "manage", "read"]);
    });

    cy.get('[data-cy="permissions-search"]').type("customers");
    cy.contains('[data-cy="permissions-table"] tr', "customers").find('[data-cy="permission-delete"]').click();
    cy.get('[data-cy="permission-delete-confirm"]').click();
    toast("Permiso eliminado");
  });

  it("administrador: roles, permisos del rol y asignación a usuario; 409 al borrar un rol asignado", () => {
    loginToUIAs(admin, PASSWORD);
    cy.visit("/admin/roles");
    const name = `Cajero ${Date.now()}`;
    cy.get('[data-cy="role-create-name"]').type(`  ${name}  `);
    cy.get('[data-cy="role-create-description"]').type("Atiende pagos");
    cy.get('[data-cy="role-create-submit"]').click();
    toast("Rol creado");

    // Nombre repetido sin distinguir mayúsculas.
    cy.get('[data-cy="role-create-name"]').type(name.toUpperCase());
    cy.get('[data-cy="role-create-submit"]').click();
    toast("Ya existe un rol con ese nombre");

    // Permisos del rol: agregar y quitar (users/read existe en la empresa).
    // Sincronización por red, no por tiempo: cada acción espera la respuesta exacta de su
    // petición y la recarga de permisos del rol que la interfaz hace después. Los intercepts
    // se registran antes de abrir el diálogo para no confundir la carga inicial con la recarga.
    const assignTiming = timedIntercept("POST", "**/api/v1/rbac/roles/permissions/assign", "assignRolePermission");
    const removeTiming = timedIntercept("POST", "**/api/v1/rbac/roles/permissions/remove", "removeRolePermission");
    cy.intercept("GET", "**/api/v1/rbac/roles/permissions?*").as("rolePermissions");
    cy.get('[data-cy="roles-search"]').type(name);
    cy.contains('[data-cy="roles-table"] tr', name).find('[data-cy="role-permissions"]').click();
    cy.wait("@rolePermissions");
    cy.get('[data-cy="role-permissions-dialog"]').within(() => {
      selectByText("role-permission-add-select", "users/read");
      cy.get('[data-cy="role-permission-add-submit"]').click();
      cy.wait("@assignRolePermission").its("response.statusCode").should("be.oneOf", [200, 201, 204]);
      cy.wait("@rolePermissions");
      cy.contains('[data-cy="role-permission-item"]', "users/read").find('[data-cy="role-permission-remove"]').click();
      cy.wait("@removeRolePermission").then(({ request, response }) => {
        expect(response?.statusCode, "estado de quitar permiso").to.be.oneOf([200, 204]);
        expect(request.body, "petición de quitar permiso").to.have.property("permission_id");
      });
      cy.wait("@rolePermissions").its("response.statusCode").should("eq", 200);
      cy.get('[data-cy="role-permission-item"]').should("not.exist");
    });
    toast("Permiso quitado");
    recordTimings({ assign: assignTiming, remove: removeTiming });
    cy.get("body").type("{esc}");

    // Asignar el rol a un usuario y luego intentar borrarlo.
    selectByText("user-roles-user-select", employee);
    selectByText("user-role-add-select", name);
    cy.get('[data-cy="user-role-add-submit"]').click();
    toast("Rol asignado");
    cy.contains('[data-cy="user-role-item"]', name).should("be.visible");

    cy.contains('[data-cy="roles-table"] tr', name).find('[data-cy="role-delete"]').click();
    cy.get('[data-cy="role-delete-confirm"]').click();
    toast("El rol está asignado a usuarios");
    // El diálogo de confirmación queda abierto tras el error: se cierra.
    cy.get('[data-cy="role-delete-dialog"]').contains("button", "Volver").click();

    // Quitarlo y entonces sí se puede borrar.
    cy.contains('[data-cy="user-role-item"]', name).find('[data-cy="user-role-remove"]').click();
    toast("Rol quitado");
    cy.contains('[data-cy="roles-table"] tr', name).find('[data-cy="role-delete"]').click();
    cy.get('[data-cy="role-delete-confirm"]').click();
    toast("Rol eliminado");
  });

  it("solo lectura: ve roles y permisos sin acciones de gestión", () => {
    loginToUIAs(viewer, PASSWORD);
    cy.visit("/admin/roles");
    cy.get('[data-cy="roles-read-only"]').should("be.visible");
    cy.get('[data-cy="role-create-name"]').should("not.exist");
    cy.get('[data-cy="role-delete"]').should("not.exist");
    cy.get('[data-cy="user-roles-section"]').should("not.exist");
    cy.visit("/admin/permissions");
    cy.get('[data-cy="permissions-read-only"]').should("be.visible");
    cy.get('[data-cy="permission-create-resource"]').should("not.exist");
  });

  it("sin roles/read ni permissions/read: acceso denegado sin pedir datos", () => {
    loginToUIAs(outsider, PASSWORD);
    cy.intercept("GET", "**/api/v1/roles*").as("roles");
    cy.intercept("GET", "**/api/v1/permissions*").as("perms");
    cy.visit("/admin/roles");
    cy.get('[data-cy="roles-access-denied"]').should("be.visible");
    cy.get('[data-cy="nav-roles"]').should("not.exist");
    cy.visit("/admin/permissions");
    cy.get('[data-cy="permissions-access-denied"]').should("be.visible");
    cy.get("@roles.all").should("have.length", 0);
    cy.get("@perms.all").should("have.length", 0);
  });
});
