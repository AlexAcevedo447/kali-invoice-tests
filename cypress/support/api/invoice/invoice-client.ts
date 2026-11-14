/**
 * Cliente HTTP explícito para el contrato público de kali-invoice-service.
 *
 * Contrato vigente: todas las rutas de facturación y catálogos exigen
 * `Authorization: Bearer <token de kali-auth-context>`; el servicio toma el
 * tenant del token (nunca del body) y aísla los datos por empresa. Clientes y
 * productos deben existir en el catálogo del mismo tenant. Las respuestas de
 * dominio llegan en PascalCase (`ID`, `CustomerID`, `Status`, ...).
 */

export interface InvoiceItemTaxInput {
  code: string;
  /** Obligatorio y explícito: "DEBIT" o "CREDIT" (incremento 4, D4-03). */
  kind: string;
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
  ProductCode: string;
  ProductName: string;
  Quantity: number;
  UnitPrice: number;
  Taxes: unknown[] | null;
  TaxTotal: number;
  Subtotal: number;
  Total: number;
}

export interface InvoiceResponse {
  ID: string;
  TenantID: string;
  CustomerID: string;
  CustomerName: string;
  CustomerDocument: string;
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

export interface CustomerResponse {
  ID: string;
  Name: string;
  Document: string;
}

export interface ProductResponse {
  ID: string;
  Code: string;
  Name: string;
  UnitPrice: number;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export function listInvoices(
  baseUrl: string,
  token: string
): Cypress.Chainable<Cypress.Response<InvoiceResponse[]>> {
  return cy.request<InvoiceResponse[]>({
    method: "GET",
    url: `${baseUrl}/api/v1/invoices`,
    headers: auth(token),
    failOnStatusCode: false,
  });
}

export function createInvoice(
  baseUrl: string,
  idempotencyKey: string,
  payload: CreateInvoiceRequest,
  token: string
): Cypress.Chainable<Cypress.Response<InvoiceResponse>> {
  return cy.request<InvoiceResponse>({
    method: "POST",
    url: `${baseUrl}/api/v1/invoices`,
    headers: { ...auth(token), "Idempotency-Key": idempotencyKey },
    body: payload,
    failOnStatusCode: false,
  });
}

export function createCustomer(
  baseUrl: string,
  token: string,
  payload: { name: string; document: string }
): Cypress.Chainable<Cypress.Response<CustomerResponse>> {
  return cy.request<CustomerResponse>({
    method: "POST",
    url: `${baseUrl}/api/v1/customers`,
    headers: { ...auth(token), "Idempotency-Key": `${Date.now()}-${Math.random()}` },
    body: payload,
    failOnStatusCode: false,
  });
}

export function createProduct(
  baseUrl: string,
  token: string,
  payload: { code: string; name: string; unit_price: number }
): Cypress.Chainable<Cypress.Response<ProductResponse>> {
  return cy.request<ProductResponse>({
    method: "POST",
    url: `${baseUrl}/api/v1/products`,
    headers: { ...auth(token), "Idempotency-Key": `${Date.now()}-${Math.random()}` },
    body: payload,
    failOnStatusCode: false,
  });
}

/**
 * Crea un cliente y un producto propios del tenant del token, con datos
 * legibles únicos, y devuelve sus identificadores para usarlos en facturas.
 */
export function seedCatalog(
  baseUrl: string,
  token: string,
  label: string
): Cypress.Chainable<{ customer: CustomerResponse; product: ProductResponse }> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return createCustomer(baseUrl, token, { name: `Cliente ${label}`, document: `NIT-${suffix}` }).then((c) => {
    expect(c.status, "cliente de prueba creado").to.eq(201);
    return createProduct(baseUrl, token, { code: `REF-${suffix}`, name: `Producto ${label}`, unit_price: 100 }).then((p) => {
      expect(p.status, "producto de prueba creado").to.eq(201);
      return { customer: c.body, product: p.body };
    });
  });
}
