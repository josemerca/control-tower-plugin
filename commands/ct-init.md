---
description: Bootstrap de un repo para el loop Control Tower (.agent/STATE.md + AGENTS.md)
---
Corre el scaffolder sobre el repo actual y confirma qué creó:
```
bash ${CLAUDE_PLUGIN_ROOT}/scripts/ct-init.sh "$(pwd)"
```
Luego: rellena `AGENTS.md` (build/test/lint reales del repo) y edita `.agent/STATE.md` con el primer `you_are_here`/`next_action`. Recuerda registrar el repo en `control-tower/tower/workspaces.*.yaml`.
