import { createInvoice, seedCatalog } from "../../../support/api/invoice/invoice-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { idempotencyKey } from "../../../support/data/unique";
import { captureEvidence } from "../../../support/evidence";

describe("CP-INT-007 - Idempotencia al crear facturas", () => {
  it("repite la misma respuesta ante la misma key y rechaza un payload distinto con 422", () => {
    loginAsAdmin().then((session) => {
      const token = session.access_token;
      const base = Cypress.env("INVOICE_API_URL");
      seedCatalog(base, token, "CP-INT-007").then(({ customer, product }) => {
        const key = idempotencyKey();
        const payload = { customer_id: customer.ID, items: [{ item_id: product.ID, quantity: 1, unit_price: 100 }] };
        createInvoice(base, key, payload, token).then((first) => {
          expect(first.status).to.eq(201);
          createInvoice(base, key, payload, token).then((replay) => {
            expect(replay.status).to.eq(201);
            expect(replay.body.ID).to.eq(first.body.ID);
            expect(replay.headers["x-idempotent-replayed"]).to.eq("true");
            createInvoice(base, key, { ...payload, items: [{ ...payload.items[0], quantity: 2 }] }, token).then((conflict) => {
              expect(conflict.status).to.eq(422);
              captureEvidence("07-CP-INT-007-idempotencia-factura");
            });
          });
        });
      });
    });
  });
});
