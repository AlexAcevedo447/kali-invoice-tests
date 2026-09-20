/**
 * Cliente HTTP explícito para el contrato público de kali-invoice-service (`/api/v1/invoices`).
 *
 * Nota de contrato real: el servicio no implementa Authorization/JWT/tenant, por lo
 * que este cliente nunca envía dicho header. El struct de dominio tampoco define
 * tags JSON, por lo que las respuestas llegan en PascalCase (`ID`, `CustomerID`,
 * `Status`, ...) en vez de snake_case.
 */

export interface InvoiceItemTaxInput {
  code: string;
  kind?: string;
  rate: number;
}

export interface InvoiceItemInput {
  item_id: string;
  quantity: number;
  unit_price: number;
  taxes?: InvoiceItemTaxInput[];
}

export interface CreateInvoiceRequest {
  customer_id: string;
  issue_date?: string;
  due_date?: string;
  items: InvoiceItemInput[];
}

export interface InvoiceItemResponse {
  ID: string;
  InvoiceID: string;
  ItemID: string;
  Quantity: number;
  UnitPrice: number;
  Taxes: unknown[] | null;
  TaxTotal: number;
  Subtotal: number;
  Total: number;
}

export interface InvoiceResponse {
  ID: string;
  CustomerID: string;
  IssueDate: string;
  DueDate: string;
  Items: InvoiceItemResponse[];
  Subtotal: number;
  TaxTotal: number;
  Total: number;
  Status: string;
  CreatedAt: string;
  UpdatedAt: string;
}

export function listInvoices(
  baseUrl: string
): Cypress.Chainable<Cypress.Response<InvoiceResponse[]>> {
  return cy.request<InvoiceResponse[]>({
    method: "GET",
    url: `${baseUrl}/api/v1/invoices`,
    failOnStatusCode: false,
  });
}

export function createInvoice(
  baseUrl: string,
  idempotencyKey: string,
  payload: CreateInvoiceRequest
): Cypress.Chainable<Cypress.Response<InvoiceResponse>> {
  return cy.request<InvoiceResponse>({
    method: "POST",
    url: `${baseUrl}/api/v1/invoices`,
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
    body: payload,
    failOnStatusCode: false,
  });
}
