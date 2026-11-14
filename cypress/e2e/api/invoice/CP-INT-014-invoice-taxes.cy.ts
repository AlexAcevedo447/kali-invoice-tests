import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensureRoleWithPermissions, grantRoleToUserByEmail } from "../../../support/api/auth/rbac";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-INT-014 - Impuestos múltiples por línea (incremento 4, RF-13/RF-14).
 * Criterios: invoice-kali-front/docs/requisitos/INCREMENTO_04_IMPUESTOS.md.
 *
 * Reglas del servidor: la tarifa es una fracción (0.19 = 19 %); importe =
 * subtotal × tarifa en float64 SIN redondeo; DEBIT suma y CREDIT resta. Por eso
 * los importes de línea se comparan con igualdad exacta contra el mismo cálculo
 * en JavaScript (también IEEE-754 double, en el mismo orden). Los totales de la
 * factura los suma Postgres (orden de suma no garantizado), así que se comparan
 * con una tolerancia de 1e-9.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const PASSWORD = "Impuestos!Kali2026";

type Tax = { code: string; kind: string; rate: number };
type ServerTax = { Code: string; Kind: string; Rate: number; Amount: number };
type ServerItem = { ID: string; ItemID: string; Quantity: number; UnitPrice: number; Taxes: ServerTax[] | null; Subtotal: number; TaxTotal: number; Total: number };
type ServerInvoice = { ID: string; Items: ServerItem[]; Subtotal: number; TaxTotal: number; Total: number };

const call = (token: string, method: string, path: string, body?: Cypress.RequestBody) =>
  cy.request({
    method,
    url: `${INVOICE()}/api/v1${path}`,
    body,
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey() },
    failOnStatusCode: false,
  });

/** Cálculo de referencia idéntico al del servidor (sin redondeo). */
const expectLine = (item: ServerItem, quantity: number, unitPrice: number, taxes: Tax[]) => {
  const subtotal = quantity * unitPrice;
  expect(item.Subtotal, "subtotal de línea").to.eq(subtotal);
  const got = item.Taxes ?? [];
  expect(got.map((t) => t.Code), "códigos en el orden enviado").to.deep.eq(taxes.map((t) => t.code.trim().toUpperCase()));
  let taxTotal = 0;
  taxes.forEach((t, i) => {
    const amount = subtotal * t.rate;
    expect(got[i].Kind, `tipo ${t.code}`).to.eq(t.kind.trim().toUpperCase());
    expect(got[i].Rate, `tarifa exacta ${t.code}`).to.eq(t.rate);
    expect(got[i].Amount, `importe exacto ${t.code}`).to.eq(amount);
    taxTotal += got[i].Kind === "CREDIT" ? -amount : amount;
  });
  expect(item.TaxTotal, "impuestos de línea").to.eq(taxTotal);
  expect(item.Total, "total de línea").to.eq(subtotal + taxTotal);
};

const expectInvoiceTotals = (inv: ServerInvoice) => {
  const sum = (f: (i: ServerItem) => number) => inv.Items.reduce((acc, i) => acc + f(i), 0);
  expect(inv.Subtotal, "subtotal factura").to.be.closeTo(sum((i) => i.Subtotal), 1e-9);
  expect(inv.TaxTotal, "impuestos factura").to.be.closeTo(sum((i) => i.TaxTotal), 1e-9);
  expect(inv.Total, "total factura").to.be.closeTo(sum((i) => i.Total), 1e-9);
};

const lineOf = (inv: ServerInvoice, productId: string) => {
  const line = inv.Items.find((i) => i.ItemID === productId);
  expect(line, `línea del producto ${productId}`).to.exist;
  return line as ServerItem;
};

const SEVERAL: Tax[] = [
  { code: "IVA", kind: "DEBIT", rate: 0.19 },
  { code: "INC", kind: "DEBIT", rate: 0.08 },
  { code: "RETEFUENTE", kind: "CREDIT", rate: 0.025 },
  { code: "RETEICA", kind: "CREDIT", rate: 0.00414 },
];

