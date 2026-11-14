import { createRole, createTenant, createUser, getUserByEmail } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { loginToUI, loginToUIAs } from "../../../support/ui/session";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-E2E-008 - Administración de empresas desde la interfaz (RF-05, incremento 1).
 * Criterios: docs/requisitos/INCREMENTO_01_EMPRESAS.md (invoice-kali-front).
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const PASSWORD = "AdminOtra!Kali2026";
const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

const row = (text: string) => cy.contains('[data-cy="tenants-table"] tr', text);
const toast = (text: string) => cy.contains(".p-toast-message", text, { timeout: 8000 });

describe("CP-E2E-008 - Empresas: administrador de plataforma", () => {
  beforeEach(() => {
    loginToUI();
    cy.intercept("POST", "**/api/v1/tenants*").as("createTenant");
    cy.visit("/admin/tenants");
    cy.get('[data-cy="tenants-page"]').should("be.visible");
  });

  it("CA-05.7: el menú muestra Empresas a la plataforma", () => {
    cy.get('[data-cy="nav-tenants"]').should("have.text", "Empresas");
  });

  it("CA-05.1/05.2/05.5/05.6: crea, edita, suspende y activa una empresa", () => {
    const id = stamp();
    const name = `CP-E2E-008 Empresa ${id}`;
    const code = `cp-e2e-008-${id}`;

    cy.get('[data-cy="tenant-create-name"]').type(name);
    cy.get('[data-cy="tenant-create-code"]').type(code.toUpperCase()); // se normaliza a minúsculas
    cy.get('[data-cy="tenant-create-submit"]').click();
    toast("Empresa creada");

    cy.get('[data-cy="tenants-search"]').type(id);
    row(name).within(() => {
      cy.get('[data-cy="tenant-code"]').should("have.text", code);
      cy.get('[data-cy="tenant-status"]').should("have.text", "Activa");
      cy.get('[data-cy="tenant-edit"]').click();
    });

    // Editar nombre y código no cambia el estado.
    cy.get('[data-cy="tenant-edit-name"]').clear().type(`${name} Editada`);
    cy.get('[data-cy="tenant-edit-code"]').clear().type(`${code}-v2`);
    cy.get('[data-cy="tenant-edit-submit"]').click();
    toast("Empresa actualizada");
    row(`${name} Editada`).within(() => {
      cy.get('[data-cy="tenant-code"]').should("have.text", `${code}-v2`);
      cy.get('[data-cy="tenant-status"]').should("have.text", "Activa");
      cy.get('[data-cy="tenant-activate"]').should("be.disabled");
      cy.get('[data-cy="tenant-suspend"]').click();
    });

    // Suspender pide confirmación.
    cy.get('[data-cy="tenant-status-dialog"]').should("contain.text", "no podrán iniciar sesión");
    cy.get('[data-cy="tenant-status-confirm"]').click();
    toast("Empresa suspendida");
    row(`${name} Editada`).within(() => {
      cy.get('[data-cy="tenant-status"]').should("have.text", "Suspendida");
      cy.get('[data-cy="tenant-suspend"]').should("be.disabled");
      cy.get('[data-cy="tenant-activate"]').click();
    });
    cy.get('[data-cy="tenant-status-confirm"]').click();
    toast("Empresa activada");
    row(`${name} Editada`).find('[data-cy="tenant-status"]').should("have.text", "Activa");
  });

  it("CA-05.9: la fila de la empresa de plataforma no se puede suspender", () => {
    loginAsAdmin().then((platform) => {
      cy.get('[data-cy="tenants-search"]').type(platform.tenant_code);
      cy.contains('[data-cy="tenants-table"] tr', platform.tenant_name)
        .find('[data-cy="tenant-suspend"]')
        .should("be.disabled")
        .and("have.attr", "title", "La empresa de la plataforma no se puede suspender");
    });
  });

  it("CA-05.11: advierte que cambiar el código afecta el próximo inicio de sesión", () => {
    const id = stamp();
    loginAsAdmin().then((platform) =>
      createTenant(AUTH(), platform.access_token, { name: `CP-E2E-008 Aviso ${id}`, code: `cp-e2e-008-aviso-${id}` })
    );
    cy.reload();
    cy.get('[data-cy="tenants-search"]').type(`aviso-${id}`);
    row(`CP-E2E-008 Aviso ${id}`).find('[data-cy="tenant-edit"]').click();
    cy.get('[data-cy="tenant-code-warning"]').should("not.exist");
    cy.get('[data-cy="tenant-edit-name"]').clear().type(`CP-E2E-008 Aviso ${id} b`);
    cy.get('[data-cy="tenant-code-warning"]').should("not.exist"); // cambiar solo el nombre no avisa
    cy.get('[data-cy="tenant-edit-code"]').clear().type(`cp-e2e-008-aviso-${id}-v2`);
    cy.get('[data-cy="tenant-code-warning"]')
      .should("contain.text", "puede afectar el próximo inicio de sesión")
      .and("contain.text", `cp-e2e-008-aviso-${id}`);
    cy.get('[data-cy="tenant-edit-code"]').clear().type(`CP-E2E-008-AVISO-${id}`); // mismo código normalizado
    cy.get('[data-cy="tenant-code-warning"]').should("not.exist");
  });

  it("CA-05.3: valida en la interfaz y muestra en español el código duplicado", () => {
    cy.get('[data-cy="tenant-create-submit"]').click();
    cy.contains("El nombre de la empresa es obligatorio.").should("be.visible");

    cy.get('[data-cy="tenant-create-name"]').type("Formato inválido");
    cy.get('[data-cy="tenant-create-code"]').type("no válido");
    cy.get('[data-cy="tenant-create-submit"]').click();
    cy.contains("Código inválido").should("be.visible");
    cy.get("@createTenant.all").should("have.length", 0); // no se envió nada

    // Código ya usado por una empresa creada aquí mismo (no se asume ningún código existente).
    const takenCode = `cp-e2e-008-dup-${stamp()}`;
    loginAsAdmin().then((platform) =>
      createTenant(AUTH(), platform.access_token, { name: uniqueName("cp-e2e-008-dup"), code: takenCode })
        .its("status")
        .should("eq", 201)
    );
    cy.get('[data-cy="tenant-create-name"]').clear().type(`Duplicada ${stamp()}`);
    cy.get('[data-cy="tenant-create-code"]').clear().type(takenCode);
    cy.get('[data-cy="tenant-create-submit"]').click();
    toast("Ya existe una empresa con ese código.");
    cy.get("@createTenant.all").should("have.length", 1); // solo el intento duplicado salió del navegador
  });
});

