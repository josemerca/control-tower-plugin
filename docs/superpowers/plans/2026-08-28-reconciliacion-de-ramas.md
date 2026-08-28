# Reconciliación de ramas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la rama de un slice se ponga al día con `origin/<base>` antes de
entregar, resolviendo los conflictos de contenido en vez de pararse.

**Architecture:** un paso `reconcile` en la máquina de estados del run
(`run-machine.js`), entre el commit de la última tarea y `global`, ejecutado por
un verbo idempotente de `ct-step` que decide su mitad mirando si existe
`MERGE_HEAD`. Un conflicto no aborta la fusión: la deja viva, la resuelve el
subagente `ct-reconciler` y el programa valida el árbol de forma determinista
antes de concluir el merge. Como una fusión mete commits ajenos en la rama, la
referencia contra la que se mide el slice pasa a derivarse con
`git merge-base HEAD origin/<base>` en vez de leerse de `base_sha`.

**Tech Stack:** Node.js >= 24, ESM, vitest 4. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-08-28-reconciliacion-de-ramas-design.md`

## Global Constraints

Salen de `conventions/`, que es la vara que el juez de cada tarea aplica.
Aplican a **todas** las tareas de este plan.

- **Módulo nuevo nace conforme** (`conventions/style.md`,
  `conventions/architecture.md`): en inglés —nombres de fichero, tipos,
  funciones, variables, constantes, mensajes de diagnóstico y nombres de test—,
  **sin un solo comentario ni docstring**, y **sin funciones sueltas a nivel de
  módulo**: todo cuelga de un tipo.
- **Módulo que ya estaba es deuda declarada**: lo que se le añade sigue el
  estilo de su anfitrión —castellano y funciones libres en `ct-step.mjs`,
  `dispatch-check.mjs`, `run-machine.js`— y eso **no** es un hallazgo. Pero
  meter ahí un concepto nuevo para heredar la exención **sí** lo es.
- **`conventions/defects.md` no tiene exención** y ata en todo diff: vocabulario
  cerrado en vez de strings sueltos o booleanos, despacho exhaustivo sin rama
  por omisión, nada de mapas crudos como valor de retorno de lógica, ni dos
  campos que tengan que concordar, ni valores centinela.
- **Ninguna llamada a proceso externo sin tope, y el adaptador no elige el
  tope**: entra por constructor, sin valor por defecto.
- **Un código de salida distinto de cero es dato, no excepción**: se interpreta.
- **Tests** (`conventions/testing.md`): el nombre del test es la frase que dice
  qué se garantiza, no qué método se llama. El arrange **nunca** se construye
  con la pieza bajo prueba. Los objetos los da una madre con métodos que son
  escenarios nombrados. Una aserción no está terminada hasta que se la ha visto
  fallar por el motivo que dice su nombre.
- **Verificación de toda tarea:** `npm test` en verde. Es `npm run build && vitest run`.
- **Nombre prohibido:** `scripts/reconcile.js` ya existe y es la reconciliación
  de *issues* de `/ct-groom`. Ningún módulo de este plan puede llamarse así.

---

## Estructura de ficheros

| Fichero | Responsabilidad | Estado |
|---|---|---|
| `scripts/slice-base.js` | resolver la referencia contra la que se mide el slice | **nuevo, conforme** |
| `scripts/reconcile-outcome.js` | el vocabulario cerrado de desenlaces de la reconciliación | **nuevo, conforme** |
| `scripts/branch-reconciliation.js` | la mecánica de git: fusionar, clasificar el fallo, listar conflictos, validar y concluir | **nuevo, conforme** |
| `scripts/run-machine.js` | el paso, sus contadores, la tabla y la proyección al vocabulario del flujo | existente, deuda declarada |
| `scripts/ct-step.mjs` | el cableado del verbo y el consumo de la referencia | existente, deuda declarada |
| `scripts/dispatch-check.mjs` | el consumo de la referencia en las dos puertas de diff | existente, deuda declarada |
| `agents/ct-reconciler.md` | el subagente que resuelve el conflicto | nuevo |

Tres fases. **La fase A entrega valor sola**: arregla un agujero que ya existe
hoy —una fusión manual de `main` en la rama del slice contamina el diff del
release en silencio— sin que el paso `reconcile` exista todavía.

---

## Fase A — la referencia de medida

### Task 1: `SliceBase`, la referencia contra la que se mide el slice

**Files:**
- Create: `scripts/slice-base.js`
- Create: `__tests__/slice-base.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `class SliceBase`, construida con `new SliceBase({ git })` donde
  `git` es una función `(argv: string[]) => string | null` que devuelve la
  salida del comando ya trimada, o `null` si el comando falló. Expone
  `measurementSha({ baseBranch, fallbackSha }) : string | null`.

El contrato: si `origin/<baseBranch>` resuelve, devuelve el `merge-base` con
HEAD; si no, devuelve `fallbackSha`; si tampoco lo hay, `null`. Quien recibe
`null` decide qué hacer — `SliceBase` no lanza ni decide política.

El tope de los subprocesos **no** vive aquí: `git` llega por constructor y ya
lo trae puesto. Eso es lo que exige `conventions/architecture.md`
(*«the adapter does not choose the cap»*).

- [ ] **Step 1: Write the failing test**

`__tests__/slice-base.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { SliceBase } from '../scripts/slice-base.js'

class GitDouble {
  constructor(answers) {
    this.answers = answers
    this.calls = []
  }

  run = (argv) => {
    this.calls.push(argv)
    const key = argv.join(' ')
    if (!(key in this.answers)) return null
    return this.answers[key]
  }
}

describe('SliceBase', () => {
  it('a_fused_branch_is_measured_from_the_merge_base_and_not_from_the_cut', () => {
    const git = new GitDouble({ 'merge-base HEAD origin/main': 'dddddddddddddddddddddddddddddddddddddddd' })
    const base = new SliceBase({ git: git.run })

    expect(base.measurementSha({ baseBranch: 'main', fallbackSha: 'bbbbbbbb' }))
      .toBe('dddddddddddddddddddddddddddddddddddddddd')
  })

  it('a_remote_that_does_not_resolve_falls_back_to_the_cut_instead_of_measuring_nothing', () => {
    const git = new GitDouble({})
    const base = new SliceBase({ git: git.run })

    expect(base.measurementSha({ baseBranch: 'main', fallbackSha: 'bbbbbbbb' })).toBe('bbbbbbbb')
  })

  it('no_remote_and_no_cut_answers_nothing_instead_of_guessing_a_reference', () => {
    const git = new GitDouble({})
    const base = new SliceBase({ git: git.run })

    expect(base.measurementSha({ baseBranch: 'main', fallbackSha: null })).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/slice-base.test.js`
