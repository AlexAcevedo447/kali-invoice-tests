#!/bin/sh
# Corrección puntual de dos empresas de PRUEBA creadas por error en la base de
# desarrollo durante el incremento 1 (ver invoice-kali-front/docs/requisitos/
# INCREMENTO_01_EMPRESAS.md, decisión D-06). Solo renombra y cambia el código;
# no borra registros ni toca la empresa de plataforma.
#
#   fba1f76e-…  nombre "   "  código 000     -> nombre/código de prueba explícitos
#   56a9f9f0-…  "Duplicada…"  código master  -> libera "master" (confusión con la plataforma)
#
# Uso (desde kali-invoice-tests, con cypress.env.json del entorno de desarrollo):
#   sh scripts/maintenance/fix-test-tenants-inc1.sh            # simulación (no cambia nada)
#   sh scripts/maintenance/fix-test-tenants-inc1.sh --apply    # aplica con PUT /api/v1/tenants/:id
#
# Antes de cambiar cada empresa verifica que siga teniendo el nombre y código
# esperados; si no, la omite. Conserva el estado actual de la empresa.
set -eu

APPLY="no"
[ "${1:-}" = "--apply" ] && APPLY="yes"

ENV_FILE="$(cd "$(dirname "$0")/../.." && pwd)/cypress.env.json"
read_env() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$ENV_FILE" "$1"; }
AUTH="${AUTH_API_URL:-$(read_env AUTH_API_URL)}"
EMAIL="${AUTH_ADMIN_EMAIL:-$(read_env AUTH_ADMIN_EMAIL)}"
PASSWORD="${AUTH_ADMIN_PASSWORD:-$(read_env AUTH_ADMIN_PASSWORD)}"

LOGIN="$(curl -s -X POST "$AUTH/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"email":sys.argv[1],"password":sys.argv[2]}))' "$EMAIL" "$PASSWORD")")"
TOKEN="$(printf '%s' "$LOGIN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("access_token",""))')"
PLATFORM="$(printf '%s' "$LOGIN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tenant_id",""))')"
[ -n "$TOKEN" ] || { echo "No se pudo iniciar sesión como administrador de plataforma" >&2; exit 1; }

fix() { # id nombre_esperado codigo_esperado nombre_nuevo codigo_nuevo
  ID="$1"; EXP_NAME="$2"; EXP_CODE="$3"; NEW_NAME="$4"; NEW_CODE="$5"
  if [ "$ID" = "$PLATFORM" ]; then echo "[OMITIDA] $ID es la empresa de plataforma"; return; fi
  CUR="$(curl -s "$AUTH/api/v1/tenants/$ID" -H "Authorization: Bearer $TOKEN")"
  NAME="$(printf '%s' "$CUR" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("Name",""))')"
  CODE="$(printf '%s' "$CUR" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("Code",""))')"
  STATUS="$(printf '%s' "$CUR" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("Status",""))')"
  if [ "$NAME" != "$EXP_NAME" ] || [ "$CODE" != "$EXP_CODE" ]; then
    echo "[OMITIDA] $ID ya no coincide (nombre=\"$NAME\" código=\"$CODE\")"; return
  fi
  echo "[PLAN] $ID: \"$NAME\"/$CODE -> \"$NEW_NAME\"/$NEW_CODE (estado $STATUS se conserva)"
  [ "$APPLY" = "yes" ] || return 0
  BODY="$(python3 -c 'import json,sys;print(json.dumps({"name":sys.argv[1],"code":sys.argv[2],"status":sys.argv[3]}))' "$NEW_NAME" "$NEW_CODE" "$STATUS")"
  HTTP="$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$AUTH/api/v1/tenants/$ID" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -H "Idempotency-Key: fix-inc1-$ID-$NEW_CODE" -d "$BODY")"
  echo "[APLICADA] $ID -> HTTP $HTTP"
}

fix fba1f76e-dbee-49a2-ad33-525cce4e8805 "   " "000" \
    "Prueba CP-INT-010 nombre en blanco" "cp-int-010-nombre-en-blanco"
fix 56a9f9f0-f633-49f9-927a-ebe718921f3e "Duplicada mwforwzb58o" "master" \
    "Prueba CP-E2E-008 Duplicada mwforwzb58o" "cp-e2e-008-duplicada-mwforwzb58o"

[ "$APPLY" = "yes" ] || echo "Simulación: no se cambió nada. Ejecuta con --apply para aplicar."
