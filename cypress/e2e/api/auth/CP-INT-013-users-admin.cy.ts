import { createTenant, createUser, login } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { assignRoleToUser, ensureRoleWithPermissions, type RoleResponse } from "../../../support/api/auth/rbac";
import { idempotencyKey, uniqueEmail, uniqueIdentificationNumber, uniqueName } from "../../../support/data/unique";

/**
 * CP-INT-013 - Usuarios (RF-04, incremento 3).
 * Criterios: invoice-kali-front/docs/requisitos/INCREMENTO_03_USUARIOS.md.
 */

const AUTH = () => Cypress.env("AUTH_API_URL");
const INVOICE = () => Cypress.env("INVOICE_API_URL");
const PASSWORD = "Usuarios!Kali2026";
const CACHE_MS = 6000; // TENANT_STATUS_CACHE_SECONDS (5 s) + margen

type Who = "admin" | "helper" | "reader" | "plain" | "biller";
const GRANTS: Record<Who, Array<[string, string]>> = {
  admin: [
    ["users", "manage"],
    ["roles", "manage"],
    ["permissions", "manage"],
    ["rbac", "manage"],
  ],
  helper: [["users", "manage"]],
  reader: [["users", "read"]],
  plain: [],
  biller: [["invoices", "read"]],
};

const call = (token: string, method: string, path: string, body?: Cypress.RequestBody, qs?: Record<string, string>) =>
  cy.request({
    method,
    url: `${AUTH()}/api/v1${path}`,
    body,
    qs,
    headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey() },
    failOnStatusCode: false,
  });

