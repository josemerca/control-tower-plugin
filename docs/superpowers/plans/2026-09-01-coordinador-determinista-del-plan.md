# Coordinador determinista de la sesión de plan — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un caso de uso del backend prepare un worktree, componga el informe de arranque y abra en cmux una sesión de Claude Code que escriba el plan del slice, y que el backend sepa —sondeando— cuándo ese plan está válido y commiteado.

**Architecture:** Hexagonal. El caso de uso `StartPlan` conduce cuatro puertos (`tickets`, `planIssues`, `workspace`, `planSession`) y no sabe que hay subprocesos al otro lado. Todo lo que cmux tiene de frágil —que `--command` teclea en vez de ejecutar— vive dentro de su adaptador. La detección de "plan hecho" es un predicado sobre hechos verificables, consultado por sondeo.

**Tech Stack:** Node >= 24, ESM, express 5, vitest 4. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-01-coordinador-determinista-del-plan-design.md`

## Global Constraints

- **Ningún comentario ni prosa en el código de `backend/`.** `__tests__/yardstick.test.js` falla si un fichero medido contiene `//`, `/*` o una línea que empiece por `*`. Los nombres explican; no hay excepción.
- **Toda función cuelga de un tipo.** Nada de `function foo()` ni `const foo = () =>` en el nivel de módulo: métodos de clase, estáticos o de instancia.
- **Identificadores en inglés.** El guardián rechaza los de `Yardstick.SPANISH_WORDS` (`ruta`, `fichero`, `puerto`, `texto`, `nombre`, `campo`, `clave`, `prueba`, `paso`, `regla`, `respuesta`, `peticion`, `arranque`, `alcance`, `cuerpo`, `comentario`, entre otros). Dentro de una cadena sí puede ir castellano.
- **Nombres de test en inglés y en snake_case**, como los que ya hay: `the_handle_the_session_answers_is_what_the_caller_gets_back`.
- **Un concepto por módulo.** Un tipo con vida propia va a su fichero aunque hoy sólo se use al lado de otro.
- **Value objects congelados** con `Object.freeze(this)` y validación en el constructor, como `TicketKey` y `RepositoryName`.
- **Los tests viven en `backend/__tests__/`**, espejando `src/`.
- Comando de medida: `cd backend && npm test`.

### Lo que este plan asume de `alcaptar/start-plan-crea-el-issue`

Ese trabajo se mergea **antes** de empezar, y todavía puede cambiar. Estas son las firmas exactas de las que dependen las tareas 6, 7 y 8; si alguna cambia, el arreglo está acotado a la tarea que la nombra.

| Qué | Firma asumida |
|---|---|
| `domain/plan-issue.js` | `new PlanIssue({ number, url })`, `number` entero >= 1 |
| `domain/repository-name.js` | `new RepositoryName(text)`, con `.text` |
| `infrastructure/tool-runner.js` | `new ToolRunner({ bin, budgetMs })`, `run(argv) -> ProcessOutput { code, stdout, stderr, failed }` |
| `application/actions/start-plan.js` | `StartPlan` con `{ tickets, planIssues, planSession }`, `execute(params)` encadena `tickets.detail` → `planIssues.open` → `planSession.start` |
| `StartPlanParams` | `{ ticket, repository }` |
| `domain/plan-session.js` | `start({ ticket, issue })` |

**Las tareas 1 a 5 no tocan ninguno de esos ficheros** y se pueden hacer antes del merge.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/domain/workspace-location.js` | dónde quedó el espacio aislado: su directorio y su rama |
| `src/domain/workspace.js` | puerto: preparar el espacio aislado de un issue |
| `src/domain/plan-briefing.js` | lo que hace falta para arrancar una sesión: ticket, issue, sitio y el encargo |
| `src/domain/plan-state.js` | vocabulario cerrado del estado del plan |
| `src/domain/plan-progress.js` | puerto: en qué estado está el plan de un espacio de trabajo |
| `src/domain/exceptions.js` | *(modificar)* crece con los fallos del espacio de trabajo |
| `src/infrastructure/slice-seed.js` | el contenido de `.agent/SLICE.md` que el plugin lee al arrancar la sesión |
| `src/infrastructure/git-workspace.js` | adaptador de `Workspace`: worktree, exclusión y siembra |
| `src/infrastructure/plan-agent-brief.js` | el encargo que recibe el agente: qué lee, qué escribe, dónde para |
| `src/infrastructure/shell-word.js` | entrecomillado para lo que se teclea en un shell |
| `src/infrastructure/cmux-launcher.js` | el script que se sourcea y el centinela que prueba que corrió |
| `src/infrastructure/cmux-plan-session.js` | *(modificar)* arranca de verdad al agente en vez de un `echo` |
| `src/infrastructure/plan-contract-progress.js` | adaptador de `PlanProgress`: el predicado |
| `src/application/queries/read-plan-progress.js` | caso de uso de lectura del estado |
| `src/infrastructure/plan-events.js` | el flujo de Server-Sent Events |
| `src/infrastructure/api-server.js` | *(modificar)* la ruta de eventos y el mapeo del fallo nuevo |
| `src/infrastructure/ct-api.mjs` | *(modificar)* composición de los adaptadores nuevos |

---

## Task 1: El sitio donde se trabaja

**Files:**
- Create: `backend/src/domain/workspace-location.js`
- Create: `backend/src/domain/workspace.js`
- Modify: `backend/src/domain/exceptions.js`
- Test: `backend/__tests__/domain/workspace-location.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `new WorkspaceLocation({ path, branch })` con `.path` y `.branch`; `Workspace` con `async prepare(issue) -> WorkspaceLocation`; `WorkspaceFailure` y `WorkspaceNotPrepared` extendiendo `Error`.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/domain/workspace-location.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'
import { Workspace } from '../../src/domain/workspace.js'

