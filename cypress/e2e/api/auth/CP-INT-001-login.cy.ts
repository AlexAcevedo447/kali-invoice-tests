import { login } from "../../../support/api/auth/auth-client";
import { captureEvidence } from "../../../support/evidence";

describe("CP-INT-001 - Login", () => {
  it("autentica solo con correo y contraseña; el servidor resuelve el tenant", () => {
    login(Cypress.env("AUTH_API_URL"), {
      email: Cypress.env("AUTH_ADMIN_EMAIL"),
      password: Cypress.env("AUTH_ADMIN_PASSWORD"),
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.access_token).to.be.a("string").and.not.empty;
      expect(response.body.token_type).to.eq("Bearer");
      // El tenant no lo envía el cliente: lo resuelve el servidor desde la cuenta.
      expect(response.body.tenant_id).to.eq(Cypress.env("AUTH_TENANT_ID"));
      expect(response.body.tenant_name).to.be.a("string").and.not.empty;
      expect(response.body.tenant_code).to.match(/^[a-z0-9-]{3,40}$/);
      expect(response.body.email).to.eq(Cypress.env("AUTH_ADMIN_EMAIL"));
      expect(response.body.user_id).to.be.a("string").and.not.empty;
      expect(response.body.roles).to.be.an("array");

      // El JWT lleva el tenant efectivo en el claim "tid".
      const claims = JSON.parse(atob(response.body.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      expect(claims.tid).to.eq(Cypress.env("AUTH_TENANT_ID"));
      captureEvidence("01-CP-INT-001-login");
    });
  });

  it("ignora un tenant_id enviado por el cliente", () => {
    cy.request({
      method: "POST",
      url: `${Cypress.env("AUTH_API_URL")}/api/v1/auth/login`,
      body: {
        tenant_id: "tenant-que-no-es-el-suyo",
        email: Cypress.env("AUTH_ADMIN_EMAIL"),
        password: Cypress.env("AUTH_ADMIN_PASSWORD"),
      },
    }).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body.tenant_id).to.eq(Cypress.env("AUTH_TENANT_ID"));
    });
  });

  it("rechaza credenciales incorrectas con 401", () => {
    login(Cypress.env("AUTH_API_URL"), {
      email: Cypress.env("AUTH_ADMIN_EMAIL"),
      password: "Incorrecta!123",
    }).then((response) => {
      expect(response.status).to.eq(401);
      expect(response.body).to.deep.equal({ error: "invalid credentials" });
    });
  });
});
