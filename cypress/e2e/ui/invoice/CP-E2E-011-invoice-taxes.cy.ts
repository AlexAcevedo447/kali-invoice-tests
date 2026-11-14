import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensureRoleWithPermissions, grantRoleToUserByEmail } from "../../../support/api/auth/rbac";
import { loginToUIAs } from "../../../support/ui/session";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-E2E-011 - Impuestos múltiples por línea desde la interfaz (incremento 4).
 * Criterios: invoice-kali-front/docs/requisitos/INCREMENTO_04_IMPUESTOS.md (CA-13.x, D4-01..D4-06).
 * Empresa creada por la prueba (repetible). Los totales se comparan con los
 * valores exactos del servidor expuestos en data-value por la vista de solo lectura.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const PASSWORD = "UiTaxes!Kali2026";
const ROWS = '[data-cy="invoice-table"] tbody tr';
const invoiceNumber = (id: string) => `FAC-${id.slice(0, 8).toUpperCase()}`;
const toast = (text: string) => cy.contains(".p-toast-message", text, { timeout: 10000 });

type Tax = { code: string; kind: string; rate: number };
type ServerTax = { Code: string; Kind: string; Rate: number; Amount: number };
type ServerItem = { ID: string; ItemID: string; Taxes: ServerTax[] | null; Subtotal: number; TaxTotal: number; Total: number };
type ServerInvoice = { ID: string; Items: ServerItem[]; Subtotal: number; TaxTotal: number; Total: number };

const SEVERAL: Tax[] = [
  { code: "IVA", kind: "DEBIT", rate: 0.19 },
  { code: "INC", kind: "DEBIT", rate: 0.08 },
  { code: "RETEFUENTE", kind: "CREDIT", rate: 0.025 },
  { code: "RETEICA", kind: "CREDIT", rate: 0.00414 },
];

const pick = (cySelector: string, text: string) => {
  cy.get(`[data-cy="${cySelector}"]`).click();
  cy.get(".p-dropdown-panel .p-dropdown-filter").clear().type(text);
  cy.contains(".p-dropdown-panel .p-dropdown-item", text, { timeout: 10000 }).click();
};

const addTax = (line: number, index: number, code: string, kind: string, percent: string) => {
  cy.get(`[data-cy="item-${line}-tax-add"]`).click();
  cy.get(`[data-cy="item-${line}-tax-${index}-code"]`).type(code);
  if (kind) cy.get(`[data-cy="item-${line}-tax-${index}-kind"]`).select(kind);
  cy.get(`[data-cy="item-${line}-tax-${index}-rate"]`).type(percent);
};

const expectTaxRows = (line: number, rows: Array<[string, string, string]>) => {
  cy.get(`[data-cy="item-${line}-taxes"] [data-cy$="-row"]`).should("have.length", rows.length);
  rows.forEach(([code, kind, percent], j) => {
    cy.get(`[data-cy="item-${line}-tax-${j}-code"]`).should("have.value", code);
    cy.get(`[data-cy="item-${line}-tax-${j}-kind"]`).should("have.value", kind);
    cy.get(`[data-cy="item-${line}-tax-${j}-rate"]`).should("have.value", percent);
  });
};

const openFromRow = (id: string, action: "Editar" | "Ver") => {
  cy.visit("/invoicing/invoices");
  cy.contains(ROWS, invoiceNumber(id), { timeout: 10000 }).within(() => {
    if (action === "Ver") cy.get('[data-cy="invoice-view"]').click();
    else cy.get('button[title="Editar"]').click();
  });
};

