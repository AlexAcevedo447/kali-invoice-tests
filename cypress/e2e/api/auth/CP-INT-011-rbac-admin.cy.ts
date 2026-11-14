import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import {
  assignPermissionToRole,
  assignRoleToUser,
  ensurePermission,
  ensureRoleWithPermissions,
  type PermissionResponse,
  type RoleResponse,
} from "../../../support/api/auth/rbac";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-INT-011 - Roles, permisos y asignaciones (RF-06 a RF-09, incremento 2).
 * Contrato: invoice-kali-front/docs/requisitos/MATRIZ_PERMISOS.md.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const PASSWORD = "Rbac!Kali2026";
const ADMIN_GRANTS: Array<[string, string]> = [
  ["roles", "manage"],
  ["permissions", "manage"],
  ["rbac", "manage"],
];

type Who = "adminA" | "adminB" | "viewer" | "plain";

const call = (token: string, method: string, path: string, body?: Cypress.RequestBody, qs?: Record<string, string>) =>
  cy.request({
    method,
    url: `${AUTH()}/api/v1${path}`,
    body,
    qs,
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey() },
    failOnStatusCode: false,
  });

describe("CP-INT-011 - RBAC por empresa", () => {
  let ptoken = "";
  let tenantId = "";
  let gestor: RoleResponse;
  let lector: RoleResponse;
  const users = {} as Record<Who, { email: string; id: string; token: string }>;

  before(() => {
    loginAsAdmin().then((platform) => {
      ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-int-011") }).then((t) => {
        expect(t.status).to.eq(201);
        tenantId = t.body.Id;
        (["adminA", "adminB", "viewer", "plain"] as Who[]).forEach((who) => {
          const email = uniqueEmail(`cp-int-011-${who}`);
          users[who] = { email, id: "", token: "" };
          createUser(AUTH(), ptoken, idempotencyKey(), {
            tenant_id: tenantId,
            identification_number: uniqueIdentificationNumber(),
            username: uniqueName(`cp-int-011-${who}`),
            email,
            password: PASSWORD,
          }).its("status").should("eq", 201);
          cy.request<{ Id: string }>({
            url: `${AUTH()}/api/v1/users/by-email`,
            qs: { email, tenant_id: tenantId },
            headers: { Authorization: `Bearer ${ptoken}` },
          }).then((u) => (users[who].id = u.body.Id));
        });
        // gestor: administrador efectivo SIN comodines; lector: roles/read.
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "gestor", ADMIN_GRANTS).then((r) => (gestor = r));
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "lector", [["roles", "read"]]).then((r) => (lector = r));
        cy.then(() => {
          assignRoleToUser(AUTH(), ptoken, tenantId, users.adminA.id, gestor.Id).its("status").should("eq", 200);
          assignRoleToUser(AUTH(), ptoken, tenantId, users.adminB.id, gestor.Id).its("status").should("eq", 200);
          assignRoleToUser(AUTH(), ptoken, tenantId, users.viewer.id, lector.Id).its("status").should("eq", 200);
        });
        cy.then(() =>
          (Object.keys(users) as Who[]).forEach((who) =>
            login(AUTH(), { email: users[who].email, password: PASSWORD }).then((s) => {
              expect(s.status).to.eq(200);
              users[who].token = s.body.access_token;
            })
          )
        );
      });
    });
  });

  it("autorización por operación: sin permiso 403, lectura no permite modificar", () => {
    call(users.plain.token, "GET", "/roles").then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body).to.deep.eq({ error: "insufficient permissions" });
    });
    call(users.plain.token, "GET", "/permissions").its("status").should("eq", 403);
    call(users.plain.token, "POST", "/rbac/users/roles/assign", { user_id: users.plain.id, role_id: lector.Id })
      .its("status")
      .should("eq", 403);
    call(users.viewer.token, "GET", "/roles").its("status").should("eq", 200);
    call(users.viewer.token, "POST", "/roles/", { name: "no-permitido" }).its("status").should("eq", 403);
    call(users.adminA.token, "GET", "/permissions/catalog").then((r) => {
      expect(r.status).to.eq(200);
      expect(r.body.resources.map((e: { resource: string }) => e.resource)).to.include.members(["invoices", "roles", "rbac"]);
    });
  });

  it("roles: nombre obligatorio, único sin distinguir mayúsculas ni espacios; devuelve el rol creado", () => {
    call(users.adminA.token, "POST", "/roles/", { name: "   " }).then((r) => {
      expect(r.status).to.eq(400);
      expect(r.body.error).to.eq("role name is required");
    });
    call(users.adminA.token, "POST", "/roles/", { name: "  Auditor  ", description: " lectura " }).then((r) => {
      expect(r.status).to.eq(201);
      expect(r.body).to.deep.include({ Name: "Auditor", Description: "lectura", TenantId: tenantId });
    });
    call(users.adminA.token, "POST", "/roles/", { name: " AUDITOR " }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("role name already exists");
    });
    call(users.adminA.token, "PUT", `/roles/${lector.Id}`, { name: "gestor" }).its("status").should("eq", 409);
  });

  it("permisos: catálogo, normalización y unicidad", () => {
    call(users.adminA.token, "POST", "/permissions/", { resource: "pagos", action: "read" }).then((r) => {
      expect(r.status).to.eq(400);
      expect(r.body.error).to.eq("unknown permission resource");
    });
    call(users.adminA.token, "POST", "/permissions/", { resource: "rbac", action: "read" }).then((r) => {
      expect(r.status).to.eq(400);
      expect(r.body.error).to.eq("unknown permission action");
    });
    call(users.adminA.token, "POST", "/permissions/", { resource: " Invoices ", action: " READ " }).then((r) => {
      expect(r.status).to.eq(201);
      expect(r.body).to.deep.include({ Resource: "invoices", Action: "read" });
    });
    call(users.adminA.token, "POST", "/permissions/", { resource: "invoices", action: "read" }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("permission already exists");
    });
  });

  it("asignar es idempotente; borrar o editar lo asignado da 409; borrar un rol sin usuarios funciona", () => {
    assignRoleToUser(AUTH(), users.adminA.token, tenantId, users.viewer.id, lector.Id).its("status").should("eq", 200);
    call(users.adminA.token, "GET", "/rbac/users/roles", undefined, { user_id: users.viewer.id }).then((r) => {
      const ids = (r.body as Array<{ RoleId: string }>).map((x) => x.RoleId);
      expect(ids.filter((id) => id === lector.Id), "sin duplicados").to.have.length(1);
    });
    call(users.adminA.token, "DELETE", `/roles/${lector.Id}`).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("role is assigned to users");
    });
    ensurePermission(AUTH(), users.adminA.token, tenantId, "roles", "read").then((perm) => {
      call(users.adminA.token, "DELETE", `/permissions/${perm.Id}`).then((r) => {
        expect(r.status).to.eq(409);
        expect(r.body.error).to.eq("permission is assigned to roles");
      });
      call(users.adminA.token, "PUT", `/permissions/${perm.Id}`, { resource: "roles", action: "manage" })
        .its("status")
        .should("eq", 409);
      // Un rol sin usuarios se elimina junto con sus vínculos de permisos.
      call(users.adminA.token, "POST", "/roles/", { name: uniqueName("temporal") }).then((role) => {
        assignPermissionToRole(AUTH(), users.adminA.token, tenantId, role.body.Id, perm.Id).its("status").should("eq", 200);
        call(users.adminA.token, "DELETE", `/roles/${role.body.Id}`).its("status").should("eq", 204);
      });
    });
  });

  it("escalamiento: no se otorga ni se quita lo que uno no tiene (*/*, tenants/manage, otros permisos)", () => {
    call(users.adminA.token, "POST", "/permissions/", { resource: "*", action: "*" }).then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body.error).to.eq("cannot grant privileges you do not have");
    });
    call(users.adminA.token, "POST", "/permissions/", { resource: "tenants", action: "manage" }).its("status").should("eq", 403);
    // La plataforma crea en la empresa un rol "super" con */* y un permiso products/manage.
    ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "super", [["*", "*"]]).then((superRole) => {
      call(users.adminA.token, "POST", "/rbac/users/roles/assign", { user_id: users.plain.id, role_id: superRole.Id }).then((r) => {
        expect(r.status).to.eq(403);
        expect(r.body.error).to.eq("cannot grant privileges you do not have");
      });
      // Tampoco puede quitárselo a quien lo tenga (no degradar a un superior).
      assignRoleToUser(AUTH(), ptoken, tenantId, users.plain.id, superRole.Id).its("status").should("eq", 200);
      call(users.adminA.token, "POST", "/rbac/users/roles/remove", { user_id: users.plain.id, role_id: superRole.Id })
        .its("status")
        .should("eq", 403);
      // La plataforma (que sí cubre */*) lo retira: plain vuelve a no tener permisos.
      call(ptoken, "POST", "/rbac/users/roles/remove", { tenant_id: tenantId, user_id: users.plain.id, role_id: superRole.Id })
        .its("status")
        .should("eq", 200);
    });
    ensurePermission(AUTH(), ptoken, tenantId, "products", "manage").then((perm: PermissionResponse) => {
      call(users.adminA.token, "POST", "/rbac/roles/permissions/assign", { role_id: lector.Id, permission_id: perm.Id })
        .its("status")
        .should("eq", 403);
      // Ni agregárselo a su propio rol para escalar.
      call(users.adminA.token, "POST", "/rbac/roles/permissions/assign", { role_id: gestor.Id, permission_id: perm.Id })
        .its("status")
        .should("eq", 403);
    });
  });

  it("permisos propios sí; los de otros exigen rbac/manage", () => {
    call(users.plain.token, "GET", "/rbac/users/effective-permissions", undefined, { user_id: users.plain.id }).its("status").should("eq", 200);
    call(users.plain.token, "GET", "/rbac/users/roles", undefined, { user_id: users.plain.id }).its("status").should("eq", 200);
    // Consultar la evaluación propia está permitido: llega a evaluar y responde la
    // decisión (contrato existente: 403 con la decisión si se niega, 200 si se permite).
    call(users.plain.token, "POST", "/auth/authorize", { user_id: users.plain.id, resource: "roles", action: "read" }).then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body).to.deep.include({ Allowed: false, Reason: "permission denied" });
    });
    call(users.adminA.token, "POST", "/auth/authorize", { user_id: users.adminA.id, resource: "roles", action: "read" }).then((r) => {
      expect(r.status).to.eq(200);
      expect(r.body.Allowed, "manage incluye read").to.eq(true);
    });
    call(users.plain.token, "GET", "/rbac/users/effective-permissions", undefined, { user_id: users.adminA.id }).then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body.error).to.eq("insufficient permissions");
    });
    call(users.plain.token, "POST", "/auth/authorize", { user_id: users.adminA.id, resource: "roles", action: "read" })
      .its("status")
      .should("eq", 403);
    call(users.adminA.token, "GET", "/rbac/users/effective-permissions", undefined, { user_id: users.viewer.id }).its("status").should("eq", 200);
  });

  it("la empresa no puede quedar sin administrador efectivo", () => {
    ensurePermission(AUTH(), ptoken, tenantId, "rbac", "manage").then((rbacManage) => {
      // gestor lo tienen A y B: quitarle rbac/manage dejaría la empresa sin administrador.
      call(users.adminA.token, "POST", "/rbac/roles/permissions/remove", { role_id: gestor.Id, permission_id: rbacManage.Id }).then((r) => {
        expect(r.status).to.eq(409);
        expect(r.body.error).to.eq("operation would leave the tenant without an administrator");
      });
    });
    // Quitar gestor a B: queda A.
    call(users.adminA.token, "POST", "/rbac/users/roles/remove", { user_id: users.adminB.id, role_id: gestor.Id }).its("status").should("eq", 200);
    // Quitárselo a sí mismo dejaría la empresa sin administrador.
    call(users.adminA.token, "POST", "/rbac/users/roles/remove", { user_id: users.adminA.id, role_id: gestor.Id }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("operation would leave the tenant without an administrator");
    });
  });

  it("aislamiento y suspensión", () => {
    loginAsAdmin().then((platform) => {
      call(platform.access_token, "GET", "/roles").then((roles) => {
        const seedAdmin = (roles.body as RoleResponse[]).find((r) => r.Name.toLowerCase() === "admin")!;
        // Un rol de otra empresa no existe para A (404), y no puede apuntar a otra empresa (403).
        call(users.adminA.token, "GET", `/roles/${seedAdmin.Id}`).its("status").should("eq", 404);
        call(users.adminA.token, "GET", "/roles", undefined, { tenant_id: platform.tenant_id }).then((r) => {
          expect(r.status).to.eq(403);
          expect(r.body.error).to.eq("tenant mismatch");
        });
      });
    });
    call(ptoken, "POST", `/tenants/${tenantId}/suspend`).its("status").should("eq", 200);
    call(users.adminA.token, "GET", "/roles").then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body.error).to.eq("tenant is suspended");
    });
    call(ptoken, "POST", `/tenants/${tenantId}/activate`).its("status").should("eq", 200);
    call(users.adminA.token, "GET", "/roles").its("status").should("eq", 200);
  });
});

