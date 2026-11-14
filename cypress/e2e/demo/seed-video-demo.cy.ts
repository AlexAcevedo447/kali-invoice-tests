import { createTenant, createUser, getUserByEmail, login, type TenantResponse } from "../../support/api/auth/auth-client";
import { ensureRoleWithPermissions } from "../../support/api/auth/rbac";
import { loginAsAdmin } from "../../support/api/auth/session";
import {
  createCustomer,
  createInvoice,
  createProduct,
  type CustomerResponse,
  type InvoiceResponse,
  type ProductResponse,
} from "../../support/api/invoice/invoice-client";
import { idempotencyKey, uniqueIdentificationNumber } from "../../support/data/unique";

/**
 * Semilla de datos para grabar la evidencia SENA (no es una prueba funcional).
 *
 * Es REPETIBLE y CONVERGENTE: cada ejecución deja la empresa demo en el mismo
 * estado final sin borrar ni sobrescribir datos existentes.
 * - Empresa demo y su administrador: si DEMO_ADMIN_EMAIL no puede iniciar
 *   sesión, se crean con el administrador de plataforma (AUTH_ADMIN_*): empresa
 *   "Empresa Demo" (código "demo"), usuario y rol "invoicing". Lo que ya existe
 *   se reutiliza.
 * - Catálogo: cada cliente (por documento) y producto (por código) se busca
 *   antes de crearlo; un 409 se resuelve buscando el existente.
 * - Facturas: para cada paso del guion se busca una factura de la empresa con
 *   el mismo cliente, producto y cantidad. Si existe y ya tiene el estado
 *   esperado, se reutiliza; si sigue PENDING y el guion la paga/cancela, se le
 *   aplica la acción; si no existe, se crea. Nunca se duplica ni se elimina.
 *
 *   npx cypress run --browser electron --spec cypress/e2e/demo/seed-video-demo.cy.ts
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");

const DEMO_TENANT = { name: "Empresa Demo", code: "demo" };
const DEMO_ROLE = "invoicing"; // el frontend habilita Facturación con este rol

const CUSTOMERS = [
  { name: "Comercial Andina S.A.S.", document: "900123456-1" },
  { name: "Distribuciones del Caribe Ltda.", document: "800765432-5" },
  { name: "Tecnología Paisa S.A.S.", document: "901234567-8" },
  { name: "Ferretería El Progreso", document: "71234567" },
  { name: "Servicios Integrales del Sur", document: "830456789-2" },
];

const PRODUCTS = [
  { code: "SRV-CONS", name: "Consultoría por hora", unit_price: 150000 },
  { code: "LIC-ANUAL", name: "Licencia anual de software", unit_price: 1200000 },
  { code: "SOP-MENS", name: "Soporte técnico mensual", unit_price: 350000 },
  { code: "CAP-HR", name: "Capacitación por hora", unit_price: 95000 },
];

const IVA = [{ code: "IVA", kind: "DEBIT", rate: 0.19 }];

// Se crean en orden inverso: el listado muestra primero la más reciente.
const PLAN = [
  { customer: 4, product: 3, quantity: 4, action: "cancel", status: "CANCELED" },
  { customer: 3, product: 1, quantity: 1, action: "pay", status: "PAID" },
  { customer: 2, product: 2, quantity: 1, action: null, status: "PENDING" },
  { customer: 1, product: 0, quantity: 1, action: null, status: "PENDING" },
  { customer: 0, product: 0, quantity: 2, action: null, status: "PENDING" },
] as const;

const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

const get = <T>(token: string, url: string, qs?: Record<string, unknown>) =>
  cy.request<T>({ method: "GET", url, qs, headers: authed(token), failOnStatusCode: false });

/** Busca o crea la empresa demo (solo el tenant de plataforma puede hacerlo). */
const ensureDemoTenant = (ptoken: string): Cypress.Chainable<TenantResponse> =>
  get<TenantResponse[]>(ptoken, `${AUTH()}/api/v1/tenants/`).then((list) => {
    expect(list.status, "listar empresas").to.eq(200);
    const found = list.body.find((t) => t.Code === DEMO_TENANT.code);
    if (found) return cy.wrap(found);
    return createTenant(AUTH(), ptoken, DEMO_TENANT).then((created) => {
      expect(created.status, "empresa demo creada").to.eq(201);
      return created.body;
    });
  });

