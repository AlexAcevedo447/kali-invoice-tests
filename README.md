# kali-invoice-tests

Infraestructura de pruebas de InvoiceKali. Contiene dos herramientas **independientes**:

| Herramienta | Carpeta | Qué prueba | Requiere | Imagen | Pipeline |
| --- | --- | --- | --- | --- | --- |
| Cypress 15.21.0 | [`cypress/`](cypress/README.md) | Integración de API, interfaz y flujos E2E | Node (o solo Docker) | `kali-tests-cypress:15.21.0` | `.github/workflows/cypress.yml` |
| Apache JMeter 5.6.3 | [`jmeter/`](jmeter/README.md) | Rendimiento: login, consulta y creación de facturas | Java (o solo Docker) | `kali-tests-jmeter:5.6.3` | `.github/workflows/jmeter.yml` |

## Independencia

- Cada carpeta tiene sus dependencias, `Dockerfile`, configuración de ejemplo, comandos,
  pipeline y resultados. Ninguna lee archivos de la otra.
- Cypress no necesita Java ni JMeter; JMeter no necesita Node ni Cypress (cada imagen solo
  contiene su herramienta).
- Ambas se ejecutan como **contenedores de tarea** (`docker compose run --rm …`): corren y
  terminan; no hay servicios permanentes ni dependencias entre ellas.

## Separación de producción

Esta infraestructura de pruebas no forma parte del despliegue de Kali: los servicios se
despliegan desde sus propios repositorios y archivos (`docker-compose.prod.yml` de cada servicio),
que no referencian estas imágenes. Las pruebas apuntan a ambientes explícitos (`local` por
defecto); Cypress no admite producción y JMeter la bloquea salvo habilitación explícita.

## Credenciales

Nunca en el repositorio, en las imágenes ni en los resultados: se pasan como variables de
entorno al ejecutar (ver el README de cada herramienta).

## Inicio rápido (stack local con `npm run stack:up` en `invoice-kali-front`)

Cada bloque se ejecuta por separado: ninguno necesita la otra herramienta.

```bash
# Cypress (solo Docker)
cd cypress && docker compose build
export KALI_AUTH_ADMIN_PASSWORD='<contraseña>' KALI_DEMO_ADMIN_PASSWORD='<contraseña>'
docker compose run --rm cypress --spec "e2e/api/**/*.cy.ts"                  # contra Vite (15173)
KALI_TEST_ENV=local-docker-build docker compose run --rm cypress             # contra el front compilado (15081)

# JMeter (solo Docker)
cd jmeter && docker compose build
docker compose run --rm jmeter validate
export KALI_PLATFORM_ADMIN_PASSWORD='<…>' KALI_PERF_USER_PASSWORD='<…>'
docker compose run --rm jmeter provision
docker compose run --rm jmeter smoke
docker compose run --rm jmeter load              # validación funcional
scripts/host/concurrency-local.sh                # concurrencia local 1/5/10 usuarios + recursos
```

Resultados: `cypress/results/` y `jmeter/results/<fecha>-<ambiente>-<perfil>/`. Las cifras
verificadas y sus límites están en [`RESULTADOS.md`](RESULTADOS.md).

## Pipelines

- `cypress.yml`: tipos e imagen; luego la suite completa contra el **front compilado** sobre un
  stack local efímero en el runner (PR, push a `main` y a demanda). Los logs del front, las APIs,
  las bases y la consola del navegador se guardan como artefacto **siempre**, también si falla.
  A demanda puede ejecutarse contra el ambiente `test`; nunca contra producción.
- `jmeter.yml`: imagen, `validate` y prueba del bloqueo de producción; ejecución manual contra `test`.
