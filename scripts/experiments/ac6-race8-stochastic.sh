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
# las 14 rondas de 2 corredores de T10 que nunca lo vieron.
#
# Fixture auto-contenido (fix round 1, T11 review): por defecto (sin
# CT_AC6_ISSUES) el propio script crea N issues desechables al arrancar y los
# BORRA al terminar (éxito, fallo o Ctrl-C, vía `trap ... EXIT`) — nunca
# depende de números de issue fijados a mano en una sesión anterior, que es
# justo lo que se rompió la vez pasada (el fixture #5-#12 se borró al limpiar
# el sandbox y el script siguió "funcionando" en un fixture inexistente,
# leyendo 0 en todo y reportando `in_progress_count=0 OK` — un pase vacuo).
# Si se pasa CT_AC6_ISSUES a mano, el preflight verifica que cada issue
# exista y aborta ruidosamente si no.
#
# Tras cada ronda se comprueba la INVARIANTE REAL contra GitHub (no el exit
# code): a lo sumo un issue QUE LLEVE EL TOKEN COMPARTIDO puede estar en
# status:in-progress (fix round 1, finding Important 3: antes se contaba
# in-progress sin exigir el token, así que en realidad no medía nada sobre
# el token compartido).
#
# (fix round 2, T11 review — decisión de José): este script ya NO pasa
# --settle-ms — ese flag y toda la espera de asentamiento se retiraron de
# dispatch-check.mjs (ver el comentario de cabecera de ese fichero). Ya no
# hay dos brazos que comparar aquí, solo N rondas.
set -uo pipefail

REPO="${CT_AC6_REPO:-josemerca/ct-loop-sandbox}"
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/dispatch-check.mjs"
TOKEN_LABEL="${CT_AC6_TOKEN_LABEL:-touches:t11-stoch}"
N_DEFAULT=8
ROUNDS="${CT_AC6_ROUNDS:-3}"
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRATCH/race8-results"
mkdir -p "$RESULTS_DIR"

AUTO_ISSUES=0
if [[ -z "${CT_AC6_ISSUES:-}" ]]; then
  AUTO_ISSUES=1
  ISSUES=()
else
  read -ra ISSUES <<< "$CT_AC6_ISSUES"
fi

# Comparación exacta por label, no substring (fix round 1, Minor 3).
has_label() {
  local csv="$1" target="$2" IFS=','
  local l
  for l in $csv; do
    [[ "$l" == "$target" ]] && return 0
  done
  return 1
}

cleanup_auto_issues() {
  [[ "$AUTO_ISSUES" -eq 1 ]] || return 0
  [[ "${#ISSUES[@]}" -eq 0 ]] && return 0
  echo "-- cleanup: borrando los ${#ISSUES[@]} issues desechables creados por este run --"
  for n in "${ISSUES[@]}"; do
    local node_id
    node_id="$(gh issue view "$n" --repo "$REPO" --json id -q .id 2>/dev/null || true)"
    if [[ -n "$node_id" ]]; then
      gh api graphql -f query='mutation($id: ID!) { deleteIssue(input: {issueId: $id}) { clientMutationId } }' -f id="$node_id" >/dev/null 2>&1 \
        && echo "   #$n borrado" \
        || echo "   ATENCIÓN: no se pudo borrar #$n — bórralo a mano (gh issue view/delete vía GraphQL) en $REPO" >&2
    fi
  done
}
trap cleanup_auto_issues EXIT

# Preflight (fix round 1, findings Important 2 y 3): crea el label del token
# de forma idempotente (--force) y, o bien crea el fixture desechable, o
# verifica el que se le haya pasado — ABORTA RUIDOSAMENTE si algo falta, en
# vez de seguir con un fixture roto que produciría un "pase" que no significa
# nada (el bug real observado la vez anterior).
preflight() {
  echo "-- preflight --"
  if ! gh label create "$TOKEN_LABEL" --repo "$REPO" --color 5319e7 \
      --description "T11 AC6 harness estocástico — temporal" --force >/dev/null; then
    echo "FATAL: no se pudo crear/actualizar el label '$TOKEN_LABEL' en $REPO. Abortando sin correr ninguna ronda." >&2
    exit 1
  fi

  if [[ "$AUTO_ISSUES" -eq 1 ]]; then
    echo "creando $N_DEFAULT issues desechables en $REPO..."
    for i in $(seq 1 "$N_DEFAULT"); do
      local url num
      url="$(gh issue create --repo "$REPO" \
        --title "T11 race8 disposable (auto) #$i" \
        --body "Creado automáticamente por scripts/experiments/ac6-race8-stochastic.sh. Se borra al terminar el run (trap EXIT). Si sobrevive, algo interrumpió el script antes del cleanup — seguro de borrar a mano." \
        2>/dev/null)" || { echo "FATAL: no se pudo crear el issue desechable #$i en $REPO. Abortando." >&2; exit 1; }
      num="${url##*/}"
      ISSUES+=("$num")
    done
    echo "OK: fixture creado: ${ISSUES[*]}"
  else
    for n in "${ISSUES[@]}"; do
      if ! gh issue view "$n" --repo "$REPO" --json number >/dev/null 2>&1; then
        echo "FATAL: el issue #$n (CT_AC6_ISSUES) no existe en $REPO. Abortando sin correr ninguna ronda." >&2
        exit 1
      fi
    done
    echo "OK: label '$TOKEN_LABEL' listo, los ${#ISSUES[@]} issues de CT_AC6_ISSUES existen: ${ISSUES[*]}"
  fi
  N=${#ISSUES[@]}
}

reset_all() {
  for n in "${ISSUES[@]}"; do
    gh issue edit "$n" --repo "$REPO" --remove-label status:in-progress --remove-label status:in-review >/dev/null 2>&1 || true
    if ! gh issue edit "$n" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null; then
      echo "FATAL: no se pudo poner #$n en status:ready + $TOKEN_LABEL. Abortando (no se corre la ronda con un fixture a medias)." >&2
      exit 1
    fi
  done
}

run_round() {
  local round="$1"
  reset_all

  local FIFO="$RESULTS_DIR/barrier-${round}.fifo"
  local TIMING="$RESULTS_DIR/timing-${round}.txt"
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
      out="$RESULTS_DIR/round-${round}-issue${n}.out"
      t0=$(python3 -c 'import time; print(int(time.time()*1000))')
      node "$SCRIPT" "$n" --repo "$REPO" >"$out" 2>&1
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

  echo "=== round $round (N=$N) — timing crudo (issue code T0_ms T1_ms jitter) ==="
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
    cat "$RESULTS_DIR/round-${round}-issue${n}.out"
  done

  echo "-- real label state tras la ronda (fuente de verdad) --"
  local inprog=0
  for n in "${ISSUES[@]}"; do
    local labels
    labels="$(gh issue view "$n" --repo "$REPO" --json labels -q '[.labels[].name] | join(",")')"
    echo "#$n: $labels"
    # Exige AMBOS: status:in-progress Y el token compartido (fix round 1,
    # finding Important 3) — contar in-progress sin el token no comprueba
    # nada sobre la premisa del experimento (el token compartido).
    if has_label "$labels" "status:in-progress" && has_label "$labels" "$TOKEN_LABEL"; then
      inprog=$((inprog+1))
    fi
  done
  echo "INVARIANTE (a lo sumo 1 in-progress CON $TOKEN_LABEL): in_progress_count=$inprog $( [[ $inprog -le 1 ]] && echo OK || echo VIOLADO )"
  echo
}

preflight
for r in $(seq 1 "$ROUNDS"); do run_round "$r"; done
