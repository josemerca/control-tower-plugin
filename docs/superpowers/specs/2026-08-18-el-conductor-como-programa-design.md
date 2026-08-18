# El conductor como programa — la fase de implementación conducida por código

> Experimento de la decisión **D-4** de `docs/convergencia-tres-loops.md`, hecha
> antes de tiempo y a propósito. No consume el alcance de F35-F38, que tienen
> dueño asignado. Cumple de rebote el criterio de cierre de F37 ("el PR de un
> slice trae un veredicto emitido por un agente que no ejecutó nada") por un
> mecanismo distinto al que F37 describe.

---

## 1. Qué se construye

Hoy la fase que va del plan a la pull request la conduce una **sesión de chat**:
la sesión despachada por `/ct-next` sigue `subagent-driven-development`, que en
prosa le dice que despache un subagente implementador por tarea, otro revisor
detrás, y mantenga un ledger en disco para no perder el sitio cuando la
conversación se compacte.

Esto sustituye al conductor, no a las piezas: **la secuencia la decide un
programa** y las dos llamadas al modelo —implementador y juez— pasan a ser
procesos hijos sin estado (`claude -p`). El programa no razona: aplica una tabla.

Lo que cambia, en una línea por propiedad:

| Propiedad | Hoy | Con el conductor como programa |
|---|---|---|
| Quién decide el paso siguiente | un modelo leyendo prosa | una función pura sobre el estado |
| Dónde vive el sitio en el que va | `.superpowers/sdd/<plan>/progress.md`, un ledger que el modelo escribe | el estado del run, persistido, y `git log` |
| Quién mide si la tarea está verde | el implementador se lo reporta a sí mismo | el programa ejecuta los comandos del plan |
| Qué ve el juez | un diff, y confía en el informe del implementador | un diff, la rúbrica, y **rutas** de los logs, nunca su contenido |
| Qué puede ejecutar el juez | tiene `Bash` (`code-reviewer.md:8` es un `general-purpose`) | nada: el binario no se lo da |
| Qué devuelve el juez | prosa ("give a clear verdict") | JSON validado contra un esquema |
| Presupuesto | ninguno declarado | reintentos por tarea y tope en dinero por slice |

### 1.1 Lo que NO cambia

`/ct-next` sigue abriendo **una** sesión interactiva por slice, por cmux, igual
que hoy. Esa sesión sigue escribiendo el plan con `writing-plans-prescriptive`,
sigue pasando el gate `plan` con un humano, y sigue abriendo la pull request y
llamando a `dispatch-check --release`. El programa se ocupa **sólo** del tramo
que hay entre esas dos cosas.

No se abre ninguna ventana nueva y no se lanza ninguna sesión interactiva más.
`claude -p` es un proceso hijo headless: sin terminal, sin multiplexor. `cmux`
aparece en `/ct-next` porque **teclear** en una terminal viva sólo hace falta
cuando lo que arrancas es interactivo.

---

## 2. Lo medido, no deducido

Todo lo de esta sección se comprobó en el repo o contra el binario instalado.

### 2.1 El binario permite lo que el diseño necesita

De `claude --help`:

- `-p, --print` — "Print response and exit". Es un proceso hijo, no una sesión.
- `--tools <tools...>` — "Use \"\" to disable all tools […] or specify tool names".
  **No** está en la lista de flags marcadas "only works with --print", así que
  restringir herramientas funciona también en modo interactivo.
- `--json-schema <schema>` y `--output-format <format>` — **sí** son exclusivas
  de `--print`. De aquí sale la restricción que decide el diseño: **de una
  sesión interactiva no sale valor de retorno**. Un veredicto con esquema sólo
  existe si la llamada es headless.
- `--setting-sources <sources>` — "user, project, local". Es la palanca para
  elegir qué ajustes carga la llamada.
- `--bare` — "skip hooks, LSP, plugin sync […] and CLAUDE.md auto-discovery",
  pero "Anthropic auth is strictly `ANTHROPIC_API_KEY` or apiKeyHelper". Con
  cuentas OAuth (`claude-personal`/`claude-work`) **no sirve**.

### 2.2 En `claude -p` los hooks corren, y este plugin hidrata

Que `--bare` exista para apagarlos implica que por defecto **corren**.
`hooks/hooks.json` engancha `SessionStart` con el matcher
`startup|resume|clear|compact` a `dist/session-start.js`, y ese hook, si en el
directorio existe `.agent/SLICE.md`, compone la hidratación del slice y la
inyecta como `additionalContext`.

Consecuencia: una llamada headless lanzada dentro del worktree del slice puede
nacer **hidratada como si fuera el agente del slice**. Para el implementador es
inocuo o incluso útil; para el juez es contaminación directa.

Esto está **medido a medias a propósito**: el binario dice que los hooks corren,
pero en esta máquina el plugin no está instalado (`~/.claude/plugins/installed_plugins.json`
no lo lista), así que el efecto concreto **no se ha observado**. Es la primera
tarea verificable de la implementación (§10, paso 0), no una suposición que
viaje escondida en el diseño.

### 2.3 La cuenta se hereda, no hay que elegirla

El wrapper de cuenta sólo exporta `CLAUDE_CONFIG_DIR`
(`scripts/kickoff.js:73-74`; los binarios por defecto en `kickoff.js:91-92`).
Un proceso hijo lanzado desde dentro de la sesión despachada hereda esa
variable, así que el programa invoca `claude` a secas y **no replica
`ACCOUNT_MAP`**. Exige que la variable esté definida y para si no lo está: sin
ella, la llamada iría a la cuenta equivocada.

### 2.4 El plan ya es una lista de tareas fiable, pero su vara no es ejecutable

`scripts/plan-contract.js` (438 líneas) ya garantiza lo que un programa necesita
para saber **qué tareas hay**:

- `TASK_HEADING = /^### Task (\d+) — /` y numeración **consecutiva desde 1 sin
  huecos** (comprobada en la línea 226).
- `TASK_MARKERS` obliga a las cinco líneas por tarea, incluida
  `**Verification:**`.

Lo que **no** garantiza es que esa verificación sea ejecutable. El bloque cercado
que va detrás de `**Verification:**` está sólo **exento** de las reglas de rol
(línea 303: `etiqueta.includes('**Verification:**')`), con tope de 8 líneas
(`COMMAND_BUDGET`) y prohibición de heredoc. Un plan cuya `**Verification:**`
sea prosa en línea, sin bloque, **valida hoy sin problema**. Para un programa que
va a ejecutar esos comandos, eso es el agujero.

### 2.5 Las tres trampas de parseo, medidas contra un plan real

Medidas contra el plan del slice #5 de `repo-pulse`, 8 tareas, no contra la
plantilla. Es la lección de la iteración anterior: validar un parser contra
`plan-template.md` esconde defectos que el artefacto real sí tiene.

1. **Los comandos viven en el bloque cercado inmediatamente posterior a
   `**Verification:**`, no en línea.** En línea llegan mezclados con prosa
   (`→ exit 0.`, `y después:`, paréntesis explicativos, y un `wc -l AGENTS.md`
   dentro de un paréntesis). Y tiene que ser el bloque **inmediatamente**
   posterior, no cualquier bloque en lenguaje de comandos de la tarea: las
   tareas reales llevan sus propios bloques `Contract` y `Current state`.
2. **Los nombres de test van entre comillas simples, nunca entre backticks, y
   los paréntesis explicativos hay que barrerlos POR PROFUNDIDAD.** Lo que va
   entre backticks en la línea `**Tests:**` son identificadores de código
   (`window=all`, `pulse-previous`). Y el paréntesis explicativo lleva
   paréntesis dentro: `'a zero series sits on the baseline' (polylinePoints([0, 0], 1)
   es '0.0,199.0 600.0,199.0')`. Un barrido de un nivel (`\([^()]*\)`) no lo
   casa, así que `0.0,199.0 600.0,199.0` se cuela como nombre de test, no
   aparece en ningún fichero, y **bloquea la tarea con un falso positivo**. Con
   barrido por profundidad, las 8 líneas `**Tests:**` del plan real extraen
   exactamente sus nombres y ni uno más, incluidas las dos que dicen
   `N/A — <razón>`.
3. **El marcador de retirada tiene tres formas**: `removed on purpose:` (la
   plantilla, inglesa), `retira a propósito` y `retira` a secas. Exigir la forma
   larga deja sin partir la tarea que usa la corta y mete su test retirado en la
   lista de los que deben existir: exactamente lo contrario de lo correcto.

### 2.6 Lo que el repo ya regala

- `skills/subagent-driven-development/scripts/task-brief PLAN_FILE N [OUTFILE]`
  extrae el texto de la tarea N a un fichero. Es el prompt del implementador,
  ya construido.
- `skills/subagent-driven-development/scripts/review-package BASE HEAD [OUTFILE]`
  escribe a fichero la lista de commits, el `--stat` y el `git diff -U10` del
  rango. Es el payload del juez, ya construido, y su propia documentación dice
  por qué a fichero: "the output never enters your own context".
- `scripts/closing-keywords.js` exporta `findClosingKeywords(text)`, el detector
  que usa el hook `commit-keyword-guard`.
- El idioma de ejecución de procesos del repo:
  `execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], maxBuffer, timeout, killSignal: 'SIGKILL' })`
  (`scripts/ct-status.mjs:127`).
- El idioma de inyección de dobles en los ejecutables: variables `CT_*_FIXTURE`
  que **se rechazan sin `--dry-run`** (`scripts/dispatch-check.mjs:257`).

### 2.7 Dos límites del entorno que el diseño tiene que respetar

- **El repo no tiene integración continua**: `.github/` no existe. Es la decisión
  D-6 del documento de convergencia, abierta. No hay paso `await-ci` que portar.
- **Una llamada de Bash en primer plano topa a 10 minutos.** Una slice de 8
  tareas son 16 llamadas al modelo: no cabe. De ahí que el programa se lance en
  background y sea reanudable.
- La suite tiene **un test en rojo preexistente** en `main`:
  `__tests__/ct-init.test.js:833` ("SLICES_PRISTINE_HASHES no registra hashes de
  bloques que no existieron nunca"), hash huérfano `4d6eebf4…`, introducido por
  `529d2f4`. Medido en esta rama: `1 failed | 1895 passed (1896)`, así que
  "verde" aquí significa "1 failed y ese 1 es ése".

---

## 3. La máquina de estados

Portada de `agentic-skills` (`src/slice_runner/domain/state_machine.py`),
reducida a la forma de Control Tower. De sus siete pasos sobreviven cuatro: el
paso de alineación no aplica (su equivalente es el gate `plan`, y ocurre antes de
que el programa arranque), y `await-ci` / `await-merge` tampoco (no hay
integración continua, y el merge es una decisión humana con la pull request
delante, que es donde para la sesión hoy).

### 3.1 Vocabulario

| Concepto | Valores |
|---|---|
| `STEPS` | `implement` · `controls` · `judge` · `commit` |
| `OUTCOMES` | `done` · `failed` · `indeterminate` · `corrections-ordered` · `discarded` · `over-budget` |
| `RUN_STATES` | `open` · `delivered` · `blocked-controls` · `blocked-judge` · `blocked-commit` · `aborted-budget` |

### 3.2 El agregado

```
Run {
  plan, issue, baseSha,
  task, tasksTotal, step,
  controlRetries, judgeRetries, correctionRetries,   // POR TAREA
  discards, spendUsd                                 // de la slice entera
}
```

Inmutable: cada transición devuelve una copia. Los tres contadores de reintento
**se reinician al avanzar de tarea** —cada tarea estrena su cuenta, que es el
idioma de `agentic-skills`— y los dos últimos acumulan durante toda la slice.

### 3.3 La tabla

`after(run, outcome, budgets) → { run, state }`, función pura.

| Paso | Resultado | Va a |
|---|---|---|
| `implement` | `done` | `controls` |
| `implement` | `discarded` | `implement`, `discards+1`, **no gasta reintento** |
| `controls` | `done` | `judge` |
| `controls` | `failed` | `implement` si `controlRetries < 2`; si no, cierra `blocked-controls` |
| `controls` | `indeterminate` | cierra `blocked-controls`: no se pudo **medir**, y reintentar a ciegas repite el coste |
| `judge` | `done` | `commit` |
| `judge` | `failed` | `implement` si `judgeRetries < 2`; si no, cierra `blocked-judge` |
| `judge` | `corrections-ordered` | `implement` si `correctionRetries < 2`; si no, sigue a `commit` (**no bloquea**) |
| `judge` | `discarded` | `judge`, `discards+1`, **no gasta reintento** |
| `commit` | `done` | `implement` de `task+1` con contadores a 0 si `task < tasksTotal`; si no, cierra `delivered` |
| `commit` | `failed` | cierra `blocked-commit` |
| cualquiera | `over-budget` | cierra `aborted-budget` |

Un par (paso, resultado) que esta tabla **no** describe **lanza**; no cae en una
rama genérica. Es la propiedad de `_impossible` del original, y es lo que hace
que un resultado nuevo sea un error ruidoso y no una decisión silenciosa.

`corrections-ordered` es la diferencia entre un juez que **veta** y un juez que
**refunfuña**: un PASA con hallazgos que no son de severidad baja vuelve al
implementador con presupuesto propio, y agotarlo entrega igual. Sin esa
distinción, cada refunfuño gastaría un reintento de veto.

`discarded` es el veredicto que incumple el esquema, o el informe del
implementador que no se puede leer. No gasta reintento porque **no se tocó el
código**; su único respaldo es el tope en dinero.

### 3.4 Presupuestos

`controlRetries: 2`, `judgeRetries: 2`, `correctionRetries: 2`,
`sliceCostUsd: 50` (ajustable con `--max-usd`), y un tope por llamada en
segundos. Dos llamadas al modelo por tarea significan 16 llamadas en una slice
de 8 tareas: **el tope en dinero no es opcional desde el primer día**.

---

## 4. Fronteras y flujo de dependencias

Cuatro capas con el idioma que ya usa el repo: módulo puro con entrada/salida
inyectada, como `plan-contract.js` con su `{ readFile }`.

```
scripts/ct-run.mjs        infraestructura: argv, cableado, canales, códigos de salida
  └── scripts/conduct.js  aplicación: el bucle. Recibe los puertos, no los crea
        ├── scripts/run-machine.js   dominio PURO, cero imports: la tabla del §3.3
        ├── scripts/plan-tasks.js    dominio: el plan → tareas + su vara (§2.5)
        ├── scripts/verdict.js       dominio: el esquema del veredicto y su validación
        └── scripts/harness-call.js  dominio: construye argv y prompt, NO ejecuta
```

Puertos que inyecta `ct-run.mjs` y que `conduct.js` sólo consume:
`readFile`, `writeFile`, `runCommand({ cmd, argv, cwd, timeoutMs }) → { code, stdout, stderr }`,
`now()`.

Nada por debajo de `conduct.js` importa `node:fs` ni `node:child_process`: es lo
que permite testear el bucle entero sin tocar disco ni lanzar un proceso, y es la
misma frontera que separa `plan-contract.js` de `dispatch-check.mjs`.

---

## 5. El orden por tarea, y quién comitea

Por cada tarea, en este orden:

```
git add (sólo las rutas que declara el implementador)
  → controles (los comandos del plan; los logs a DISCO)
    → juez (diff + rúbrica + RUTAS de los logs)
      → commit
```

**El implementador no comitea: comitea el programa.** Es la propiedad que hace
que un veto no deje rastro que deshacer, y aquí encaja sin fricción porque en
Control Tower una tarea ya es un commit. Se stagea **antes** de medir porque un
control que lee el índice no ve un fichero nuevo sin stagear.

El mensaje del commit lo compone el programa y lo valida con
`findClosingKeywords` (`scripts/closing-keywords.js`) **antes** de commitear.
Esto no es adorno: el hook `commit-keyword-guard` es un `PreToolUse` sobre la
herramienta `Bash` de una sesión, así que un `git commit` lanzado por el programa
**no pasa por ese hook**. Si el programa no valida su propio mensaje, la
barandilla que el repo construyó en F27 no cubre este camino.

---

## 6. Las dos llamadas al modelo

Los dos prompts son ficheros que el programa lee verbatim: `prompts/task-implementer.md`
y `prompts/task-judge.md`. La rúbrica del juez va **dentro** de su fichero y
delante del diff, como en `JudgeInvocation.text` del original.

| | Implementador | Juez |
|---|---|---|
| Herramientas | `Read,Write,Edit,Grep,Glob,Bash` | `Read,Grep,Glob` |
| Prompt | rúbrica de implementación + el fichero de `task-brief` | rúbrica de juicio + datos del run + el diff de `review-package` |
| Salida | informe con las rutas que tocó | JSON validado contra el esquema del veredicto |
| Contexto heredado | ninguno | ninguno |

Que el juez no pueda ejecutar es **estructural**: se lo quita el binario, no una
promesa en prosa. Y no ve la salida de los controles: el programa le pasa
**rutas**. Un `lint` sucio no debe gastar un intento adversarial ni ensuciarle el
criterio al único agente cuyo valor es el juicio.

No se reusa `skills/subagent-driven-development/implementer-prompt.md` a
propósito: su línea 111 dice "your report is the test evidence", que es
exactamente la propiedad que este diseño quita. No tocar ese fichero significa
además **ninguna costura nueva** en `skills/FORK.md`.

---

## 7. El estado del run, y la reanudación

Vive en `.agent/run-<issue>.json`, ignorado por git. La regla del repo es que el
estado no vive en ficheros, y esto no la contradice: lo que vive en GitHub es el
estado del **slice**, y durante todo el run el issue sigue en
`status:in-progress` sin ninguna transición que publicar. El run es el bucle
interno de una slice dentro de su worktree, y vive menos que el worktree.

Lo que se gana: reinvocar retoma en la tarea K, y **el ledger de
`subagent-driven-development` desaparece**. Ese fichero existe por una razón que
su propia documentación declara —"conversation memory does not survive
compaction […] controllers that lost their place have re-dispatched entire
completed task sequences"— y es una prótesis para la ausencia de programa.

La regla de ignore se añade en `scripts/ct-init.sh`, junto a la de
`.agent/SLICE.md` (línea 96). **No** se añade a `NEVER_IN_A_SLICE_PR`
(`scripts/state-paths.js`) por ahora: ese módulo lo importan los hooks, así que
tocarlo arrastra `npm run build` en el mismo commit, y el fichero está ignorado
por construcción y nunca lo stagea el programa (que stagea rutas nombradas).
Queda anotado como decisión a revisar si aparece un `git add -A` en el camino.

**Al reanudar, el programa no se cree el fichero a solas.** Cruza la tarea que
dice el estado con los commits que hay desde `baseSha`: si discrepan, para y lo
dice. No adivina, porque adivinar aquí significa reimplementar encima de una
tarea ya comiteada.

---

## 8. Cómo se lanza, y cómo se ve

La sesión del slice, tras cerrar el gate `plan`, lanza el programa **una vez, en
background**, y sigue siendo la misma sesión de siempre: no se abre ninguna
ventana ni ninguna sesión nueva.

Mientras corre, el progreso se ve en un log en disco —una línea por turno, con la
herramienta y la ruta que tocó, que es lo que hace `StderrTurnLog` en el
original— así que `tail -f` desde cualquier terminal cuenta lo que está pasando.
La sesión, al terminar el programa, lee **el código de salida y las rutas**, no
los contenidos.

Y para saber qué hizo una llamada concreta: cada `claude -p` deja su conversación
en `~/.claude/projects/`, identificada por su sesión. Si el programa apunta ese
identificador junto al paso y la tarea, se puede abrir *la conversación del juez
de la tarea 5* — que hoy, con una sesión de chat, exige rebobinar una
conversación entera.

---

## 9. Códigos de salida

Uno por decisión, no uno por excepción: cada fila dice si reinvocar sirve. Sigue
la gramática del repo (stdout es el producto, stderr el diagnóstico) y reusa el
significado del `6` que ya tiene `dispatch-check`.

| | Significado | ¿Reinvocar sirve? |
|---|---|---|
| `0` | todas las tareas comiteadas con veredicto PASA; la rama está lista para la pull request | no hace falta |
| `1` | el juez veta y se agotaron los reintentos; el trabajo hasta la tarea K-1 está comiteado | no, hay que mirar el veredicto |
| `2` | error de uso | no |
| `3` | no hay veredicto de fiar: el juez incumplió el esquema tras los descartes, o `claude` no se pudo lanzar | sí, si lo de abajo se arregló |
| `4` | los controles siguen en rojo tras agotar los reintentos | no, hay que mirar los logs |
| `5` | los controles no se pudieron **medir** (comando inexistente, tope de tiempo) | no, hay que mirar qué se colgó |
| `6` | el plan no es ejecutable: falta el bloque de comandos de `**Verification:**`, o no se pueden extraer los nombres de test | no, hay que arreglar el plan |
| `7` | tope de dinero agotado con el run abierto | sí, subiendo el tope a conciencia |
| `8` | precondiciones: no es un worktree de slice, índice sucio, falta `claude`, falta `CLAUDE_CONFIG_DIR` | sí, arreglado el entorno |
| `10` | excepción que el programa no sabe nombrar | el estado persistido sigue siendo bueno |

`1` es un veredicto y `3` no lo es: esa es la distinción que un booleano
perdería.

---

## 10. Lo que hace falta construir

### Paso 0 — medir el hook (una tarde, sin escribir producto)

Comprobar en una máquina con el plugin instalado si `claude -p` lanzado dentro
del worktree de un slice recibe la hidratación de `SessionStart`, y con qué
`--setting-sources` deja de recibirla sin romper la autenticación OAuth. El
resultado se anota en el spec antes de escribir `harness-call.js`, porque decide
su argv. Si resultara que no hay palanca, el juez tendría que correr con el
directorio de trabajo fuera del worktree, y eso sí es un cambio de diseño.

### Paso 1 — hacer los planes ejecutables (no necesita máquina de estados)

- `scripts/plan-contract.js`: regla nueva, cada tarea exige el bloque de
  comandos detrás de `**Verification:**`. El código de salida 6 de
  `--check-plan` ya existe y ya significa esto.
- `scripts/plan-tasks.js`: el extractor de la vara por tarea —comandos, tests
  añadidos, tests retirados— con las tres trampas del §2.5 cubiertas. Copia el
  parser de bloques cercados de `plan-contract.js` (`annotate()`), que es el
  idioma del repo para esto.

Vale aunque el conductor no llegue nunca: `--check-plan` deja de aceptar planes
que ningún programa puede ejecutar.

### Paso 2 — el conductor

- `scripts/run-machine.js` — la tabla del §3.3, pura.
- `scripts/verdict.js` — esquema del veredicto y su validación.
- `scripts/harness-call.js` — argv y prompt de las dos llamadas.
- `scripts/conduct.js` — el bucle, con los puertos inyectados.
- `scripts/ct-run.mjs` — el ejecutable: argv, canales, tabla de salida.
- `prompts/task-implementer.md` y `prompts/task-judge.md`.
- `scripts/ct-init.sh` — la regla de ignore de `.agent/run-*.json`.

---

## 11. Tests que fijan las propiedades

Con los idiomas que ya usa el repo: `vitest`, un fichero por concepto,
fixtures herméticas (`__tests__/fixtures/hermetic-env.js`), y `const F = '```'`
construido en tiempo de ejecución para que ninguna línea del test empiece por un
cercado real.

| Test | Propiedad que fija |
|---|---|
| `__tests__/run-machine.test.js` | **tabla exhaustiva** de pares (paso, resultado), incluidos los imposibles: cada uno lanza. Y que los contadores por tarea se reinician al avanzar y los de slice no |
| `__tests__/plan-tasks.test.js` | las tres trampas, **contra un plan real como fixture**, no contra la plantilla. Un caso por trampa, y el caso del paréntesis anidado falla hoy sin el barrido por profundidad |
| `__tests__/plan-contract.test.js` | la regla nueva: una tarea con `**Verification:**` sin bloque de comandos deja de validar |
| `__tests__/ct-run-dryrun.test.js` | el ejecutable con `--dry-run` y arnés falso por `CT_RUN_HARNESS_FIXTURE`, y que la fixture **sin** `--dry-run` se rechaza |
| `__tests__/ct-run-exit-code-contract.test.js` | cada código de la tabla del §9 lo emite exactamente un camino, y stdout/stderr no se mezclan |
| `__tests__/ct-run-commit-message.test.js` | el mensaje que compone el programa nunca contiene una closing keyword |

---

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| El juez nace hidratado por `SessionStart` y deja de ser independiente | Paso 0: medirlo antes de escribir el argv. `--bare` no es la palanca (exige clave de API) |
| Coste: 16 llamadas al modelo en una slice de 8 tareas | Tope en dinero desde el primer día, con corte duro y código de salida propio |
| El programa comitea, y el hook de closing keywords no cubre ese camino | El programa valida su mensaje con el mismo módulo que el hook |
| Dos runs a la vez en el mismo worktree | El fichero de estado se abre en exclusiva; un segundo run sale por `8` |
| El plan declara comandos que no existen en la máquina | Resultado `indeterminate`, cierre por `5`, sin reintentar a ciegas |
| Muerte del programa entre el commit y la persistencia | Al reanudar se cruza el estado con `git log` y, si discrepan, para |
| Absorber demasiado y romper la premisa del plugin (§7 del documento de convergencia) | Cero dependencias nuevas, cero runtime nuevo: Node 24 y `claude`, que ya son requisitos |

---

## 13. Lo que esto NO hace

- **No sustituye a `subagent-driven-development`.** Convive: `ct-run` es una
  herramienta que la sesión despachada puede invocar. `scripts/kickoff.js` no se
  toca, así que el camino por defecto sigue siendo el de hoy y no hay nada que
  revertir si el experimento falla. Cambiarlo, cuando haya datos, es un commit
  de una línea (`kickoff.js:256`).
- **No toca el fork.** Ninguna costura nueva en `skills/FORK.md`.
- **No reescribe nada en Python**, ni mueve nada de `agentic-skills` aquí. Lo que
  se porta es la **forma** y las decisiones, no el código: la máquina resultante
  son unas 200 líneas de lógica pura, porque de los siete pasos del original aquí
  sobreviven cuatro.
- **No consume el alcance de F35-F38.** Cumple el criterio de cierre de F37 por
  otro mecanismo, y toma prestado de F38 el tope en dinero por necesidad, no por
  alcance.
- **No abre ventanas de cmux ni sesiones interactivas nuevas.**
- **No añade integración continua** (D-6 sigue abierta) ni toca `dist/`.

---

## 14. Versión

El spec no sube versión. La implementación del paso 1 sube la minor a `0.35.0`
en `package.json` y `.claude-plugin/plugin.json`, que es lo que hace cada ronda.
