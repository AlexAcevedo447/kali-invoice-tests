import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-INT-008 - Login multiempresa.
 *
 * El mismo correo y contraseña existen en dos empresas (A y B). Sin código de
 * empresa el servidor no puede elegir: responde 409 "company code required".
 * Con `tenant_code` (código legible, sin distinguir mayúsculas ni espacios)
 * resuelve la empresa indicada; un código que no corresponde responde 401.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const PASSWORD = "Multi!Empresa2026";

const shortCode = (label: string) =>
  `cp8-${label}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.toLowerCase();

describe("CP-INT-008 - Login multiempresa (mismo correo en dos empresas)", () => {
  const email = uniqueEmail("cp-int-008");
  const tenants: Record<"A" | "B", { id: string; code: string }> = {} as never;

  before(() => {
    loginAsAdmin().then((platform) => {
      (["A", "B"] as const).forEach((label) => {
        const code = shortCode(label.toLowerCase());
        createTenant(AUTH(), platform.access_token, { name: uniqueName(`cp-int-008-${label}`), code }).then((t) => {
          expect(t.status, `empresa ${label} creada`).to.eq(201);
          expect(t.body.Code).to.eq(code);
          tenants[label] = { id: t.body.Id, code };
          createUser(AUTH(), platform.access_token, idempotencyKey(), {
            tenant_id: t.body.Id,
            identification_number: uniqueIdentificationNumber(),
            username: uniqueName(`cp-int-008-user-${label}`),
            email,
            password: PASSWORD,
          })
            .its("status")
            .should("eq", 201);
        });
      });
    });
  });

  it("sin código de empresa responde 409 company code required", () => {
    login(AUTH(), { email, password: PASSWORD }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body).to.deep.eq({ error: "company code required" });
    });
  });

  it("con tenant_code resuelve la empresa indicada (normaliza mayúsculas y espacios)", () => {
    (["A", "B"] as const).forEach((label) => {
      const { id, code } = tenants[label];
      login(AUTH(), { email, password: PASSWORD, tenant_code: `  ${code.toUpperCase()} ` }).then((r) => {
        expect(r.status, `login en empresa ${label}`).to.eq(200);
        expect(r.body.tenant_id).to.eq(id);
        expect(r.body.tenant_code).to.eq(code);
        expect(r.body.access_token).to.be.a("string").and.not.be.empty;
      });
    });
  });

  it("un código que no corresponde a la cuenta responde 401 invalid credentials", () => {
    login(AUTH(), { email, password: PASSWORD, tenant_code: "no-existe-cp8" }).then((r) => {
      expect(r.status).to.eq(401);
      expect(r.body).to.deep.eq({ error: "invalid credentials" });
    });
  });

  it("contraseña incorrecta con código válido responde 401", () => {
    login(AUTH(), { email, password: "Incorrecta!2026", tenant_code: tenants.A.code }).then((r) => {
      expect(r.status).to.eq(401);
    });
  });

  it("el administrador de plataforma no puede editar una empresa con un código ya usado (409)", () => {
    loginAsAdmin().then((platform) => {
      const headers = { Authorization: `Bearer ${platform.access_token}` };
      // PUT reemplaza la empresa completa: se envían sus datos actuales y solo cambia el código.
      cy.request<{ Name: string; Status: string }>({ url: `${AUTH()}/api/v1/tenants/${tenants.B.id}`, headers }).then(
        (current) => {
          cy.request({
            method: "PUT",
            url: `${AUTH()}/api/v1/tenants/${tenants.B.id}`,
            headers: { ...headers, "Idempotency-Key": idempotencyKey() },
            body: { name: current.body.Name, status: current.body.Status, code: tenants.A.code },
            failOnStatusCode: false,
          }).then((r) => {
            expect(r.status).to.eq(409);
            expect(r.body).to.deep.eq({ error: "tenant code already exists" });
          });
          // La empresa B conserva su código original.
          cy.request<{ Code: string }>({ url: `${AUTH()}/api/v1/tenants/${tenants.B.id}`, headers })
            .its("body.Code")
            .should("eq", tenants.B.code);
        }
      );
    });
  });
});