describe("CP-INT-014 - Impuestos múltiples por línea (API)", () => {
  const tokens = { full: "", invoicesOnly: "" };
  const products: string[] = [];
  let customerId = "";

  before(() => {
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-int-014") }).then((t) => {
        const tenantId = t.body.Id;
        const roles: Record<keyof typeof tokens, Array<[string, string]>> = {
          full: [
            ["invoices", "manage"],
            ["invoice-items", "manage"],
            ["customers", "manage"],
            ["products", "manage"],
          ],
          // D4-05: invoices/manage NO concede invoice-items/manage.
          invoicesOnly: [
            ["invoices", "manage"],
            ["customers", "read"],
            ["products", "read"],
          ],
        };
        (Object.keys(roles) as Array<keyof typeof tokens>).forEach((who) => {
          const email = uniqueEmail(`cp-int-014-${who}`);
          createUser(AUTH(), ptoken, idempotencyKey(), {
            tenant_id: tenantId,
            identification_number: uniqueIdentificationNumber(),
            username: uniqueName(`cp-int-014-${who}`).slice(0, 40),
            email,
            password: PASSWORD,
          }).its("status").should("eq", 201);
          ensureRoleWithPermissions(AUTH(), ptoken, tenantId, `cp14-${who}`, roles[who]).then((role) =>
            grantRoleToUserByEmail(AUTH(), ptoken, tenantId, email, role.Id)
          );
          login(AUTH(), { email, password: PASSWORD }).then((s) => (tokens[who] = s.body.access_token));
        });
      });
    });
    cy.then(() => {
      const suffix = `${Date.now()}`;
      call(tokens.full, "POST", "/customers", { name: "Cliente CP14", document: `CP14-${suffix}` }).then((c) => {
        expect(c.status).to.eq(201);
        customerId = c.body.ID;
      });
      [0, 1, 2].forEach((n) =>
        call(tokens.full, "POST", "/products", { code: `P14-${n}-${suffix}`, name: `Producto CP14 ${n}`, unit_price: 100 }).then((p) => {
          expect(p.status).to.eq(201);
          products[n] = p.body.ID;
        })
      );
    });
  });

  const createThreeLines = () =>
    call(tokens.full, "POST", "/invoices", {
      customer_id: customerId,
      items: [
        { item_id: products[0], quantity: 2, unit_price: 50, taxes: [] },
        { item_id: products[1], quantity: 1, unit_price: 1000, taxes: [{ code: "IVA", kind: "DEBIT", rate: 0.19 }] },
        { item_id: products[2], quantity: 3, unit_price: 33.33, taxes: SEVERAL },
      ],
    });

  it("crea con cero, uno y varios impuestos (DEBIT/CREDIT, tarifas decimales) y los consulta todos, en orden y sin redondeo", () => {
    createThreeLines().then((res) => {
      expect(res.status).to.eq(201);
      const created = res.body as ServerInvoice;
      call(tokens.full, "GET", `/invoices/${created.ID}`).then((g) => {
        expect(g.status).to.eq(200);
        const inv = g.body as ServerInvoice;
        expectLine(lineOf(inv, products[0]), 2, 50, []);
        expectLine(lineOf(inv, products[1]), 1, 1000, [{ code: "IVA", kind: "DEBIT", rate: 0.19 }]);
        expectLine(lineOf(inv, products[2]), 3, 33.33, SEVERAL);
        expectInvoiceTotals(inv);
        // Lo devuelto al crear coincide con lo persistido.
        expect(created.Total).to.be.closeTo(inv.Total, 1e-9);
      });
    });
  });

  it("normaliza código (espacios y mayúsculas) y tipo", () => {
    call(tokens.full, "POST", "/invoices", {
      customer_id: customerId,
      items: [{ item_id: products[0], quantity: 1, unit_price: 10, taxes: [{ code: "  reteFuente ", kind: "credit", rate: 0.035 }] }],
    }).then((r) => {
      expect(r.status).to.eq(201);
      const tax = (r.body as ServerInvoice).Items[0].Taxes?.[0];
      expect(tax?.Code).to.eq("RETEFUENTE");
      expect(tax?.Kind).to.eq("CREDIT");
    });
  });

  it("rechaza (400) código repetido, código vacío, tipo vacío o inválido y tarifa negativa", () => {
    const cases: Array<[Tax[], string]> = [
      [[{ code: "IVA", kind: "DEBIT", rate: 0.19 }, { code: " iva ", kind: "DEBIT", rate: 0.05 }], "tax code is repeated in the same item"],
      [[{ code: "   ", kind: "DEBIT", rate: 0.19 }], "tax code is required"],
      [[{ code: "IVA", kind: "", rate: 0.19 }], "tax kind must be DEBIT or CREDIT"],
      [[{ code: "IVA", kind: "OTRO", rate: 0.19 }], "tax kind must be DEBIT or CREDIT"],
      [[{ code: "IVA", kind: "DEBIT", rate: -0.01 }], "tax rate must be greater than or equal to 0"],
    ];
    cases.forEach(([taxes, message]) =>
      call(tokens.full, "POST", "/invoices", {
        customer_id: customerId,
        items: [{ item_id: products[0], quantity: 1, unit_price: 10, taxes }],
      }).then((r) => {
        expect(r.status, message).to.eq(400);
        expect(r.body.error).to.eq(message);
      })
    );
  });

  it("PUT /invoice-items reemplaza la lista: cambiar, reordenar, quitar y dejar sin impuestos; los totales siguen al servidor", () => {
    createThreeLines().then((res) => {
      const invoiceId = (res.body as ServerInvoice).ID;
      const line = lineOf(res.body as ServerInvoice, products[2]);
      const put = (taxes: Tax[], quantity = 3, unitPrice = 33.33) =>
        call(tokens.full, "PUT", `/invoice-items/${line.ID}`, { quantity, unit_price: unitPrice, taxes });
      const check = (quantity: number, unitPrice: number, taxes: Tax[]) =>
        call(tokens.full, "GET", `/invoices/${invoiceId}`).then((g) => {
          const inv = g.body as ServerInvoice;
          expectLine(lineOf(inv, products[2]), quantity, unitPrice, taxes);
          expectInvoiceTotals(inv);
        });

      // Quitar dos impuestos y cambiar la tarifa de otro.
      const reduced: Tax[] = [
        { code: "IVA", kind: "DEBIT", rate: 0.05 },
        { code: "RETEICA", kind: "CREDIT", rate: 0.00966 },
      ];
      put(reduced).its("status").should("eq", 200);
      check(3, 33.33, reduced);

      // Orden distinto al alfabético y al anterior: se conserva tras varios reemplazos.
      const reordered: Tax[] = [
        { code: "RETEICA", kind: "CREDIT", rate: 0.00966 },
        { code: "INC", kind: "DEBIT", rate: 0.08 },
        { code: "IVA", kind: "DEBIT", rate: 0.05 },
      ];
      put(reordered).its("status").should("eq", 200);
      put(reordered).its("status").should("eq", 200);
      check(3, 33.33, reordered);

      // Guardar lo mismo no cambia nada.
      call(tokens.full, "GET", `/invoices/${invoiceId}`).then((before) => {
        put(reordered).its("status").should("eq", 200);
        call(tokens.full, "GET", `/invoices/${invoiceId}`).then((after) => {
          const strip = (inv: ServerInvoice) =>
            lineOf(inv, products[2]).Taxes?.map(({ Code, Kind, Rate, Amount }) => ({ Code, Kind, Rate, Amount }));
          expect(strip(after.body)).to.deep.eq(strip(before.body));
          expect(after.body.Total).to.eq(before.body.Total);
        });
      });

      // Quitar todos: la línea queda sin impuestos (no se inventa un IVA 0 %).
      put([], 4, 12.5).its("status").should("eq", 200);
      check(4, 12.5, []);

      // Repetidos en PUT también son 400 y no alteran lo guardado.
      put([{ code: "INC", kind: "DEBIT", rate: 0.08 }, { code: "inc ", kind: "CREDIT", rate: 0.01 }]).then((r) => {
        expect(r.status).to.eq(400);
        expect(r.body.error).to.eq("tax code is repeated in the same item");
      });
      check(4, 12.5, []);
    });
  });

  it("D4-05: invoices/manage crea facturas con impuestos y edita la cabecera, pero no modifica líneas (403)", () => {
    call(tokens.invoicesOnly, "POST", "/invoices", {
      customer_id: customerId,
      items: [{ item_id: products[1], quantity: 1, unit_price: 200, taxes: SEVERAL }],
    }).then((r) => {
      expect(r.status).to.eq(201);
      const inv = r.body as ServerInvoice;
      expectLine(inv.Items[0], 1, 200, SEVERAL);
      call(tokens.invoicesOnly, "PUT", `/invoice-items/${inv.Items[0].ID}`, { quantity: 1, unit_price: 200, taxes: [] }).then((u) => {
        expect(u.status).to.eq(403);
        expect(u.body).to.deep.eq({ error: "insufficient permissions" });
      });
      call(tokens.invoicesOnly, "PUT", `/invoices/${inv.ID}`, { due_date: "2099-12-31T00:00:00Z" }).its("status").should("eq", 200);
      call(tokens.full, "GET", `/invoices/${inv.ID}`).then((g) => expectLine(g.body.Items[0], 1, 200, SEVERAL));
    });
  });

  it("factura pagada: sus impuestos no se modifican (422)", () => {
    createThreeLines().then((res) => {
      const inv = res.body as ServerInvoice;
      const line = lineOf(inv, products[1]);
      call(tokens.full, "PATCH", `/invoices/${inv.ID}/pay`).its("status").should("eq", 200);
      call(tokens.full, "PUT", `/invoice-items/${line.ID}`, { quantity: 1, unit_price: 1000, taxes: [] }).its("status").should("eq", 422);
      call(tokens.full, "GET", `/invoices/${inv.ID}`).then((g) =>
        expectLine(lineOf(g.body, products[1]), 1, 1000, [{ code: "IVA", kind: "DEBIT", rate: 0.19 }])
      );
    });
  });
});
