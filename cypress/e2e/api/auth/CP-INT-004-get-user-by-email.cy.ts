import { createUser, getUserByEmail } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import {
  idempotencyKey,
  uniqueEmail,
  uniqueIdentificationNumber,
  uniqueName,
} from "../../../support/data/unique";

describe("CP-INT-004 - Consultar usuario por email", () => {
  it("prepara su propio usuario y luego lo consulta por email", () => {
    const email = uniqueEmail("cp-int-004");
    const identificationNumber = uniqueIdentificationNumber();
    const username = uniqueName("cp-int-004-user");
    const plainPassword = "Str0ng!Passw0rd";

    loginAsAdmin().then((session) => {
      createUser(Cypress.env("AUTH_API_URL"), session.access_token, idempotencyKey(), {
        tenant_id: Cypress.env("AUTH_TENANT_ID"),
        identification_number: identificationNumber,
        username,
        email,
        password: plainPassword,
      }).then((createResponse) => {
        expect(createResponse.status).to.eq(201);

        getUserByEmail(
          Cypress.env("AUTH_API_URL"),
          session.access_token,
          Cypress.env("AUTH_TENANT_ID"),
          email
        ).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.Id).to.be.a("string").and.not.empty;
          expect(response.body.TenantId).to.eq(Cypress.env("AUTH_TENANT_ID"));
          expect(response.body.IdentificationNumber).to.eq(identificationNumber);
          expect(response.body.Username).to.eq(username);
          expect(response.body.Email).to.eq(email);
          // Único requisito de seguridad exigido en esta prueba: la contraseña
          // original nunca viaja en texto plano en la respuesta (sin asumir que
          // el campo Password deba existir ni validar su formato de hash).
          expect(response.body.Password).to.not.eq(plainPassword);
        });
      });
    });
  });
});
