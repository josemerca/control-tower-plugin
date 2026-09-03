# El clon viaja en la petición — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la API se arranque desde cualquier directorio y cada `POST /start-plan` traiga la ruta del clon local donde cortar el worktree.

**Architecture:** la raíz del clon deja de ser `process.cwd()` y pasa a ser un value object `CheckoutRoot` que entra por la petición. `StartPlan` la confirma contra git antes de abrir el issue, `GitWorkspace` la recibe por llamada, `WorkspaceLocation` la lleva consigo para que `undo` y la cosecha sepan dónde correr, y un `CheckoutRegistry` en memoria le dice al `HarvestClock` qué clones barrer.

**Tech Stack:** Node 24, vitest 4, express 5 (backend); React 19, TypeScript, vitest, Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-03-el-clon-viaja-en-la-peticion-design.md`

## Global Constraints

- Todo diff bajo `backend/` obedece `backend/conventions/` y `plugin/conventions/`: sin comentarios, identificadores y nombres de test en inglés, ninguna función suelta a nivel de módulo (todo cuelga de una clase), nombres de test en `snake_case` que digan qué se garantiza. El test `backend/__tests__/yardstick.test.js` lo mide y falla si no.
- El dominio no tiene tests propios: se cubre desde la petición HTTP y desde el caso de uso (`backend/conventions/testing.md`).
- La guarda vive donde el valor entra desde fuera. `CheckoutRoot` valida en `PlanRequest`; nada aguas abajo vuelve a validarla.
- Un campo, una rama o un símbolo público responden a una llamada que existe hoy. La respuesta 202 no devuelve `root`: nadie la lee.
- Cada tarea corre **sólo los ficheros de test que toca**, en primer plano, nunca con `run_in_background`, y siempre además `__tests__/yardstick.test.js` (un segundo, mide que lo nuevo nace conforme). La suite entera del backend (`npx vitest run` desde `backend/`, unos seis minutos) la corre el coordinador una vez, al cerrar la Task 7.
- Frontend: antes de tocar `frontend/` carga la skill `frontend-engineering:frontend-best-practices`. Tests con `npm test --prefix frontend`; el tipado se comprueba con `npm run build --prefix frontend`.
- Commits pequeños, uno por tarea, en castellano como los del repo (`feat:`, `test:`, `refactor:`, `docs:`).
- El plugin (`plugin/`) no se toca.

---

## Mapa de ficheros

| Fichero | Responsabilidad tras el cambio |
|---|---|
| `backend/src/domain/value-objects/checkout-root.js` | **Nuevo.** La ruta absoluta del clon: forma y ejemplo |
| `backend/src/domain/value-objects/workspace-location.js` | Gana `root` |
| `backend/src/domain/ports/workspace.js` | `confirm`, `prepare` y `survey` con raíz |
| `backend/src/domain/ports/checkout-registry.js` | **Nuevo.** `remember(root)`, `known()` |
| `backend/src/domain/ports/harvest.js` | `collect` con `root` |
| `backend/src/application/actions/start-plan.js` | Confirma antes de leer la historia, recuerda el clon al arrancar |
| `backend/src/application/queries/survey-workspaces.js` | Recibe la raíz en sus `Params` |
| `backend/src/application/actions/harvest-delivery.js` | Pasa `located.root` al `collect` |
| `backend/src/infrastructure/start-plan-route.js` | Parsea `root`, rechaza `MALFORMED_ROOT` |
| `backend/src/infrastructure/git-workspace.js` | Sin `root` en el constructor; `confirm` público |
| `backend/src/infrastructure/memory-checkout-registry.js` | **Nuevo.** El registro en memoria |
| `backend/src/infrastructure/dispatch-check-harvest.js` | Sin `root` en el constructor; `cwd` del `collect` |
| `backend/src/infrastructure/harvest-clock.js` | Pregunta al registro y encuesta clon a clon |
| `backend/src/infrastructure/ct-api.mjs` | Deja de leer `process.cwd()`; cablea el registro |
| `frontend/src/app/start-plan/CheckoutRoot.ts` | **Nuevo.** Misma forma que el backend |
| `frontend/src/app/start-plan/StartPlan.types.ts`, `client.ts`, `components/start-plan-form/StartPlanForm.tsx` | El tercer campo |
| `frontend/src/__scenarios__/StartPlanMother.ts`, `frontend/src/pages/home/__tests__/helpers.tsx`, `Home.startPlan.test.tsx` | Los escenarios con `root` |

---

### Task 1: La petición trae la raíz del clon

**Files:**
- Create: `backend/src/domain/value-objects/checkout-root.js`
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Test: `backend/__tests__/infrastructure/plan-request.test.js`, `backend/__tests__/infrastructure/api-server.test.js`

**Interfaces:**
- Produces: `CheckoutRoot` con `constructor(text)`, `static isWellFormed(text)`, `static EXAMPLE = '/Users/you/repos/name'`, `text`, `toString()`. `PlanRequest.ROOT_FIELD = 'root'`, `PlanRequestOutcome.MALFORMED_ROOT = 'malformed-root'`, `PlanRequest.accepted(story, repository, root)`, campo `root` en la petición aceptada. `StartPlanParams` recibe `{ story, repository, root }` (la clase se amplía en la Task 2; hasta entonces el campo viaja igual porque `StartPlanParams` ya guarda lo que recibe: revisar que su constructor destructura `root` — se hace aquí, ver paso 3).

- [ ] **Step 1: Tests de `PlanRequest` que fallan**

En `backend/__tests__/infrastructure/plan-request.test.js`, importa `CheckoutRoot` y añade estos tests dentro del `describe('PlanRequest')`. Además, cambia los dos bodies de los tests `an_accepted_body_hands_back_the_story_as_a_domain_value_and_not_as_the_raw_string` y `an_accepted_body_hands_back_the_repository_as_a_domain_value_too` a `'{"id":"MO_SHOP-42","repo":"josemerca/ct-loop-sandbox","root":"/repo/checkout"}'`.

```js
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

  it('an_accepted_request_cannot_be_built_without_the_root_the_worktree_is_cut_in', () => {
    expect(() => PlanRequest.accepted(new UserStoryKey('ABC-123'), new RepositoryName('owner/name'), null))
      .toThrow(/disagrees with its root/)
  })

  it('a_body_whose_root_is_not_an_absolute_path_comes_back_refused_and_not_as_a_malformed_repo', () => {
    const refused = [
      '{"id":"ABC-1","repo":"owner/name","root":"repos/name"}',
      '{"id":"ABC-1","repo":"owner/name","root":"~/repos/name"}',
      '{"id":"ABC-1","repo":"owner/name","root":"/repos/name/"}',
      '{"id":"ABC-1","repo":"owner/name","root":"/repos//name"}',
      '{"id":"ABC-1","repo":"owner/name","root":"/repos/name\\n"}',
      '{"id":"ABC-1","repo":"owner/name","root":""}',
      '{"id":"ABC-1","repo":"owner/name","root":123}',
      '{"id":"ABC-1","repo":"owner/name"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(8).fill(PlanRequestOutcome.MALFORMED_ROOT))
  })

  it('a_malformed_repo_is_reported_before_the_root_so_the_first_thing_wrong_is_what_gets_named', () => {
    expect(PlanRequest.from('{"id":"ABC-1","repo":"nope","root":"nope"}').outcome)
      .toBe(PlanRequestOutcome.MALFORMED_REPO)
  })

  it('an_accepted_body_hands_back_the_root_as_a_domain_value_too', () => {
    const accepted = PlanRequest.from(
      '{"id":"MO_SHOP-42","repo":"josemerca/ct-loop-sandbox","root":"/Users/someone/repos/ct-loop-sandbox"}'
    )

    expect(accepted.root).toBeInstanceOf(CheckoutRoot)
    expect(accepted.root.text).toBe('/Users/someone/repos/ct-loop-sandbox')
  })

  it('a_root_with_spaces_in_a_segment_is_still_a_path_because_a_home_directory_can_carry_one', () => {
    expect(PlanRequest.from('{"id":"ABC-1","repo":"owner/name","root":"/Users/some one/repos/name"}').outcome)
      .toBe(PlanRequestOutcome.ACCEPTED)
  })
```

- [ ] **Step 2: Correr y ver fallar**

Desde `backend/`: `npx vitest run __tests__/infrastructure/plan-request.test.js`
Esperado: FAIL, `Failed to resolve import "../../src/domain/value-objects/checkout-root.js"`.

- [ ] **Step 3: El value object y la petición**

Crea `backend/src/domain/value-objects/checkout-root.js`:

```js
export class CheckoutRoot {
  static #SHAPE = /^\/(?:[^/\n]+(?:\/[^/\n]+)*)?$/
  static EXAMPLE = '/Users/you/repos/name'

  constructor(text) {
    if (!CheckoutRoot.isWellFormed(text)) {
      throw new Error(`a checkout root is an absolute path such as ${CheckoutRoot.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text
    Object.freeze(this)
  }

  static isWellFormed(text) {
    return typeof text === 'string' && CheckoutRoot.#SHAPE.test(text)
  }

  toString() {
    return this.text
  }
}
```

En `backend/src/infrastructure/start-plan-route.js`:

```js
import { CheckoutRoot } from '../domain/value-objects/checkout-root.js'

export const PlanRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ROOT: 'malformed-root',
})

export class PlanRequest {
  static ID_FIELD = 'id'
  static REPO_FIELD = 'repo'
  static ROOT_FIELD = 'root'
  static KNOWN_FIELDS = Object.freeze([PlanRequest.ID_FIELD, PlanRequest.REPO_FIELD, PlanRequest.ROOT_FIELD])

  constructor({ outcome, story, repository, root, fields }) {
    ...las guardas de hoy...
    if ((outcome === PlanRequestOutcome.ACCEPTED) === (root === null)) {
      throw new Error(`outcome ${outcome} disagrees with its root, got ${root}`)
    }
    ...
    this.root = root
    ...
  }

  static accepted(story, repository, root) {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, story, repository, root, fields: [] })
  }

  static refused(outcome) {
    return new PlanRequest({ outcome, story: null, repository: null, root: null, fields: [] })
  }

  static withUnknownFields(fields) {
    return new PlanRequest({
      outcome: PlanRequestOutcome.UNKNOWN_FIELD, story: null, repository: null, root: null, fields,
    })
  }

  static from(raw) {
    ...lo de hoy hasta comprobar el repo...
    const where = parsed[PlanRequest.ROOT_FIELD]
    if (!CheckoutRoot.isWellFormed(where)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_ROOT)
    }
    return PlanRequest.accepted(new UserStoryKey(given), new RepositoryName(asked), new CheckoutRoot(where))
  }
}
```

En `PlanRefusal.#BY_OUTCOME` añade:

```js
    [PlanRequestOutcome.MALFORMED_ROOT]: () => new Refusal({
      status: 400,
      error: `${PlanRequest.ROOT_FIELD} must be an absolute path to a local clone such as ${CheckoutRoot.EXAMPLE}`,
    }),
```

En `StartPlanRoute.#accept`, la llamada al caso de uso pasa la raíz:

```js
      started = await startPlan.execute(
        new StartPlanParams({ story: asked.story, repository: asked.repository, root: asked.root })
      )
```

Y en `backend/src/application/actions/start-plan.js`, `StartPlanParams` guarda `root`:

```js
export class StartPlanParams {
  constructor({ story, repository, root }) {
    this.story = story
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }
}
```

La respuesta 202 no cambia.

- [ ] **Step 4: Correr y ver pasar**

`npx vitest run __tests__/infrastructure/plan-request.test.js __tests__/infrastructure/plan-refusal.test.js`
Esperado: PASS. `plan-refusal.test.js` ya comprueba que todo outcome rechazable tiene su respuesta.

- [ ] **Step 5: Tests del servidor que fallan**

En `backend/__tests__/infrastructure/api-server.test.js`:

En `StartPlanSpy` añade `this.roots = []` en el constructor y `this.roots.push(params.root.text)` en `execute`, junto a `this.repositories.push(...)`.

En `RunningApi` cambia:

```js
  static ROOT = '/repo/checkout'
  static ACCEPTED_BODY = `{"id":"ABC-123","repo":"owner/name","root":"/repo/checkout"}`
```

`ANSWER` no cambia. Cambia los bodies de estos dos tests para que lleven root:
- `the_id_that_reaches_the_agent_is_the_one_the_body_carried_and_not_a_default`: `'{"id":"MO_SHOP-42","repo":"owner/name","root":"/repo/checkout"}'`
- `the_repository_the_body_names_is_the_one_the_use_case_is_asked_to_open_the_issue_in`: `'{"id":"ABC-123","repo":"josemerca/ct-loop-sandbox","root":"/repo/checkout"}'`

Y añade:

```js
  it('the_root_the_body_names_is_the_one_the_use_case_is_asked_to_cut_the_worktree_in', async () => {
    const port = await RunningApi.listening()

    await RunningApi.post(port, '/start-plan', '{"id":"ABC-123","repo":"owner/name","root":"/Users/someone/repos/name"}')

    expect(RunningApi.spy.roots).toEqual(['/Users/someone/repos/name'])
  })

  it('a_body_with_no_root_is_refused_because_the_worktree_has_to_be_cut_somewhere', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${RunningApi.STORY}","repo":"${RunningApi.REPO}"}`)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe(
      '{"error":"root must be an absolute path to a local clone such as /Users/you/repos/name"}'
    )
  })

  it('a_root_that_is_not_an_absolute_path_is_refused_before_it_ever_becomes_an_argument_of_git', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      [
        '{"id":"ABC-123","repo":"owner/name","root":"repos/name"}',
        '{"id":"ABC-123","repo":"owner/name","root":"~/repos/name"}',
        '{"id":"ABC-123","repo":"owner/name","root":"/repos/name/"}',
        '{"id":"ABC-123","repo":"owner/name","root":"/repos/name; rm -rf ~"}',
        '{"id":"ABC-123","repo":"owner/name","root":""}',
        '{"id":"ABC-123","repo":"owner/name","root":123}',
      ].map((body) => RunningApi.startPlan(port, body))
    )

    expect(refused.map((response) => response.status)).toEqual([400, 400, 400, 202, 400, 400])
    expect(RunningApi.spy.asked).toEqual(['ABC-123'])
  })
