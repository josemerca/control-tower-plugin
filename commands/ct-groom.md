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

La tabla §9 del spec admite dos columnas opcionales, `Área` y `Toca` (acepta también `Area` sin tilde), con valores separados por coma (`–`/`-`/vacío = ninguno):
```
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|
| 1 | modelo | backend | tabla users | – | AC-1.1 | schema | api | db, migration |
| 2 | api | backend | endpoint | #1 | AC-2.1 | – | api | – |
```
`/ct-groom` traduce cada valor en labels `area:<x>`/`touches:<y>` sobre el issue — son las mismas que `claim.js#tokensOf` y `dispatch.js#SERIALIZING_TOUCHES` usan para detectar colisión y forzar serialización. Si un slice no declara `Área`/`Toca` (o el spec ni siquiera trae esas columnas), no se emite ninguna label de ese tipo y la maquinaria de colisión/serialización queda inerte para ese slice, igual que antes.
