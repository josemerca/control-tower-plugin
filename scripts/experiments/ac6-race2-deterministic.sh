#!/usr/bin/env bash
# T11 — harness adversarial DETERMINISTA para AC6 (claim concurrente por
# labels). NO forma parte de `npm test`: es un experimento en vivo contra un
# repo real de GitHub (por defecto, `josemerca/ct-loop-sandbox`), pensado
# para ejecutarse a mano. Ver task-11-report.md para el veredicto y la salida
# cruda de la última corrida.
#
# Qué construye: la interleaving exacta que el AC6 original (T10, 14 rondas
# de 2 claimants naturales, --settle-ms incluido en 0) nunca alcanzó por
# construcción del scheduler:
#
#   1. LOW  comprobación de colisión → limpia (ninguno ha escrito todavía)
#   2. HIGH comprobación de colisión → limpia
#   3. HIGH escribe status:in-progress + relee → se ve solo a sí mismo → exit 0
#   4. LOW  escribe status:in-progress + relee → ve a HIGH, pero HIGH > LOW →
#      claimLost(LOW) == false (el desempate solo hace perder al MAYOR) → exit 0
#   → si ambos exit 0, es un doble claim real, no solo "posible en teoría".
#
# Mecanismo: CT_CLAIM_PRECLAIM_DELAY_MS (hook en dispatch-check.mjs, ver
# comentario junto a su definición) se fija a un valor grande SOLO en LOW,
# para forzar que LOW pase su comprobación de colisión y se quede dormido
# mientras HIGH completa su ciclo entero (escritura + settle + readback +
# decisión). HIGH usa CT_CLAIM_PRECLAIM_DELAY_MS=0 (comportamiento normal).
# No hace falta barrera de arranque aquí: la asimetría de tiempos (varios
# segundos de LOW vs. cientos de ms del ciclo completo de HIGH) domina
# cualquier sesgo de unos pocos ms al lanzar los dos procesos en background
# desde bash.
#
# Tras cada ronda se comprueba la INVARIANTE REAL contra GitHub (no el exit
# code, que es solo lo que cada proceso CREE): a lo sumo un issue con el
# token compartido puede estar en status:in-progress.
set -uo pipefail

REPO="${CT_AC6_REPO:-josemerca/ct-loop-sandbox}"
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/dispatch-check.mjs"
LOW="${CT_AC6_LOW:-3}"    # issue de número MENOR — nunca puede perder por construcción
HIGH="${CT_AC6_HIGH:-4}"  # issue de número MAYOR — el único que claimLost() puede hacer perder
TOKEN_LABEL="${CT_AC6_TOKEN_LABEL:-touches:t11}"
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRATCH/race2-results"
mkdir -p "$RESULTS_DIR"

# LOW debe quedarse dormido más tiempo del que HIGH tarda en completar su
# ciclo entero (escritura + settle + readback), para cualquiera de los dos
# valores de settle-ms que se prueban (0 y 2000). 8s da margen de sobra
# incluso para el settle de 2000ms + latencia de red variable.
PRECLAIM_LOW_MS="${CT_AC6_PRECLAIM_LOW_MS:-8000}"

reset_pair() {
  gh issue edit "$LOW" --repo "$REPO" \
    --remove-label status:in-progress --remove-label status:in-review --remove-label status:ready >/dev/null 2>&1 || true
  gh issue edit "$HIGH" --repo "$REPO" \
    --remove-label status:in-progress --remove-label status:in-review --remove-label status:ready >/dev/null 2>&1 || true
  gh issue edit "$LOW" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null
  gh issue edit "$HIGH" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null
}

label_state() {
  gh issue view "$1" --repo "$REPO" --json labels -q '[.labels[].name] | join(",")'
}

run_round() {
  local round="$1" settle="$2"
  reset_pair
  echo "--- pre-round label state ---"
  echo "#$LOW: $(label_state "$LOW")"
  echo "#$HIGH: $(label_state "$HIGH")"

  local outlow="$RESULTS_DIR/round-${round}-settle${settle}-low.out"
  local outhigh="$RESULTS_DIR/round-${round}-settle${settle}-high.out"

  CT_CLAIM_PRECLAIM_DELAY_MS=$PRECLAIM_LOW_MS node "$SCRIPT" "$LOW" --repo "$REPO" --settle-ms "$settle" >"$outlow" 2>&1 &
  PID_LOW=$!
  CT_CLAIM_PRECLAIM_DELAY_MS=0 node "$SCRIPT" "$HIGH" --repo "$REPO" --settle-ms "$settle" >"$outhigh" 2>&1 &
  PID_HIGH=$!

  wait "$PID_LOW"; CODE_LOW=$?
  wait "$PID_HIGH"; CODE_HIGH=$?

  echo "=== round $round (settle-ms=$settle) ==="
  echo "-- LOW  #$LOW  exit=$CODE_LOW --"
  cat "$outlow"
  echo "-- HIGH #$HIGH exit=$CODE_HIGH --"
  cat "$outhigh"
  echo "-- real label state tras la ronda (fuente de verdad) --"
  local labels_low labels_high
  labels_low="$(label_state "$LOW")"
  labels_high="$(label_state "$HIGH")"
  echo "#$LOW: $labels_low"
  echo "#$HIGH: $labels_high"

  local n_inprogress=0
  [[ "$labels_low" == *"status:in-progress"* ]] && n_inprogress=$((n_inprogress+1))
  [[ "$labels_high" == *"status:in-progress"* ]] && n_inprogress=$((n_inprogress+1))
  echo "INVARIANTE (a lo sumo 1 in-progress con token compartido): in_progress_count=$n_inprogress $( [[ $n_inprogress -le 1 ]] && echo OK || echo VIOLADO )"
  if [[ "$CODE_LOW" -eq 0 && "$CODE_HIGH" -eq 0 ]]; then
    echo "DOBLE CLAIM POR EXIT CODE: ambos procesos exit 0"
  fi
  echo
}

for r in 1 2 3; do run_round "$r" 0; done
for r in 1 2 3; do run_round "$r" 2000; done
