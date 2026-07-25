---
description: Dispatcher — lanza el siguiente slice ready (orden §9, deps mergeadas) en un worktree + cmux
---
Primero en seco para ver qué lanzaría:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-next.mjs --repo "<owner/repo>" --cap 1 --dry-run
```
Si el plan está bien, lánzalo de verdad:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-next.mjs --repo "<owner/repo>" --cap 1
```
Cada slice corre en su worktree `.worktrees/<n>`, con su cuenta (account map) y su `.agent/STATE.md` sembrado; `cmux` arranca `claude` que se hidrata solo (hook SessionStart de Fase 1).

Solo despacha issues en `status:ready` — `/ct-groom` los crea en `status:backlog`, así que un humano tiene que promoverlos primero. Si no hay nada que lanzar, revisa que el epic tenga issues en `status:ready`.

**Claim y release (W-C):** por cada slice seleccionado, `/ct-next` llama en código a `dispatch-check <issue> --repo <repo>` (reclama `status:ready` → `status:in-progress`) ANTES de crear el worktree — ya no es solo una instrucción del kickoff que el agente podría no ejecutar. Si el claim falla porque colisiona con trabajo en vuelo o pierde una carrera (exit 1 de `dispatch-check`), ese slice se salta (se imprime el motivo) y se sigue con el resto de la tanda si `--cap` da para más. Si el claim se obtiene pero el dispatch falla DESPUÉS (el propio `git worktree add`, el seed de `.agent/STATE.md`, o el lanzamiento de `cmux`), `/ct-next` revierte el claim a `status:ready` automáticamente — y si ese revert también falla, lo dice alto y imprime el comando manual exacto para arreglarlo. `--dry-run` muestra qué issue se reclamaría, sin ejecutar `dispatch-check` de verdad (ningún `gh` real se toca). El **release** (`status:in-progress` → `status:in-review`) sigue viviendo en el kickoff — el propio prompt del agente lanzado ya trae el comando literal `dispatch-check <issue> --repo <repo> --release` para cuando termine y el PR esté abierto; el gate de conformidad de PR de la Fase 3 es el respaldo si el agente no lo ejecuta.

Que `/ct-next` ahora SÍ llame a `dispatch-check` no cambia la garantía del lock en sí — sigue siendo el mismo mecanismo de labels sin compare-and-swap descrito abajo. Lo que cambia es que, antes de esto, `dispatch-check` nunca se invocaba desde el loop real y ningún issue llegaba a `status:in-progress`; ahora sí se invoca, así que la advertencia de abajo deja de ser una salvedad teórica y pasa a aplicar de verdad en cada corrida.

**Advertencia honesta sobre el claim concurrente (T11):** el lock que usa `dispatch-check.mjs` para reclamar un issue (`status:ready` → `status:in-progress`) es labels de GitHub, sin compare-and-swap. Está reproducido y verificado (no solo sospechado) que dos dispatchers lanzados casi a la vez pueden reclamar el mismo token compartido (`area:`/`touches:`) y arrancar los dos — ver `scripts/experiments/ac6-race2-deterministic.sh` y `task-11-report.md` §3 para la evidencia (3/3 rondas con doble claim real en su corrida más reciente, confirmado contra el estado de los labels en GitHub, y sin excepciones en ninguna corrida hecha durante su desarrollo). No hay ninguna espera ni reintento que cierre este hueco hoy. **La mitigación real es operativa: no lances dos `/ct-next` (ni dos dispatchers) al mismo tiempo contra el mismo repo.** El plan es migrar el claim a una primitiva atómica real (test-and-set vía `git refs`); hasta entonces, esta es la única garantía que existe.
