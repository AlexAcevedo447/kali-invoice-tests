# kali-invoice-tests / jmeter

Pruebas de rendimiento de InvoiceKali con **Apache JMeter 5.6.3**. Herramienta **independiente**
de Cypress (`../cypress`): tiene su propio `Dockerfile`, configuración, comandos, pipeline
(`.github/workflows/jmeter.yml`) y carpeta de resultados. No necesita Node ni Cypress.

## Qué se prueba

`plans/invoice-kali.jmx`, por usuario virtual:

1. **Login** del usuario de performance (una vez por usuario).
2. Búsqueda del cliente y del producto de performance (una vez por usuario).
3. En cada iteración: **consultar facturas** (`GET /api/v1/invoices`) y **crear una factura**
   (`POST /api/v1/invoices`, con `Idempotency-Key` única).

Solo usa **datos exclusivos de performance**: la empresa `perf` ("Kali Performance"), el usuario
`perf.load@kali.local`, el cliente `PERF-CLIENTE-001` y el producto `PERF-PROD-001`. Las facturas
que crea quedan en esa empresa y no afectan a las de otras pruebas ni a datos reales.

## Comandos (`scripts/run.sh`)

| Comando | Qué hace | Red | Credenciales |
| --- | --- | --- | --- |
| `validate` | Carga los dos planes sin ejecutar usuarios; falla si un `.jmx` es inválido | No | — |
| `provision` | Crea o reutiliza (idempotente) la empresa, rol, usuario, cliente y producto de performance | Sí | `KALI_PLATFORM_ADMIN_PASSWORD`, `KALI_PERF_USER_PASSWORD` |
| `smoke` | **Ejecución mínima**: 1 usuario, 1 iteración; debe terminar sin errores | Sí | `KALI_PERF_USER_PASSWORD` |
| `load` | Ejecuta primero `smoke` y **solo si pasa** el perfil de carga (`config/profiles/load.properties`) | Sí | `KALI_PERF_USER_PASSWORD` |

Orden recomendado: `validate` → `provision` (una vez por ambiente) → `smoke` → `load`.
El volumen se ajusta con `-Jthreads=… -Jrampup=… -Jloops=…` (no se aceptan credenciales como `-J`).

## Ambientes

`--env NOMBRE` o `KALI_PERF_ENV` elige `config/environments/<NOMBRE>.properties`:

- `local` (**por defecto** fuera de Docker): stack en `localhost` (`npm run stack:up` del front).
- `local-docker` (**por defecto** en la imagen): stack en el host vía `host.docker.internal`.
- `test.properties.example`: plantilla para un ambiente compartido de pruebas (copiar a `test.properties`, ignorado por git).
- `production.properties.example`: **bloqueado por defecto**. Con `kali.environment.kind=production`
  el script aborta con código 3 antes de cualquier conexión, salvo habilitación explícita:
  `KALI_ALLOW_PRODUCTION_LOAD=SI-AUTORIZO-CARGA-EN-PRODUCCION`. El pipeline no ofrece producción.

## Credenciales

Solo por variables de entorno en tiempo de ejecución. No están en el repositorio, en la imagen,
en los planes ni en los resultados:

- El plan lee la contraseña con `__groovy(System.getenv('KALI_PERF_USER_PASSWORD'))`, no con
  propiedades `-J` (que JMeter escribe en `jmeter.log`).
- `config/jmeter-results.properties` guarda solo métricas: sin cuerpos, cabeceras ni datos del
  sampler (el cuerpo del login lleva la contraseña y las cabeceras el token).
- Al terminar, `run.sh` busca el valor de cada contraseña en la carpeta de resultados y, si
  aparece, falla (código 4).

## Ejecución en contenedor de tarea (sin Java en el equipo)

```bash
cd jmeter
docker compose build                                     # imagen kali-tests-jmeter:5.6.3
docker compose run --rm jmeter validate
export KALI_PLATFORM_ADMIN_PASSWORD='<contraseña del administrador de plataforma>'
export KALI_PERF_USER_PASSWORD='<contraseña del usuario de performance>'   # 12+ caracteres, mayúscula, minúscula, número y símbolo
docker compose run --rm jmeter provision
docker compose run --rm jmeter smoke
docker compose run --rm jmeter load -Jthreads=10 -Jloops=20
docker compose run --rm jmeter smoke --env test          # requiere config/environments/test.properties
```

El contenedor se ejecuta y termina (`--rm`); no es un servicio permanente ni forma parte del
despliegue de producción de Kali.

## Ejecución en el equipo (JMeter instalado)

```bash
cd jmeter
JMETER_BIN=/ruta/a/apache-jmeter-5.6.3/bin/jmeter ./scripts/run.sh smoke --env local
```

Requiere Java 17+, JMeter 5.6.3 y `jq`.

## Resultados

`results/<fecha>-<ambiente>-<perfil>/` (ignorado por git; en contenedor, `/perf/results`):

- `results.jtl`: métricas por muestra (CSV).
- `report/index.html`: informe HTML de JMeter (tiempos, percentiles, errores).
- `summary.txt`: muestras, errores y tiempos por operación.
- `jmeter.log` y `console.log`.

## Estructura

```
jmeter/
├── Dockerfile, .dockerignore, compose.yaml
├── config/
│   ├── environments/   local, local-docker, test.example, production.example
│   ├── profiles/       validate, smoke, load
│   └── jmeter-results.properties
├── plans/              invoice-kali.jmx, provision-perf-data.jmx
├── scripts/            run.sh, provision.groovy
└── results/            (ignorado por git)
```
