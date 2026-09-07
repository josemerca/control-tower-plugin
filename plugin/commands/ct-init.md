---
description: Bootstrap de un repo para el loop Control Tower (.agent/STATE.md + AGENTS.md + contrato de slices + plantilla del execution spec)
---
Corre el scaffolder sobre el repo actual y confirma qué creó:
```
bash ${CLAUDE_PLUGIN_ROOT}/scripts/ct-init.sh "$(pwd)"
```

Es idempotente: crea lo que falta y no pisa lo que existe. Siembra `.agent/STATE.md`, `.agent/conventions.md` (la vara del repo), `docs/superpowers/CONTRATO-SLICES.md` (el contrato de la tabla de slices, versionado y mantenido por `/ct-init`), `docs/superpowers/specs/_TEMPLATE-execution-spec.md`, dos secciones en `AGENTS.md` (la del loop, que enlaza al contrato, y la de travesía e2e) y las reglas de `.gitignore` (`.worktrees/`, `.agent/SLICE.md`, `.agent/run-*`).

| Exit | Significa | Qué hacer |
|---|---|---|
| `0` | Bootstrap hecho; los `aviso:` de stderr no son fallos | leer stdout y stderr y transmitirlos |
| `2` | Opción no reconocida | corregir la invocación (`--update-slices-contract`, `--force`) |
| `3` | Se pidió `--update-slices-contract` y el bloque presente no se reconoce, o no se pudo hashear | transmitir el aviso entero, con el hash; `--force` solo si el usuario confirma que ese bloque no lleva trabajo suyo |

Lo que te toca a ti después:

- Rellena en `AGENTS.md` los comandos reales del repo (build, test, lint, CI): para eso sí explora el repo. **No toques** la sección del loop más que para rellenar sus huecos, y **no dupliques, reescribas ni resumas el contrato**: vive en `docs/superpowers/CONTRATO-SLICES.md`, lo mantiene `/ct-init` y solo se actualiza con `--update-slices-contract` cuando el usuario lo pide. Un `AGENTS.md` bootstrapeado con una versión anterior lleva el contrato entero dentro: el scaffolder lo avisa y no lo toca sin ese flag.
- El bloque de stdout que empieza por el literal `Candidatos a la vara de este repo (barrido determinista — PROPONE, no declara):` **se transmite al usuario tal cual**, con sus motivos y las marcas `[esqueleto: sólo encabezados]` (un esqueleto declarado hoy le da al juez un documento vacío que cuenta como vara). En `.agent/conventions.md` escribe SOLO lo que el usuario confirme; si no confirma nada, déjalo con su placeholder.
- Un bloque `ATENCIÓN: este repo ya tenía convenciones propias...` por stderr (`[claim]`, `[worktrees]`, `[estado]`) también se transmite entero, con la evidencia: elegir cuál manda es decisión del usuario. Su salida es una línea `señal: fecha — motivo` en `.agent/conventions-ack.md`; díselo, no la escribas tú.
- «No se ha podido comprobar» (falta `node`) no es «no hay nada»: dilo también.
- En `.agent/STATE.md` describe solo el bootstrap: `task` `"Bootstrap Control Tower loop (ct-init)"`, `next_action` en `"(sin slice asignado)"`, `blocked` en `null`, `verify` vacío. **No salgas a buscar trabajo pendiente**: el `next_action` real lo siembra `/ct-next` en el `.agent/SLICE.md` del worktree.
- Si el repo no está registrado en `control-tower/tower/workspaces.*.yaml`, dilo; no lo registres tú.

Referencia completa —qué siembra cada fichero y por qué, la doctrina de versiones y hashes del contrato, el campo `blocked`, los acuses—: `docs/loop/ct-init.md` en el repo del plugin.
