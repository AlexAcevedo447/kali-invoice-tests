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

```bash
# Cypress
cd cypress && docker compose build
KALI_AUTH_ADMIN_PASSWORD='<contraseña>' docker compose run --rm cypress --spec "e2e/api/**/*.cy.ts"

# JMeter
cd jmeter && docker compose build
docker compose run --rm jmeter validate
KALI_PLATFORM_ADMIN_PASSWORD='<…>' KALI_PERF_USER_PASSWORD='<…>' docker compose run --rm jmeter provision
KALI_PERF_USER_PASSWORD='<…>' docker compose run --rm jmeter smoke
```

Resultados: `cypress/results/` y `jmeter/results/<fecha>-<ambiente>-<perfil>/`.