describe("CP-INT-013 - Administración de usuarios", () => {
  let ptoken = "";
  let tenantId = "";
  const roles = {} as Record<Who, RoleResponse>;
  const users = {} as Record<Who, { email: string; id: string; token: string }>;

  before(() => {
    loginAsAdmin().then((platform) => {
      ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-int-013") }).then((t) => {
        tenantId = t.body.Id;
        (Object.keys(GRANTS) as Who[]).forEach((who) => {
          const email = uniqueEmail(`cp-int-013-${who}`);
          users[who] = { email, id: "", token: "" };
          createUser(AUTH(), ptoken, idempotencyKey(), {
            tenant_id: tenantId,
            identification_number: uniqueIdentificationNumber(),
            username: uniqueName(`cp-int-013-${who}`),
            email,
            password: PASSWORD,
          }).then((r) => {
            expect(r.status).to.eq(201);
            users[who].id = (r.body as { Id: string }).Id;
          });
          if (GRANTS[who].length > 0) {
            ensureRoleWithPermissions(AUTH(), ptoken, tenantId, `cp13-${who}`, GRANTS[who]).then((role) => {
              roles[who] = role;
              cy.then(() => assignRoleToUser(AUTH(), ptoken, tenantId, users[who].id, role.Id).its("status").should("eq", 200));
            });
          }
        });
        cy.then(() =>
          (Object.keys(GRANTS) as Who[]).forEach((who) =>
            login(AUTH(), { email: users[who].email, password: PASSWORD }).then((s) => {
              expect(s.status).to.eq(200);
              users[who].token = s.body.access_token;
            })
          )
        );
      });
    });
  });

  it("CA-04.1: users/read consulta, nunca se devuelve la contraseña; sin permiso 403; el propio usuario sí", () => {
    call(users.reader.token, "GET", "/users/").then((r) => {
      expect(r.status).to.eq(200);
      const list = r.body as Array<Record<string, unknown>>;
      expect(list.map((u) => u.Email)).to.include(users.plain.email);
      list.forEach((u) => expect(u).not.to.have.property("Password"));
      expect(JSON.stringify(r.body)).not.to.contain("argon2");
    });
    call(users.reader.token, "GET", `/users/${users.plain.id}`).its("body").should("not.have.property", "Password");
    call(users.reader.token, "GET", "/users/by-email", undefined, { email: users.plain.email }).its("body").should("not.have.property", "Password");
    call(users.plain.token, "GET", "/users/").then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body).to.deep.eq({ error: "insufficient permissions" });
    });
    call(users.plain.token, "GET", `/users/${users.plain.id}`).its("status").should("eq", 200);
    call(users.reader.token, "POST", "/users/", { email: uniqueEmail("no"), password: PASSWORD }).its("status").should("eq", 403);
  });

  it("CA-04.2: crear valida y devuelve el usuario; correo duplicado 409", () => {
    call(users.helper.token, "POST", "/users/", { username: "x", password: PASSWORD }).then((r) => {
      expect(r.status).to.eq(400);
      expect(r.body.error).to.eq("email is required");
    });
    call(users.helper.token, "POST", "/users/", { email: uniqueEmail("debil"), password: "abc" }).its("status").should("eq", 400);
    call(users.helper.token, "POST", "/users/", { email: users.plain.email, password: PASSWORD }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("a user with this email already exists for this tenant");
    });
    const email = uniqueEmail("cp-int-013-nuevo");
    call(users.helper.token, "POST", "/users/", { identification_number: "123", username: "nuevo", email, password: PASSWORD }).then((r) => {
      expect(r.status).to.eq(201);
      expect(r.body).to.deep.include({ Email: email, Username: "nuevo", TenantId: tenantId });
      expect(r.body).not.to.have.property("Password");
    });
  });

  it("CA-04.3: editar sin contraseña la conserva; con contraseña la cambia; correo duplicado 409", () => {
    call(users.helper.token, "PUT", `/users/${users.plain.id}`, {
      identification_number: "999",
      username: "plain-editado",
      email: users.plain.email,
    }).its("status").should("eq", 200);
    login(AUTH(), { email: users.plain.email, password: PASSWORD }).its("status").should("eq", 200);
    call(users.helper.token, "PUT", `/users/${users.plain.id}`, { email: users.plain.email, password: "abc" }).its("status").should("eq", 400);
    call(users.helper.token, "PUT", `/users/${users.plain.id}`, { email: users.reader.email }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("a user with this email already exists for this tenant");
    });
    const newPassword = "Cambiada!Kali2026";
    call(users.helper.token, "PUT", `/users/${users.plain.id}`, { username: "plain-editado", email: users.plain.email, password: newPassword })
      .its("status")
      .should("eq", 200);
    login(AUTH(), { email: users.plain.email, password: PASSWORD }).its("status").should("eq", 401);
    login(AUTH(), { email: users.plain.email, password: newPassword }).then((s) => {
      expect(s.status).to.eq(200);
      users.plain.token = s.body.access_token;
    });
    call(users.helper.token, "GET", `/users/${users.plain.id}`).its("body.Username").should("eq", "plain-editado");
  });

  it("CA-04.6: no se edita ni elimina a quien tiene más privilegios; uno mismo sí", () => {
    call(users.helper.token, "PUT", `/users/${users.admin.id}`, { email: users.admin.email, password: "Tomada!Kali2026" }).then((r) => {
      expect(r.status).to.eq(403);
      expect(r.body.error).to.eq("cannot manage a user with privileges you do not have");
    });
    call(users.helper.token, "DELETE", `/users/${users.admin.id}`).its("status").should("eq", 403);
    call(users.helper.token, "PUT", `/users/${users.helper.id}`, { username: "yo-mismo", email: users.helper.email }).its("status").should("eq", 200);
    // Asignar roles sigue las reglas RBAC: users/manage no basta.
    call(users.helper.token, "POST", "/rbac/users/roles/assign", { user_id: users.plain.id, role_id: roles.admin.Id }).its("status").should("eq", 403);
  });

  it("CA-04.8: eliminar un usuario con roles da 409; sin roles se elimina", () => {
    call(users.admin.token, "DELETE", `/users/${users.reader.id}`).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("user has roles assigned");
    });
    const email = uniqueEmail("cp-int-013-borrable");
    call(users.admin.token, "POST", "/users/", { email, password: PASSWORD }).then((created) => {
      call(users.admin.token, "DELETE", `/users/${created.body.Id}`).its("status").should("eq", 204);
      call(users.admin.token, "GET", `/users/${created.body.Id}`).its("status").should("eq", 404);
    });
  });

  it("CA-04.9: un usuario eliminado pierde acceso con sus tokens (auth inmediato; facturación ≤ 5 s)", () => {
    const biller = users.biller;
    cy.request({ url: `${INVOICE()}/api/v1/invoices?page=1&page_size=1`, headers: { Authorization: `Bearer ${biller.token}` } })
      .its("status")
      .should("eq", 200);
    // Se le quita el rol (con las reglas RBAC) y luego se elimina.
    call(ptoken, "POST", "/rbac/users/roles/remove", { tenant_id: tenantId, user_id: biller.id, role_id: roles.biller.Id }).its("status").should("eq", 200);
    call(ptoken, "DELETE", `/users/${biller.id}`, undefined, { tenant_id: tenantId }).its("status").should("eq", 204);
    call(biller.token, "GET", "/auth/session").then((r) => {
      expect(r.status).to.eq(401);
      expect(r.body.error).to.eq("invalid access token");
    });
    cy.wait(CACHE_MS);
    cy.request({
      url: `${INVOICE()}/api/v1/invoices?page=1&page_size=1`,
      headers: { Authorization: `Bearer ${biller.token}` },
      failOnStatusCode: false,
    }).then((r) => {
      expect(r.status).to.eq(401);
      expect(r.body.error).to.eq("invalid access token");
    });
  });

  it("CA-04.7: no se puede eliminar al último administrador efectivo", () => {
    call(ptoken, "DELETE", `/users/${users.admin.id}`, undefined, { tenant_id: tenantId }).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("operation would leave the tenant without an administrator");
    });
    call(users.admin.token, "DELETE", `/users/${users.admin.id}`).its("status").should("eq", 409);
  });

  it("CA-04.5: aislamiento y suspensión", () => {
    loginAsAdmin().then((platform) => {
      call(users.admin.token, "GET", `/users/${platform.user_id}`).its("status").should("eq", 404);
      call(users.admin.token, "DELETE", `/users/${platform.user_id}`).its("status").should("eq", 404);
      call(users.admin.token, "GET", "/users/", undefined, { tenant_id: platform.tenant_id }).then((r) => {
        expect(r.status).to.eq(403);
        expect(r.body.error).to.eq("tenant mismatch");
      });
    });
    call(ptoken, "POST", `/tenants/${tenantId}/suspend`).its("status").should("eq", 200);
    call(users.admin.token, "GET", "/users/").its("status").should("eq", 403);
    call(ptoken, "POST", `/tenants/${tenantId}/activate`).its("status").should("eq", 200);
    call(users.admin.token, "GET", "/users/").its("status").should("eq", 200);
  });
});

