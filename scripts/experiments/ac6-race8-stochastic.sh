#!/usr/bin/env bash
# T11 — brazo ESTOCÁSTICO del harness adversarial de AC6: 8 claimants reales
# sobre el mismo token compartido, liberados por una barrera de arranque real
# (FIFO, técnica de T9 — ver task-9-report.md, sección "mecanismo de
# barrera") en vez de `sleep`, con jitter de arranque. NO forma parte de
# `npm test`: experimento en vivo contra un repo real de GitHub.
#
# A diferencia de ac6-race2-deterministic.sh, este brazo NO usa el hook
# CT_CLAIM_PRECLAIM_DELAY_MS: aquí se deja que la latencia de red real y el
# scheduler del SO produzcan (o no) el doble claim por sí mismos, con 8
# corredores en vez de 2, para maximizar la probabilidad de solape frente a
# las 14 rondas de 2 corredores de T10 que nunca lo vieron. Sirve para medir
# si el volumen de concurrencia por sí solo (sin construir la ventana a
# propósito) basta para disparar el fallo — ver task-11-report.md para el
# resultado.
#
# Tras cada ronda se comprueba la INVARIANTE REAL contra GitHub (no el exit
# code): a lo sumo un issue con el token compartido puede estar en
# status:in-progress.
set -uo pipefail

REPO="${CT_AC6_REPO:-josemerca/ct-loop-sandbox}"
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/dispatch-check.mjs"
TOKEN_LABEL="${CT_AC6_TOKEN_LABEL:-touches:t11-stoch}"
# Números de issue de la fixture del sandbox (josemerca/ct-loop-sandbox,
# #5-#12, creados desechables para este experimento). Sobrescribe con
# CT_AC6_ISSUES="n1 n2 ..." si se recrea el fixture con otros números.
read -ra ISSUES <<< "${CT_AC6_ISSUES:-5 6 7 8 9 10 11 12}"
N=${#ISSUES[@]}
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRATCH/race8-results"
mkdir -p "$RESULTS_DIR"

reset_all() {
  for n in "${ISSUES[@]}"; do
    gh issue edit "$n" --repo "$REPO" --remove-label status:in-progress --remove-label status:in-review >/dev/null 2>&1 || true
    gh issue edit "$n" --repo "$REPO" --add-label status:ready >/dev/null
  done
}

run_round() {
  local round="$1" settle="$2"
  reset_all

  local FIFO="$RESULTS_DIR/barrier-${round}-${settle}.fifo"
  local TIMING="$RESULTS_DIR/timing-${round}-${settle}.txt"
  rm -f "$FIFO" "$TIMING"
  mkfifo "$FIFO"
  exec 3<>"$FIFO"

  PIDS=()
  for n in "${ISSUES[@]}"; do
    (
      read -r -n 1 -u 3 _
      # Jitter de arranque real (no el hook de delay): 0-80ms, simula que en
      # el mundo real 8 corredores no arrancan en el mismo tick exacto de
      # CPU aunque compartan la misma señal de disparo.
      jitter_ms=$(( RANDOM % 80 ))
      python3 -c "import time; time.sleep($jitter_ms/1000)"
      out="$RESULTS_DIR/round-${round}-settle${settle}-issue${n}.out"
      t0=$(python3 -c 'import time; print(int(time.time()*1000))')
      node "$SCRIPT" "$n" --repo "$REPO" --settle-ms "$settle" >"$out" 2>&1
      code=$?
      t1=$(python3 -c 'import time; print(int(time.time()*1000))')
      echo "$n $code $t0 $t1 jitter=${jitter_ms}ms" >> "$TIMING"
    ) &
    PIDS+=($!)
  done

  sleep 0.3
  head -c "$N" /dev/zero | tr '\0' 'X' >&3
  wait "${PIDS[@]}"
  exec 3>&-

  echo "=== round $round (settle-ms=$settle, N=$N) — timing crudo (issue code T0_ms T1_ms jitter) ==="
  sort -k1,1n "$TIMING"

  echo "-- overlap check (pares [T0,T1] que se solapan realmente) --"
  python3 - "$TIMING" <<'PYEOF'
import sys, itertools
rows = []
with open(sys.argv[1]) as f:
    for line in f:
        parts = line.split()
        n, code, t0, t1 = int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
        rows.append((n, code, t0, t1))
overlap = 0
total = 0
for a, b in itertools.combinations(rows, 2):
    total += 1
    if max(a[2], b[2]) < min(a[3], b[3]):
        overlap += 1
spread = max(r[2] for r in rows) - min(r[2] for r in rows)
print(f"T0_spread_ms={spread} overlapping_pairs={overlap}/{total} exit0_count={sum(1 for r in rows if r[1]==0)}")
PYEOF

  echo "-- outputs por issue --"
  for n in "${ISSUES[@]}"; do
    echo "-- issue #$n --"
    cat "$RESULTS_DIR/round-${round}-settle${settle}-issue${n}.out"
  done

  echo "-- real label state tras la ronda (fuente de verdad) --"
  local inprog=0
  for n in "${ISSUES[@]}"; do
    local labels
    labels="$(gh issue view "$n" --repo "$REPO" --json labels -q '[.labels[].name] | join(",")')"
    echo "#$n: $labels"
    [[ "$labels" == *"status:in-progress"* ]] && inprog=$((inprog+1))
  done
  echo "INVARIANTE (a lo sumo 1 in-progress con token compartido): in_progress_count=$inprog $( [[ $inprog -le 1 ]] && echo OK || echo VIOLADO )"
  echo
}

for r in 1 2 3; do run_round "$r" 0; done
for r in 1 2 3; do run_round "$r" 2000; done
