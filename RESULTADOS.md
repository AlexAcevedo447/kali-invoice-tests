# Resultados verificados y sus límites

Corridas del 15–16 de noviembre de 2026 en un solo equipo: macOS, Docker Desktop, contenedores
`linux/aarch64`. Cada corrida usó un ambiente local **limpio** (volúmenes de base de datos nuevos)
con los servicios en modo desarrollo. Ninguna se ejecutó contra producción ni contra ambientes
compartidos. Cada cifra corresponde a **una sola corrida**; no se suman corridas.

## Cypress (suite completa: 26 specs, 146 pruebas)

| Corrida | Front | Resultado | Duración |
| --- | --- | --- | --- |
| Réplica local del job `front-compilado` del pipeline | Compilado, nginx (`docker-compose.prod.local.yml`, 15081) | **146/146** | 5:32 |
| Corrida anterior contra el front compilado | Compilado, nginx | 146/146 | 5:30 |
| Contra Vite, con trazas por petición | Vite (desarrollo, 15173) | 145/146 | 9:37 |
| Contra Vite, sin trazas | Vite | 143/146 | 8:42 |

- **CP-E2E-009** (quitar un permiso del rol) se sincroniza con la respuesta de red, sin pausas ni
  tiempos globales. Duración registrada de la petición: 21–63 ms (`results/timings/CP-E2E-009.jsonl`).
- **GA10 3.4** crea su propio usuario existente: pasó **sola**, con `it.only` en una copia
  temporal, y dentro de la suite completa.
- **Fallos contra Vite**: todos son de la misma clase. La página no dispara `load` en 60 s, queda
  en `readyState=interactive` y React no monta. Ocurrieron en CP-E2E-011, CP-E2E-012 y GA10 3.3,
  y antes en GA10 3.7. Con el front compilado no ocurrieron en las dos corridas completas.
  **Eso no corrige el problema de Vite**.

### Investigación del cuelgue con Vite: causa NO determinada

Trazas cruzadas de un cuelgue: el servidor Vite (traza por petición en una copia de diagnóstico)
y el proxy de Cypress (`DEBUG=cypress-verbose:proxy:http`).

1. Vite respondió **todas** las peticiones que recibió (10 428 REQ: 10 423 respuestas y 5
   cancelaciones normales de API o fuentes al navegar). No re-optimizó dependencias y su CPU no
   pasó de ~14%.
2. En la carga colgada de `/invoicing/customers` llegaron a Vite 61 módulos; en las dos cargas
   normales previas de la misma página, 75. Faltan, entre otros, `NoAccessPage.tsx`,
   `router.tsx`, `CustomersPage.tsx` y `GenericTable.tsx`. Tras `RoleId.ts`, Vite no recibió
   ninguna petición durante 60,4 s.
3. El proxy de Cypress **recibió** del navegador la petición de `/src/app/routing/NoAccessPage.tsx`
   y la preparó para reenviarla. Después no registró respuesta ni error, hasta `request aborted +1m`
   (la cancelación al vencer los 60 s). **Vite nunca registró esa petición.**

Conclusión verificada: la petición se pierde **entre la salida del proxy de Cypress y la capa
HTTP de Vite**, en el tramo `host.docker.internal:15173` que reenvía Docker Desktop. Con estas
trazas no es posible distinguir si:

- el proxy no llegó a enviarla;
- el reenvío de Docker la perdió;
- o llegó incompleta al socket de Vite.

Tampoco se descarta un problema de configuración o de código. Falta una captura de red en ambos
extremos (contenedor de Cypress y contenedor del front).

## JMeter

### Validación funcional (`load`: 5 usuarios × 10 iteraciones, sin pausas)

115 peticiones y 0 errores en 8,3 s. En la práctica hubo **un solo usuario activo a la vez**:
valida que el plan funciona, **no** mide concurrencia.

### Concurrencia local exploratoria (`scripts/host/concurrency-local.sh`)

Escalones secuenciales de 1, 5 y 10 usuarios. Cada uno: 30 s de subida y 30 s de estabilización
(calentamiento, excluido) y 120 s medidos, con pausas aleatorias de 1–3 s. Última corrida
(`20261116T010048Z`), solo la ventana medida:

| Escalón | Usuarios activos (mín/máx) | Peticiones en vuelo (máx) | Consultas | Creaciones | Errores | p95 consultar | p95 crear | Throughput |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1/1 | 1 | 29 | 30 | 0 | 36 ms | 54 ms | 0,49/s |
| 5 | 5/5 | 2 | 147 | 148 | 0 | 20 ms | 24 ms | 2,46/s |
| 10 | 10/10 | 2 | 294 | 299 | 0 | 17 ms | 23 ms | 4,94/s |

Recursos en la medición con 10 usuarios (`docker stats` cada 5 s):

| Contenedor | CPU media | CPU máx | Memoria máx |
| --- | --- | --- | --- |
| Base de datos de facturación | 4,4% | 20,3% | 58 MiB |
| API de facturación | 1,4% | 2,4% | 31 MiB |
| API de auth | 0,3% | 1,3% | 157 MiB |
| JMeter | 2,9% | 7,4% | 227 MiB |

**Conciliación de datos (verificada automáticamente).** Los escalones no limpian datos: las
facturas se **acumulan** en la empresa `perf`. Usuario, rol, cliente y producto se reutilizan; en
cada foto había 1 cliente y 1 producto de performance.

| Momento | Facturas perf | Creaciones 201 del escalón (calentamiento + medición + después) |
| --- | --- | --- |
| Inicio (tras el smoke) | 1 | — |
| Tras 1 usuario | 45 (+44) | 44 (13 + 30 + 1) |
| Tras 5 usuarios | 258 (+213) | 213 (60 + 148 + 5) |
| Tras 10 usuarios | 677 (+419) | 419 (109 + 299 + 11) |

La tabla de medición cuenta solo la ventana medida. Las facturas finales incluyen además el smoke,
el calentamiento y las creaciones posteriores a la ventana.

Corrida anterior (`20261115T235821Z`), que se reportó como 951 peticiones medidas frente a 679
facturas:

- 951 = 477 consultas + 474 creaciones medidas.
- 679 = 1 (smoke) + 182 creaciones de calentamiento + 474 medidas + 22 posteriores a la ventana.

Cuadra exactamente con las creaciones con 201 registradas en sus `results.jtl` (47 + 209 + 422 + 1).

### Límites

- Un solo equipo local con Docker Desktop. Servicios en modo desarrollo. Generador de carga y
  sistema en la misma máquina.
- El throughput lo marcan las pausas (modelo cerrado), no un límite del sistema. El p95 baja
  al subir de escalón probablemente por el calentamiento acumulado.
- **No** establece capacidad de producción ni define umbrales de aceptación.
- CPU de `docker stats`: 100% equivale a un núcleo de la VM de Docker.

## Pipelines

- No se han ejecutado en GitHub: no hay push. El job `front-compilado` se reprodujo localmente
  con los mismos comandos; la única diferencia son nombres de carpeta con sufijo para no
  reutilizar los volúmenes del ambiente de desarrollo.
- El job necesita que la rama del front que clone (por defecto `main`) tenga la configuración
  de producción local corregida (enrutamiento a facturación y `extra_hosts`). Hoy esa corrección
  solo existe en la rama local `feature/jmeter-independiente` del front.
