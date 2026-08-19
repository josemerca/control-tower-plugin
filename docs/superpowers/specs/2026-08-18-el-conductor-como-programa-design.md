# El conductor como programa — la fase de implementación conducida por código

> Experimento de la decisión **D-4** de `docs/convergencia-tres-loops.md`, hecha
> antes de tiempo y a propósito. No consume el alcance de F35-F38, que tienen
> dueño asignado. Cumple de rebote el criterio de cierre de F37 ("el PR de un
> slice trae un veredicto emitido por un agente que no ejecutó nada") por un
> mecanismo distinto al que F37 describe.

> ## Nota de implementación (18 ago 2026) — **la variante sin programa**
>
> Lo construido **no** es un programa conductor: es `scripts/ct-step.mjs`, la
> misma máquina de estados **como oráculo que la sesión consulta**. La sesión
> despachada sigue conduciendo, sigue despachando subagentes y sigue abriendo la
> pull request; lo que deja de hacer es **decidir la secuencia**.
>
> El motivo es D-4. Este spec la declaraba "hecha antes de tiempo y a propósito",
> y en el documento de convergencia D-4 está **aplazada, con dueño José y con un
> cuándo** ("se revisa al cerrar F38"). Sustituir la sesión por un programa ES la
> decisión, no un detalle de implementación, así que se coge todo lo que se puede
> coger sin tomarla:
>
> | Propiedad | ¿Sobrevive sin programa conductor? |
> |---|---|
> | La secuencia la decide una tabla, no prosa | **Sí** — y cada verbo rechaza lo que no sea el paso que toca (código `9`) |
> | El sitio en el que va, en disco y no en la conversación | **Sí** — `.agent/run-<issue>.json`, y el ledger de SDD deja de hacer falta |
> | La tarea la mide el programa, no el implementador | **Sí** — `ct-step controls` |
> | Comitea el programa, no el implementador | **Sí** — `ct-step commit`, con la guarda de closing keywords |
> | El juez no puede ejecutar | **Sí** — `agents/ct-judge.md`, declarado sin `Bash` |
> | El veredicto validado contra un esquema | **A medias** — lo impone `ct-step verdict` al leerlo, no el binario: `--json-schema` sólo existe en modo `--print` |
> | Presupuesto en dinero y gasto por papel | **No** — `total_cost_usd` sólo lo devuelve una llamada headless. De rebote, deja de tocar el alcance de F38 |
>
> Un test lo sostenía: `__tests__/d4-sigue-siendo-de-jose.test.js` comprobaba
> que nada del camino por defecto —ni los slash commands, ni el kickoff, ni las
> skills, ni los hooks, ni el dispatcher— invocaba `ct-step`. El día que D-4 se
> aprobara, ese test se borraría en el mismo commit que lo enchufara.
>
> **Ese commit existe: `3071d8a` (2026-08-19, este fork).** El kickoff de
> /ct-next manda conducir con ct-step, el guardián se borró ahí mismo, y
> `dispatch-check --release` exige desde `0.36.1` un run entregado (exit 7).
> En upstream la decisión sigue teniendo dueño y fecha.
>
> Lo que sigue describe el diseño original (el conductor como programa). Se deja
> tal cual porque es lo que hay que leer el día que D-4 se decida; las secciones
> que la implementación cambió lo dicen en su sitio.

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
| Medida | ninguna | una fila por intento de un paso de una tarea (§10) |

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
- `--strict-mcp-config` — "Only use MCP servers from `--mcp-config`, ignoring
  all other MCP configurations". Sin alcance funcional aparente para este
  diseño, y sin embargo la flag que más dinero decide: ver §2.8.

Tres cosas más, medidas ejecutando el binario y no leyendo su ayuda:

- **`--json-schema` toma el JSON literal, no una ruta.** Pasarle un fichero
  falla con `--json-schema is not valid JSON`. El programa lee el esquema y lo
  pasa como argumento.
- **`--output-format json` ya trae hecho medio diseño.** La envoltura incluye
  `structured_output` (el veredicto ya parseado, sin tocar `result`),
  `total_cost_usd` (el tope en dinero del §3.4 lo mide el propio binario),
  `session_id` (la conversación de esa llamada, §8), `permission_denials`,
  `num_turns` e `is_error`.
- **Hay que cerrarle el stdin.** Sin `< /dev/null` el binario espera 3 segundos
  a que le llegue algo por la entrada estándar y lo avisa por stderr. El
  programa lanza con el stdin cerrado, o le pasa el prompt por ahí.

### 2.2 En `claude -p` los hooks corren, y este plugin hidrata

Que `--bare` exista para apagarlos implica que por defecto **corren**.
`hooks/hooks.json` engancha `SessionStart` con el matcher
`startup|resume|clear|compact` a `dist/session-start.js`, y ese hook, si en el
directorio existe `.agent/SLICE.md`, compone la hidratación del slice y la
inyecta como `additionalContext`.

Consecuencia: una llamada headless lanzada dentro del worktree del slice puede
nacer **hidratada como si fuera el agente del slice**. Para el implementador es
inocuo o incluso útil; para el juez es contaminación directa.

**Medido el 2026-08-18** en una máquina que sí tiene el plugin instalado
(`control-tower-loop@control-tower` 0.34.0, `claude` 2.1.234), con un worktree
de mentira que sólo tenía `.agent/SLICE.md` y una palabra clave dentro. La
llamada se hizo con `--tools ""` a propósito: sin herramientas el modelo no
puede leer el fichero, así que si repite la palabra clave es porque venía en su
contexto y no porque la haya ido a buscar.

| Llamada | ¿Repite la palabra clave? |
|---|---|
| `claude -p --tools ""` | **sí** — nace hidratado |
| `claude -p --tools "" --setting-sources project,local` | no |
| `claude -p --tools "" --setting-sources project` | no |
| `claude -p --tools "" --setting-sources ""` | no |

La hidratación es real y **la palanca es `--setting-sources` sin `user`**: este
plugin se habilita en `~/.claude/settings.json`, que es la fuente `user`, así
que quitarla apaga sus hooks. Las cuatro llamadas devolvieron respuesta y
salieron por `0`, o sea que **la autenticación OAuth sobrevive**, que es
justo lo que `--bare` no permitía (§2.1).

Medido también lo que el juez necesita poder hacer sin esa fuente:
`claude -p --setting-sources "" --tools "Read,Grep,Glob"` **leyó el fichero sin
un solo `permission_denials`**. Apagar los ajustes de usuario no le quita al
juez la lectura, que es su única herramienta de trabajo.

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

1. **Los comandos TIENEN QUE vivir en el bloque cercado posterior a
   `**Verification:**`, y en el plan real no vivían ahí.** Corregido al
   implementar: de las ocho tareas del plan real, **sólo la primera** trae
   bloque; las otras siete verifican en línea. Este spec decía lo contrario, y
   el plan real no está mal escrito — es fiel a `plan-template.md`, que pedía
   "{{exact command and expected output}}" sin decir dónde. El agujero era de la
   plantilla, así que la regla del contrato y la plantilla cambiaron juntas.
   En línea los comandos llegan mezclados con prosa
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

### 2.8 La flag que decide el presupuesto: `--strict-mcp-config`

Medido el 2026-08-18 con la **misma** llamada dos veces —juez de mentira,
`--model haiku`, `--tools ""`, `--output-format json` y el esquema del
veredicto— cambiando una sola flag:

| Llamada | `cache_creation` | `cache_read` | `total_cost_usd` |
|---|---|---|---|
| sin `--strict-mcp-config` | 256.356 | 328.670 | **0,5552** |
| con `--strict-mcp-config` | 1.418 | 31.090 | **0,0145** |

**38 veces más cara** por no ponerla. La causa es que una llamada headless carga
por defecto todos los servidores MCP configurados en la máquina, y las
definiciones de sus herramientas entran en el contexto **aunque la llamada vaya
con `--tools ""`**: `--tools` decide qué puede usar el modelo, no qué se le
manda. En una máquina con los conectores típicos enchufados eso son ~585.000
tokens de contexto en cada llamada, pagados 16 veces por una slice de 8 tareas.

Las dos llamadas van con `--strict-mcp-config` y sin `--mcp-config`, o sea, con
cero servidores MCP. Ninguna de las dos los necesita: el implementador trabaja
con las herramientas locales del binario y el juez sólo lee.

Y el coste de la máquina deja de ser una estimación del programa: `total_cost_usd`
lo devuelve cada llamada, y el tope se acumula sumando lo que dice el binario.

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

El gasto no se estima: cada llamada devuelve `total_cost_usd` en la envoltura de
`--output-format json` (§2.1) y el run acumula esa cifra. El tope se comprueba
**antes** de lanzar la llamada siguiente, no después de gastarla.

Y el orden de magnitud de ese tope depende de una flag, no del modelo: con
`--strict-mcp-config` la misma slice cuesta 38 veces menos (§2.8). Un `--max-usd`
de 50 con la flag puesta es holgado; sin ella, se agota antes de la mitad de las
tareas y el run muere por `7` sin que nada esté roto.

---

## 4. Fronteras y flujo de dependencias

Cuatro capas con el idioma que ya usa el repo: módulo puro con entrada/salida
inyectada, como `plan-contract.js` con su `{ readFile }`.

```
scripts/ct-step.mjs          el CLI de cinco verbos: argv, precondiciones, I/O
  ├── scripts/run-machine.js     PURO, cero imports: la tabla del §3.3
  ├── scripts/plan-tasks.js      PURO: el plan → tareas + su vara (§2.5)
  ├── scripts/step-contracts.js  PURO: qué se acepta de cada subagente, y el
  │                              mensaje de commit con su guarda
  └── scripts/run-metrics.js     PURO: compone la fila de telemetría (§10)

agents/ct-judge.md             el juez, declarado SIN Bash
prompts/task-implementer.md    la rúbrica del implementador
```

**Cinco ficheros y no siete, y ninguno conduce.** El diseño original separaba
`verdict.js` de `harness-call.js` y `conduct.js` de `ct-run.mjs`, con puertos
inyectados para poder testear el bucle sin tocar disco. No hay bucle que testear:
`ct-step` es un CLI que aplica una transición y termina, y eso se prueba
invocándolo. El esquema del veredicto vive con lo que lo valida, y el argv de
`claude -p` desapareció con el conductor.

`run-metrics.js` sí se quedó aparte, y por la razón que decía el diseño: la
telemetría es append-only sobre ficheros de fuera del repo y **un fallo suyo no
cambia lo que hace el paso** (§10.5). Ese tratamiento de errores no es el de
escribir el estado, y mezclarlos sería exactamente cómo una medida acaba tumbando
aquello que mide. En vez de un puerto `appendLine` inyectado, la escritura es una
función que traga su excepción y avisa una vez.

Y el doble no cubre a git. `__tests__/ct-step.test.js` monta un repo temporal y
no simula nada más: el informe y el veredicto **son ficheros JSON**, o sea
exactamente lo que escribirá un subagente. git corre de verdad, porque la mitad
de las propiedades que este diseño existe para sostener (que comitea el programa,
que se stagea antes de medir, que un veto no deja rastro) no existen si git es un
doble.

Lo que sí se mantuvo entero: `run-machine.js` y `plan-tasks.js` son puros sin un
solo import, que es la frontera que separa `plan-contract.js` de
`dispatch-check.mjs`.

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

Y por eso el paquete de revisión **no** lo compone
`skills/subagent-driven-development/scripts/review-package`, aunque el §2.6 lo
diera por reutilizable: aquel script diffea un rango de **commits**, y en este
diseño lo que hay que juzgar todavía no es un commit — está en el índice. El
programa compone su propio paquete con `git diff --cached`. El script de la
skill se queda donde está, sin tocar.

El mensaje del commit lo compone el programa y lo valida con
`findClosingKeywords` (`scripts/closing-keywords.js`) **antes** de commitear.
Esto no es adorno: el hook `commit-keyword-guard` es un `PreToolUse` sobre la
herramienta `Bash` de una sesión, así que un `git commit` lanzado por el programa
**no pasa por ese hook**. Si el programa no valida su propio mensaje, la
barandilla que el repo construyó en F27 no cubre este camino.

---

## 6. Los dos subagentes

> **Cambiado en la implementación.** No son dos llamadas headless: son dos
> subagentes que despacha la sesión.

| | Implementador | Juez |
|---|---|---|
| Quién es | un subagente de propósito general | `ct-judge` (`agents/ct-judge.md`) |
| Herramientas | `Read, Write, Edit, Grep, Glob, Bash` | `Read, Grep, Glob` — **declaradas ahí, sin `Bash`** |
| Qué recibe | la rúbrica de `prompts/task-implementer.md` y el brief de `task-brief` | su propia rúbrica, el paquete de revisión del índice, el brief y las RUTAS de los logs |
| Qué escribe | `{paths, summary}` en el JSON que le dice `ct-step next` | `{ruling, findings}` en el JSON que le dice `ct-step next` |
| Quién lo valida | `ct-step report` — una ruta absoluta o con `..` descarta el informe entero | `ct-step verdict` — lo que no cumple el esquema es un descarte |

Que el juez no pueda ejecutar sigue siendo **estructural**: se lo quita la
declaración del agente, no una frase dentro del prompt. Antes se lo quitaba el
binario con `--tools`; el sitio cambia, la propiedad no. Y sigue sin ver la
salida de los controles: se le pasan rutas, porque un `lint` sucio no debe gastar
un intento adversarial ni ensuciarle el criterio al único agente cuyo valor es el
juicio.

Lo que sí cambia de verdad: **el esquema ya no lo impone la herramienta.**
`--json-schema` sólo existe en modo `--print` (§2.1), así que un subagente puede
contestar cualquier cosa y es `ct-step` quien la rechaza al leerla. El efecto
sobre la máquina es el mismo —un veredicto ilegible es `discarded` y se vuelve a
preguntar— pero el modelo no está obligado de antemano.

No se reusa `skills/subagent-driven-development/implementer-prompt.md` a
propósito: su línea 111 dice "your report is the test evidence", que es
exactamente la propiedad que este diseño quita. No tocar ese fichero significa
además **ninguna costura nueva** en `skills/FORK.md`. Y `code-reviewer.md`
tampoco se toca: despacha un `general-purpose` con `Bash`, que es justo lo que
`ct-judge` existe para no ser.

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

No confundir este fichero con la telemetría: el estado del run es **mutable, uno
por issue y dentro del worktree**, porque su único trabajo es que reinvocar
retome; la telemetría es **append-only y fuera del repo** (§10.5), porque su
trabajo es sobrevivir al worktree y no viajar en la pull request.

**Al reanudar, el programa no se cree el fichero a solas.** Cruza la tarea que
dice el estado con los commits que hay desde `baseSha`: si discrepan, para y lo
dice. No adivina, porque adivinar aquí significa reimplementar encima de una
tarea ya comiteada.

---

## 8. Cómo se lanza, y cómo se ve

> **Cambiado en la implementación.** No se lanza nada: la sesión **pregunta**.

`ct-step next` dice en qué tarea y en qué paso va el run, y prepara lo que ese
paso necesita —el brief de la tarea, o el paquete de revisión del índice—. La
sesión despacha el subagente que toque, le pasa la ruta del fichero donde tiene
que escribir, y vuelve con `ct-step report …` o `ct-step verdict …`.

No hay background, no hay tope de 10 minutos que esquivar y no hay log de turnos
que seguir con `tail -f`: cada paso es una invocación corta que termina, y el
progreso se ve preguntando. Lo que sí se conserva es que **la sesión no carga el
contenido**: los diffs y los logs viajan por RUTA, nunca por el canal.

Lo que se pierde de la versión original: cada `claude -p` dejaba su conversación
en `~/.claude/projects/` con un `session_id` que la telemetría apuntaba, así que
se podía abrir *la conversación del juez de la tarea 5*. Un subagente de la sesión
no expone ese identificador, así que la fila lleva `session: null` y para
rebobinar hay que volver a la conversación de la sesión.

---

## 9. Códigos de salida

Uno por decisión, no uno por excepción: cada fila dice qué hacer después. Sigue
la gramática del repo (stdout es el producto, stderr el diagnóstico) y reusa el
significado del `6` que ya tiene `dispatch-check`.

| | Significado | Qué hacer |
|---|---|---|
| `0` | el paso se aplicó; si el run cerró, todas las tareas están comiteadas con veredicto PASA | seguir con `ct-step next`, o abrir la pull request |
| `1` | el juez veta y se agotaron los reintentos; el trabajo hasta la tarea K-1 está comiteado | mirar el veredicto |
| `2` | error de uso | arreglar la invocación |
| `3` | no hay veredicto de fiar: el juez incumplió el esquema tras los descartes | volver a despachar el juez, o mirar por qué contesta así |
| `4` | los controles siguen en rojo tras agotar los reintentos | mirar los logs |
| `5` | los controles no se pudieron **medir** (comando inexistente, tope de tiempo) | mirar qué se colgó |
| `6` | el plan no es ejecutable: falta el bloque de comandos de `**Verification:**` | arreglar el plan |
| `8` | precondiciones: no es un worktree de slice, índice sucio en un run nuevo, el estado no cuadra con `git log` | arreglar el entorno |
| `9` | **ese no es el paso que toca** | preguntar con `ct-step next` |
| `10` | excepción que el programa no sabe nombrar | el estado persistido sigue siendo bueno |

`1` es un veredicto y `3` no lo es: esa es la distinción que un booleano
perdería. Y el `9` es el que convierte la secuencia en mecanismo — sin él, "la
tabla decide el orden" sería una promesa que el conductor puede incumplir.

El `7` del diseño original (tope de dinero agotado) **no existe**: sin llamadas
headless no hay `total_cost_usd` que acumular.

---

## 10. Telemetría

Una fila por **intento de un paso de una tarea**. Es la granularidad más fina que
el programa ya conoce sin esfuerzo, y agregar hacia arriba (por tarea, por plan,
por epic) es una suma; deshacer una agregación no es nada.

### 10.1 La identidad de una fila

```
repo          org/repo — dos repos pueden compartir número de issue
epic          el milestone, vía epicKeyOf() (§10.3)
issue         el número del issue del slice: ES la identidad del plan padre
plan          la ruta del plan
plan_sha256   el hash de su contenido (§10.2)
task          1..N
task_name     el texto de "### Task N — <name>"
tasks_total   N
step          implement | controls | judge | commit
attempt       1..3 — la vuelta dentro de esta tarea (§10.4)
session       el identificador de la conversación de esa llamada
written_at    marca de tiempo
```

Y como medidas, según el paso: el estado de cada control con la ruta de su log; el
veredicto con su conteo por severidad; coste, turnos y duración de la llamada; y
el tamaño del diff juzgado.

### 10.2 Por qué el número de issue no basta como identidad del plan

El plan se llama `docs/superpowers/plans/YYYY-MM-DD-issue-<n>-<slug>.md`, y el
segmento `issue-<n>-` es exactamente cómo lo encuentra el gate de `--release`.
Así que el número del issue **es** la identidad del plan padre y no hay que
inventar ninguna.

Lo que no cubre es que un plan **se reescribe**: tras el gate `plan`, o tras un
rechazo en revisión. Dos runs contra dos versiones del mismo fichero serían
indistinguibles, y las métricas mentirían justo donde más se van a usar —
comparar el antes y el después de cambiar un plan. De ahí `plan_sha256`, que es
además el idioma que el repo ya usa para esta misma clase de problema
(`SLICES_PRISTINE_HASHES` en `ct-init`).

### 10.3 El epic, sembrado en el despacho

En Control Tower el epic **es el milestone**. No es una interpretación: lo declara
la cabecera de `scripts/gh-issue-map.js:915` — *"una invocación = un `--milestone`
= un epic"* — y `epicKeyOf(rawIssue)` (línea 938) lo deriva del issue crudo, con
`NO_MILESTONE_KEY = '(sin milestone)'` para los que no tienen. `/ct-next` ya lo
calcula hoy, para detectar colisiones del marcador `ct-order` dentro de un mismo
epic.

Así que el epic se **siembra en el despacho**: `buildStateSeed` gana un campo
`epic` en el estado de `.agent/SLICE.md`, y el programa lo lee de ahí. La
alternativa —una llamada a `gh` al arrancar cada run— metería red en el camino
crítico para un dato que el dispatcher ya tenía en la mano.

La ausencia se declara, no se rellena: un issue sin milestone se anota como
`(sin milestone)`, con la constante que ya existe. Es la misma regla que impidió
que `ct-next` asumiera `main` en silencio cuando no conocía la base.

### 10.4 El intento es una dimensión, no un contador agregado

Sin `attempt` no se puede medir cuántas veces vetó el juez, ni cuántas vueltas
costó cada tarea — que es justamente el dato que decide si este experimento
merece la pena. `agentic-skills` lo resuelve con contadores agregados por slice
cerrada (`reintentos_verify`, `descartes_verify`) porque allí la unidad es la
slice; aquí la unidad es la tarea, así que la fila por intento sale gratis del
contador que la máquina ya lleva, y la agregación se hace al leer.

### 10.5 Dónde se escribe, y por qué fuera del repo

En `~/.claude/control-tower/log/<concepto>.jsonl` (o su equivalente bajo
`CLAUDE_CONFIG_DIR`), append-only, un fichero por concepto y el mismo patrón de
nombre para todos. Fuera del repo por el motivo explícito de `agentic-skills`:
para que ningún `git add` de la slice se lleve la telemetría dentro de la pull
request.

El diff juzgado va en un fichero aparte, unido a su fila por la misma clave: es
lo que pesa, y separarlo es lo que permite contar hallazgos sin cargarlo.

**Escribir telemetría no puede tumbar un run.** Si el fichero no se puede
escribir, se avisa por stderr y el run sigue: la medida es para nosotros, no para
la máquina, y ninguna transición depende de ella.

**Implementado así** (`scripts/run-metrics.js` compone la fila,
`ct-step.mjs` la escribe), con dos precisiones que el diseño no fijaba:

- El aviso sale **una vez por run**, no una por paso. Con el disco lleno, un
  aviso por intento convierte el stderr en ruido y esconde lo que sí importa.
- El diff juzgado se queda en `.agent/run-<issue>/`, dentro del worktree, y la
  fila lo referencia por ruta. Cumple lo que pedía el diseño —no viaja en la
  pull request, porque esa carpeta está en el `.gitignore` que siembra
  `ct-init`— y evita mandar al juez a leer fuera de su directorio de trabajo.

### 10.6 Lo que esto adelanta

La ronda F38 ("la medida") pide presupuesto en dinero por slice y gasto
desglosado por papel, y observa que `/ct-harvest` hoy mide el historial de GitHub
y no el gasto. Con estas filas escritas con esta identidad, F38 llega con el dato
ya recogido y le queda la lectura. No se reclama su alcance: aquí no se toca
`/ct-harvest` ni se construye ningún informe.

---

## 11. Lo que hace falta construir

### Paso 0 — medir el hook — **HECHO (2026-08-18)**

Se midió lo que pedía —la hidratación existe, y `--setting-sources` sin `user`
es la palanca, con OAuth intacto (§2.2)— así que el juez **se queda dentro del
worktree** y no hay cambio de diseño.

De propina salieron tres cosas que el diseño no tenía y que sí decide el argv:
`--strict-mcp-config` abarata la misma llamada 38 veces (§2.8), `--output-format
json` regala `structured_output`, `total_cost_usd` y `session_id` (§2.1), y
`--json-schema` toma el JSON literal y no una ruta. El argv completo, en §6.

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

### Paso 2 — el conductor — **HECHO (2026-08-18)**

`scripts/run-machine.js`, `scripts/plan-tasks.js`, `scripts/step-contracts.js`,
`scripts/run-metrics.js`, `scripts/ct-step.mjs`, `agents/ct-judge.md`,
`prompts/task-implementer.md`, el campo `epic` de `scripts/kickoff.js` y
`scripts/ct-next.mjs`, y las reglas de ignore en `scripts/ct-init.sh`
(`.agent/run-*.json` y `.agent/run-*/`). La versión sube a `0.35.0` en los dos
ficheros que la declaran.

**El conductor-programa no está**: `ct-run.mjs` se escribió, se midió (§11.bis) y
se retiró, y en su sitio quedó `ct-step` — la misma máquina, consultada en vez de
conductora. El motivo, en la nota de arriba: D-4 es de José.

La telemetría del §10 y el campo `epic` del §10.3 están construidos:
`scripts/run-metrics.js` con los once campos de identidad, `gh-issue-map.js`
llevando el epic en el issue ya mapeado, `buildStateSeed` sembrándolo con
`(sin milestone)` cuando no lo hay, y `ct-step.mjs` emitiendo una fila por
intento de cada paso.

### Lo que la implementación decidió y este diseño no traía

Seis cosas. Las dos primeras las encontró un test; las otras cuatro salieron de
escribir el código con el binario delante.

1. **El tope de dinero cortaba antes del commit.** El diseño decía "el tope se
   comprueba antes de la llamada siguiente" y el bucle lo comprobaba al empezar
   cada paso — incluido `commit`, que no llama a nadie. Efecto: una tarea
   implementada y juzgada, o sea pagada entera, se tiraba a la basura y el
   worktree se quedaba con el índice lleno. Ahora el tope sólo mira los dos
   pasos que pagan.
2. **La precondición de índice limpio hacía irrecuperable cualquier run
   reanudado.** Tras un veto el índice está lleno por construcción, y esa
   suciedad es justamente el trabajo que se retoma. Se exige sólo en un run
   nuevo.
3. **El implementador también lleva esquema**, aunque el §6 sólo se lo diera al
   juez. El programa necesita las rutas que se tocaron para stagearlas, y sacar
   rutas de un informe en prosa es la trampa del §2.5 en el otro extremo del
   bucle. Y esas rutas se filtran: una ruta absoluta o con `..` se rechaza, que
   la lista la escribe un modelo y acaba en un `git add`.
4. **Seis descartes cortan el run** (código `3`). El §3.3 dejaba ese camino
   respaldado sólo por el tope en dinero, pero un juez que nunca cumple el
   esquema son llamadas de céntimo y medio repetidas durante horas.
5. **`--allow-default-account`.** El §2.3 mandaba parar si falta
   `CLAUDE_CONFIG_DIR`, y sigue siendo el defecto; pero en una máquina sin el
   wrapper de cuentas esa variable no existe y `claude` funciona perfectamente,
   así que hay una salida explícita en vez de un bloqueo sin remedio.
6. **El paquete de revisión se compone del índice** y no con `review-package`
   (§5).

---

## 11.bis La primera corrida real (2026-08-18)

> **Se midió con el conductor-programa, que después se retiró** para no tocar
> D-4. Se deja porque lo que enseñó no depende de quién conduzca: dos de las tres
> lecciones son sobre la vara del plan y sobre el juez, y siguen valiendo enteras
> con `ct-step`. La que caducó es la del coste — sin llamadas headless no hay
> `total_cost_usd`.

No una simulación: repo de verdad, `claude` de verdad, dos tareas (`sum` y luego
`mul`, con sus tests), `--model haiku`.

```
run nuevo: issue #1, 2 tareas, base 54011cb, tope 3 USD
[tarea 1/2] implementado (2 ficheros, 0.1220 USD)
[tarea 1/2] controles: done
[tarea 1/2] veredicto PASS con 0 hallazgo(s) → done (0.0344 USD)
[tarea 1/2] commiteada: b497b81
[tarea 2/2] implementado (2 ficheros, 0.0399 USD)
[tarea 2/2] controles: done
[tarea 2/2] veredicto FAIL con 3 hallazgo(s) → failed (0.0361 USD)
[tarea 2/2] implementado (2 ficheros, 0.0616 USD)
[tarea 2/2] controles: done
[tarea 2/2] veredicto PASS con 0 hallazgo(s) → done (0.0388 USD)
[tarea 2/2] commiteada: e3619c1
run delivered: tarea 2/2, 0 descarte(s), 0.3326 USD
```

**Lo que quedó demostrado**: el bucle entero cierra solo, el veto del juez
devuelve la tarea al implementador y el reintento la arregla, el programa
comitea uno por tarea con su mensaje, el estado se persiste, y una slice de dos
tareas con seis llamadas cuesta **0,33 USD** con haiku. Extrapolado a ocho
tareas sin vetos: unos 0,80 USD. El `--max-usd 50` del diseño era una cifra
puesta a ojo con dos órdenes de magnitud de margen.

**Lo que NO quedó demostrado, y es lo importante.** La tarea 2 pedía `mul()` y
su test. El implementador escribió `mul()` y **no** escribió el test. La primera
vez lo cazó el juez (`FAIL`, tres hallazgos, uno de ellos leyendo el log de los
controles que le pasamos por ruta). La segunda vez el implementador entregó un
fichero de test que **no usa la API de `node:test`**, la suite siguió contando
un test en vez de dos, y el juez le dio `PASS`. **Se comiteó una tarea cuyo test
no existe.**

Tres cosas se siguen de ahí, y ninguna es cosmética:

1. **La vara de un plan mide que nada se rompió, no que se haya añadido lo
   prometido.** De ahí la comprobación de tests declarados que ahora abre el
   paso de controles: es mecánica, es gratis y habría cazado la primera vuelta.
   No habría cazado la segunda —el nombre estaba, escrito en un fichero que no
   ejecuta nadie— y eso es el límite honrado de una comprobación por nombre.
2. **El juez barato es barato.** Tres céntimos y medio por veredicto es
   tentador, y un juez que aprueba un test que no corre no está juzgando. Por
   eso existe `--model-judge`: es el paso donde ahorrar sale caro.
3. **Nada de esto se ve desde dentro del bucle.** El programa hizo todo lo que
   tenía que hacer y salió por `0`. Quien mira el exit code está mirando si el
   conductor funcionó, no si el trabajo está bien — y ese sigue siendo el papel
   del humano que abre la pull request.

## 12. Tests que fijan las propiedades

Con los idiomas que ya usa el repo: `vitest`, un fichero por concepto,
fixtures herméticas (`__tests__/fixtures/hermetic-env.js`), y `const F = '```'`
construido en tiempo de ejecución para que ninguna línea del test empiece por un
cercado real.

| Test | Propiedad que fija |
|---|---|
| `__tests__/run-machine.test.js` (48) | **tabla exhaustiva** de los 24 pares (paso, resultado), incluidos los imposibles: cada uno lanza. Y que los contadores por tarea se reinician al avanzar y los de slice no |
| `__tests__/plan-tasks.test.js` (19) | las tres trampas, **contra el plan real del slice #5 de repo-pulse como fixture**, no contra la plantilla. El caso del paréntesis anidado demuestra con el barrido malo que la trampa es real |
| `__tests__/plan-contract.test.js` (+5) | la regla nueva: una tarea con `**Verification:**` sin bloque de comandos deja de validar |
| `__tests__/step-contracts.test.js` (23) | el veredicto que se descarta (incluido el `PASS` con hallazgo grave, que se contradice), el informe con rutas de fuera del worktree, y el mensaje de commit sin closing keywords |
| `__tests__/ct-step.test.js` (29) | el oráculo contra un repo temporal de verdad: **la guardia del paso** (pedir lo que no toca sale por `9`), los códigos del §9, que comitea el programa, que sólo entra lo declarado, y que el estado sobrevive entre invocaciones |
| `__tests__/d4-sigue-siendo-de-jose.test.js` (6) | **nada del camino por defecto invoca `ct-step`**: ni los slash commands, ni el kickoff, ni las skills, ni los hooks, ni el dispatcher. Y que D-4 sigue aplazada y con dueño en el documento de convergencia |
| `__tests__/run-metrics.test.js` (14) | la fila lleva **los once campos de identidad** del §10.1 —un issue sin milestone se anota `(sin milestone)`, no vacío— y un fallo al escribirla no cambia el código de salida del run |
| `__tests__/kickoff.test.js` (+2) | el estado sembrado trae `epic`, y trae `(sin milestone)` cuando el issue no tiene ninguno |

Los dos ficheros que el diseño listaba aparte —el contrato de códigos de salida
y el del mensaje de commit— viven dentro de esos dos últimos, que es donde está
lo que fijan.

---

## 13. Riesgos

| Riesgo | Mitigación |
|---|---|
| El juez nace hidratado por `SessionStart` y deja de ser independiente | **Medido y resuelto** (§2.2): `--setting-sources ""`. `--bare` no era la palanca (exige clave de API) |
| Coste: 16 llamadas al modelo en una slice de 8 tareas | `--strict-mcp-config` en las dos llamadas (§2.8) y tope en dinero desde el primer día, con corte duro y código de salida propio |
| Una máquina enchufa un servidor MCP nuevo y el coste por llamada se dispara sin que nadie toque el conductor | El argv lleva `--strict-mcp-config` fijo, no configurable: la inmunidad no depende de cómo tenga cada uno su máquina |
| El programa comitea, y el hook de closing keywords no cubre ese camino | El programa valida su mensaje con el mismo módulo que el hook |
| Dos runs a la vez en el mismo worktree | El fichero de estado se abre en exclusiva; un segundo run sale por `8` |
| El plan declara comandos que no existen en la máquina | Resultado `indeterminate`, cierre por `5`, sin reintentar a ciegas |
| Muerte del programa entre el commit y la persistencia | Al reanudar se cruza el estado con `git log` y, si discrepan, para |
| La telemetría no se puede escribir (permisos, disco) | Aviso por stderr y el run sigue: ninguna transición depende de la medida (§10.5) |
| Un plan reescrito hace incomparables dos runs | `plan_sha256` en la identidad de la fila (§10.2) |
| El juez aprueba trabajo que no cumple la tarea | Medido en la corrida real: pasa, y con un modelo barato pasa más. La comprobación de tests declarados quita de en medio los casos mecánicos; para el resto, `--model-judge` y el humano de la pull request |
| Absorber demasiado y romper la premisa del plugin (§7 del documento de convergencia) | Cero dependencias nuevas, cero runtime nuevo: Node 24 y `claude`, que ya son requisitos |

---

## 14. Lo que esto NO hace

- **No cierra D-4, y hay un test que lo defiende.** La respuesta a "¿el
  orquestador deja de ser una sesión de chat?" sigue siendo NO: la sesión sigue
  conduciendo. Lo único que se le quita es decidir la secuencia, y eso no es la
  decisión — es lo que se puede coger sin tomarla.
- **No sustituye a `subagent-driven-development`.** Convive: `ct-step` es una
  herramienta que la sesión despachada puede invocar. El camino por defecto sigue
  siendo el de hoy y no hay nada que revertir si el experimento falla. Cambiarlo,
  cuando haya datos, es un commit de una línea (`kickoff.js:256`).
- **Del despacho toca un campo y sólo uno.** `scripts/kickoff.js` gana `epic` en
  el estado que siembra (§10.3) y `ct-next.mjs` se lo pasa. No cambia el prompt
  del kickoff, ni la línea que nombra el skill, ni el mecanismo de arranque. Y
  como `kickoff.js` no está en el grafo de dependencias de los hooks —que sólo
  importan `state.js`, `state-paths.js`, `closing-keywords.js` y
  `governed-repo.js`—, no arrastra `npm run build`.
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

## 15. Versión

El spec no sube versión. La implementación del paso 1 sube la minor a `0.35.0`
en `package.json` y `.claude-plugin/plugin.json`, que es lo que hace cada ronda.
