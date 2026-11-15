import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { ensureRoleWithPermissions, grantRoleToUserByEmail } from "../../../support/api/auth/rbac";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-INT-015 - Política de contraseñas en caracteres Unicode (regresión del
 * hallazgo M-08 de la evidencia AA3-EV02). El mínimo de 12 se cuenta en
 * caracteres (code points), no en bytes; las contraseñas nuevas se guardan con
 * Argon2id y se verifican completas (también por encima de 72 bytes).
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const TOO_SHORT = "password must have at least 12 characters";

describe("CP-INT-015 - Contraseñas: mínimo en caracteres Unicode", () => {
  let ptoken = "";
  let tenantId = "";
  let atoken = "";
  const adminEmail = uniqueEmail("cp-int-015-admin");
  const ADMIN_PASSWORD = "Admin#Clave2026";

  before(() => {
    loginAsAdmin().then((p) => {
      ptoken = p.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-int-015") }).then((t) => {
        tenantId = t.body.Id;
        createUser(AUTH(), ptoken, idempotencyKey(), {
          tenant_id: tenantId,
          identification_number: uniqueIdentificationNumber(),
          username: "admin-cp15",
          email: adminEmail,
          password: ADMIN_PASSWORD,
        }).its("status").should("eq", 201);
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "administrador", [["*", "*"]]).then((role) =>
          grantRoleToUserByEmail(AUTH(), ptoken, tenantId, adminEmail, role.Id)
        );
        login(AUTH(), { email: adminEmail, password: ADMIN_PASSWORD }).then((s) => (atoken = s.body.access_token));
      });
    });
  });

  const create = (password: string) => {
    const email = uniqueEmail("cp-int-015");
    return createUser(AUTH(), ptoken, idempotencyKey(), {
      tenant_id: tenantId,
      identification_number: uniqueIdentificationNumber(),
      username: uniqueName("cp15").slice(0, 30),
      email,
      password,
    }).then((r) => ({ r, email }));
  };

  it("rechaza 11 caracteres aunque ocupen 12 bytes o más (ñ, tildes, emoji)", () => {
    ["Ñandú#Clav1", "Clave#2026😀", "Clave#2026a"].forEach((password) =>
      create(password).then(({ r }) => {
        expect(r.status, password).to.eq(400);
        expect((r.body as { error: string }).error, password).to.eq(TOO_SHORT);
      })
    );
  });

  it("acepta 12 caracteres con ñ, tildes o emoji y permite iniciar sesión", () => {
    ["Ñandú#Clave1", "Clave#2026😀x"].forEach((password) =>
      create(password).then(({ r, email }) => {
        expect(r.status, password).to.eq(201);
        login(AUTH(), { email, password }).its("status").should("eq", 200);
      })
    );
  });

  it("verifica la contraseña completa por encima de 72 bytes (sin truncamiento)", () => {
    const password = `Ñandú#Clave1${"ñ".repeat(40)}`; // 94 bytes
    expect(new TextEncoder().encode(password).length).to.be.greaterThan(72);
    create(password).then(({ r, email }) => {
      expect(r.status).to.eq(201);
      login(AUTH(), { email, password }).its("status").should("eq", 200);
      // Coincide en los primeros 72 bytes pero no completa: debe fallar.
      const bytes = new TextEncoder().encode(password).slice(0, 72);
      const prefix = new TextDecoder().decode(bytes);
      login(AUTH(), { email, password: `${prefix}x` }).its("status").should("eq", 401);
    });
  });

  it("al editar aplica la misma regla y una edición sin contraseña conserva la actual", () => {
    create("Ñandú#Clave1").then(({ r, email }) => {
      const id = (r.body as { Id: string }).Id;
      const put = (body: Record<string, string>) =>
        cy.request({
          method: "PUT",
          url: `${AUTH()}/api/v1/users/${id}`,
          body,
          headers: { Authorization: `Bearer ${atoken}`, "Idempotency-Key": idempotencyKey() },
          failOnStatusCode: false,
        });
      put({ email, password: "Ñandú#Clav1" }).then((u) => {
        expect(u.status).to.eq(400);
        expect(u.body.error).to.eq(TOO_SHORT);
      });
      put({ email }).its("status").should("eq", 200);
      login(AUTH(), { email, password: "Ñandú#Clave1" }).its("status").should("eq", 200);
    });
  });
});
