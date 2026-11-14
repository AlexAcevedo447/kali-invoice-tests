import { createTenant, createUser, login, type TenantResponse } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-INT-010 - Administración de empresas (RF-05, incremento 1).
 * Criterios: docs/requisitos/INCREMENTO_01_EMPRESAS.md (invoice-kali-front), CA-05.1 a CA-05.8.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const PASSWORD = "Empresas!Kali2026";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

const code = (label: string) => `cp10-${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e5).toString(36)}`;

const call = (token: string, method: string, path: string, body?: Cypress.RequestBody) =>
  cy.request({
    method,
    url: `${AUTH()}/api/v1/tenants${path}`,
    body,
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey() },
    failOnStatusCode: false,
  });

describe("CP-INT-010 - Administración de empresas (solo plataforma)", () => {
  let platformToken = "";
  let tenant: TenantResponse;
  let memberEmail = "";

  before(() => {
    loginAsAdmin().then((session) => {
      platformToken = session.access_token;
      expect(session.is_platform_tenant, "el admin de plataforma se identifica en el login").to.eq(true);
      createTenant(AUTH(), platformToken, { name: uniqueName("cp-int-010"), code: code("a") }).then((t) => {
        expect(t.status).to.eq(201);
        tenant = t.body;
        memberEmail = uniqueEmail("cp-int-010-miembro");
        createUser(AUTH(), platformToken, idempotencyKey(), {
          tenant_id: tenant.Id,
          identification_number: uniqueIdentificationNumber(),
          username: uniqueName("cp-int-010-user"),
          email: memberEmail,
          password: PASSWORD,
        })
          .its("status")
          .should("eq", 201);
      });
    });
  });

  it("CA-05.1/05.4: lista con nombre, código y estado; consulta por id; 404 si no existe", () => {
    call(platformToken, "GET", "/").then((r) => {
      expect(r.status).to.eq(200);
      const found = (r.body as TenantResponse[]).find((t) => t.Id === tenant.Id);
      expect(found).to.deep.include({ Name: tenant.Name, Code: tenant.Code, Status: "ACTIVE" });
    });
    call(platformToken, "GET", `/${tenant.Id}`).its("body.Code").should("eq", tenant.Code);
    call(platformToken, "GET", `/${UNKNOWN_ID}`).its("status").should("eq", 404);
  });

  it("CA-05.2: crea activa; sin código lo deriva del nombre", () => {
    const name = `Empresa Derivada ${Date.now()}`;
    call(platformToken, "POST", "/", { name }).then((r) => {
      expect(r.status).to.eq(201);
      expect(r.body.Status).to.eq("ACTIVE");
      expect(r.body.Code).to.match(/^empresa-derivada-\d+/);
    });
  });

  it("CA-05.3: valida nombre, formato de código y código duplicado (crear y editar)", () => {
    call(platformToken, "POST", "/", { name: "   " }).then((r) => {
      expect(r.status).to.eq(400);
      expect(r.body.error).to.eq("tenant name is required");
    });
    call(platformToken, "POST", "/", { name: "Formato", code: "No Válido" }).then((r) => {
      expect(r.status).to.eq(400);
      expect(r.body.error).to.eq("tenant code must have 3-40 lowercase letters, digits or hyphens");
    });
    call(platformToken, "POST", "/", { name: "Duplicada", code: tenant.Code }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("tenant code already exists");
    });
    call(platformToken, "POST", "/", { name: uniqueName("cp-int-010-b"), code: code("b") }).then((other) => {
      expect(other.status).to.eq(201);
      call(platformToken, "PUT", `/${other.body.Id}`, { name: other.body.Name, code: tenant.Code, status: "ACTIVE" })
        .its("status")
        .should("eq", 409);
    });
  });

  it("CA-05.5: edita nombre y código sin cambiar el estado; valida estado; 404 si no existe", () => {
    const newName = uniqueName("cp-int-010-editada");
    const newCode = code("e");
    call(platformToken, "PUT", `/${tenant.Id}`, { name: newName, code: newCode, status: tenant.Status }).its("status").should("eq", 200);
    call(platformToken, "GET", `/${tenant.Id}`).then((r) => {
      expect(r.body).to.deep.include({ Name: newName, Code: newCode, Status: "ACTIVE" });
      tenant = r.body;
    });
    call(platformToken, "PUT", `/${tenant.Id}`, { name: "X", status: "DELETED" }).then((r) => {
      expect(r.status).to.eq(400);
      expect(r.body.error).to.eq("tenant status must be ACTIVE or SUSPENDED");
    });
    call(platformToken, "PUT", `/${UNKNOWN_ID}`, { name: "No existe", status: "ACTIVE" }).its("status").should("eq", 404);
  });

  it("CA-05.6: suspender bloquea el login de sus usuarios y activar lo restablece; 404 si no existe", () => {
    login(AUTH(), { email: memberEmail, password: PASSWORD }).its("status").should("eq", 200);

    call(platformToken, "POST", `/${tenant.Id}/suspend`).its("status").should("eq", 200);
    call(platformToken, "GET", `/${tenant.Id}`).its("body.Status").should("eq", "SUSPENDED");
    login(AUTH(), { email: memberEmail, password: PASSWORD }).then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body).to.deep.eq({ error: "tenant is suspended" });
    });

    call(platformToken, "POST", `/${tenant.Id}/activate`).its("status").should("eq", 200);
    login(AUTH(), { email: memberEmail, password: PASSWORD }).its("status").should("eq", 200);

    call(platformToken, "POST", `/${UNKNOWN_ID}/suspend`).its("status").should("eq", 404);
    call(platformToken, "POST", `/${UNKNOWN_ID}/activate`).its("status").should("eq", 404);
  });

  it("CA-05.7/05.8: un usuario de otra empresa recibe 403 en todas las operaciones", () => {
    login(AUTH(), { email: memberEmail, password: PASSWORD }).then((session) => {
      expect(session.status).to.eq(200);
      expect(session.body.is_platform_tenant).to.eq(false);
      const token = session.body.access_token;
      // GET de un id inexistente también es 403: no se revela si una empresa existe.
      const attempts: Array<[string, string, Cypress.RequestBody?]> = [
        ["GET", "/"],
        ["GET", `/${tenant.Id}`],
        ["GET", `/${UNKNOWN_ID}`],
        ["POST", "/", { name: "Intrusa" }],
        ["PUT", `/${tenant.Id}`, { name: "Intrusa", status: "ACTIVE" }],
        ["POST", `/${tenant.Id}/suspend`],
        ["POST", `/${tenant.Id}/activate`],
      ];
      attempts.forEach(([method, path, body]) =>
        call(token, method, path, body).then((r) => {
          expect(r.status, `${method} ${path}`).to.eq(403);
          expect(r.body.error).to.eq("platform administrator required");
        })
      );
    });
    // La empresa no cambió por los intentos anteriores.
    call(platformToken, "GET", `/${tenant.Id}`).then((r) => {
      expect(r.body).to.deep.include({ Name: tenant.Name, Status: "ACTIVE" });
    });
  });
});

