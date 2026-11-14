import { createUser } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import {
  idempotencyKey,
  uniqueEmail,
  uniqueIdentificationNumber,
  uniqueName,
} from "../../../support/data/unique";
import { captureEvidence } from "../../../support/evidence";

describe("CP-INT-003 - Crear usuario", () => {
  it("crea un usuario nuevo con payload válido y sin exponer la contraseña", () => {
    loginAsAdmin().then((session) => {
      createUser(Cypress.env("AUTH_API_URL"), session.access_token, idempotencyKey(), {
        tenant_id: Cypress.env("AUTH_TENANT_ID"),
        identification_number: uniqueIdentificationNumber(),
        username: uniqueName("cp-int-003-user"),
        email: uniqueEmail("cp-int-003"),
        password: "Str0ng!Passw0rd",
      }).then((response) => {
        expect(response.status).to.eq(201);
        // Desde el incremento 3 responde 201 con el usuario creado, que NUNCA
        // incluye la contraseña ni su hash.
        const created = response.body as Record<string, unknown>;
        expect(created.Id).to.be.a("string").and.not.be.empty;
        expect(created).to.include.keys("TenantId", "IdentificationNumber", "Username", "Email");
        expect(created).not.to.have.property("Password");
        captureEvidence("03-CP-INT-003-crear-usuario");
      });
    });
  });
});
