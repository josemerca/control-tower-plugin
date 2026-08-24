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
pide, córrelo con `--update-slices-contract`: solo reemplaza la sección si su
contenido coincide, byte a byte, con alguno de los bloques que `ct-init` sabe
que emitió (los tiene todos registrados por hash). Si **no** lo reconoce, sale
con exit 3 y **no** afirma que el usuario lo editara: puede ser una edición a
mano o un bloque intacto de una versión del plugin que ese `ct-init` no tenga
registrada, y desde ahí no se distinguen. Si eso pasa, **transmítele al usuario
el aviso tal cual, incluido el hash** — no lo traduzcas a "la editaste tú" ni
supongas cuál de las dos es. `--force` reemplaza igualmente; **nunca lo pases
por tu cuenta**, y solo después de que el usuario confirme que esa sección no
lleva trabajo suyo.

El scaffolder crea también `.agent/conventions.md` — la vara del repo: los
documentos de reglas del código, que `ct-step` pega en el brief de cada tarea.
**Este es el momento de confirmación humana**: enumérale al usuario los
candidatos que veas al explorar el repo (`AGENTS.md`, `CONTRIBUTING`,
`docs/conventions/`…), y escribe en el fichero SOLO lo que el usuario
confirme — no lo rellenes por tu cuenta, y si no confirma nada, déjalo con su
placeholder: la ausencia se mide (`sin-vara`), no se rellena. No es
`.agent/conventions-ack.md` (eso son acuses de señales de colisión de
protocolo del loop, ver más abajo); este fichero declara cómo se escribe
código en este repo.

Al `.gitignore` se le añaden **dos** líneas, las dos idempotentes: `.worktrees/` (los worktrees de slice viven dentro del checkout, y sin esa línea un `git add -A` se traga un árbol de trabajo entero) y `.agent/SLICE.md` (el estado de una sesión despachada, que es estado vivo y local, nunca producto — ver F22 en `commands/ct-next.md`).

En `.agent/STATE.md`, en cambio, **limítate a describir el bootstrap**:

- `task`: `"Bootstrap Control Tower loop (ct-init)"`
- `you_are_here`: qué creó el scaffolder y qué ya existía.
- `next_action`: **déjalo en `"(sin slice asignado)"`**.
- `blocked`: **déjalo en `null`**. Un bootstrap no bloquea nada.
- `verify`: déjalo vacío. Cuando se rellene, es siempre la comprobación **pendiente** que valida el trabajo al terminar — nunca la afirmación de algo ya comprobado.

**NO salgas a buscar trabajo pendiente para rellenar `next_action`.** Es un scaffolder, no un planificador. El `next_action` real lo siembra `/ct-next` en el `.agent/SLICE.md` del worktree cuando despacha un slice (F22 — antes era el `STATE.md` del worktree, que es el de la coordinadora y no del slice), o lo escribe quien arranque uno a mano. Si aquí apuntas a un pendiente que encuentres por el repo, el hook de SessionStart hidratará **todas** las sesiones futuras de ese repo creyendo que eso es lo siguiente — aunque no tenga nada que ver con lo que se vaya a hacer.

Cuando ese `next_action` **caduque** (el trabajo ya no se puede hacer: se paró
por una decisión, el plan resultó falso, falta algo de fuera), la forma de
decirlo **no** es reescribir el campo con la palabra "BLOQUEADO" y las razones
en prosa —eso solo lo entiende quien lo lea bien— sino el campo `blocked` del
frontmatter:

```yaml
blocked: {reason: "por qué no se puede continuar", unblock: "qué haría falta para levantarlo", since: "2026-07-25"}
```

Con eso puesto, el hook de SessionStart abre **toda** sesión nueva de ese repo
con un aviso destacado y declara el `next_action` SUSPENDIDO, en vez de
inyectarlo como lo siguiente que hay que hacer. Levantarlo (borrar el campo o
volver a `null`) es una decisión humana explícita: si te encuentras un STATE.md
bloqueado, no lo levantes por tu cuenta. Un STATE.md que no trae el campo se
lee como **no bloqueado** (todos los anteriores a esto lo son); lo que sí se
anuncia como "no se sabe" es un frontmatter que no se puede parsear.

**Si el scaffolder avisa de convenciones propias del repo** (un bloque
`ATENCIÓN: este repo ya tenía convenciones propias...` por stderr, con
apartados `[claim]`, `[worktrees]` y/o `[estado]`), **transmíteselo al usuario
entero, con la evidencia y la decisión**. No lo resuelvas tú: significa que el
repo ya traía su propio protocolo de claim, su propia ruta de worktrees o su
propio fichero de estado en el terreno que el loop va a ocupar, y elegir cuál
manda es una decisión suya. Si en cambio dice que **no se ha podido comprobar**
(falta `node`), dilo también: ese caso NO es "no hay ninguna", es "no se ha
mirado".

**El aviso tiene salida, y transmitirla es parte de transmitirlo (F14).** Si el
usuario ya tomó la decisión y no la va a cambiar —lo más común: «manda el claim
del plugin, y el script del repo se queda documentado para trabajo a mano fuera
del loop»—, la forma de que esa señal deje de avisar **sin borrar documentación
correcta** es escribirla en `.agent/conventions-ack.md`, una línea por señal:

```
claim: 2026-07-28 — manda el claim del plugin; scripts/dispatch-check.sh se queda para trabajo a mano fuera del loop
```

Silencia **esa** señal y solo esa; las demás siguen avisando, y en las siguientes
corridas queda una nota de una línea diciendo que está silenciada y desde cuándo
(«decidido no mirar esto» y «aquí no hay nada» no son lo mismo). Hacen falta las
tres cosas —señal, fecha y motivo—; una línea que no parsee se reporta y **no**
silencia nada. No escribas tú el acuse: la decisión es del usuario, tú le dices
que existe la salida.

Por último, si el repo no está registrado en `control-tower/tower/workspaces.*.yaml`, dilo; no lo registres tú.
