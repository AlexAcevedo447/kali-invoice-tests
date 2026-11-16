#!/usr/bin/env bash
# Comprueba que las versiones elegidas de los repositorios de Kali son compatibles con esta
# suite de Cypress antes de levantar el stack (lo usa el job front-compilado del pipeline).
#
# Uso: check-stack-compat.sh <dir_con_los_repos> [salida_versions.txt]
#   <dir>/kali-auth-context, <dir>/kali-invoice-service, <dir>/invoice-kali-front
# Escribe el commit resuelto de cada repositorio y falla (código 1) indicando qué falta.
# Solo lee archivos: no ejecuta código de los repositorios.
set -uo pipefail

STACK="${1:?Uso: check-stack-compat.sh <dir_con_los_repos> [salida]}"
OUT="${2:-/dev/stdout}"
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fail=0

need() { # <descripción> <archivo> <patrón fijo>
  if [ -f "$2" ] && grep -qF -- "$3" "$2"; then
    echo "  ok     $1"
  else
    echo "  FALTA  $1 ($2)"; fail=1
  fi
}
commit() { git -C "$1" rev-parse HEAD 2>/dev/null || echo "desconocido"; }

{
  echo "Versiones del stack:"
  echo "  kali-invoice-tests    $(commit "$TESTS_DIR")"
  for r in kali-auth-context kali-invoice-service invoice-kali-front; do
    echo "  $(printf '%-21s' "$r") $(commit "$STACK/$r")"
  done
} > "$OUT"
cat "$OUT" >&2 2>/dev/null || true

echo "Requisitos de la suite:" >&2
{
  A="$STACK/kali-auth-context"; I="$STACK/kali-invoice-service"; F="$STACK/invoice-kali-front"
  need "auth: consulta de usuario por correo (users/by-email)" "$A/internal/infrastructure/http/routes/router.go" '"/by-email"'
  need "auth: asignación de roles a usuarios (rbac/users/roles/assign)" "$A/internal/infrastructure/http/routes/router.go" '"/users/roles/assign"'
  need "facturación: impuestos por línea (incremento 4)" "$I/internal/infrastructure/db/models/invoice_item_tax_model.go" "package"
  need "front: PrimeReactProvider (evita el TypeError del Dropdown al desplazar)" "$F/src/main.tsx" "<PrimeReactProvider>"
  need "front: prod-local con base de API relativa" "$F/docker-compose.prod.local.yml" 'VITE_API_BASE_URL:-/}'
  need "front: prod-local alcanza las APIs en Linux (host-gateway)" "$F/docker-compose.prod.local.yml" "host.docker.internal:host-gateway"
  need "front: nginx de prod-local enruta facturación a 8080" "$F/nginx.local-proxy.conf" "proxy_pass http://host.docker.internal:8080"
} >&2

if [ "$fail" -ne 0 ]; then
  echo "Versiones incompatibles: elige ramas o commits que incluyan lo marcado como FALTA (inputs auth_ref, invoice_ref y front_ref del pipeline)." >&2
  exit 1
fi
echo "Versiones compatibles." >&2
