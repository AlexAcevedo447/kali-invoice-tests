import { createInvoice } from "../../../support/api/invoice/invoice-client";
import { idempotencyKey, uuid } from "../../../support/data/unique";

describe("CP-INT-007 - Idempotencia al crear facturas", () => {
  it("repite la misma respuesta ante la misma key y rechaza un payload distinto con 422", () => {
    const key = idempotencyKey();
    const payload = {
      customer_id: uuid(),
      items: [
        {
          item_id: uuid(),
          quantity: 1,
          unit_price: 100,
        },
      ],
    };

    createInvoice(Cypress.env("INVOICE_API_URL"), key, payload).then((firstResponse) => {
      expect(firstResponse.status).to.eq(201);
      const firstInvoiceId = firstResponse.body.ID;

      createInvoice(Cypress.env("INVOICE_API_URL"), key, payload).then((replayResponse) => {
        expect(replayResponse.status).to.eq(201);
        expect(replayResponse.body.ID).to.eq(firstInvoiceId);
        expect(replayResponse.headers["x-idempotent-replayed"]).to.eq("true");

        createInvoice(Cypress.env("INVOICE_API_URL"), key, {
          ...payload,
          customer_id: uuid(),
        }).then((conflictResponse) => {
          expect(conflictResponse.status).to.eq(422);
        });
      });
    });
  });
});
