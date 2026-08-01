# El `.agent/STATE.md` del slice deja de ser producto

**Fecha:** 2026-08-01 · **Plugin:** `control-tower-loop`, desde 0.21.0
**Origen:** §1.1 y §1.2 de `menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md` (9 slices, dos milestones)

## 1. Qué se arregla

Dos defectos que el campo reportó por separado y que son **una sola decisión**:

- **§1.1 — el `.agent/STATE.md` del slice contamina `main`.** El dispatcher siembra el estado del slice sobre un fichero **trackeado**, el mismo que usa la sesión coordinadora. Si el agente lo commitea, el PR lo arrastra y el squash deja `main` con el estado de un slice. Pasó **tres veces** en el periodo; una (`#482`) llegó a `main` y hubo que arreglarlo a posteriori.
- **§1.2 — ese mismo fichero es una foto falsa durante toda la ejecución.** Medido: 21 horas y 7 commits con la semilla intacta (`status: not_started`).

**Van juntos porque arreglar el §1.2 empeora el §1.1.** Un agente obligado a refrescar su estado en cada turno es un agente con muchas más papeletas de commitearlo. Por separado, cada arreglo deja el sistema peor de lo que lo encuentra.

## 2. Diagnósticos corregidos

El documento de campo está escrito desde el lado del consumidor y dos de sus lecturas no resisten el contraste con el código. Se dejan escritas porque explican por qué el diseño es el que es.

### 2.1 La causa del §1.2 no es el kickoff

El doc lo atribuye a que *«el kickoff le pide actualizarlo al acabar, no durante»*. No es eso: **el plugin ya tiene un mecanismo que lo fuerza en cada turno** — el hook `Stop` bloquea el cierre cuando `last_commit` se queda por detrás de `HEAD` — y lleva desarmado toda la vida de cada slice por **una línea de la semilla**: `last_commit: ''` (`kickoff.js:290`).

`describeStopRelation` devuelve `kind: 'unset'` con el campo vacío (`state.js:466`) y `classifyStopState` sale en silencio con `unset` (`state.js:533`). Reproducido contra el `dist/stop.js` real, en un repo con 7 commits de trabajo sobre la semilla:

| Semilla | Salida del hook |
|---|---|
| `last_commit: ''` (lo que se siembra hoy) | nada, exit 0 |
| `last_commit: <sha de la base>` | `decision: block` — «hay 7 commits de trabajo… actualiza STATE.md» |

Siete: el mismo número que el `#452` midió en campo.

### 2.2 `.git/info/exclude` no sirve para el fichero trackeado, y sí para el nuevo

El doc propone añadir el path al `info/exclude` del worktree. Falso por dos razones, las dos medidas:

- **Ninguna regla de ignore afecta a un fichero ya trackeado.** Con la regla puesta, `git status` sigue diciendo `M .agent/STATE.md`.
- **`info/exclude` no es del worktree.** `git rev-parse --git-common-dir` desde un worktree enlazado devuelve el `.git` del checkout principal: esa escritura va al repo de la coordinadora.

La primera razón desaparece para un fichero **nuevo y nunca trackeado**, y entonces la segunda se invierte y pasa a ser la virtud: **una sola escritura cubre a la coordinadora y a todos los worktrees, presentes y futuros**, sin commitear nada. Es lo que usa el punto 4.2.

## 3. Lo que se descartó, con la evidencia que lo descartó

**`git update-index --skip-worktree` sobre `.agent/STATE.md`.** Funciona en aislado (verificado: el índice es propio de cada worktree, `git add -A` no lo mete, el checkout principal no se contagia) y era la opción recomendada hasta medir el campo. **Los datos la tumban:**

- **4 de los 9 slices trajeron `main` a su worktree con un merge** — `#452`, `#455`, `#456`, `#480`.
- `.agent/STATE.md` es un imán de conflictos en ese repo: **44 de 1074 commits** de `main` en 90 días lo tocan, y esas ramas iban entre 10 y 55 commits por detrás.
- El `#480` tuvo el conflicto real. Su mensaje de merge (`3a919a22`) lo dice: *«El único conflicto era `.agent/STATE.md`. Ese fichero es de la sesión coordinadora, no del slice… Resuelto tomando la versión de main»*.

Con `skip-worktree` puesto, ese merge **no se resuelve: aborta**, con el mensaje más engañoso de git — *«your local changes would be overwritten»*, donde el «local change» no es trabajo del agente sino la semilla del dispatcher. Es el modo de fallo que el centinela de arranque ya combatió una vez: el rastro de la herramienta tomado por prueba del efecto.

Sacar el fichero del árbol trackeado no resuelve mejor ese conflicto: **lo elimina**. Verificado — con el estado del slice fuera, el merge de `main` que rompió el `#480` entra limpio.

