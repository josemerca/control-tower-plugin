<!-- ct-init:slices-contract -->
<!-- ct-init:slices-contract-version: 6 -->
## Formato de la tabla §9 (contrato con /ct-groom)
`/ct-groom` lee esta tabla del spec del epic y crea un issue de GitHub por
fila — es la única parte de un spec que un programa parsea. Cabecera exacta,
copiable tal cual:

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|

- **`#`** *(obligatoria)*: entero puro (`1`, `2`…) → orden del slice y target
  de `Dep`. Nunca `S1` ni `**1**` (negrita/prefijo): la fila entera se
  descarta.
- **Slice** *(obligatoria)*: nombre corto de la fila — alimenta el TÍTULO del
  issue (`#N <Slice>`). Vacía, con marcador de "sin valor", o que solo trae
  una referencia `#N` sin ningún nombre alrededor → fila descartada (mismo
  trato que antes tenía una `Entrega` vacía). Si la celda ya trae una
  referencia `#N` (p.ej. un issue creado a mano antes de correr
  `/ct-groom`), esa referencia se extrae aparte y NO aparece en el título.
  Ese mismo título es lo que `/ct-next` reinyecta al despachar: la primera
  línea del kickoff del agente y el nombre del workspace cmux salen de aquí
  — por eso conviene que sea corto y legible, no una frase.
- **Tipo** *(opcional)*: label `type:<valor>` del issue. Además decide qué
  addendum recibe el agente al despachar (`/ct-next` → `kickoff.js`):
  valores reconocidos hoy son `ui`, `backend`, `infra`, `bugfix` — cada uno
  con su propio addendum (el de `ui`, por ejemplo, impone el gate de
  screenshot obligatorio). Un valor que no sea ninguno de esos NO aborta,
  pero `/ct-groom` avisa por stderr: el agente despachado para ese slice no
  recibirá ningún addendum de tipo, y sin ese aviso pasaría en silencio.
- **Entrega** *(opcional)*: texto de qué entrega el slice → sección
  "Descripción" del cuerpo del issue. Ya NO alimenta el título (eso lo hace
  `Slice`, ver arriba).
- **Dep**: `#N` (varias, separadas por coma) apuntando a otro `#` de esta
  misma tabla, o marcador de "sin valor" si no depende de nada. `S1` no
  sirve — usa `#1`. Alimenta el grafo `merge-after` que respeta `/ct-next`.
  En el cuerpo del issue aparece como ``merge-after `#N` `` (entre backticks,
  a propósito: un `#N` desnudo lo convertiría GitHub en un enlace al issue
  número N de este repo, que no tiene nada que ver). Ese `#N` **siempre es el
  `#` de esta tabla — el ORDEN del slice, nunca un número de issue**;
  `/ct-next` lo traduce por el marcador `ct-order` que cada issue lleva al
  final.
