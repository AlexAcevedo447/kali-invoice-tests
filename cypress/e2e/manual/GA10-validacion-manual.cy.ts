import { createInvoice, InvoiceResponse } from "../../support/api/invoice/invoice-client";
import { createRole, createUser, getUserByEmail } from "../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../support/api/auth/session";
import { loginToUI } from "../../support/ui/session";
import {
  idempotencyKey,
  uniqueEmail,
  uniqueIdentificationNumber,
  uniqueName,
  uuid,
} from "../../support/data/unique";

/**
 * GA10-220501097-AA11-EV01 — Validación funcional para el manual de usuario.
 *
 * Verifica (con aserciones) el comportamiento visible ya corregido y, además,
 * registra requests/respuestas/textos en cypress/results/GA10-observaciones.json
 * y toma capturas para el manual en
 * cypress/screenshots/GA10-validacion-manual.cy.ts/GA10/.
 *
 * cy.intercept se usa como espía salvo en dos casos marcados como SIMULADOS:
 * la lista vacía y el fallo de backend al editar (no hay forma de provocarlos
 * de forma real sin alterar datos o servicios).
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const TENANT = () => Cypress.env("AUTH_TENANT_ID");
const ROWS = '[data-cy="invoice-table"] tbody tr';
const PAGE_SIZE = 10;
const PASSWORD = "Manual!Prueba2026";

const obs: Record<string, unknown> = {};
const rec = (key: string, value: unknown) => {
  obs[key] = value;
};

const shot = (name: string) =>
  cy.screenshot(`GA10/${name}`, { capture: "viewport", overwrite: true });

const bodyText = () =>
  cy.get("body").then(($b) => ($b[0] as HTMLElement).innerText.replace(/\n{2,}/g, "\n").trim());

/** Espera a que aparezca al menos un toast y devuelve todos los visibles. */
const toasts = (expectAtLeastOne = true) => {
  if (expectAtLeastOne) {
    cy.get(".p-toast-message", { timeout: 10000 }).should("exist");
  }
  cy.wait(1500);
  return cy
    .get("body")
    .then(($b) =>
      [...$b.find(".p-toast-message")].map((e) =>
        (e as HTMLElement).innerText.replace(/\s+/g, " ").trim()
      )
    );
};

const invoiceNumber = (id: string) => `FAC-${id.slice(0, 8).toUpperCase()}`;

const backendTotal = () =>
  cy
    .request(`${INVOICE()}/api/v1/invoices?page=1&page_size=1`)
    .then((r) => Number(r.headers["x-total-count"]));

const getInvoice = (id: string) =>
  cy.request<InvoiceResponse>(`${INVOICE()}/api/v1/invoices/${id}`).its("body");

const allInvoices = () =>
  cy
    .request<InvoiceResponse[]>(`${INVOICE()}/api/v1/invoices?page=1&page_size=100`)
    .its("body");

const idFromNumber = (invoices: InvoiceResponse[], number: string) =>
  invoices.find((i) => invoiceNumber(i.ID) === number.trim());

const patchInvoice = (id: string, action: "pay" | "cancel") =>
  cy.request({
    method: "PATCH",
    url: `${INVOICE()}/api/v1/invoices/${id}/${action}`,
    headers: { "Idempotency-Key": idempotencyKey() },
    failOnStatusCode: false,
  });

/** En facturas Pagadas/Canceladas las tres acciones quedan deshabilitadas con motivo. */
const expectActionsClosed = (number: string, label: "Pagada" | "Cancelada") => {
  const reason =
    label === "Pagada"
      ? "La factura pagada no admite modificaciones."
      : "La factura cancelada no admite modificaciones.";
  cy.contains(ROWS, number).within(() => {
    ["action-edit", "action-change-status", "action-cancel"].forEach((cyId) =>
      cy.get(`[data-cy="${cyId}"]`).should("be.disabled").and("have.attr", "title", reason)
    );
  });
};

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Login real por formulario. */
const uiLogin = (email: string, password: string, tenant = TENANT()) => {
  cy.visit("/login");
  cy.get("#tenantId").type(tenant);
  cy.get("#email").type(email);
  cy.get("#password").type(password, { log: false });
  cy.contains("button", "Sign In").click();
};

/** Crea por API un rol con un único permiso (resource/action) y devuelve su nombre. */
const createRoleWithPermission = (resource: string, action: string) => {
  const roleName = uniqueName("ga10-rol-facturacion");
  return loginAsAdmin().then((session) => {
    const token = session.access_token;
    createRole(AUTH(), token, idempotencyKey(), {
      tenant_id: TENANT(),
      name: roleName,
      description: "Rol GA10: solo facturación",
    }).its("status").should("eq", 201);
    cy.request({
      method: "POST",
      url: `${AUTH()}/api/v1/permissions/`,
      headers: { ...authed(token), "Idempotency-Key": idempotencyKey() },
      body: { tenant_id: TENANT(), resource, action },
    }).its("status").should("eq", 201);

    cy.request({ url: `${AUTH()}/api/v1/roles`, qs: { tenant_id: TENANT() }, headers: authed(token) })
      .its("body")
      .then((roles: Array<{ Id: string; Name: string }>) => {
        const role = roles.find((r) => r.Name === roleName)!;
        cy.request({ url: `${AUTH()}/api/v1/permissions`, qs: { tenant_id: TENANT() }, headers: authed(token) })
          .its("body")
          .then((perms: Array<{ Id: string; Resource: string; Action: string }>) => {
            const perm = perms.find((p) => p.Resource === resource && p.Action === action)!;
            cy.request({
              method: "POST",
              url: `${AUTH()}/api/v1/rbac/roles/permissions/assign`,
              headers: { ...authed(token), "Idempotency-Key": idempotencyKey() },
              body: { tenant_id: TENANT(), role_id: role.Id, permission_id: perm.Id },
            }).its("status").should("eq", 200);
          });
      });
    return cy.wrap(roleName);
  });
};