describe("CP-E2E-008 - Empresas: administrador de otra empresa (CA-05.7)", () => {
  const email = uniqueEmail("cp-e2e-008-admin-otra");
  let otherTenantId = "";

  before(() => {
    // Empresa B con un usuario que tiene el rol "admin" de su propia empresa.
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-e2e-008-otra") }).then((t) => {
        expect(t.status).to.eq(201);
        const tenantId = t.body.Id;
        otherTenantId = tenantId;
        createUser(AUTH(), ptoken, idempotencyKey(), {
          tenant_id: tenantId,
          identification_number: uniqueIdentificationNumber(),
          username: uniqueName("cp-e2e-008-admin"),
          email,
          password: PASSWORD,
        }).its("status").should("eq", 201);
        createRole(AUTH(), ptoken, idempotencyKey(), { tenant_id: tenantId, name: "admin", description: "Administrador de la empresa" })
          .its("status")
          .should("eq", 201);
        cy.request<Array<{ Id: string; Name: string }>>({
          url: `${AUTH()}/api/v1/roles`,
          qs: { tenant_id: tenantId },
          headers: { Authorization: `Bearer ${ptoken}` },
        }).then((roles) => {
          const role = roles.body.find((r) => r.Name === "admin");
          expect(role, "rol admin creado").to.exist;
          getUserByEmail(AUTH(), ptoken, tenantId, email).then((user) => {
            cy.request({
              method: "POST",
              url: `${AUTH()}/api/v1/rbac/users/roles/assign`,
              headers: { Authorization: `Bearer ${ptoken}`, "Idempotency-Key": idempotencyKey() },
              body: { tenant_id: tenantId, user_id: user.body.Id, role_id: role!.Id },
            });
          });
        });
      });
    });
  });

  it("no ve el menú Empresas y la ruta directa muestra acceso denegado sin datos", () => {
    loginToUIAs(email, PASSWORD);
    cy.visit("/admin/users");
    cy.get('[data-cy="nav-users"]').should("be.visible");
    cy.get('[data-cy="nav-tenants"]').should("not.exist");

    cy.intercept("GET", "**/api/v1/tenants*").as("listTenants");
    cy.visit("/admin/tenants");
    cy.get('[data-cy="tenants-access-denied"]').should("contain.text", "Acceso denegado");
    cy.get('[data-cy="tenants-table"]').should("not.exist");
    cy.get("@listTenants.all").should("have.length", 0);
  });

  it("CA-05.10: si suspenden su empresa, la sesión abierta se cierra con aviso", () => {
    loginToUIAs(email, PASSWORD);
    cy.visit("/admin/users");
    cy.get('[data-cy="nav-users"]').should("be.visible");
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      cy.request({
        method: "POST",
        url: `${AUTH()}/api/v1/tenants/${otherTenantId}/suspend`,
        headers: { Authorization: `Bearer ${ptoken}`, "Idempotency-Key": idempotencyKey() },
      });
      // La página vuelve a pedir datos con el token emitido antes de la suspensión.
      cy.reload();
      cy.location("pathname", { timeout: 10000 }).should("eq", "/login");
      cy.contains(".p-toast-message", "Empresa suspendida", { timeout: 8000 });
      // Se reactiva para no dejar la empresa de prueba suspendida.
      cy.request({
        method: "POST",
        url: `${AUTH()}/api/v1/tenants/${otherTenantId}/activate`,
        headers: { Authorization: `Bearer ${ptoken}`, "Idempotency-Key": idempotencyKey() },
      });
    });
  });
});

