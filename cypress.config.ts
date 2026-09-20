import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    setupNodeEvents(_on, config) {
      config.baseUrl = config.env.FRONT_URL || null;
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
