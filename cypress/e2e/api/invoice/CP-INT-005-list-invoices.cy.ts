import { listInvoices } from "../../../support/api/invoice/invoice-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { captureEvidence } from "../../../support/evidence";

/**
 * Precondición: kali-invoice-service apunta a la base exclusiva y recién creada
 * de Cypress (scripts/invoice-test-fresh.sh), así que el tenant autenticado no
 * tiene facturas. El listado exige token y solo devuelve facturas de ese tenant.
 */
describe("CP-INT-005 - Listar facturas", () => {
  it("rechaza el listado sin token", () => {
    cy.request({ url: `${Cypress.env("INVOICE_API_URL")}/api/v1/invoices`, failOnStatusCode: false })
      .its("status")
      .should("eq", 401);
  });

  it("responde 200 con una colección vacía cuando el tenant no tiene facturas", () => {
    loginAsAdmin().then((session) => {
      listInvoices(Cypress.env("INVOICE_API_URL"), session.access_token).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body).to.deep.equal([]);
        expect(response.headers["x-total-count"]).to.eq("0");
        captureEvidence("05-CP-INT-005-listar-facturas-vacio");
      });
    });
  });
});
