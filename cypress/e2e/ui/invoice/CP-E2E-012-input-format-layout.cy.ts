import { createTenant, createUser } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensureRoleWithPermissions, grantRoleToUserByEmail } from "../../../support/api/auth/rbac";
import { loginToUIAs } from "../../../support/ui/session";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-E2E-012 - Regresión de los hallazgos de la evidencia AA3-EV02:
 * entrada decimal es-CO (M-02), formato monetario visual, diseño en pantallas
 * pequeñas y nombres largos (M-03, M-06) y política de contraseñas en caracteres
 * Unicode en la interfaz (M-08). Empresa creada por la prueba (repetible).
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const PASSWORD = "UiFormatos!Kali2026";
const ROWS = '[data-cy="invoice-table"] tbody tr';
const MSG = {
  dot: "Usa coma (,) para los decimales y no uses puntos de miles. Ejemplo: 1234,5",
  commas: "Usa una sola coma decimal. No uses separadores de miles.",
  chars: "Escribe solo números y, si hace falta, una coma decimal.",
};
/** Tolerancia de redondeo subpíxel del motor de diseño (p. ej. Firefox: 768.00003 px). */
const SUBPIXEL = 1;
const money = (value: number) =>
  `$${new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value))}`;

/** Pegado: el valor completo entra de una vez en el campo (como al pegar), sin pulsaciones. */
const paste = (selector: string, text: string) =>
  cy.get(selector).clear().then(($el) => {
    const el = $el[0] as HTMLInputElement;
    el.dispatchEvent(new Event("paste", { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

const pick = (cySelector: string, text: string) => {
  cy.get(`[data-cy="${cySelector}"]`).click();
  cy.get(".p-dropdown-panel .p-dropdown-filter").clear({ force: true }).type(text, { force: true });
  cy.contains(".p-dropdown-panel .p-dropdown-item", text, { timeout: 10000 }).click();
};

const noPageOverflow = (label: string) =>
  cy.document().then((d) => {
    const { scrollWidth, clientWidth } = d.documentElement;
    expect(scrollWidth, `${label}: la página no se desborda (${scrollWidth} ≤ ${clientWidth})`).to.be.at.most(clientWidth);
  });

describe("CP-E2E-012 - Entrada es-CO, formato monetario, diseño y contraseñas (UI)", () => {
  const admin = uniqueEmail("cp-e2e-012-admin");
  const longName = `CLIENTESINESPACIOS${"X".repeat(160)}${Date.now()}`;
  let token = "";
  let productCode = "";
  let customerName = "";

  before(() => {
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-e2e-012") }).then((t) => {
        const tenantId = t.body.Id;
        createUser(AUTH(), ptoken, idempotencyKey(), {
          tenant_id: tenantId,
          identification_number: uniqueIdentificationNumber(),
          username: "admin-e2e-012",
          email: admin,
          password: PASSWORD,
        }).its("status").should("eq", 201);
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "administrador", [["*", "*"]]).then((r) =>
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, admin, r.Id)
        );
        cy.request({ method: "POST", url: `${AUTH()}/api/v1/auth/login`, body: { email: admin, password: PASSWORD } }).then(
          (s) => (token = s.body.access_token)
        );
      });
    });
    cy.then(() => {
      const api = (path: string, body: object) =>
        cy.request({ method: "POST", url: `${INVOICE()}/api/v1${path}`, body, headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey() } });
      const suffix = Date.now();
      customerName = `Cliente E012 ${suffix}`;
      productCode = `E012-${suffix}`;
      api("/customers", { name: customerName, document: `E012-${suffix}` });
      api("/customers", { name: longName, document: `E012L-${suffix}` });
      api("/products", { code: productCode, name: "Producto E012", unit_price: 100 });
    });
  });

  it("M-02: cantidad, precio y tarifa aceptan la coma decimal y rechazan punto, miles y separadores ambiguos (escritura y pegado)", () => {
    loginToUIAs(admin, PASSWORD);
    cy.intercept("POST", "**/api/v1/invoices").as("create");
    cy.visit("/invoicing/invoices");
    cy.contains("button", "Crear Factura").click();
    pick("customer-select", customerName);
    pick("product-select-0", productCode);
    cy.get('[data-cy="item-0-tax-add"]').click();
    cy.get('[data-cy="item-0-tax-0-code"]').type("IVA");
    cy.get('[data-cy="item-0-tax-0-kind"]').select("DEBIT");

    const cases: Array<[string, string, string]> = [
      ["escrito", "1.5", MSG.dot],
      ["pegado", "1.234,56", MSG.dot],
      ["pegado", "150.000", MSG.dot],
      ["escrito", "1,2,3", MSG.commas],
      ["pegado", "$150", MSG.chars],
      ["pegado", "1 234", MSG.chars],
      ["escrito", "1e3", MSG.chars],
    ];
    cases.forEach(([how, value, message]) => {
      if (how === "pegado") paste('[id="items.0.quantity"]', value);
      else cy.get('[id="items.0.quantity"]').clear().type(value);
      cy.get('[id="items.0.unitPrice"]').clear().type("100");
      cy.get('[data-cy="item-0-tax-0-rate"]').clear().type("19");
      cy.contains(".p-dialog button", "Create Invoice").click();
      // El valor escrito se conserva tal cual (no se reinterpreta) y aparece el motivo.
      cy.get('[id="items.0.quantity"]').should("have.value", value);
      cy.contains(".p-dialog", message).should("be.visible");
    });
    paste('[id="items.0.unitPrice"]', "100.25");
    cy.contains(".p-dialog button", "Create Invoice").click();
    cy.contains(".p-dialog", MSG.dot).should("be.visible");
    cy.get('[data-cy="item-0-tax-0-rate"]').clear().type("19.5");
    cy.contains(".p-dialog button", "Create Invoice").click();
    cy.get('[data-cy="item-0-tax-0-row"]').should("contain.text", MSG.dot);
    cy.get("@create.all").should("have.length", 0);

    // Valores válidos en es-CO: se envían exactos.
    cy.get('[id="items.0.quantity"]').clear().type("1,5");
    paste('[id="items.0.unitPrice"]', "100,25");
    cy.get('[data-cy="item-0-tax-0-rate"]').clear().type("19,5");
    cy.contains(".p-dialog button", "Create Invoice").click();
    cy.wait("@create").then((i) => {
      expect(i.response?.statusCode).to.eq(201);
      expect(i.request.body.items[0]).to.include({ quantity: 1.5, unit_price: 100.25 });
      expect(i.request.body.items[0].taxes).to.deep.eq([{ code: "IVA", kind: "DEBIT", rate: 0.195 }]);
      const inv = i.response?.body as { ID: string; Total: number };
      const row = () => cy.contains(ROWS, `FAC-${inv.ID.slice(0, 8).toUpperCase()}`);
      // Monto: valor exacto del servidor en data-value; texto con formato visual es-CO de 2 decimales.
      row().find('[data-cy="invoice-row-amount"]').should("have.attr", "data-value", String(inv.Total)).and("have.text", money(inv.Total));
      // Vista de solo lectura: cantidad y tarifa también con coma decimal.
      row().find('[data-cy="invoice-view"]').click();
      cy.get('[data-cy="invoice-view-line-quantity"]').should("have.text", "1,5");
      cy.get('[data-cy="invoice-view-tax-rate"]').should("contain.text", "19,5 %");
      cy.get("body").type("{esc}");
      row().find('button[title="Editar"]').click();
      cy.get('[id="items.0.quantity"]').should("have.value", "1,5");
      cy.get('[id="items.0.unitPrice"]').should("have.value", "100,25");
      cy.get('[data-cy="item-0-tax-0-rate"]').should("have.value", "19,5");
    });
  });

  it("M-02: el precio de producto acepta coma decimal y rechaza el punto", () => {
    loginToUIAs(admin, PASSWORD);
    cy.visit("/invoicing/products");
    const code = `E012P-${Date.now()}`;
    cy.get('[data-cy="product-code"]').type(code);
    cy.get('[data-cy="product-name"]').type("Precio con decimales");
    cy.get('[data-cy="product-unitPrice"]').type("12.5");
    cy.get('[data-cy="product-submit"]').click();
    cy.contains(MSG.dot).should("be.visible");
    cy.get('[data-cy="product-unitPrice"]').clear().type("12,5");
    cy.get('[data-cy="product-submit"]').click();
    cy.contains(".p-toast-message", "Producto creado", { timeout: 10000 });
    cy.get('[data-cy="product-search"]').type(code);
    cy.contains('[data-cy="product-table"] tr', code)
      .find('[data-cy="product-row-unit-price"]')
      .should("have.attr", "data-value", "12.5")
      .and("have.text", "$12,50");
  });

  it("M-03/M-06: en móvil y tableta la página no se desborda, la navegación es accesible y los nombres largos se ajustan", () => {
    const sizes: Array<[string, number, number]> = [
      ["móvil", 390, 844],
      ["tableta", 768, 1024],
    ];
    sizes.forEach(([label, w, h]) => {
      cy.viewport(w, h);
      loginToUIAs(admin, PASSWORD);
      ["/invoicing/invoices", "/invoicing/customers", "/invoicing/products", "/admin/users", "/admin/roles", "/admin/permissions"].forEach((path) => {
        cy.visit(path);
        cy.get('[data-cy="app-nav"]').should("be.visible");
        cy.wait(300);
        noPageOverflow(`${label} ${path}`);
        cy.get('[data-cy="app-nav"] a').each(($a) => {
          const rect = $a[0].getBoundingClientRect();
          expect(rect.right, `${label}: enlace "${$a.text()}" dentro de la pantalla`).to.be.at.most(w + SUBPIXEL);
        });
        cy.get('[data-cy="logout-button"]').then(($b) => expect($b[0].getBoundingClientRect().right).to.be.at.most(w + SUBPIXEL));
      });
      cy.visit("/invoicing/customers");
      cy.get('[data-cy="customer-search"]').type("CLIENTESINESPACIOS");
      cy.get('[data-cy="customer-table"]').should("contain.text", "CLIENTESINESPACIOS");
      noPageOverflow(`${label} clientes con nombre largo`);
      cy.visit("/invoicing/invoices");
      cy.contains("button", "Crear Factura").click();
      cy.get('[data-cy="customer-select"]').click();
      cy.get(".p-dropdown-panel .p-dropdown-filter").type("CLIENTESINESPACIOS", { force: true });
      cy.contains(".p-dropdown-panel .p-dropdown-item", "CLIENTESINESPACIOS").then(($item) => {
        const rect = $item[0].getBoundingClientRect();
        expect(rect.right, `${label}: opción larga dentro de la pantalla`).to.be.at.most(w + SUBPIXEL);
      });
      cy.get(".p-dropdown-panel").then(($p) => expect($p[0].getBoundingClientRect().right, `${label}: panel del selector`).to.be.at.most(w + SUBPIXEL));
      noPageOverflow(`${label} formulario de factura`);
      cy.get("body").type("{esc}");
    });
  });

  it("importes y estados del listado no se parten en varias líneas (1000, 768 y 390 px)", () => {
    /** Número de líneas que ocupa el texto del elemento (por posición vertical de sus fragmentos). */
    const lines = (el: HTMLElement) => {
      // Solo los nodos de texto (no las cajas de los elementos que los envuelven).
      const doc = el.ownerDocument;
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const tops: number[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        const range = doc.createRange();
        range.selectNodeContents(node);
        [...range.getClientRects()].forEach((r) => {
          if (!tops.some((t) => Math.abs(t - r.top) <= 2)) tops.push(r.top);
        });
      }
      return tops.length;
    };
    ([
      [1000, 660],
      [768, 1024],
      [390, 844],
    ] as const).forEach(([w, h]) => {
      cy.viewport(w, h);
      loginToUIAs(admin, PASSWORD);
      cy.visit("/invoicing/invoices");
      cy.get('[data-cy="invoice-row-amount"]').should("have.length.greaterThan", 0).each(($a) => {
        expect(lines($a[0]), `${w}px: importe "${$a.text()}" en una sola línea`).to.eq(1);
      });
      cy.get(`${ROWS} .p-tag`).each(($t) => {
        expect(lines($t[0]), `${w}px: estado "${$t.text()}" en una sola línea`).to.eq(1);
      });
      noPageOverflow(`${w}px listado de facturas`);
    });
  });

  it("M-08: la interfaz exige 12 caracteres Unicode (no bytes) igual que el servidor", () => {
    loginToUIAs(admin, PASSWORD);
    cy.intercept("POST", "**/api/v1/users**").as("createUser");
    cy.visit("/admin/users");
    const fill = (password: string) => {
      cy.get('[data-cy="user-identification"]').clear().type(uniqueIdentificationNumber());
      cy.get('[data-cy="user-username"]').clear().type(`e012-${Date.now()}`.slice(0, 30));
      cy.get('[data-cy="user-email"]').clear().type(uniqueEmail("cp-e2e-012-pass"));
      cy.get('[data-cy="user-password"]').clear().type(password, { log: false });
      cy.get('[data-cy="user-submit"]').click();
    };
    ["Ñandú#Clav1", "Clave#2026😀"].forEach((password) => {
      fill(password);
      cy.contains("La contraseña debe tener al menos 12 caracteres.").should("be.visible");
    });
    cy.get("@createUser.all").should("have.length", 0);
    fill("Ñandú#Clave1");
    cy.wait("@createUser").its("response.statusCode").should("eq", 201);
    cy.contains(".p-toast-message", "Usuario creado", { timeout: 10000 });
  });
});