## 4. Diseño

### 4.1 El principio

**El estado del slice es estado vivo y local; nunca es producto.** Si no es producto, no se trackea; si no se trackea, no contamina, no conflictúa, y no hay nada que vigilar en el diff.

### 4.2 Dos ficheros

En el worktree de un slice conviven:

| Fichero | Qué es | Estado en git |
|---|---|---|
| `.agent/STATE.md` | el de la coordinadora, tal como venía en la base | trackeado, **a cero diff — el seed deja de tocarlo** |
| `.agent/slice.md` | el estado del slice | ignorado, nunca commiteable |

Que el `STATE.md` del worktree quede a cero diff es lo que hace que el merge del `#480` entre limpio y lo que deja a la puerta del `--release` sin nada que cazar en el caso normal.

Tres escrituras garantizan el «ignorado», con papeles distintos. **El orden importa**: la regla del `info/exclude` se escribe *antes* de sembrar, y la verificación de efecto va *después* de sembrar.

1. **`ct-init` añade `.agent/slice.md` al `.gitignore`** del repo. Commiteado, compartido con quien clone, auto-documentado. La vía correcta a largo plazo. Idempotente, con el mismo idiom de salto de línea final que el bloque de `.worktrees/` (`ct-init.sh:54-80`).
2. **`ct-next` escribe la misma regla en `$(git rev-parse --git-common-dir)/info/exclude`**, idempotente, en cada dispatch. Cubre los repos ya inicializados sin re-correr `ct-init` ni exigir un commit, y no depende de que la línea del `.gitignore` haya llegado a la base desde la que se corta el worktree.
3. **`ct-next` verifica el EFECTO, no el exit code.** Tras sembrar: `git status --porcelain` en el worktree. Si `.agent/slice.md` asoma, se aborta el dispatch por `cleanupOrphanedWorktree` (revierte el claim, limpia rama y directorio).

El punto 3 es la regla del §7.1 del feedback aplicada al propio plugin: *una comprobación que sólo imprime no es una comprobación*. Sin él, 1 y 2 son dos escrituras que **creemos** que funcionan. Con él, el plugin no despacha jamás un slice que no pueda garantizar que no contamina.

**Se descarta negarse a despachar hasta que se re-corra `ct-init`**: es fricción que no compra nada que la verificación de efecto no compre ya, y dejaría parados los repos ya inicializados.

### 4.3 Precedencia de lectura

> **Si existe `.agent/slice.md`, ése es el estado. Si no, `.agent/STATE.md`.**

La presencia del fichero **es** la señal de «estoy en un worktree de slice». No hace falta variable de entorno, ni detectar si el `cwd` cuelga de `.worktrees/`, ni preguntarle a git si esto es un worktree enlazado. Un worktree de slice siempre tiene `slice.md` porque lo siembra el dispatcher; el checkout de la coordinadora no lo tiene nunca.

| Lector | Hoy | Después |
|---|---|---|
| `hooks/session-start.js:10` | `join(cwd,'.agent','STATE.md')` | precedencia |
| `hooks/stop.js` | ídem | precedencia |
| `ct-next.mjs:1938` (lectura de `blocked`) | `.worktrees/<n>/.agent/STATE.md` | `.worktrees/<n>/.agent/slice.md`, **sin fallback** |

**La precedencia es carga estructural, no comodidad.** Sin ella, un agente que se re-hidrata tras un `/clear` leería el `STATE.md` trackeado del worktree — que ya no es su semilla sino **el estado de la coordinadora congelado en la base**: el epic, no el slice. Se hidrataría creyendo que es la coordinadora. Es el §1.1 con el vector invertido.

En `ct-next.mjs:1938` **no hay fallback**, a propósito: si un worktree no tiene `slice.md`, fue sembrado por una versión anterior, y leerle el `STATE.md` sería leer el `blocked:` de la coordinadora y reportar como bloqueado un slice que no lo está. Se avisa en vez de adivinar, con el mismo criterio que ese bloque ya aplica cuando no puede leer el fichero (*«NO se ha comprobado si ese agente se declaró BLOQUEADO. No lo leas como "no lo está"»*).

### 4.4 `last_commit` sembrado

`buildStateSeed` (`kickoff.js:290`) siembra `last_commit` con el **sha resuelto** de la base:

```
last_commit: <git rev-parse <resolvedBase>^{commit}>
```

La resolución ocurre en `ct-next`, donde ya verifica que la base existe localmente (`verifyBaseExistsLocally`, `ct-next.mjs:1605`), y viaja a `buildStateSeed` junto a `branch` y `base`.