Expected: FAIL con `Failed to load .../scripts/slice-base.js`

- [ ] **Step 3: Write minimal implementation**

`scripts/slice-base.js`:

```js
export class SliceBase {
  constructor({ git }) {
    this.git = git
  }

  measurementSha({ baseBranch, fallbackSha }) {
    const mergeBase = this.git(['merge-base', 'HEAD', `origin/${baseBranch}`])
    if (mergeBase) return mergeBase
    return fallbackSha ?? null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/slice-base.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: See each assertion fail for the reason its name gives**

`conventions/testing.md` lo exige, y no es la fase roja del ciclo. Uno a uno:

1. En `measurementSha`, cambia `return mergeBase` por `return fallbackSha` y
   comprueba que **solo** cae el primer test. Restaura.
2. Cambia `return fallbackSha ?? null` por `return null` y comprueba que cae el
   segundo y no el tercero. Restaura.
3. Cambia `fallbackSha ?? null` por `fallbackSha ?? 'HEAD'` y comprueba que cae
   el tercero. Restaura.

Si alguno no cae, la aserción es más débil que su nombre: arréglala.

- [ ] **Step 6: Commit**

```bash
git add scripts/slice-base.js __tests__/slice-base.test.js
git commit -m "feat: la referencia de medida del slice sale de git, no de un campo"
```

---

### Task 2: `dispatch-check` mide desde el merge-base

**Files:**
- Modify: `scripts/dispatch-check.mjs` — `stateFilesIntroducedByBranch()` (`:552`) y `branchIntroducedFiles()` (`:586`)
- Create: `__tests__/dispatch-check-merge-base.test.js`

**Interfaces:**
- Consumes: `SliceBase` de Task 1.
- Produces: nada que consuman tareas posteriores.

Las dos funciones llaman hoy a `sliceBaseRef()`, que prefiere `base_sha:` de la
semilla. Pasan a resolver la referencia con `SliceBase`, usando `base_sha` como
`fallbackSha`. **`readFileAtBase()` (`:623`) no se toca**: valida las citas del
plan y esas se escribieron contra el corte original.

`sliceBaseRef()` devuelve un sha, y `merge-base` necesita el **nombre** de la
rama remota. Hace falta un resolutor hermano que devuelva el nombre, con la
cadena de fallback que el fichero ya tiene escrita en `:518`:
`base:` de la semilla → `origin/HEAD` → `origin/main` → `main` → `master`.

Este fichero es deuda declarada: el código nuevo va en castellano y con
funciones libres, como su anfitrión.

- [ ] **Step 1: Write the failing test**

`__tests__/dispatch-check-merge-base.test.js`. El arrange monta el repo con
`git` de verdad, **nunca** llamando a `dispatch-check`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Lanza subprocesos git de verdad: el subconjunto rápido excluye este fichero.
const git = (cwd, ...argv) => execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim()

class RepoMother {
  static aSliceBranchBehindItsBase() {
    const remote = mkdtempSync(join(tmpdir(), 'ct-mb-remote-'))
    git(remote, 'init', '--bare', '-b', 'main')

    const seed = mkdtempSync(join(tmpdir(), 'ct-mb-seed-'))
    git(seed, 'init', '-b', 'main')
    git(seed, 'config', 'user.email', 'x@y.z')
    git(seed, 'config', 'user.name', 'x')
    writeFileSync(join(seed, 'base.txt'), 'B\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'B')
    git(seed, 'remote', 'add', 'origin', remote)
    git(seed, 'push', '-u', 'origin', 'main')
    const cut = git(seed, 'rev-parse', 'HEAD')

    const work = mkdtempSync(join(tmpdir(), 'ct-mb-work-'))
    git(work, 'clone', remote, '.')
    git(work, 'config', 'user.email', 'x@y.z')
    git(work, 'config', 'user.name', 'x')
    git(work, 'switch', '-c', 'feat/42')
    writeFileSync(join(work, 'slice.txt'), 'S1\n')
    git(work, 'add', '.')
    git(work, 'commit', '-m', 'S1')

    writeFileSync(join(seed, 'foreign.txt'), 'C\n')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'C')
    git(seed, 'push', 'origin', 'main')
    git(work, 'fetch', 'origin', 'main')

    mkdirSync(join(work, '.agent'), { recursive: true })
    writeFileSync(join(work, '.agent', 'SLICE.md'), `---\nbase: main\nbase_sha: ${cut}\n---\n`)

    return { work, remote, seed, cut }
  }
}

const DISPATCH_CHECK = join(process.cwd(), 'scripts', 'dispatch-check.mjs')
const filesSeenByTheGate = (cwd) =>
  execFileSync('node', [DISPATCH_CHECK, '42', '--repo', 'o/r', '--check-plan'], {
    cwd, encoding: 'utf8', env: { ...process.env },
  })

describe('las puertas de diff de dispatch-check', () => {
  let world

  beforeEach(() => { world = RepoMother.aSliceBranchBehindItsBase() })
  afterEach(() => {
    for (const d of [world.work, world.remote, world.seed]) rmSync(d, { recursive: true, force: true })
  })

  it('a_branch_that_merged_its_base_does_not_report_the_files_that_merge_brought_as_its_own', () => {
    git(world.work, 'merge', '--no-edit', 'origin/main')

    const measured = git(world.work, 'merge-base', 'HEAD', 'origin/main')
    const changed = execFileSync('git', ['diff', '--no-relative', '--no-renames', '--name-only', `${measured}...HEAD`], {
      cwd: world.work, encoding: 'utf8',
    }).split('\n').filter(Boolean)

    expect(changed).toEqual(['slice.txt'])
    expect(changed).not.toContain('foreign.txt')
  })

  it('the_cut_recorded_in_the_seed_would_have_reported_the_foreign_file_as_the_slices_own', () => {
    git(world.work, 'merge', '--no-edit', 'origin/main')

    const changed = execFileSync('git', ['diff', '--no-relative', '--no-renames', '--name-only', `${world.cut}...HEAD`], {
      cwd: world.work, encoding: 'utf8',
    }).split('\n').filter(Boolean)

    expect(changed).toContain('foreign.txt')
  })
})
```

