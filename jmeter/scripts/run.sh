#!/usr/bin/env bash
# Ejecutor de JMeter para InvoiceKali (independiente de Cypress: no usa Node).
#
# Uso:  run.sh <validate|provision|smoke|load> [--env NOMBRE] [-Jclave=valor ...]
#   validate   carga los planes sin ejecutar usuarios (sin red); falla si un .jmx es inválido
#   provision  crea/reutiliza los datos exclusivos de performance (idempotente)
#   smoke      ejecución mínima (1 usuario, 1 iteración); debe pasar sin errores
#   load       ejecuta primero smoke y, solo si pasa, el perfil de carga
#
# Ambiente: --env o KALI_PERF_ENV (por defecto: local; en la imagen Docker: local-docker).
#   config/environments/<NOMBRE>.properties. Si su kali.environment.kind es "production",
#   la ejecución se bloquea (código 3) salvo que se exporte
#   KALI_ALLOW_PRODUCTION_LOAD=SI-AUTORIZO-CARGA-EN-PRODUCCION.
# Credenciales: SOLO por variables de entorno (KALI_PERF_USER_PASSWORD y, para provision,
#   KALI_PLATFORM_ADMIN_PASSWORD). No se pasan como propiedades -J (JMeter las registraría).
# Resultados: ${KALI_PERF_RESULTS_DIR:-<jmeter>/results}/<fecha>-<ambiente>-<perfil>/
#   results.jtl (solo métricas), report/ (HTML), jmeter.log y summary.txt.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JMETER_BIN="${JMETER_BIN:-jmeter}"
RESULTS_ROOT="${KALI_PERF_RESULTS_DIR:-$ROOT/results}"
PRODUCTION_CONFIRMATION="SI-AUTORIZO-CARGA-EN-PRODUCCION"

die() { echo "ERROR: $1" >&2; exit "${2:-1}"; }

COMMAND="${1:-}"
[ -n "$COMMAND" ] || die "Uso: run.sh <validate|provision|smoke|load> [--env NOMBRE] [-Jclave=valor ...]" 2
shift
ENV_NAME="${KALI_PERF_ENV:-local}"
EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --env=*) ENV_NAME="${1#--env=}"; shift ;;
    -J*) EXTRA+=("$1"); shift ;;
    *) die "Argumento no reconocido: $1" 2 ;;
  esac
done
for arg in "${EXTRA[@]+"${EXTRA[@]}"}"; do
  case "$arg" in *assword*|*token*|*secret*) die "No pases credenciales como -J (se registrarían en jmeter.log); usa variables de entorno." 2 ;; esac
done

ENV_FILE="$ROOT/config/environments/$ENV_NAME.properties"
[ -f "$ENV_FILE" ] || die "Ambiente '$ENV_NAME' no existe: $ENV_FILE (disponibles: $(ls "$ROOT/config/environments" | grep '\.properties$' | sed 's/\.properties$//' | tr '\n' ' '))" 2
prop() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\r'; }
KIND="$(prop kali.environment.kind)"
[ -n "$KIND" ] || die "El ambiente '$ENV_NAME' no declara kali.environment.kind" 2

# Bloqueo de producción: antes de cualquier conexión.
if [ "$KIND" = "production" ] && [ "$COMMAND" != "validate" ]; then
  if [ "${KALI_ALLOW_PRODUCTION_LOAD:-}" != "$PRODUCTION_CONFIRMATION" ]; then
    die "Ambiente '$ENV_NAME' es de PRODUCCIÓN: ejecución bloqueada. Solo con autorización explícita: KALI_ALLOW_PRODUCTION_LOAD=$PRODUCTION_CONFIRMATION" 3
  fi
  echo "ADVERTENCIA: ejecución en PRODUCCIÓN autorizada explícitamente (KALI_ALLOW_PRODUCTION_LOAD)." >&2
fi

require_env() { for v in "$@"; do [ -n "${!v:-}" ] || die "Falta la variable de entorno $v (credencial; no se guarda en el repositorio ni en la imagen)" 2; done; }