**Tiene que ser un sha, no el nombre.** `resolvedBase` es un nombre de referencia (`ct-next.mjs:1589-1602` le asignan `baseArg` o `'main'`); sembrar eso sería sembrar un blanco móvil, y el conteo de «commits por encima de tu `last_commit`» dejaría de significar nada en cuanto `main` avanzara. Un sha de 40 caracteres pasa `REV_SHAPE` (`state.js:343`) sin cambios.

**Efecto:** el primer commit de trabajo deja el estado *behind* y el hook `Stop` bloquea el cierre del turno hasta que el agente lo actualice. La foto falsa desaparece porque el fichero se refresca en cada turno.

**La exención de bookkeeping se vuelve inerte, y está bien.** Existe (`state.js:418`) porque el commit que actualizaba `STATE.md` te dejaba otra vez atrás. En el worktree del slice ya no hay tal commit — `slice.md` no se commitea nunca —, así que todos los commits cuentan como trabajo y el agente cierra el ciclo escribiendo el sha en un fichero que no mueve `HEAD`: la relación queda en `same` y el hook calla.

### 4.5 La puerta del `--release`

En `dispatch-check.mjs`, dentro del `if (release)` (línea 331) y **antes** de mover la label:

- `git diff --name-only <base>...HEAD` en el `cwd` — forma de tres puntos: lo que la rama **introduce** respecto a su base común.
- Si aparece `.agent/STATE.md` o `.agent/slice.md` → **se niega**: exit 5, la label **no** se mueve (el slice sigue en `in-progress`), y el mensaje da el remedio exacto: restaurar el fichero desde la base y commitear. Es lo que se hizo a mano en el `#452` y el `#485`.
- La base sale del campo `base` de `.agent/slice.md`; si falta, `merge-base` contra la rama por defecto.
- **Solo esos dos paths**, no `.agent/` entero: `conventions-ack.md` vive ahí y puede cambiar legítimamente.

**Código de salida propio: 5.** `ct-next` desambigua por código, nunca parseando texto (`dispatch-check.mjs:50-75`). Verificado que del 0 al 4 están asignados y que el 5 está libre. El 5 sólo lo ve el agente: `classifyClaimOutcome` (`ct-next.mjs:2805-2807`) interpreta 1/3/4 y nunca recibe este código, porque `ct-next` no invoca `--release` — lo invoca el agente al entregar.

**Límite, dicho:** `--release` lo invoca el agente porque el kickoff se lo pide, y el kickoff es un prompt, no un gate. Un agente que no lo llame se salta la puerta — pero entonces su issue se queda en `in-progress`, que es visible. La puerta no es hermética; mueve el caso normal de la retina del humano al loop.

### 4.6 Worktrees vivos del esquema anterior

**No se migra nada y no se toca ningún worktree ajeno** — mutar el árbol de un agente vivo por la espalda es peor que el problema, mismo criterio que «avisa, nunca revierte el claim solo». Cada lector se comporta bien por separado:

| | Worktree del esquema viejo (sin `slice.md`) |
|---|---|
| Hooks | caen a `STATE.md` por la precedencia → leen la semilla vieja, que es lo correcto ahí |
| `ct-next:1938` | avisa de que no ha comprobado el bloqueo; no adivina |
| Puerta `--release` | ve el `STATE.md` modificado y se niega — exactamente lo que queremos con esos |

## 5. Tests

Nuevo `__tests__/f22-*.test.js` siguiendo la convención f15…f21, más extensiones a `stop.test.js`, `session-start.test.js`, `kickoff.test.js` y los de `dispatch-check`.

1. El seed **no toca** `.agent/STATE.md` del worktree: diff a cero contra la base.
2. `.agent/slice.md` no aparece en `git status --porcelain`, ni antes ni después de `git add -A`.
3. La escritura en `info/exclude` es idempotente entre dispatches (no duplica la línea).
4. Si la verificación de efecto falla, se aborta **y se revierte el claim**.
5. Precedencia en los dos hooks, en los dos sentidos (con y sin `slice.md`).
6. `ct-next:1938` sin `slice.md`: avisa y **no** lee `STATE.md`.
7. `last_commit` sembrado → tras un commit de trabajo, el `Stop` bloquea. Es el repro del §2.1 convertido en test.
8. Puerta del `--release`: con contaminación → exit 5 y label sin mover; sin ella → exit 0.

## 6. Qué NO entra

- **Nada del §5 del feedback.** Todo aquello se estrenó o se arregló durante el periodo y funcionó con evidencia.
- **§3.3** (motivo del bloqueo por `stdout`): ya está documentado en `commands/ct-next.md` §«Dónde cae la frontera», escrito en F18, con `f17-cierre-del-issue.test.js` fijando el criterio. No es deuda.
- **§2** (`ct-order` sin acotar por milestone), **§3.1/§3.2** (señal de muerte y `--status`) y **§4** (contexto heredado): bloques posteriores, cada uno con su propio spec.