/** La vista de solo lectura muestra exactamente los totales del servidor. */
const expectViewMatchesServer = (inv: ServerInvoice) => {
  cy.get('[data-cy="invoice-view-dialog"]').should("be.visible");
  cy.get('[data-cy="invoice-view-line"]').should("have.length", inv.Items.length);
  cy.get('[data-cy="invoice-view-subtotal"]').invoke("attr", "data-value").then(Number).should("eq", inv.Subtotal);
  cy.get('[data-cy="invoice-view-tax-total"]').invoke("attr", "data-value").then(Number).should("eq", inv.TaxTotal);
  cy.get('[data-cy="invoice-view-total"]').invoke("attr", "data-value").then(Number).should("eq", inv.Total);
  // D4-04: el TEXTO mostrado tampoco se redondea (solo se completan ceros hasta 2 decimales).
  const shownNumber = (text: string) => Number(text.replace(/[−$\s-]/g, ""));
  (
    [
      ["invoice-view-subtotal", inv.Subtotal],
      ["invoice-view-tax-total", inv.TaxTotal],
      ["invoice-view-total", inv.Total],
    ] as const
  ).forEach(([cyName, value]) =>
    cy.get(`[data-cy="${cyName}"]`).invoke("text").then((t) => expect(shownNumber(t), `${cyName} mostrado sin redondeo`).to.eq(Math.abs(value)))
  );
  const amounts = inv.Items.flatMap((i) => (i.Taxes ?? []).map((t) => t.Amount)).sort();
  if (amounts.length === 0) {
    cy.get('[data-cy="invoice-view-tax-amount"]').should("not.exist");
  } else {
    cy.get('[data-cy="invoice-view-tax-amount"]').should("have.length", amounts.length).then(($a) => {
      const shown = [...$a].map((el) => Number(el.getAttribute("data-value"))).sort();
      expect(shown).to.deep.eq(amounts);
      const texts = [...$a].map((el) => shownNumber(el.textContent ?? "")).sort();
      expect(texts, "importes de impuestos mostrados sin redondeo").to.deep.eq(amounts);
    });
  }
  const noTaxLines = inv.Items.filter((i) => (i.Taxes ?? []).length === 0).length;
  cy.get('[data-cy="invoice-view-no-taxes"]').should("have.length", noTaxLines);
};

