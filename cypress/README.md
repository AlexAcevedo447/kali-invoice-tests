# kali-invoice-tests / cypress

Pruebas de aceptación (API, UI y flujos E2E) de InvoiceKali con **Cypress + TypeScript**.
Herramienta **independiente** de JMeter (`../jmeter`): tiene su propio `package.json`,
`Dockerfile`, configuración, comandos, pipeline (`.github/workflows/cypress.yml`) y carpeta de
resultados. No necesita Java ni JMeter. Todos los comandos se ejecutan **desde esta carpeta**.

## Ambientes y credenciales

- `KALI_TEST_ENV` elige `config/environments/<ambiente>.json` (por defecto **`local`**):
  - `local`: Cypress en el equipo y stack en `localhost` (`npm run stack:up` del front: 15173, 18080, 8080).
  - `local-docker`: Cypress en contenedor y stack en el host (`host.docker.internal`). Es el valor por defecto de la imagen.
  - `local-docker-build`: igual, pero contra el front **compilado** servido por nginx con la
    configuración de producción local del front (`docker compose -f docker-compose.prod.local.yml up -d --build`
    en `invoice-kali-front`, puerto 15081).
  - `test.example.json`: plantilla para un ambiente compartido de pruebas (copiar a `test.json`).
  - Producción: **no soportada** (Cypress crea y modifica datos); `cypress.config.ts` la rechaza.
- Los archivos de ambiente solo tienen URLs y correos (sin secretos). Las **contraseñas** nunca
  van en el repositorio ni en la imagen; se pasan en tiempo de ejecución:
  - variables `CYPRESS_AUTH_ADMIN_PASSWORD` y `CYPRESS_DEMO_ADMIN_PASSWORD` (esta última solo para la semilla demo), o
  - un `cypress.env.json` local (ignorado por git) creado desde `cypress.env.example.json`.
- Precedencia: `CYPRESS_*` > `cypress.env.json` > archivo del ambiente. Si falta un valor
  obligatorio, Cypress se detiene indicando cuál (sin mostrar valores).

| Variable | Descripción |
| --- | --- |
| `AUTH_API_URL` | URL base de `kali-auth-context`, ej. `http://localhost:18080` |
| `INVOICE_API_URL` | URL base de `kali-invoice-service`, ej. `http://localhost:8080` |
| `FRONT_URL` | URL base de `invoice-kali-front` (baseUrl de las pruebas UI), ej. `http://localhost:15173` |
| `AUTH_TENANT_ID` | Tenant interno del administrador de plataforma |
| `AUTH_ADMIN_EMAIL` | Correo del administrador de plataforma sembrado |
| `AUTH_ADMIN_PASSWORD` | Contraseña de ese administrador (**solo** por variable o `cypress.env.json`) |
| `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` | Administrador de "Empresa Demo" (semilla del video) |

## Ejecución en el equipo (Node)

```bash
cd cypress
npm ci
export CYPRESS_AUTH_ADMIN_PASSWORD='<contraseña del administrador>'   # o cypress.env.json
npm run typecheck
npx cypress run --browser electron --spec "e2e/api/**/*.cy.ts"
npx cypress run --browser electron --spec "e2e/api/**/*.cy.ts,e2e/ui/**/*.cy.ts,e2e/manual/GA10-validacion-manual.cy.ts,e2e/demo/seed-video-demo.cy.ts"
```

Otros atajos (`package.json`): `npm run cy:open`, `npm run test:auth`, `npm run test:invoice`,
`npm run test:ui`, `npm run test:invoice:fresh`, `npm run test:all`. Las rutas de specs son
relativas a esta carpeta (`e2e/...`).

## Ejecución en contenedor de tarea (sin Node en el equipo)

```bash
cd cypress
docker compose build                                   # imagen kali-tests-cypress:15.21.0
export KALI_AUTH_ADMIN_PASSWORD='<contraseña>'         # y KALI_DEMO_ADMIN_PASSWORD para la semilla
docker compose run --rm cypress                        # suite completa
docker compose run --rm cypress --spec "e2e/api/**/*.cy.ts"
KALI_TEST_ENV=test docker compose run --rm cypress     # otro ambiente (requiere config/environments/test.json)
KALI_TEST_ENV=local-docker-build docker compose run --rm cypress   # contra el front compilado (15081)
docker compose run --rm -e ELECTRON_ENABLE_LOGGING=1 cypress       # además, consola del navegador en la salida
```

