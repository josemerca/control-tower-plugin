#!/usr/bin/env bash
# T11 — harness adversarial DETERMINISTA para AC6 (claim concurrente por
# labels). NO forma parte de `npm test`: es un experimento en vivo contra un
# repo real de GitHub (por defecto, `josemerca/ct-loop-sandbox`), pensado
# para ejecutarse a mano. Ver task-11-report.md para el veredicto y la salida
# cruda de la última corrida.
#
# Qué construye: la interleaving exacta que el AC6 original (T10, 14 rondas
# de 2 claimants naturales) nunca alcanzó por construcción del scheduler:
#
#   1. LOW  comprobación de colisión → limpia (ninguno ha escrito todavía)
#   2. HIGH comprobación de colisión → limpia
#   3. HIGH escribe status:in-progress + relee → se ve solo a sí mismo → exit 0
#   4. LOW  escribe status:in-progress + relee → ve a HIGH, pero HIGH > LOW →
#      claimLost(LOW) == false (el desempate solo hace perder al MAYOR) → exit 0
#   → si ambos exit 0, es un doble claim real, no solo "posible en teoría".
#
# Mecanismo: CT_CLAIM_PRECLAIM_DELAY_MS (hook en dispatch-check.mjs, ver
# comentario junto a su definición) se fija a CT_AC6_PRECLAIM_LOW_MS SOLO en
# LOW ("skew"), para forzar que LOW pase su comprobación de colisión y se
# quede dormido mientras HIGH completa su ciclo entero (escritura + readback +
# decisión). HIGH usa CT_CLAIM_PRECLAIM_DELAY_MS=0 (comportamiento normal). No
# hace falta barrera de arranque aquí: mientras el skew sea mayor que el ciclo
# completo de HIGH, la asimetría de tiempos domina cualquier sesgo de unos
# pocos ms al lanzar los dos procesos en background desde bash.
#
# (fix round 2, T11 review — decisión de José): este script ya NO pasa
# --settle-ms — ese flag y toda la espera de asentamiento se retiraron de
# dispatch-check.mjs. Tres barridos de skew (500, 3000 y 8000ms, cada uno
# contra lo que entonces eran los dos valores de settle) no consiguieron medir
# que el settle aportara nada frente a la latencia real de red de GitHub
# (650-1900ms por request, medida en el experimento CAS de T9) — ver
# task-11-report.md §5. El único knob que queda para reproducir el doble
# claim es el skew de este propio script.
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
ROUNDS="${CT_AC6_ROUNDS:-3}"

# El skew debe superar el ciclo completo de HIGH (comprobación de colisión +
# escritura + readback, todo ello sin ninguna espera artificial ya). En la
# práctica, unos pocos cientos de ms de latencia real de red ya bastan para
# ese ciclo — 8000ms deja un margen generoso.
PRECLAIM_LOW_MS="${CT_AC6_PRECLAIM_LOW_MS:-8000}"

# Comparación exacta por label, no substring (fix round 1, Minor 3): un CSV
# de labels comparado con `== *"status:in-progress"*` daría un falso
# positivo si algún otro label contuviera esa cadena. Se compara elemento a
# elemento tras partir por coma.
has_label() {
  local csv="$1" target="$2" IFS=','
  local l
  for l in $csv; do
    [[ "$l" == "$target" ]] && return 0
  done
  return 1
}

# Preflight (fix round 1, findings Important 2 y 3): sin esto, si el fixture
# (los issues LOW/HIGH, o el label del token) no existe — por ejemplo porque
# una corrida anterior lo limpió, como pasó de verdad en esta task — el
# script seguía adelante en silencio, sin token compartido, y el resultado
# ("VIOLADO" o "OK") no medía nada sobre el lock: medía un fixture roto. Es
# imposible ahora que un fixture ausente se lea como éxito o como fallo del
# lock: se aborta ruidosamente antes de la primera ronda.
preflight() {
  echo "-- preflight --"
  if ! gh label create "$TOKEN_LABEL" --repo "$REPO" --color 5319e7 \
      --description "T11 AC6 harness — temporal" --force >/dev/null; then
    echo "FATAL: no se pudo crear/actualizar el label '$TOKEN_LABEL' en $REPO. Abortando sin correr ninguna ronda." >&2
    exit 1
  fi
  for n in "$LOW" "$HIGH"; do
    if ! gh issue view "$n" --repo "$REPO" --json number >/dev/null 2>&1; then
      echo "FATAL: el issue #$n (fixture LOW/HIGH) no existe en $REPO. Abortando sin correr ninguna ronda." >&2
      echo "       Ajusta CT_AC6_LOW/CT_AC6_HIGH a issues existentes, o recrea el fixture." >&2
      exit 1
    fi
  done
  echo "OK: label '$TOKEN_LABEL' listo, issues #$LOW y #$HIGH existen."
}

reset_pair() {
  gh issue edit "$LOW" --repo "$REPO" \
    --remove-label status:in-progress --remove-label status:in-review --remove-label status:ready >/dev/null 2>&1 || true
  gh issue edit "$HIGH" --repo "$REPO" \
    --remove-label status:in-progress --remove-label status:in-review --remove-label status:ready >/dev/null 2>&1 || true
  if ! gh issue edit "$LOW" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null; then
    echo "FATAL: no se pudo poner #$LOW en status:ready + $TOKEN_LABEL. Abortando (no se corre la ronda con un fixture a medias)." >&2
    exit 1
  fi
  if ! gh issue edit "$HIGH" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null; then
    echo "FATAL: no se pudo poner #$HIGH en status:ready + $TOKEN_LABEL. Abortando (no se corre la ronda con un fixture a medias)." >&2
    exit 1
  fi
}

label_state() {
  gh issue view "$1" --repo "$REPO" --json labels -q '[.labels[].name] | join(",")'
}

run_round() {
  local round="$1"
  reset_pair
  echo "--- pre-round label state ---"
  echo "#$LOW: $(label_state "$LOW")"
  echo "#$HIGH: $(label_state "$HIGH")"

  local outlow="$RESULTS_DIR/round-${round}-skew${PRECLAIM_LOW_MS}-low.out"
  local outhigh="$RESULTS_DIR/round-${round}-skew${PRECLAIM_LOW_MS}-high.out"

  CT_CLAIM_PRECLAIM_DELAY_MS=$PRECLAIM_LOW_MS node "$SCRIPT" "$LOW" --repo "$REPO" >"$outlow" 2>&1 &
  PID_LOW=$!
  CT_CLAIM_PRECLAIM_DELAY_MS=0 node "$SCRIPT" "$HIGH" --repo "$REPO" >"$outhigh" 2>&1 &
  PID_HIGH=$!

  wait "$PID_LOW"; CODE_LOW=$?
  wait "$PID_HIGH"; CODE_HIGH=$?

  echo "=== round $round (skew=${PRECLAIM_LOW_MS}ms) ==="
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
  has_label "$labels_low" "status:in-progress" && n_inprogress=$((n_inprogress+1))
  has_label "$labels_high" "status:in-progress" && n_inprogress=$((n_inprogress+1))
  echo "INVARIANTE (a lo sumo 1 in-progress con token compartido): in_progress_count=$n_inprogress $( [[ $n_inprogress -le 1 ]] && echo OK || echo VIOLADO )"
  if [[ "$CODE_LOW" -eq 0 && "$CODE_HIGH" -eq 0 ]]; then
    echo "DOBLE CLAIM POR EXIT CODE: ambos procesos exit 0"
  fi
  echo
}

preflight
for r in $(seq 1 "$ROUNDS"); do run_round "$r"; done
