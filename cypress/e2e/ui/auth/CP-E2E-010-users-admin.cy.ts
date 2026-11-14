import { createTenant, createUser, createRole } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensureRoleWithPermissions, grantRoleToUserByEmail } from "../../../support/api/auth/rbac";
import { loginToUIAs } from "../../../support/ui/session";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-E2E-010 - Usuarios desde la interfaz y menú por permisos (incremento 3).
 * Empresa creada por la prueba (repetible).
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const PASSWORD = "UiUsers!Kali2026";
const toast = (text: string) => cy.contains(".p-toast-message", text, { timeout: 8000 });
const row = (text: string) => cy.contains('[data-cy="users-table"] tr', text);

describe("CP-E2E-010 - Usuarios (UI)", () => {
  const admin = uniqueEmail("cp-e2e-010-admin");
  const reader = uniqueEmail("cp-e2e-010-lector");
  const rolesOnly = uniqueEmail("cp-e2e-010-solo-roles");
  const roleNameOnly = uniqueEmail("cp-e2e-010-rol-sin-permisos");
  const withRole = uniqueEmail("cp-e2e-010-con-rol");

  before(() => {
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-e2e-010") }).then((t) => {
        const tenantId = t.body.Id;
        [admin, reader, rolesOnly, roleNameOnly, withRole].forEach((email) =>
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
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "lector-usuarios", [["users", "read"]]).then((r) => {
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, reader, r.Id);
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, withRole, r.Id);
        });
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "lector-roles", [["roles", "read"]]).then((r) =>
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, rolesOnly, r.Id)
        );
        // Rol llamado "admin" SIN permisos: el nombre ya no concede nada.
        createRole(AUTH(), ptoken, idempotencyKey(), { tenant_id: tenantId, name: "admin", description: "Solo nombre" }).then((r) =>
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, roleNameOnly, (r.body as { Id: string }).Id)
        );
      });
    });
  });

  it("administrador: crea, edita (sin cambiar contraseña) y elimina un usuario", () => {
    loginToUIAs(admin, PASSWORD);
    cy.visit("/admin/users");
    cy.get('[data-cy="nav-users"]').should("be.visible");
    const email = uniqueEmail("cp-e2e-010-nuevo");
    cy.get('[data-cy="user-identification"]').type(uniqueIdentificationNumber());
    cy.get('[data-cy="user-username"]').type("nuevo-ui");
    cy.get('[data-cy="user-email"]').type(email);
    cy.get('[data-cy="user-password"]').type(PASSWORD, { log: false });
    cy.get('[data-cy="user-submit"]').click();
    toast("Usuario creado");

    cy.get('[data-cy="users-search"]').type(email);
    row(email).find('[data-cy="user-edit"]').click();
    cy.get('[data-cy="user-edit-username"]').clear().type("nuevo-ui-editado");
    cy.get('[data-cy="user-edit-password"]').should("have.value", "");
    cy.get('[data-cy="user-edit-submit"]').click();
    toast("Usuario actualizado");
    row(email).find('[data-cy="user-row-username"]').should("have.text", "nuevo-ui-editado");

    row(email).find('[data-cy="user-delete"]').click();
    cy.get('[data-cy="user-delete-confirm"]').click();
    toast("Usuario eliminado");
    cy.contains('[data-cy="users-table"] tr', email).should("not.exist");
  });

  it("administrador: eliminar un usuario con roles muestra el motivo en español", () => {
    loginToUIAs(admin, PASSWORD);
    cy.visit("/admin/users");
    cy.get('[data-cy="users-search"]').type(withRole);
    row(withRole).find('[data-cy="user-delete"]').click();
    cy.get('[data-cy="user-delete-confirm"]').click();
    toast("El usuario tiene roles asignados");
    cy.get('[data-cy="user-delete-dialog"]').should("be.visible");
  });

  it("validaciones en español al crear y al editar", () => {
    loginToUIAs(admin, PASSWORD);
    cy.visit("/admin/users");
    cy.get('[data-cy="user-submit"]').click();
    cy.contains("El correo es obligatorio.").should("be.visible");
    cy.contains("La contraseña es obligatoria.").should("be.visible");
    cy.get('[data-cy="users-search"]').type(reader);
    row(reader).find('[data-cy="user-edit"]').click();
    cy.get('[data-cy="user-edit-email"]').clear().type("no-es-correo");
    cy.get('[data-cy="user-edit-submit"]').click();
    cy.contains("Ingresa un correo válido.").should("be.visible");
  });

  it("users/read: solo lectura, sin crear ni acciones; nunca muestra contraseñas", () => {
    loginToUIAs(reader, PASSWORD);
    cy.intercept("GET", "**/api/v1/users*").as("users");
    cy.visit("/admin/users");
    cy.get('[data-cy="users-read-only"]').should("be.visible");
    cy.get('[data-cy="user-create-form"]').should("not.exist");
    cy.get('[data-cy="user-edit"]').should("not.exist");
    cy.get('[data-cy="user-delete"]').should("not.exist");
    cy.wait("@users").its("response.body").then((body) => expect(JSON.stringify(body)).not.to.contain("Password"));
  });

  it("menú por permisos: sin users/read no hay Usuarios ni datos", () => {
    loginToUIAs(rolesOnly, PASSWORD);
    cy.intercept("GET", "**/api/v1/users*").as("users");
    cy.visit("/admin/roles");
    cy.get('[data-cy="nav-roles"]').should("be.visible");
    cy.get('[data-cy="nav-users"]').should("not.exist");
    cy.get('[data-cy="nav-invoices"]').should("not.exist");
    cy.visit("/admin/users");
    cy.get('[data-cy="users-access-denied"]').should("be.visible");
    cy.get("@users.all").should("have.length", 0);
  });

  it("menú por permisos: un rol llamado admin sin permisos inicia sesión pero sin módulos (CA-04.10/04.12)", () => {
    cy.visit("/login");
    cy.get("#email").type(roleNameOnly);
    cy.get("#password").type(PASSWORD, { log: false });
    cy.contains("button", "Sign In").click();
    cy.location("pathname").should("eq", "/sin-acceso");
    cy.get('[data-cy="no-access"]').should("contain.text", "Sin acceso a módulos");
    cy.get('[data-cy="app-nav"] a').should("have.length", 0);
    cy.contains(".p-toast-message", "Credenciales incorrectas").should("not.exist");
    // Sin bucles: rutas de módulos no la sacan de la sesión ni redirigen en círculo.
    cy.visit("/admin/users");
    cy.contains("Tu usuario no tiene permisos para esta sección.").should("be.visible");
    cy.visit("/");
    cy.location("pathname").should("eq", "/sin-acceso");
    cy.get('[data-cy="no-access-logout"]').click();
    cy.location("pathname").should("eq", "/login");
  });

  it("D3-04: el propio usuario no se puede eliminar desde el módulo", () => {
    loginToUIAs(admin, PASSWORD);
    cy.visit("/admin/users");
    cy.get('[data-cy="users-search"]').type(admin);
    row(admin)
      .find('[data-cy="user-delete"]')
      .should("be.disabled")
      .and("have.attr", "title", "No puedes eliminar tu propio usuario");
  });
});

