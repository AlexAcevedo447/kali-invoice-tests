/**
 * Helpers RBAC sobre el contrato público de kali-auth-context (incremento 2):
 * permisos únicos por (empresa, recurso, acción), asignaciones idempotentes y
 * creación de roles/permisos que devuelve la entidad creada (PascalCase).
 */

import { idempotencyKey } from "../../data/unique";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
// Mismo generador que el resto de las pruebas (funciona también fuera de contextos seguros).
const idem = () => idempotencyKey();

export interface PermissionResponse {
  Id: string;
  TenantId: string;
  Resource: string;
  Action: string;
}

export interface RoleResponse {
  Id: string;
  TenantId: string;
  Name: string;
  Description: string;
}

const norm = (v: string) => v.trim().toLowerCase();

/** Crea el permiso o reutiliza el existente (409 permission already exists). */
export function ensurePermission(
  baseUrl: string,
  token: string,
  tenantId: string,
  resource: string,
  action: string
): Cypress.Chainable<PermissionResponse> {
  return cy
    .request<PermissionResponse>({
      method: "POST",
      url: `${baseUrl}/api/v1/permissions/`,
      headers: { ...auth(token), "Idempotency-Key": idem() },
      body: { tenant_id: tenantId, resource, action },
      failOnStatusCode: false,
    })
    .then((created) => {
      if (created.status === 201) return cy.wrap(created.body);
      expect(created.status, `permiso ${resource}/${action}`).to.eq(409);
      return cy
        .request<PermissionResponse[]>({ url: `${baseUrl}/api/v1/permissions`, qs: { tenant_id: tenantId }, headers: auth(token) })
        .then((list) => {
          const found = list.body.find((p) => norm(p.Resource) === norm(resource) && norm(p.Action) === norm(action));
          expect(found, `permiso existente ${resource}/${action}`).to.exist;
          return found!;
        });
    });
}

/** Crea el rol o reutiliza el existente con el mismo nombre normalizado. */
export function ensureRole(
  baseUrl: string,
  token: string,
  tenantId: string,
  name: string,
  description = ""
): Cypress.Chainable<RoleResponse> {
  return cy
    .request<RoleResponse>({
      method: "POST",
      url: `${baseUrl}/api/v1/roles/`,
      headers: { ...auth(token), "Idempotency-Key": idem() },
      body: { tenant_id: tenantId, name, description },
      failOnStatusCode: false,
    })
    .then((created) => {
      if (created.status === 201) return cy.wrap(created.body);
      expect(created.status, `rol ${name}`).to.eq(409);
      return cy
        .request<RoleResponse[]>({ url: `${baseUrl}/api/v1/roles`, qs: { tenant_id: tenantId }, headers: auth(token) })
        .then((list) => {
          const found = list.body.find((r) => norm(r.Name) === norm(name));
          expect(found, `rol existente ${name}`).to.exist;
          return found!;
        });
    });
}

export function assignPermissionToRole(baseUrl: string, token: string, tenantId: string, roleId: string, permissionId: string) {
  return cy.request({
    method: "POST",
    url: `${baseUrl}/api/v1/rbac/roles/permissions/assign`,
    headers: { ...auth(token), "Idempotency-Key": idem() },
    body: { tenant_id: tenantId, role_id: roleId, permission_id: permissionId },
    failOnStatusCode: false,
  });
}

export function assignRoleToUser(baseUrl: string, token: string, tenantId: string, userId: string, roleId: string) {
  return cy.request({
    method: "POST",
    url: `${baseUrl}/api/v1/rbac/users/roles/assign`,
    headers: { ...auth(token), "Idempotency-Key": idem() },
    body: { tenant_id: tenantId, user_id: userId, role_id: roleId },
    failOnStatusCode: false,
  });
}

/**
 * Deja al rol con los permisos indicados (crea o reutiliza cada permiso y lo
 * asigna; asignar es idempotente). Devuelve el rol.
 */
export function ensureRoleWithPermissions(
  baseUrl: string,
  token: string,
  tenantId: string,
  roleName: string,
  grants: Array<[string, string]>,
  description = ""
): Cypress.Chainable<RoleResponse> {
  return ensureRole(baseUrl, token, tenantId, roleName, description).then((role) => {
    grants.forEach(([resource, action]) =>
      ensurePermission(baseUrl, token, tenantId, resource, action).then((perm) =>
        assignPermissionToRole(baseUrl, token, tenantId, role.Id, perm.Id).its("status").should("eq", 200)
      )
    );
    return cy.wrap(role);
  });
}

/** Asigna un rol a un usuario identificado por correo (en la empresa indicada). */
export function grantRoleToUserByEmail(baseUrl: string, token: string, tenantId: string, email: string, roleId: string) {
  return cy
    .request<{ Id: string }>({
      url: `${baseUrl}/api/v1/users/by-email`,
      qs: { email, tenant_id: tenantId },
      headers: auth(token),
    })
    .then((user) => assignRoleToUser(baseUrl, token, tenantId, user.body.Id, roleId).its("status").should("eq", 200));
}
