---
description: Bootstrap de un repo para el loop Control Tower (.agent/STATE.md + AGENTS.md)
---
Corre el scaffolder sobre el repo actual y confirma qué creó:
```
bash ${CLAUDE_PLUGIN_ROOT}/scripts/ct-init.sh "$(pwd)"
```
Luego rellena `AGENTS.md` con los comandos reales del repo (build, test, lint, CI): para eso sí explora el repo.

`AGENTS.md` ya trae (el scaffolder la crea o la añade solo) una sección
**"Formato de la tabla §9 (contrato con /ct-groom)"**, delimitada por
`<!-- ct-init:slices-contract --> ... <!-- /ct-init:slices-contract -->`.
Es el contrato que necesita quien escriba specs para este repo — **no la
dupliques, no la reescribas, no la resumas en otra sección**, aunque al
explorar el repo te parezca que falta o que la redactarías distinto. Si el
usuario la ha editado a mano, respétala tal cual está.

La sección lleva su propia versión (`<!-- ct-init:slices-contract-version: N -->`).
Si el repo ya estaba bootstrapeado con una versión anterior, el scaffolder lo
**avisa por stderr** y no toca nada: adoptar la nueva es una decisión
explícita del usuario, no un efecto colateral de correr `/ct-init`. Si te lo
pide, córrelo con `--update-slices-contract` (solo reemplaza la sección si
está tal cual la dejó `ct-init`; si la habían editado a mano, se niega con
exit 3 y hay que añadir `--force` para perder esas ediciones). **Nunca pases
`--force` por tu cuenta.**

En `.agent/STATE.md`, en cambio, **limítate a describir el bootstrap**:

- `task`: `"Bootstrap Control Tower loop (ct-init)"`
- `you_are_here`: qué creó el scaffolder y qué ya existía.
- `next_action`: **déjalo en `"(sin slice asignado)"`**.

**NO salgas a buscar trabajo pendiente para rellenar `next_action`.** Es un scaffolder, no un planificador. El `next_action` real lo siembra `/ct-next` en el STATE.md del worktree cuando despacha un slice, o lo escribe quien arranque uno a mano. Si aquí apuntas a un pendiente que encuentres por el repo, el hook de SessionStart hidratará **todas** las sesiones futuras de ese repo creyendo que eso es lo siguiente — aunque no tenga nada que ver con lo que se vaya a hacer.

Por último, si el repo no está registrado en `control-tower/tower/workspaces.*.yaml`, dilo; no lo registres tú.