/** Completa y envía el formulario "Crear usuario". */
const fillUserForm = (email: string, password: string, role?: string) => {
  cy.get('[data-cy="user-identification"]').type(uniqueIdentificationNumber());
  cy.get('[data-cy="user-username"]').type(uniqueName("ga10-user"));
  cy.get('[data-cy="user-email"]').type(email);
  cy.get('[data-cy="user-password"]').type(password, { log: false });
  if (role) {
    cy.get('[data-cy="user-role"]').should("not.be.disabled").select(role);
  }
};

describe("GA10 - Validación funcional para el manual de usuario", () => {
  beforeEach(() => {
    cy.viewport(1280, 720);
  });

  after(() => {
    cy.writeFile("cypress/results/GA10-observaciones.json", obs);
  });

  // ------------------------------------------------------------------ 1. LOGIN
  describe("1. Inicio de sesión, navegación y cierre de sesión", () => {
    it("1.1 pantalla de login y validaciones de formulario", () => {
      cy.visit("/login");
      cy.contains("h2", "Login").should("be.visible");
      shot("C01-login-vacio");

      cy.contains("button", "Sign In").click();
      cy.contains("Tenant ID is required").should("be.visible");
      cy.contains("Enter a valid email").should("be.visible");
      cy.contains("Password is required").should("be.visible");
      shot("C02-login-validaciones-vacio");

      cy.get("#tenantId").type(TENANT());
      cy.get("#email").type("correo-invalido");
      cy.get("#password").type("x");
      cy.contains("button", "Sign In").click();
      cy.contains("Enter a valid email").should("be.visible");
      shot("C02b-login-email-invalido");
    });

    const failedLogin = (key: string, tenant: string, email: string, password: string) => {
      cy.intercept("POST", "**/api/v1/auth/login").as("login");
      uiLogin(email, password, tenant);
      cy.wait("@login").then((i) => {
        rec(`login.${key}.http`, { status: i.response?.statusCode, response: i.response?.body });
        expect(i.response?.statusCode).to.eq(401);
      });
      toasts().then((t) => {
        rec(`login.${key}.toasts`, t);
        expect(t.join(" ")).to.contain("Error de inicio de sesión");
        expect(t.join(" ")).to.contain("Credenciales incorrectas.");
        expect(t.join(" ")).not.to.contain("invalid credentials");
        expect(t.join(" ")).not.to.contain("Request failed with status code");
      });
      cy.location("pathname").should("eq", "/login");
    };

    it("1.2 contraseña incorrecta muestra \"Credenciales incorrectas.\"", () => {
      failedLogin("password_incorrecta", TENANT(), Cypress.env("AUTH_ADMIN_EMAIL"), "Incorrecta123!");
      shot("C03-login-credenciales-incorrectas");
    });

    it("1.3 tenant inexistente", () => {
      failedLogin("tenant_incorrecto", "tenant-que-no-existe", Cypress.env("AUTH_ADMIN_EMAIL"), Cypress.env("AUTH_ADMIN_PASSWORD"));
    });

    it("1.4 correo inexistente", () => {
      failedLogin("correo_inexistente", TENANT(), "no-existe@local.dev", "Incorrecta123!");
    });

    it("1.5 login correcto: redirección, barra de navegación y sesión persistente", () => {
      cy.intercept("POST", "**/api/v1/auth/login").as("login");
      uiLogin(Cypress.env("AUTH_ADMIN_EMAIL"), Cypress.env("AUTH_ADMIN_PASSWORD"));
      cy.wait("@login").its("response.statusCode").should("eq", 200);
      toasts().then((t) => {
        rec("login.correcto.toasts", t);
        expect(t.join(" ")).to.contain("Inicio de sesión exitoso");
      });
      cy.location("pathname").should("eq", "/invoicing/invoices");
      cy.get('[data-cy="invoice-row-customer"]').should("have.length.greaterThan", 0);

      cy.get('[data-cy="app-nav"]').should("be.visible");
      cy.get('[data-cy="nav-invoices"]').should("have.text", "Facturas");
      cy.get('[data-cy="nav-users"]').should("have.text", "Usuarios");
      cy.get('[data-cy="session-email"]').should("have.text", Cypress.env("AUTH_ADMIN_EMAIL"));
      cy.get('[data-cy="logout-button"]').should("contain.text", "Cerrar sesión");
      cy.get('[data-cy="app-nav"]').then(($n) => {
        const text = ($n[0] as HTMLElement).innerText;
        rec("navegacion.enlaces_admin", text);
        expect(text).not.to.match(/Tenants|Roles|Permissions|Invoice Items/);
      });
      shot("C04-login-exitoso-facturas");

      cy.reload();
      cy.location("pathname").should("eq", "/invoicing/invoices");
      cy.get('[data-cy="app-nav"]').should("be.visible");
    });

    it("1.6 navegación por el menú entre Facturas y Usuarios", () => {
      loginToUI();
      cy.visit("/");
      cy.location("pathname").should("eq", "/invoicing/invoices");
      cy.get('[data-cy="nav-users"]').click();
      cy.location("pathname").should("eq", "/admin/users");
      cy.contains("h3", "Crear usuario").should("be.visible");
      shot("C24-menu-usuarios");
      cy.get('[data-cy="nav-invoices"]').click();
      cy.location("pathname").should("eq", "/invoicing/invoices");
      cy.contains("h1", "Gestión de Facturas").should("be.visible");
    });

    it("1.7 cerrar sesión limpia la sesión y redirige al login", () => {
      uiLogin(Cypress.env("AUTH_ADMIN_EMAIL"), Cypress.env("AUTH_ADMIN_PASSWORD"));
      cy.location("pathname").should("eq", "/invoicing/invoices");
      cy.window().then((win) => expect(win.localStorage.getItem("auth-session-store")).to.contain("authenticated"));
      shot("C25-boton-cerrar-sesion");

      cy.get('[data-cy="logout-button"]').click();
      cy.location("pathname").should("eq", "/login");
      cy.contains("h2", "Login").should("be.visible");
      cy.window().then((win) => {
        const stored = win.localStorage.getItem("auth-session-store");
        rec("logout.localStorage_tras_cerrar", stored);
        expect(stored === null || !stored.includes("accessToken\":\"ey")).to.eq(true);
      });
      shot("C26-tras-cerrar-sesion");

      cy.visit("/invoicing/invoices");
      cy.location("pathname").should("eq", "/login");
    });

    it("1.8 rutas protegidas sin sesión redirigen al login", () => {
      cy.visit("/invoicing/invoices");
      cy.location("pathname").should("eq", "/login");
      cy.visit("/admin/users");
      cy.location("pathname").should("eq", "/login");
    });
  });

  // ---------------------------------------------------- 1b. EXPIRACIÓN DE SESIÓN
  describe("1b. Expiración de sesión", () => {
    const EXPIRED_MSG = "Tu sesión ha expirado. Inicia sesión nuevamente.";

    /** Modifica la sesión guardada antes de que cargue la aplicación. */
    const visitWithSession = (path: string, patch: Record<string, unknown>) => {
      loginToUI();
      cy.visit(path, {
        onBeforeLoad(win) {
          const raw = win.localStorage.getItem("auth-session-store")!;
          const stored = JSON.parse(raw);
          stored.state = { ...stored.state, ...patch };
          win.localStorage.setItem("auth-session-store", JSON.stringify(stored));
        },
      });
    };

    const expectExpiredRedirect = (key: string) => {
      cy.location("pathname", { timeout: 10000 }).should("eq", "/login");
      toasts().then((t) => {
        rec(`sesion_expirada.${key}.toasts`, t);
        expect(t.filter((x) => x.includes(EXPIRED_MSG))).to.have.length(1);
      });
      cy.contains("h2", "Login").should("be.visible");
      cy.window().then((win) => {
        const stored = win.localStorage.getItem("auth-session-store");
        expect(stored === null || !stored.includes('"status":"authenticated"')).to.eq(true);
      });
      // Sin bucles de redirección: sigue en /login.
      cy.wait(1500);
      cy.location("pathname").should("eq", "/login");
    };

    it("1b.1 sesión guardada ya vencida al abrir la aplicación", () => {
      visitWithSession("/invoicing/invoices", { expiresAt: Date.now() - 60_000 });
      expectExpiredRedirect("guardada_vencida");
      shot("C29-sesion-expirada");
    });

    it("1b.2 respuesta 401 del backend con token inválido", () => {
      cy.intercept("GET", "**/api/v1/roles*").as("roles");
      visitWithSession("/admin/users", {
        accessToken: "token.invalido.firma",
        expiresAt: Date.now() + 60 * 60_000,
      });
      cy.wait("@roles").its("response.statusCode").should("eq", 401);
      expectExpiredRedirect("respuesta_401");
    });

    it("1b.3 la sesión vence mientras se usa la aplicación", () => {
      visitWithSession("/invoicing/invoices", { expiresAt: Date.now() + 6_000 });
      cy.contains("h1", "Gestión de Facturas").should("be.visible");
      cy.location("pathname", { timeout: 15000 }).should("eq", "/login");
      expectExpiredRedirect("vence_en_uso");
    });
  });

  // -------------------------------------------------------------- 2. FACTURAS
  describe("2. Gestión de Facturas", () => {
    before(() => {
      // Garantiza más de 20 facturas, con montos distintos para el ordenamiento.
      const prices = [50, 975, 320, 10, 640, 1500, 75, 210, 880, 430, 1200, 5, 60, 70, 80, 90, 110, 120, 130, 140, 150, 160, 170, 180, 190];
      prices.forEach((price) => {
        createInvoice(INVOICE(), idempotencyKey(), {
          customer_id: uuid(),
          items: [{ item_id: uuid(), quantity: 1, unit_price: price, taxes: [{ code: "IVA", kind: "DEBIT", rate: 0.19 }] }],
        }).its("status").should("eq", 201);
      });
    });

    beforeEach(() => {
      loginToUI();
    });

    it("2.1 paginación por servidor con más de 20 facturas", () => {
      cy.intercept("GET", "**/api/v1/invoices*").as("list");
      cy.visit("/invoicing/invoices");
      cy.wait("@list").then((i) => {
        expect(i.request.url).to.contain("page=1").and.to.contain(`page_size=${PAGE_SIZE}`);
        rec("facturas.carga.request_url", i.request.url);
        rec("facturas.carga.x_total_count", i.response?.headers["x-total-count"]);
      });
      cy.get(ROWS).should("have.length", PAGE_SIZE);
      shot("C05-facturas-listado");

      backendTotal().then((total) => {
        rec("facturas.total_en_backend", total);
        expect(total).to.be.greaterThan(20);
        const pages = Math.ceil(total / PAGE_SIZE);
        const lastRows = total - (pages - 1) * PAGE_SIZE;
        rec("facturas.paginas_esperadas", pages);

        cy.get(".p-paginator-next").click();
        cy.wait("@list").its("request.url").should("contain", "page=2");
        cy.get(ROWS).should("have.length", PAGE_SIZE);
        shot("C06-facturas-pagina-2");

        cy.get(".p-paginator-last").click();
        cy.wait("@list").its("request.url").should("contain", `page=${pages}`);
        cy.get(ROWS).should("have.length", lastRows);
        shot("C06c-facturas-ultima-pagina");

        cy.get(".p-paginator-prev").click();
        cy.wait("@list").its("request.url").should("contain", `page=${pages - 1}`);

        cy.get(".p-paginator-first").click();
        cy.wait("@list").its("request.url").should("contain", "page=1");
      });

      cy.get(`${ROWS}:first button`).then(($btns) =>
        rec("facturas.acciones_por_fila", [...$btns].map((b) => b.getAttribute("title")))
      );
    });

    it("2.2 ordenamiento por Monto (página actual)", () => {
      cy.visit("/invoicing/invoices");
      cy.get(ROWS).should("have.length", PAGE_SIZE);
      const amounts = () =>
        cy.get(`${ROWS} td:nth-child(3)`).then(($c) =>
          [...$c].map((c) => Number((c as HTMLElement).innerText.replace(/[^0-9.]/g, "")))
        );
      cy.contains("th", "Monto").click();
      amounts().then((a) => {
        rec("facturas.orden_monto_asc", a);
        expect(a).to.deep.equal([...a].sort((x, y) => x - y));
      });
      shot("C07-facturas-orden-monto-asc");
      cy.contains("th", "Monto").click();
      amounts().then((a) => {
        rec("facturas.orden_monto_desc", a);
        expect(a).to.deep.equal([...a].sort((x, y) => y - x));
      });
      shot("C07b-facturas-orden-monto-desc");
    });

    it("2.3 crear factura: validaciones del formulario", () => {
      cy.visit("/invoicing/invoices");
      cy.contains("button", "Crear Factura").click();
      cy.get(".p-dialog").should("be.visible");
      cy.contains(".p-dialog label", "Rate (%)").should("exist");
      shot("C19-crear-factura-formulario");
      cy.contains(".p-dialog button", "Create Invoice").click();
      cy.contains(".p-dialog", "Customer ID is required").should("be.visible");
      cy.contains(".p-dialog", "Item ID is required").should("be.visible");
      cy.contains(".p-dialog", "Unit price must be > 0").should("be.visible");
      cy.get("#customerId").type("no-es-uuid");
      cy.get('[id="items.0.itemId"]').type("tampoco");
      cy.contains(".p-dialog button", "Create Invoice").click();
      cy.contains(".p-dialog", "Customer ID must be a valid UUID").should("be.visible");
      cy.contains(".p-dialog", "Item ID must be a valid UUID").should("be.visible");
      shot("C19b-crear-factura-validaciones");
    });

    it("2.4 crear factura: se guarda y aparece en el listado", () => {
      cy.intercept("POST", "**/api/v1/invoices").as("create");
      cy.intercept("GET", "**/api/v1/invoices*").as("list");
      cy.visit("/invoicing/invoices");
      cy.wait("@list");
      backendTotal().as("totalBefore");
      cy.contains("button", "Crear Factura").click();
      const customer = uuid();
      const item = uuid();
      cy.get("#customerId").type(customer);
      cy.get("#dueDate").type("2027-02-28T10:00");
      cy.get('[id="items.0.itemId"]').type(item);
      cy.get('[id="items.0.quantity"]').clear().type("2");
      cy.get('[id="items.0.unitPrice"]').clear().type("100");
      cy.get('[id="items.0.taxes.0.rate"]').clear().type("19");
      shot("C19c-crear-factura-diligenciado");
      cy.contains(".p-dialog button", "Create Invoice").click();

      cy.wait("@create").then((i) => {
        const body = i.request.body;
        const response = i.response?.body as InvoiceResponse;
        rec("crear.http", { request: body, status: i.response?.statusCode, response_total: response?.Total, response_id: response?.ID });
        expect(i.response?.statusCode).to.eq(201);
        expect(body).to.have.property("customer_id", customer);
        expect(body).not.to.have.property("customerId");
        expect(body.items[0]).to.include({ item_id: item, quantity: 2, unit_price: 100 });
        expect(body.items[0].taxes[0]).to.deep.equal({ code: "IVA", kind: "DEBIT", rate: 0.19 });
        expect(response.CustomerID).to.eq(customer);
        expect(response.Total).to.eq(238);
        cy.wrap(response.ID).as("createdId");
      });
      toasts().then((t) => {
        rec("crear.toasts", t);
        expect(t.join(" ")).to.contain("Factura creada correctamente");
      });
      cy.get(".p-dialog:visible").should("not.exist");
      cy.get<string>("@createdId").then((id) => {
        cy.contains(ROWS, invoiceNumber(id)).should("contain.text", customer).and("contain.text", "$238.00");
        shot("C19d-crear-factura-en-listado");
        cy.reload();
        cy.contains(ROWS, invoiceNumber(id)).should("contain.text", customer);
      });
      cy.get<number>("@totalBefore").then((before) => {
        backendTotal().should("eq", before + 1);
      });
    });

    it("2.5 editar factura Pendiente: cabecera e ítems (modificar y añadir) persisten tras recargar", () => {
      const customer = uuid();
      createInvoice(INVOICE(), idempotencyKey(), {
        customer_id: customer,
        items: [{ item_id: uuid(), quantity: 1, unit_price: 999, taxes: [{ code: "IVA", kind: "DEBIT", rate: 0.19 }] }],
      }).then((r) => {
        const id = r.body.ID;
        const newCustomer = uuid();
        const newItem = uuid();
        cy.intercept("PUT", "**/api/v1/invoices/*").as("update");
        cy.intercept("PUT", "**/api/v1/invoice-items/*").as("itemUpdate");
        cy.intercept("POST", "**/api/v1/invoice-items").as("itemCreate");
        cy.visit("/invoicing/invoices");
        cy.contains(ROWS, invoiceNumber(id)).within(() => {
          cy.get('button[title="Editar"]').should("not.be.disabled").click();
        });
        cy.get(".p-dialog").should("be.visible").and("contain.text", "Editar Factura");

        // Campos como los ve el usuario: cabecera e ítems editables; Issue Date e
        // Item ID de líneas ya guardadas bloqueados (el backend no los modifica).
        cy.get("#customerId").should("not.be.disabled");
        cy.get("#dueDate").should("not.be.disabled");
        cy.get("#issueDate").should("be.disabled");
        cy.get('[id="items.0.itemId"]').should("be.disabled");
        ["quantity", "unitPrice", "taxes.0.code", "taxes.0.kind", "taxes.0.rate"].forEach((f) =>
          cy.get(`[id="items.0.${f}"]`).should("not.be.disabled")
        );
        cy.contains(".p-dialog button", "Add Item").should("not.be.disabled");

        // Modificar como un usuario.
        cy.get("#customerId").should("have.value", customer).clear().type(newCustomer);
        cy.get("#dueDate").clear().type("2027-01-15T10:00");
        cy.get('[id="items.0.quantity"]').clear().type("3");
        cy.contains(".p-dialog button", "Add Item").click();
        cy.get('[id="items.1.itemId"]').should("not.be.disabled").type(newItem);
        cy.get('[id="items.1.quantity"]').clear().type("2");
        cy.get('[id="items.1.unitPrice"]').clear().type("50");
        shot("C20-editar-factura-formulario");
        cy.contains(".p-dialog button", "Update Invoice").click();

        cy.wait("@update").then((i) => {
          rec("editar.http_cabecera", { request: i.request.body, status: i.response?.statusCode });
          expect(i.response?.statusCode).to.eq(200);
          expect(i.request.body).to.deep.equal({ customer_id: newCustomer, due_date: new Date("2027-01-15T10:00").toISOString() });
        });
        cy.wait("@itemUpdate").then((i) => {
          rec("editar.http_item_actualizado", { request: i.request.body, status: i.response?.statusCode });
          expect(i.response?.statusCode).to.eq(200);
          expect(i.request.body).to.deep.include({ quantity: 3, unit_price: 999 });
        });
        cy.wait("@itemCreate").then((i) => {
          rec("editar.http_item_nuevo", { request: i.request.body, status: i.response?.statusCode });
          expect(i.response?.statusCode).to.eq(201);
          expect(i.request.body).to.deep.include({ invoice_id: id, item_id: newItem, quantity: 2, unit_price: 50 });
        });
        toasts().then((t) => {
          rec("editar.toasts", t);
          expect(t.join(" ")).to.contain("Factura actualizada correctamente");
        });
        cy.get(".p-dialog:visible").should("not.exist");
        // 3 × 999 + 19 % = 3566.43; 2 × 50 + 18 % = 118 → 3684.43
        cy.contains(ROWS, invoiceNumber(id)).should("contain.text", newCustomer).and("contain.text", "$3684.43");
        shot("C20b-editar-factura-resultado");

        cy.reload();
        cy.contains(ROWS, invoiceNumber(id)).should("contain.text", newCustomer).and("contain.text", "$3684.43").and("contain.text", "15/1/2027");
        getInvoice(id).then((inv) => {
          rec("editar.backend_despues", { CustomerID: inv.CustomerID, DueDate: inv.DueDate, Total: inv.Total, Items: inv.Items.length });
          expect(inv.CustomerID).to.eq(newCustomer);
          expect(new Date(inv.DueDate).toISOString()).to.eq(new Date("2027-01-15T10:00").toISOString());
          expect(inv.Items).to.have.length(2);
          expect(inv.Total).to.be.closeTo(3684.43, 0.001);
        });
      });
    });

    it("2.5b editar factura Pendiente: eliminar una línea", () => {
      createInvoice(INVOICE(), idempotencyKey(), {
        customer_id: uuid(),
        items: [
          { item_id: uuid(), quantity: 1, unit_price: 100 },
          { item_id: uuid(), quantity: 1, unit_price: 40 },
        ],
      }).then((r) => {
        const id = r.body.ID;
        cy.intercept("DELETE", "**/api/v1/invoice-items/*").as("itemDelete");
        cy.visit("/invoicing/invoices");
        cy.contains(ROWS, invoiceNumber(id)).within(() => cy.get('button[title="Editar"]').click());
        cy.contains(".p-dialog section", "Item 2").contains("button", "Remove").should("not.be.disabled").click();
        cy.contains(".p-dialog button", "Update Invoice").click();
        cy.wait("@itemDelete").its("response.statusCode").should("eq", 204);
        toasts().then((t) => expect(t.join(" ")).to.contain("Factura actualizada correctamente"));
        cy.reload();
        cy.contains(ROWS, invoiceNumber(id)).should("contain.text", "$100.00");
        getInvoice(id).then((inv) => {
          expect(inv.Items).to.have.length(1);
          expect(inv.Total).to.eq(100);
        });
      });
    });

    (["pay", "cancel"] as const).forEach((action) => {
      const label = action === "pay" ? "Pagada" : "Cancelada";
      const error = action === "pay" ? "invoice is already paid" : "invoice is already canceled";
      it(`2.5${action === "pay" ? "c" : "d"} factura ${label}: no editable en UI y rechazada en backend`, () => {
        createInvoice(INVOICE(), idempotencyKey(), {
          customer_id: uuid(),
          items: [{ item_id: uuid(), quantity: 1, unit_price: 100 }],
        }).then((r) => {
          const id = r.body.ID;
          const lineId = r.body.Items[0].ID;
          patchInvoice(id, action).its("status").should("eq", 200);
          cy.visit("/invoicing/invoices");
          cy.contains(ROWS, invoiceNumber(id)).should("contain.text", label);
          expectActionsClosed(invoiceNumber(id), label);
          shot(`C20e-editar-bloqueado-${label}`);

          // Intentos forzados contra el backend (sin pasar por la UI).
          const forced = [
            { method: "PUT", url: `${INVOICE()}/api/v1/invoices/${id}`, body: { customer_id: uuid(), due_date: "2027-12-31T00:00:00Z" } },
            { method: "POST", url: `${INVOICE()}/api/v1/invoice-items`, body: { invoice_id: id, item_id: uuid(), quantity: 1, unit_price: 5 } },
            { method: "PUT", url: `${INVOICE()}/api/v1/invoice-items/${lineId}`, body: { quantity: 9, unit_price: 9 } },
            { method: "DELETE", url: `${INVOICE()}/api/v1/invoice-items/${lineId}` },
          ];
          forced.forEach((req) => {
            cy.request({ ...req, headers: { "Idempotency-Key": idempotencyKey() }, failOnStatusCode: false }).then((res) => {
              expect(res.status, `${req.method} ${req.url}`).to.eq(422);
              expect(res.body).to.deep.equal({ error });
            });
          });
          getInvoice(id).then((inv) => {
            expect(inv.Status).to.eq(action === "pay" ? "PAID" : "CANCELED");
            expect(inv.Total).to.eq(100);
            expect(inv.Items).to.have.length(1);
          });
        });
      });
    });

    it("2.6 editar factura: si falla, el formulario sigue abierto y no hay éxito", () => {
      cy.visit("/invoicing/invoices");
      cy.contains(ROWS, "Pendiente").within(() => cy.get('button[title="Editar"]').click());
      // Validación de cliente: vencimiento anterior a la emisión.
      cy.get("#dueDate").clear().type("2000-01-01T10:00");
      cy.contains(".p-dialog button", "Update Invoice").click();
      cy.contains(".p-dialog", "Due date must be on or after issue date").should("be.visible");
      shot("C20c-editar-validacion-fechas");

      // Fallo de backend SIMULADO (cy.intercept devuelve 422 con mensaje).
      cy.intercept("PUT", "**/api/v1/invoices/*", {
        statusCode: 422,
        body: { error: "fallo simulado del backend" },
      }).as("updateFail");
      cy.get("#dueDate").clear().type("2027-06-30T10:00");
      cy.contains(".p-dialog button", "Update Invoice").click();
      cy.wait("@updateFail");
      cy.get(".p-dialog:visible").should("exist").and("contain.text", "fallo simulado del backend");
      toasts().then((t) => {
        rec("editar_fallo.toasts", t);
        expect(t.join(" ")).not.to.contain("Factura actualizada correctamente");
        expect(t.join(" ")).to.contain("fallo simulado del backend");
      });
      shot("C20d-editar-fallo-SIMULADO");
    });

    it("2.7 marcar como pagada (solo opciones reales; luego acciones bloqueadas)", () => {
      cy.intercept("PATCH", "**/api/v1/invoices/*/pay").as("pay");
      cy.visit("/invoicing/invoices");
      cy.contains(ROWS, "Pendiente").within(() => {
        cy.get("td:nth-child(1)").invoke("text").as("number", { type: "static" });
        cy.get('button[title="Cambiar estado"]').click();
      });
      cy.get(".p-dialog").then(($d) => {
        const text = ($d[0] as HTMLElement).innerText;
        rec("pagar.dialogo_opciones", text);
        expect(text).to.contain("Pagada").and.to.contain("Cancelada");
        expect(text).not.to.contain("Vencida");
      });
      shot("C09-cambiar-estado-pendiente");
      cy.contains(".p-dialog button", "Pagada").click();
      cy.wait("@pay").its("response.statusCode").should("eq", 200);
      toasts().then((t) => {
        rec("pagar.toasts", t);
        expect(t).to.have.length(1);
        expect(t[0]).to.contain("Factura marcada como pagada");
      });
      cy.get<string>("@number").then((n) => {
        cy.contains(ROWS, n.trim()).should("contain.text", "Pagada");
      });
      shot("C10-factura-pagada");

      // Una vez pagada, la fila ya no ofrece Editar, Cambiar estado ni Cancelar.
      cy.get<string>("@number").then((n) => expectActionsClosed(n.trim(), "Pagada"));
      shot("C11-acciones-bloqueadas-pagada");
    });

    it("2.8 pagar con fallo real del backend: solo mensaje de error", () => {
      cy.intercept("PATCH", "**/api/v1/invoices/*/pay").as("pay");
      cy.visit("/invoicing/invoices");
      cy.contains(ROWS, "Pendiente").within(() => {
        cy.get("td:nth-child(1)").invoke("text").as("number", { type: "static" });
      });
      cy.get<string>("@number").then((n) => {
        allInvoices().then((all) => patchInvoice(idFromNumber(all, n)!.ID, "pay").its("status").should("eq", 200));
        cy.contains(ROWS, n.trim()).within(() => cy.get('button[title="Cambiar estado"]').click());
      });
      cy.contains(".p-dialog button", "Pagada").click();
      cy.wait("@pay").then((i) => {
        rec("pagar_fallo.http", { status: i.response?.statusCode, response: i.response?.body });
        expect(i.response?.statusCode).to.eq(422);
      });
      toasts().then((t) => {
        rec("pagar_fallo.toasts", t);
        expect(t).to.have.length(1);
        expect(t[0]).to.contain("La factura ya se encuentra pagada.");
        expect(t[0]).not.to.contain("invoice is already paid");
        expect(t.join(" ")).not.to.contain("Factura marcada como pagada");
      });
      shot("C21-pagar-fallo-solo-error");
    });

    it("2.9 cancelar mediante el botón 'Cancelar'", () => {
      cy.intercept("PATCH", "**/api/v1/invoices/**").as("patch");
      cy.visit("/invoicing/invoices");
      cy.contains(ROWS, "Pendiente").find("button").then(($btns) => {
        const titles = [...$btns].map((b) => b.getAttribute("title"));
        rec("cancelar.tooltips_acciones", titles);
        expect(titles).to.deep.equal(["Editar", "Cambiar estado", "Cancelar"]);
      });
      cy.contains(ROWS, "Pendiente").within(() => {
        cy.get("td:nth-child(1)").invoke("text").as("number", { type: "static" });
        cy.get('button[title="Cancelar"]').click();
      });
      cy.get(".p-dialog").should("contain.text", "Cancelar factura").then(($d) => {
        const text = ($d[0] as HTMLElement).innerText;
        rec("cancelar.dialogo_texto", text);
        expect(text).to.contain("¿Estás seguro de que quieres cancelar la factura");
        expect(text).not.to.match(/eliminar/i);
      });
      cy.contains(".p-dialog button", "Volver").should("be.visible");
      shot("C12-dialogo-cancelar");
      cy.contains(".p-dialog button", "Cancelar factura").click();
      cy.wait("@patch").then((i) => {
        expect(i.request.url).to.match(/\/cancel$/);
        expect(i.response?.statusCode).to.eq(200);
      });
      toasts().then((t) => {
        rec("cancelar.toasts", t);
        expect(t).to.have.length(1);
        expect(t[0]).to.contain("Factura cancelada");
      });
      cy.get<string>("@number").then((n) => {
        cy.contains(ROWS, n.trim()).should("contain.text", "Cancelada");
      });
      shot("C13-factura-cancelada");
    });

    it("2.10 cancelar mediante 'Cambiar estado' → 'Cancelada'", () => {
      cy.intercept("PATCH", "**/api/v1/invoices/*/cancel").as("cancel");
      cy.visit("/invoicing/invoices");
      cy.contains(ROWS, "Pendiente").within(() => {
        cy.get("td:nth-child(1)").invoke("text").as("number", { type: "static" });
        cy.get('button[title="Cambiar estado"]').click();
      });
      cy.contains(".p-dialog button", "Cancelada").click();
      cy.wait("@cancel").its("response.statusCode").should("eq", 200);
      toasts().then((t) => {
        rec("cancelar_dialogo.toasts", t);
        expect(t).to.have.length(1);
        expect(t[0]).to.contain("Factura cancelada");
      });
      cy.get<string>("@number").then((n) => {
        cy.contains(ROWS, n.trim()).should("contain.text", "Cancelada");
        expectActionsClosed(n.trim(), "Cancelada");
      });
      shot("C11b-acciones-bloqueadas-cancelada");
    });

    it("2.11 cancelar con fallo real del backend: solo mensaje de error", () => {
      cy.intercept("PATCH", "**/api/v1/invoices/*/cancel").as("cancel");
      cy.visit("/invoicing/invoices");
      cy.contains(ROWS, "Pendiente").within(() => {
        cy.get("td:nth-child(1)").invoke("text").as("number", { type: "static" });
      });
      cy.get<string>("@number").then((n) => {
        allInvoices().then((all) => patchInvoice(idFromNumber(all, n)!.ID, "cancel").its("status").should("eq", 200));
        cy.contains(ROWS, n.trim()).within(() => cy.get('button[title="Cancelar"]').click());
      });
      cy.contains(".p-dialog button", "Cancelar factura").click();
      cy.wait("@cancel").then((i) => {
        rec("cancelar_fallo.http", { status: i.response?.statusCode, response: i.response?.body });
        expect(i.response?.statusCode).to.eq(422);
      });
      toasts().then((t) => {
        rec("cancelar_fallo.toasts", t);
        expect(t).to.have.length(1);
        expect(t[0]).to.contain("La factura ya se encuentra cancelada.");
        expect(t[0]).not.to.contain("invoice is already canceled");
        expect(t.join(" ")).not.to.contain("Factura cancelada");
      });
      shot("C22-cancelar-fallo-solo-error");
    });

    it("2.12 lista vacía (SIMULADA con cy.intercept, solo para captura)", () => {
      cy.intercept("GET", "**/api/v1/invoices*", { statusCode: 200, headers: { "x-total-count": "0" }, body: [] }).as("emptyList");
      cy.visit("/invoicing/invoices");
      cy.wait("@emptyList");
      cy.contains("No hay facturas registradas").should("be.visible");
      shot("C06b-facturas-lista-vacia-SIMULADA");
    });
  });

  // -------------------------------------------------------------- 3. USUARIOS
  describe("3. Gestión de usuarios, roles y permisos", () => {
    const adminRoleEmail = uniqueEmail("ga10-admin");
    const invoicingRoleEmail = uniqueEmail("ga10-facturacion");

    it("3.1 campos, validaciones y selector solo con roles que tienen permisos", () => {
      const emptyRole = uniqueName("ga10-rol-sin-permisos");
      loginAsAdmin().then((session) => {
        createRole(AUTH(), session.access_token, idempotencyKey(), {
          tenant_id: TENANT(),
          name: emptyRole,
          description: "Rol GA10 sin permisos",
        }).its("status").should("eq", 201);
        cy.wrap(session.access_token).as("token");
      });
      loginToUI();
      cy.visit("/admin/users");
      cy.get('[data-cy="user-role"]').should("not.be.disabled");
      cy.get('[data-cy="user-role"] option').then(($o) => {
        const names = [...$o].map((o) => (o as HTMLOptionElement).text).slice(1);
        rec("usuarios.roles_disponibles", names);
        expect(names).to.include("admin");
        expect(names).not.to.include(emptyRole);
        expect(names.some((n) => n.startsWith("cp-int-002-role"))).to.eq(false);
      });
      // Cada rol ofrecido tiene al menos un permiso según la API.
      cy.get<string>("@token").then((token) => {
        cy.get('[data-cy="user-role"] option').each(($opt) => {
          const roleId = ($opt[0] as HTMLOptionElement).value;
          if (!roleId) return;
          cy.request({
            url: `${AUTH()}/api/v1/rbac/roles/permissions`,
            qs: { tenant_id: TENANT(), role_id: roleId },
            headers: authed(token),
          }).its("body").should("have.length.greaterThan", 0);
        });
      });
      cy.contains("Mínimo 12 caracteres").should("be.visible");
      shot("C14-usuarios-formulario");
      cy.get('[data-cy="user-submit"]').click();
      ["Identification number is required", "Username is required", "Enter a valid email", "Password is required", "Role is required"].forEach((m) =>
        cy.contains(m).should("be.visible")
      );
      shot("C15-usuarios-validaciones");
    });

    it("3.2 contraseña débil muestra la regla en español", () => {
      loginToUI();
      cy.intercept("POST", "**/api/v1/users*").as("createUser");
      cy.visit("/admin/users");
      fillUserForm(uniqueEmail("ga10-debil"), "abc", "admin");
      cy.get('[data-cy="user-submit"]').click();
      cy.wait("@createUser").its("response.statusCode").should("eq", 400);
      toasts().then((t) => {
        rec("usuarios.password_debil.toasts", t);
        expect(t.join(" ")).to.contain("La contraseña debe tener al menos 12 caracteres.");
      });
      shot("C23-usuarios-error-password");
    });

    it("3.3 crear usuario con rol 'admin' y asignación real del rol", () => {
      loginToUI();
      cy.intercept("POST", "**/api/v1/users*").as("createUser");
      cy.intercept("POST", "**/api/v1/rbac/users/roles/assign").as("assignRole");
      cy.visit("/admin/users");
      fillUserForm(adminRoleEmail, PASSWORD, "admin");
      shot("C16a-usuarios-formulario-diligenciado");
      cy.get('[data-cy="user-submit"]').click();
      cy.wait("@createUser").its("response.statusCode").should("eq", 201);
      cy.wait("@assignRole").then((i) => {
        rec("usuarios.asignacion.http", { request: i.request.body, status: i.response?.statusCode });
        expect(i.response?.statusCode).to.eq(200);
      });
      toasts().then((t) => {
        rec("usuarios.creacion.toasts", t);
        expect(t.join(" ")).to.contain('El usuario se creó correctamente con el rol "admin".');
      });
      cy.get('[data-cy="user-email"]').should("have.value", "");
      shot("C16-usuarios-creado");

      loginAsAdmin().then((session) => {
        getUserByEmail(AUTH(), session.access_token, TENANT(), adminRoleEmail).then((u) => {
          cy.request({
            url: `${AUTH()}/api/v1/rbac/users/roles`,
            qs: { tenant_id: TENANT(), user_id: u.body.Id },
            headers: authed(session.access_token),
          }).then((r) => {
            rec("usuarios.creacion.roles_asignados", r.body);
            expect(r.body.map((x: { RoleId: string }) => x.RoleId)).to.include(`${TENANT()}-admin-role`);
          });
        });
      });
    });

    it("3.4 correo duplicado", () => {
      loginToUI();
      cy.intercept("POST", "**/api/v1/users*").as("createUser");
      cy.visit("/admin/users");
      fillUserForm(adminRoleEmail, PASSWORD, "admin");
      cy.get('[data-cy="user-submit"]').click();
      cy.wait("@createUser").its("response.statusCode").should("eq", 409);
      toasts().then((t) => {
        rec("usuarios.duplicado.toasts", t);
        expect(t.join(" ")).to.contain("Ya existe un usuario registrado con este correo electrónico.");
      });
      shot("C17-usuarios-email-duplicado");
    });

    it("3.5 el usuario creado con rol 'admin' ingresa y ve Facturas y Usuarios", () => {
      cy.intercept("POST", "**/api/v1/auth/login").as("login");
      uiLogin(adminRoleEmail, PASSWORD);
      cy.wait("@login").then((i) => {
        rec("usuarios.login_admin.roles", i.response?.body.roles);
        expect(i.response?.body.roles).to.include("admin");
      });
      cy.location("pathname").should("eq", "/invoicing/invoices");
      cy.get('[data-cy="nav-invoices"]').should("be.visible");
      cy.get('[data-cy="nav-users"]').should("be.visible");
    });

    it("3.6 rol solo con permiso de facturación: navegación según permisos", () => {
      createRoleWithPermission("invoices", "*").then((roleName) => {
        rec("usuarios.rol_facturacion", roleName);
      }).as("roleName");
      loginToUI();
      cy.visit("/admin/users");
      cy.get<string>("@roleName").then((roleName) => {
        fillUserForm(invoicingRoleEmail, PASSWORD, roleName);
      });
      cy.get('[data-cy="user-submit"]').click();
      toasts().then((t) => expect(t.join(" ")).to.contain("El usuario se creó correctamente con el rol"));

      cy.clearLocalStorage();
      uiLogin(invoicingRoleEmail, PASSWORD);
      cy.location("pathname").should("eq", "/invoicing/invoices");
      cy.get('[data-cy="nav-invoices"]').should("be.visible");
      cy.get('[data-cy="nav-users"]').should("not.exist");
      cy.get('[data-cy="invoice-row-customer"]').should("have.length.greaterThan", 0);
      shot("C27-navegacion-rol-facturacion");
      cy.visit("/admin/users");
      cy.contains("Tu usuario no tiene permisos para esta sección.").should("be.visible");
      shot("C28-sin-permiso-usuarios");
    });

    it("3.7 usuario sin roles: acceso denegado sin quedar atrapado", () => {
      const email = uniqueEmail("ga10-sin-rol");
      loginAsAdmin().then((session) => {
        createUser(AUTH(), session.access_token, idempotencyKey(), {
          tenant_id: TENANT(),
          identification_number: uniqueIdentificationNumber(),
          username: uniqueName("ga10-sin-rol"),
          email,
          password: PASSWORD,
        }).its("status").should("eq", 201);
      });
      uiLogin(email, PASSWORD);
      toasts().then((t) => {
        rec("usuarios.sin_rol.toasts", t);
        expect(t.join(" ")).to.contain("Tu usuario no tiene permisos asignados para ingresar.");
        expect(t.join(" ")).not.to.contain("Inicio de sesión exitoso");
      });
      cy.location("pathname").should("eq", "/login");
      cy.get("#tenantId").should("be.visible");
      shot("C18-usuario-sin-permisos");
    });
  });

  // ---------------------------------------------------- 4. PÁGINAS INCOMPLETAS
  describe("4. Páginas sin funcionalidad (no enlazadas en el menú)", () => {
    beforeEach(() => loginToUI());

    const pages = [
      ["/admin/tenants", "tenants"],
      ["/admin/roles", "roles"],
      ["/admin/permissions", "permissions"],
      ["/invoicing/invoice-items", "invoice-items"],
      ["/ruta-inexistente", "ruta-inexistente"],
    ] as const;

    pages.forEach(([path, key]) => {
      it(`página ${path}`, () => {
        cy.visit(path, { failOnStatusCode: false });
        cy.wait(1500);
        cy.get("body").then(($b) =>
          rec(`paginas.${key}`, {
            texto: ($b[0] as HTMLElement).innerText.trim(),
            botones_fuera_del_menu: $b.find("main button, section button").length,
            inputs: $b.find("input, select, textarea").length,
          })
        );
        shot(`P-${key}`);
      });
    });
  });
});