Diagnóstico de fallos: `support/e2e.ts` añade al mensaje de cada fallo el estado de la página
(URL, `readyState`, recursos cargados, los más lentos y los últimos). No cambia el resultado: el
error se relanza siempre. Ayuda a distinguir una página que no terminó de cargar de un fallo funcional.

El contenedor se ejecuta y termina (`--rm`); no es un servicio permanente ni parte del
despliegue de producción de Kali. La imagen no contiene credenciales ni resultados.

## Resultados

`results/` (ignorado por git): `results/screenshots`, `results/videos`, `results/downloads` y
los JSON que escriben algunas specs (p. ej. `results/GA10-observaciones.json`) y las duraciones
de red que registran (`results/timings/`, p. ej. `CP-E2E-009.jsonl`). En contenedor,
`results/` se monta en `/tests/results`.

## Pipeline (`.github/workflows/cypress.yml`)

- `verificar`: `npm ci` sin binario, tipos e imagen.
- `front-compilado` (PR, push a `main` y a demanda): clona `kali-auth-context`,
  `kali-invoice-service` e `invoice-kali-front` (ramas elegibles; por defecto `main`). Después:
  1. Levanta auth y facturación con sus compose de desarrollo.
  2. Detiene Vite y sirve el front compilado con `docker-compose.prod.local.yml` en el puerto 15081.
  3. Comprueba que nginx enruta facturación igual que el servicio directo.
  4. Corre la suite completa en una sola ejecución con `KALI_TEST_ENV=local-docker-build`.

  Siempre, también si falla, sube como artefacto `results/` y `logs/`: front, APIs, bases,
  estado de contenedores, salud del stack y consola del navegador (`ELECTRON_ENABLE_LOGGING=1`).
  Credenciales: las de desarrollo del propio stack efímero y una generada para la semilla demo,
  enmascaradas; si alguna aparece en los resultados, se descartan.
  Requiere que la rama del front tenga la configuración de producción local con enrutamiento a
  facturación y `extra_hosts`.
- `ambiente-test` (solo a demanda): contra el ambiente compartido `test`, con secretos del ambiente.

## Estructura de carpetas

```
cypress/                      # herramienta Cypress (raíz de este README)
├── package.json, package-lock.json, tsconfig.json, cypress.config.ts
├── Dockerfile, .dockerignore, compose.yaml     # contenedor de tarea
├── cypress.env.example.json                    # plantilla de secretos locales (sin valores)
├── config/environments/                        # local, local-docker, local-docker-build, test.example
├── e2e/
│   ├── api/ (auth, invoice, security)          # pruebas black-box HTTP
│   ├── ui/ (auth, invoice)                     # pruebas sobre React mediante navegador
│   ├── manual/                                 # GA10 (manual de usuario)
│   ├── demo/                                   # semilla de datos del video
│   └── evidence/, flows/
├── support/ (api, ui, data, assertions, commands.ts, e2e.ts)
├── fixtures/
├── scripts/                                    # BD exclusiva de Cypress y mantenimiento
└── results/                                    # resultados (ignorado por git)
```

## Principio arquitectónico

`kali-invoice-tests` solo debe conocer los **contratos públicos HTTP** y el **comportamiento observable de la UI** de InvoiceKali.

No debe importar código de:

- `kali-auth-context`
- `kali-invoice-service`
- frontend React

## Casos implementados

