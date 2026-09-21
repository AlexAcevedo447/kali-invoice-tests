import { createUser } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { loginToUI } from "../../../support/ui/session";
import {
  idempotencyKey,
  uniqueEmail,
  uniqueIdentificationNumber,
  uniqueName,
} from "../../../support/data/unique";
import { captureEvidence } from "../../../support/evidence";

describe("CP-E2E-007 - Registro con email duplicado", () => {
  const duplicateEmail = uniqueEmail("cp-e2e-007");

  before(() => {
    loginAsAdmin().then((session) => {
      createUser(Cypress.env("AUTH_API_URL"), session.access_token, idempotencyKey(), {
        tenant_id: Cypress.env("AUTH_TENANT_ID"),
        identification_number: uniqueIdentificationNumber(),
        username: uniqueName("cp-e2e-007-user-a"),
        email: duplicateEmail,
        password: "Str0ng!Passw0rd",
      }).then((response) => {
        expect(response.status).to.eq(201);
      });
    });
  });

  beforeEach(() => {
    loginToUI();
    cy.visit("/admin/users");
  });

  it("intenta crear un segundo usuario con el mismo email desde la UI y confirma 409 + mensaje visible", () => {
    cy.intercept("POST", "**/api/v1/users*").as("createUser");

    cy.get('[data-cy="user-identification"]').type(uniqueIdentificationNumber());
    cy.get('[data-cy="user-username"]').type(uniqueName("cp-e2e-007-user-b"));
    cy.get('[data-cy="user-email"]').type(duplicateEmail);
    cy.get('[data-cy="user-password"]').type("Str0ng!Passw0rd");
    captureEvidence("08-CP-E2E-007-formulario-usuario");
    cy.get('[data-cy="user-submit"]').click();

    cy.wait("@createUser").its("response.statusCode").should("eq", 409);

    cy.get(".p-toast-detail").should(
      "contain.text",
      "Ya existe un usuario registrado con este correo electrónico."
    );
    captureEvidence("09-CP-E2E-007-email-duplicado");
  });
});
