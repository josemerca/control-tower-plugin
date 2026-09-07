---
description: Groom de un epic — spec §9 → GitHub (Milestone + issues + labels + Project v2 + Sprint)
---
Corre el groom sobre el spec del epic. Primero en seco para revisar el plan:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --dry-run
```
Revisa el JSON. Si está bien, ejecútalo de verdad (añade `--project <n>` para el Project v2):
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --project <n>
```

Groomea con el spec ya empujado a la rama por defecto (si no, los issues nacen sin enlace al spec). Una invocación = un `--milestone` = un epic. Es idempotente por existencia: re-ejecutar no duplica, pero tampoco converge — las divergencias se reportan por stderr y solo se aplican con `--reconcile` (EXPERIMENTAL: revisa el diff del issue después). Los issues nacen en `status:backlog`; promoverlos a `status:ready` es humano. **stdout es el plan** y **stderr son los `aviso:`, `nota:` y `divergencia:`**: transmítelos tal cual.

| Exit | Significa | Qué hacer |
|---|---|---|
| `0` | Sin divergencia real (o `--reconcile` la resolvió) | promover a `status:ready` lo que deba volar |
| `1` | Parada en seco, **nada creado ni modificado**: un issue sin milestone cuyo `ct-order` colisiona, un epic renombrado, un fallo de `gh`, una precondición de `--project` (campo `Sprint`, iteración vigente) | leer el motivo, arreglar, repetir |
| `2` | El spec no entra: tabla mal formada, `Dep` irreconocible, gate desconocido, exención sin razón, marcador de clarificación pendiente, `## Hipótesis` ausente | corregir el spec — se reportan todos los errores juntos, también bajo `--dry-run` |
| `3` | Queda algo real sin reconciliar: título, enlace al spec, labels, AC, deps, `## E2E`, una sección duplicada o un issue huérfano | revisar en GitHub; `--reconcile` lo aplica |

`--dry-run --repo` devuelve el mismo `3` que la corrida real: si automatizas, no encadenes con `&&`.

El formato de la tabla lo fija el contrato que `/ct-init` siembra en cada repo (`docs/superpowers/CONTRATO-SLICES.md`). Referencia completa —columnas, aborts, `--reconcile`, el enlace al spec y la historia—: `docs/loop/ct-groom.md` en el repo del plugin.
