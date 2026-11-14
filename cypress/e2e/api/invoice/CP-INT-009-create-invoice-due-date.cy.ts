import { createInvoice, listInvoices, seedCatalog } from "../../../support/api/invoice/invoice-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { idempotencyKey } from "../../../support/data/unique";

/**
 * CP-INT-009 - Regresión: al crear una factura se valida el vencimiento.
 *
 * Antes, la regla "due_date no puede ser anterior a issue_date" solo se
 * aplicaba al editar; al crear se aceptaba una factura vencida desde su
 * emisión. Ahora la creación responde 400 con el mismo mensaje que la edición
 * y no persiste nada. Un vencimiento igual a la emisión sigue siendo válido.
 */

const INVOICE = () => Cypress.env("INVOICE_API_URL");

describe("CP-INT-009 - Crear factura con vencimiento anterior a la emisión", () => {
  it("responde 400 due_date cannot be before issue_date y no crea la factura", () => {
    loginAsAdmin().then((session) => {
      const token = session.access_token;
      seedCatalog(INVOICE(), token, "CP-INT-009").then(({ customer, product }) => {
        listInvoices(INVOICE(), token).then((before) => {
          const totalBefore = Number(before.headers["x-total-count"]);

          createInvoice(
            INVOICE(),
            idempotencyKey(),
            {
              customer_id: customer.ID,
              issue_date: "2026-06-15T00:00:00Z",
              due_date: "2026-06-14T00:00:00Z",
              items: [{ item_id: product.ID, quantity: 1, unit_price: 100 }],
            },
            token
          ).then((response) => {
            expect(response.status).to.eq(400);
            expect(response.body).to.deep.eq({ error: "due_date cannot be before issue_date" });
          });

          listInvoices(INVOICE(), token).then((after) => {
            expect(Number(after.headers["x-total-count"]), "no se persistió ninguna factura").to.eq(totalBefore);
          });
        });
      });
    });
  });

  it("acepta un vencimiento igual a la fecha de emisión", () => {
    loginAsAdmin().then((session) => {
      const token = session.access_token;
      seedCatalog(INVOICE(), token, "CP-INT-009-borde").then(({ customer, product }) => {
        createInvoice(
          INVOICE(),
          idempotencyKey(),
          {
            customer_id: customer.ID,
            issue_date: "2026-06-15T00:00:00Z",
            due_date: "2026-06-15T00:00:00Z",
            items: [{ item_id: product.ID, quantity: 1, unit_price: 100 }],
          },
          token
        ).then((response) => {
          expect(response.status).to.eq(201);
          expect(new Date(response.body.DueDate).getTime()).to.eq(new Date(response.body.IssueDate).getTime());
        });
      });
    });
  });
});
