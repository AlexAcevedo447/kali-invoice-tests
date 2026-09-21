/**
 * Spec agregador para evidencia SENA (GA9): no define pruebas propias, solo
 * importa los specs reales por su efecto de registro (cada uno llama a
 * `describe`/`it` al cargarse). El objetivo es que Cypress trate toda la
 * evidencia como un único spec, para que la ventana no se cierre/reabra
 * entre archivos. No duplica lógica ni reescribe ninguna prueba existente.
 */

import "../api/auth/CP-INT-001-login.cy";
import "../api/auth/CP-INT-002-create-role.cy";
import "../api/auth/CP-INT-003-create-user.cy";
import "../api/auth/CP-INT-004-get-user-by-email.cy";

import "../api/invoice/CP-INT-005-list-invoices.cy";
import "../api/invoice/CP-INT-006-create-invoice.cy";
import "../api/invoice/CP-INT-007-invoice-idempotency.cy";

import "../ui/auth/CP-E2E-007-duplicate-email.cy";
import "../ui/invoice/CP-E2E-005-invoices-pagination.cy";

// Reorganiza las capturas de cypress/screenshots/GA9-all-tests.cy.ts/GA9/
// (anidado automático de cy.screenshot()) a cypress/screenshots/GA9/ plano.
// Solo corre cuando esta corrida es la de evidencia GA9 (test:ga9:open);
// no afecta ninguna otra ejecución.
after(function () {
  if (Cypress.env("GA9_EVIDENCE")) {
    cy.task("flattenGA9Screenshots");
  }
});