describe("CP-E2E-010 - Cada permiso llega a su funcionalidad (sin permisos ajenos)", () => {
  const assigner = uniqueEmail("cp-e2e-010-asignador");
  const tenantsOnly = uniqueEmail("cp-e2e-010-solo-empresas");

  before(() => {
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-e2e-010b") }).then((t) => {
        const tenantId = t.body.Id;
        createUser(AUTH(), ptoken, idempotencyKey(), {
          tenant_id: tenantId,
          identification_number: uniqueIdentificationNumber(),
          username: "asignador",
          email: assigner,
          password: PASSWORD,
        }).its("status").should("eq", 201);
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "solo-asignaciones", [["rbac", "manage"]]).then((r) =>
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, assigner, r.Id)
        );
      });
      createUser(AUTH(), ptoken, idempotencyKey(), {
        tenant_id: platform.tenant_id,
        identification_number: uniqueIdentificationNumber(),
        username: "solo-empresas",
        email: tenantsOnly,
        password: PASSWORD,
      }).its("status").should("eq", 201);
      ensureRoleWithPermissions(AUTH(), ptoken, platform.tenant_id, uniqueName("ui-solo-empresas"), [["tenants", "manage"]]).then((r) =>
        grantRoleToUserByEmail(AUTH(), ptoken, platform.tenant_id, tenantsOnly, r.Id)
      );
    });
  });

  it("solo rbac/manage: entra directo a Roles con la gestión de asignaciones", () => {
    cy.visit("/login");
    cy.get("#email").type(assigner);
    cy.get("#password").type(PASSWORD, { log: false });
    cy.contains("button", "Sign In").click();
    cy.location("pathname").should("eq", "/admin/roles");
    cy.get('[data-cy="nav-roles"]').should("be.visible");
    cy.get('[data-cy="nav-users"]').should("not.exist");
    cy.get('[data-cy="roles-table"]').should("be.visible");
    cy.get('[data-cy="role-create-name"]').should("not.exist");
    cy.get('[data-cy="user-roles-section"]').should("be.visible");
    cy.get('[data-cy="user-roles-user-select"] option').should("have.length.greaterThan", 1);
  });

  it("solo tenants/manage en la plataforma: entra directo a Empresas", () => {
    cy.visit("/login");
    cy.get("#email").type(tenantsOnly);
    cy.get("#password").type(PASSWORD, { log: false });
    cy.contains("button", "Sign In").click();
    cy.location("pathname").should("eq", "/admin/tenants");
    cy.get('[data-cy="nav-tenants"]').should("be.visible");
    cy.get('[data-cy="tenants-table"]').should("be.visible");
  });
});
