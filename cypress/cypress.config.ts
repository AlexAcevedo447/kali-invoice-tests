import { defineConfig } from "cypress";
import fs from "node:fs";
import path from "node:path";

/**
 * Cypress de kali-invoice-tests. Herramienta independiente de JMeter: no usa
 * Java ni archivos de ../jmeter.
 *
 * Ambiente explícito: KALI_TEST_ENV (por defecto "local") elige
 * config/environments/<ambiente>.json, que solo contiene URLs y datos no
 * secretos. Las contraseñas nunca van en el repositorio ni en la imagen: llegan
 * en tiempo de ejecución como variables CYPRESS_AUTH_ADMIN_PASSWORD /
 * CYPRESS_DEMO_ADMIN_PASSWORD o en un cypress.env.json local (ignorado por git).
 * Precedencia: CYPRESS_* > cypress.env.json > archivo del ambiente.
 * Cypress no se ejecuta contra producción (crea y modifica datos).
 */
const ENVIRONMENTS_DIR = path.join(__dirname, "config", "environments");
const REQUIRED = ["AUTH_API_URL", "INVOICE_API_URL", "FRONT_URL", "AUTH_ADMIN_EMAIL", "AUTH_ADMIN_PASSWORD"];

function applyEnvironment(config: Cypress.PluginConfigOptions): Cypress.PluginConfigOptions {
  const name = String(process.env.KALI_TEST_ENV || config.env.KALI_TEST_ENV || "local").trim();
  if (/^prod/i.test(name)) {
    throw new Error(`Ambiente "${name}" bloqueado: Cypress crea y modifica datos y no se ejecuta contra producción.`);
  }
  const file = path.join(ENVIRONMENTS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    const available = fs.readdirSync(ENVIRONMENTS_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    throw new Error(`Ambiente "${name}" no existe en config/environments (disponibles: ${available.join(", ")}).`);
  }
  const values = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
  for (const [key, value] of Object.entries(values)) {
    if (config.env[key] === undefined || config.env[key] === "") config.env[key] = value;
  }
  config.env.KALI_TEST_ENV = name;
  const missing = REQUIRED.filter((key) => !config.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Faltan valores para el ambiente "${name}": ${missing.join(", ")}. ` +
        "Las contraseñas se pasan como variables CYPRESS_<NOMBRE> o en cypress.env.json (ver README)."
    );
  }
  config.baseUrl = config.env.FRONT_URL;
  return config;
}

export default defineConfig({
  projectId: "agqpnh",
  // Resultados propios de esta herramienta (ignorados por git).
  screenshotsFolder: "results/screenshots",
  videosFolder: "results/videos",
  downloadsFolder: "results/downloads",
  fixturesFolder: "fixtures",
  e2e: {
    specPattern: "e2e/**/*.cy.{js,ts}",
    supportFile: "support/e2e.ts",
    setupNodeEvents(on, config) {
      // Solo lo usa el flujo de evidencia GA9 (test:ga9:open, e2e/evidence/GA9-all-tests.cy.ts).
      // cy.screenshot(name) siempre anida bajo <screenshotsFolder>/<spec>/,
      // así que este task aplana ese resultado a <screenshotsFolder>/GA9/
      // tal como pide la evidencia SENA. No se invoca desde ningún otro flujo
      // ni cambia el comportamiento de screenshots para el resto de specs.
      on("task", {
        flattenGA9Screenshots() {
          const screenshotsFolder = (config.screenshotsFolder as string) ?? "results/screenshots";
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

      return applyEnvironment(config);
    },
  },
});
