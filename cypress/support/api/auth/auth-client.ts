/**
 * Cliente HTTP explícito para el contrato público de kali-auth-context (`/api/v1`).
 *
 * Nota de contrato real: `POST /api/v1/roles/` y `POST /api/v1/users/` responden
 * `201 Created` con cuerpo vacío (no devuelven el recurso creado), y
 * `GET /api/v1/users/by-email` serializa el struct de dominio sin tags JSON, por lo
 * que sus claves llegan en PascalCase (`Id`, `Email`, `Password`, ...) en vez de
 * snake_case.
 */

export interface LoginRequest {
  tenant_id: string;
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  tenant_id: string;
  user_id: string;
  email: string;
  needs_rehash: boolean;
  roles: string[];
  permissions: Array<Record<string, string>>;
}

export function login(
  baseUrl: string,
  payload: LoginRequest
): Cypress.Chainable<Cypress.Response<LoginResponse>> {
  return cy.request<LoginResponse>({
    method: "POST",
    url: `${baseUrl}/api/v1/auth/login`,
    body: payload,
    failOnStatusCode: false,
  });
}

export interface CreateRoleRequest {
  tenant_id: string;
  name: string;
  description: string;
}

export function createRole(
  baseUrl: string,
  accessToken: string,
  idempotencyKey: string,
  payload: CreateRoleRequest
): Cypress.Chainable<Cypress.Response<unknown>> {
  return cy.request({
    method: "POST",
    url: `${baseUrl}/api/v1/roles/`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: payload,
    failOnStatusCode: false,
  });
}

export interface CreateUserRequest {
  tenant_id: string;
  identification_number: string;
  username: string;
  email: string;
  password: string;
}

export function createUser(
  baseUrl: string,
  accessToken: string,
  idempotencyKey: string,
  payload: CreateUserRequest
): Cypress.Chainable<Cypress.Response<unknown>> {
  return cy.request({
    method: "POST",
    url: `${baseUrl}/api/v1/users/`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Idempotency-Key": idempotencyKey,
    },
    body: payload,
    failOnStatusCode: false,
  });
}

export interface UserByEmailResponse {
  Id: string;
  TenantId: string;
  IdentificationNumber: string;
  Username: string;
  Email: string;
  Password: string;
}

export function getUserByEmail(
  baseUrl: string,
  accessToken: string,
  tenantId: string,
  email: string
): Cypress.Chainable<Cypress.Response<UserByEmailResponse>> {
  return cy.request<UserByEmailResponse>({
    method: "GET",
    url: `${baseUrl}/api/v1/users/by-email`,
    qs: { email, tenant_id: tenantId },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    failOnStatusCode: false,
  });
}
