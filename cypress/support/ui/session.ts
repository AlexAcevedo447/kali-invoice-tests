import { login } from "../api/auth/auth-client";

/**
 * invoice-kali-front persiste la sesión en localStorage bajo esta clave,
 * usando el middleware `persist` de Zustand (src/app/state/authSessionStore.ts).
 * El formato exacto es `{ state: {...campos persistidos...}, version: 0 }`.
 */
const AUTH_STORAGE_KEY = "auth-session-store";

/**
 * Autentica una sola vez por corrida usando el endpoint real de Auth
 * (no la UI de login) y cachea la sesión con cy.session(), evitando repetir
 * el flujo de login en cada test. El JWT es real, emitido por Auth; no se
 * falsifica ningún token, solo se evita reescribir el formulario de login
 * en cada spec.
 */
export function loginToUI(): void {
  const tenantId = Cypress.env("AUTH_TENANT_ID");
  const email = Cypress.env("AUTH_ADMIN_EMAIL");
  const password = Cypress.env("AUTH_ADMIN_PASSWORD");

  cy.session(
    ["ui-session", tenantId, email],
    () => {
      cy.visit("/login");

      login(Cypress.env("AUTH_API_URL"), {
        tenant_id: tenantId,
        email,
        password,
      }).then((response) => {
        expect(response.status).to.eq(200);
        const session = response.body;

        cy.window().then((win) => {
          win.localStorage.setItem(
            AUTH_STORAGE_KEY,
            JSON.stringify({
              state: {
                status: "authenticated",
                accessToken: session.access_token,
                tenantId: session.tenant_id,
                userId: session.user_id,
                email: session.email,
                roles: session.roles,
                permissions: session.permissions,
              },
              version: 0,
            })
          );
        });
      });
    },
    {
      validate() {
        cy.window().then((win) => {
          const raw = win.localStorage.getItem(AUTH_STORAGE_KEY);
          expect(raw, "auth-session-store presente en localStorage").to.be.a("string");
          expect(raw as string).to.contain("authenticated");
        });
      },
    }
  );
}
