import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensureRoleWithPermissions, grantRoleToUserByEmail } from "../../../support/api/auth/rbac";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-SEC-002 - Sesiones vigentes de una empresa suspendida (cierre del incremento 1).
 *
 * Un token emitido ANTES de suspender la empresa debe quedar bloqueado en auth
 * (inmediato: se consulta el estado en cada petición) y en facturación (como
 * máximo TENANT_STATUS_CACHE_SECONDS, 5 s por defecto). Al reactivarla, el
 * mismo token vuelve a funcionar mientras no haya vencido (política de sesión
 * existente: JWT_ACCESS_TOKEN_TTL_MINUTES).
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const PASSWORD = "Suspendida!Kali2026";
const CACHE_MS = 6000; // TENANT_STATUS_CACHE_SECONDS (5 s) + margen

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
const authSession = (token: string) =>
  cy.request({ url: `${AUTH()}/api/v1/auth/session`, headers: authed(token), failOnStatusCode: false });
const authRoles = (token: string) =>
  cy.request({ url: `${AUTH()}/api/v1/roles`, headers: authed(token), failOnStatusCode: false });
const invoices = (token: string) =>
  cy.request({ url: `${INVOICE()}/api/v1/invoices?page=1&page_size=1`, headers: authed(token), failOnStatusCode: false });
const tenantAction = (ptoken: string, tenantId: string, action: "suspend" | "activate") =>
  cy
    .request({
      method: "POST",
      url: `${AUTH()}/api/v1/tenants/${tenantId}/${action}`,
      headers: { ...authed(ptoken), "Idempotency-Key": idempotencyKey() },
    })
    .its("status")
    .should("eq", 200);

describe("CP-SEC-002 - Suspender una empresa bloquea sus tokens vigentes", () => {
  let ptoken = "";
  let tenantId = "";
  let memberToken = "";
  const email = uniqueEmail("cp-sec-002");

  before(() => {
    loginAsAdmin().then((platform) => {
      ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-sec-002") }).then((t) => {
        expect(t.status).to.eq(201);
        tenantId = t.body.Id;
        createUser(AUTH(), ptoken, idempotencyKey(), {
          tenant_id: tenantId,
          identification_number: uniqueIdentificationNumber(),
          username: uniqueName("cp-sec-002-user"),
          email,
          password: PASSWORD,
        }).its("status").should("eq", 201);
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "lector", [
          ["roles", "read"],
          ["invoices", "read"],
        ]).then((role) => grantRoleToUserByEmail(AUTH(), ptoken, tenantId, email, role.Id));
        // Token emitido con la empresa activa.
        login(AUTH(), { email, password: PASSWORD }).then((s) => {
          expect(s.status).to.eq(200);
          memberToken = s.body.access_token;
        });
      });
    });
  });

  after(() => {
    // Deja la empresa de prueba activa (no se borra).
    if (ptoken && tenantId) tenantAction(ptoken, tenantId, "activate");
  });

  it("antes de suspender: el token funciona en auth y en facturación", () => {
    authSession(memberToken).its("status").should("eq", 200);
    authRoles(memberToken).its("status").should("eq", 200);
    invoices(memberToken).its("status").should("eq", 200);
  });

  it("tras suspender: el mismo token recibe 403 tenant is suspended en auth y en facturación", () => {
    tenantAction(ptoken, tenantId, "suspend");
    authSession(memberToken).then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body).to.deep.eq({ error: "tenant is suspended" });
    });
    authRoles(memberToken).its("status").should("eq", 403);
    cy.wait(CACHE_MS);
    invoices(memberToken).then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body).to.deep.eq({ error: "tenant is suspended" });
    });
    // Y no puede obtener un token nuevo.
    login(AUTH(), { email, password: PASSWORD }).its("status").should("eq", 403);
  });

  it("tras reactivar: el mismo token vigente vuelve a funcionar", () => {
    tenantAction(ptoken, tenantId, "activate");
    authSession(memberToken).its("status").should("eq", 200);
    cy.wait(CACHE_MS);
    invoices(memberToken).its("status").should("eq", 200);
  });
});