```

Ojo con el cuarto body: `/repos/name; rm -rf ~` **es** una ruta absoluta bien formada (un segmento con espacios y un punto y coma) y se acepta; la lista lo deja escrito para que nadie crea que la forma protege de eso. Lo que protege es que la ruta nunca pasa por una shell: `ToolRunner` usa `execFile` con argv.

- [ ] **Step 6: Correr y ver pasar**

`npx vitest run __tests__/infrastructure/api-server.test.js`
Esperado: PASS.

- [ ] **Step 7: La vara**

`npx vitest run __tests__/yardstick.test.js`
Esperado: verde. `start-plan.test.js` sigue verde sin tocarlo porque el caso de uso aún no lee `root`; lo hará en la Task 2.

- [ ] **Step 8: Commit**

```bash
git add backend/src/domain/value-objects/checkout-root.js backend/src/infrastructure/start-plan-route.js backend/src/application/actions/start-plan.js backend/__tests__/infrastructure/plan-request.test.js backend/__tests__/infrastructure/api-server.test.js
git commit -m "feat: la petición de start-plan trae la ruta del clon donde cortar el worktree"
```

---

### Task 2: StartPlan confirma el clon antes de leer la historia y lo recuerda al arrancar

**Files:**
- Modify: `backend/src/domain/ports/workspace.js`, `backend/src/domain/value-objects/workspace-location.js`, `backend/src/application/actions/start-plan.js`
- Create: `backend/src/domain/ports/checkout-registry.js`
- Test: `backend/__tests__/application/start-plan.test.js`

**Interfaces:**
- Consumes: `CheckoutRoot`, `StartPlanParams({ story, repository, root })` de la Task 1.
- Produces: puerto `Workspace` con `confirm({ root, repository })`, `prepare({ issue, repository, root })`, `survey(root)`, `undo(located)`. Puerto `CheckoutRegistry` con `remember(root)` y `known()` (síncronos). `WorkspaceLocation({ root, path, branch })`, siendo `root` el texto de la ruta. `StartPlan` construido con `{ userStories, planIssues, workspace, planAgents, checkouts }`.

- [ ] **Step 1: Tests que fallan**

En `backend/__tests__/application/start-plan.test.js`:

Importa `CheckoutRoot` y `CheckoutRegistry`:

```js
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.js'
```

`WorkspaceDouble.LOCATED` pasa a llevar root:

```js
  static LOCATED = new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/7', branch: 'feat/7' })
