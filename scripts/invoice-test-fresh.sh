#!/bin/sh
# Prepara un ciclo completo y autocontenido para CP-INT-005/006/007:
#   1) recrea (down + up) la base Postgres EXCLUSIVA de Cypress (kali-invoice-cypress-db);
#   2) detiene ÚNICAMENTE el proceso local de kali-invoice-service que escucha
#      en el puerto 8080 -y solo si su cwd corresponde a ese repo-, porque tras
#      recrear el contenedor, el proceso viejo queda con una conexión inválida
#      y responde 500 (comportamiento observado, no hipotético);
#   3) levanta un kali-invoice-service nuevo apuntando explícitamente a esa
#      base exclusiva;
#   4) espera hasta que responda, confirma que la lista de facturas es [];
#   5) ejecuta `npm run test:invoice` (o `test:invoice:headed` con `headed`),
#      salvo en modo `prepare`, que se detiene justo antes de este paso.
#
# No toca bases de desarrollo, otros Postgres, otros procesos Go, ni el código
# de kali-invoice-service. Si no puede identificar con certeza el proceso en
# el puerto 8080 como perteneciente a kali-invoice-service, aborta sin matar
# nada (no usa killall/pkill ni mecanismos globales).
#
# Uso:
#   ./scripts/invoice-test-fresh.sh           # prepara y ejecuta npm run test:invoice
#   ./scripts/invoice-test-fresh.sh headed    # prepara y ejecuta npm run test:invoice:headed
#   ./scripts/invoice-test-fresh.sh prepare   # solo prepara (BD + servicio + [] confirmado),
#                                              # no ejecuta ningún test; para flujos que abren
#                                              # Cypress ellos mismos después (ver test:ga9:open)
#
# Variable opcional:
#   INVOICE_SERVICE_DIR  ruta al repo de kali-invoice-service
#                        (default: /Users/jhon/Documents/Personal/KALI/kali-invoice-service)

set -eu

MODE="run"
NPM_SCRIPT="test:invoice"
case "${1:-}" in
  "") ;;
  headed) NPM_SCRIPT="test:invoice:headed" ;;
  prepare) MODE="prepare" ;;
  *)
    echo "Argumento desconocido: '$1' (uso: $0 [headed|prepare])" >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INVOICE_SERVICE_DIR="${INVOICE_SERVICE_DIR:-/Users/jhon/Documents/Personal/KALI/kali-invoice-service}"
INVOICE_REPO_MARKER="kali-invoice-service"
APP_PORT=8080
LOG_FILE="/tmp/kali-invoice-service-cypress.log"

if [ ! -d "$INVOICE_SERVICE_DIR" ]; then
  echo "No se encontró kali-invoice-service en '$INVOICE_SERVICE_DIR'." >&2
  echo "Exporta INVOICE_SERVICE_DIR con la ruta correcta y reintenta." >&2
  exit 1
fi

echo "== 1) Recreando la base exclusiva de Cypress (kali-invoice-cypress-db) =="
"$SCRIPT_DIR/invoice-test-db.sh" down
"$SCRIPT_DIR/invoice-test-db.sh" up

echo "== 2) Deteniendo el proceso local de kali-invoice-service en :$APP_PORT (si existe) =="
EXISTING_PID="$(lsof -tiTCP:${APP_PORT} -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$EXISTING_PID" ]; then
  EXISTING_CWD="$(lsof -p "$EXISTING_PID" 2>/dev/null | awk '$4 == "cwd" { print $NF }')"
  case "$EXISTING_CWD" in
    *"$INVOICE_REPO_MARKER")
      echo "Deteniendo PID $EXISTING_PID (cwd: $EXISTING_CWD)"
      kill "$EXISTING_PID" 2>/dev/null || true
      for i in $(seq 1 20); do
        if ! lsof -tiTCP:${APP_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
          break
        fi
        sleep 0.5
      done
      if lsof -tiTCP:${APP_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
        echo "El proceso no liberó el puerto $APP_PORT a tiempo." >&2
        exit 1
      fi
      ;;
    *)
      echo "Hay un proceso (PID $EXISTING_PID) escuchando en :$APP_PORT cuyo cwd" >&2
      echo "  ('$EXISTING_CWD') no corresponde a kali-invoice-service." >&2
      echo "Por seguridad, no se detiene ningún proceso. Abortando." >&2
      exit 1
      ;;
  esac
else
  echo "No hay ningún proceso escuchando en :$APP_PORT."
fi

echo "== 3) Levantando kali-invoice-service contra la base exclusiva de Cypress =="
(
  cd "$INVOICE_SERVICE_DIR"
  APP_PORT=8080 \
  POSTGRES_HOST=localhost \
  POSTGRES_PORT=5433 \
  POSTGRES_USER=cypress \
  POSTGRES_PASSWORD=cypress \
  POSTGRES_DB=kali_invoices_cypress \
  POSTGRES_SSLMODE=disable \
  RABBITMQ_ENABLED=false \
  nohup go run ./cmd/api > "$LOG_FILE" 2>&1 &
  disown
)

echo "== 4) Esperando a que http://localhost:$APP_PORT/api/v1/invoices responda =="
READY=""
for i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/api/v1/invoices" 2>/dev/null || true)"
  if [ "$CODE" = "200" ]; then
    READY="1"
    break
  fi
  sleep 1
done

if [ -z "$READY" ]; then
  echo "Timeout esperando kali-invoice-service en :$APP_PORT. Log: $LOG_FILE" >&2
  tail -n 30 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "== 5) Confirmando que la lista de facturas está vacía =="
BODY="$(curl -s "http://localhost:${APP_PORT}/api/v1/invoices")"
if [ "$BODY" != "[]" ]; then
  echo "La base no está vacía (respuesta: $BODY)." >&2
  echo "No se ejecutan las pruebas para evitar un falso negativo en CP-INT-005." >&2
  exit 1
fi
echo "OK: GET /api/v1/invoices -> []"

if [ "$MODE" = "prepare" ]; then
  echo "== 6) Modo 'prepare': preparación lista, no se ejecuta Cypress aquí =="
  exit 0
fi

echo "== 6) Ejecutando npm run $NPM_SCRIPT =="
cd "$REPO_ROOT"
npm run "$NPM_SCRIPT"
