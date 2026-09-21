import { defineConfig } from "cypress";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  projectId: 'agqpnh',
  e2e: {
    setupNodeEvents(on, config) {
      config.baseUrl = config.env.FRONT_URL || null;

      // Solo lo usa el flujo de evidencia GA9 (test:ga9:open, cypress/e2e/evidence/GA9-all-tests.cy.ts).
      // cy.screenshot(name) siempre anida bajo <screenshotsFolder>/<spec>/,
      // así que este task aplana ese resultado a cypress/screenshots/GA9/
      // tal como pide la evidencia SENA. No se invoca desde ningún otro flujo
      // ni cambia el comportamiento de screenshots para el resto de specs.
      on("task", {
        flattenGA9Screenshots() {
          const screenshotsFolder = (config.screenshotsFolder as string) ?? "cypress/screenshots";
          const specFolder = path.join(screenshotsFolder, "GA9-all-tests.cy.ts");
          const nestedDir = path.join(specFolder, "GA9");
          const targetDir = path.join(screenshotsFolder, "GA9");

          if (!fs.existsSync(nestedDir)) {
            return null;
          }

          fs.mkdirSync(targetDir, { recursive: true });
          for (const file of fs.readdirSync(nestedDir)) {
            fs.renameSync(path.join(nestedDir, file), path.join(targetDir, file));
          }
          fs.rmSync(specFolder, { recursive: true, force: true });

          return null;
        },
      });

      return config;
    },
  },
  env: {
    // Base URL of kali-auth-context (no path suffix, e.g. http://localhost:18080).
    AUTH_API_URL: "",
    // Base URL of kali-invoice-service (no path suffix, e.g. http://localhost:8080;
    // confirmado contra docker-compose.dev.yml/.env.dev del servicio: APP_PORT=8080).
    INVOICE_API_URL: "",
    // Base URL of invoice-kali-front (e.g. http://localhost:5173), usado como
    // baseUrl de Cypress para las specs de cypress/e2e/ui/*.
    FRONT_URL: "",
    // Tenant used to authenticate and to scope created roles/users in Auth.
    AUTH_TENANT_ID: "",
    // Credentials of a pre-seeded Auth admin able to create roles/users.
    AUTH_ADMIN_EMAIL: "",
    AUTH_ADMIN_PASSWORD: "",
  },
});
