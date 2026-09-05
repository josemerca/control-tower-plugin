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

Solo despacha issues en `status:ready`; `/ct-groom` los crea en `status:backlog` y promoverlos es un paso humano. **stdout es el producto** (el plan, la selección, el motivo de bloqueo con su remedio) y **stderr el diagnóstico** (`aviso:`, `ATENCIÓN:`). Lo que imprime ya trae el remedio: transmítelo tal cual, no lo resumas.

| Exit | Significa | Qué hacer |
|---|---|---|
| `0` | Progreso (algo se lanzó), o nada seleccionable y ya se explicó por qué | seguir con normalidad |
| `1` | Algo se rompió o quedó a medias: precondición sin cumplir, issue huérfano en `status:in-progress`, un lanzamiento sin verificar | parar y que lo mire un humano; **mirar la sesión de cmux antes de borrar nada**; la salida lista los comandos exactos |
| `2` | Error de uso o de configuración estática (flags, `CT_AGENT_BIN`) | corregir la invocación |
| `3` | Tanda seleccionada, cero lanzamientos y nada a medias (carrera de claim perdida contra otro dispatcher) | reintentar más tarde; no es alarma |
| `130` / `143` | Interrumpido (SIGINT / SIGTERM); un claim a medias se revierte solo | nada |

Al despachar un slice con gate `plan` imprime el go (`GO de #N: contesta exactamente -OK <nonce>`), que el humano escribe como comentario del issue; `dispatch-check --release` se niega sin él (exit 9). Las otras transiciones —`--reopen`, `--requeue`, `--collect`— viven en `scripts/dispatch-check.mjs` e imprimen su propio remedio.

No lances dos `/ct-next` a la vez contra el mismo repo: el claim es un label sin compare-and-swap.

Referencia completa —cada mecanismo, sus límites y la historia de las decisiones—: `docs/loop/ct-next.md` en el repo del plugin.
