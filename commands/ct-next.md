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

**Advertencia honesta sobre el claim concurrente (T11):** el lock que usa `dispatch-check.mjs` para reclamar un issue (`status:ready` → `status:in-progress`) es labels de GitHub, sin compare-and-swap. Está reproducido y verificado (no solo sospechado) que dos dispatchers lanzados casi a la vez pueden reclamar el mismo token compartido (`area:`/`touches:`) y arrancar los dos — ver `scripts/experiments/ac6-race2-deterministic.sh` y `task-11-report.md` §3 para la evidencia (3/3 rondas con doble claim real en su corrida más reciente, confirmado contra el estado de los labels en GitHub, y sin excepciones en ninguna corrida hecha durante su desarrollo). No hay ninguna espera ni reintento que cierre este hueco hoy. **La mitigación real es operativa: no lances dos `/ct-next` (ni dos dispatchers) al mismo tiempo contra el mismo repo.** El plan es migrar el claim a una primitiva atómica real (test-and-set vía `git refs`); hasta entonces, esta es la única garantía que existe.