```

`WorkspaceDouble` gana `confirm` y un escenario que lo rechaza. Su constructor acepta `{ undoFailure = null, confirmFailure = null }`; añade `this.confirmed = []` y:

```js
  static refusingToConfirm(said) {
    return new WorkspaceDouble(WorkspaceDouble.LOCATED, { confirmFailure: new WorkspaceNotPrepared(said) })
  }

  async confirm({ root, repository }) {
    this.confirmed.push({ root, repository })
    this.steps.push('confirm')
    if (this.confirmFailure !== null) throw this.confirmFailure
  }

  async prepare({ issue, repository, root }) {
    this.asked.push({ issue, repository, root })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
```

Nuevo doble del registro:

```js
class CheckoutRegistryDouble extends CheckoutRegistry {
  constructor() {
    super()
    this.remembered = []
  }

  remember(root) {
    this.remembered.push(root)
  }

  known() {
    return [...this.remembered]
  }
}
```

`Flow` gana `ROOT` y el registro:

```js
  static ROOT = new CheckoutRoot('/repo')

  constructor({ userStories, planIssues, workspace, planAgents, checkouts } = {}) {
    ...
    this.checkouts = checkouts ?? new CheckoutRegistryDouble()
    ...
  }

  async run(story = Flow.STORY) {
    return new StartPlan(this).execute(
      new StartPlanParams({ story, repository: Flow.REPOSITORY, root: Flow.ROOT })
    )
  }
```

Actualiza el test `the_workspace_is_prepared_for_the_issue_that_was_just_opened` para que espere `{ issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY, root: Flow.ROOT }`.

En el test `a_workspace_with_no_undo_at_all_does_not_replace_the_launch_failure_that_caused_the_cleanup`, el objeto suelto necesita `confirm`: `flow.workspace = { confirm: async () => undefined, prepare: async () => WorkspaceDouble.LOCATED }`.

En `a_port_that_nobody_implemented_says_so_instead_of_answering_undefined` añade:

```js
    await expect(new Workspace().confirm({ root: Flow.ROOT, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement confirm/)
    await expect(new Workspace().survey(Flow.ROOT)).rejects.toThrow(/must implement survey/)
    expect(() => new CheckoutRegistry().remember(Flow.ROOT)).toThrow(/must implement remember/)
    expect(() => new CheckoutRegistry().known()).toThrow(/must implement known/)
```

Y un `describe` nuevo:

```js
describe('StartPlan confirms the clone before anything is read or created', () => {
  it('the_clone_is_confirmed_to_hold_the_repository_before_the_story_is_even_read', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.workspace.confirmed).toEqual([{ root: Flow.ROOT, repository: Flow.REPOSITORY }])
    expect(flow.steps[0]).toBe('confirm')
  })

  it('a_clone_that_holds_another_repository_stops_the_flow_before_a_story_is_read_or_an_issue_is_opened', async () => {
    const flow = new Flow({ workspace: WorkspaceDouble.refusingToConfirm('/repo holds someone/else') })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(flow.userStories.asked).toEqual([])
    expect(flow.planIssues.asked).toEqual([])
    expect(flow.workspace.asked).toEqual([])
    expect(flow.planAgents.asked).toEqual([])
    expect(flow.checkouts.remembered).toEqual([])
  })

  it('the_clone_of_a_plan_that_started_is_remembered_so_the_sweep_knows_where_to_harvest', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.checkouts.remembered).toEqual([Flow.ROOT])
  })

  it('the_clone_is_remembered_only_after_the_agent_launched_because_an_undone_worktree_leaves_nothing_to_harvest', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing('cmux is not reachable') })

    await flow.refusal()

    expect(flow.checkouts.remembered).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

`npx vitest run __tests__/application/start-plan.test.js`
Esperado: FAIL, no resuelve `checkout-registry.js`.

- [ ] **Step 3: Puertos, value object y caso de uso**

`backend/src/domain/ports/checkout-registry.js`:

```js
export class CheckoutRegistry {
  remember(root) {
    throw new Error(`${this.constructor.name} must implement remember(root), asked to remember ${root}`)
  }

  known() {
    throw new Error(`${this.constructor.name} must implement known()`)
  }
}
```

`backend/src/domain/ports/workspace.js`:

```js
export class Workspace {
  async confirm({ root, repository }) {
    throw new Error(
      `${this.constructor.name} must implement confirm({ root, repository }), asked whether ${root} holds ${repository}`
    )
  }

  async prepare({ issue, repository, root }) {
    throw new Error(
      `${this.constructor.name} must implement prepare({ issue, repository, root }), asked for ${issue?.number} in ${repository} at ${root}`
    )
  }

  async survey(root) {
    throw new Error(`${this.constructor.name} must implement survey(root), asked about ${root}`)
  }

  async undo(located) {
    throw new Error(`${this.constructor.name} must implement undo(located), asked for ${located?.path}`)
  }
}
```

`backend/src/domain/value-objects/workspace-location.js`:

```js
export class WorkspaceLocation {
  constructor({ root, path, branch }) {
    this.root = root
    this.path = path
    this.branch = branch
    Object.freeze(this)
  }
}
```

`backend/src/application/actions/start-plan.js`:

```js
export class StartPlan {
  constructor({ userStories, planIssues, workspace, planAgents, checkouts }) {
    this.userStories = userStories
    this.planIssues = planIssues
    this.workspace = workspace
    this.planAgents = planAgents
    this.checkouts = checkouts
  }

  async execute(params) {
    await this.workspace.confirm({ root: params.root, repository: params.repository })
    const story = await this.userStories.detail(params.story)
    const issue = await this.planIssues.open({ story, repository: params.repository })
    await this.planIssues.claim({ issue, repository: params.repository })
    const located = await this.#prepare(params, issue)
    const agent = await this.#launch(params, issue, located)
    this.checkouts.remember(params.root)

    return new StartPlanResult({
      agent,
      watch: new PlanWatch({ issue, located, repository: params.repository, agent }),
    })
  }

  async #prepare(params, issue) {
    try {
      return await this.workspace.prepare({ issue, repository: params.repository, root: params.root })
    } catch (failure) {
      await this.#release(params, issue)
      throw failure
    }
  }
  ...#launch, #abandon, #release como hoy...
}
```

- [ ] **Step 4: Correr y ver pasar**

`npx vitest run __tests__/application/start-plan.test.js`
Esperado: PASS.

- [ ] **Step 5: La vara y los vecinos que construyen `WorkspaceLocation`**

`npx vitest run __tests__/yardstick.test.js __tests__/infrastructure/plan-events-route.test.js __tests__/infrastructure/cmux-plan-agents.test.js`
Esperado: verde. `WorkspaceLocation` sin `root` sigue construyéndose en los demás tests porque no hay guarda.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain backend/src/application/actions/start-plan.js backend/__tests__/application/start-plan.test.js
git commit -m "feat: start-plan confirma el clon antes de leer la historia y lo recuerda al arrancar"
```

---

### Task 3: GitWorkspace recibe la raíz por llamada

**Files:**
- Modify: `backend/src/infrastructure/git-workspace.js`
- Test: `backend/__tests__/infrastructure/git-workspace.test.js`

**Interfaces:**
- Consumes: puerto `Workspace` de la Task 2, `CheckoutRoot`.
- Produces: `GitWorkspace({ run, write, read, stderr })` sin `root`. `confirm({ root, repository })` lanza `WorkspaceNotRead` si git no responde al remoto, `WorkspaceNotUnderstood` si la URL no se lee, `WorkspaceNotPrepared` si es otro repo. `prepare({ issue, repository, root })` **no** vuelve a preguntar por el remoto. `survey(root)`. `undo(located)` corre `-C located.root`. Las localizaciones que devuelve llevan `root: root.text`.

- [ ] **Step 1: Tests que fallan**

En `backend/__tests__/infrastructure/git-workspace.test.js`:

Importa `CheckoutRoot` y añade a `GitDouble`:

```js
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

  static CHECKOUT = new CheckoutRoot(GitDouble.ROOT)