/**
 * Permisos del rol "invoicing" (MATRIZ_PERMISOS.md): con la autorización por
 * operación de facturación, el rol solo funciona si tiene estos permisos.
 */
const INVOICING_GRANTS: Array<[string, string]> = [
  ["invoices", "manage"],
  ["invoice-items", "manage"],
  ["customers", "manage"],
  ["products", "manage"],
];

/** Busca o crea el rol "invoicing" en la empresa demo y completa sus permisos (idempotente). */
const ensureDemoRole = (ptoken: string, tenantId: string): Cypress.Chainable<string> =>
  ensureRoleWithPermissions(AUTH(), ptoken, tenantId, DEMO_ROLE, INVOICING_GRANTS, "Acceso al módulo de facturación (empresa demo)").then(
    (role) => role.Id
  );

/**
 * Si la empresa demo ya existe, completa los permisos de su rol "invoicing"
 * (empresas demo creadas antes de la autorización por operación).
 */
const ensureExistingDemoRolePermissions = (): void => {
  loginAsAdmin().then((platform) =>
    get<TenantResponse[]>(platform.access_token, `${AUTH()}/api/v1/tenants/`).then((list) => {
      const demo = list.body.find((t) => t.Code === DEMO_TENANT.code);
      if (!demo) return;
      cy
        .request<Array<{ Id: string; Name: string }>>({
          url: `${AUTH()}/api/v1/roles`,
          qs: { tenant_id: demo.Id },
          headers: authed(platform.access_token),
        })
        .then((roles) => {
          if (roles.body.some((r) => r.Name.toLowerCase() === DEMO_ROLE)) ensureDemoRole(platform.access_token, demo.Id);
        });
    })
  );
};

/**
 * Devuelve un token del administrador demo. Si aún no puede iniciar sesión,
 * crea lo que falte (empresa, usuario, rol y asignación) sin tocar lo existente.
 */
const ensureDemoSession = (email: string, password: string): Cypress.Chainable<string> =>
  login(AUTH(), { email, password }).then((first) => {
    if (first.status === 200) return cy.wrap(first.body.access_token);
    expect(first.status, "el administrador demo aún no existe o requiere aprovisionamiento").to.eq(401);

    return loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      return ensureDemoTenant(ptoken).then((tenant) => {
        createUser(AUTH(), ptoken, idempotencyKey(), {
          tenant_id: tenant.Id,
          identification_number: uniqueIdentificationNumber(),
          username: "admin.demo",
          email,
          password,
        }).then((u) => {
          // 409: el usuario ya existía en la empresa demo; no se modifica su contraseña.
          expect([201, 409], "usuario administrador demo").to.include(u.status);
        });
        return ensureDemoRole(ptoken, tenant.Id).then((roleId) =>
          getUserByEmail(AUTH(), ptoken, tenant.Id, email).then((user) => {
            expect(user.status, "usuario demo encontrado").to.eq(200);
            return cy
              .request({
                method: "POST",
                url: `${AUTH()}/api/v1/rbac/users/roles/assign`,
                headers: { ...authed(ptoken), "Idempotency-Key": idempotencyKey() },
                body: { tenant_id: tenant.Id, user_id: user.body.Id, role_id: roleId },
                failOnStatusCode: false,
              })
              .then((assign) => {
                expect([200, 201, 204, 409], "rol invoicing asignado").to.include(assign.status);
                return login(AUTH(), { email, password }).then((second) => {
                  expect(
                    second.status,
                    "login demo tras aprovisionar (si es 401, el usuario ya existía con otra contraseña)"
                  ).to.eq(200);
                  return second.body.access_token;
                });
              });
          })
        );
      });
    });
  });

const ensureCustomer = (token: string, c: (typeof CUSTOMERS)[number]): Cypress.Chainable<CustomerResponse> => {
  const find = () =>
    get<CustomerResponse[]>(token, `${INVOICE()}/api/v1/customers`, { search: c.document, page_size: 100 }).then(
      (r) => {
        expect(r.status, `buscar cliente ${c.document}`).to.eq(200);
        return cy.wrap<CustomerResponse | null>(r.body.find((x) => x.Document === c.document) ?? null);
      }
    );
  return find().then((existing) => {
    if (existing) return cy.wrap(existing);
    return createCustomer(INVOICE(), token, c).then((r) => {
      expect([201, 409], `cliente ${c.name}`).to.include(r.status);
      if (r.status === 201) return r.body;
      return find().then((again) => {
        expect(again, `cliente ${c.document} existente`).to.exist;
        return again!;
      });
    });
  });
};

