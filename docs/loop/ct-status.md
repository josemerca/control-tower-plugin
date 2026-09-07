# `/ct-status` — referencia y diseño

> Texto movido íntegro desde `plugin/commands/ct-status.md` (sub-issue #93). El comando conserva la invocación, la tabla de códigos de salida y un enlace a este documento.

La invocación:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-status.mjs --repo "<owner/repo>"
```


Responde de una sola vez la pregunta que el coordinador se contestaba a mano cada vez, cruzando `pgrep` + `lsof` + `gh issue view` + `gh pr list` + `git worktree list` + `git rev-list`: **¿en qué estado está el loop ahora mismo?**

**Se ejecuta desde el checkout del repo que se está mirando.** Los issues salen de `--repo`; los worktrees, las ramas y los procesos salen del checkout. El comando **comprueba que las dos mitades hablan del mismo repositorio** (el `origin` del checkout contra `--repo`) antes de mirar nada local: si no coinciden, o si no se puede verificar —un checkout sin `origin`, por ejemplo—, no inventa nada, avisa y sale con `1`. Sin esa comprobación, preguntar por otro repo producía tres hallazgos que no existían, incluida una acusación de abandono. Da igual desde qué directorio lo invoques: **desde dentro de un `.worktrees/<n>` también funciona**, porque resuelve el checkout principal, no el worktree en el que estás parado.

**No muta nada.** Ni labels, ni worktrees, ni ramas: no hay una sola escritura en todo el camino, y hay un test que lo comprueba mirando el argv real con el que se llamó a `gh` (no la ausencia de errores — un comando puede mutar y salir con 0 tan campante). Esa es la propiedad que te deja invocarlo sin pensártelo, y la que permite que lo llame en bucle un vigilante externo. Todo lo que encuentra lo **nombra**; borrar el worktree de alguien que sigue trabajando es irreversible, así que eso lo decides tú.

**Ninguna lectura lleva `--limit`.** Todo pagina. Es el defecto que originó este comando: una comprobación artesanal con `gh issue list --state closed --limit 60` sobre 99 issues cerrados reportó **6 casos cuando eran 10**, y el fallback imprimió además «(ninguno — limpio)».

## Los tres códigos de salida

| Código | Significa | Qué hacer |
|---|---|---|
| `0` | nada que revisar: nada en vuelo sin señales de vida, ningún residuo, ninguna lectura a medias | nada |
| `3` | hay algo que revisar: residuo, un claim sin proceso vivo, labels huérfanas, entregas sin cosechar | leer los bloques del informe (abajo) |
| `1` | **no se pudo comprobar**: falló una lectura de `gh`, de los procesos o del disco | mirar los `aviso:` de stderr, arreglar la causa y volver a correrlo — el informe que se ha impreso es sólo lo que sí se sabe |

Misma convención de tres estados que `/ct-groom`, así que no hay vocabulario nuevo que aprender.

**El `1` nunca se degrada a `0`.** La precedencia es `1` > `3` > `0`, nunca al revés: si algo no se pudo comprobar, el resultado es `1` aunque todo lo demás esté impecable. Una lectura incompleta **no es** un loop en reposo, y quien recibe la señal tiene que poder distinguirlas — un `0` sobre datos truncados es exactamente el fallo que este comando viene a eliminar. Por eso la línea de «loop en reposo» sólo se imprime cuando no queda nada sin comprobar, y por eso un worktree en disco no se acusa de huérfano si la lectura de issues falló. Ojo al motivo exacto, que no es «entonces no se sabe nada»: con una lectura parcial, los issues que **sí** llegaron siguen explicando sus worktrees, y el informe lo dice. Lo que no se puede concluir es que a los demás **no los reclama nadie**, porque un issue que no llegó podría reclamarlos — y acusarlos sería inventarse el hallazgo. El aviso nombra sólo los que ninguna de las lecturas que sí funcionaron explica.

**Un hallazgo parcial no oculta el resto.** Si falla la lectura de procesos pero la de issues va bien, se informa de lo que sí se sabe, se avisa de lo que no, y se sale con `1`. El informe va por **stdout** (es el producto); los avisos, por **stderr**, como el resto del plugin.

**Los bloques vacíos no se imprimen.** Un loop en reposo produce dos líneas, no tres encabezados con «(ninguno)».

## Qué hacer ante cada bloque

**`EN VUELO`** — los issues en `status:in-progress`, con sus señales: worktree, rama, y si hay un proceso trabajando dentro del worktree.

- `proceso ✓` — hay alguien trabajando. No hay nada que hacer.
- `← arrancando` — no hay proceso todavía, pero el claim se acaba de poner (por debajo de la ventana de arranque, 15 s por defecto: el mismo presupuesto del centinela de `/ct-next`, y se lee de la misma variable `CT_NEXT_LAUNCH_TIMEOUT_MS`). Justo después de un despacho, `cmux` todavía está tecleando el comando. No es un hallazgo: vuelve a mirar en unos segundos.
- `← SIN SEÑAL DE VIDA` — hay claim, el claim no es reciente, y no hay ningún proceso trabajando en ese worktree. Es el caso que ninguna otra señal del loop detecta: al morir, un agente deja worktree, rama y ventana de `cmux` en su sitio, así que todo lo demás sigue diciendo «vivo». Mira la ventana de `cmux` de ese slice; si de verdad no hay nadie, el remedio manual es devolver el claim a la cola —`gh issue edit <n> --repo <o/r> --add-label status:ready --remove-label status:in-progress`, el mismo comando que `/ct-next` imprime cuando tiene que revertir un claim a mano— y limpiar worktree y rama si vas a empezar de cero. (`dispatch-check --reopen` **no** sirve aquí: exige `status:in-review`, y esto está en `status:in-progress`.)
- `proceso ?` — no se pudo comprobar. Lee el aviso: nadie está acusado de nada.

**`ENTREGADO, ESPERANDO MERGE`** — los issues en `status:in-review`: trabajo terminado cuyo PR todavía no se ha mergeado. Es **informativo y no cuenta como hallazgo**: no altera el código de salida, y su worktree no es residuo (está ahí a propósito). Está aquí porque el comando responde tres preguntas —qué está en vuelo, **qué ha entregado**, qué es residuo— y ésta es la segunda. Lo único que hay que hacer con este bloque es mergear los PRs; recuerda que un `in-review` **retiene los tokens `area:`/`touches:` hasta el merge**, así que frena a sus vecinos de área. No confundir con el bloque de abajo: éste es lo que espera merge, aquél es lo ya mergeado que dejó restos. Los dos pueden salir a la vez.

Y una regla que este informe no puede aplicar por ti: **lo que compruebes antes de mergear tiene que poder detener el merge.** Este comando imprime; no bloquea nada. Si lo usas como paso previo a un merge, el que decide eres tú — y una comprobación cuyo resultado no detiene la acción siguiente es decoración, no comprobación.

**`ENTREGADO, SIN COSECHAR`** — slices ya cerrados como completados que todavía dejan `.worktrees/<n>` o `feat/<n>` en disco. Ocupan sitio y, sobre todo, el worktree **bloquea el redespacho de ese número**. Cuando confirmes que no queda nada que rescatar: `git worktree remove .worktrees/<n>` y `git branch -d feat/<n>`.

**`RESIDUO`** — dos cosas distintas, y el informe las distingue porque el remedio no es el mismo:

- `#N cerrado, pero conserva status:…` — la label sobrevivió al cierre del issue. Cerrar el issue y quitarle la label son dos actos separados y nada comprueba el segundo, así que esto se acumula solo (medido en un repo real: 10 de 99 issues cerrados). Quítala con `gh issue edit <n> --repo <o/r> --remove-label status:<x>`.
- `.worktrees/<n> su issue #N sigue abierto (status:…) y no está en vuelo` — el issue está **vivo**, pero ni lo está trabajando nadie (no es `in-progress`) ni ha entregado (no es `in-review`, ésos van a su propio bloque): típicamente un `ready` o un `blocked` que dejó worktree de una vuelta anterior. Sale nombrado porque mientras exista, `/ct-next` se niega a despachar ese número.
- `.worktrees/<n> ningún issue lo reclama` — ni hay issue abierto con ese número ni consta ninguno entregado que lo dejara atrás: un worktree abandonado, requeueado, o de un issue cerrado sin mergear. Éste es el candidato claro a `git worktree remove`.

**Antes de borrar, lee la coletilla de la línea.** Cuando la comprobación de procesos se ha podido hacer, cada worktree del bloque dice si hay alguien trabajando dentro **ahora mismo** (`OJO: hay un proceso trabajando dentro ahora mismo (pid N), no lo borres`) o si no lo hay. Si la comprobación falló, la línea **no dice nada** sobre procesos — el silencio ahí significa «no se sabe», nunca «no hay nadie».

## Qué significa exactamente «sin señal de vida»

Que **en esta máquina** no hay ningún proceso `claude` cuyo directorio de trabajo esté dentro de `.worktrees/<n>`: se listan los procesos de tu usuario (`ps -u <uid> -o pid=,comm=`), se filtran los que se invocaron por una ruta cuyo último segmento es exactamente `claude`, y una sola llamada a `lsof` lee el `cwd` de todos ellos de golpe.

Se identifica por **la ruta invocada**, no por el nombre del proceso, y esto tiene consecuencias que conviene conocer. El instalador nativo deja `~/.local/bin/claude` como symlink a `~/.local/share/claude/versions/<versión>`, así que el nombre del proceso que ve el sistema **es el número de versión** (medido: `ps -o ucomm=` devuelve `2.1.221`), no `claude`. Y la app de escritorio queda fuera por el mismo criterio, sin reglas especiales: su ejecutable es `Claude` con mayúscula y sus helpers son `Claude Helper` — una ventana abierta no es un agente trabajando en un worktree.

Tres precisiones que hay que tener presentes antes de actuar sobre ese aviso:

1. **Es local, y sólo local.** El comando no puede afirmar que nadie esté trabajando ese slice en **otra máquina**, ni dentro de un contenedor, ni bajo otro usuario del sistema. Dice lo que ve desde aquí. Si el loop de ese repo se despacha desde más de un sitio, «sin señal de vida» significa «no lo está trabajando nadie *aquí*».
2. **Avisa, nunca revierte.** No quita el claim, no borra el worktree, no toca la rama. La decisión —y sus consecuencias— son tuyas.
3. **Cuando no se puede comprobar, no se acusa.** Si `ps` o `lsof` faltan, fallan, se cuelgan (las dos llamadas llevan tope de tiempo) o devuelven algo ilegible, el informe dice **«no se pudo comprobar»** y sale con `1`; jamás «muerto». Lo mismo con la edad del claim: si el timeline del issue no se puede leer, ese slice no se declara abandonado — se dice que no se sabe de cuándo es su claim. Acusar de abandono a un slice sano porque falta una herramienta sería el peor fallo posible de este comando.

La edad del claim sale del **timeline** del issue (el evento `labeled` más reciente para `status:in-progress`), no del `updated_at` del issue: ése cambia con cualquier edición —un comentario, otra label—, así que un comentario reciente haría pasar por «arrancando» un claim de hace tres horas.