El segundo test **pina el bug**: documenta por qué el cambio hace falta y se
pondría rojo si alguien devolviera `sliceBaseRef()` a las puertas.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/dispatch-check-merge-base.test.js`
Expected: el primero PASS (mide git directamente), el segundo PASS. Los dos
describen el mundo, no el código todavía — sirven de red para el Step 3.

- [ ] **Step 3: Modify `dispatch-check.mjs`**

Añade, junto a `sliceBaseRef()` (`:480`), un resolutor del **nombre** de la rama
remota que reutilice la cadena de `:518`, e instancia `SliceBase` con el helper
de git que el fichero ya tiene. Sustituye la resolución de `base` en
`stateFilesIntroducedByBranch()` (`:553`) y `branchIntroducedFiles()` (`:587`)
por la referencia que devuelva `SliceBase.measurementSha`, pasando el resultado
de `sliceBaseRef()` como `fallbackSha`.

No toques `readFileAtBase(plan.base)` en `:738`: sigue recibiendo el corte.
Cuidado ahí — `branchIntroducedFiles()` devuelve `{ base }` y ese `base` es el
que alimenta `readFileAtBase`. Devuelve **los dos**: la referencia de medida
para el diff y el corte para las citas.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. Presta atención a `__tests__/dispatch-check-*.test.js`, que ya
cubren las dos puertas.

- [ ] **Step 5: See the assertion fail for the reason its name gives**

Devuelve a mano `stateFilesIntroducedByBranch()` a `sliceBaseRef()`, corre
`npm test`, y confirma que rojo. Restaura.

- [ ] **Step 6: Commit**

```bash
git add scripts/dispatch-check.mjs __tests__/dispatch-check-merge-base.test.js
git commit -m "fix: las puertas de diff miden desde el merge-base, no desde el corte"
```

---

### Task 3: `ct-step` cuenta commits desde el merge-base

**Files:**
- Modify: `scripts/ct-step.mjs:200-203` (`commitsDesde`) y `:222`
- Modify: `__tests__/step-contracts.test.js` o el fichero que cubra la carga del estado

**Interfaces:**
- Consumes: `SliceBase` de Task 1.
- Produces: nada.

`commitsDesde(sha)` hace `git rev-list --count <sha>..HEAD`. Pasa a contar desde
la referencia de medida y con `--no-merges`.

**`esperados` (`:244-246`) no se toca**, y esto es el punto entero del cambio:
con la referencia nueva, los commits que trajo la fusión salen del rango, y
`--no-merges` excluye el commit de fusión. La cuenta vuelve a dar exactamente lo
mismo que hoy. Los commits de slice (el del veredicto, el del informe de e2e) no
son merges, así que `sliceCommits` sigue contándolos igual.

El nombre de la base sale de `.agent/SLICE.md` con `parseStateSafe`, el mismo
parser que el fichero ya usa para `epic:` (`:302`) y `senal:` (`:315`).

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/ct-step-merge-base.test.js` (nuevo, lanza git real):

```js
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const git = (cwd, ...argv) => execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim()

describe('la cuenta de commits del run', () => {
  it('a_merge_of_the_base_does_not_inflate_the_count_of_committed_tasks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-count-'))
    git(dir, 'init', '-b', 'main')
    git(dir, 'config', 'user.email', 'x@y.z')
    git(dir, 'config', 'user.name', 'x')
    writeFileSync(join(dir, 'a.txt'), 'B\n'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'B')
    const cut = git(dir, 'rev-parse', 'HEAD')

    git(dir, 'switch', '-c', 'feat/42')
    writeFileSync(join(dir, 's.txt'), 'S1\n'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'S1')

    git(dir, 'switch', 'main')
    writeFileSync(join(dir, 'c.txt'), 'C\n'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'C')
    const advanced = git(dir, 'rev-parse', 'HEAD')

    git(dir, 'switch', 'feat/42')
    git(dir, 'merge', '--no-edit', 'main')

    const fromTheCut = Number(git(dir, 'rev-list', '--count', `${cut}..HEAD`))
    const fromTheMergeBase = Number(git(dir, 'rev-list', '--count', '--no-merges', `${advanced}..HEAD`))

    expect(fromTheCut).toBe(3)
    expect(fromTheMergeBase).toBe(1)

    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run __tests__/ct-step-merge-base.test.js`
Expected: PASS. Fija el hecho de git del que depende el cambio: 3 contra 1.

- [ ] **Step 3: Modify `ct-step.mjs`**

En `commitsDesde` añade `--no-merges`. En `:222`, sustituye `run.baseSha` por la
referencia que devuelva `SliceBase.measurementSha({ baseBranch, fallbackSha: run.baseSha })`,
con `baseBranch` leído de `.agent/SLICE.md` con `parseStateSafe`.

Deja `run.baseSha` en el mensaje de error de `:248` **solo si sigue siendo
cierto**; si la referencia efectiva es otra, el mensaje tiene que nombrarla, o
mandará a mirar el commit equivocado.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: See it fail for the reason its name gives**

Quita `--no-merges`, corre `npm test`, confirma rojo. Restaura.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-step.mjs __tests__/ct-step-merge-base.test.js
git commit -m "fix: la cuenta de commits del run no la infla una fusion de la base"
```

---

## Fase B — el paso en la máquina

### Task 4: `ReconcileOutcome`, el vocabulario cerrado

**Files:**
- Create: `scripts/reconcile-outcome.js`
- Create: `__tests__/reconcile-outcome.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `ReconcileOutcome`, objeto congelado con seis miembros:

```
UP_TO_DATE       nada que fusionar
MERGED           fusionó limpio
CONFLICTING      conflicto de contenido, MERGE_HEAD vivo
UNMERGEABLE_TREE el merge falló sin dejar MERGE_HEAD
RESOLVED         resolución validada y fusión concluida
ROUND_DISCARDED  la validación rechazó la ronda
```

Y `ReconcileRound`, el resultado que la mecánica devuelve: lleva el miembro del
vocabulario **y el efecto entero** — los ficheros en conflicto y, cuando la
ronda se descarta, su motivo. Un booleano colapsaría estados que se arreglan
distinto, y un mapa crudo lo leería el consumidor por clave
(`conventions/defects.md`).

El motivo del descarte es a su vez un vocabulario cerrado, no una cadena libre:
`MARKERS_LEFT`, `TOUCHED_OUTSIDE_THE_CONFLICT`, `UNRESOLVED_FILES_REMAIN`.

Seis miembros son los seis estados que este diseño arregla de forma distinta.
Ninguno es un booleano derivado de otro, y no hay un séptimo implícito: la
ausencia también es miembro (`UP_TO_DATE`), no un opcional.

- [ ] **Step 1: Write the failing test**

