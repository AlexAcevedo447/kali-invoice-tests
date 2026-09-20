import { listInvoices } from "../../../support/api/invoice/invoice-client";

/**
 * Precondición real de este caso: kali-invoice-service debe apuntar a una base
 * de datos Postgres exclusiva y recién creada para Cypress (no la base de
 * desarrollo compartida), de forma que "sin registros" sea un estado real y
 * no una suposición. Eso se logra solo con configuración ya existente del
 * servicio (variables POSTGRES_*, auto-creación de BD y migraciones propias),
 * sin tocar su código ni agregar endpoints de limpieza.
 * Ver scripts/invoice-test-db.sh y el README (sección "Aislamiento de datos
 * para CP-INT-005") para el procedimiento exacto.
 */
describe("CP-INT-005 - Listar facturas", () => {
  it("responde 200 con una colección vacía cuando no hay facturas previas", () => {
    listInvoices(Cypress.env("INVOICE_API_URL")).then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.deep.equal([]);
    });
  });
});