const ensureProduct = (token: string, p: (typeof PRODUCTS)[number]): Cypress.Chainable<ProductResponse> => {
  const find = () =>
    get<ProductResponse[]>(token, `${INVOICE()}/api/v1/products`, { search: p.code, page_size: 100 }).then((r) => {
      expect(r.status, `buscar producto ${p.code}`).to.eq(200);
      return cy.wrap<ProductResponse | null>(r.body.find((x) => x.Code === p.code) ?? null);
    });
  return find().then((existing) => {
    if (existing) return cy.wrap(existing);
    return createProduct(INVOICE(), token, p).then((r) => {
      expect([201, 409], `producto ${p.code}`).to.include(r.status);
      if (r.status === 201) return r.body;
      return find().then((again) => {
        expect(again, `producto ${p.code} existente`).to.exist;
        return again!;
      });
    });
  });
};

/** Todas las facturas de la empresa (pagina con X-Total-Count). */
const listAllInvoices = (token: string, page = 1, acc: InvoiceResponse[] = []): Cypress.Chainable<InvoiceResponse[]> =>
  get<InvoiceResponse[]>(token, `${INVOICE()}/api/v1/invoices`, { page, page_size: 100 }).then((r) => {
    expect(r.status, "listar facturas de la empresa demo").to.eq(200);
    const all = acc.concat(r.body);
    const total = Number(r.headers["x-total-count"] ?? all.length);
    if (r.body.length === 0 || all.length >= total) return cy.wrap(all);
    return listAllInvoices(token, page + 1, all);
  });

const applyAction = (token: string, invoiceId: string, action: "pay" | "cancel") =>
  cy
    .request({
      method: "PATCH",
      url: `${INVOICE()}/api/v1/invoices/${invoiceId}/${action}`,
      headers: { ...authed(token), "Idempotency-Key": idempotencyKey() },
    })
    .its("status")
    .should("eq", 200);

/**
 * Datos de los pasos 4 y 10 del guion (Guion_video.md): una segunda empresa,
 * un correo con la misma contraseña en dos empresas (login con código de
 * empresa) y un usuario sin roles ("Sin acceso a módulos"). Credenciales
 * ficticias, solo para el entorno local.
 */
const NORTE_TENANT = { name: "Empresa Norte", code: "norte" };
const SHARED_USER = { username: "contador", email: "contador@local.dev", password: "Contador#Local2026" };
const NO_ROLE_USER = { username: "sin.permisos", email: "sin.permisos@local.dev", password: "SinPermisos#Local2026" };

const ensureTenant = (ptoken: string, wanted: { name: string; code: string }): Cypress.Chainable<TenantResponse> =>
  get<TenantResponse[]>(ptoken, `${AUTH()}/api/v1/tenants/`).then((list) => {
    expect(list.status, "listar empresas").to.eq(200);
    const found = list.body.find((t) => t.Code === wanted.code);
    if (found) return cy.wrap(found);
    return createTenant(AUTH(), ptoken, wanted).then((created) => {
      expect(created.status, `empresa ${wanted.code} creada`).to.eq(201);
      return created.body;
    });
  });

/** Crea el usuario si falta; si ya existe (409) no lo modifica. */
const ensureUser = (ptoken: string, tenantId: string, user: typeof SHARED_USER) =>
  createUser(AUTH(), ptoken, idempotencyKey(), {
    tenant_id: tenantId,
    identification_number: uniqueIdentificationNumber(),
    username: user.username,
    email: user.email,
    password: user.password,
  }).then((r) => expect([201, 409], `usuario ${user.email}`).to.include(r.status));