`__tests__/reconcile-outcome.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { ReconcileOutcome, DiscardReason, ReconcileRound } from '../scripts/reconcile-outcome.js'

describe('ReconcileOutcome', () => {
  it('every_member_is_distinct_so_no_two_states_that_are_fixed_differently_collapse', () => {
    const members = Object.values(ReconcileOutcome)
    expect(new Set(members).size).toBe(members.length)
    expect(members).toHaveLength(6)
  })

  it('the_vocabulary_cannot_be_widened_at_runtime_by_a_consumer', () => {
    expect(Object.isFrozen(ReconcileOutcome)).toBe(true)
  })

  it('a_discarded_round_carries_why_instead_of_leaving_the_consumer_to_guess', () => {
    const round = ReconcileRound.discarded({
      files: ['a.txt'],
      reason: DiscardReason.MARKERS_LEFT,
    })

    expect(round.outcome).toBe(ReconcileOutcome.ROUND_DISCARDED)
    expect(round.reason).toBe(DiscardReason.MARKERS_LEFT)
    expect(round.files).toEqual(['a.txt'])
  })

  it('a_round_that_was_not_discarded_has_no_reason_field_standing_in_for_absence', () => {
    const round = ReconcileRound.of({ outcome: ReconcileOutcome.MERGED, files: [] })

    expect(round.reason).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/reconcile-outcome.test.js`
Expected: FAIL con `Failed to load .../scripts/reconcile-outcome.js`

- [ ] **Step 3: Write minimal implementation**

`scripts/reconcile-outcome.js`:

```js
export const ReconcileOutcome = Object.freeze({
  UP_TO_DATE: 'up-to-date',
  MERGED: 'merged',
  CONFLICTING: 'conflicting',
  UNMERGEABLE_TREE: 'unmergeable-tree',
  RESOLVED: 'resolved',
  ROUND_DISCARDED: 'round-discarded',
})

export const DiscardReason = Object.freeze({
  MARKERS_LEFT: 'markers-left',
  TOUCHED_OUTSIDE_THE_CONFLICT: 'touched-outside-the-conflict',
  UNRESOLVED_FILES_REMAIN: 'unresolved-files-remain',
})

export class ReconcileRound {
  constructor({ outcome, files, reason }) {
    this.outcome = outcome
    this.files = Object.freeze([...files])
    this.reason = reason ?? null
    Object.freeze(this)
  }

  static of({ outcome, files }) {
    return new ReconcileRound({ outcome, files, reason: null })
  }

  static discarded({ files, reason }) {
    return new ReconcileRound({ outcome: ReconcileOutcome.ROUND_DISCARDED, files, reason })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/reconcile-outcome.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: See each assertion fail for the reason its name gives**

Quita un miembro de `ReconcileOutcome` (cae el primero). Quita el
`Object.freeze` (cae el segundo). Haz que `discarded` no copie `reason` (cae el
tercero). Haz que `reason` valga `''` en vez de `null` — el valor centinela que
`conventions/defects.md` prohíbe — y comprueba que cae el cuarto. Restaura cada
uno.

- [ ] **Step 6: Commit**

```bash
git add scripts/reconcile-outcome.js __tests__/reconcile-outcome.test.js
git commit -m "feat: el vocabulario cerrado de la reconciliacion de una rama"
```

---

### Task 5: el paso `reconcile` en la tabla

**Files:**
- Modify: `scripts/run-machine.js` — `STEPS`, `RUN_STATES`, `DEFAULT_BUDGETS`, `newRun`, `after`, y una función de transición nueva
- Modify: `__tests__/run-machine.test.js` — el conjunto `DESCRITOS`

**Interfaces:**
- Consumes: `ReconcileOutcome` de Task 4.
- Produces: `STEPS.RECONCILE = 'reconcile'`, `RUN_STATES.BLOCKED_RECONCILE = 'blocked-reconcile'`,
  `DEFAULT_BUDGETS.reconcileRetries = 2`, el campo `reconcileRetries: 0` en
  `newRun`, y `outcomeOfReconcile(reconcileOutcome) : string` exportada, que
  proyecta el vocabulario de Task 4 al `OUTCOMES` del flujo.

Aquí vive **la política**: qué paso viene después de cada resultado y qué cuenta
como agotado (`conventions/architecture.md`). No es un `if` en el verbo.

La proyección vive en `run-machine.js` y no en `ct-step.mjs` porque
*«translating a step's result into the flow's vocabulary is not the conductor's:
that projection lives on the destination's side»*. Va como función libre,
siguiendo el estilo de su anfitrión — extiende `OUTCOMES`, que ya estaba ahí, así
que no es un concepto nuevo colado en un fichero viejo.

Las transiciones:

| Resultado | Va a |
|---|---|
| `DONE` (up-to-date, merged, resolved) | `STEPS.GLOBAL` |
| `FAILED` (conflicto que el reconciler no resolvió, o árbol inservible) | otra ronda si queda presupuesto; si no, `BLOCKED_RECONCILE` |
| `DISCARDED` (ronda rechazada) | `STEPS.RECONCILE`, `discards + 1`, **sin gastar reintento** |

`DISCARDED` no gasta reintento por el mismo motivo que ya no lo gasta en
`trasImplementar` y en `trasElJuez`: no se tocó el resultado, se rechazó la
respuesta. Su freno es `MAX_DISCARDS`, que ya existe.

El escalado al agente del slice no es un estado de la tabla: es el mensaje con
el que `ct-step` cierra la última ronda antes de bloquear. La tabla solo sabe de
presupuesto agotado.

- [ ] **Step 1: Write the failing test**

Añade a `DESCRITOS` en `__tests__/run-machine.test.js`:

```js
  'reconcile/done', 'reconcile/failed', 'reconcile/discarded',
