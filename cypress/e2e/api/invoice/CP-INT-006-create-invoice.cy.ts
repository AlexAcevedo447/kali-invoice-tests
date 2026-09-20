import { createInvoice } from "../../../support/api/invoice/invoice-client";
import { idempotencyKey, uuid } from "../../../support/data/unique";

describe("CP-INT-006 - Crear factura", () => {
  it("crea una factura con un payload mínimo válido", () => {
    const customerId = uuid();

    createInvoice(Cypress.env("INVOICE_API_URL"), idempotencyKey(), {
      customer_id: customerId,
      items: [
        {
          item_id: uuid(),
          quantity: 1,
          unit_price: 100,
        },
      ],
    }).then((response) => {
      expect(response.status).to.eq(201);
      // El servicio genera el ID con google/uuid (uuid.New()), un UUID v4.
      expect(response.body.ID).to.match(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(response.body.CustomerID).to.eq(customerId);
      expect(response.body.Status).to.eq("PENDING");
      expect(response.body.Total).to.eq(100);
      // IssueDate/DueDate son time.Time serializados por Go (RFC3339); si no se
      // envían en el payload, el servicio los calcula (issue_date = ahora,
      // due_date = issue_date + 30 días), por lo que siempre deben venir presentes.
      expect(response.body.IssueDate).to.be.a("string").and.not.empty;
      expect(new Date(response.body.IssueDate).toString()).to.not.eq("Invalid Date");
      expect(response.body.DueDate).to.be.a("string").and.not.empty;
      expect(new Date(response.body.DueDate).toString()).to.not.eq("Invalid Date");
      expect(new Date(response.body.DueDate).getTime()).to.be.at.least(
        new Date(response.body.IssueDate).getTime()
      );
    });
  });
});