| Caso | Archivo | Servicio |
| --- | --- | --- |
| CP-INT-001 | `cypress/e2e/api/auth/CP-INT-001-login.cy.ts` | Auth |
| CP-INT-002 | `cypress/e2e/api/auth/CP-INT-002-create-role.cy.ts` | Auth |
| CP-INT-003 | `cypress/e2e/api/auth/CP-INT-003-create-user.cy.ts` | Auth |
| CP-INT-004 | `cypress/e2e/api/auth/CP-INT-004-get-user-by-email.cy.ts` | Auth |
| CP-INT-005 | `cypress/e2e/api/invoice/CP-INT-005-list-invoices.cy.ts` | Invoice |
| CP-INT-006 | `cypress/e2e/api/invoice/CP-INT-006-create-invoice.cy.ts` | Invoice |
| CP-INT-007 | `cypress/e2e/api/invoice/CP-INT-007-invoice-idempotency.cy.ts` | Invoice (idempotencia) |
| CP-INT-008 | `cypress/e2e/api/auth/CP-INT-008-login-multi-tenant.cy.ts` | Auth (login multiempresa: 409 sin código, `tenant_code`, código duplicado → 409) |
| CP-INT-010 | `cypress/e2e/api/auth/CP-INT-010-tenants-admin.cy.ts` | Auth (empresas: listar, crear, validar, editar, suspender/activar, 403 a otras empresas) |
| CP-INT-009 | `cypress/e2e/api/invoice/CP-INT-009-create-invoice-due-date.cy.ts` | Invoice (regresión: vencimiento anterior a la emisión al crear → 400) |
| CP-E2E-008 | `cypress/e2e/ui/auth/CP-E2E-008-tenants-admin.cy.ts` | UI (empresas: flujo completo de plataforma y acceso denegado a otra empresa) |
| CP-INT-011 | `cypress/e2e/api/auth/CP-INT-011-rbac-admin.cy.ts` | Auth (RBAC: autorización por operación, unicidad, idempotencia, 409, no escalamiento, administrador efectivo, rol sembrado) |
| CP-INT-012 | `cypress/e2e/api/invoice/CP-INT-012-invoice-permissions.cy.ts` | Invoice (permiso por operación) |
| CP-E2E-009 | `cypress/e2e/ui/auth/CP-E2E-009-rbac-admin.cy.ts` | UI (roles, permisos y asignaciones) |
| CP-INT-013 | `cypress/e2e/api/auth/CP-INT-013-users-admin.cy.ts` | Auth (usuarios: permisos, sin contraseñas, no escalar, 409 con roles, último administrador, tokens de usuario eliminado) |
| CP-E2E-010 | `cypress/e2e/ui/auth/CP-E2E-010-users-admin.cy.ts` | UI (usuarios y menú por permisos) |
| CP-SEC-001 | `cypress/e2e/api/security/CP-SEC-001-multi-tenant-isolation.cy.ts` | Auth + Invoice (aislamiento Tenant A vs Tenant B) |
| GA10 | `cypress/e2e/manual/GA10-validacion-manual.cy.ts` | UI completa (manual de usuario) |

Semilla del video (no es prueba): `cypress/e2e/demo/seed-video-demo.cy.ts`. Es repetible: reutiliza
empresa, administrador, catálogo y facturas existentes y solo crea lo que falte (nunca borra).
Si `DEMO_ADMIN_EMAIL` no puede iniciar sesión, crea con el administrador de plataforma la empresa
"Empresa Demo" (código `demo`), el usuario y el rol `invoicing`.

## Contrato multi-tenant vigente

- **Login**: `POST /api/v1/auth/login` con `{ email, password }`. El servidor resuelve el
  tenant de la cuenta; `tenant_code` (código legible de empresa) solo se envía si responde
  `409 company code required` (mismo correo y contraseña en varias empresas).
- **Facturación**: todas las rutas (salvo `/metrics`) exigen `Authorization: Bearer`; el
  tenant sale del claim `tid`. Clientes y productos deben existir en el catálogo del tenant
  (`/api/v1/customers`, `/api/v1/products`); `support/api/invoice/invoice-client.ts`
  expone `seedCatalog` para crearlos.
- **Auth**: el tenant de las rutas protegidas es el del token. Solo el tenant de plataforma
  (el maestro sembrado) administra empresas (`/tenants`) y puede indicar otro tenant destino.

Si Electron no logra conectarse ("Timed out waiting for the browser to connect"), ejecutar
con Chrome: `npx cypress run --browser chrome --headless --spec ...`.

## Hallazgos de contrato real (verificados contra el código de los servicios)

Estos hallazgos ajustaron las aserciones de los tests respecto a lo asumido en la
matriz original; se documentan aquí para que no se reintroduzcan como "bugs" del
test suite:

- **Auth `POST /api/v1/roles/` y `POST /api/v1/users/` responden `201` con el
  cuerpo literal `"Created"` como texto plano** (no JSON, no vacío; ambos
  handlers terminan en `c.SendStatus(fiber.StatusCreated)` sin adjuntar el
  recurso creado). CP-INT-002 y CP-INT-003 validan ese texto exacto vía
  `expectCreatedTextBody`; no hay ningún dato en esa respuesta que pueda
  filtrar la contraseña.
- **Auth sí implementa idempotencia real en `roles`/`users`** vía middleware:
  misma `Idempotency-Key` + mismo body → responde el status/body cacheados de
  la primera petición más el header `Idempotent-Replayed: true`; misma key +
  body distinto → `422` sin llegar a ejecutar el handler. CP-INT-002 valida
  ambos caminos.
