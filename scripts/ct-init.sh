#!/usr/bin/env bash
# ct-init: bootstrap de un repo para el loop Control Tower. Idempotente.
set -euo pipefail
TARGET="${1:?uso: ct-init.sh <dir-repo>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$TARGET/.agent"
if [ ! -f "$TARGET/.agent/STATE.md" ]; then
  cp "$HERE/skills/state-template/STATE.template.md" "$TARGET/.agent/STATE.md"
  echo "creado $TARGET/.agent/STATE.md"
else
  echo "STATE.md ya existe, no se pisa"
fi

GITIGNORE="$TARGET/.gitignore"
touch "$GITIGNORE"
# Normaliza un salto de línea final ANTES de tocar nada más (bloqueante de la
# re-review): si el fichero ya tiene contenido pero no termina en `\n` (p.ej.
# `printf 'node_modules/' > .gitignore`, sin salto final), un `>>` de bash
# concatena la línea nueva en la MISMA línea que la última — corrompe la
# regla previa del usuario (`node_modules/` deja de ignorarse, ¡en SU repo,
# no en el nuestro!) y además `.worktrees/` tampoco queda ignorado de verdad
# (todo el propósito del finding 6, silenciosamente incumplido). `tail -c1 |
# wc -l` es el idiom robusto para detectar "termina en \n": mirar
# directamente `$(tail -c1 ...)` no sirve porque la sustitución de comandos
# siempre recorta los saltos de línea finales, así que un fichero que SÍ
# termina en \n sería indistinguible de uno vacío.
if [ -s "$GITIGNORE" ] && [ "$(tail -c1 "$GITIGNORE" | wc -l)" -eq 0 ]; then
  echo >> "$GITIGNORE"
fi
# .worktrees/ (fix de la review final, finding 6): ct-next.mjs escribe cada
# worktree de slice en <repoRoot>/.worktrees/<n>, dentro del propio checkout.
# Si el repo destino no lo ignora, un `git add -A` en el checkout principal
# se traga un working tree anidado entero, y un `git clean -fdx` destruye
# worktrees vivos. Idempotente: solo añade la línea si no está ya (grep
# exacto de línea completa), igual que el resto de este script no pisa lo
# que ya existe.
if ! grep -qxF '.worktrees/' "$GITIGNORE"; then
  echo '.worktrees/' >> "$GITIGNORE"
  echo "añadido .worktrees/ a $GITIGNORE"
else
  echo ".worktrees/ ya está en $GITIGNORE, no se duplica"
fi

if [ ! -f "$TARGET/AGENTS.md" ]; then
  cat > "$TARGET/AGENTS.md" <<'EOF'
# AGENTS.md
<!-- Guía durable del repo (≤150 líneas). Procedimientos → Skills. -->
## Project overview
## Setup commands
## Build, test & lint
## Code style & conventions
## Project layout
## Workflow: 1 issue = 1 slice = 1 session
## Commit & PR rules
## Security & data handling
## Do NOT touch
## Gotchas
## Skills (load on demand)
EOF
  echo "creado $TARGET/AGENTS.md"
else
  echo "AGENTS.md ya existe, no se pisa"
fi