```

Quita `root: GitDouble.ROOT` de **todas** las construcciones de `GitWorkspace` (la de `GitDouble.workspace()` y las siete inline de los tests que redefinen `git.workspace = () => new GitWorkspace({...})`).

Añade a `GitDouble` tres atajos para no repetir argumentos:

```js
  prepared(issue = { number: 42 }) {
    return this.workspace().prepare({ issue, repository: GitDouble.REPOSITORY, root: GitDouble.CHECKOUT })
  }

  confirmed() {
    return this.workspace().confirm({ root: GitDouble.CHECKOUT, repository: GitDouble.REPOSITORY })
  }

  refusedTo(asking) {
    return asking.catch((cause) => cause)
  }
```

Sustituye cada `git.workspace().prepare({ issue: { number: 42 }, repository: GitDouble.REPOSITORY })` por `git.prepared()` (y el de `{ number: 7 }` por `git.prepared({ number: 7 })`). Es un cambio mecánico en unos treinta tests; hazlo con un reemplazo global y revisa el diff.

Los cinco tests que hoy prueban el remoto **a través de `prepare`** pasan a probar `confirm` y cambian su aserción sobre `worktree`:

```js
  it('confirming_asks_the_remote_of_the_root_it_was_given_and_nothing_else', async () => {
    const git = new GitDouble()

    await git.confirmed()

    expect(git.calls).toEqual([['-C', GitDouble.ROOT, 'remote', 'get-url', 'origin']])
  })

  it('a_root_that_is_a_different_repository_than_the_issue_is_refused_naming_both', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('git@github.com:someone/else.git') })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('someone/else')
    expect(refusal.message).toContain('owner/name')
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('an_https_remote_names_the_same_repository_as_its_ssh_form_so_neither_checkout_is_refused', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('https://github.com/owner/name.git') })

    await expect(git.confirmed()).resolves.toBeUndefined()
  })

  it('an_https_remote_without_the_git_suffix_names_the_same_repository_too', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('https://github.com/owner/name') })

    await expect(git.confirmed()).resolves.toBeUndefined()
  })

  it('a_remote_url_nobody_can_read_a_repository_out_of_is_our_broken_contract_with_git_and_not_a_refusal', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('/some/local/mirror') })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('/some/local/mirror')
  })

  it('a_remote_git_refuses_to_name_at_all_is_a_root_that_cannot_be_read_and_names_the_root', async () => {
    const git = new GitDouble({ remote: GitDouble.refused("fatal: cannot change to '/repo/checkout': No such file or directory") })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(WorkspaceNotRead)
    expect(refusal.message).toContain('No such file or directory')
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('preparing_never_asks_the_remote_again_because_the_root_was_confirmed_at_the_door', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.calls.some((argv) => argv.includes('get-url'))).toBe(false)
    expect(git.calls[0]).toEqual(['-C', GitDouble.ROOT, 'symbolic-ref', 'refs/remotes/origin/HEAD'])
  })
```

Borra el test `the_repository_under_the_root_is_asked_of_the_remote_before_a_worktree_is_cut_for_the_wrong_one` (lo sustituye el último de arriba).

La localización lleva la raíz:

```js
  it('the_location_it_answers_is_where_the_session_will_actually_run_and_the_root_it_was_cut_from', async () => {
    const located = await new GitDouble().prepared()

    expect(located.root).toBe('/repo/checkout')
    expect(located.path).toBe('/repo/checkout/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })
```

(sustituye a `the_location_it_answers_is_where_the_session_will_actually_run`).

`undo` corre contra la raíz de la localización y no contra ninguna otra. Renombra `undoing_a_location_runs_both_orders_against_the_root_and_never_against_whatever_directory_the_process_happens_to_be_in` y cámbialo así:

```js
  it('undoing_a_location_runs_both_orders_against_the_root_the_location_carries_and_never_against_the_process_directory', async () => {
    const git = new GitDouble()
    const located = new WorkspaceLocation({ root: '/elsewhere/clone', path: '/elsewhere/clone/.worktrees/42', branch: 'feat/42' })

    await git.workspace().undo(located)

    expect(git.calls).toEqual([
      ['-C', '/elsewhere/clone', 'worktree', 'remove', '--force', '/elsewhere/clone/.worktrees/42'],
      ['-C', '/elsewhere/clone', 'branch', '-D', 'feat/42'],
    ])
  })
```

El test `the_default_diagnostic_writer_still_writes_to_the_real_stderr_when_nobody_injects_one` construye `WorkspaceLocation` a mano: añade `root: GitDouble.ROOT`.

En `SurveyDouble`, `surveyed()` pasa la raíz: `return this.workspace().survey(GitDouble.CHECKOUT)`. Y un test nuevo:

```js
  it('every_prepared_workspace_the_survey_answers_carries_the_root_it_was_surveyed_from', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.root)).toEqual(['/repo/checkout', '/repo/checkout'])
  })
```

- [ ] **Step 2: Correr y ver fallar**

`npx vitest run __tests__/infrastructure/git-workspace.test.js`
Esperado: FAIL en los tests de `confirm` (`confirm is not a function`) y en los de `prepare` (la raíz llega `undefined`).

- [ ] **Step 3: El adaptador**

En `backend/src/infrastructure/git-workspace.js`:

```js
export class GitWorkspace extends Workspace {
  ...constantes como hoy...

  constructor({ run, write, read, stderr = (line) => process.stderr.write(line) }) {
    super()
    this.run = run
    this.write = write
    this.read = read
    this.stderr = stderr
  }

  ...las estáticas argvFor/pathFor/... como hoy, todas ya reciben root o path...

  async confirm({ root, repository }) {
    const held = await this.#repositoryOfRoot(root.text)
    if (held.text !== repository.text) {
      throw new WorkspaceNotPrepared(
        `${root.text} holds ${held.text} and the issue lives in ${repository.text}: cutting a worktree here would plan one repository inside another`
      )
    }
  }

  async prepare({ issue, repository, root }) {
    const base = await this.#declaredBase(root.text)
    const path = GitWorkspace.pathFor(root.text, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(root.text, issue, base)
    const located = new WorkspaceLocation({ root: root.text, path, branch })
    try {
      await this.#seed(located, issue, base)
    } catch (failure) {
      await this.#compensate(located)
      throw failure
    }

    return located
  }

  async survey(root) {
    const repository = await this.#repositoryOfRoot(root.text)
    const listed = await this.run(GitWorkspace.surveyArgvFor(root.text))
    if (listed.failed) {
      throw new WorkspaceNotRead(
        `git worktree list could not say what ${root.text} holds, so the checkout was not surveyed: ${listed.stderr.trim()}`
      )
    }

    return WorktreeListing.surveyOf({ printed: listed.stdout, root: root.text, repository })
  }

  async #repositoryOfRoot(root) {
    const asked = await this.run(GitWorkspace.remoteArgvFor(root))
    if (asked.failed) {
      throw new WorkspaceNotRead(
        `${root} does not name a ${GitWorkspace.REMOTE} remote, so the repository it holds cannot be confirmed: ${asked.stderr.trim()}`
      )
    }
    ...igual que hoy, con `root` en el mensaje de WorkspaceNotUnderstood...
  }

  async #declaredBase(root) {
    const asked = await this.run(GitWorkspace.defaultBranchArgvFor(root))
    ...igual que hoy, con `root` en el mensaje...
  }

  async undo(located) {
    try {
      await this.run(GitWorkspace.removeArgvFor(located.root, located.path))
      await this.run(GitWorkspace.deleteBranchArgvFor(located.root, located.branch))
    } catch (failure) {
      this.#warn(located, failure)
      throw failure
    }
  }

  async #cut(root, issue, base) {
    const argv = GitWorkspace.argvFor({ root, base, issue })
    ...
  }

  async #commonDirOf(located) {
    ...
    return isAbsolute(answered) ? answered : `${located.root}/${answered}`
  }
```

`#confirmRoot` desaparece (es `confirm`). En `WorktreeListing.#preparedIn(block, root)` la localización lleva la raíz:

```js
    return new PreparedWorkspace({ issueNumber: issue.number, located: new WorkspaceLocation({ root, path, branch }) })
```

- [ ] **Step 4: Correr y ver pasar**

`npx vitest run __tests__/infrastructure/git-workspace.test.js`
Esperado: PASS.

- [ ] **Step 5: La vara**

