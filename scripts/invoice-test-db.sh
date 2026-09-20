#!/bin/sh
# Base de datos Postgres exclusiva y efímera para correr kali-invoice-service
# contra un estado garantizado vacío (requisito de CP-INT-005: "sin registros").
#
# No modifica kali-invoice-service ni su lógica de negocio: usa únicamente el
# mecanismo de configuración ya existente del servicio (variables de entorno
# POSTGRES_* leídas en internal/infrastructure/config/config.go) más su
# auto-creación de base de datos (ensureDatabaseExists) y sus migraciones
# versionadas (internal/infrastructure/db/migrator), que se ejecutan solas al
# arrancar. No usa la base de datos de desarrollo compartida
# (kali_invoices_dev) ni hace TRUNCATE/DELETE sobre ella.
#
# Uso:
#   ./scripts/invoice-test-db.sh up      # crea el contenedor (idempotente)
#   ./scripts/invoice-test-db.sh down    # lo destruye junto con sus datos
#
# Después de "up", arrancar kali-invoice-service apuntando a esta base:
#   APP_PORT=8080 \
#   POSTGRES_HOST=localhost POSTGRES_PORT=5433 \
#   POSTGRES_USER=cypress POSTGRES_PASSWORD=cypress \
#   POSTGRES_DB=kali_invoices_cypress POSTGRES_SSLMODE=disable \
#   RABBITMQ_ENABLED=false \
#   go run ./cmd/api
#
# Para garantizar "sin registros" en CP-INT-005 sin depender del orden de
# ejecución de los specs: SIEMPRE destruir (`down`) y volver a crear (`up`)
# este contenedor antes de correr la suite completa. El contenedor no usa un
# volumen nombrado, así que "down" borra sus datos por completo; "up" arranca
# desde cero y el propio servicio recrea el esquema al iniciar.

set -eu

CONTAINER_NAME="kali-invoice-cypress-db"
HOST_PORT="5433"

case "${1:-}" in
  up)
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker run --rm -d \
      --name "$CONTAINER_NAME" \
      -e POSTGRES_USER=cypress \
      -e POSTGRES_PASSWORD=cypress \
      -e POSTGRES_DB=kali_invoices_cypress \
      -p "${HOST_PORT}:5432" \
      postgres:16-alpine >/dev/null
    echo "Esperando a que Postgres acepte conexiones..."
    for i in $(seq 1 30); do
      if docker exec "$CONTAINER_NAME" pg_isready -U cypress >/dev/null 2>&1; then
        echo "Lista: kali_invoices_cypress en localhost:${HOST_PORT}"
        exit 0
      fi
      sleep 1
    done
    echo "Timeout esperando Postgres" >&2
    exit 1
    ;;
  down)
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    echo "Contenedor y datos de prueba destruidos."
    ;;
  *)
    echo "Uso: $0 {up|down}" >&2
    exit 1
    ;;
esac
