import { login, LoginResponse } from "./auth-client";

/**
 * Obtiene un JWT del usuario administrador configurado por entorno.
 * Usado como paso de preparación por los casos que requieren un token válido;
 * el propio contrato de login se valida en CP-INT-001.
 */
export function loginAsAdmin(): Cypress.Chainable<LoginResponse> {
  return login(Cypress.env("AUTH_API_URL"), {
    tenant_id: Cypress.env("AUTH_TENANT_ID"),
    email: Cypress.env("AUTH_ADMIN_EMAIL"),
    password: Cypress.env("AUTH_ADMIN_PASSWORD"),
  }).then((response) => {
    expect(response.status, "login de preparación exitoso").to.eq(200);
    return response.body;
  });
}
