import { login } from "../../../support/api/auth/auth-client";

describe("CP-INT-001 - Login", () => {
  it("autentica con credenciales válidas y retorna un access token", () => {
    login(Cypress.env("AUTH_API_URL"), {
      tenant_id: Cypress.env("AUTH_TENANT_ID"),
      email: Cypress.env("AUTH_ADMIN_EMAIL"),
      password: Cypress.env("AUTH_ADMIN_PASSWORD"),
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.access_token).to.be.a("string").and.not.empty;
      expect(response.body.token_type).to.eq("Bearer");
      expect(response.body.tenant_id).to.eq(Cypress.env("AUTH_TENANT_ID"));
      expect(response.body.email).to.eq(Cypress.env("AUTH_ADMIN_EMAIL"));
      expect(response.body.user_id).to.be.a("string").and.not.empty;
      expect(response.body.roles).to.be.an("array");
    });
  });
});
