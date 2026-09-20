import { createInvoice } from "../../../support/api/invoice/invoice-client";
import { idempotencyKey, uuid } from "../../../support/data/unique";
import { loginToUI } from "../../../support/ui/session";

/**
 * invoice-kali-front pagina la tabla de facturas en el cliente (rows=10,
 * GenericTable.tsx) sobre el lote que trae de una sola vez del backend
 * (page=1&page_size=20, invoicingStore.ts). Con más de 10 facturas ya hay
 * una segunda página real que mostrar; no hace falta superar 20 para este
 * caso, ni existe forma de configurar ese tamaño desde la UI.
 */
const INVOICES_TO_CREATE = 15;

describe("CP-E2E-005 - Listado y paginación de facturas", () => {
  before(() => {
    for (let i = 0; i < INVOICES_TO_CREATE; i += 1) {
      createInvoice(Cypress.env("INVOICE_API_URL"), idempotencyKey(), {
        customer_id: uuid(),
        items: [{ item_id: uuid(), quantity: 1, unit_price: 100 }],
      }).then((response) => {
        expect(response.status).to.eq(201);
      });
    }
  });

  beforeEach(() => {
    loginToUI();
    cy.intercept("GET", "**/api/v1/invoices*").as("listInvoices");
    cy.visit("/invoicing/invoices");
  });

  it("carga las facturas reales desde la API y navega a una segunda página con contenido distinto", () => {
    cy.wait("@listInvoices").its("response.statusCode").should("eq", 200);

    cy.get('[data-cy="invoice-table"] tbody tr').should("have.length", 10);

    cy.get('[data-cy="invoice-row-customer"]')
      .then(($cells) => [...$cells].map((el) => el.textContent?.trim()))
      .then((page1) => {
        expect(page1).to.have.length(10);

        cy.get('button[aria-label="Next Page"]').click();

        cy.get('[data-cy="invoice-table"] tbody tr').should(
          "have.length.greaterThan",
          0
        );

        cy.get('[data-cy="invoice-row-customer"]')
          .then(($cells2) => [...$cells2].map((el) => el.textContent?.trim()))
          .then((page2) => {
            expect(page2.length).to.be.greaterThan(0);
            const overlap = page2.filter((customer) => page1.includes(customer));
            expect(overlap, "la página 2 no debe repetir clientes de la página 1").to.have.length(0);
          });
      });
  });
});
