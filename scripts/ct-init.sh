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