`npx vitest run __tests__/yardstick.test.js`
Esperado: verde.

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/git-workspace.js backend/__tests__/infrastructure/git-workspace.test.js
git commit -m "refactor: git-workspace recibe la raíz del clon por llamada y confirma en la puerta"
```

---

### Task 4: El registro de clones en memoria

**Files:**
- Create: `backend/src/infrastructure/memory-checkout-registry.js`
- Test: `backend/__tests__/infrastructure/memory-checkout-registry.test.js`

**Interfaces:**
- Consumes: `CheckoutRegistry` (Task 2), `CheckoutRoot` (Task 1).
- Produces: `MemoryCheckoutRegistry` sin argumentos de constructor; `remember(root)` con un `CheckoutRoot`; `known()` devuelve `CheckoutRoot[]` sin duplicados por texto.

- [ ] **Step 1: Test que falla**

```js
import { describe, it, expect } from 'vitest'
import { MemoryCheckoutRegistry } from '../../src/infrastructure/memory-checkout-registry.js'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

class Remembering {
  static ONE = new CheckoutRoot('/repos/one')
  static OTHER = new CheckoutRoot('/repos/other')

  static after(...roots) {
    const registry = new MemoryCheckoutRegistry()
    for (const root of roots) registry.remember(root)

    return registry.known().map((root) => root.text)
  }
}

