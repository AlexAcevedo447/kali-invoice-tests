/**
 * Captura de evidencia PNG para GA9 (SENA). Es un no-op salvo que la corrida
 * declare explícitamente `Cypress.env("GA9_EVIDENCE")` (ver
 * `test:ga9:open` en package.json, que pasa `--env GA9_EVIDENCE=true`), así
 * que llamar a esta función desde un spec no afecta ninguna otra corrida
 * (test:auth, test:invoice, test:ui, etc.) ni cambia su comportamiento.
 *
 * No reemplaza ninguna aserción: se invoca únicamente después de que el
 * estado que se quiere documentar ya fue validado por el propio test.
 */
export const captureEvidence = (name: string): void => {
  if (!Cypress.env("GA9_EVIDENCE")) {
    return;
  }

  cy.screenshot(`GA9/${name}`, {
    capture: "runner",
    overwrite: true,
  });
};