describe('WorkspaceLocation', () => {
  it('it_carries_the_directory_and_the_branch_together_because_neither_is_usable_alone', () => {
    const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })

    expect(located.path).toBe('/repo/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })

  it('it_cannot_be_edited_after_it_is_built', () => {
    expect(Object.isFrozen(new WorkspaceLocation({ path: '/a', branch: 'b' }))).toBe(true)
  })

  it('a_location_without_a_directory_refuses_to_exist_instead_of_answering_undefined_later', () => {
    expect(() => new WorkspaceLocation({ path: '', branch: 'feat/42' })).toThrow(/directory/)
  })

  it('a_location_without_a_branch_refuses_to_exist_because_nothing_could_be_committed_to_it', () => {
    expect(() => new WorkspaceLocation({ path: '/a', branch: '' })).toThrow(/branch/)
  })
})

describe('Workspace', () => {
  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new Workspace().prepare({ number: 42 })).rejects.toThrow(/must implement prepare/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run __tests__/domain/workspace-location.test.js`
Expected: FAIL — `Failed to resolve import ... workspace-location.js`

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/domain/workspace-location.js`:

```js
export class WorkspaceLocation {
  constructor({ path, branch }) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`a workspace lives in a directory, got ${JSON.stringify(path)}`)
    }
    if (typeof branch !== 'string' || branch.length === 0) {
      throw new Error(`a workspace commits to a branch, got ${JSON.stringify(branch)}`)
    }
    this.path = path
    this.branch = branch
    Object.freeze(this)
  }
}
```

Create `backend/src/domain/workspace.js`:

```js
export class Workspace {
  async prepare(issue) {
    throw new Error(`${this.constructor.name} must implement prepare(issue), asked for ${issue?.number}`)
  }
}
```

Append to `backend/src/domain/exceptions.js`:

```js
export class WorkspaceFailure extends Error {
  constructor(reason) {
    super(reason)
    this.name = new.target.name
  }
}

export class WorkspaceNotPrepared extends WorkspaceFailure {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run __tests__/domain/workspace-location.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Run the whole suite so the yardstick measures the new files**

Run: `cd backend && npm test`
Expected: PASS. Si falla `explains itself with names instead of prose`, hay un comentario en un fichero nuevo: bórralo.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/workspace-location.js backend/src/domain/workspace.js backend/src/domain/exceptions.js backend/__tests__/domain/workspace-location.test.js
git commit -m "feat(workspace): el sitio aislado donde la sesión de plan trabaja"
```

---

## Task 2: El worktree

**Files:**
- Create: `backend/src/infrastructure/git-workspace.js`
- Test: `backend/__tests__/infrastructure/git-workspace.test.js`

**Interfaces:**
- Consumes: `WorkspaceLocation`, `Workspace`, `WorkspaceNotPrepared` de la tarea 1.
- Produces: `new GitWorkspace({ run, root, base })` con `run(argv) -> Promise<{ failed, stdout, stderr }>`; `GitWorkspace.BIN === 'git'`; `GitWorkspace.branchFor(issue)`; `GitWorkspace.pathFor(root, issue)`; `async prepare(issue) -> WorkspaceLocation`.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/git-workspace.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { GitWorkspace } from '../../src/infrastructure/git-workspace.js'
import { WorkspaceNotPrepared } from '../../src/domain/exceptions.js'

class GitDouble {
  static ROOT = '/repo/checkout'
  static BASE = 'main'

  constructor(answer) {
    this.answer = answer
    this.calls = []
  }

  workspace() {
    return new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      run: (argv) => {
        this.calls.push(argv)
        return Promise.resolve(this.answer)
      },
    })
  }

  static ok() {
    return { failed: false, stdout: '', stderr: '' }
  }

  static refused(stderr) {
    return { failed: true, stdout: '', stderr }
  }
}

describe('GitWorkspace', () => {
  it('it_cuts_the_branch_from_the_remote_base_so_the_session_starts_from_what_is_published', async () => {
    const git = new GitDouble(GitDouble.ok())

    await git.workspace().prepare({ number: 42 })

    expect(git.calls).toEqual([[
      '-C', '/repo/checkout',
      'worktree', 'add',
      '-b', 'feat/42',
      '/repo/checkout/.worktrees/42',
      'origin/main',
    ]])
  })

  it('the_location_it_answers_is_where_the_session_will_actually_run', async () => {
    const located = await new GitDouble(GitDouble.ok()).workspace().prepare({ number: 42 })

    expect(located.path).toBe('/repo/checkout/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })

  it('a_git_that_refuses_travels_out_typed_carrying_what_git_said', async () => {
    const git = new GitDouble(GitDouble.refused("fatal: 'feat/42' is already checked out"))

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain("fatal: 'feat/42' is already checked out")
  })

  it('it_never_reuses_a_directory_it_did_not_create_because_git_is_the_one_that_refuses', async () => {
    const git = new GitDouble(GitDouble.refused('fatal: destination path already exists'))

    await expect(git.workspace().prepare({ number: 7 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run __tests__/infrastructure/git-workspace.test.js`
Expected: FAIL — `Failed to resolve import ... git-workspace.js`

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/infrastructure/git-workspace.js`:

```js
import { Workspace } from '../domain/workspace.js'
import { WorkspaceLocation } from '../domain/workspace-location.js'
import { WorkspaceNotPrepared } from '../domain/exceptions.js'

export class GitWorkspace extends Workspace {
  static BIN = 'git'
  static DIRECTORY = '.worktrees'

  constructor({ run, root, base }) {
    super()
    this.run = run
    this.root = root
    this.base = base
  }

  static branchFor(issue) {
    return `feat/${issue.number}`
  }

  static pathFor(root, issue) {
    return `${root}/${GitWorkspace.DIRECTORY}/${issue.number}`
  }

  static argvFor({ root, base, issue }) {
    return [
      '-C', root,
      'worktree', 'add',
      '-b', GitWorkspace.branchFor(issue),
      GitWorkspace.pathFor(root, issue),
      `origin/${base}`,
    ]
  }

  async prepare(issue) {
    const argv = GitWorkspace.argvFor({ root: this.root, base: this.base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }

    return new WorkspaceLocation({
      path: GitWorkspace.pathFor(this.root, issue),
      branch: GitWorkspace.branchFor(issue),
    })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run __tests__/infrastructure/git-workspace.test.js`
Expected: PASS, 4 tests

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/git-workspace.js backend/__tests__/infrastructure/git-workspace.test.js
git commit -m "feat(workspace): el worktree se corta de origin/<base>, como hace el dispatcher"
```

---

## Task 3: La siembra que le dice a la sesión quién es

Sin este fichero, el hook `SessionStart` del plugin cae al `.agent/STATE.md` trackeado que venía en la base —que es el estado de la coordinadora— y la sesión de plan arranca creyendo que ella es la coordinadora. La precedencia está en `plugin/scripts/state-paths.js:58`.

**Files:**
- Create: `backend/src/infrastructure/slice-seed.js`
- Modify: `backend/src/infrastructure/git-workspace.js`
- Test: `backend/__tests__/infrastructure/slice-seed.test.js`
- Test: `backend/__tests__/infrastructure/git-workspace.test.js` (añadir)

**Interfaces:**
- Consumes: `GitWorkspace` de la tarea 2.
- Produces: `SliceSeed.RELATIVE_PATH === '.agent/SLICE.md'`; `SliceSeed.EXCLUDE_PATH === '.git/info/exclude'`; `SliceSeed.textFor({ issue, branch, base, cut })`; `GitWorkspace` pasa a recibir también `{ write }` con `write(path, text) -> Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/slice-seed.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { SliceSeed } from '../../src/infrastructure/slice-seed.js'

describe('SliceSeed', () => {
  const seeded = () => SliceSeed.textFor({ issue: { number: 42 }, branch: 'feat/42', base: 'main', cut: 'a1b2c3d' })

  it('it_opens_with_a_frontmatter_the_plugin_hook_can_parse', () => {
    expect(seeded().startsWith('---\n')).toBe(true)
    expect(seeded()).toContain('\n---\n')
  })

  it('it_says_the_session_is_the_one_that_writes_the_plan_and_not_the_coordinator', () => {
    expect(seeded()).toContain('role: "slice-agent')
  })

  it('the_cut_travels_as_both_the_base_and_the_last_commit_because_no_work_has_landed_yet', () => {
    expect(seeded()).toContain('base_sha: "a1b2c3d"')
    expect(seeded()).toContain('last_commit: "a1b2c3d"')
  })

  it('it_declares_that_nothing_is_blocked_instead_of_leaving_the_field_out', () => {
    expect(seeded()).toContain('blocked: null')
  })

  it('it_names_the_issue_so_a_session_that_rehydrates_knows_what_it_is_working_on', () => {
    expect(seeded()).toContain('github_issue: 42')
    expect(seeded()).toContain('branch: "feat/42"')
    expect(seeded()).toContain('base: "main"')
  })

  it('the_rule_it_asks_git_to_ignore_is_the_very_file_it_writes', () => {
    expect(SliceSeed.EXCLUDE_RULE).toBe(SliceSeed.RELATIVE_PATH)
  })

  it('the_exclude_file_hangs_off_the_git_dir_and_not_off_the_worktree_because_dot_git_is_a_file_there', () => {
    expect(SliceSeed.EXCLUDE_PATH.startsWith('.git/')).toBe(false)
    expect(SliceSeed.EXCLUDE_PATH).toBe('info/exclude')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run __tests__/infrastructure/slice-seed.test.js`
Expected: FAIL — `Failed to resolve import ... slice-seed.js`

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/infrastructure/slice-seed.js`:

```js
export class SliceSeed {
  static RELATIVE_PATH = '.agent/SLICE.md'
  static DIRECTORY = '.agent'
  static EXCLUDE_PATH = 'info/exclude'
  static EXCLUDE_RULE = SliceSeed.RELATIVE_PATH

  static textFor({ issue, branch, base, cut }) {
    return [
      '---',
      `task: "escribir el plan del issue #${issue.number}"`,
      'role: "slice-agent: escribes el plan de este slice contra el código real y PARAS. No implementas nada."',
      'status: in_progress',
      `branch: "${branch}"`,
      `base: "${base}"`,
      `base_sha: "${cut}"`,
      `last_commit: "${cut}"`,
      `github_issue: ${issue.number}`,
      'you_are_here: "worktree recién cortado, sin trabajo encima"',
      'next_action: "escribe el plan prescriptivo, valídalo con --check-plan, commitéalo y para"',
      'blocked: null',
      '---',
      '',
      `Estado del slice del issue #${issue.number}. Lo sembró el backend de Control Tower al abrir esta sesión.`,
      '',
      'Este fichero está fuera de la vista de git a propósito: no puede entrar en el pull request.',
      '',
    ].join('\n')
  }
}
```

Modify `backend/src/infrastructure/git-workspace.js` — el constructor recibe `write`, y `prepare` siembra después de excluir:

```js
import { Workspace } from '../domain/workspace.js'
import { WorkspaceLocation } from '../domain/workspace-location.js'
import { WorkspaceNotPrepared } from '../domain/exceptions.js'
import { SliceSeed } from './slice-seed.js'

export class GitWorkspace extends Workspace {
  static BIN = 'git'
  static DIRECTORY = '.worktrees'

  constructor({ run, write, root, base }) {
    super()
    this.run = run
    this.write = write
    this.root = root
    this.base = base
  }

  static branchFor(issue) {
    return `feat/${issue.number}`
  }

  static pathFor(root, issue) {
    return `${root}/${GitWorkspace.DIRECTORY}/${issue.number}`
  }

  static argvFor({ root, base, issue }) {
    return [
      '-C', root,
      'worktree', 'add',
      '-b', GitWorkspace.branchFor(issue),
      GitWorkspace.pathFor(root, issue),
      `origin/${base}`,
    ]
  }

  static cutArgvFor(path) {
    return ['-C', path, 'rev-parse', 'HEAD']
  }

  static gitDirArgvFor(path) {
    return ['-C', path, 'rev-parse', '--absolute-git-dir']
  }

  async prepare(issue) {
    const path = GitWorkspace.pathFor(this.root, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(issue)
    const located = new WorkspaceLocation({ path, branch })
    await this.#seed(located, issue)

    return located
  }

  async #cut(issue) {
    const argv = GitWorkspace.argvFor({ root: this.root, base: this.base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }
  }

  async #seed(located, issue) {
    await this.write(`${await this.#gitDirOf(located)}/${SliceSeed.EXCLUDE_PATH}`, `${SliceSeed.EXCLUDE_RULE}\n`)
    const measured = await this.run(GitWorkspace.cutArgvFor(located.path))
    const cut = measured.failed ? '' : measured.stdout.trim()
    await this.write(
      `${located.path}/${SliceSeed.RELATIVE_PATH}`,
      SliceSeed.textFor({ issue, branch: located.branch, base: this.base, cut })
    )
  }

  async #gitDirOf(located) {
    const asked = await this.run(GitWorkspace.gitDirArgvFor(located.path))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `no se pudo resolver el git dir de ${located.path}, así que ${SliceSeed.RELATIVE_PATH} quedaría visible para git: ${asked.stderr.trim()}`
      )
    }

    return asked.stdout.trim()
  }
}
```

- [ ] **Step 4: Update the Task 2 tests for the new constructor**

En `backend/__tests__/infrastructure/git-workspace.test.js`, `GitDouble` gana un escritor y el aserto de la primera prueba pasa a mirar sólo la primera llamada:

```js
class GitDouble {
  static ROOT = '/repo/checkout'
  static BASE = 'main'
  static CUT = 'a1b2c3d'
  static GIT_DIR = '/repo/checkout/.git/worktrees/42'

  constructor(answer) {
    this.answer = answer
    this.calls = []
    this.written = []
  }

  workspace() {
    return new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      write: (path, text) => {
        this.written.push([path, text])
        return Promise.resolve()
      },
      run: (argv) => {
        this.calls.push(argv)
        if (argv.includes('--absolute-git-dir')) {
          return Promise.resolve({ failed: false, stdout: `${GitDouble.GIT_DIR}\n`, stderr: '' })
        }
        if (argv.includes('rev-parse')) {
          return Promise.resolve({ failed: false, stdout: `${GitDouble.CUT}\n`, stderr: '' })
        }
        return Promise.resolve(this.answer)
      },
    })
  }

  static ok() {
    return { failed: false, stdout: '', stderr: '' }
  }

  static refused(stderr) {
    return { failed: true, stdout: '', stderr }
  }
}
```

Cambia el primer aserto de `expect(git.calls).toEqual([[...]])` a `expect(git.calls[0]).toEqual([...])`, y añade dos pruebas:

```js
  it('the_rule_that_hides_the_state_is_written_before_the_state_itself', async () => {
    const git = new GitDouble(GitDouble.ok())

    await git.workspace().prepare({ number: 42 })

    expect(git.written.map(([path]) => path)).toEqual([
      '/repo/checkout/.git/worktrees/42/info/exclude',
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('a_git_dir_it_cannot_resolve_stops_the_seeding_because_the_state_would_be_visible_to_git', async () => {
    const git = new GitDouble(GitDouble.ok())
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      write: () => Promise.resolve(),
      run: (argv) => Promise.resolve(argv.includes('--absolute-git-dir')
        ? { failed: true, stdout: '', stderr: 'not a git repository' }
        : GitDouble.ok()),
    })

    await expect(git.workspace().prepare({ number: 42 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_state_it_seeds_carries_the_cut_it_measured_in_the_worktree_and_not_the_one_it_guessed', async () => {
    const git = new GitDouble(GitDouble.ok())

    await git.workspace().prepare({ number: 42 })

    expect(git.written[1][1]).toContain('base_sha: "a1b2c3d"')
  })
```

- [ ] **Step 5: Run both test files to verify they pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/slice-seed.test.js __tests__/infrastructure/git-workspace.test.js`
Expected: PASS, 12 tests

- [ ] **Step 6: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/slice-seed.js backend/src/infrastructure/git-workspace.js backend/__tests__/infrastructure/slice-seed.test.js backend/__tests__/infrastructure/git-workspace.test.js
git commit -m "feat(workspace): la semilla que le dice a la sesión que es un slice y no la coordinadora"
```

---

## Task 4: El encargo que recibe el agente

**Files:**
- Create: `backend/src/domain/plan-briefing.js`
- Create: `backend/src/infrastructure/plan-agent-brief.js`
- Test: `backend/__tests__/domain/plan-briefing.test.js`
- Test: `backend/__tests__/infrastructure/plan-agent-brief.test.js`

**Interfaces:**
- Consumes: `WorkspaceLocation` de la tarea 1.
- Produces: `new PlanBriefing({ ticket, issue, located, errand })` con `.ticket`, `.issue`, `.located`, `.errand`; `PlanAgentBrief.errandFor({ issue, repository, dispatchCheck, conventions })`.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/domain/plan-briefing.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { PlanBriefing } from '../../src/domain/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'
import { TicketKey } from '../../src/domain/ticket-key.js'

describe('PlanBriefing', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const built = (errand = 'escribe el plan') =>
    new PlanBriefing({ ticket: new TicketKey('ABC-42'), issue: { number: 42 }, located, errand })

  it('it_carries_where_to_run_and_what_to_ask_for_because_a_session_needs_both', () => {
    expect(built().located.path).toBe('/repo/.worktrees/42')
    expect(built().errand).toBe('escribe el plan')
  })

  it('it_keeps_the_ticket_whole_so_the_tab_can_be_named_after_it', () => {
    expect(String(built().ticket)).toBe('ABC-42')
  })

  it('it_cannot_be_edited_after_it_is_built', () => {
    expect(Object.isFrozen(built())).toBe(true)
  })

  it('an_errand_with_nothing_in_it_refuses_to_exist_because_the_session_would_start_idle', () => {
    expect(() => built('   ')).toThrow(/errand/)
  })
})
```

Create `backend/__tests__/infrastructure/plan-agent-brief.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.js'

describe('PlanAgentBrief', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
  }).errandFor({ issue: { number: 42 }, repository: 'owner/name' })

  it('it_starts_by_asking_for_the_ground_to_be_checked_before_anything_is_touched', () => {
    expect(errand()).toMatch(/pwd/)
    expect(errand()).toMatch(/baseline/)
  })

  it('it_names_the_skill_that_writes_the_plan_instead_of_describing_the_shape_of_one', () => {
    expect(errand()).toContain('control-tower-loop:writing-plans-prescriptive')
  })

  it('it_interpolates_the_absolute_path_of_dispatch_check_because_the_plugin_token_stays_literal_in_plain_text', () => {
    expect(errand()).toContain('node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --check-plan')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('it_says_where_the_plan_file_goes_so_the_contract_can_find_it_by_name', () => {
    expect(errand()).toContain('docs/superpowers/plans/YYYY-MM-DD-issue-42-<slug>.md')
  })

  it('it_orders_the_session_to_stop_after_committing_instead_of_starting_the_work', () => {
    expect(errand()).toMatch(/PARA/)
    expect(errand()).toMatch(/no implementes/i)
  })

  it('it_never_promises_a_permission_nobody_mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
  })

  it('a_brief_without_the_paths_it_interpolates_refuses_to_exist_instead_of_shipping_the_word_undefined', () => {
    expect(() => new PlanAgentBrief({ conventions: '/plugin/conventions' })).toThrow(/dispatch-check/)
    expect(() => new PlanAgentBrief({ dispatchCheck: '/x' })).toThrow(/yardstick/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/domain/plan-briefing.test.js __tests__/infrastructure/plan-agent-brief.test.js`
Expected: FAIL — imports no resueltos

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/domain/plan-briefing.js`:

```js
export class PlanBriefing {
  constructor({ ticket, issue, located, errand }) {
    if (typeof errand !== 'string' || errand.trim().length === 0) {
      throw new Error(`a briefing carries an errand, got ${JSON.stringify(errand)}`)
    }
    this.ticket = ticket
    this.issue = issue
    this.located = located
    this.errand = errand
    Object.freeze(this)
  }
}
```

Create `backend/src/infrastructure/plan-agent-brief.js`:

```js
export class PlanAgentBrief {
  static DOCUMENTS = 'defects.md, style.md, decisions.md, architecture.md, testing.md'

  constructor({ dispatchCheck, conventions }) {
    if (typeof dispatchCheck !== 'string' || dispatchCheck.length === 0) {
      throw new Error(`the errand names dispatch-check by absolute path, got ${JSON.stringify(dispatchCheck)}`)
    }
    if (typeof conventions !== 'string' || conventions.length === 0) {
      throw new Error(`the errand names where the yardstick lives, got ${JSON.stringify(conventions)}`)
    }
    this.dispatchCheck = dispatchCheck
    this.conventions = conventions
    Object.freeze(this)
  }

  errandFor({ issue, repository }) {
    const dispatchCheck = this.dispatchCheck
    const conventions = this.conventions

    return [
      `Escribes el PLAN del issue #${issue.number} del repo ${repository}. No lo implementas.`,
      'Arranque verification-first: confirma pwd, rama y git log, y deja el baseline en verde ANTES de tocar nada.',
      `Hidrátate del issue: \`gh issue view ${issue.number} --repo ${repository}\`. Sus criterios de aceptación, su sección "## Out of scope / Protected" y sus decisiones congeladas son la entrada del plan.`,
      `Lee la vara de Control Tower: los cinco documentos de ${conventions} (${PlanAgentBrief.DOCUMENTS}). Tienen preferencia sobre las convenciones de este repo, y la preferencia se mide regla a regla: donde el repo mande lo que uno de esos documentos prohíbe, no aplica; donde el repo hable de algo de lo que ninguno habla, obliga entera.`,
      'Escribe el plan con control-tower-loop:writing-plans-prescriptive, usando el issue como spec.',
      `Guárdalo como docs/superpowers/plans/YYYY-MM-DD-issue-${issue.number}-<slug>.md.`,
      `Valídalo con \`node ${dispatchCheck} ${issue.number} --repo ${repository} --check-plan\` hasta exit 0.`,
      'Commitéalo: el plan viaja en el pull request, y sin commitear no cuenta como escrito.',
      'Y entonces PARA. No implementes nada, no abras pull request, no mergees, no crees worktrees nuevos: ya estás en el que te prepararon.',
    ].join('\n')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/domain/plan-briefing.test.js __tests__/infrastructure/plan-agent-brief.test.js`
Expected: PASS, 11 tests

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/plan-briefing.js backend/src/infrastructure/plan-agent-brief.js backend/__tests__/domain/plan-briefing.test.js backend/__tests__/infrastructure/plan-agent-brief.test.js
git commit -m "feat(brief): el encargo del agente, sin prometer un permiso que nadie acuña"
```

---

## Task 5: El lanzador y su centinela

`cmux new-workspace --command` **no ejecuta: teclea**. La ayuda embebida del binario lo dice —*"Send text+Enter to the new workspace after creation"*— y la avería está medida en `plugin/scripts/launch-sentinel.js`: el aviso de oh-my-zsh se comió una letra y quedó `command not found: laude`. Esta tarea es lógica pura: construir el script y leer el centinela. La entrada/salida es de la tarea 6.

**Files:**
- Create: `backend/src/infrastructure/shell-word.js`
- Create: `backend/src/infrastructure/cmux-launcher.js`
- Test: `backend/__tests__/infrastructure/shell-word.test.js`
- Test: `backend/__tests__/infrastructure/cmux-launcher.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `ShellWord.quote(text)`; `CmuxLauncher.SCRIPT_NAME === 'launch.sh'`; `CmuxLauncher.SENTINEL_NAME === 'started'`; `CmuxLauncher.MAGIC`; `CmuxLauncher.scriptFor({ sentinel, errand, bin })`; `CmuxLauncher.typedFor(script)`; `CmuxLauncher.read(text) -> { resolved, cwd } | null`.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/shell-word.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { ShellWord } from '../../src/infrastructure/shell-word.js'

describe('ShellWord', () => {
  it('a_plain_word_comes_back_wrapped_so_a_space_added_later_cannot_split_it', () => {
    expect(ShellWord.quote('/tmp/launch.sh')).toBe("'/tmp/launch.sh'")
  })

  it('a_single_quote_inside_is_closed_and_reopened_instead_of_ending_the_word', () => {
    expect(ShellWord.quote("it's")).toBe("'it'\\''s'")
  })

  it('what_a_shell_would_expand_travels_literal', () => {
    expect(ShellWord.quote('$HOME `id` "x"')).toBe('\'$HOME `id` "x"\'')
  })
})
```

Create `backend/__tests__/infrastructure/cmux-launcher.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { CmuxLauncher } from '../../src/infrastructure/cmux-launcher.js'

describe('CmuxLauncher', () => {
  const script = () => CmuxLauncher.scriptFor({
    sentinel: '/tmp/run/started',
    errand: 'escribe el plan',
    bin: 'claude',
  })

  it('what_gets_typed_is_short_because_every_character_races_the_login_shell', () => {
    expect(CmuxLauncher.typedFor('/tmp/run/launch.sh')).toBe(". '/tmp/run/launch.sh'")
    expect(CmuxLauncher.typedFor('/tmp/run/launch.sh').length).toBeLessThan(120)
  })

  it('the_sentinel_is_written_before_the_agent_starts_because_waiting_for_it_to_finish_is_the_thing_we_cannot_do', () => {
    const written = script().indexOf('> ')
    const started = script().indexOf("claude '")

    expect(written).toBeGreaterThan(-1)
    expect(started).toBeGreaterThan(-1)
    expect(written).toBeLessThan(started)
  })

  it('a_second_sourcing_starts_nothing_because_the_line_gets_resent_when_the_pty_eats_it', () => {
    expect(script()).toContain("if [ -e '/tmp/run/started' ]; then")
  })

  it('it_records_whether_the_binary_resolves_inside_that_shell_which_is_the_only_place_it_can_be_asked', () => {
    expect(script()).toContain('command -v claude')
  })

  it('the_errand_travels_through_the_file_so_no_prompt_can_bite_it', () => {
    expect(script()).toContain('escribe el plan')
  })

  it('a_sentinel_it_wrote_reads_back_as_a_started_command', () => {
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tok\t/repo/.worktrees/42\n`)).toEqual({
      resolved: true,
      cwd: '/repo/.worktrees/42',
    })
  })

  it('a_sentinel_that_says_the_binary_was_missing_is_read_as_such_and_not_as_absent', () => {
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tmissing\t/repo/x\n`).resolved).toBe(false)
  })

  it('anything_that_is_not_one_of_ours_reads_as_nothing_instead_of_being_guessed', () => {
    expect(CmuxLauncher.read('')).toBe(null)
    expect(CmuxLauncher.read('garbage')).toBe(null)
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t9\tok\t/repo/x`)).toBe(null)
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tmaybe\t/repo/x`)).toBe(null)
  })

  it('a_directory_with_a_tab_in_it_survives_because_it_is_the_last_field', () => {
    expect(CmuxLauncher.read(`${CmuxLauncher.MAGIC}\t1\tok\t/repo/od\td\n`).cwd).toBe('/repo/od\td')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/infrastructure/shell-word.test.js __tests__/infrastructure/cmux-launcher.test.js`
Expected: FAIL — imports no resueltos

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/infrastructure/shell-word.js`:

```js
export class ShellWord {
  static quote(text) {
    return `'${String(text).split("'").join("'\\''")}'`
  }
}
```

Create `backend/src/infrastructure/cmux-launcher.js`:

```js
import { ShellWord } from './shell-word.js'

export class CmuxLauncher {
  static SCRIPT_NAME = 'launch.sh'
  static SENTINEL_NAME = 'started'
  static MAGIC = 'ct-plan-launch'
  static VERSION = '1'
  static RESOLVED = 'ok'
  static MISSING = 'missing'

  static typedFor(script) {
    return `. ${ShellWord.quote(script)}`
  }

  static scriptFor({ sentinel, errand, bin }) {
    const quoted = ShellWord.quote(sentinel)

    return [
      '#!/bin/sh',
      `if [ -e ${quoted} ]; then`,
      `  printf '%s\\n' 'ct-plan: la sesión ya arrancó; este sourceo no relanza nada.'`,
      'else',
      `  if command -v ${bin} >/dev/null 2>&1; then ct_plan_bin=${CmuxLauncher.RESOLVED}; else ct_plan_bin=${CmuxLauncher.MISSING}; fi`,
      `  printf '%s\\t%s\\t%s\\t%s\\n' ${ShellWord.quote(CmuxLauncher.MAGIC)} ${ShellWord.quote(CmuxLauncher.VERSION)} "$ct_plan_bin" "$PWD" > ${quoted}`,
      '  unset ct_plan_bin',
      `  ${bin} ${ShellWord.quote(errand)}`,
      'fi',
      '',
    ].join('\n')
  }

  static read(text) {
    const line = String(text ?? '').split('\n').find((each) => each.trim().length > 0)
    if (line === undefined) return null
    const fields = line.replace(/\r$/, '').split('\t')
    if (fields.length < 4) return null
    const [magic, version, resolved] = fields
    if (magic !== CmuxLauncher.MAGIC) return null
    if (version !== CmuxLauncher.VERSION) return null
    if (resolved !== CmuxLauncher.RESOLVED && resolved !== CmuxLauncher.MISSING) return null
    const cwd = fields.slice(3).join('\t')
    if (cwd.length === 0) return null

    return { resolved: resolved === CmuxLauncher.RESOLVED, cwd }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/infrastructure/shell-word.test.js __tests__/infrastructure/cmux-launcher.test.js`
Expected: PASS, 13 tests

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/shell-word.js backend/src/infrastructure/cmux-launcher.js backend/__tests__/infrastructure/shell-word.test.js backend/__tests__/infrastructure/cmux-launcher.test.js
git commit -m "feat(cmux): el lanzador y el centinela que prueba que la orden se ejecutó"
```

---

## Task 6: La sesión arranca de verdad

Sustituye el `--command echo "..."` por el arranque real. **Toca `cmux-plan-session.js`, que la otra rama también cambia** (§8.2 del diseño): si su firma ha cambiado al mergear, lo que se reconcilia es el cuerpo de `start`, no el resto de la tarea.

**Files:**
- Modify: `backend/src/infrastructure/cmux-plan-session.js`
- Modify: `backend/src/domain/plan-session.js`
- Test: `backend/__tests__/infrastructure/cmux-plan-session.test.js`

**Interfaces:**
- Consumes: `PlanBriefing` (tarea 4), `CmuxLauncher` (tarea 5).
- Produces: `PlanSession.start(briefing)`; `new CmuxPlanSession({ run, write, read, sleep, runsIn })`; `CmuxPlanSession.argvFor(briefing, typed)`; `CmuxPlanSession.sendArgvFor(name, typed)`; `CmuxPlanSession.enterArgvFor(name)`; `CmuxPlanSession.nameFor(ticket)`.

- [ ] **Step 1: Write the failing test**

Reescribe `backend/__tests__/infrastructure/cmux-plan-session.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { CmuxPlanSession } from '../../src/infrastructure/cmux-plan-session.js'
import { CmuxLauncher } from '../../src/infrastructure/cmux-launcher.js'
import { PlanBriefing } from '../../src/domain/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { PlanSessionNotStarted, PlanSessionNotNamed, PlanSessionDidNotRun } from '../../src/domain/exceptions.js'

class CmuxDouble {
  static RUNS_IN = '/tmp/ct-plan'
  static WORKTREE = '/repo/.worktrees/42'

  constructor({ printed, sentinel }) {
    this.printed = printed
    this.sentinel = sentinel
    this.calls = []
    this.written = []
    this.slept = 0
  }

  session() {
    return new CmuxPlanSession({
      runsIn: CmuxDouble.RUNS_IN,
      write: (path, text) => {
        this.written.push([path, text])
        return Promise.resolve()
      },
      read: () => Promise.resolve(this.sentinel),
      sleep: () => {
        this.slept += 1
        return Promise.resolve()
      },
      run: (argv) => {
        this.calls.push(argv)
        return Promise.resolve(this.printed)
      },
    })
  }

  static briefing() {
    return new PlanBriefing({
      ticket: new TicketKey('ABC-42'),
      issue: { number: 42 },
      located: new WorkspaceLocation({ path: CmuxDouble.WORKTREE, branch: 'feat/42' }),
      errand: 'escribe el plan',
    })
  }

  static named() {
    return { failed: false, stdout: 'OK workspace:4\n', stderr: '' }
  }

  static ran(cwd = CmuxDouble.WORKTREE) {
    return `${CmuxLauncher.MAGIC}\t1\tok\t${cwd}\n`
  }

  start() {
    return this.session().start(CmuxDouble.briefing())
  }
}

describe('CmuxPlanSession', () => {
  it('the_window_it_opens_is_cut_in_the_worktree_and_not_where_the_api_happens_to_run', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: CmuxDouble.ran() })

    await cmux.start()

    expect(cmux.calls[0]).toEqual([
      'new-workspace',
      '--name', 'ct-plan-ABC-42',
      '--cwd', CmuxDouble.WORKTREE,
      '--command', CmuxLauncher.typedFor(`${CmuxDouble.RUNS_IN}/42/${CmuxLauncher.SCRIPT_NAME}`),
    ])
  })

  it('the_errand_travels_by_disk_and_never_as_keystrokes', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: CmuxDouble.ran() })

    await cmux.start()

    expect(cmux.written[0][0]).toBe(`${CmuxDouble.RUNS_IN}/42/${CmuxLauncher.SCRIPT_NAME}`)
    expect(cmux.written[0][1]).toContain('escribe el plan')
    expect(JSON.stringify(cmux.calls[0])).not.toContain('escribe el plan')
  })

  it('the_handle_cmux_prints_is_what_comes_back_so_the_caller_can_reach_the_session_later', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: CmuxDouble.ran() })

    expect(await cmux.start()).toBe('workspace:4')
  })

  it('a_cmux_that_refuses_travels_out_typed', async () => {
    const cmux = new CmuxDouble({
      printed: { failed: true, stdout: '', stderr: 'no daemon' },
      sentinel: null,
    })

    await expect(cmux.start()).rejects.toBeInstanceOf(PlanSessionNotStarted)
  })

  it('a_cmux_that_names_nothing_is_not_taken_for_a_success', async () => {
    const cmux = new CmuxDouble({
      printed: { failed: false, stdout: 'starting...\n', stderr: '' },
      sentinel: CmuxDouble.ran(),
    })

    await expect(cmux.start()).rejects.toBeInstanceOf(PlanSessionNotNamed)
  })

  it('when_the_sentinel_does_not_show_up_the_line_is_resent_because_the_pty_can_eat_it', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: null })

    await cmux.start().catch(() => {})

    const typed = CmuxLauncher.typedFor(`${CmuxDouble.RUNS_IN}/42/${CmuxLauncher.SCRIPT_NAME}`)
    expect(cmux.calls).toContainEqual(['send', '--workspace', 'ct-plan-ABC-42', typed])
    expect(cmux.calls).toContainEqual(['send-key', '--workspace', 'ct-plan-ABC-42', 'Enter'])
  })

  it('a_sentinel_that_never_shows_up_is_reported_instead_of_being_called_a_launch', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: null })

    const refusal = await cmux.start().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionDidNotRun)
    expect(refusal.message).toMatch(/centinela/)
  })

  it('a_sentinel_that_says_the_binary_was_missing_names_the_binary_and_not_the_window', async () => {
    const cmux = new CmuxDouble({
      printed: CmuxDouble.named(),
      sentinel: `${CmuxLauncher.MAGIC}\t1\tmissing\t${CmuxDouble.WORKTREE}\n`,
    })

    const refusal = await cmux.start().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionDidNotRun)
    expect(refusal.message).toContain('claude')
  })

  it('a_shell_that_landed_somewhere_else_is_reported_because_the_window_title_would_not_show_it', async () => {
    const cmux = new CmuxDouble({
      printed: CmuxDouble.named(),
      sentinel: CmuxDouble.ran('/somewhere/else'),
    })

    const refusal = await cmux.start().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionDidNotRun)
    expect(refusal.message).toContain('/somewhere/else')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run __tests__/infrastructure/cmux-plan-session.test.js`
Expected: FAIL — `PlanSessionDidNotRun` no existe

- [ ] **Step 3: Write minimal implementation**

Append to `backend/src/domain/exceptions.js`:

```js
export class PlanSessionDidNotRun extends PlanSessionFailure {}
```

Replace `backend/src/domain/plan-session.js`:

```js
export class PlanSession {
  async start(briefing) {
    throw new Error(`${this.constructor.name} must implement start(briefing), asked for ${briefing?.ticket}`)
  }
}
```

Replace `backend/src/infrastructure/cmux-plan-session.js`:

```js
import { PlanSession } from '../domain/plan-session.js'
import { PlanSessionNotStarted, PlanSessionNotNamed, PlanSessionDidNotRun } from '../domain/exceptions.js'
import { CmuxLauncher } from './cmux-launcher.js'

export class CmuxPlanSession extends PlanSession {
  static BIN = 'cmux'
  static AGENT = 'claude'
  static ATTEMPTS = 20
  static #REF = /^OK\s+(workspace:\d+)\s*$/m

  constructor({ run, write, read, sleep, runsIn }) {
    super()
    this.run = run
    this.write = write
    this.read = read
    this.sleep = sleep
    this.runsIn = runsIn
  }

  static nameFor(ticket) {
    return `ct-plan-${ticket}`
  }

  static argvFor(briefing, typed) {
    return [
      'new-workspace',
      '--name', CmuxPlanSession.nameFor(briefing.ticket),
      '--cwd', briefing.located.path,
      '--command', typed,
    ]
  }

  static sendArgvFor(name, typed) {
    return ['send', '--workspace', name, typed]
  }

  static enterArgvFor(name) {
    return ['send-key', '--workspace', name, 'Enter']
  }

  async start(briefing) {
    const directory = `${this.runsIn}/${briefing.issue.number}`
    const script = `${directory}/${CmuxLauncher.SCRIPT_NAME}`
    const sentinel = `${directory}/${CmuxLauncher.SENTINEL_NAME}`
    const typed = CmuxLauncher.typedFor(script)
    await this.write(script, CmuxLauncher.scriptFor({
      sentinel,
      errand: briefing.errand,
      bin: CmuxPlanSession.AGENT,
    }))
    const handle = await this.#open(briefing, typed)
    await this.#confirm({ briefing, sentinel, typed })

    return handle
  }

  async #open(briefing, typed) {
    const output = await this.run(CmuxPlanSession.argvFor(briefing, typed))
    if (output.failed) {
      throw new PlanSessionNotStarted(`${CmuxPlanSession.BIN} new-workspace failed: ${output.stderr.trim()}`)
    }
    const found = output.stdout.match(CmuxPlanSession.#REF)
    if (found === null) {
      throw new PlanSessionNotNamed(
        `cmux did not name the workspace it created, it printed ${JSON.stringify(output.stdout)}`
      )
    }

    return found[1]
  }

  async #confirm({ briefing, sentinel, typed }) {
    const seen = await this.#await(sentinel, CmuxPlanSession.ATTEMPTS)
    if (seen === null) {
      await this.#resend(briefing, typed)
      const retried = await this.#await(sentinel, CmuxPlanSession.ATTEMPTS)
      if (retried === null) {
        throw new PlanSessionDidNotRun(
          `la ventana de cmux se abrió pero el centinela nunca apareció en ${sentinel}: la orden no llegó a ejecutarse`
        )
      }

      return CmuxPlanSession.#judge(retried, briefing)
    }

    return CmuxPlanSession.#judge(seen, briefing)
  }

  static #judge(seen, briefing) {
    if (!seen.resolved) {
      throw new PlanSessionDidNotRun(
        `el shell de la sesión no encuentra ${CmuxPlanSession.AGENT} en su PATH, así que no hay agente escribiendo nada`
      )
    }
    if (seen.cwd !== briefing.located.path) {
      throw new PlanSessionDidNotRun(
        `la sesión arrancó en ${seen.cwd} y no en ${briefing.located.path}: lo que escriba no va a la rama de este slice`
      )
    }
  }

  async #await(sentinel, attempts) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const text = await this.read(sentinel)
      const seen = text === null ? null : CmuxLauncher.read(text)
      if (seen !== null) return seen
      await this.sleep()
    }

    return null
  }

  async #resend(briefing, typed) {
    const name = CmuxPlanSession.nameFor(briefing.ticket)
    await this.run(CmuxPlanSession.sendArgvFor(name, typed))
    await this.run(CmuxPlanSession.enterArgvFor(name))
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run __tests__/infrastructure/cmux-plan-session.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS. Los tests de `start-plan.test.js` van a fallar porque `PlanSession.start` cambió de firma: se arreglan en la tarea 7, así que si sólo falla eso, sigue.

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/cmux-plan-session.js backend/src/domain/plan-session.js backend/src/domain/exceptions.js backend/__tests__/infrastructure/cmux-plan-session.test.js
git commit -m "feat(cmux): la sesión arranca al agente de verdad, y se verifica el efecto"
```

---

## Task 7: El caso de uso conduce el espacio de trabajo

**Files:**
- Modify: `backend/src/application/actions/start-plan.js`
- Modify: `backend/src/infrastructure/api-server.js`
- Test: `backend/__tests__/application/start-plan.test.js`
- Test: `backend/__tests__/infrastructure/api-server.test.js` (añadir)

**Interfaces:**
- Consumes: `Workspace` (tarea 1), `PlanBriefing` (tarea 4), `PlanAgentBrief` (tarea 4), `PlanSession.start(briefing)` (tarea 6).
- Produces: `new StartPlan({ tickets, planIssues, workspace, planSession, brief })` donde `brief` es `{ errandFor({ issue, repository }) -> string }`; `StartPlanResult { issue, session, located }`.

- [ ] **Step 1: Write the failing test**

En `backend/__tests__/application/start-plan.test.js`, `PlanSessionDouble` pasa a recibir el encargo entero:

```js
class PlanSessionDouble extends PlanSession {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  async start(briefing) {
    this.asked.push(briefing)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}
```

Las pruebas que ya existen en ese fichero construyen `StartPlan` con un solo puerto y `StartPlanParams` sin `repository`: pásalas por el mismo `conducted(...)` de abajo, y donde comprobaban `planSession.asked` contra el ticket, comprueba `String(planSession.asked[0].ticket)`.

Y añade:

```js
import { Workspace } from '../../src/domain/workspace.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'
import { WorkspaceNotPrepared } from '../../src/domain/exceptions.js'

class WorkspaceDouble extends Workspace {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  async prepare(issue) {
    this.asked.push(issue)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class BriefDouble {
  static errandFor({ issue, repository }) {
    return `escribe el plan de #${issue.number} en ${repository}`
  }
}

describe('StartPlan prepares the ground before it opens the session', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const issue = { number: 42, url: 'https://github.com/owner/name/issues/42' }

  const conducted = ({ workspace, planSession }) => new StartPlan({
    tickets: { detail: async (ticket) => ({ key: ticket }) },
    planIssues: { open: async () => issue },
    workspace,
    planSession,
    brief: BriefDouble,
  })

  it('the_workspace_is_prepared_for_the_issue_that_was_just_opened', async () => {
    const workspace = new WorkspaceDouble(located)
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({ workspace, planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))

    expect(workspace.asked).toEqual([issue])
  })

  it('the_session_is_told_where_to_run_and_what_to_do_and_never_has_to_work_it_out', async () => {
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({ workspace: new WorkspaceDouble(located), planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))

    expect(planSession.asked[0].located).toBe(located)
    expect(planSession.asked[0].errand).toBe('escribe el plan de #42 en owner/name')
    expect(String(planSession.asked[0].ticket)).toBe('ABC-42')
  })

  it('where_the_work_landed_comes_back_so_the_caller_can_watch_it', async () => {
    const started = await conducted({
      workspace: new WorkspaceDouble(located),
      planSession: new PlanSessionDouble('workspace:4'),
    }).execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))

    expect(started.located).toBe(located)
  })

  it('no_session_is_opened_when_there_is_nowhere_for_it_to_work', async () => {
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({
      workspace: new WorkspaceDouble(new WorkspaceNotPrepared('branch is taken')),
      planSession,
    })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch(() => {})

    expect(planSession.asked).toEqual([])
  })

  it('a_workspace_that_refuses_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const refusal = await conducted({
      workspace: new WorkspaceDouble(new WorkspaceNotPrepared('branch is taken')),
      planSession: new PlanSessionDouble('workspace:4'),
    })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
  })
})
```

En `backend/__tests__/infrastructure/api-server.test.js`, `StartPlanSpy` gana la forma de fallar por el otro lado. Importa `WorkspaceNotPrepared` y añade el estático:

```js
  static refusingWorkspace() {
    const spy = new StartPlanSpy()
    spy.execute = async () => {
      throw new WorkspaceNotPrepared('branch is taken')
    }

    return spy
  }
```

Y la prueba, copiando el molde de `a_session_that_cannot_be_started_is_reported_as_such_instead_of_a_generic_failure`:

```js
  it('a_workspace_that_could_not_be_prepared_is_answered_as_unavailable_and_not_as_a_crash', async () => {
    const server = new ApiServer({ port: 0, startPlan: StartPlanSpy.refusingWorkspace() })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(503)
      expect(await response.text()).toBe(
        '{"error":"could not start the plan session: branch is taken"}'
      )
    } finally {
      await server.stop()
    }
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/application/start-plan.test.js __tests__/infrastructure/api-server.test.js`
Expected: FAIL — `workspace` no se usa y el 503 no cubre `WorkspaceNotPrepared`

- [ ] **Step 3: Write minimal implementation**

Replace `backend/src/application/actions/start-plan.js`:

```js
import { PlanBriefing } from '../../domain/plan-briefing.js'

export class StartPlanParams {
  constructor({ ticket, repository }) {
    this.ticket = ticket
    this.repository = repository
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ issue, session, located }) {
    this.issue = issue
    this.session = session
    this.located = located
    Object.freeze(this)
  }
}

export class StartPlan {
  constructor({ tickets, planIssues, workspace, planSession, brief }) {
    this.tickets = tickets
    this.planIssues = planIssues
    this.workspace = workspace
    this.planSession = planSession
    this.brief = brief
  }

  async execute(params) {
    const ticket = await this.tickets.detail(params.ticket)
    const issue = await this.planIssues.open({ ticket, repository: params.repository })
    const located = await this.workspace.prepare(issue)
    const session = await this.planSession.start(new PlanBriefing({
      ticket: params.ticket,
      issue,
      located,
      errand: this.brief.errandFor({ issue, repository: params.repository }),
    }))

    return new StartPlanResult({ issue, session, located })
  }
}
```

In `backend/src/infrastructure/api-server.js`, import `WorkspaceFailure` alongside `PlanSessionFailure` and widen the guard in `StartPlanRoute.#accept`:

```js
      if (!(cause instanceof PlanSessionFailure) && !(cause instanceof WorkspaceFailure)) throw cause
      Answer.refuse(response, 503, `could not start the plan session: ${cause.message}`)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/application/start-plan.test.js __tests__/infrastructure/api-server.test.js`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/application/actions/start-plan.js backend/src/infrastructure/api-server.js backend/__tests__/application/start-plan.test.js backend/__tests__/infrastructure/api-server.test.js
git commit -m "feat(start-plan): el caso de uso prepara el sitio antes de abrir la sesión"
```

---

## Task 8: El predicado

Dos hechos, no uno. `--check-plan` es deliberadamente permisivo con el commit —su modo es *"el árbol de trabajo, commiteado o no"* (`plugin/scripts/dispatch-check.mjs:718`)— y un plan sin commitear no viaja en el pull request.

**Files:**
- Create: `backend/src/domain/plan-state.js`
- Create: `backend/src/domain/plan-progress.js`
- Create: `backend/src/infrastructure/plan-contract-progress.js`
- Test: `backend/__tests__/infrastructure/plan-contract-progress.test.js`

**Interfaces:**
- Consumes: `WorkspaceLocation` (tarea 1).
- Produces: `PlanState.WRITING === 'writing'`, `PlanState.READY === 'ready'`; `PlanProgress` con `async of({ located, issue })`; `new PlanContractProgress({ node, git, dispatchCheck, repository })`, donde `node` y `git` son invocables `(argv, options) => Promise<{ failed, stdout, stderr }>` y `node` tiene que honrar `options.cwd`.

`tool-runner.js` **no existe en esta rama** (viene de `alcaptar/start-plan-crea-el-issue`, sin mergear), así que esta tarea no lo toca. Quién construye esos invocables, y con qué directorio de trabajo, es cosa de la composición en la tarea 9.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/plan-contract-progress.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { PlanContractProgress } from '../../src/infrastructure/plan-contract-progress.js'
import { PlanState } from '../../src/domain/plan-state.js'
import { PlanProgress } from '../../src/domain/plan-progress.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'

class ProgressDouble {
  static WORKTREE = '/repo/.worktrees/42'
  static CHECK = '/plugin/scripts/dispatch-check.mjs'

  constructor({ validated, dirty }) {
    this.validated = validated
    this.dirty = dirty
    this.node = []
    this.git = []
  }

  progress() {
    return new PlanContractProgress({
      dispatchCheck: ProgressDouble.CHECK,
      repository: 'owner/name',
      node: (argv, options) => {
        this.node.push([argv, options])
        return Promise.resolve(this.validated
          ? { failed: false, stdout: 'plan ok', stderr: '' }
          : { failed: true, stdout: '', stderr: 'no hay ningún plan prescriptivo' })
      },
      git: (argv) => {
        this.git.push(argv)
        return Promise.resolve({ failed: false, stdout: this.dirty, stderr: '' })
      },
    })
  }

  asked() {
    return this.progress().of({
      located: new WorkspaceLocation({ path: ProgressDouble.WORKTREE, branch: 'feat/42' }),
      issue: { number: 42 },
    })
  }
}

describe('PlanContractProgress', () => {
  it('a_plan_that_is_valid_and_carries_nothing_uncommitted_is_ready', async () => {
    expect(await new ProgressDouble({ validated: true, dirty: '' }).asked()).toBe(PlanState.READY)
  })

  it('a_plan_the_contract_rejects_is_still_being_written', async () => {
    expect(await new ProgressDouble({ validated: false, dirty: '' }).asked()).toBe(PlanState.WRITING)
  })

  it('a_valid_plan_that_is_not_committed_is_not_ready_because_it_would_not_travel_in_the_pull_request', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '?? docs/superpowers/plans/2026-09-01-issue-42-x.md\n' })

    expect(await asked.asked()).toBe(PlanState.WRITING)
  })

  it('a_valid_plan_with_uncommitted_edits_on_top_is_not_ready_either', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: ' M docs/superpowers/plans/2026-09-01-issue-42-x.md\n' })

    expect(await asked.asked()).toBe(PlanState.WRITING)
  })

  it('the_contract_is_asked_from_inside_the_worktree_because_it_resolves_its_paths_from_there', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '' })

    await asked.asked()

    expect(asked.node[0][0]).toEqual([ProgressDouble.CHECK, '42', '--repo', 'owner/name', '--check-plan'])
    expect(asked.node[0][1]).toEqual({ cwd: ProgressDouble.WORKTREE })
  })

  it('git_is_asked_only_about_the_directory_the_plan_lives_in_and_not_about_the_whole_tree', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '' })

    await asked.asked()

    expect(asked.git[0]).toEqual([
      '-C', ProgressDouble.WORKTREE, 'status', '--porcelain', '--', 'docs/superpowers/plans',
    ])
  })

  it('the_contract_is_never_asked_twice_for_one_answer', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '' })

    await asked.asked()

    expect(asked.node).toHaveLength(1)
  })
})

describe('PlanProgress', () => {
  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanProgress().of({ issue: { number: 1 } })).rejects.toThrow(/must implement of/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run __tests__/infrastructure/plan-contract-progress.test.js`
Expected: FAIL — imports no resueltos

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/domain/plan-state.js`:

```js
export const PlanState = Object.freeze({
  WRITING: 'writing',
  READY: 'ready',
})
```

Create `backend/src/domain/plan-progress.js`:

```js
export class PlanProgress {
  async of({ located, issue }) {
    throw new Error(`${this.constructor.name} must implement of({ located, issue }), asked for ${issue?.number} at ${located?.path}`)
  }
}
```

Create `backend/src/infrastructure/plan-contract-progress.js`:

```js
import { PlanProgress } from '../domain/plan-progress.js'
import { PlanState } from '../domain/plan-state.js'

export class PlanContractProgress extends PlanProgress {
  static PLANS = 'docs/superpowers/plans'

  constructor({ node, git, dispatchCheck, repository }) {
    super()
    this.node = node
    this.git = git
    this.dispatchCheck = dispatchCheck
    this.repository = repository
  }

  static contractArgvFor({ dispatchCheck, issue, repository }) {
    return [dispatchCheck, String(issue.number), '--repo', repository, '--check-plan']
  }

  static pendingArgvFor(located) {
    return ['-C', located.path, 'status', '--porcelain', '--', PlanContractProgress.PLANS]
  }

  async of({ located, issue }) {
    const validated = await this.node(
      PlanContractProgress.contractArgvFor({
        dispatchCheck: this.dispatchCheck,
        issue,
        repository: this.repository,
      }),
      { cwd: located.path }
    )
    if (validated.failed) return PlanState.WRITING
    const pending = await this.git(PlanContractProgress.pendingArgvFor(located))
    if (pending.failed || pending.stdout.trim().length > 0) return PlanState.WRITING

    return PlanState.READY
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run __tests__/infrastructure/plan-contract-progress.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/plan-state.js backend/src/domain/plan-progress.js backend/src/infrastructure/plan-contract-progress.js backend/__tests__/infrastructure/plan-contract-progress.test.js
git commit -m "feat(progress): el plan está hecho cuando es válido y está commiteado, no antes"
```

---

## Task 9: El frontend se entera

**Files:**
- Create: `backend/src/application/queries/read-plan-progress.js`
- Create: `backend/src/infrastructure/plan-events.js`
- Modify: `backend/src/infrastructure/api-server.js`
- Test: `backend/__tests__/application/read-plan-progress.test.js`
- Test: `backend/__tests__/infrastructure/plan-events.test.js`

**Interfaces:**
- Consumes: `PlanProgress` y `PlanState` (tarea 8), `WorkspaceLocation` (tarea 1).
- Produces: `new ReadPlanProgress({ planProgress })` con `execute(params) -> ReadPlanProgressResult { state }`; `PlanEvents.frameFor(state)`; `new PlanEvents({ read, sleep })` con `async *stream({ located, issue })`.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/application/read-plan-progress.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { ReadPlanProgress, ReadPlanProgressParams } from '../../src/application/queries/read-plan-progress.js'
import { PlanProgress } from '../../src/domain/plan-progress.js'
import { PlanState } from '../../src/domain/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'

class PlanProgressDouble extends PlanProgress {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  async of(subject) {
    this.asked.push(subject)
    return this.answer
  }
}

describe('ReadPlanProgress', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const issue = { number: 42 }

  it('what_the_port_answers_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const progress = new PlanProgressDouble(PlanState.READY)

    const read = await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue }))

    expect(read.state).toBe(PlanState.READY)
  })

  it('the_port_is_asked_about_the_workspace_and_the_issue_it_was_given', async () => {
    const progress = new PlanProgressDouble(PlanState.WRITING)

    await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue }))

    expect(progress.asked).toEqual([{ located, issue }])
  })

  it('neither_what_goes_in_nor_what_comes_out_can_be_edited_after_the_use_case_settled_it', async () => {
    const params = new ReadPlanProgressParams({ located, issue })

    const read = await new ReadPlanProgress({ planProgress: new PlanProgressDouble(PlanState.WRITING) })
      .execute(params)

    expect(Object.isFrozen(params)).toBe(true)
    expect(Object.isFrozen(read)).toBe(true)
  })
})
```

Create `backend/__tests__/infrastructure/plan-events.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { PlanEvents } from '../../src/infrastructure/plan-events.js'
import { PlanState } from '../../src/domain/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'

class EventsDouble {
  static SUBJECT = {
    located: new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' }),
    issue: { number: 42 },
  }

  constructor(answers) {
    this.answers = [...answers]
    this.slept = 0
  }

  events() {
    return new PlanEvents({
      sleep: () => {
        this.slept += 1
        return Promise.resolve()
      },
      read: () => Promise.resolve({ state: this.answers.shift() ?? PlanState.READY }),
    })
  }

  async collected() {
    const frames = []
    for await (const frame of this.events().stream(EventsDouble.SUBJECT)) frames.push(frame)

    return frames
  }
}

describe('PlanEvents', () => {
  it('a_frame_is_the_server_sent_event_a_browser_can_parse', () => {
    expect(PlanEvents.frameFor(PlanState.READY)).toBe('data: {"state":"ready"}\n\n')
  })

  it('it_emits_the_first_state_it_reads_so_a_late_subscriber_is_not_left_blank', async () => {
    const events = new EventsDouble([PlanState.WRITING, PlanState.READY])

    expect((await events.collected())[0]).toBe(PlanEvents.frameFor(PlanState.WRITING))
  })

  it('it_stops_after_ready_because_there_is_nothing_left_to_watch', async () => {
    const frames = await new EventsDouble([PlanState.WRITING, PlanState.READY]).collected()

    expect(frames).toEqual([
      PlanEvents.frameFor(PlanState.WRITING),
      PlanEvents.frameFor(PlanState.READY),
    ])
  })

  it('a_state_that_did_not_change_is_not_repeated_down_the_wire', async () => {
    const frames = await new EventsDouble([
      PlanState.WRITING, PlanState.WRITING, PlanState.WRITING, PlanState.READY,
    ]).collected()

    expect(frames).toEqual([
      PlanEvents.frameFor(PlanState.WRITING),
      PlanEvents.frameFor(PlanState.READY),
    ])
  })

  it('it_waits_between_reads_instead_of_spinning', async () => {
    const events = new EventsDouble([PlanState.WRITING, PlanState.WRITING, PlanState.READY])

    await events.collected()

    expect(events.slept).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run __tests__/application/read-plan-progress.test.js __tests__/infrastructure/plan-events.test.js`
Expected: FAIL — imports no resueltos

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/application/queries/read-plan-progress.js`:

```js
export class ReadPlanProgressParams {
  constructor({ located, issue }) {
    this.located = located
    this.issue = issue
    Object.freeze(this)
  }
}

export class ReadPlanProgressResult {
  constructor({ state }) {
    this.state = state
    Object.freeze(this)
  }
}

export class ReadPlanProgress {
  constructor({ planProgress }) {
    this.planProgress = planProgress
  }

  async execute(params) {
    return new ReadPlanProgressResult({
      state: await this.planProgress.of({ located: params.located, issue: params.issue }),
    })
  }
}
```

Create `backend/src/infrastructure/plan-events.js`:

```js
import { PlanState } from '../domain/plan-state.js'

export class PlanEvents {
  static TICK_MS = 3_000

  constructor({ read, sleep }) {
    this.read = read
    this.sleep = sleep
  }

  static frameFor(state) {
    return `data: ${JSON.stringify({ state })}\n\n`
  }

  async *stream(subject) {
    let last = null
    for (;;) {
      const read = await this.read(subject)
      if (read.state !== last) {
        last = read.state
        yield PlanEvents.frameFor(read.state)
      }
      if (read.state === PlanState.READY) return
      await this.sleep()
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run __tests__/application/read-plan-progress.test.js __tests__/infrastructure/plan-events.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Wire the route and the entrypoint**

En `backend/src/infrastructure/api-server.js`, añade la clase de la ruta junto a `StartPlanRoute` y regístrala **antes** de `Failures.nothingMatched`. La guarda `Browsers.turnAway` **no** se aplica aquí, y es deliberado: esta ruta existe para un navegador (§7 del diseño).

```js
class PlanEventsRoute {
  static PATH = '/plan-events/:issue'
  static METHOD = 'GET'
  static #HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }

  static handledBy(sessions, events) {
    return async (request, response) => {
      const watched = sessions.get(Number(request.params.issue))
      if (watched === undefined) {
        Answer.refuse(response, 404, 'no plan session was started for that issue')
        return
      }
      response.writeHead(200, PlanEventsRoute.#HEADERS)
      for await (const frame of events.stream(watched)) {
        if (response.writableEnded) return
        response.write(frame)
      }
      response.end()
    }
  }
}
```

En `ApiServer`, el constructor y la ruta:

```js
  constructor({ port, startPlan, sessions, planEvents }) {
    this.requestedPort = port
    this.startPlan = startPlan
    this.sessions = sessions ?? new Map()
    this.planEvents = planEvents
    this.server = null
  }
```

y dentro de `#route()`, antes de `app.use(Failures.nothingMatched)`:

```js
    if (this.planEvents !== undefined) {
      app.get(PlanEventsRoute.PATH, PlanEventsRoute.handledBy(this.sessions, this.planEvents))
    }
```

La guarda `planEvents !== undefined` no es defensiva por costumbre: las pruebas de `api-server.test.js`
construyen el servidor sin flujo de eventos, y sin ella todas empezarían a necesitar uno que no miden.

`StartPlanRoute.#accept` guarda lo arrancado antes de contestar. Pasa a recibir el mapa:

```js
  static async #accept(startPlan, sessions, response, ticket) {
    let started
    try {
      started = await startPlan.execute(new StartPlanParams({ ticket }))
    } catch (cause) {
      if (!(cause instanceof PlanSessionFailure) && !(cause instanceof WorkspaceFailure)) throw cause
      Answer.refuse(response, 503, `could not start the plan session: ${cause.message}`)
      return
    }
    if (started.issue !== undefined && started.located !== undefined) {
      sessions.set(started.issue.number, { located: started.located, issue: started.issue })
    }
    Answer.send(response, 202, {
      status: 'started',
      [PlanRequest.ID_FIELD]: ticket.text,
      session: started.session,
    })
  }
```

`handledBy(startPlan)` pasa a `handledBy(startPlan, sessions)` y `#route()` lo llama con `this.sessions`.

La guarda sobre `started.issue` existe por el mismo motivo que la anterior: `StartPlanSpy` de
`api-server.test.js` devuelve un `StartPlanResult` con sólo `session`, y ese doble mide la frontera HTTP,
no el caso de uso. Obligarle a componer un issue y una ubicación sería hacerle reimplementar lo que la
tarea 7 ya mide.

**`ct-api.mjs` NO se toca en esta tarea.** Su composición necesita `AcliTickets`, `GhPlanIssues`, `GhCall` y
`ToolRunner`, que viven en `alcaptar/start-plan-crea-el-issue` y no existen en esta rama: sin `tickets` ni
`planIssues` no hay forma de construir un `StartPlan` que arranque. Cablearlo es trabajo de después del merge y
está descrito abajo, en su propia sección.

- [ ] **Step 6: Run the whole suite**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/application/queries/read-plan-progress.js backend/src/infrastructure/plan-events.js backend/src/infrastructure/api-server.js backend/__tests__/application/read-plan-progress.test.js backend/__tests__/infrastructure/plan-events.test.js
git commit -m "feat(events): el frontend se entera de que el plan está hecho sin sondear él"
```

---

## Residuo del repaso final — RESUELTO

La re-revisión de la ola de arreglo cerró los doce hallazgos y encontró dos que la propia ola había abierto.
Los dos están arreglados (commits `63c0c5b`, `95b4aa3`, `f9377f5`, `04a1e93`, `597208b`, `db29d60`):

- **`undo()` ya le dice a git dónde correr.** `removeArgvFor` y `deleteBranchArgvFor` llevan `-C root`, como el
  resto de constructores de argv de la clase. Cerraba un `git branch -D` que podía correr en el repositorio
  equivocado, destructivo y silencioso.
- **`prepare()` compensa lo que creó.** Si algo falla después del corte —`#commonDirOf`, `#cutOf` o cualquiera
  de los dos caminos de `#verifyHidden`— deshace worktree y rama y relanza el fallo original.
- Y de propina, los tres sitios que descubren un fallo de limpieza cuentan lo mismo de la misma forma: el
  escritor de diagnóstico se inyecta en `GitWorkspace` igual que en `PlanContractProgress`, `undo` se cuenta a
  sí mismo, y la capa de aplicación quedó **sin entrada/salida** — con un test que lo clava.

## Después del merge: la composición

Esto NO es una tarea de este plan: es lo que queda por hacer cuando
`alcaptar/start-plan-crea-el-issue` entre. Se escribe aquí para que no se pierda.

En `backend/src/infrastructure/ct-api.mjs`:

1. `StartPlan` se construye con los cinco colaboradores: `tickets` y `planIssues` de esa rama, más
   `workspace: new GitWorkspace({ run, write, root, base })`, el `planSession` con su constructor nuevo
   (`{ run, write, read, sleep, runsIn }`) y `brief: new PlanAgentBrief({ dispatchCheck, conventions })` con
   **rutas absolutas** — el constructor las exige.
2. `CmuxPlanSession` está hoy instanciado con el constructor viejo `{ run, cwd }`. Si se deja así, la instancia
   real lleva `write`, `read`, `sleep` y `runsIn` en `undefined` y revienta en la primera llamada, con la suite
   entera en verde. Es el hallazgo que la revisión de la tarea 6 dejó anotado.
3. `api-server.js` construye `new StartPlanParams({ ticket })` sin `repository`. Hay dos formas de cerrarlo y la
   decisión es de quien mergee: que `PlanRequest` acepte un campo `repository` (es lo que la otra rama ya toca,
   así que probablemente venga hecho), o que el repositorio entre por configuración (`CT_REPOSITORY`, que la
   tarea 9 ya necesita para el predicado) y la ruta lo pase. Lo que NO vale es dejarlo `undefined`: llegaría
   hasta el cuerpo del issue y hasta el comando de `--check-plan`.
4. `ToolRunner.run` tiene que aceptar `{ cwd }` y pasarlo a `execFile`: `--check-plan` resuelve sus rutas desde
   el directorio de trabajo y hay que invocarlo dentro del worktree.

## Verificación de punta a punta

Después de la tarea 9, contra un repo gobernado de verdad —uno donde `/ct-init` haya corrido y el plugin esté instalado—:

```bash
cd <repo-gobernado>
CT_DISPATCH_CHECK=<ruta>/plugin/scripts/dispatch-check.mjs \
CT_REPOSITORY=<owner/name> \
CT_API_PORT=8787 \
node <ruta>/backend/src/infrastructure/ct-api.mjs &

curl -s -X POST localhost:8787/start-plan \
  -H 'Content-Type: application/json' \
  -d '{"id":"ABC-123","repository":"<owner/name>"}'

curl -N localhost:8787/plan-events/<n>
```

Lo que hay que ver, en este orden:

1. Una ventana de cmux nueva, titulada `ct-plan-ABC-123`, con el prompt en `.worktrees/<n>`.
2. Un `claude` corriendo ahí, hidratándose del issue — **no** un shell inactivo, y **no** un `command not found`.
3. `data: {"state":"writing"}` en la salida de `curl -N`.
4. Cuando el agente commitee el plan y pare: `data: {"state":"ready"}` y el flujo cerrado.

Si el paso 2 muestra un shell inactivo, el centinela hizo su trabajo: la petición habrá contestado 503 con `PlanSessionDidNotRun`, y el mensaje dice si fue el binario o el directorio.