describe('MemoryCheckoutRegistry', () => {
  it('it_is_the_registry_the_use_case_asks_for_and_not_a_lookalike', () => {
    expect(new MemoryCheckoutRegistry()).toBeInstanceOf(CheckoutRegistry)
  })

  it('a_server_that_just_started_knows_no_clone_so_the_first_sweep_has_nothing_to_survey', () => {
    expect(Remembering.after()).toEqual([])
  })

  it('a_clone_remembered_twice_is_known_once_so_the_sweep_never_surveys_the_same_checkout_twice', () => {
    expect(Remembering.after(Remembering.ONE, new CheckoutRoot('/repos/one'))).toEqual(['/repos/one'])
  })

  it('two_clones_are_both_known_in_the_order_their_plans_started', () => {
    expect(Remembering.after(Remembering.ONE, Remembering.OTHER)).toEqual(['/repos/one', '/repos/other'])
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

`npx vitest run __tests__/infrastructure/memory-checkout-registry.test.js`
Esperado: FAIL, no resuelve el módulo.

- [ ] **Step 3: El adaptador**

```js
import { CheckoutRegistry } from '../domain/ports/checkout-registry.js'

export class MemoryCheckoutRegistry extends CheckoutRegistry {
  constructor() {
    super()
    this.roots = new Map()
  }

  remember(root) {
    this.roots.set(root.text, root)
  }

  known() {
    return [...this.roots.values()]
  }
}
```

- [ ] **Step 4: Correr y ver pasar**

`npx vitest run __tests__/infrastructure/memory-checkout-registry.test.js`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/memory-checkout-registry.js backend/__tests__/infrastructure/memory-checkout-registry.test.js
git commit -m "feat: registro en memoria de los clones que la API ha atendido"
```

---

### Task 5: La cosecha corre en la raíz del worktree

**Files:**
- Modify: `backend/src/domain/ports/harvest.js`, `backend/src/application/actions/harvest-delivery.js`, `backend/src/infrastructure/dispatch-check-harvest.js`
- Test: `backend/__tests__/application/harvest-delivery.test.js`, `backend/__tests__/infrastructure/dispatch-check-harvest.test.js`

**Interfaces:**
- Consumes: `WorkspaceLocation.root` (Task 2).
- Produces: `Harvest.collect({ issueNumber, repository, root })` donde `root` es el texto de la ruta. `DispatchCheckHarvest({ node, dispatchCheck })` sin `root`.

- [ ] **Step 1: Tests que fallan**

En `backend/__tests__/application/harvest-delivery.test.js`, `HarvestDouble.PREPARED` lleva raíz y la aserción la espera:

```js
  static PREPARED = new PreparedWorkspace({
    issueNumber: 42,
    located: new WorkspaceLocation({
      root: HarvestDouble.ROOT, path: `${HarvestDouble.ROOT}/.worktrees/42`, branch: 'feat/42',
    }),
  })
```

Cambia la aserción de `the_plugin_is_asked_for_the_issue_number_of_the_workspace_and_never_for_the_workspace_itself`:

```js
    expect(harvest.asked).toEqual([{ issueNumber: 42, repository: HarvestDouble.REPOSITORY, root: '/repo/checkout' }])
```

Añade:

```js
  it('the_root_the_workspace_was_cut_from_is_the_one_the_plugin_is_told_to_run_in_so_two_clones_never_mix', async () => {
    const harvest = HarvestDouble.answering(HarvestOutcome.WAITING)

    await harvest.harvested(new PreparedWorkspace({
      issueNumber: 7,
      located: new WorkspaceLocation({ root: '/elsewhere/clone', path: '/elsewhere/clone/.worktrees/7', branch: 'feat/7' }),
    }))

    expect(harvest.asked[0].root).toBe('/elsewhere/clone')
  })
```

El `PreparedWorkspace` del test `each_prepared_workspace_is_harvested_under_its_own_number...` también añade `root: HarvestDouble.ROOT` a su `WorkspaceLocation`. En el test del puerto sin implementar, la llamada pasa `root: HarvestDouble.ROOT`.

En `backend/__tests__/infrastructure/dispatch-check-harvest.test.js`, `HarvestDouble.harvest()` deja de pasar `root`, y `asked()` lo pasa al `collect`:

```js
  harvest() {
    return new DispatchCheckHarvest({
      dispatchCheck: HarvestDouble.CHECK,
      node: (argv, options) => {
        this.calls.push([argv, options])
        return Promise.resolve(this.said)
      },
    })
  }

  asked(root = HarvestDouble.ROOT) {
    return this.harvest().collect({
      issueNumber: HarvestDouble.ISSUE,
      repository: HarvestDouble.REPOSITORY,
      root,
    })
  }
```

Renombra el primer test y añade otro:

```js
  it('the_command_it_runs_is_the_one_the_plugin_publishes_and_it_runs_in_the_root_the_worktree_was_cut_from', async () => {
    const asked = HarvestDouble.collected()

    await asked.asked('/elsewhere/clone')

    expect(asked.calls[0][0]).toEqual([
      '/plugin/scripts/dispatch-check.mjs', '7', '--repo', 'owner/name', '--collect',
    ])
    expect(asked.calls[0][1]).toEqual({ cwd: '/elsewhere/clone' })
  })
```

- [ ] **Step 2: Correr y ver fallar**

`npx vitest run __tests__/application/harvest-delivery.test.js __tests__/infrastructure/dispatch-check-harvest.test.js`
Esperado: FAIL, `root` no llega al `collect` y el `cwd` sigue siendo el del constructor.

- [ ] **Step 3: Puerto, caso de uso y adaptador**

`backend/src/domain/ports/harvest.js`:

```js
export class Harvest {
  async collect({ issueNumber, repository, root }) {
    throw new Error(
      `${this.constructor.name} must implement collect({ issueNumber, repository, root }), asked for ${issueNumber} in ${repository} at ${root}`
    )
  }
}
```

`backend/src/application/actions/harvest-delivery.js`, en `execute`:

```js
      outcome: await this.harvest.collect({
        issueNumber: params.prepared.issueNumber,
        repository: params.repository,
        root: params.prepared.located.root,
      }),
```

`backend/src/infrastructure/dispatch-check-harvest.js`:

```js
  constructor({ node, dispatchCheck }) {
    super()
    this.node = node
    this.dispatchCheck = dispatchCheck
  }

  async collect({ issueNumber, repository, root }) {
    const said = await this.node(
      DispatchCheckHarvest.argvFor({ dispatchCheck: this.dispatchCheck, issueNumber, repository }),
      { cwd: root }
    )
    ...igual que hoy...
  }
```

- [ ] **Step 4: Correr y ver pasar**

`npx vitest run __tests__/application/harvest-delivery.test.js __tests__/infrastructure/dispatch-check-harvest.test.js`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/domain/ports/harvest.js backend/src/application/actions/harvest-delivery.js backend/src/infrastructure/dispatch-check-harvest.js backend/__tests__/application/harvest-delivery.test.js backend/__tests__/infrastructure/dispatch-check-harvest.test.js
git commit -m "refactor: la cosecha corre en la raíz del clon del que se cortó el worktree"
```

---

### Task 6: El reloj barre cada clon conocido

**Files:**
- Modify: `backend/src/application/queries/survey-workspaces.js`, `backend/src/infrastructure/harvest-clock.js`
- Test: `backend/__tests__/application/survey-workspaces.test.js`, `backend/__tests__/infrastructure/harvest-clock.test.js`

**Interfaces:**
- Consumes: `Workspace.survey(root)` (Task 2), `CheckoutRegistry.known()` (Task 2).
- Produces: `SurveyWorkspacesParams(root)` con `.root`; `SurveyWorkspaces.execute(params)`. `HarvestClock({ checkouts, survey, harvest, sleep, stderr })` donde `checkouts()` devuelve `CheckoutRoot[]` y `survey(root)` devuelve `SurveyWorkspacesResult`.

- [ ] **Step 1: Tests de la query que fallan**

En `backend/__tests__/application/survey-workspaces.test.js` importa `SurveyWorkspacesParams` y `CheckoutRoot`, y en `WorkspaceDouble`:

```js
import { SurveyWorkspaces, SurveyWorkspacesParams } from '../../src/application/queries/survey-workspaces.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

  static CHECKOUT = new CheckoutRoot(WorkspaceDouble.ROOT)

  constructor(answer) {
    super()
    this.answer = answer
    this.surveys = []
  }

  async survey(root) {
    this.surveys.push(root)
    if (this.answer instanceof Error) throw this.answer

    return this.answer
  }

  asked(root = WorkspaceDouble.CHECKOUT) {
    return new SurveyWorkspaces({ workspace: this }).execute(new SurveyWorkspacesParams(root))
  }
```

`preparedFor` añade `root: WorkspaceDouble.ROOT` a su `WorkspaceLocation`. El test `the_checkout_is_asked_once_and_told_nothing_because_the_checkout_is_what_decides` pasa a:

```js
  it('the_clone_named_in_the_params_is_the_one_surveyed_and_it_is_asked_once', async () => {
    const workspace = WorkspaceDouble.holding(42)
    const elsewhere = new CheckoutRoot('/elsewhere/clone')

    await workspace.asked(elsewhere)

    expect(workspace.surveys).toEqual([elsewhere])
  })
```

Y el del puerto sin implementar pasa `WorkspaceDouble.CHECKOUT` a `survey`.

- [ ] **Step 2: Correr y ver fallar**

`npx vitest run __tests__/application/survey-workspaces.test.js`
Esperado: FAIL, `SurveyWorkspacesParams` no existe.

- [ ] **Step 3: La query**

```js
export class SurveyWorkspacesParams {
  constructor(root) {
    this.root = root
    Object.freeze(this)
  }
}

export class SurveyWorkspacesResult { ...como hoy... }

export class SurveyWorkspaces {
  constructor({ workspace }) {
    this.workspace = workspace
  }

  async execute(params) {
    return new SurveyWorkspacesResult({ survey: await this.workspace.survey(params.root) })
  }
}
```

- [ ] **Step 4: Correr y ver pasar**

`npx vitest run __tests__/application/survey-workspaces.test.js`
Esperado: PASS.

- [ ] **Step 5: Tests del reloj que fallan**

En `backend/__tests__/infrastructure/harvest-clock.test.js`, la fixture `Sweeping` pasa a conocer clones. Importa `CheckoutRoot` y reescribe la fixture así (los tests existentes siguen funcionando con un solo clon):

```js
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

class Sweeping {
  static ROOT = '/repo/checkout'
  static CHECKOUT = new CheckoutRoot(Sweeping.ROOT)
  static ELSEWHERE = new CheckoutRoot('/elsewhere/clone')
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static SURVEY = 'survey'
  static SLEEP = 'sleep'

  constructor({ checkouts, harvests, known = [Sweeping.CHECKOUT], sweeps = 1, stoppingAt = null }) {
    this.checkouts = new Map(checkouts)
    this.harvests = new Map(harvests)
    this.known = known
    this.sweeps = sweeps
    this.stoppingAt = stoppingAt
    this.trace = []
    this.written = []
    this.slept = 0
    this.clock = null
  }

  static preparedFor(issueNumber, root = Sweeping.ROOT) {
    return new PreparedWorkspace({
      issueNumber,
      located: new WorkspaceLocation({
        root,
        path: `${root}/.worktrees/${issueNumber}`,
        branch: `feat/${issueNumber}`,
      }),
    })
  }

  static checkoutHolding(harvests, root = Sweeping.ROOT) {
    return new SurveyWorkspacesResult({
      survey: new WorkspaceSurvey({
        repository: Sweeping.REPOSITORY,
        prepared: harvests.map(([issueNumber]) => Sweeping.preparedFor(issueNumber, root)),
      }),
    })
  }

  static answering(harvests) {
    return new Sweeping({ checkouts: [[Sweeping.ROOT, [Sweeping.checkoutHolding(harvests)]]], harvests })
  }

  static answeringTwice(harvests) {
    return new Sweeping({
      checkouts: [[Sweeping.ROOT, [Sweeping.checkoutHolding(harvests), Sweeping.checkoutHolding(harvests)]]],
      harvests,
      sweeps: 2,
    })
  }

  static unableToSurvey(failure) {
    return new Sweeping({ checkouts: [[Sweeping.ROOT, [failure]]], harvests: [] })
  }

  static stoppingDuring(issueNumber, harvests) {
    return new Sweeping({
      checkouts: [[Sweeping.ROOT, [Sweeping.checkoutHolding(harvests)]]],
      harvests,
      stoppingAt: issueNumber,
    })
  }

  static knowingTwo({ here, there }) {
    return new Sweeping({
      known: [Sweeping.CHECKOUT, Sweeping.ELSEWHERE],
      checkouts: [
        [Sweeping.ROOT, [here instanceof Error ? here : Sweeping.checkoutHolding(here)]],
        [Sweeping.ELSEWHERE.text, [Sweeping.checkoutHolding(there, Sweeping.ELSEWHERE.text)]],
      ],
      harvests: [...(here instanceof Error ? [] : here), ...there],
    })
  }

  static knowingNone() {
    return new Sweeping({ known: [], checkouts: [], harvests: [] })
  }

  #surveyed(root) {
    this.trace.push(`${Sweeping.SURVEY} ${root.text}`)
    const answers = this.checkouts.get(root.text) ?? []
    if (answers.length === 0) {
      throw new Error(`${root.text} was surveyed more times than this test scripted an answer for`)
    }
    const answer = answers.shift()
    if (answer instanceof Error) return Promise.reject(answer)

    return Promise.resolve(answer)
  }

  ...#harvested y #slept como hoy...

  async run() {
    this.clock = new HarvestClock({
      checkouts: () => this.known,
      survey: (root) => this.#surveyed(root),
      harvest: (prepared, repository) => this.#harvested(prepared, repository),
      sleep: () => this.#slept(),
      stderr: (line) => this.written.push(line),
    })
    await this.clock.start()

    return this
  }
  ...
}
```

Como la traza de `survey` ahora lleva la raíz, actualiza las aserciones de traza existentes: cada `'survey'` pasa a `'survey /repo/checkout'` (en `the_first_sweep_happens_at_once...`, `it_waits_only_after_the_sweep_is_over...`, `a_checkout_that_could_not_be_surveyed...`, `a_bug_of_ours_while_surveying...`, `a_bug_of_ours_while_harvesting...` y `stopping_lets_the_sweep_in_flight_finish...`).

Añade al `describe('HarvestClock')`:

```js
  it('every_clone_the_registry_knows_is_surveyed_and_harvested_in_one_sweep', async () => {
    const swept = await Sweeping.knowingTwo({
      here: [[42, HarvestOutcome.COLLECTED]],
      there: [[7, HarvestOutcome.WAITING]],
    }).run()

    expect(swept.trace).toEqual([
      'survey /repo/checkout', 'harvest #42',
      'survey /elsewhere/clone', 'harvest #7',
      'sleep',
    ])
  })

  it('a_clone_that_cannot_be_surveyed_leaves_its_line_and_the_next_clone_is_still_surveyed', async () => {
    const swept = await Sweeping.knowingTwo({
      here: new WorkspaceNotRead('/repo/checkout does not name a origin remote'),
      there: [[7, HarvestOutcome.COLLECTED]],
    }).run()

    expect(swept.written).toEqual([
      'harvest sweep: could not survey the checkout: /repo/checkout does not name a origin remote\n',
      'harvest #7: collected\n',
    ])
    expect(swept.trace).toEqual(['survey /repo/checkout', 'survey /elsewhere/clone', 'harvest #7', 'sleep'])
  })

  it('a_server_that_knows_no_clone_yet_sweeps_nothing_and_just_waits_for_the_next_turn', async () => {
    const swept = await Sweeping.knowingNone().run()

    expect(swept.trace).toEqual(['sleep'])
    expect(swept.written).toEqual([])
  })
```

- [ ] **Step 6: Correr y ver fallar**

`npx vitest run __tests__/infrastructure/harvest-clock.test.js`
Esperado: FAIL, el reloj ignora `checkouts` y llama a `survey()` sin raíz.

- [ ] **Step 7: El reloj**

En `backend/src/infrastructure/harvest-clock.js`:

```js
export class HarvestClock {
  constructor({ checkouts, survey, harvest, sleep, stderr }) {
    this.checkouts = checkouts
    this.survey = survey
    this.harvest = harvest
    this.sleep = sleep
    this.stderr = stderr
    this.sweeping = false
  }

  ...start y stop como hoy...

  async sweep() {
    for (const root of this.checkouts()) {
      await this.#sweepCheckout(root)
    }
  }

  async #sweepCheckout(root) {
    let checkout
    try {
      checkout = (await this.survey(root)).survey
    } catch (failure) {
      if (!(failure instanceof PlanFailure)) throw failure
      this.stderr(SweepLine.forSurvey(failure))
      return
    }
    for (const prepared of checkout.prepared) {
      await this.#collect(prepared, checkout.repository)
    }
  }

  ...#say y #collect como hoy...
}
```

- [ ] **Step 8: Correr y ver pasar**

`npx vitest run __tests__/infrastructure/harvest-clock.test.js`
Esperado: PASS.

- [ ] **Step 9: La vara y commit**

`npx vitest run __tests__/yardstick.test.js` → verde.

```bash
git add backend/src/application/queries/survey-workspaces.js backend/src/infrastructure/harvest-clock.js backend/__tests__/application/survey-workspaces.test.js backend/__tests__/infrastructure/harvest-clock.test.js
git commit -m "feat: el reloj de cosecha barre cada clon que el registro conoce"
```

---

### Task 7: El arranque deja de mirar dónde nació

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Test: `backend/__tests__/infrastructure/ct-api-real-process.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la API arranca desde cualquier directorio.

- [ ] **Step 1: El test del entrypoint que falla**

En `backend/__tests__/infrastructure/ct-api-real-process.test.js`, importa `tmpdir` de `node:os` y sustituye el segundo test por:

```js
  it('a_whole_request_reaches_git_first_so_no_story_is_read_for_a_clone_nobody_has', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })
    const nowhere = join(tmpdir(), 'ct-api-never-cloned')

    const response = await Entrypoint.startPlan(
      port,
      `{"id":"ZZZ-999999","repo":"josemerca/nope","root":${JSON.stringify(nowhere)}}`
    )

    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/^could not start the plan: .+ does not name a origin remote/)
  })
