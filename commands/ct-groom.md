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

Los issues se crean en `status:backlog`, nunca `status:ready` — es una gate humana deliberada: un humano tiene que promoverlos a `status:ready` (a mano, o editando el label) antes de que `/ct-next` los considere despachables. Si `/ct-next` responde "No hay slices despachables" justo después de un groom, es casi seguro que sea esto.

`/ct-groom` no emite labels `touches:`/`area:` (se deja al formulario de creación de issues, a propósito): hasta que se añadan a mano, la maquinaria de colisión y serialización de `/ct-next`/`dispatch-check` queda inerte para los issues de este epic.