describe("CP-INT-011 - Protección del administrador sembrado de la plataforma", () => {
  it("no se puede modificar ni eliminar el rol admin ni su permiso */*, ni quitárselo", () => {
    loginAsAdmin().then((platform) => {
      const t = platform.access_token;
      call(t, "GET", "/roles").then((roles) => {
        const seedAdmin = (roles.body as RoleResponse[]).find((r) => r.Name.toLowerCase() === "admin")!;
        call(t, "GET", "/permissions").then((perms) => {
          const all = (perms.body as PermissionResponse[]).find((p) => p.Resource === "*" && p.Action === "*")!;
          call(t, "PUT", `/roles/${seedAdmin.Id}`, { name: "admin-renombrado" }).then((r) => {
            expect(r.status).to.eq(409);
            expect(r.body.error).to.eq("protected administrative role");
          });
          call(t, "DELETE", `/roles/${seedAdmin.Id}`).its("status").should("eq", 409);
          call(t, "POST", "/rbac/roles/permissions/remove", { role_id: seedAdmin.Id, permission_id: all.Id }).then((r) => {
            expect(r.status).to.eq(409);
            expect(r.body.error).to.eq("protected administrative role");
          });
          call(t, "PUT", `/permissions/${all.Id}`, { resource: "invoices", action: "read" }).then((r) => {
            expect(r.status).to.eq(409);
            expect(r.body.error).to.eq("protected administrative permission");
          });
          call(t, "DELETE", `/permissions/${all.Id}`).its("status").should("eq", 409);
        });
      });
    });
  });
});