# Comprueba que ninguna credencial aparezca en los resultados.
check_no_secrets() {
  local dir="$1" v
  for v in KALI_PERF_USER_PASSWORD KALI_PLATFORM_ADMIN_PASSWORD; do
    if [ -n "${!v:-}" ] && grep -rqF -- "${!v}" "$dir"; then
      die "Se encontró el valor de $v en $dir: resultados descartados por seguridad" 4
    fi
  done
}

run_plan() { # <plan> <profile> <label>
  local plan="$1" profile="$2" label="$3" out
  out="$RESULTS_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-$ENV_NAME-$label"
  mkdir -p "$out"
  echo "== $label: $plan en '$ENV_NAME' ($KIND) -> $out" >&2
  "$JMETER_BIN" -n -t "$ROOT/plans/$plan" \
    -q "$ENV_FILE" -q "$ROOT/config/profiles/$profile.properties" -q "$ROOT/config/jmeter-results.properties" \
    -Jkali.root="$ROOT" "${EXTRA[@]+"${EXTRA[@]}"}" \
    -l "$out/results.jtl" -j "$out/jmeter.log" -e -o "$out/report" >"$out/console.log" 2>&1 || {
      tail -20 "$out/console.log" >&2; die "JMeter terminó con error ($label)"; }
  check_no_secrets "$out"
  # Resumen desde las estadísticas del propio informe de JMeter (report/statistics.json).
  local stats="$out/report/statistics.json" total errors
  [ -f "$stats" ] || die "No se generó $stats ($label)"
  total=$(jq '.Total.sampleCount' "$stats")
  errors=$(jq '.Total.errorCount' "$stats")
  {
    echo "ambiente=$ENV_NAME tipo=$KIND perfil=$label plan=$plan"
    echo "muestras=$total errores=$errors"
    jq -r 'to_entries | map(select(.key != "Total")) | sort_by(.key)[] |
      "  \(.key): n=\(.value.sampleCount) errores=\(.value.errorCount) media_ms=\(.value.meanResTime|floor) p95_ms=\(.value.pct2ResTime|floor) tps=\(.value.throughput*100|floor/100)"' "$stats"
  } | tee "$out/summary.txt" >&2
  [ "$total" -gt 0 ] || die "$label no generó muestras" 1
  [ "$errors" -eq 0 ] || die "$label tuvo $errors errores (ver $out/report/index.html)" 1
  echo "$out"
}

case "$COMMAND" in
  validate)
    for plan in invoice-kali.jmx provision-perf-data.jmx; do
      out="$RESULTS_ROOT/validate-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "$out"
      "$JMETER_BIN" -n -t "$ROOT/plans/$plan" -q "$ENV_FILE" -q "$ROOT/config/profiles/validate.properties" \
        -q "$ROOT/config/jmeter-results.properties" -Jkali.root="$ROOT" -l "$out/$plan.jtl" -j "$out/$plan.log" >"$out/$plan.console" 2>&1 \
        || { cat "$out/$plan.console" >&2; die "El plan $plan no es válido"; }
      if grep -qE "ERROR|Error in NonGUIDriver|Exception" "$out/$plan.log" "$out/$plan.console"; then
        grep -E "ERROR|Exception" "$out/$plan.log" "$out/$plan.console" | head -5 >&2; die "El plan $plan no se pudo cargar"
      fi
      echo "Plan válido: $plan" >&2
    done
    ;;
  provision)
    require_env KALI_PLATFORM_ADMIN_PASSWORD KALI_PERF_USER_PASSWORD
    run_plan provision-perf-data.jmx smoke provision >/dev/null
    ;;
  smoke)
    require_env KALI_PERF_USER_PASSWORD
    run_plan invoice-kali.jmx smoke smoke >/dev/null
    ;;
  load)
    require_env KALI_PERF_USER_PASSWORD
    echo "== Paso previo obligatorio: smoke" >&2
    run_plan invoice-kali.jmx smoke smoke >/dev/null || die "Smoke falló: no se ejecuta la carga"
    run_plan invoice-kali.jmx load load >/dev/null
    ;;
  *) die "Comando desconocido: $COMMAND (validate|provision|smoke|load)" 2 ;;
esac
