import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensurePermission, ensureRoleWithPermissions, grantRoleToUserByEmail, assignPermissionToRole } from "../../../support/api/auth/rbac";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-INT-012 - Autorización por operación en facturación (incremento 2).
 * Contrato: invoice-kali-front/docs/requisitos/MATRIZ_PERMISOS.md (kali-invoice-service).
 * Los permisos llegan por /auth/session con caché por usuario de
 * TENANT_STATUS_CACHE_SECONDS (5 s): los cambios se ven tras esa espera.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const PASSWORD = "Factura!Rbac2026";
const CACHE_MS = 6000;

const inv = (token: string, method: string, path: string, body?: Cypress.RequestBody) =>
  cy.request({
    method,
    url: `${INVOICE()}/api/v1${path}`,
    body,
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey() },
    failOnStatusCode: false,
  });

describe("CP-INT-012 - Facturación exige permiso por operación", () => {
  let ptoken = "";
  let tenantId = "";
  let lectorRoleId = "";
  const tokens: Record<"writer" | "reader" | "none", string> = { writer: "", reader: "", none: "" };

  before(() => {
    loginAsAdmin().then((platform) => {
      ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-int-012") }).then((t) => {
        tenantId = t.body.Id;
        const roles: Record<string, Array<[string, string]>> = {
          writer: [
            ["invoices", "manage"],
            ["invoice-items", "manage"],
            ["customers", "manage"],
            ["products", "manage"],
          ],
          reader: [
            ["invoices", "read"],
            ["customers", "read"],
          ],
          none: [],
        };
        (["writer", "reader", "none"] as const).forEach((who) => {
          const email = uniqueEmail(`cp-int-012-${who}`);
          createUser(AUTH(), ptoken, idempotencyKey(), {
            tenant_id: tenantId,
            identification_number: uniqueIdentificationNumber(),
            username: uniqueName(`cp-int-012-${who}`),
            email,
            password: PASSWORD,
          }).its("status").should("eq", 201);
          if (roles[who].length > 0) {
            ensureRoleWithPermissions(AUTH(), ptoken, tenantId, `cp12-${who}`, roles[who]).then((role) => {
              if (who === "reader") lectorRoleId = role.Id;
              grantRoleToUserByEmail(AUTH(), ptoken, tenantId, email, role.Id);
            });
          }
          login(AUTH(), { email, password: PASSWORD }).then((s) => (tokens[who] = s.body.access_token));
        });
      });
    });
  });

  it("sin permisos: 403 insufficient permissions en toda operación de negocio; /metrics sigue pública", () => {
    ["/invoices", "/customers", "/products", "/invoice-items"].forEach((path) =>
      inv(tokens.none, "GET", path).then((r) => {
        expect(r.status, path).to.eq(403);
        expect(r.body).to.deep.eq({ error: "insufficient permissions" });
      })
    );
    cy.request(`${INVOICE()}/api/v1/metrics`).its("status").should("eq", 200);
  });

  it("manage permite crear, pagar y (por inclusión) consultar", () => {
    inv(tokens.writer, "POST", "/customers", { name: "Cliente CP12", document: `CP12-${Date.now()}` }).then((c) => {
      expect(c.status).to.eq(201);
      inv(tokens.writer, "POST", "/products", { code: `P12-${Date.now()}`, name: "Producto CP12", unit_price: 100 }).then((p) => {
        expect(p.status).to.eq(201);
        inv(tokens.writer, "POST", "/invoices", { customer_id: c.body.ID, items: [{ item_id: p.body.ID, quantity: 1, unit_price: 100 }] }).then((i) => {
          expect(i.status).to.eq(201);
          inv(tokens.writer, "PATCH", `/invoices/${i.body.ID}/pay`).its("status").should("eq", 200);
          // reader: puede consultar facturas y clientes, pero no modificar ni ver productos.
          inv(tokens.reader, "GET", `/invoices/${i.body.ID}`).its("status").should("eq", 200);
          inv(tokens.reader, "GET", "/customers").its("status").should("eq", 200);
          inv(tokens.reader, "PATCH", `/invoices/${i.body.ID}/cancel`).its("status").should("eq", 403);
        });
      });
    });
    inv(tokens.writer, "GET", "/invoices").its("status").should("eq", 200);
  });

  it("read no permite modificar", () => {
    inv(tokens.reader, "POST", "/customers", { name: "No", document: `NO-${Date.now()}` }).its("status").should("eq", 403);
    inv(tokens.reader, "POST", "/invoices", { customer_id: "x", items: [] }).its("status").should("eq", 403);
    inv(tokens.reader, "GET", "/products").then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body.error).to.eq("insufficient permissions");
    });
  });

  it("un permiso nuevo se aplica sin reemitir el token (tras la caché)", () => {
    ensurePermission(AUTH(), ptoken, tenantId, "products", "read").then((perm) =>
      assignPermissionToRole(AUTH(), ptoken, tenantId, lectorRoleId, perm.Id).its("status").should("eq", 200)
    );
    cy.wait(CACHE_MS);
    inv(tokens.reader, "GET", "/products").its("status").should("eq", 200);
  });
});