describe("CP-INT-010 - Reglas de seguridad de empresas (cierre del incremento 1)", () => {
  const plainEmail = uniqueEmail("cp-int-010-plataforma-sin-permiso");
  let platformToken = "";
  let platformTenantId = "";
  let platformTenantName = "";
  let otherTenantId = "";

  before(() => {
    loginAsAdmin().then((session) => {
      platformToken = session.access_token;
      platformTenantId = session.tenant_id;
      platformTenantName = session.tenant_name;
      // Usuario de la empresa de plataforma SIN roles ni permisos.
      createUser(AUTH(), platformToken, idempotencyKey(), {
        tenant_id: platformTenantId,
        identification_number: uniqueIdentificationNumber(),
        username: uniqueName("cp-int-010-plain"),
        email: plainEmail,
        password: PASSWORD,
      })
        .its("status")
        .should("eq", 201);
      createTenant(AUTH(), platformToken, { name: uniqueName("cp-int-010-destino") }).then((t) => {
        otherTenantId = t.body.Id;
      });
    });
  });

  it("un usuario de la plataforma sin tenants/manage no administra empresas (403)", () => {
    login(AUTH(), { email: plainEmail, password: PASSWORD }).then((session) => {
      expect(session.status).to.eq(200);
      expect(session.body.is_platform_tenant, "es de la plataforma").to.eq(true);
      const token = session.body.access_token;
      const attempts: Array<[string, string, Cypress.RequestBody?]> = [
        ["GET", "/"],
        ["POST", "/", { name: "No autorizada" }],
        ["PUT", `/${otherTenantId}`, { name: "No autorizada", status: "ACTIVE" }],
        ["POST", `/${otherTenantId}/suspend`],
      ];
      attempts.forEach(([method, path, body]) =>
        call(token, method, path, body).then((r) => {
          expect(r.status, `${method} ${path}`).to.eq(403);
          expect(r.body.error).to.eq("platform administrator required");
        })
      );
      // Tampoco puede crear usuarios en otra empresa apuntando su tenant_id.
      createUser(AUTH(), token, idempotencyKey(), {
        tenant_id: otherTenantId,
        identification_number: uniqueIdentificationNumber(),
        username: uniqueName("cp-int-010-intrusa"),
        email: uniqueEmail("cp-int-010-intrusa"),
        password: PASSWORD,
      }).then((r) => {
        expect(r.status).to.eq(403);
        expect(r.body).to.deep.eq({ error: "tenant mismatch" });
      });
    });
  });

  it("la empresa de plataforma no se puede suspender (409), ni por /suspend ni por PUT", () => {
    call(platformToken, "POST", `/${platformTenantId}/suspend`).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("platform tenant cannot be suspended");
    });
    call(platformToken, "GET", `/${platformTenantId}`).then((current) => {
      call(platformToken, "PUT", `/${platformTenantId}`, {
        name: current.body.Name,
        code: current.body.Code,
        status: "SUSPENDED",
      }).its("status").should("eq", 409);
    });
    call(platformToken, "GET", `/${platformTenantId}`).then((r) => {
      expect(r.body).to.deep.include({ Name: platformTenantName, Status: "ACTIVE" });
    });
  });
});
