import { createInvoice, seedCatalog } from "../../../support/api/invoice/invoice-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { idempotencyKey } from "../../../support/data/unique";
import { loginToUI } from "../../../support/ui/session";
import { captureEvidence } from "../../../support/evidence";

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
    // Cada factura usa un cliente distinto del catálogo del tenant autenticado.
    loginAsAdmin().then((session) => {
      for (let i = 0; i < INVOICES_TO_CREATE; i += 1) {
        seedCatalog(Cypress.env("INVOICE_API_URL"), session.access_token, `CP-E2E-005 ${i}`).then(({ customer, product }) => {
          createInvoice(
            Cypress.env("INVOICE_API_URL"),
            idempotencyKey(),
            { customer_id: customer.ID, items: [{ item_id: product.ID, quantity: 1, unit_price: 100 }] },
            session.access_token
          ).its("status").should("eq", 201);
        });
      }
    });
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
        captureEvidence("10-CP-E2E-005-facturas-pagina-1");

        // La paginación es del servidor: se espera la respuesta de la página 2.
        cy.get('button[aria-label="Next Page"]').click();
        cy.wait("@listInvoices").its("request.url").should("contain", "page=2");

        cy.get('[data-cy="invoice-table"] tbody tr').should(
          "have.length.greaterThan",
          0
        );

        // should() reintenta hasta que la tabla muestre la nueva página.
        cy.get('[data-cy="invoice-row-customer"]').should(($cells2) => {
          const page2 = [...$cells2].map((el) => el.textContent?.trim());
          expect(page2.length).to.be.greaterThan(0);
          const overlap = page2.filter((customer) => page1.includes(customer));
          expect(overlap, "la página 2 no debe repetir clientes de la página 1").to.have.length(0);
        });
        captureEvidence("11-CP-E2E-005-facturas-pagina-2");
      });
  });
});