```

- [ ] **Step 2: Correr y ver fallar**

`npx vitest run __tests__/infrastructure/ct-api-real-process.test.js`
Esperado: FAIL, el proceso muere al construir `GitWorkspace` con `root` o `StartPlan` sin `checkouts`; o responde otra cosa. Lee el stderr del hijo si hace falta añadiendo temporalmente `child.stderr.pipe(process.stderr)` en `listening`, y quítalo después.

- [ ] **Step 3: El cableado**

En `backend/src/infrastructure/ct-api.mjs`:

```js
import { MemoryCheckoutRegistry } from './memory-checkout-registry.js'
import { SurveyWorkspaces, SurveyWorkspacesParams } from '../application/queries/survey-workspaces.js'

  static #startPlan(workspace, planAgents, planIssues, checkouts) {
    return new StartPlan({
      userStories: new AcliUserStories({ acli: CtApi.#talkingTo(AcliUserStories.BIN, ExternalTool) }),
      planIssues,
      workspace,
      planAgents,
      checkouts,
    })
  }

  static #harvestClock({ workspace, checkouts, environment }) {
    const surveyWorkspaces = new SurveyWorkspaces({ workspace })
    const harvestDelivery = new HarvestDelivery({
      harvest: new DispatchCheckHarvest({
        node: CtApi.#tool(process.execPath, {
          budgetMs: CtApi.#HARVEST_TIMEOUT_MS,
          env: Invocation.harvestEnvironment(environment, {
            ghTimeoutMs: CtApi.#SECONDS_FOR_GH_IN_A_HARVEST * 1000,
          }),
        }),
        dispatchCheck: PluginTree.dispatchCheck(),
      }),
    })

    return new HarvestClock({
      checkouts: () => checkouts.known(),
      survey: (root) => surveyWorkspaces.execute(new SurveyWorkspacesParams(root)),
      harvest: (prepared, repository) =>
        harvestDelivery.execute(new HarvestDeliveryParams({ prepared, repository })),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_SWEEPS),
      stderr: (line) => process.stderr.write(line),
    })
  }

  static async run(argv, environment) {
    ...
    const git = CtApi.#tool(GitWorkspace.BIN)
    const workspace = new GitWorkspace({
      run: git,
      write: Disk.write,
      read: Disk.read,
      stderr: (line) => process.stderr.write(line),
    })
    const checkouts = new MemoryCheckoutRegistry()
    ...
    const server = new ApiServer({
      port: asked.port,
      startPlan: CtApi.#startPlan(workspace, planAgents, planIssues, checkouts),
      ...
    })
    ...
    CtApi.#sweepUntilItBreaks(CtApi.#harvestClock({ workspace, checkouts, environment }))
  }
```

Borra `const root = process.cwd()`. Comprueba con `grep -n "cwd()" backend/src/infrastructure/ct-api.mjs` que no queda ninguno.

- [ ] **Step 4: Correr y ver pasar**

`npx vitest run __tests__/infrastructure/ct-api-real-process.test.js`
Esperado: PASS.

- [ ] **Step 5: Arrancar desde fuera del repo, a mano**

Desde un directorio que no sea ningún clon (por ejemplo `cd /tmp`), `CT_API_PORT=0 node <ruta-absoluta>/backend/src/infrastructure/ct-api.mjs` imprime `{"port":N}` y sigue vivo. Un `curl -s -X POST -H 'Content-Type: application/json' -d '{"id":"ABC-1","repo":"owner/name","root":"/tmp"}' http://127.0.0.1:N/start-plan` responde 503 con `does not name a origin remote`. Mátalo con Ctrl-C.

- [ ] **Step 6: La vara**

`npx vitest run __tests__/yardstick.test.js`
Esperado: verde. La suite entera (`npx vitest run`, unos seis minutos) la lanza el coordinador al cerrar esta tarea, no quien la implementa.

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/ct-api.mjs backend/__tests__/infrastructure/ct-api-real-process.test.js
git commit -m "feat: la API se arranca desde cualquier directorio y cada petición trae su clon"
```

---

### Task 8: El formulario pide la ruta del clon

**Files:**
- Create: `frontend/src/app/start-plan/CheckoutRoot.ts`
- Modify: `frontend/src/app/start-plan/StartPlan.types.ts`, `frontend/src/app/start-plan/client.ts`, `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx`, `frontend/src/__scenarios__/StartPlanMother.ts`, `frontend/src/pages/home/__tests__/helpers.tsx`
- Test: `frontend/src/pages/home/__tests__/Home.startPlan.test.tsx`

Antes de empezar: carga la skill `frontend-engineering:frontend-best-practices`.

**Interfaces:**
- Consumes: el contrato HTTP de la Task 1: `{"id","repo","root"}`; 400 con `root must be an absolute path to a local clone such as /Users/you/repos/name`.
- Produces: `CheckoutRoot` con `EXAMPLE` e `isWellFormed`; `StartPlanRequest` con `root`; etiqueta de formulario `Ruta del clon local`.

- [ ] **Step 1: Escenarios y helpers**

`frontend/src/__scenarios__/StartPlanMother.ts`:

```ts
const ROOT = '/Users/you/repos/name'
const REQUEST_BODY = '{"id":"ABC-123","repo":"owner/name","root":"/Users/you/repos/name"}'