```

Y un `describe` nuevo en el mismo fichero:

```js
describe('el paso reconcile', () => {
  const enReconcile = (over = {}) => run({ step: STEPS.RECONCILE, ...over })

  it('a_branch_that_is_up_to_date_moves_on_to_the_global_verification', () => {
    const { run: siguiente, state } = after(enReconcile(), OUTCOMES.DONE)
    expect(siguiente.step).toBe(STEPS.GLOBAL)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('a_conflict_that_was_not_resolved_spends_a_retry_before_blocking', () => {
    const { run: siguiente, state } = after(enReconcile({ reconcileRetries: 0 }), OUTCOMES.FAILED)
    expect(siguiente.step).toBe(STEPS.RECONCILE)
    expect(siguiente.reconcileRetries).toBe(1)
    expect(state).toBe(RUN_STATES.OPEN)
  })

  it('the_run_blocks_on_reconcile_once_its_retries_are_spent_instead_of_looping', () => {
    const agotado = enReconcile({ reconcileRetries: DEFAULT_BUDGETS.reconcileRetries })
    expect(after(agotado, OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_RECONCILE)
  })

  it('a_discarded_round_asks_again_without_spending_a_retry_because_nothing_was_resolved', () => {
    const { run: siguiente } = after(enReconcile({ reconcileRetries: 1 }), OUTCOMES.DISCARDED)
    expect(siguiente.step).toBe(STEPS.RECONCILE)
    expect(siguiente.reconcileRetries).toBe(1)
    expect(siguiente.discards).toBe(1)
  })

  it('the_last_committed_task_reconciles_before_it_verifies_globally', () => {
    const ultima = run({ step: STEPS.COMMIT, task: 3, tasksTotal: 3 })
    expect(after(ultima, OUTCOMES.DONE).run.step).toBe(STEPS.RECONCILE)
  })
})

describe('la proyeccion del vocabulario de reconcile', () => {
  it.each([
    [ReconcileOutcome.UP_TO_DATE, OUTCOMES.DONE],
    [ReconcileOutcome.MERGED, OUTCOMES.DONE],
    [ReconcileOutcome.RESOLVED, OUTCOMES.DONE],
    [ReconcileOutcome.CONFLICTING, OUTCOMES.FAILED],
    [ReconcileOutcome.UNMERGEABLE_TREE, OUTCOMES.FAILED],
    [ReconcileOutcome.ROUND_DISCARDED, OUTCOMES.DISCARDED],
  ])('%s se proyecta a %s', (miembro, esperado) => {
    expect(outcomeOfReconcile(miembro)).toBe(esperado)
  })

  it('un_miembro_nuevo_sin_proyectar_lanza_en_vez_de_caer_en_una_rama_por_omision', () => {
    expect(() => outcomeOfReconcile('un-miembro-que-nadie-proyecto')).toThrow()
  })
})
```

Importa `ReconcileOutcome` y `outcomeOfReconcile` al principio del fichero.

El último test es **el que sustituye al type checker**: `conventions/defects.md`
exige despacho exhaustivo sin rama por omisión, *«where it does not [fail at
compile time], in the test that covers that dispatch»*. El juez de
`agentic-skills` levantó este hallazgo exacto (`f2`) sobre este mismo código.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/run-machine.test.js`
Expected: FAIL. El test exhaustivo de la tabla dirá que `reconcile/done` está en
`DESCRITOS` pero la transición lanza.

- [ ] **Step 3: Write the implementation**

En `scripts/run-machine.js`:

```js
export const STEPS = Object.freeze({
  // ...los que ya hay
  RECONCILE: 'reconcile',
})
```

`RECONCILE` va declarado junto a `GLOBAL`, `SLICE_JUDGE` y `E2E`, con un
comentario en el estilo del fichero que diga por qué va antes de `global` y no
después.

```js
export const RUN_STATES = Object.freeze({
  // ...los que ya hay
  BLOCKED_RECONCILE: 'blocked-reconcile',
})

export const DEFAULT_BUDGETS = Object.freeze({
  controlRetries: 2,
  judgeRetries: 2,
  correctionRetries: 2,
  reconcileRetries: 2,
})
```

En `newRun`, añade `reconcileRetries: 0` junto a los otros tres contadores.
**No** lo añadas al reseteo por tarea de `trasElCommit`: la reconciliación es de
la slice, no de una tarea, igual que los descartes y el dinero.

En `trasElCommit`, la rama de la última tarea pasa de `step: STEPS.GLOBAL` a
`step: STEPS.RECONCILE` (los tres contadores a cero se quedan como están).

En `after`, añade `case STEPS.RECONCILE: return trasReconciliar(run, outcome, budgets)`.

```js
function trasReconciliar(run, outcome, budgets) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return abierto(run, { step: STEPS.GLOBAL })
    case OUTCOMES.FAILED:
      return run.reconcileRetries < budgets.reconcileRetries
        ? abierto(run, { step: STEPS.RECONCILE, reconcileRetries: run.reconcileRetries + 1 })
        : cerrado(run, RUN_STATES.BLOCKED_RECONCILE)
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.RECONCILE, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}

export function outcomeOfReconcile(reconcileOutcome) {
  switch (reconcileOutcome) {
    case ReconcileOutcome.UP_TO_DATE:
    case ReconcileOutcome.MERGED:
    case ReconcileOutcome.RESOLVED:
      return OUTCOMES.DONE
    case ReconcileOutcome.CONFLICTING:
    case ReconcileOutcome.UNMERGEABLE_TREE:
      return OUTCOMES.FAILED
    case ReconcileOutcome.ROUND_DISCARDED:
      return OUTCOMES.DISCARDED
    default:
      throw new Error(`desenlace de reconciliación sin proyectar: "${reconcileOutcome}"`)
  }
}
```

Importa `ReconcileOutcome` de `./reconcile-outcome.js` al principio del fichero.
Es un vocabulario puro: no rompe la pureza que la cabecera declara.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. El test exhaustivo pasa ahora a recorrer 8 pasos x 6 resultados.

- [ ] **Step 5: See each assertion fail for the reason its name gives**

Cambia `RECONCILE` por `GLOBAL` en `trasElCommit` (cae
`the_last_committed_task_reconciles_before_it_verifies_globally`). En
`trasReconciliar`, haz que `DISCARDED` incremente `reconcileRetries` (cae
`a_discarded_round_asks_again_without_spending_a_retry_because_nothing_was_resolved`).
Sustituye el `default` de `outcomeOfReconcile` por `return OUTCOMES.DONE` (cae
`un_miembro_nuevo_sin_proyectar_lanza...`). Restaura los tres.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-machine.js __tests__/run-machine.test.js
git commit -m "feat: la tabla del run conoce el paso reconcile y su presupuesto"
```

---

## Fase C — la mecánica de git

### Task 6: `BranchReconciliation`, la primera mitad

**Files:**
- Create: `scripts/branch-reconciliation.js`
- Create: `__tests__/branch-reconciliation.test.js`

**Interfaces:**
- Consumes: `ReconcileOutcome`, `ReconcileRound` de Task 4.
- Produces: `class BranchReconciliation`, construida con
  `new BranchReconciliation({ git })` donde `git` es
  `(argv: string[]) => { code: number, stdout: string }` — **el código de salida
  es dato, no excepción** (`conventions/architecture.md`). Expone
  `merge({ baseBranch }) : ReconcileRound` y `isMergeInProgress() : boolean`.

`merge` hace, en este orden: `git fetch origin <baseBranch>`, luego
`git rev-list --count HEAD..origin/<baseBranch>`; si es cero devuelve
`UP_TO_DATE` sin fusionar nada; si no, `git merge --no-edit origin/<baseBranch>`
e interpreta el código de salida:

- 0 → `MERGED`
- distinto de 0 **y** existe `MERGE_HEAD` → `CONFLICTING`, con la lista de
  `git diff --name-only --diff-filter=U`
- distinto de 0 **y no** existe `MERGE_HEAD` → `UNMERGEABLE_TREE`

**No aborta nunca.** Y la clasificación **no** parsea `stderr`: se le pregunta
al árbol, que es robusto frente al idioma y la versión de git. Está medido: es
la lección 2 de la spec.

- [ ] **Step 1: Write the failing test**

`__tests__/branch-reconciliation.test.js`, con un doble de git que responde por
lo que se le pregunta y **lanza cuando nadie escribió respuesta**, como exige
`conventions/testing.md`:

```js
import { describe, it, expect } from 'vitest'
import { BranchReconciliation } from '../scripts/branch-reconciliation.js'
import { ReconcileOutcome } from '../scripts/reconcile-outcome.js'

class GitConversation {
  constructor(answers) {
    this.answers = answers
    this.calls = []
  }

  run = (argv) => {
    const key = argv.join(' ')
    this.calls.push(key)
    if (!(key in this.answers)) throw new Error(`nadie escribió respuesta para: git ${key}`)
    return this.answers[key]
  }

  asked(fragment) {
    return this.calls.some((c) => c.includes(fragment))
  }
}

const ok = (stdout = '') => ({ code: 0, stdout })
const failed = (stdout = '') => ({ code: 1, stdout })

class ConversationMother {
  static aBaseThatDidNotMove() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('0'),
    })
  }

  static aBaseThatMergesCleanly() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('2'),
      'merge --no-edit origin/main': ok(),
    })
  }

  static aBaseThatConflictsOnTwoFiles() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('2'),
      'merge --no-edit origin/main': failed(),
      'rev-parse --verify --quiet MERGE_HEAD': ok('aaaa'),
      'diff --name-only --diff-filter=U': ok('src/a.js\nsrc/b.js'),
    })
  }

  static aMergeThatGitRefusedToStart() {
    return new GitConversation({
      'fetch origin main': ok(),
      'rev-list --count HEAD..origin/main': ok('2'),
      'merge --no-edit origin/main': failed(),
      'rev-parse --verify --quiet MERGE_HEAD': failed(),
    })
  }
}

