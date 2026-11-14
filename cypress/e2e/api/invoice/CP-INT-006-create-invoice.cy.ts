import { createInvoice, seedCatalog } from "../../../support/api/invoice/invoice-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { idempotencyKey } from "../../../support/data/unique";
import { captureEvidence } from "../../../support/evidence";

describe("CP-INT-006 - Crear factura", () => {
  it("crea una factura con cliente y producto del catálogo del tenant", () => {
    loginAsAdmin().then((session) => {
      const token = session.access_token;
      seedCatalog(Cypress.env("INVOICE_API_URL"), token, "CP-INT-006").then(({ customer, product }) => {
        createInvoice(
          Cypress.env("INVOICE_API_URL"),
          idempotencyKey(),
          { customer_id: customer.ID, items: [{ item_id: product.ID, quantity: 1, unit_price: 100 }] },
          token
        ).then((response) => {
          expect(response.status).to.eq(201);
          // El servidor genera el ID (UUID v4) y asigna el tenant del token.
          expect(response.body.ID).to.match(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          );
          expect(response.body.TenantID).to.eq(session.tenant_id);
          expect(response.body.CustomerID).to.eq(customer.ID);
          expect(response.body.CustomerName).to.eq(customer.Name);
          expect(response.body.Items[0].ProductName).to.eq(product.Name);
          expect(response.body.Status).to.eq("PENDING");
          expect(response.body.Total).to.eq(100);
          expect(new Date(response.body.DueDate).getTime()).to.be.at.least(
            new Date(response.body.IssueDate).getTime()
          );
          captureEvidence("06-CP-INT-006-crear-factura");
        });
      });
    });
  });
});
