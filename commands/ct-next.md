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