- **Auth `GET /api/v1/users/by-email` serializa el struct de dominio sin tags
  JSON**, por lo que las claves llegan en PascalCase (`Id`, `Email`, `Password`,
  ...) y **el campo `Password` sí viaja en la respuesta**, aunque como hash
  bcrypt (`$2a$...`), nunca en texto plano. CP-INT-004 valida ambas cosas:
  presencia del hash y que no coincide con la contraseña original.
- **El header de replay de idempotencia difiere entre servicios**: Auth usa
  `Idempotent-Replayed` (sin prefijo `X-`) y Invoice usa `X-Idempotent-Replayed`
  (con prefijo). CP-INT-007 usa el nombre real de Invoice.
- **Invoice expone sus rutas bajo `/api/v1/invoices`**, no bajo `/invoices` como
  sugería el enunciado original; se confirmó contra el montaje real del router.
- **Invoice no implementa Authorization/JWT/tenant** en ninguna ruta; el cliente
  de Invoice nunca envía ese header, tal como especifica la tarea.
- Auth no valida duplicados de nombre de rol ni de email de usuario a nivel de
  aplicación (solo dependería de una posible constraint de base de datos, no
  verificada); por eso los casos CP-INT-002/003 usan siempre valores únicos y no
  se probó el camino de duplicados.
- **Invoice `POST /api/v1/invoices` devuelve `ID` como UUID v4 (string)** y
  `IssueDate`/`DueDate` como `time.Time` serializado por Go (RFC3339); si no se
  envían en el payload, el servicio los calcula (`issue_date = ahora`,
  `due_date = issue_date + 30 días`). CP-INT-006 valida formato de UUID,
  presencia/validez de ambas fechas y que `DueDate >= IssueDate`.
- **CP-INT-005 requiere una base de datos exclusiva para Cypress**: `GET
  /api/v1/invoices` no admite filtrar por `customer_id` ni por ningún campo
  propio del test (solo `page`/`page_size`), así que contra la base de
  desarrollo compartida (`kali_invoices_dev`) nunca se puede garantizar "sin
  registros". La solución no requiere tocar el servicio: sus variables
  `POSTGRES_*` (`internal/infrastructure/config/config.go`) permiten apuntarlo
  a cualquier base, y el propio servicio la crea (`ensureDatabaseExists`) y le
  aplica sus migraciones versionadas (`internal/infrastructure/db/migrator`)
  solo con arrancar. Ver la sección "Aislamiento de datos para CP-INT-005"
  más abajo.

## Aislamiento de datos para CP-INT-005

`CP-INT-005` exige `GET /api/v1/invoices` → `200` + `[]`. Eso solo es cierto
si Invoice apunta a una base vacía, así que **antes de correr la suite de
Invoice** hay que levantar una base Postgres exclusiva y desechable para
Cypress (nunca la base de desarrollo compartida) y arrancar el servicio contra
ella:

```bash
# 1) Crear (o recrear) la base exclusiva y efímera para Cypress
npm run invoice:test-db:up        # desde kali-invoice-tests/cypress

# 2) Arrancar kali-invoice-service apuntando a esa base (variables ya
#    soportadas por el servicio, ningún cambio de código):
cd ../../kali-invoice-service   # repo hermano de kali-invoice-tests
APP_PORT=8080 \
POSTGRES_HOST=localhost POSTGRES_PORT=5433 \
POSTGRES_USER=cypress POSTGRES_PASSWORD=cypress \
POSTGRES_DB=kali_invoices_cypress POSTGRES_SSLMODE=disable \
RABBITMQ_ENABLED=false \
go run ./cmd/api

# 3) Correr la suite de Invoice
cd ../kali-invoice-tests/cypress
npm run test:api:invoice

# 4) Al terminar, destruir la base (borra todos los datos de prueba)
npm run invoice:test-db:down
```

El contenedor (`kali-invoice-cypress-db`, ver `cypress/scripts/invoice-test-db.sh`) no
usa volumen nombrado: `invoice:test-db:down` borra sus datos por completo, y
`invoice:test-db:up` siempre arranca desde cero. Por eso "sin registros" no
depende de correr CP-INT-005 antes que CP-INT-006/007 — depende de que la base
se haya recreado justo antes de la corrida, sin importar en qué orden
ejecuten los specs dentro de ella. No se agregó ningún endpoint de limpieza ni
lógica de test dentro de `kali-invoice-service`, y no se tocó la base de
desarrollo compartida.

## UI

Las pruebas de UI usan atributos `data-cy` estables del front (`e2e/ui/**`, GA10 y
CP-E2E-005 a CP-E2E-012).