describe('BranchReconciliation, al fusionar', () => {
  it('a_base_that_did_not_move_produces_no_merge_commit_and_no_merge_call', () => {
    const git = ConversationMother.aBaseThatDidNotMove()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.UP_TO_DATE)
    expect(git.asked('merge --no-edit')).toBe(false)
  })

  it('a_base_that_moved_is_merged_and_never_rebased_so_the_open_pull_request_keeps_its_hashes', () => {
    const git = ConversationMother.aBaseThatMergesCleanly()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.MERGED)
    expect(git.asked('rebase')).toBe(false)
  })

  it('a_content_conflict_names_the_files_and_leaves_the_merge_alive_for_someone_to_resolve', () => {
    const git = ConversationMother.aBaseThatConflictsOnTwoFiles()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.CONFLICTING)
    expect(round.files).toEqual(['src/a.js', 'src/b.js'])
    expect(git.asked('merge --abort')).toBe(false)
  })

  it('a_merge_that_left_no_merge_head_is_not_a_content_conflict_and_says_so', () => {
    const git = ConversationMother.aMergeThatGitRefusedToStart()
    const round = new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(round.outcome).toBe(ReconcileOutcome.UNMERGEABLE_TREE)
  })

  it('the_classification_of_a_failed_merge_asks_the_tree_and_never_reads_the_error_text', () => {
    const git = ConversationMother.aBaseThatConflictsOnTwoFiles()
    new BranchReconciliation({ git: git.run }).merge({ baseBranch: 'main' })

    expect(git.asked('rev-parse --verify --quiet MERGE_HEAD')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/branch-reconciliation.test.js`
Expected: FAIL con `Failed to load .../scripts/branch-reconciliation.js`

- [ ] **Step 3: Write minimal implementation**

`scripts/branch-reconciliation.js`. Sin comentarios, en inglés, todo colgando de
la clase:

```js
import { ReconcileOutcome, ReconcileRound } from './reconcile-outcome.js'

export class BranchReconciliation {
  constructor({ git }) {
    this.git = git
  }

  merge({ baseBranch }) {
    this.git(['fetch', 'origin', baseBranch])
    const behind = this.git(['rev-list', '--count', `HEAD..origin/${baseBranch}`])
    if (Number(behind.stdout.trim()) === 0) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.UP_TO_DATE, files: [] })
    }
    const merged = this.git(['merge', '--no-edit', `origin/${baseBranch}`])
    if (merged.code === 0) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.MERGED, files: [] })
    }
    if (!this.isMergeInProgress()) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.UNMERGEABLE_TREE, files: [] })
    }
    return ReconcileRound.of({ outcome: ReconcileOutcome.CONFLICTING, files: this.unmergedFiles() })
  }

  isMergeInProgress() {
    return this.git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).code === 0
  }

  unmergedFiles() {
    return this.git(['diff', '--name-only', '--diff-filter=U'])
      .stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/branch-reconciliation.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: See each assertion fail for the reason its name gives**

Quita la guarda de `behind === 0` (cae el primero, y el doble **lanza** con la
petición delante — que es la propiedad que `conventions/testing.md` pide de un
doble de conversación). Añade un `this.git(['merge', '--abort'])` antes de
devolver `CONFLICTING` (cae el tercero). Invierte `isMergeInProgress` (caen el
tercero y el cuarto a la vez). Restaura.

- [ ] **Step 6: Commit**

```bash
git add scripts/branch-reconciliation.js __tests__/branch-reconciliation.test.js
git commit -m "feat: fusionar la base y clasificar su fallo preguntandole al arbol"
```

---

### Task 7: `BranchReconciliation`, la validación y el cierre

**Files:**
- Modify: `scripts/branch-reconciliation.js`
- Modify: `__tests__/branch-reconciliation.test.js`
- Create: `__tests__/branch-reconciliation-real-git.test.js` (lanza subprocesos git de verdad)

**Interfaces:**
- Consumes: lo de Task 6.
- Produces: `conclude() : ReconcileRound` en `BranchReconciliation`.

`conclude()` es la segunda mitad. En este orden:

1. `files = unmergedFiles()`
2. si hay algún fichero modificado en el árbol fuera de `files` →
   `ROUND_DISCARDED` con `TOUCHED_OUTSIDE_THE_CONFLICT`
3. si algún fichero de `files` contiene `<<<<<<<`, `=======` o `>>>>>>>` →
   `ROUND_DISCARDED` con `MARKERS_LEFT`
4. `git add <files>` — **el programa, nunca el agente**
5. si tras el add queda algún fichero en `U` → `ROUND_DISCARDED` con
   `UNRESOLVED_FILES_REMAIN`
6. `git commit --no-edit` → `RESOLVED`

El paso 3 es la comprobación que faltaba en el código que `agentic-skills`
preservó, y sin ella un resolutor que no resuelve concluye la fusión con los
marcadores dentro del commit y devuelve `done`.

El descarte restaura los marcadores con `git checkout --merge -- <files>`: el
merge sigue vivo y no se pierde nada.

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/branch-reconciliation.test.js` un `describe` nuevo con la
madre extendida — cuatro escenarios: resolución limpia, marcadores dentro,
fichero tocado fuera de la lista, y un fichero que sigue en `U` tras el add.
Cada aserción comprueba `round.outcome` y `round.reason`, y que el descarte
llamó a `checkout --merge` y **no** a `commit`.

Y crea `__tests__/branch-reconciliation-real-git.test.js` con un solo test sobre
un repositorio git de verdad, montado con `git` —**nunca** con
`BranchReconciliation`, que es la pieza bajo prueba— que provoca un conflicto
real, escribe una resolución con marcadores dentro y comprueba que `conclude()`
devuelve `ROUND_DISCARDED` con `MARKERS_LEFT` y que **no hay commit de fusión**
en `git log`. Este es el test que pina la lección 4 de la spec contra git real,
y no contra un doble que podría estar de acuerdo con el error.

Usa el patrón de arrange de `__tests__/conventions.test.js`:
`mkdtempSync(join(tmpdir(), 'ct-recon-'))`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/branch-reconciliation.test.js __tests__/branch-reconciliation-real-git.test.js`
Expected: FAIL con `conclude is not a function`

- [ ] **Step 3: Write the implementation**

Añade a la clase, sin comentarios y en inglés:

```js
  conclude() {
    const files = this.unmergedFiles()
    const strayed = this.filesTouchedOutside(files)
    if (strayed.length) return this.discard(files, DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
    if (this.filesStillCarryingMarkers(files).length) return this.discard(files, DiscardReason.MARKERS_LEFT)
    this.git(['add', ...files])
    if (this.unmergedFiles().length) return this.discard(files, DiscardReason.UNRESOLVED_FILES_REMAIN)
    this.git(['commit', '--no-edit'])
    return ReconcileRound.of({ outcome: ReconcileOutcome.RESOLVED, files })
  }

  discard(files, reason) {
    this.git(['checkout', '--merge', '--', ...files])
    return ReconcileRound.discarded({ files, reason })
  }
```

Más `filesTouchedOutside(files)` —lee `git status --porcelain` y descarta los
que están en `files`— y `filesStillCarryingMarkers(files)` —lee cada fichero y
busca las tres marcas—. Los dos cuelgan de la clase, como todo lo demás.
Importa `DiscardReason`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: See each assertion fail for the reason its name gives**

Este paso es **el más importante del plan**, porque las aserciones de esta tarea
son sobre texto y `conventions/testing.md` avisa de que ahí es donde una
aserción se queda verde por motivos que no son el suyo. Uno a uno:

1. Quita el `<<<<<<<` de la lista de marcas que busca
   `filesStillCarryingMarkers` y comprueba que cae el test de marcadores — en el
   de doble **y** en el de git real. Si solo cae uno, el otro es más débil que su
   nombre.
2. Invierte la guarda de `filesTouchedOutside` y comprueba que cae ese test y
   ningún otro.
3. Quita el segundo `unmergedFiles()` (el de después del `add`) y comprueba que
   cae el test de `UNRESOLVED_FILES_REMAIN`.
4. En `discard`, quita el `checkout --merge` y comprueba que cae la aserción que
   dice que el merge sigue vivo.

Restaura cada uno.

- [ ] **Step 6: Commit**

```bash
git add scripts/branch-reconciliation.js __tests__/branch-reconciliation.test.js __tests__/branch-reconciliation-real-git.test.js
git commit -m "feat: una resolucion se valida contra el arbol antes de concluir la fusion"
```

---

## Fase D — el cableado y el resolutor

### Task 8: el verbo `reconcile` en `ct-step`

**Files:**
- Modify: `scripts/ct-step.mjs` — `EXIT`, `VERBO_DE`, `PASOS_DE_SLICE`, `USAGE`, la lista de verbos válidos (`:137`), el mapa de dispatch (`:1562`), `codigoDe`, y una función `verboReconcile` nueva
- Modify: `__tests__/e2e-ct-step.test.js`

**Interfaces:**
- Consumes: `BranchReconciliation` (Tasks 6-7), `outcomeOfReconcile` y
  `STEPS.RECONCILE` (Task 5).
- Produces: el verbo `reconcile`, y `EXIT.RECONCILE_BLOCKED: 13`.

Fichero de deuda declarada: castellano y funciones libres, como su anfitrión.

`verboReconcile` es idempotente. Si `isMergeInProgress()` es falso llama a
`merge({ baseBranch })`; si es verdadero llama a `conclude()`. Mide con
`medir('reconcile', { outcome, files, reason, duration_ms })` —la fila por
intento que `run-metrics.js` ya escribe— y devuelve
`outcomeOfReconcile(round.outcome)`.

Tres cosas que hay que añadir sin olvidar:

- `VERBO_DE.reconcile = STEPS.RECONCILE`, o `exigirPaso` no lo reconoce.
- `STEPS.RECONCILE` a `PASOS_DE_SLICE` (`:190`): es un paso de la slice, no de
  una tarea, así que su fila de telemetría no lleva `task`.
- `codigoDe` gana `case RUN_STATES.BLOCKED_RECONCILE: return EXIT.RECONCILE_BLOCKED`.

**El mensaje del escalado.** Cuando la ronda es `CONFLICTING` y a `run`
**le queda** presupuesto, el verbo imprime la lista de ficheros y pide dispatchar
`ct-reconciler`. Cuando **no** le queda, el mensaje cambia: dice que el
reconciler agotó sus rondas y que le toca al agente del slice, que sí tiene
Bash. Es el escalado, y no es un estado de la tabla: es texto.

Cuando la ronda es `UNMERGEABLE_TREE`, el mensaje va directo al agente del slice
sin mencionar al reconciler: no es un conflicto de contenido, es basura del
propio slice.

- [ ] **Step 1: Write the failing test**

En `__tests__/e2e-ct-step.test.js`, siguiendo el patrón de los tests de verbo
que ya hay: un run que llega a `reconcile` sobre un repositorio con la base sin
mover avanza a `global` sin crear ningún commit; y un `ct-step global` invocado
cuando el paso es `reconcile` sale con `EXIT.WRONG_STEP` nombrando `reconcile`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/e2e-ct-step.test.js`
Expected: FAIL — `verbo desconocido: reconcile`

- [ ] **Step 3: Write the implementation**

Añade `'reconcile'` a la lista de verbos válidos de `:137` y al `USAGE` con su
línea de ayuda. Añade `EXIT.RECONCILE_BLOCKED: 13` con su comentario en el
estilo del bloque. Escribe `verboReconcile` junto a `verboGlobal`, y añádelo al
mapa de dispatch.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. Vigila `__tests__/step-contracts.test.js` y
`__tests__/dist-coherente-con-fuentes.test.js`.

- [ ] **Step 5: See it fail for the reason its name gives**

Quita `reconcile` de `PASOS_DE_SLICE` y comprueba que la fila de telemetría pasa
a llevar un `task` que es mentira. Si ningún test lo caza, **falta un test**:
escríbelo antes de restaurar.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-step.mjs __tests__/e2e-ct-step.test.js
git commit -m "feat: ct-step reconcile, idempotente por MERGE_HEAD"
```

---

### Task 9: `ct-reconciler` y su paquete

**Files:**
- Create: `agents/ct-reconciler.md`
- Modify: `scripts/ct-step.mjs` — `verboReconcile` escribe el paquete
- Modify: `__tests__/skills-fork.test.js` o el que cubra los ficheros de `agents/`

**Interfaces:**
- Consumes: `verboReconcile` de Task 8.
- Produces: `.agent/run-<issue>/reconcile-package-<attempt>.md`.

El frontmatter, hermano de `agents/ct-judge.md` y con la simetría invertida:

```yaml
---
name: ct-reconciler
description: Resolves the content conflicts of one merge in a Control Tower slice worktree. Cannot stage, commit or abort — the program does that after validating the tree. Dispatch it when ct-step reconcile reports a conflict.
tools: Read, Grep, Glob, Edit
---
```

**Sin Bash y sin Write**, y eso es lo que hace que la higiene sea una propiedad
en vez de una comprobación: git no considera resuelto un fichero hasta que
alguien hace `git add`, y el único que puede es el programa.

El cuerpo dice, en inglés como sus hermanos:

- Que no tiene shell, y que eso no es una petición de prudencia sino la
  declaración del agente.
- Qué se le da: los ficheros en conflicto con sus marcadores, **el log de los
  commits que la base trajo** (`git log <merge-base>..origin/<base> --oneline`),
  el `### Desired end state` del plan, y la vara.
- La regla del rol: **conserva las dos intenciones**, no elijas un lado por
  defecto, no toques nada que no sea un fichero en conflicto, y **si no sabes
  resolverlo, dilo en vez de inventar**.
- Que el programa validará el árbol después, y qué tres cosas mira, para que no
  descubra las reglas por descarte.

El paquete lo escribe `verboReconcile` en `workDir`, con el mismo patrón que los
briefs de los jueces, y en el intento con motivo de descarte incluye ese motivo.

- [ ] **Step 1: Write the failing test**

Un test que compruebe que el frontmatter de `agents/ct-reconciler.md` declara
exactamente `Read, Grep, Glob, Edit`, y ni `Bash` ni `Write`. Es el invariante
que sostiene toda la higiene de este diseño, así que va pinado.

Y otro que compruebe que el paquete escrito por `verboReconcile` contiene la
lista de ficheros en conflicto y la línea del log de la base.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — el fichero no existe.

- [ ] **Step 3: Write `agents/ct-reconciler.md` and the package**

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: See it fail for the reason its name gives**

Añade `Bash` a la lista de `tools` y comprueba que el test cae. Restaura.

- [ ] **Step 6: Commit**

```bash
git add agents/ct-reconciler.md scripts/ct-step.mjs __tests__/
git commit -m "feat: ct-reconciler resuelve el conflicto sin poder stagear ni commitear"
```

---

### Task 10: el kickoff nombra el paso

**Files:**
- Modify: `scripts/kickoff.js` — donde nombra los pasos del run
- Modify: `scripts/step-contracts.js` — el contrato del paso nuevo
- Modify: `__tests__/kickoff.test.js`, `__tests__/step-contracts.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

El kickoff es un prompt, no un gate — pero es lo que le dice al agente que
`ct-step next` puede pedirle `reconcile` y que ante un conflicto tiene que
dispatchar `ct-reconciler`. Sin esto el paso existe y nadie sabe invocarlo.

- [ ] **Step 1: Write the failing test**

Un test que compruebe que el texto del kickoff nombra el verbo `reconcile` y el
agente `ct-reconciler`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/kickoff.test.js`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. `__tests__/dist-coherente-con-fuentes.test.js` exige que `dist/`
esté al día — `npm test` corre `npm run build` antes, así que si falla, es que
hay que commitear `dist/`.

- [ ] **Step 5: Commit**

```bash
git add scripts/kickoff.js scripts/step-contracts.js dist/ __tests__/
git commit -m "feat: el kickoff nombra el paso reconcile y a quien lo resuelve"
```

---

## Self-review de este plan

**Cobertura de la spec.** Cada sección tiene tarea: la referencia de medida
(Tasks 1-3), el paso y su política (Tasks 4-5), la mecánica de git y sus dos
mitades (Tasks 6-7), el cableado y la telemetría (Task 8), el resolutor y su
paquete (Task 9), el kickoff (Task 10). La validación post-hoc del commit de
fusión —el límite declarado de que el agente del slice puede saltarse la
puerta— cae en `verboReconcile` (Task 8), en la rama de `UP_TO_DATE`.

**Consistencia de tipos.** `SliceBase.measurementSha({ baseBranch, fallbackSha })`
se usa con esa firma en Tasks 2 y 3. `ReconcileRound.of({ outcome, files })` y
`ReconcileRound.discarded({ files, reason })` se construyen así en Tasks 6 y 7 y
se leen así en Task 8. `outcomeOfReconcile` se define en Task 5 y se consume en
Task 8. El contrato de `git` difiere a propósito entre `SliceBase`
(`string | null`) y `BranchReconciliation` (`{ code, stdout }`): la primera solo
necesita saber si resolvió, la segunda necesita el código de salida como dato.

**Lo que este plan NO hace, y la spec tampoco:** cerrar la ventana entre
`reconcile` y `gh pr create`, y cubrir la reanudación de un slice parado.
Los dos están declarados como límites en la spec.
