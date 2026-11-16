#!/usr/bin/env bash
# Se ejecuta en el HOST (no dentro de la imagen): lanza la prueba local de concurrencia en el
# contenedor de tarea de JMeter y, en paralelo, muestrea el consumo de recursos de los
# contenedores con `docker stats`. La imagen de JMeter no necesita acceso a Docker.
#
# Uso (desde kali-invoice-tests/jmeter, con el stack local levantado):
#   KALI_PERF_USER_PASSWORD='…' scripts/host/concurrency-local.sh
# Variables opcionales:
#   KALI_PERF_STATS_FILTER  regex de nombres de contenedor a muestrear
#                           (por defecto: kali|invoice|auth|jmeter)
#   KALI_PERF_STATS_EVERY   segundos entre muestras (por defecto 5)
# Resultado: results/<run_id>/ con lo de run.sh concurrency más resources.csv y
#   resources-summary.txt (CPU media/máx y memoria máx por contenedor y ventana de medición).
# CPU% es la que informa Docker (100% = un núcleo de la VM/host de Docker).
set -euo pipefail

JM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILTER="${KALI_PERF_STATS_FILTER:-kali|invoice|auth|jmeter}"
EVERY="${KALI_PERF_STATS_EVERY:-5}"
[ -n "${KALI_PERF_USER_PASSWORD:-}" ] || { echo "ERROR: falta KALI_PERF_USER_PASSWORD" >&2; exit 2; }

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-${KALI_PERF_ENV:-local-docker}-concurrency"
OUT="$JM_DIR/results/$RUN_ID"
mkdir -p "$OUT"
echo "epoch_ms,contenedor,cpu_pct,mem_mib" > "$OUT/resources.csv"

to_mib() { # 123.4MiB | 1.2GiB | 512KiB | 10MB
  awk -v v="$1" 'BEGIN{ n=v; sub(/[A-Za-z]+$/,"",n); u=v; sub(/^[0-9.]+/,"",u);
    f=(u=="GiB"||u=="GB")?1024:(u=="KiB"||u=="kB"||u=="KB")?1/1024:(u=="B")?1/1048576:1; printf "%.1f", n*f }'
}

sample() {
  while :; do
    local now; now=$(($(date +%s) * 1000))
    docker stats --no-stream --format '{{.Name}};{{.CPUPerc}};{{.MemUsage}}' 2>/dev/null \
      | grep -E "$FILTER" | while IFS=';' read -r name cpu mem; do
          echo "$now,$name,${cpu%\%},$(to_mib "${mem%% /*}")"
        done >> "$OUT/resources.csv" || true
    sleep "$EVERY"
  done
}

sample & SAMPLER=$!
trap 'kill "$SAMPLER" 2>/dev/null || true' EXIT

status=0
(cd "$JM_DIR" && KALI_PERF_RUN_ID="$RUN_ID" docker compose run --rm jmeter concurrency) || status=$?
kill "$SAMPLER" 2>/dev/null || true; wait "$SAMPLER" 2>/dev/null || true

# Resumen de recursos por escalón, solo en la ventana de MEDICIÓN.
if [ -f "$OUT/windows.csv" ]; then
  {
    echo "Recursos por escalón (ventana de medición; muestreo cada ${EVERY}s con docker stats)"
    grep ',medicion,' "$OUT/windows.csv" | while IFS=, read -r step users phase start end; do
      echo "== escalón $users usuario(s)"
      awk -F, -v s="$start" -v e="$end" 'NR>1 && $1>=s && $1<e {
          n[$2]++; c[$2]+=$3; if($3>cm[$2])cm[$2]=$3; if($4>mm[$2])mm[$2]=$4 }
        END { for (k in n) printf "  %-45s muestras=%d cpu_media=%.1f%% cpu_max=%.1f%% mem_max=%.0fMiB\n", k, n[k], c[k]/n[k], cm[k], mm[k] }' \
        "$OUT/resources.csv" | sort
    done
  } | tee "$OUT/resources-summary.txt"
fi
echo "Resultados: $OUT"
exit "$status"
