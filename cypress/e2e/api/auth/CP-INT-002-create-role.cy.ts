import { createRole } from "../../../support/api/auth/auth-client";
import { loginAsAdmin } from "../../../support/api/auth/session";
import { idempotencyKey, uniqueName } from "../../../support/data/unique";
import { captureEvidence } from "../../../support/evidence";

describe("CP-INT-002 - Crear rol", () => {
  it("crea un rol nuevo autenticado con JWT y valida idempotencia real (replay y conflicto)", () => {
    loginAsAdmin().then((session) => {
      const key = idempotencyKey();
      const payload = {
        tenant_id: Cypress.env("AUTH_TENANT_ID"),
        name: uniqueName("cp-int-002-role"),
        description: "Rol creado por CP-INT-002",
      };

      createRole(Cypress.env("AUTH_API_URL"), session.access_token, key, payload).then(
        (firstResponse) => {
          expect(firstResponse.status).to.eq(201);
          // Desde el incremento 2, POST /roles devuelve el rol creado (antes, cuerpo vacío).
          const created = firstResponse.body as { Id: string; Name: string; Description: string };
          expect(created.Id).to.be.a("string").and.not.be.empty;
          expect(created).to.deep.include({ Name: payload.name, Description: payload.description });

          // Mismo body + misma Idempotency-Key: el middleware de kali-auth-context
          // no vuelve a ejecutar el handler, responde con el status/body cacheados
          // de la primera petición y agrega el header `Idempotent-Replayed: true`.
          createRole(Cypress.env("AUTH_API_URL"), session.access_token, key, payload).then(
            (replayResponse) => {
              expect(replayResponse.status).to.eq(201);
              expect(replayResponse.headers["idempotent-replayed"]).to.eq("true");
              // El replay devuelve exactamente el mismo rol (no se crea otro).
              expect(replayResponse.body).to.deep.eq(firstResponse.body);

              // Misma Idempotency-Key + body distinto (fingerprint distinto):
              // el middleware responde 422 sin llegar a ejecutar el handler.
              createRole(Cypress.env("AUTH_API_URL"), session.access_token, key, {
                ...payload,
                description: "Descripción distinta para forzar conflicto de idempotencia",
              }).then((conflictResponse) => {
                expect(conflictResponse.status).to.eq(422);
                const conflictBody = conflictResponse.body as { error: string };
                expect(conflictBody.error).to.be.a("string").and.not.empty;
                captureEvidence("02-CP-INT-002-crear-rol");
              });
            }
          );
        }
      );
    });
  });
});
