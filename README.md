# kali-invoice-tests

Repositorio de pruebas de aceptación (API, UI y flujos E2E) para InvoiceKali, implementado con **Cypress + TypeScript**.

## Requisitos

- Node.js
- npm

## Instalación

```bash
npm install
```

## Configuración de entorno

Los tests no contienen credenciales ni URLs embebidas. `cypress.config.ts` solo
declara las variables configurables (vacías por defecto); los valores reales se
suministran localmente copiando `cypress.env.example.json` a `cypress.env.json`
(ignorado por git) en la raíz del repo:

```bash
cp cypress.env.example.json cypress.env.json
# editar cypress.env.json con los valores reales del entorno local
```

Variables requeridas:

| Variable             | Descripción                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `AUTH_API_URL`        | URL base de `kali-auth-context` (sin sufijo de path), ej. `http://localhost:18080` |
| `INVOICE_API_URL`     | URL base de `kali-invoice-service` (sin sufijo de path), ej. `http://localhost:8080` |
| `FRONT_URL`           | URL base de `invoice-kali-front`, reservada para futuras pruebas UI/E2E     |
| `AUTH_TENANT_ID`      | Tenant usado para autenticar y para crear roles/usuarios de prueba          |
| `AUTH_ADMIN_EMAIL`    | Email de un usuario administrador ya sembrado en Auth                      |
| `AUTH_ADMIN_PASSWORD` | Password de ese usuario administrador                                      |

Alternativamente, en CI se pueden suministrar como variables de entorno con
prefijo `CYPRESS_` (mecanismo nativo de Cypress), por ejemplo
`CYPRESS_AUTH_API_URL=http://localhost:18080`.

## Uso

Abrir Cypress en modo interactivo:

```bash
npm run cy:open
```

Ejecutar toda la suite en modo headless:

```bash
npm test
```

Ejecutar subconjuntos específicos:

```bash
npm run test:api:auth      # pruebas HTTP del servicio Auth
npm run test:api:invoice   # pruebas HTTP del servicio Invoice
npm run test:ui            # pruebas de UI (React) mediante navegador
npm run test:flows         # flujos E2E que involucran varios componentes
```

Atajos equivalentes, pensados para entornos donde `ELECTRON_RUN_AS_NODE` queda
seteado en el shell (rompe el binario de Cypress) y conviene forzar
`--browser electron` explícitamente:

```bash
npm run test:auth      # = test:api:auth, con la variable de entorno corregida
npm run test:invoice   # = test:api:invoice, ídem (NO resetea la BD de Invoice)
npm run test:ui        # sin cambios
```

`npm run test:invoice` por sí solo **no** garantiza una base vacía para
CP-INT-005. Para eso usa:

```bash
npm run test:invoice:fresh   # invoice:test-db:down -> invoice:test-db:up -> test:invoice
```

**Precondición manual, no automatizada a propósito**: `test:invoice:fresh`
destruye y recrea el contenedor Postgres exclusivo de Cypress
(`kali-invoice-cypress-db`). Si `kali-invoice-service` no reabre sola su
conexión contra el contenedor nuevo (mismo host/puerto, pero es un contenedor
distinto), `CP-INT-005` u otras pruebas de Invoice fallarán con errores de
conexión. Este repo no reinicia `kali-invoice-service` por ti —no le
corresponde gestionar el ciclo de vida de otro servicio—, así que si eso pasa,
reinicia manualmente el proceso/contenedor de `kali-invoice-service`
apuntando a `kali_invoices_cypress` (ver "Aislamiento de datos para
CP-INT-005" más abajo) y vuelve a correr el script.

```bash
npm run test:all   # test:auth -> test:invoice:fresh -> test:ui, en ese orden
```

`test:all` asume que Auth, Invoice (ya reconectado a la BD fresca si hizo
falta) y el frontend están arriba antes de invocarlo. No incluye
`test:flows`: hoy esa carpeta no tiene specs y `cypress run` falla si el
patrón no matchea ningún archivo.

## Estructura de carpetas

```
cypress/
├── e2e/
│   ├── api/
│   │   ├── auth/       # pruebas black-box HTTP del servicio Auth
│   │   └── invoice/    # pruebas black-box HTTP del servicio Invoice
│   ├── ui/
│   │   ├── auth/
│   │   └── invoice/    # pruebas sobre React mediante navegador
│   └── flows/          # flujos completos que involucran varios componentes
├── fixtures/            # datos de prueba
└── support/
    ├── api/             # clientes HTTP reutilizables
    ├── ui/              # acciones reutilizables sobre la UI
    ├── data/             # preparación/generación de datos
    ├── assertions/       # assertions reutilizables
    ├── commands.ts
    └── e2e.ts
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
npm run invoice:test-db:up

# 2) Arrancar kali-invoice-service apuntando a esa base (variables ya
#    soportadas por el servicio, ningún cambio de código):
cd ../kali-invoice-service
APP_PORT=8080 \
POSTGRES_HOST=localhost POSTGRES_PORT=5433 \
POSTGRES_USER=cypress POSTGRES_PASSWORD=cypress \
POSTGRES_DB=kali_invoices_cypress POSTGRES_SSLMODE=disable \
RABBITMQ_ENABLED=false \
go run ./cmd/api

# 3) Correr la suite de Invoice
cd ../kali-invoice-tests
npm run test:api:invoice

# 4) Al terminar, destruir la base (borra todos los datos de prueba)
npm run invoice:test-db:down
```

El contenedor (`kali-invoice-cypress-db`, ver `scripts/invoice-test-db.sh`) no
usa volumen nombrado: `invoice:test-db:down` borra sus datos por completo, y
`invoice:test-db:up` siempre arranca desde cero. Por eso "sin registros" no
depende de correr CP-INT-005 antes que CP-INT-006/007 — depende de que la base
se haya recreado justo antes de la corrida, sin importar en qué orden
ejecuten los specs dentro de ella. No se agregó ningún endpoint de limpieza ni
lógica de test dentro de `kali-invoice-service`, y no se tocó la base de
desarrollo compartida.

## UI

Aún no existen pruebas de UI/E2E. Se verificó que `invoice-kali-front` no cuenta
hoy con una estrategia estable de `data-cy`/`data-testid` en sus componentes, por
lo que no es posible escribir selectores confiables sin acoplarse a marcado
interno de PrimeReact. Esta tarea no modifica el frontend; se recomienda que el
equipo de frontend defina esa estrategia antes de iniciar `cypress/e2e/ui/*`.