const malformedRoot = () => ({
  status: 400,
  body: '{"error":"root must be an absolute path to a local clone such as /Users/you/repos/name"}',
})

export const StartPlanMother = {
  TICKET,
  REPO,
  ROOT,
  ISSUE,
  AGENT,
  REQUEST_BODY,
  started,
  malformedId,
  malformedRepo,
  malformedRoot,
  planNotStarted,
}
```

`started()` no cambia: la respuesta no devuelve `root`.

`frontend/src/pages/home/__tests__/helpers.tsx`:

```tsx
const typeRoot = async (user: User, root: string) => {
  await user.type(screen.getByLabelText('Ruta del clon local'), root)
}

const startPlan = async (user: User) => {
  await typeTicket(user, StartPlanMother.TICKET)
  await typeRepository(user, StartPlanMother.REPO)
  await typeRoot(user, StartPlanMother.ROOT)
  await pressStart(user)
}
```

y exporta `typeRoot`.

- [ ] **Step 2: Tests que fallan**

En `frontend/src/pages/home/__tests__/Home.startPlan.test.tsx`, importa `typeRoot`. Los dos tests de botón deshabilitado rellenan también los otros dos campos, y se añade uno para la raíz:

```tsx
  it('should keep the start button disabled until the ticket key is well formed', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeRepository(user, StartPlanMother.REPO)
    await typeRoot(user, StartPlanMother.ROOT)

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await typeTicket(user, 'abc-1')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Clave del ticket'))
    await typeTicket(user, 'MO_SHOP-42')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should keep the start button disabled until the repository is well formed', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRoot(user, StartPlanMother.ROOT)

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await typeRepository(user, 'name')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Repositorio'))
    await typeRepository(user, 'owner/name')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should keep the start button disabled until the clone root is an absolute path', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()
    await typeTicket(user, StartPlanMother.TICKET)
    await typeRepository(user, StartPlanMother.REPO)

    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await typeRoot(user, 'repos/name')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ruta del clon local'))
    await typeRoot(user, '/Users/you/repos/name/')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Ruta del clon local'))
    await typeRoot(user, '/Users/you/repos/name')
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeEnabled()
  })

  it('should keep the three fields filled after a plan starts', async () => {
    backendAnswering(StartPlanMother.started())
    const { user } = openHome()

    await startPlan(user)

    await screen.findByRole('status')
    expect(screen.getByLabelText('Clave del ticket')).toHaveValue(StartPlanMother.TICKET)
    expect(screen.getByLabelText('Repositorio')).toHaveValue(StartPlanMother.REPO)
    expect(screen.getByLabelText('Ruta del clon local')).toHaveValue(StartPlanMother.ROOT)
  })

  it('should show the backend refusal of a malformed root as it came', async () => {
    backendAnswering(StartPlanMother.malformedRoot())
    const { user } = openHome()

    await startPlan(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'root must be an absolute path to a local clone such as /Users/you/repos/name',
    )
  })
```

(`should keep the three fields filled after a plan starts` sustituye a `should keep both fields filled after a plan starts`.) El test `should send exactly the payload the backend contract declares` ya compara con `StartPlanMother.REQUEST_BODY`, que ahora lleva `root`.

- [ ] **Step 3: Correr y ver fallar**

`npm test --prefix frontend`
Esperado: FAIL, no existe el campo `Ruta del clon local`.

- [ ] **Step 4: El value object, los tipos, el cliente y el formulario**

`frontend/src/app/start-plan/CheckoutRoot.ts`:

```ts
const SHAPE = /^\/(?:[^/\n]+(?:\/[^/\n]+)*)?$/
const EXAMPLE = '/Users/you/repos/name'

const isWellFormed = (text: string): boolean => SHAPE.test(text)

export const CheckoutRoot = {
  EXAMPLE,
  isWellFormed,
}
```

`frontend/src/app/start-plan/StartPlan.types.ts`: `StartPlanRequest` gana `root: string`. `StartedPlan` no cambia.

`frontend/src/app/start-plan/client.ts`:

```ts
const start = async ({ id, repo, root }: StartPlanRequest): Promise<StartPlanOutcome> => {
  ...
      body: JSON.stringify({ id, repo, root }),
  ...
```

`frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx`:

```tsx
import { CheckoutRoot } from 'app/start-plan/CheckoutRoot'

  const [root, setRoot] = useState('')

  const canStart =
    TicketKey.isWellFormed(ticketKey) &&
    RepositoryName.isWellFormed(repository) &&
    CheckoutRoot.isWellFormed(root) &&
    !isSending

  ...
    const outcome = await StartPlanClient.start({ id: ticketKey, repo: repository, root })
  ...
      <FormField label="Ruta del clon local" message={`Absoluta, con la forma ${CheckoutRoot.EXAMPLE}`}>
        <Input
          placeholder={CheckoutRoot.EXAMPLE}
          value={root}
          disabled={isSending}
          autoComplete="off"
          onChange={(event) => setRoot(event.target.value)}
        />
      </FormField>
```

El campo va después de "Repositorio" y antes de las acciones.

- [ ] **Step 5: Correr y ver pasar**

`npm test --prefix frontend` → PASS.
`npm run build --prefix frontend` → el `tsc --noEmit` pasa sin errores y `vite build` deja `frontend/dist`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/start-plan frontend/src/__scenarios__/StartPlanMother.ts frontend/src/pages/home/__tests__/helpers.tsx frontend/src/pages/home/__tests__/Home.startPlan.test.tsx
git commit -m "feat: el formulario pide la ruta del clon local y la manda en start-plan"
```

---

### Task 9: Documentación que miente

**Files:**
- Modify: `frontend/README.md` (línea 13, «del ticket y el repositorio»), `README.md` (línea 8, «barre el checkout cada minuto»)

- [ ] **Step 1: Corregir las dos frases**

En `frontend/README.md`, donde dice que el formulario tiene la clave del ticket y el repositorio, añade la ruta del clon local. En `README.md`, «barre el checkout cada minuto» pasa a «barre cada minuto los clones que ha atendido». Nada más: no se documenta lo que no cambió.

- [ ] **Step 2: Commit**

```bash
git add README.md frontend/README.md
git commit -m "docs: el formulario pide la ruta del clon y el barrido cubre los clones atendidos"
```

---

### Task 10: Prueba de punta a punta y cierre de la rama

Esta tarea la hace una persona: cmux sólo admite procesos nacidos dentro de él y las sesiones de Orca no cuentan.

- [ ] **Step 1: Arrancar la API desde este repo**

En una pestaña de cmux, desde `/Users/acapdev/orca/workspaces/control-tower-plugin/api_server` (no desde repo-pulse), `make run-frontend`.

- [ ] **Step 2: Pedir faena en repo-pulse**

En la página, ticket `XOP-4909`, repositorio `jjponz/repo-pulse`, ruta `/Users/acapdev/repos/repo-pulse`. Esperado: 202, issue nuevo en repo-pulse, worktree en `/Users/acapdev/repos/repo-pulse/.worktrees/<n>`, sesión de cmux abierta ahí. Es exactamente el caso que el 2026-09-03 murió con `holds josemerca/control-tower-plugin and the issue lives in jjponz/repo-pulse`.

- [ ] **Step 3: Pedir faena con una ruta equivocada**

Misma página, ruta `/Users/acapdev/repos/control-tower-plugin`. Esperado: 503 con `holds josemerca/control-tower-plugin and the issue lives in jjponz/repo-pulse` y **ningún issue nuevo** en repo-pulse (`gh issue list -R jjponz/repo-pulse --limit 3`).

- [ ] **Step 4: Retirar el diseño y el plan de la rama**

Regla del repo: los documentos se escriben en un commit y se retiran en otro; su contenido va al cuerpo de la pull request.

```bash
git rm docs/superpowers/specs/2026-09-03-el-clon-viaja-en-la-peticion-design.md docs/superpowers/plans/2026-09-03-el-clon-viaja-en-la-peticion.md
git commit -m "docs: el diseño y el plan de este cambio no viajan en la rama"
```

El cuerpo de la pull request lleva las secciones 1, 3 y 9 de la spec: el problema, las decisiones tomadas y descartadas, y lo que este cambio no hace (el registro en memoria que no sobrevive al reinicio).