describe("CP-E2E-008 - Empresas: usuario de plataforma sin tenants/manage (CA-05.7)", () => {
  const email = uniqueEmail("cp-e2e-008-plataforma-soporte");

  before(() => {
    // Usuario de la empresa de plataforma con acceso de administración (users/read)
    // pero SIN el permiso tenants/manage.
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      const tenantId = platform.tenant_id;
      const headers = { Authorization: `Bearer ${ptoken}`, "Idempotency-Key": idempotencyKey() };
      const roleName = `soporte-${stamp()}`;
      createUser(AUTH(), ptoken, idempotencyKey(), {
        tenant_id: tenantId,
        identification_number: uniqueIdentificationNumber(),
        username: uniqueName("cp-e2e-008-soporte"),
        email,
        password: PASSWORD,
      }).its("status").should("eq", 201);
      createRole(AUTH(), ptoken, idempotencyKey(), { tenant_id: tenantId, name: roleName, description: "Soporte sin gestión de empresas" })
        .its("status")
        .should("eq", 201);
      cy.request({
        method: "POST",
        url: `${AUTH()}/api/v1/permissions/`,
        headers,
        body: { tenant_id: tenantId, resource: "users", action: "read" },
        failOnStatusCode: false,
      }).its("status").should("be.oneOf", [201, 409]);
      cy.request<Array<{ Id: string; Name: string }>>({ url: `${AUTH()}/api/v1/roles`, qs: { tenant_id: tenantId }, headers }).then((roles) => {
        const role = roles.body.find((r) => r.Name === roleName)!;
        cy.request<Array<{ Id: string; Resource: string; Action: string }>>({
          url: `${AUTH()}/api/v1/permissions`,
          qs: { tenant_id: tenantId },
          headers,
        }).then((perms) => {
          const permission = perms.body.find((p) => p.Resource === "users" && p.Action === "read")!;
          cy.request({
            method: "POST",
            url: `${AUTH()}/api/v1/rbac/roles/permissions/assign`,
            headers: { ...headers, "Idempotency-Key": idempotencyKey() },
            body: { tenant_id: tenantId, role_id: role.Id, permission_id: permission.Id },
          });
          getUserByEmail(AUTH(), ptoken, tenantId, email).then((user) =>
            cy.request({
              method: "POST",
              url: `${AUTH()}/api/v1/rbac/users/roles/assign`,
              headers: { ...headers, "Idempotency-Key": idempotencyKey() },
              body: { tenant_id: tenantId, user_id: user.body.Id, role_id: role.Id },
            })
          );
        });
      });
    });
  });

  it("no ve el menú Empresas y la ruta directa muestra acceso denegado sin datos", () => {
    loginToUIAs(email, PASSWORD);
    cy.visit("/admin/users");
    cy.get('[data-cy="nav-users"]').should("be.visible");
    cy.get('[data-cy="nav-tenants"]').should("not.exist");
    cy.intercept("GET", "**/api/v1/tenants*").as("listTenants");
    cy.visit("/admin/tenants");
    cy.get('[data-cy="tenants-access-denied"]').should("be.visible");
    cy.get("@listTenants.all").should("have.length", 0);
  });
});
