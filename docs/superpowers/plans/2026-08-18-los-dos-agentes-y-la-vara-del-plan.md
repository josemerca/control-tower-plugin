# Los dos agentes y la vara del plan

> **This plan is written to be executed by task-scoped subagents with zero context and no
> authority to decide.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it must honour and the exact commands that verify it — not the
> bodies: those you write test-first. Do not improvise on names, signatures, constants or test
> names: they are decided here. On ambiguity, the design doc
> `docs/superpowers/specs/2026-08-18-los-dos-agentes-y-la-vara-del-plan-design.md` and AGENTS.md win.

## 1. Context and goal

`ct-step` conduce el tramo interno de una slice consultando `run-machine.js`, y en su primera
corrida real (slice #5 de `repo-pulse`, 8 tareas, 8 commits) el juez dio ocho `PASS` sin un solo
hallazgo grave. Con las cuatro preguntas abiertas que tiene hoy `agents/ct-judge.md`, ocho `PASS`
no se distinguen de ocho tareas bien hechas. A la vez, `scripts/task-brief` extrae **una tarea**
del plan, así que las secciones que son la vara —`## 1` *Out of scope*, `## 2` *Closed
decisions*, `## 3` *Reference patterns*— no llegan a ningún agente, y de todo lo que el plan
declara con precisión de contrato, después de implementar solo se comprueban los comandos de
`**Verification:**` y los nombres de `**Tests:**`.

Esta ronda cierra ese hueco: lo que del plan es una regla exacta lo comprueba el programa dentro
de `controls`; lo que hace falta leer código para ver se lo queda el juez, con rúbrica cerrada; y
los dos agentes dejan de llevar el oficio escrito dentro para cargar la skill que el plugin ya
trae.

### Desired end state

- `plan-tasks.js` extrae por tarea, además de lo de hoy: las rutas de `**Files:**` con su acción,
  el nombre del test de `**TDD:**`, los ficheros que nombra cada etiqueta de rol y el texto
  literal de los bloques `Final text`.
- `ct-step controls` falla, antes de ejecutar un comando, cuando el diff no cuadra con lo que el
  plan declaró para esa tarea.
- El informe del implementador etiqueta cada ruta `production` o `test`; el veredicto del juez
  nombra la regla que incumple, y la telemetría la registra.
- `task-brief --with-plan-context` añade las tres secciones de vara; sin el flag su salida es
  byte a byte la de hoy.
- `prompts/task-implementer.md` carga `control-tower-loop:test-driven-development`;
  `agents/ct-judge.md` es una rúbrica cerrada de ocho ítems con las tres reglas de calibración.
- `skills/FORK.md` registra la costura 6 y `skills-fork.test.js` la vigila.

### Out of scope

- **Los símbolos del `Contract` no se mecanizan.** Exigiría parsear cualquier lenguaje, y un
  falso positivo en `controls` bloquea una tarea correcta.
- **Que el tramo de `Current state` ya no esté literal tampoco.** Dos líneas de contexto en la
  cita lo disparan con el trabajo bien hecho.
- La tabla de `run-machine.js`, el gate humano del plan, el camino por defecto de
  `subagent-driven-development` y la decisión D-4, que sigue siendo de José.
- El tercer bug de la corrida (un run entregado deja `next` saliendo por 8): otra ronda.

## 2. Closed decisions (do NOT reopen)

| Decision | Value |
|---|---|
| Dónde viven las comprobaciones nuevas | dentro de `controls`, antes de los comandos. La tabla no se toca |
| Ámbito de toda comprobación que busque un literal del plan | `run.lastPaths`, siempre. El plan vive comiteado en el repo |
| Ruta sin `(create)` ni `(modify)` en `**Files:**` | `action: null`, y la comprobación de acción se salta esa ruta. No es un problema del plan |
| Qué skill carga el implementador | `control-tower-loop:test-driven-development`, la del plugin. Nunca `superpowers:` |
| Idioma de los dos prompts | inglés, como hoy. La prosa del plan y de los comentarios, castellano |
| Compatibilidad del informe y del veredicto | se rompe sin ceremonia: el único productor es un prompt de este repo |
| `task-brief` sin flag | salida idéntica byte a byte. Es la frontera con la decisión de José |
| Vara de los dos prompts | los patrones nombrados en §3, por su nombre. Un prompt que no se apoye en ninguno se reescribe |

## 3. Reference patterns

- `scripts/plan-tasks.js` — el parser al que se le añade todo lo de las tareas 1 y 2: anotación
  de cercados, barrido por profundidad, `problems` en vez de excepciones.
- `scripts/ct-step.mjs`, función `testsDeclarados` — la forma exacta de una comprobación acotada
  a `run.lastPaths`, y el idioma de sus mensajes de fallo.
- `__tests__/ct-step.test.js`, describe «los controles los mide el programa» — el fixture de repo
  temporal con git de verdad, y `planComiteado` para lo que busca literales del plan.
- `src/slice_runner/infrastructure/slice_verifier_judge.py` de `agentic-skills` (fuera de este
  repo, solo lectura) — la rúbrica cerrada de la que se portan las tres reglas de calibración.
- Los **augmented coding patterns** de Lada Kesseler y otros, en
  `~/.cache/claude-skills/augmented-coding-patterns/documents/` (fuera del repo, solo lectura).
  Son la vara de las tareas 8 y 9, y cada uno se lee antes de escribir el prompt que lo invoca:
  `patterns/focused-agent.md`, `patterns/reference-docs.md`, `patterns/feedback-flip.md`,
  `patterns/offload-deterministic.md`, `patterns/active-partner.md`,
  `anti-patterns/unvalidated-leaps.md`, `anti-patterns/answer-injection.md`,
  `anti-patterns/perfect-recall-fallacy.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `scripts/plan-tasks.js` | modify | `ct-step.mjs` | Current state / Contract |
| `scripts/step-contracts.js` | modify | `ct-step.mjs` | Current state / Contract |
| `scripts/run-metrics.js` | modify | `ct-step.mjs` | Current state |
| `scripts/ct-step.mjs` | modify | la sesión | Current state / Contract |
| `skills/subagent-driven-development/scripts/task-brief` | modify | `ct-step.mjs`, camino por defecto | Current state |
| `prompts/task-implementer.md` | modify | el implementador | none (prosa de rúbrica) |
| `agents/ct-judge.md` | modify | el juez | none (prosa de rúbrica) |
| `skills/FORK.md` | modify | quien haga un cherry-pick | Final text |
| `__tests__/plan-tasks.test.js` | modify | la suite | none (body by TDD) |
| `__tests__/step-contracts.test.js` | modify | la suite | none (body by TDD) |
| `__tests__/ct-step.test.js` | modify | la suite | none (body by TDD) |
| `__tests__/task-brief.test.js` | create | la suite | none (body by TDD) |
| `__tests__/skills-fork.test.js` | modify | la suite | none (body by TDD) |

## 5. Interfaces

Consumes: nada externo. Todo lo que esta ronda necesita está en el repo — `extractTasks(markdown)`
de `plan-tasks.js`, `readReport`/`readVerdict`/`REPORT_SCHEMA`/`VERDICT_SCHEMA`/`JUDGE_TOOLS`/
`IMPLEMENTER_TOOLS` de `step-contracts.js`, `verdictMeasures(verdict)` de `run-metrics.js`, y el
script `task-brief`.

Produces: `extractTasks` devuelve por tarea, además de `commands`, `testsAdded` y `testsRemoved`,
los campos `files` (lista de `{path, action}` con `action` en `'create' | 'modify' | null`),
`tddName` (`string | null`), `blockPaths` (lista de `{role, path}`) y `finalTexts` (lista de
`{path, text}`). `readReport` devuelve `paths` como lista de `{path, kind}` con `kind` en
`'production' | 'test'`. `readVerdict` devuelve cada hallazgo con `rule`, y `VERDICT_RULES` es el
enum cerrado de las ocho reglas. `verdictMeasures` añade `findings_by_rule`.

## 6. Test strategy

`vitest`, con los comandos de AGENTS.md (`npm test` corre `npm run build && vitest run`). Un
fichero de test por concepto, como ya está el repo. Tres reglas para esta ronda:

- **El plan de un test que busque literales del plan se comitea**, o el test pasa con el bug
  puesto: es la lección de `e4cc3dc`, y el helper `planComiteado` de `ct-step.test.js` ya existe
  para eso.
- Las tareas 1 y 2 se prueban **contra el plan real del slice #5**
  (`__tests__/fixtures/plan-real-issue-5-ejecutable.md`), no contra la plantilla. Un parser
  validado contra la plantilla pasa en verde y se rompe con el primer plan de verdad.
- Las tareas 8 y 9 son prosa, y lo que se puede fijar de la prosa son propiedades mecánicas: qué
  nombra y qué no nombra. Eso va en `skills-fork.test.js` y en los greps de su
  `**Verification:**`, no en un test de comportamiento que no existe.

## 7. Tasks

### Task 1 — las rutas que el plan declara para la tarea

**Objective:** `extractTasks` devuelve, por tarea, las rutas de `**Files:**` con su acción.

**Files:** `scripts/plan-tasks.js` (modify), `__tests__/plan-tasks.test.js` (modify)

Current state (scripts/plan-tasks.js, lines 227):

```js
    return { n: h.n, name: h.name, commands: commands || [], testsAdded: added, testsRemoved: removed }
```

Contract (scripts/plan-tasks.js):

```js
// El marcador ya está en OTHER_MARKERS: '**Files:**'. Se lee con paragraphFrom,
// igual que **Tests:**, porque puede ocupar varias líneas.
// Formato real, medido en el plan del slice #5:
//   **Files:** `web/package.json` (modify), `web/src/testing/setup.ts` (create)
// Los backticks se tiran; la acción es opcional.
export function splitFiles(text) // → Array<{path: string, action: 'create'|'modify'|null}>
```

**TDD:** `it('lee las rutas de **Files:** con su acción')` — sobre la tarea 1 del plan real, las
cuatro rutas en orden y `web/src/testing/setup.ts` con `action: 'create'`; y
`it('una ruta sin acción declarada la deja en null')`.

**Tests:** añade `'lee las rutas de **Files:** con su acción'`, `'una ruta sin acción declarada la
deja en null'`.

**Verification:** los dos tests nuevos pasan y el resto del fichero sigue verde.

```bash
npx vitest run __tests__/plan-tasks.test.js   # exit 0
```

### Task 2 — lo que declaran el TDD y las etiquetas de rol

**Objective:** `extractTasks` devuelve el nombre del test de `**TDD:**`, los ficheros que nombra
cada etiqueta de rol y el texto literal de los bloques `Final text`.

**Files:** `scripts/plan-tasks.js` (modify), `__tests__/plan-tasks.test.js` (modify)

Contract (scripts/plan-tasks.js):

```js
// tddName: el primer nombre entre comillas del párrafo de **TDD:**, con el mismo
// quotedNames que ya usa **Tests:** (barrido de paréntesis incluido). 'No TDD' → null.
// blockPaths: la ruta de cada etiqueta de rol DENTRO de la tarea. Las cuatro
// etiquetas y sus expresiones ya están en plan-contract.js (ROLE_LABELS): se
// repiten aquí, como se repite annotate, porque este módulo no depende de aquél.
// finalTexts: el cuerpo del cercado que sigue a una etiqueta 'Final text'.
export const ROLES = ['Current state', 'Contract', 'Call site', 'Final text']
// devueltos por tarea: tddName: string|null
//                      blockPaths: Array<{role: string, path: string}>
//                      finalTexts: Array<{path: string, text: string}>
```

**TDD:** `it('lee el nombre del test que declara **TDD:**')` — la tarea 1 del plan real da
`'renders the app title in a DOM'`, y la 4 (`No TDD — son los tokens de marca`) da `null`.

**Tests:** añade `'lee el nombre del test que declara **TDD:**'`, `'un No TDD no declara ningún
test'`, `'lee los ficheros que nombra cada etiqueta de rol'`, `'lee el texto literal de un bloque
Final text'`.

**Verification:** los cuatro tests nuevos pasan sobre el plan real como fixture.

```bash
npx vitest run __tests__/plan-tasks.test.js   # exit 0
```

### Task 3 — el informe dice de cada ruta si es producción o test

> **Nota de cierre:** esta tarea se implementó y despues se revirtió — ver el bloque de §3.1
> del design doc. El `kind` ya no existe; el rechazo de rutas duplicadas que llego por aqui, si.

**Objective:** el informe del implementador etiqueta cada ruta, y `ct-step` sigue stageando lo
mismo.

**Files:** `scripts/step-contracts.js` (modify), `scripts/ct-step.mjs` (modify),
`__tests__/step-contracts.test.js` (modify), `__tests__/ct-step.test.js` (modify)

Current state (scripts/step-contracts.js, lines 57-60):

```js
  properties: {
    paths: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
```

Current state (scripts/ct-step.mjs, lines 343):

```js
  git(['add', '--', ...report.paths])
```

Contract (scripts/step-contracts.js):

```js
export const PATH_KINDS = ['production', 'test']
// paths: { type: 'array', items: { type: 'object', additionalProperties: false,
//          required: ['path', 'kind'],
//          properties: { path: { type: 'string' }, kind: { type: 'string', enum: PATH_KINDS } } } }
// readReport valida kind con la misma severidad con la que ya valida la ruta: un
// kind ausente o desconocido DESCARTA el informe entero, no se asume producción.
// La comprobación de ruta fuera del worktree pasa a leer p.path.
```

**TDD:** `it('el informe declara de cada ruta si es producción o test')` — un informe con
`kind: 'production'` se lee y `report.paths[0].kind` lo dice; y `it('un kind desconocido descarta
el informe')` con `kind: 'infra'`.

**Tests:** añade `'el informe declara de cada ruta si es producción o test'`, `'un kind
desconocido descarta el informe'`, `'un informe sin kind se descarta'`.

**Verification:** el informe nuevo se lee, el viejo se descarta, y `ct-step` stagea igual.

```bash
npx vitest run __tests__/step-contracts.test.js __tests__/ct-step.test.js   # exit 0
```

### Task 4 — el hallazgo nombra la regla que incumple

**Objective:** cada hallazgo del veredicto lleva su `rule` del enum cerrado, y la telemetría
cuenta por regla.

**Files:** `scripts/step-contracts.js` (modify), `scripts/run-metrics.js` (modify),
`__tests__/step-contracts.test.js` (modify), `__tests__/run-metrics.test.js` (modify)

Current state (scripts/step-contracts.js, lines 36-43):

```js
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'what', 'where'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          what: { type: 'string' },
          where: { type: 'string' },
        },
```

Contract (scripts/step-contracts.js):

```js
// Las ocho reglas de la rúbrica del juez, en el orden en que la recorre.
// Enum CERRADO: un rule que no esté aquí descarta el veredicto, igual que un
// ruling inventado — un hallazgo que no encaja en ninguna regla es un hallazgo
// que el juez no ha sabido justificar.
export const VERDICT_RULES = [
  'objetivo', 'asercion-tdd', 'contrato', 'decisiones-cerradas',
  'patrones', 'manipulacion-tests', 'fixture-theater', 'alcance',
]
// required: ['rule', 'severity', 'what', 'where']
// run-metrics: findings_by_rule, un contador por regla presente en el veredicto.
```

**TDD:** `it('el hallazgo nombra la regla que incumple')` con `rule: 'manipulacion-tests'`, y
`it('una regla fuera del enum descarta el veredicto')` con `rule: 'me-lo-invento'`.

**Tests:** añade `'el hallazgo nombra la regla que incumple'`, `'una regla fuera del enum descarta
el veredicto'`, `'la telemetría del veredicto cuenta por regla'`.

**Verification:** los tres pasan y la telemetría sigue escribiendo sus once campos de identidad.

```bash
npx vitest run __tests__/step-contracts.test.js __tests__/run-metrics.test.js   # exit 0
```

### Task 5 — el alcance de la tarea lo decide el plan

**Objective:** `controls` falla si las rutas tocadas no son las que el plan declara para esa
tarea, o si la acción declarada no cuadra con el repo.

**Files:** `scripts/ct-step.mjs` (modify), `__tests__/ct-step.test.js` (modify)

Current state (scripts/ct-step.mjs, lines 388-395):

```js
  const ambito = run.lastPaths || []
  const enElIndice = (nombre) => {
    if (!ambito.length) return false
    try {
      execFileSync('git', ['grep', '--cached', '--quiet', '-F', '-e', nombre, '--', ...ambito], { cwd: repoRoot, stdio: 'ignore', timeout: 60_000 })
      return true
    } catch { return false }
  }
```

Contract (scripts/ct-step.mjs):

```js
// Corre ANTES de los comandos, con los nombres declarados: los dos son gratis.
// Un fallo de aquí es `failed`, y su mensaje dice si se arregla el PLAN o el CÓDIGO
// — porque las dos cosas son posibles y confundirlas cuesta un ciclo entero.
// La acción se cruza contra el árbol del commit anterior (`git cat-file -e HEAD:<path>`),
// no contra el disco: el implementador ya creó el fichero cuando esto corre.
function alcanceDeclarado(t) // → string[] de fallos, vacío si cuadra
```

**TDD:** `it('una ruta tocada que el plan no declara para esa tarea es rojo')` — la tarea declara
`uno.txt` y el informe trae `uno.txt` y `dos.txt`; el log nombra `dos.txt` y dice que sobra.

**Tests:** añade `'una ruta tocada que el plan no declara para esa tarea es rojo'`, `'una ruta
declarada que la tarea no tocó es rojo'`, `'(create) sobre un fichero que ya existía es rojo'`.

**Verification:** los tres nuevos pasan y el camino feliz de las dos tareas del fixture sigue
verde.

```bash
npx vitest run __tests__/ct-step.test.js   # exit 0
```

### Task 6 — lo que los bloques del plan prometen tiene que estar

**Objective:** `controls` falla si un fichero nombrado por una etiqueta de rol no se tocó, si el
test de `**TDD:**` no está, o si un `Final text` no aparece verbatim.

**Files:** `scripts/ct-step.mjs` (modify), `__tests__/ct-step.test.js` (modify)

Contract (scripts/ct-step.mjs):

```js
// Tres comprobaciones, todas acotadas a run.lastPaths por la misma razón que
// testsDeclarados: el plan está comiteado dentro del repo.
//  - blockPaths: cada {role, path} exige que path esté entre las rutas tocadas.
//    Un Contract o un Call site que nadie tocó es andamiaje declarado.
//  - tddName: mismo enElIndice que testsDeclarados, y con el mismo mensaje.
//  - finalTexts: el texto tiene que aparecer verbatim en el índice de su path.
//    Se compara contra `git show :<path>`, no con grep: es un bloque multilínea.
function bloquesDeclarados(t) // → string[] de fallos, vacío si cuadra
```

**TDD:** `it('el texto de Final text tiene que aparecer verbatim')` — la tarea declara un `Final
text (doc.md):` de dos líneas, el implementador stagea `doc.md` con una de ellas cambiada, y el
log dice qué línea no está.

**Tests:** añade `'un fichero que un bloque nombra y la tarea no tocó es rojo'`, `'el test que
declara el TDD tiene que estar en lo stageado'`, `'el texto de Final text tiene que aparecer
verbatim'`.

**Verification:** los tres nuevos pasan, y las comprobaciones siguen acotadas: con el plan
comiteado nombrando el fichero, el fallo no aparece.

```bash
npx vitest run __tests__/ct-step.test.js   # exit 0
```

### Task 7 — el brief lleva la vara, detrás de un flag

**Objective:** `task-brief --with-plan-context` añade al brief las tres secciones de vara, y sin
el flag su salida no cambia ni un byte.

**Files:** `skills/subagent-driven-development/scripts/task-brief` (modify),
`scripts/ct-step.mjs` (modify), `__tests__/task-brief.test.js` (create)

Current state (skills/subagent-driven-development/scripts/task-brief, lines 11-14):

```bash
if [ $# -lt 2 ] || [ $# -gt 3 ]; then
  echo "usage: task-brief PLAN_FILE TASK_NUMBER [OUTFILE]" >&2
  exit 2
fi
```

Contract (skills/subagent-driven-development/scripts/task-brief):

```bash
# usage: task-brief [--with-plan-context] PLAN_FILE TASK_NUMBER [OUTFILE]
# El flag va PRIMERO y es opcional. Con él, y solo con él, el fichero de salida
# lleva delante de la tarea las secciones "### Out of scope", "## 2. Closed
# decisions" y "## 3. Reference patterns", cada una con su encabezado, y una
# línea que dice que son la vara y que ganan a la tarea si la contradicen.
# Sin el flag la salida es la de siempre, byte a byte: el camino por defecto de
# subagent-driven-development llama a este script y esa decisión es de José.
```

**TDD:** `it('sin el flag la salida es byte a byte la de hoy')` — se compara la salida contra la
del script en `HEAD` sobre el plan real; y `it('con el flag añade las tres secciones de vara')`.

**Tests:** añade `'sin el flag la salida es byte a byte la de hoy'`, `'con el flag añade las tres
secciones de vara'`, `'el flag desconocido sale por 2'`.

**Verification:** los tres pasan, y `ct-step` pasa el flag.

```bash
npx vitest run __tests__/task-brief.test.js   # exit 0
grep -c -- '--with-plan-context' scripts/ct-step.mjs   # 1
```

### Task 8 — el implementador delega el oficio

**Objective:** `prompts/task-implementer.md` carga la skill de TDD del plugin, recibe la vara y
etiqueta cada ruta.

**Files:** `prompts/task-implementer.md` (modify), `scripts/ct-step.mjs` (modify)

No code — el entregable es prosa de rúbrica, y su contenido lo fija el §6 del design doc. Los
cuatro cambios, y ninguno más: (1) carga `control-tower-loop:test-driven-development` en vez de
la línea suelta sobre TDD, que es `reference-docs` — conocimiento bajo demanda en vez de bulto
permanente; (2) las decisiones cerradas que trae el brief son órdenes, y una que crea equivocada
se obedece y se dice en el informe, que es `active-partner` sin romper el gate: se suprime el
silencio, no la obediencia; (3) cada ruta va con `production` o `test`; (4) nombra lo que el
programa va a medir, para que no gaste presupuesto midiéndolo él —una pasada final de la suite
completa no añade garantía—, que es la cara de `offload-deterministic` que mira al agente. **No
gana auto-revisión**, y eso es `focused-agent`: aquí mide un programa y juzga otro agente, así
que pedirle además que se evalúe le quita atención de lo único que hace. Que el plan traiga
contratos y no cuerpos es `perfect-recall-fallacy` evitado: el cuerpo se escribe con el
compilador delante. En `ct-step.mjs`, la línea que anuncia al implementador pasa a usar
`IMPLEMENTER_TOOLS` en vez de repetir la lista, y esa constante gana `Skill`.

**TDD:** No TDD — es prosa; lo que se puede fijar son propiedades mecánicas, y van en la tarea 10.

**Tests:** N/A — la vara de esta tarea son los greps de su verificación y el test de la tarea 10.

**Verification:** el prompt nombra la skill del plugin y no la de upstream, y la lista de
herramientas ya no está duplicada en `ct-step.mjs`.

```bash
grep -c 'control-tower-loop:test-driven-development' prompts/task-implementer.md   # 1
grep -c 'superpowers:' prompts/task-implementer.md   # 0
grep -c 'Read, Write, Edit, Grep, Glob, Bash' scripts/ct-step.mjs   # 0
npm test   # exit 0
```

### Task 9 — el juez, con rúbrica cerrada

**Objective:** `agents/ct-judge.md` pasa de cuatro preguntas abiertas a los ocho ítems del enum,
con las tres reglas de calibración y las cuatro prohibiciones.

**Files:** `agents/ct-judge.md` (modify)

No code — el entregable es prosa de rúbrica, y su contenido lo fija el §7 del design doc. Este
agente **es** `feedback-flip`: otro agente, con el foco puesto en encontrar problemas en vez de
en producir, que es lo que le deja ver lo que el implementador no podía. Los ocho ítems son
exactamente los ocho valores de `VERDICT_RULES` de la tarea 4, en ese orden, y cada hallazgo
declara el suyo. Las tres reglas: un defecto un hallazgo (bajo la regla más específica);
evidencia citable antes de bloquear, y si no se puede citar se degrada la severidad —que es
`unvalidated-leaps` evitado: sin cita, el bloqueo se apoya en una suposición—; y no se juzga lo
que ya decidió un script, que es `offload-deterministic`. Las cuatro prohibiciones: no
re-ejecutar ni re-derivar los controles, no juzgar el historial de commits —una tarea es un
commit y la precedencia test-implementación no es observable—, no juzgar la higiene del diff ni
el mensaje del commit, y no creerse el `summary` del informe. **Al redactar cada ítem, describe
dónde mirar y nunca qué se va a encontrar**: un ítem que insinúa su propio hallazgo es
`answer-injection`, y fabrica el veto que la regla de la evidencia intenta evitar. El frontmatter
mantiene `tools: Read, Grep, Glob, Write`: gana rúbrica, no `Bash`, que es `focused-agent`.

**TDD:** No TDD — es prosa; la propiedad mecánica que sí se puede fijar es el frontmatter, y ya
la fija `step-contracts.test.js`.

**Tests:** N/A — la vara de esta tarea son los greps de su verificación.

**Verification:** los ocho ítems están nombrados con el mismo identificador que el enum, y el
juez sigue sin shell.

```bash
for r in objetivo asercion-tdd contrato decisiones-cerradas patrones manipulacion-tests fixture-theater alcance; do grep -q "$r" agents/ct-judge.md || echo "falta $r"; done   # sin salida
grep -c '^tools: Read, Grep, Glob, Write$' agents/ct-judge.md   # 1
npx vitest run __tests__/step-contracts.test.js   # exit 0
```

### Task 10 — la costura 6, anotada y vigilada

**Objective:** `FORK.md` registra que el implementador depende de una skill forkeada, y un test
lo vigila.

**Files:** `skills/FORK.md` (modify), `__tests__/skills-fork.test.js` (modify)

Final text (skills/FORK.md):

```md
6. **test-driven-development** (F39): `prompts/task-implementer.md` ya no lleva el
   ciclo escrito dentro — carga `control-tower-loop:test-driven-development`. A
   partir de aquí, un cherry-pick de upstream sobre esa skill cambia el
   comportamiento del implementador de `ct-step`, que antes era inmune. El fork
   se tomó de 6.0.3; comprueba qué cambió en el ciclo antes de traerlo. Lo
   vigila `skills-fork.test.js` (costura 6).
```

**TDD:** `it('costura 6: el implementador carga la skill del plugin, no la de upstream')` — el
prompt nombra `control-tower-loop:test-driven-development` y no contiene `superpowers:`.

**Tests:** añade `'costura 6: el implementador carga la skill del plugin, no la de upstream'`.

**Verification:** el test nuevo pasa y la suite entera sigue como estaba.

```bash
npx vitest run __tests__/skills-fork.test.js   # exit 0
npm test   # exit 0
```

## 8. Global verification

Con las diez tareas comiteadas, la suite entera y una corrida real:

```bash
npm test
```

`__tests__/ct-init.test.js` trae un fallo **anterior a esta rama** (un hash de bloque de contrato
no registrado): falla igual con el árbol limpio en `2f30f9a`, y no es de esta ronda. Todo lo
demás en verde.

Y la validación que de verdad cierra la ronda, que no es un test: rehacer el slice #5 de
`repo-pulse` con estos dos prompts **metiendo a propósito una tarea mal implementada** —un test
prometido que no se escribe, o un assert relajado en un test que ya existía— y comprobar que el
juez la caza y con qué `rule`. Ocho `PASS` sobre trabajo que parece bueno no prueban nada; un
veto sobre trabajo que sabemos malo, sí.

## 9. Assumptions

1. **Las comprobaciones nuevas son `failed`, no un resultado propio** — decisión del design doc
   §1.1: la tabla no se toca. Consecuencia aceptada: un fallo de plan y un fallo de lint son el
   mismo `outcome`, y lo que los distingue es el log y la telemetría.
2. **Una ruta sin acción en `**Files:**` no es un problema del plan** — decisión propia. El
   validador `plan-contract.js` no exige hoy la marca, así que exigirla en `plan-tasks.js`
   rompería planes que ya pasan el gate.
3. **`Final text` se compara contra `git show :<path>`** — decisión propia. Es un bloque
   multilínea y `git grep` trabaja por líneas; comparar el contenido stageado completo es lo que
   permite decir *qué* línea no está.
4. **La acción `(create)`/`(modify)` se cruza contra `HEAD`, no contra el disco** — decisión
   propia. Cuando `controls` corre, el implementador ya creó los ficheros, así que el disco
   siempre diría que existen.
5. **El plan no lleva `issue-<n>-` en su nombre** — convención de este repo, no del template: sus
   cinco planes anteriores se llaman `YYYY-MM-DD-<slug>.md`, y este repo no se gestiona a sí mismo
   con `--check-plan`. Se valida con `validatePlan` directamente.
6. **Diez tareas es más de lo que la skill considera un slice bien cortado.** Se acepta a
   sabiendas: el corte por fichero y por concepto es el que hace que cada una sea un commit
   revisable, y partir la ronda en dos slices es una decisión de spec que no toca a este plan.
7. **Ningún nombre de test empieza línea con un marcador de tarea.** Medido escribiendo este
   plan: una línea de continuación de `**Tests:**` que arrancaba con el marcador del TDD truncó
   el párrafo y dejó dos de los tres nombres sin extraer — `paragraphFrom` corta ahí a propósito.
   Es la cuarta trampa de parseo del §2.5 del design doc del conductor, encontrada desde el otro
   lado, y de momento se esquiva escribiendo; mecanizarla es candidato para `--check-plan`.
