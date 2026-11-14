import { createRole, createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { createInvoice, seedCatalog, type InvoiceResponse } from "../../../support/api/invoice/invoice-client";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-SEC-001 - Aislamiento multi-tenant.
 *
 * Se crean dos empresas (A y B) con su usuario, cliente, producto, factura,
 * línea y rol. Con el token de una empresa se intenta leer o modificar cada
 * recurso de la otra conociendo sus UUID. Todo debe responder como recurso
 * inexistente (404), referencia inválida (422) o prohibido (403), y los datos
 * de la otra empresa deben quedar intactos. Se prueba en ambos sentidos.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const PASSWORD = "Seguridad!Kali2026";

interface TenantFixture {
  label: string;
  tenantId: string;
  token: string;
  userId: string;
  roleId: string;
  customerId: string;
  productId: string;
  invoice: InvoiceResponse;
  lineId: string;
}

const fixtures: Record<"A" | "B", TenantFixture> = {} as Record<"A" | "B", TenantFixture>;

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

const call = (token: string, method: string, url: string, body?: Cypress.RequestBody) =>
  cy.request({
    method,
    url,
    body,
    headers: { ...authed(token), "Idempotency-Key": idempotencyKey() },
    failOnStatusCode: false,
  });

/** Crea una empresa completa con el administrador de plataforma. */
const provisionTenant = (label: "A" | "B") => {
  loginAsAdmin().then((platform) => {
    const ptoken = platform.access_token;
    const name = uniqueName(`cp-sec-001-empresa-${label}`);
    createTenant(AUTH(), ptoken, { name }).then((t) => {
      expect(t.status, `tenant ${label} creado`).to.eq(201);
      const tenantId = t.body.Id;
      const email = uniqueEmail(`cp-sec-001-${label}`);

      // Usuario y rol propios de la empresa (el administrador de plataforma
      // puede indicar el tenant destino; un tenant normal no).
      createUser(AUTH(), ptoken, idempotencyKey(), {
        tenant_id: tenantId,
        identification_number: uniqueIdentificationNumber(),
        username: uniqueName(`cp-sec-001-user-${label}`),
        email,
        password: PASSWORD,
      }).its("status").should("eq", 201);
      createRole(AUTH(), ptoken, idempotencyKey(), {
        tenant_id: tenantId,
        name: uniqueName(`cp-sec-001-rol-${label}`),
        description: `Rol de la empresa ${label}`,
      }).its("status").should("eq", 201);

      login(AUTH(), { email, password: PASSWORD }).then((session) => {
        expect(session.status).to.eq(200);
        expect(session.body.tenant_id, "el login resuelve el tenant de la cuenta").to.eq(tenantId);
        const token = session.body.access_token;

        cy.request({ url: `${AUTH()}/api/v1/roles`, headers: authed(token) }).then((roles) => {
          seedCatalog(INVOICE(), token, `CP-SEC-001 ${label}`).then(({ customer, product }) => {
            createInvoice(
              INVOICE(),
              idempotencyKey(),
              { customer_id: customer.ID, items: [{ item_id: product.ID, quantity: 1, unit_price: 100 }] },
              token
            ).then((inv) => {
              expect(inv.status).to.eq(201);
              fixtures[label] = {
                label,
                tenantId,
                token,
                userId: session.body.user_id,
                roleId: roles.body[0].Id,
                customerId: customer.ID,
                productId: product.ID,
                invoice: inv.body,
                lineId: inv.body.Items[0].ID,
              };
            });
          });
        });
      });
    });
  });
};

describe("CP-SEC-001 - Aislamiento multi-tenant (Tenant A vs Tenant B)", () => {
  before(() => {
    provisionTenant("A");
    provisionTenant("B");
  });

  (
    [
      ["A", "B"],
      ["B", "A"],
    ] as const
  ).forEach(([me, other]) => {
    describe(`token de ${me} contra recursos de ${other}`, () => {
      it("facturación: no puede listar, ver, editar, pagar ni cancelar facturas ajenas", () => {
        const a = fixtures[me];
        const b = fixtures[other];
        const inv = b.invoice.ID;

        call(a.token, "GET", `${INVOICE()}/api/v1/invoices?page=1&page_size=100`).then((r) => {
          expect(r.status).to.eq(200);
          const ids = (r.body as InvoiceResponse[]).map((i) => i.ID);
          expect(ids).to.include(a.invoice.ID);
          expect(ids, "no lista facturas de la otra empresa").not.to.include(inv);
        });
        call(a.token, "GET", `${INVOICE()}/api/v1/invoices/${inv}`).its("status").should("eq", 404);
        call(a.token, "PUT", `${INVOICE()}/api/v1/invoices/${inv}`, { customer_id: a.customerId, due_date: "2030-01-01T00:00:00Z" })
          .its("status").should("eq", 404);
        call(a.token, "PATCH", `${INVOICE()}/api/v1/invoices/${inv}/pay`).its("status").should("eq", 404);
        call(a.token, "PATCH", `${INVOICE()}/api/v1/invoices/${inv}/cancel`).its("status").should("eq", 404);
      });

      it("líneas: no puede agregar, ver, modificar ni eliminar líneas de facturas ajenas", () => {
        const a = fixtures[me];
        const b = fixtures[other];

        call(a.token, "POST", `${INVOICE()}/api/v1/invoice-items`, {
          invoice_id: b.invoice.ID,
          item_id: a.productId,
          quantity: 1,
          unit_price: 5,
        }).its("status").should("eq", 404);
        call(a.token, "GET", `${INVOICE()}/api/v1/invoice-items/${b.lineId}`).its("status").should("eq", 404);
        call(a.token, "PUT", `${INVOICE()}/api/v1/invoice-items/${b.lineId}`, { quantity: 9, unit_price: 9 })
          .its("status").should("eq", 404);
        call(a.token, "DELETE", `${INVOICE()}/api/v1/invoice-items/${b.lineId}`).its("status").should("eq", 404);
        call(a.token, "GET", `${INVOICE()}/api/v1/invoice-items?page=1&page_size=100`).then((r) => {
          const ids = (r.body as Array<{ ID: string }>).map((l) => l.ID);
          expect(ids, "no lista líneas de la otra empresa").not.to.include(b.lineId);
        });
      });

      it("catálogos: no puede usar clientes ni productos ajenos ni verlos", () => {
        const a = fixtures[me];
        const b = fixtures[other];

        call(a.token, "POST", `${INVOICE()}/api/v1/invoices`, {
          customer_id: b.customerId,
          items: [{ item_id: a.productId, quantity: 1, unit_price: 10 }],
        }).then((r) => {
          expect(r.status).to.eq(422);
          expect(r.body).to.deep.equal({ error: "customer not found" });
        });
        call(a.token, "POST", `${INVOICE()}/api/v1/invoices`, {
          customer_id: a.customerId,
          items: [{ item_id: b.productId, quantity: 1, unit_price: 10 }],
        }).then((r) => {
          expect(r.status).to.eq(422);
          expect(r.body).to.deep.equal({ error: "product not found" });
        });
        call(a.token, "PUT", `${INVOICE()}/api/v1/invoices/${a.invoice.ID}`, { customer_id: b.customerId })
          .its("status").should("eq", 422);
        call(a.token, "POST", `${INVOICE()}/api/v1/invoice-items`, {
          invoice_id: a.invoice.ID,
          item_id: b.productId,
          quantity: 1,
          unit_price: 5,
        }).its("status").should("eq", 422);
        call(a.token, "GET", `${INVOICE()}/api/v1/customers?page_size=100`).then((r) => {
          const ids = (r.body as Array<{ ID: string }>).map((c) => c.ID);
          expect(ids).to.include(a.customerId);
          expect(ids).not.to.include(b.customerId);
        });
        call(a.token, "GET", `${INVOICE()}/api/v1/products?page_size=100`).then((r) => {
          const ids = (r.body as Array<{ ID: string }>).map((p) => p.ID);
          expect(ids).not.to.include(b.productId);
        });
      });

      it("Auth: no puede consultar ni asignar roles ni crear usuarios en otra empresa", () => {
        const a = fixtures[me];
        const b = fixtures[other];

        call(a.token, "GET", `${AUTH()}/api/v1/roles?tenant_id=${b.tenantId}`).then((r) => {
          expect(r.status).to.eq(403);
          expect(r.body).to.deep.equal({ error: "tenant mismatch" });
        });
        call(a.token, "GET", `${AUTH()}/api/v1/roles/${b.roleId}`).its("status").should("eq", 404);
        call(a.token, "GET", `${AUTH()}/api/v1/users/${b.userId}`).its("status").should("eq", 404);
        call(a.token, "POST", `${AUTH()}/api/v1/users/`, {
          tenant_id: b.tenantId,
          identification_number: uniqueIdentificationNumber(),
          username: uniqueName("cp-sec-001-intruso"),
          email: uniqueEmail("cp-sec-001-intruso"),
          password: PASSWORD,
        }).its("status").should("eq", 403);
        // Rol de la otra empresa a un usuario propio → inexistente.
        call(a.token, "POST", `${AUTH()}/api/v1/rbac/users/roles/assign`, {
          user_id: a.userId,
          role_id: b.roleId,
        }).its("status").should("eq", 404);
        call(a.token, "GET", `${AUTH()}/api/v1/tenants`).its("status").should("eq", 403);
      });

      it("los datos de la otra empresa quedan intactos", () => {
        const b = fixtures[other];
        call(b.token, "GET", `${INVOICE()}/api/v1/invoices/${b.invoice.ID}`).then((r) => {
          expect(r.status).to.eq(200);
          const inv = r.body as InvoiceResponse;
          expect(inv.Status).to.eq("PENDING");
          expect(inv.CustomerID).to.eq(b.customerId);
          expect(inv.Total).to.eq(b.invoice.Total);
          expect(inv.Items.map((l) => l.ID)).to.deep.equal([b.lineId]);
        });
      });
    });
  });
});