- **Acepta** *(opcional)*: criterios de aceptación separados por coma →
  sección "Acceptance criteria" del issue, uno por línea. **La coma separa
  SIEMPRE**: un criterio en EARS ("Cuando caduca el token, el sistema pide
  login") se partiría en dos criterios a medias. Si el tuyo lleva coma,
  escápala como `\,` (`Cuando caduca el token\, el sistema pide login`) o
  reformula sin ella. Solo la secuencia exacta `\,` es un escape — una barra
  invertida suelta se conserva tal cual.
- **Protegido** *(opcional)*: qué queda fuera de alcance → sección "Out of
  scope / Protected" del issue. Texto libre de una sola pieza: aquí la coma
  **no** separa nada, escribe con normalidad.
- **Área / Toca** *(opcionales, separadas por coma)*: tokens → labels
  `area:<x>` / `touches:<y>`. Misma clave que usan la detección de colisión
  (`claim.js#tokensOf`) y la serialización (`dispatch.js#SERIALIZING_TOUCHES`):
  reutiliza el vocabulario de labels que ya exista en este repo, no inventes
  uno nuevo por spec. Para ver cuál existe: `gh label list --repo
  <owner/repo>` (y `/ct-groom` te dice, al correr, qué labels ha creado
  NUEVAS y cuáles ha reutilizado — si aparece una nueva que esperabas
  reutilizar, es que has escrito un sinónimo). Un token no puede contener
  comas: se descartan al normalizar, aquí `\,` no sirve de nada.
  `migration`/`ci`/`pbxproj` en `Toca` son especiales — serializan entre sí:
  como mucho un slice con uno de esos tres sin mergear a la vez, sin importar
  `Área`. El alcance real de ese "global" está más abajo, en "Qué hace
  `/ct-next` con esto": es global **al flujo de issues de este repo**, que no
  es lo mismo que global al repo.

Marcadores de "sin valor" (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`): `–` `-`
`—` `―` `−` `--` o celda vacía — cualquier variante de guion vale.

### Lo que crea `/ct-groom` NO es despachable todavía

Todos los issues nacen con **`status:backlog`**, y `/ct-next` solo despacha
`status:ready`. Promoverlos es un paso **humano y deliberado** — es el gate
del loop: tú decides qué entra en vuelo y cuándo, el groom nunca lo hace por
ti. Si `/ct-next` responde "no hay slices despachables" justo después de
groomear un epic entero, es esto:

```
gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog
```

`/ct-groom` recuerda al terminar cuántos issues del epic siguen en backlog.
De ahí en adelante el label `status:` lo mueven `/ct-next` y el flujo
(`ready` → `in-progress` → `in-review`, y de vuelta a `ready` si la revisión
rechaza el PR — ver "Rechazar un PR" más abajo), no el spec — por eso
re-groomear nunca lo compara ni lo revierte.

### Decisiones tuyas que dependen de cómo se invoque `/ct-groom`

- **`--milestone "<título>"`** (por defecto `Epic`): una invocación = un epic
  = un milestone, que `/ct-groom` crea si no existe. Los `#` de esta tabla son
  únicos **dentro de su milestone**, no del repo: dos epics distintos pueden
  usar `#1` sin pisarse. Pero si dos epics comparten milestone (p.ej. ambos
  con el título por defecto `Epic`), sus órdenes chocan y `/ct-next` excluye
  ese epic entero de la selección, avisando. Dale a cada epic su propio
  título de milestone.
- **`--section N`**: OBSOLETO, se acepta y se ignora (avisando). Nunca decidió
  qué se groomeaba: la tabla se localiza por su **cabecera** (una fila con
  columnas `Slice` y `Dep`), no por ningún número de sección — así que si el
  documento trae ANTES otra tabla con esas dos columnas, se groomeará esa. Una
  sola tabla de slices por spec. Lo único que hacía `--section` era componer el
  ancla del enlace al spec como `#N`, un ancla que en GitHub no existe.
- **El enlace al spec** que se escribe en cada issue sale ahora del encabezado
  real bajo el que pongas la tabla (`## 9. Slices` → `…/blob/<rama por
  defecto>/ruta/al/spec.md#9-slices`), y se **verifica** contra GitHub antes de
  escribirlo. Consecuencia para ti: **empuja el spec antes de groomear**. Si el
  fichero no está publicado en la rama por defecto, los issues nacen con una
  referencia de texto sin enlace (diciendo por qué), y `/ct-groom` no lo corrige
  en corridas posteriores sin `--reconcile`.
- **`--project <n>`** *(opcional)*: mete cada issue en el Project v2 número
  `n` **del mismo owner que `--repo`** (un project de otro owner no está
  soportado) y le fija el campo de iteración llamado exactamente `Sprint` a la
  iteración vigente hoy. Si no existe ese campo, o ninguna iteración cubre la
  fecha de hoy, `/ct-groom` aborta **sin haber creado nada** — ni milestone, ni
  labels, ni issues. (Hasta el contrato v5 esto no era cierto: el project se
  validaba después del milestone y de las labels, y un abort las dejaba
  creadas.)

#### Qué garantiza `/ct-groom` sobre lo que ya ha tocado cuando falla

Esto importa porque la respuesta natural —"un abort a mitad deja el repo a
medias"— asusta y lleva a limpiar a mano cosas que no hay que limpiar.

- **Todo lo que `/ct-groom` LEE ocurre antes de todo lo que ESCRIBE.** Las
  validaciones —argumentos, tabla §9, spec y su enlace, listado de issues, de
  labels y de milestones, y (con `--project`) el campo `Sprint` con su
  iteración vigente— van **todas** por delante de la primera mutación. Si
  aborta por cualquiera de ellas, **no ha creado nada**.
- **Lo que NO se promete: no hay transacción.** Una vez empieza a escribir, el
  orden es milestone → labels → issues → alta en el Project. Un fallo *ahí* en
  medio (red, rate limit, auth caída, un Ctrl-C) deja creado lo anterior. No
  hay rollback y no se finge que lo haya.
- **De eso se sale volviendo a correr, no limpiando a mano.** `/ct-groom` es
  idempotente por construcción: el milestone se reutiliza por título, de las
  labels solo se crean las que faltan (las que ya existían **no** se tocan,
  ni su color ni su descripción), los issues se reconocen por su marcador
  `ct-order` y no se duplican, y un issue que quedó fuera del Project se
  detecta y se añade en la siguiente corrida.
- **Sin `--reconcile`, un issue que ya existe NUNCA se edita.** Las
  divergencias se reportan y se sale `3`; nada se escribe.
- **`--dry-run` no muta nada, nunca** — ni siquiera crea el milestone.

Ejemplo que parsea tal cual (verificado con `ct-groom.mjs --dry-run`):

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|
| 1 | modelo | backend | tabla `medicamentos` | – | AC-1.1 | schema | medicacion | db, migration |
| 2 | api | backend | endpoint `POST /medicamentos` | #1 | AC-2.1 | – | medicacion | api |
| 3 | pantalla | ui | pantalla de alta | #2 | AC-3.1 | – | medicacion | app |

**Arreglar la tabla y volver a groomear NO arregla los issues ya creados.**
Re-ejecutar `/ct-groom` no los duplica (los reconoce por su marcador
`ct-order`), pero tampoco los actualiza: compara título, enlace al spec,
milestone, labels (`type:`/`area:`/`touches:`; `status:` nunca) y las dos
secciones que el dispatcher obedece
(`## Dependencias`, `## Acceptance criteria`) contra lo que la tabla produce
hoy, **reporta** cada diferencia por stderr y sale `3` — pero no escribe nada
salvo que se le pase `--reconcile` (EXPERIMENTAL: ha corrompido bodies reales
en pruebas, revisa el diff del issue después de usarlo). Un issue cuyo slice
ya no está en la tabla se avisa como huérfano y no se toca. Si cambias algo
en una fila ya groomeada, cuenta con revisar ese issue a mano.

Detalle completo (todas las condiciones de abort, columnas opcionales,
avisos no fatales, el reporte de divergencia, sus límites, y `--reconcile`):
`commands/ct-groom.md` en el plugin `control-tower-loop`.

### Qué hace `/ct-next` con esto

Lo de abajo NO es la referencia de invocación (esa es `commands/ct-next.md` en
el plugin): es lo que cambia cómo escribes la tabla y cómo convives con el
loop una vez hay slices en vuelo.

- **`Área`/`Toca` no avisan: BLOQUEAN.** Un slice que comparta **un solo
  token** con un issue en `status:in-progress` **o `status:in-review`**
  no se despacha — `/ct-next` lo salta y prueba el siguiente candidato; si no
  queda ninguno, no lanza nada y dice contra qué issue chocó y en qué estado.
  Elegir los tokens **es** elegir qué puede volar en paralelo: dos slices con
  un token en común quedan serializados aunque toquen ficheros distintos.
- **Un token se retiene hasta el MERGE, no hasta que el agente pare.** El
  agente libera su claim al abrir el PR (`in-progress` → `in-review`), y eso
  suelta el **cap** — pero no los tokens: hasta que el PR se mergea y el
  issue se cierra, `main` todavía no contiene ese trabajo, así que un vecino
  de área ramificaría de una base incompleta. Consecuencia al diseñar la
  tabla: **un PR sin mergear frena a sus vecinos de área**, no solo a sus
  dependientes. Dos slices que comparten token no se solapan ni "un poquito".
  Y si `/ct-next` te dice que choca con un `status:in-review`, esperar no
  sirve de nada: ahí no hay ningún agente. Mergea el PR — o, si el PR ya se
  mergeó y el issue sigue abierto (al PR le faltaba `Closes #N`), ciérralo.
- **`migration`/`ci`/`pbxproj` serializan además GLOBALMENTE, con un alcance
  concreto.** Son dos reglas distintas actuando a la vez: la de arriba
  compara tokens, esta no. Un slice con `Toca: migration` y otro con
  `Toca: ci` **no comparten ningún token** y aun así no pueden estar sin
  mergear a la vez, sin importar `Área`. **Qué significa "global" de verdad:
  `/ct-next` solo mira issues de ESTE repo con `status:in-progress` o
  `status:in-review`.** Todo lo que va por fuera del flujo de issues es
  INVISIBLE para esta regla: otra rama, otro track de trabajo, un humano
  editando la misma migración a mano, un repo distinto. La serialización es
  global **al flujo de issues de este repo**, no al repositorio ni al
  proyecto. Si tienes trabajo en paralelo fuera del loop, esta garantía no lo
  cubre y no hay nada en el plugin que pueda cubrirlo.
- **`merge-after` se comprueba mirando CÓMO se cerró el issue.** Una
  dependencia cuenta como satisfecha si su issue está **cerrado como
  *completed*** — que es lo que GitHub hace al mergear un PR con `Closes #N`.
  Un PR aprobado, un PR abierto o un issue en `status:in-review` no
  desbloquean nada. Las dos trampas de esa aproximación, dichas sin adornos:
  - un issue cerrado como ***not planned*** (lo correcto para un slice
    descartado) **no** satisface la dep y deja a sus dependientes esperando
    para siempre. `/ct-next` lo nombra al explicar el bloqueo: si ves eso,
    quita el `merge-after` de la sección `## Dependencias` del dependiente, o
    reabre el issue y ciérralo como *completed* si su trabajo sí se hizo;
  - cerrar a mano como ***completed*** sin haber mergeado nada **sí**
    satisface la dep, y el dependiente saldrá sobre trabajo que no existe.
    Eso **no se detecta** — haría falta cruzar el grafo de PRs. Cierra los
    issues del loop mergeando, no a mano.
  Al diseñar la tabla: el slice del que dependen muchos es el **cuello de
  botella** del epic entero — nada detrás de él avanza hasta que ESE se
  mergee. Si quieres una ventana de paralelismo, tiene que salir de la
  columna `Dep`.
- **Una invocación despacha `--cap` slices; por defecto es 1.** Y el cap es
  **global al repo, no por invocación**: cuenta también lo que ya está en
  vuelo (`status:in-progress`), así que un segundo `/ct-next --cap 1` con algo
  corriendo no lanza nada — y lo dice. Un `status:in-review` **no** ocupa cap
  (no hay ningún agente corriendo ahí), aunque sí retenga sus tokens: son dos
  contabilidades distintas. Un slice reabierto con `--reopen` vuelve a
  `in-progress` y por tanto **sí** ocupa cap: esta vez hay alguien
  rehaciéndolo. Aprovechar una ventana de paralelismo es un acto
  explícito: `/ct-next --cap 2` (o más).
- **Las dos garantías de arriba valen para UN dispatcher a la vez.** El claim
  es un label de GitHub, sin compare-and-swap: está reproducido y verificado
  que dos `/ct-next` lanzados casi a la vez contra el mismo repo pueden
  reclamar el mismo token compartido y arrancar los dos, saltándose tanto la
  regla de colisión como el cap. No hay espera ni reintento que cierre ese
  hueco hoy. **La mitigación es operativa: no lances dos dispatchers a la vez
  sobre el mismo repo.** (Detalle y evidencia: `commands/ct-next.md`.)
- **`/ct-next` no acota por epic.** Acepta `--repo`, `--cap`, `--base` y
  `--dry-run`; **no hay `--milestone`**. Barre todos los issues abiertos del
  repo y elige por el `#` más bajo de la tabla, venga del epic que venga (ese
  `#` sí se resuelve dentro de su propio milestone para traducir `Dep`, pero
  la SELECCIÓN no se acota). Con dos epics vivos, el `#1` del segundo le gana
  al `#3` del primero — y si los dos tienen un `#1` despachable, **cuál sale
  primero no está definido**: depende del orden en que GitHub devuelva los
  issues. La palanca para decidir qué epic avanza es la que ya tienes:
  promover a `status:ready` solo los slices que quieras en vuelo.
- **Hace falta `cmux`.** Es un gestor de workspaces de terminal, externo al
  plugin: cada slice se lanza como `cmux new-workspace` (un worktree + una
  sesión de `claude`). Si `cmux` no está en el PATH, **ningún** slice puede
  lanzarse — `/ct-next` aborta en las precondiciones, antes de reclamar nada.
  `/ct-groom` y `/ct-init` no lo necesitan: es requisito solo del dispatch.
- **Interrupción y reanudación.** Un Ctrl-C (SIGINT/SIGTERM) a media corrida
  revierte a `status:ready` el claim que hubiera quedado a medias antes de
  salir. Re-invocar `/ct-next` es **idempotente** por construcción: un slice
  ya despachado está en `status:in-progress`, así que ya no es `status:ready`
  y no se vuelve a elegir (aunque sigue ocupando cap). Cada slice usa la rama
  `feat/<n>` y el worktree `.worktrees/<n>` (`<n>` = número de ISSUE, no el
  `#` de la tabla); si alguno de los dos ya existe de una corrida anterior,
  `/ct-next` se niega a despachar ese slice **antes** de reclamarlo e imprime
  el comando de limpieza exacto.
- **Un claim es un label, sin heartbeat: nada lo caduca.** Si un slice muere
  (sesión cerrada, máquina apagada, un agente que nunca ejecutó su
  `--release`), su `status:in-progress` se queda puesto y bloquea
  indefinidamente a todos los que compartan sus tokens, hasta que alguien lo
  revierta **a mano**:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` es la versión **comprobada** de la edición a mano: se niega si
  el worktree `.worktrees/<n>` o la rama `feat/<n>` siguen existiendo, porque
  entonces el trabajo de ese slice sigue vivo sin mergear y soltar sus tokens
  dejaría salir a un vecino sobre una base que no lo contiene. Si de verdad
  quieres saltarte esa comprobación (sabes que ese trabajo no importa y
  prefieres conservar el worktree), la edición cruda sigue estando y no
  comprueba nada:

  ```
  gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:in-progress
  ```

  `/ct-next` ayuda hasta donde puede: si un `status:in-progress` no tiene ni
  worktree, ni rama, ni sesión de cmux **en esta máquina**, lo dice — tanto
  si bloquea por token compartido como si solo está ocupando el `--cap`. Pero
  no puede afirmar que esté abandonado (pudo reclamarse desde otro sitio), y
  **solo se entera quien esté corriendo `/ct-next` en ese momento**: no hay
  ningún demonio vigilando claims entre invocaciones. Comprueba antes de
  romper un claim ajeno. (Esta comprobación NO se hace sobre un
  `status:in-review`: ahí no tener sesión abierta es lo normal, no una
  anomalía — lo que bloquea es el PR sin mergear, no un claim muerto.)

### Rechazar un PR en el gate, sin sacar el slice del loop

`status:in-review` **no** es un estado terminal, pero salir de él es un acto
deliberado tuyo: no hay ninguna transición automática de vuelta. El ciclo
completo de un slice, con quién mueve cada arista:

```
backlog --(tú)--> ready --(/ct-next)--> in-progress --(--release)--> in-review
                    ^                        ^                          |
                    |                        +-------(--reopen)---------+
                    +---------(--requeue)----+
```

Si rechazas el PR de un slice, devuélvelo al banco de trabajo con

```
node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --reopen
```

que lo mueve `in-review` → **`in-progress`** —el inverso exacto de
`--release`— **solo si de verdad está en `in-review`** (si no, se niega sin
tocar ninguna label). Que quede en `in-progress` y no en `ready` **no es un
detalle**: su trabajo sigue existiendo sin mergear en `feat/<n>`, así que
**sigue reteniendo sus tokens** de `Área`/`Toca` hasta el merge. Reabrir **no
desbloquea a sus vecinos** — solo dice quién lo está rehaciendo. Y ocupa una
plaza de `--cap`, porque esta vez sí hay alguien trabajándolo.

No borra nada del disco: te dice qué queda de la vuelta anterior (el worktree
`.worktrees/<n>` y la rama `feat/<n>`) y te deja elegir entre dos caminos
excluyentes:

- **corregir encima** de lo que ya hay — lo normal tras un rechazo: sigues en
  ese mismo worktree y ese mismo PR, y **no** invocas `/ct-next` para ese
  slice (se negaría, precisamente porque el worktree y la rama existen).
  Cuando vuelva a estar listo, repites el `--release`;
- **empezar de cero** — borras worktree y rama (comprueba antes que no
  pierdes trabajo sin pushear), cierras su PR, y **solo entonces** lo
  devuelves a la cola:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` mueve `in-progress` → `ready`, y es la ÚNICA transición que
  suelta tokens sin un merge, así que **comprueba antes de declararlo**: exige
  que en esta máquina no quede ni `.worktrees/<n>` ni `feat/<n>`, y se niega
  también si no ha podido mirarlo (no se declara ausente lo que no se ha
  visto). Lo que **no** puede comprobar y te dice cada vez: la rama en el
  remoto y el PR abierto. Si siguen ahí, ese trabajo sigue sin mergear y ya no
  hay nadie reteniendo su área.

`--requeue` sirve además para el otro caso de siempre: **romper un claim
muerto** (un `status:in-progress` cuyo agente ya no existe). Es la versión
comprobada del `gh issue edit` a mano que aparece más arriba.

Sin estas dos aristas, un PR rechazado dejaba su slice fuera del loop **para
siempre**, y con él todo lo que dependiera de él: `/ct-next` solo despacha
`status:ready`.
- **Cada slice en vuelo tiene SU `.agent/STATE.md`**: el de su worktree
  (`.worktrees/<n>/.agent/STATE.md`), sembrado al despachar. Dos slices a la
  vez no se pisan ese fichero, y ninguno toca el `.agent/STATE.md` del
  checkout principal.
- **Qué recibe el agente despachado**: un prompt de arranque (*kickoff*) con
  el nombre del slice, el número de issue, los criterios de la sección
  "Acceptance criteria", el addendum de su `Tipo` y el comando literal para
  liberar el claim al terminar; más el `.agent/STATE.md` sembrado y lo que el
  propio repo le dé al arrancar (`AGENTS.md`, `CLAUDE.md`, hooks). **No
  recibe el spec**: se hidrata del issue. Lo que no llegó al cuerpo del issue
  no llega al agente.

<sub>Esta sección la mantiene `/ct-init` (contrato v6). Si el plugin trae una
versión más nueva, `/ct-init` lo avisa al correr; para adoptarla:
`bash <plugin>/scripts/ct-init.sh <dir-repo> --update-slices-contract`, que
solo la reemplaza si no la has editado a mano.</sub>
<!-- /ct-init:slices-contract -->