describe("CP-E2E-011 - Impuestos múltiples por línea (UI)", () => {
  const users = { admin: uniqueEmail("cp-e2e-011-admin"), header: uniqueEmail("cp-e2e-011-cabecera"), reader: uniqueEmail("cp-e2e-011-lector") };
  let adminToken = "";
  let customer = { id: "", name: "" };
  const products: Array<{ id: string; code: string }> = [];

  const api = (method: string, path: string, body?: Cypress.RequestBody) =>
    cy.request({
      method,
      url: `${INVOICE()}/api/v1${path}`,
      body,
      headers: { Authorization: `Bearer ${adminToken}`, "Idempotency-Key": idempotencyKey() },
      failOnStatusCode: false,
    });
  const getInvoice = (id: string) => api("GET", `/invoices/${id}`).its("body").then((b) => b as ServerInvoice);
  const createViaApi = (lines: Array<{ product: number; quantity: number; price: number; taxes: Tax[] }>) =>
    api("POST", "/invoices", {
      customer_id: customer.id,
      items: lines.map((l) => ({ item_id: products[l.product].id, quantity: l.quantity, unit_price: l.price, taxes: l.taxes })),
    }).then((r) => {
      expect(r.status).to.eq(201);
      return (r.body as ServerInvoice).ID;
    });

  before(() => {
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-e2e-011") }).then((t) => {
        const tenantId = t.body.Id;
        const roles: Record<keyof typeof users, Array<[string, string]>> = {
          admin: [["*", "*"]],
          // D4-05: puede gestionar facturas (cabecera) pero no líneas.
          header: [
            ["invoices", "manage"],
            ["customers", "read"],
            ["products", "read"],
          ],
          // D4-06: solo consulta.
          reader: [["invoices", "read"]],
        };
        (Object.keys(users) as Array<keyof typeof users>).forEach((who) => {
          createUser(AUTH(), ptoken, idempotencyKey(), {
            tenant_id: tenantId,
            identification_number: uniqueIdentificationNumber(),
            username: uniqueName(`cp-e2e-011-${who}`).slice(0, 40),
            email: users[who],
            password: PASSWORD,
          }).its("status").should("eq", 201);
          ensureRoleWithPermissions(AUTH(), ptoken, tenantId, `cp-e2e-011-${who}`, roles[who]).then((r) =>
            grantRoleToUserByEmail(AUTH(), ptoken, tenantId, users[who], r.Id)
          );
        });
        login(AUTH(), { email: users.admin, password: PASSWORD }).then((s) => (adminToken = s.body.access_token));
      });
    });
    cy.then(() => {
      const suffix = `${Date.now()}`;
      api("POST", "/customers", { name: `Cliente UI Impuestos ${suffix}`, document: `E11-${suffix}` }).then((c) => {
        expect(c.status).to.eq(201);
        customer = { id: c.body.ID, name: c.body.Name };
      });
      [0, 1].forEach((n) =>
        api("POST", "/products", { code: `E11-${n}-${suffix}`, name: `Producto UI ${n}`, unit_price: 100 }).then((p) => {
          expect(p.status).to.eq(201);
          products[n] = { id: p.body.ID, code: p.body.Code };
        })
      );
    });
  });

  it("crear: línea con varios impuestos (débito, crédito, decimales) y línea sin impuestos; validaciones en español", () => {
    loginToUIAs(users.admin, PASSWORD);
    cy.intercept("POST", "**/api/v1/invoices").as("create");
    cy.visit("/invoicing/invoices");
    cy.contains("button", "Crear Factura").click();
    pick("customer-select", customer.name);
    pick("product-select-0", products[0].code);
    cy.get('[id="items.0.quantity"]').clear().type("3");
    cy.get('[id="items.0.unitPrice"]').clear().type("33.33");
    // D4-01: una línea nueva no trae impuestos inventados.
    cy.get('[data-cy="item-0-no-taxes"]').should("have.text", "Sin impuestos");

    addTax(0, 0, "IVA", "DEBIT", "19");
    addTax(0, 1, "INC", "DEBIT", "8");
    addTax(0, 2, "RETEFUENTE", "CREDIT", "2.5");
    addTax(0, 3, "ReteICA", "", "0.414");
    addTax(0, 4, " iva ", "CREDIT", "1");
    cy.contains(".p-dialog button", "Create Invoice").click();
    // D4-03: el tipo es obligatorio; D4-02: código repetido (mayúsculas/espacios).
    cy.get('[data-cy="item-0-tax-3-row"]').should("contain.text", "Selecciona");
    cy.get('[data-cy="item-0-tax-4-row"]').should("contain.text", "repetido");
    cy.get("@create.all").should("have.length", 0);
    cy.get('[data-cy="item-0-tax-3-kind"]').select("CREDIT");
    cy.get('[data-cy="item-0-tax-4-remove"]').click();

    cy.contains(".p-dialog button", "Add Item").click();
    pick("product-select-1", products[1].code);
    cy.get('[data-cy="item-1-no-taxes"]').should("be.visible");
    cy.contains(".p-dialog button", "Create Invoice").click();

    cy.wait("@create").then((i) => {
      expect(i.response?.statusCode).to.eq(201);
      expect(i.request.body.items[0].taxes).to.deep.eq([
        { code: "IVA", kind: "DEBIT", rate: 0.19 },
        { code: "INC", kind: "DEBIT", rate: 0.08 },
        { code: "RETEFUENTE", kind: "CREDIT", rate: 0.025 },
        { code: "ReteICA", kind: "CREDIT", rate: 0.00414 },
      ]);
      expect(i.request.body.items[1].taxes).to.deep.eq([]);
      const id = (i.response?.body as ServerInvoice).ID;
      toast("Factura creada correctamente");
      getInvoice(id).then((inv) => {
        const line0 = inv.Items.find((l) => l.ItemID === products[0].id) as ServerItem;
        expect(line0.Taxes?.map((t) => t.Code)).to.deep.eq(["IVA", "INC", "RETEFUENTE", "RETEICA"]);
        const subtotal = 3 * 33.33;
        expect(line0.TaxTotal).to.eq(subtotal * 0.19 + subtotal * 0.08 - subtotal * 0.025 - subtotal * 0.00414);
        expect(inv.Items.find((l) => l.ItemID === products[1].id)?.Taxes ?? []).to.have.length(0);
        cy.reload();
        openFromRow(id, "Ver");
        expectViewMatchesServer(inv);
      });
    });
  });

  it("editar: muestra todos los impuestos con tarifa exacta; guardar sin cambios no envía PUT de líneas", () => {
    createViaApi([
      { product: 0, quantity: 2, price: 10.5, taxes: SEVERAL },
      { product: 1, quantity: 1, price: 40, taxes: [] },
    ]).then((id) => {
      getInvoice(id).then((before) => {
        loginToUIAs(users.admin, PASSWORD);
        cy.intercept("PUT", "**/api/v1/invoice-items/*").as("itemPut");
        cy.intercept("PUT", "**/api/v1/invoices/*").as("headerPut");
        openFromRow(id, "Editar");
        const lineIndex = before.Items.findIndex((l) => l.ItemID === products[0].id);
        const emptyIndex = 1 - lineIndex;
        expectTaxRows(lineIndex, [
          ["IVA", "DEBIT", "19"],
          ["INC", "DEBIT", "8"],
          ["RETEFUENTE", "CREDIT", "2.5"],
          ["RETEICA", "CREDIT", "0.414"],
        ]);
        cy.get(`[data-cy="item-${emptyIndex}-no-taxes"]`).should("have.text", "Sin impuestos");
        cy.contains(".p-dialog button", "Update Invoice").click();
        cy.wait("@headerPut").its("response.statusCode").should("eq", 200);
        toast("Factura actualizada correctamente");
        cy.get("@itemPut.all").should("have.length", 0);
        getInvoice(id).then((after) => {
          expect(after.Total).to.eq(before.Total);
          expect(after.Items.find((l) => l.ItemID === products[1].id)?.Taxes ?? []).to.have.length(0);
        });
      });
    });
  });

  it("editar: quitar un impuesto, cambiar una tarifa y agregar otro persiste tras recargar; totales del servidor", () => {
    createViaApi([{ product: 0, quantity: 4, price: 25, taxes: SEVERAL }]).then((id) => {
      loginToUIAs(users.admin, PASSWORD);
      cy.intercept("PUT", "**/api/v1/invoice-items/*").as("itemPut");
      openFromRow(id, "Editar");
      cy.get('[data-cy="item-0-tax-1-remove"]').click(); // quita INC
      cy.get('[data-cy="item-0-tax-0-rate"]').clear().type("5.5"); // IVA 19 → 5.5
      addTax(0, 3, "ICA", "CREDIT", "0.966");
      cy.contains(".p-dialog button", "Update Invoice").click();
      cy.wait("@itemPut").then((i) => {
        expect(i.response?.statusCode).to.eq(200);
        expect(i.request.body.taxes).to.deep.eq([
          { code: "IVA", kind: "DEBIT", rate: 0.055 },
          { code: "RETEFUENTE", kind: "CREDIT", rate: 0.025 },
          { code: "RETEICA", kind: "CREDIT", rate: 0.00414 },
          { code: "ICA", kind: "CREDIT", rate: 0.00966 },
        ]);
      });
      toast("Factura actualizada correctamente");
      cy.reload();
      openFromRow(id, "Editar");
      expectTaxRows(0, [
        ["IVA", "DEBIT", "5.5"],
        ["RETEFUENTE", "CREDIT", "2.5"],
        ["RETEICA", "CREDIT", "0.414"],
        ["ICA", "CREDIT", "0.966"],
      ]);
      // Quitar todos: la línea queda "Sin impuestos" sin inventar un IVA 0 %.
      [3, 2, 1, 0].forEach((j) => cy.get(`[data-cy="item-0-tax-${j}-remove"]`).click());
      cy.get('[data-cy="item-0-no-taxes"]').should("be.visible");
      cy.contains(".p-dialog button", "Update Invoice").click();
      cy.wait("@itemPut").its("request.body.taxes").should("deep.eq", []);
      toast("Factura actualizada correctamente");
      getInvoice(id).then((inv) => {
        expect(inv.Items[0].Taxes ?? []).to.have.length(0);
        expect(inv.Total).to.eq(inv.Subtotal);
        openFromRow(id, "Ver");
        expectViewMatchesServer(inv);
      });
    });
  });

  it("D4-05: sin invoice-items/manage las líneas e impuestos son de solo lectura, con explicación; la cabecera sí se guarda", () => {
    createViaApi([{ product: 0, quantity: 1, price: 100, taxes: SEVERAL }]).then((id) => {
      loginToUIAs(users.header, PASSWORD);
      cy.intercept("PUT", "**/api/v1/invoice-items/*").as("itemPut");
      cy.intercept("PUT", "**/api/v1/invoices/*").as("headerPut");
      openFromRow(id, "Editar");
      cy.get('[data-cy="invoice-items-readonly-note"]').should("contain.text", "invoice-items/manage");
      cy.get('[data-cy="item-0-tax-add"]').should("be.disabled");
      cy.get('[data-cy="item-0-tax-0-rate"]').should("be.disabled");
      cy.get('[data-cy="item-0-tax-0-remove"]').should("be.disabled");
      cy.get('[id="items.0.quantity"]').should("be.disabled");
      cy.get("#dueDate").clear().type("2099-03-01T10:00");
      cy.contains(".p-dialog button", "Update Invoice").click();
      cy.wait("@headerPut").its("response.statusCode").should("eq", 200);
      cy.get("@itemPut.all").should("have.length", 0);
      getInvoice(id).then((inv) => expect(inv.Items[0].Taxes?.map((t) => t.Code)).to.deep.eq(SEVERAL.map((t) => t.code)));
    });
  });

  it("D4-06: invoices/read consulta líneas e impuestos en solo lectura", () => {
    createViaApi([
      { product: 0, quantity: 3, price: 33.33, taxes: SEVERAL },
      { product: 1, quantity: 2, price: 7.25, taxes: [] },
    ]).then((id) => {
      getInvoice(id).then((inv) => {
        loginToUIAs(users.reader, PASSWORD);
        openFromRow(id, "Ver");
        expectViewMatchesServer(inv);
        cy.get('[data-cy="invoice-view-tax-code"]').then(($c) => expect([...$c].map((e) => e.textContent)).to.deep.eq(SEVERAL.map((t) => t.code)));
        cy.get('[data-cy="invoice-view-dialog"] input, [data-cy="invoice-view-dialog"] select').should("not.exist");
      });
    });
  });
});