describe("Semilla de datos para el video (empresa demo)", () => {
  it("deja los usuarios y la segunda empresa del guion (pasos 4 y 10, repetible)", () => {
    loginAsAdmin().then((platform) => {
      const ptoken = platform.access_token;
      ensureTenant(ptoken, DEMO_TENANT).then((demo) =>
        ensureTenant(ptoken, NORTE_TENANT).then((norte) => {
          ensureUser(ptoken, demo.Id, SHARED_USER);
          ensureUser(ptoken, norte.Id, SHARED_USER);
          ensureUser(ptoken, demo.Id, NO_ROLE_USER);
        })
      );
    });
    // Estado final verificable (si un usuario ya existía con otra contraseña, falla aquí).
    login(AUTH(), { email: SHARED_USER.email, password: SHARED_USER.password }).then((r) =>
      expect(r.status, "mismo correo en dos empresas: pide código de empresa").to.eq(409)
    );
    login(AUTH(), { email: SHARED_USER.email, password: SHARED_USER.password, tenant_code: NORTE_TENANT.code }).then((r) =>
      expect(r.status, "ingreso con el código norte").to.eq(200)
    );
    login(AUTH(), { email: NO_ROLE_USER.email, password: NO_ROLE_USER.password }).then((r) =>
      expect(r.status, "usuario sin roles inicia sesión").to.eq(200)
    );
  });

  it("deja la empresa demo con su catálogo y las cinco facturas del guion (repetible)", () => {
    const email = Cypress.env("DEMO_ADMIN_EMAIL");
    const password = Cypress.env("DEMO_ADMIN_PASSWORD");
    expect(email, "DEMO_ADMIN_EMAIL configurado").to.be.a("string").and.not.be.empty;
    expect(password, "DEMO_ADMIN_PASSWORD configurado").to.be.a("string").and.not.be.empty;

    ensureExistingDemoRolePermissions();
    ensureDemoSession(email, password).then((token) => {
      const customers: CustomerResponse[] = [];
      const products: ProductResponse[] = [];
      CUSTOMERS.forEach((c, i) => ensureCustomer(token, c).then((x) => (customers[i] = x)));
      PRODUCTS.forEach((p, i) => ensureProduct(token, p).then((x) => (products[i] = x)));

      listAllInvoices(token).then((existing) => {
        const used = new Set<string>();
        let created = 0;
        let reused = 0;

        PLAN.forEach((step) => {
          const customer = customers[step.customer];
          const product = products[step.product];
          const isSameLine = (inv: InvoiceResponse) =>
            inv.CustomerID === customer.ID &&
            inv.Items.length === 1 &&
            inv.Items[0].ItemID === product.ID &&
            inv.Items[0].Quantity === step.quantity;
          // Primero una con el estado final esperado; si no, una PENDING que
          // aún pueda llevarse a ese estado (ejecución previa interrumpida).
          const match =
            existing.find((inv) => !used.has(inv.ID) && isSameLine(inv) && inv.Status === step.status) ??
            (step.action
              ? existing.find((inv) => !used.has(inv.ID) && isSameLine(inv) && inv.Status === "PENDING")
              : undefined);

          if (match) {
            used.add(match.ID);
            reused += 1;
            if (match.Status !== step.status && step.action) applyAction(token, match.ID, step.action);
            return;
          }

          createInvoice(
            INVOICE(),
            idempotencyKey(),
            {
              customer_id: customer.ID,
              items: [{ item_id: product.ID, quantity: step.quantity, unit_price: product.UnitPrice, taxes: IVA }],
            },
            token
          ).then((r) => {
            expect(r.status, "factura del guion creada").to.eq(201);
            used.add(r.body.ID);
            created += 1;
            if (step.action) applyAction(token, r.body.ID, step.action);
          });
          cy.wait(1100); // created_at distinto para fijar el orden del listado
        });

        cy.then(() => cy.log(`Facturas del guion: ${created} creadas, ${reused} reutilizadas`));
      });

      // Estado final verificable: las cinco facturas del guion existen con su estado.
      listAllInvoices(token).then((all) => {
        PLAN.forEach((step) => {
          const customer = customers[step.customer];
          const product = products[step.product];
          const found = all.some(
            (inv) =>
              inv.CustomerID === customer.ID &&
              inv.Items.length === 1 &&
              inv.Items[0].ItemID === product.ID &&
              inv.Items[0].Quantity === step.quantity &&
              inv.Status === step.status
          );
          expect(found, `factura ${customer.Name} / ${product.Code} x${step.quantity} en ${step.status}`).to.eq(true);
        });
      });
    });
  });
});
