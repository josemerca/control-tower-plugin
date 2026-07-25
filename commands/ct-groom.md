---
description: Groom de un epic — spec §9 → GitHub (Milestone + issues + labels + Project v2 + Sprint)
---
Corre el groom sobre el spec del epic. Primero en seco para revisar el plan:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --section 9 --dry-run
```
Revisa el JSON. Si está bien, ejecútalo de verdad (añade `--project <n>` para el Project v2):
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --project <n>
```
Es idempotente: re-ejecutarlo no duplica milestone ni issues (marca cada issue con `<!-- ct-order:N -->`).
