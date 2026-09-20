import { createUser } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { expectCreatedTextBody } from "../../../support/assertions/auth-responses";
import {
  idempotencyKey,
  uniqueEmail,
  uniqueIdentificationNumber,
  uniqueName,
} from "../../../support/data/unique";

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
        // Contrato real: la creación responde 201 con el texto plano "Created",
        // por lo que no hay ningún dato (ni contraseña) que pueda quedar
        // expuesto en esta respuesta.
        expectCreatedTextBody(response.body);
      });
    });
  });
});