describe("CP-INT-013 - Cierre del incremento 3", () => {
  let ptoken = "";
  let tenantId = "";
  const admin = uniqueEmail("cp-int-013b-admin");
  const assigner = uniqueEmail("cp-int-013b-asignador");
  const target = uniqueEmail("cp-int-013b-objetivo");
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  before(() => {
    loginAsAdmin().then((platform) => {
      ptoken = platform.access_token;
      createTenant(AUTH(), ptoken, { name: uniqueName("cp-int-013b") }).then((t) => {
        tenantId = t.body.Id;
        [admin, assigner, target].forEach((email) =>
          createUser(AUTH(), ptoken, idempotencyKey(), {
            tenant_id: tenantId,
            identification_number: uniqueIdentificationNumber(),
            username: email.split("@")[0].slice(0, 40),
            email,
            password: PASSWORD,
          }).then((r) => (ids[email] = (r.body as { Id: string }).Id))
        );
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "todo", [["*", "*"]]).then((role) =>
          cy.then(() => assignRoleToUser(AUTH(), ptoken, tenantId, ids[admin], role.Id).its("status").should("eq", 200))
        );
        ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "solo-asignaciones", [["rbac", "manage"]]).then((role) =>
          cy.then(() => assignRoleToUser(AUTH(), ptoken, tenantId, ids[assigner], role.Id).its("status").should("eq", 200))
        );
        cy.then(() =>
          [admin, assigner].forEach((email) =>
            login(AUTH(), { email, password: PASSWORD }).then((s) => (tokens[email] = s.body.access_token))
          )
        );
      });
    });
  });

  it("D3-04: nadie se elimina a sí mismo desde el módulo; otro administrador sí puede eliminar (respetando reglas)", () => {
    call(tokens[admin], "DELETE", `/users/${ids[admin]}`).then((r) => {
      expect(r.status).to.eq(409);
      expect(r.body.error).to.eq("you cannot delete your own user");
    });
    // Otro administrador autorizado (la plataforma) llega a las reglas normales:
    // aquí admin es el único administrador efectivo → 409 por último administrador.
    call(ptoken, "DELETE", `/users/${ids[admin]}`, undefined, { tenant_id: tenantId }).its("body.error")
      .should("eq", "operation would leave the tenant without an administrator");
  });

  it("ninguna respuesta de usuarios expone contraseñas ni hashes (crear, editar, consultar)", () => {
    const email = uniqueEmail("cp-int-013b-hash");
    call(tokens[admin], "POST", "/users/", { email, password: PASSWORD }).then((created) => {
      expect(created.status).to.eq(201);
      const id = created.body.Id as string;
      [created].forEach((r) => {
        expect(JSON.stringify(r.body)).not.to.match(/Password|argon2|\$2[aby]\$/);
      });
      call(tokens[admin], "PUT", `/users/${id}`, { email, password: "Otra!Clave2026x" }).then((r) => {
        expect(r.status).to.eq(200);
        expect(JSON.stringify(r.body ?? "")).not.to.match(/Password|argon2|Otra!Clave/);
      });
      call(tokens[admin], "GET", `/users/${id}`).then((r) => expect(JSON.stringify(r.body)).not.to.match(/Password|argon2/));
      call(tokens[admin], "GET", "/users/").then((r) => expect(JSON.stringify(r.body)).not.to.match(/Password|argon2/));
      call(tokens[admin], "GET", "/users/by-email", undefined, { email }).then((r) => expect(JSON.stringify(r.body)).not.to.match(/Password|argon2/));
    });
  });

  it("solo rbac/manage: consulta lo necesario para asignar y asigna lo que cubre, sin gestionar roles ni usuarios", () => {
    const t = tokens[assigner];
    call(t, "GET", "/roles").its("status").should("eq", 200);
    call(t, "GET", "/permissions").its("status").should("eq", 200);
    call(t, "GET", "/users/").its("status").should("eq", 200);
    call(t, "POST", "/roles/", { name: "no-permitido" }).its("status").should("eq", 403);
    call(t, "POST", "/users/", { email: uniqueEmail("no"), password: PASSWORD }).its("status").should("eq", 403);
    // Un rol sin permisos se puede asignar (no otorga nada que no tenga); uno con */* no.
    ensureRoleWithPermissions(AUTH(), ptoken, tenantId, "vacio", []).then((empty) =>
      call(t, "POST", "/rbac/users/roles/assign", { user_id: ids[target], role_id: empty.Id }).its("status").should("eq", 200)
    );
    call(t, "GET", "/roles").then((r) => {
      const todo = (r.body as RoleResponse[]).find((x) => x.Name === "todo")!;
      call(t, "POST", "/rbac/users/roles/assign", { user_id: ids[target], role_id: todo.Id }).its("status").should("eq", 403);
    });
  });

  it("solo tenants/manage en la plataforma: llega a la administración de empresas", () => {
    const email = uniqueEmail("cp-int-013b-solo-empresas");
    loginAsAdmin().then((platform) => {
      createUser(AUTH(), ptoken, idempotencyKey(), {
        tenant_id: platform.tenant_id,
        identification_number: uniqueIdentificationNumber(),
        username: email.split("@")[0].slice(0, 40),
        email,
        password: PASSWORD,
      }).then((u) => {
        ensureRoleWithPermissions(AUTH(), ptoken, platform.tenant_id, uniqueName("solo-empresas"), [["tenants", "manage"]]).then((role) =>
          assignRoleToUser(AUTH(), ptoken, platform.tenant_id, (u.body as { Id: string }).Id, role.Id).its("status").should("eq", 200)
        );
      });
      login(AUTH(), { email, password: PASSWORD }).then((s) => {
        expect(s.body.is_platform_tenant).to.eq(true);
        call(s.body.access_token, "GET", "/tenants/").its("status").should("eq", 200);
        call(s.body.access_token, "GET", "/users/").its("status").should("eq", 403);
      });
    });
  });
});
