# Implement-plan endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /implement-plan`, which answers the human's GO on the plan issue so the agent that is parked at the `plan` gate resumes and implements, and make `POST /start-plan` dispatch for real with `ct-next` instead of echoing into a cmux tab.

**Architecture:** The backend drives the plugin by child process and never reimplements dispatch. `/start-plan` runs `ct-next.mjs`, reads the issue number and the GO nonce off its stdout, and hands both to the front; the front gives them back when a human presses the button, so neither endpoint keeps state. The GO is not a new port: the collaborator on the other side is still GitHub's issues, so `PlanIssues` grows `answerGo()`.

**Tech Stack:** Node 24 ESM, express 5, vitest 4. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-01-implement-plan-endpoint-design.md`

## Global Constraints

- **The yardstick binds entire, old module or new**: `backend/conventions/` (README, architecture, domain, infrastructure, testing) plus `plugin/conventions/style.md`, `defects.md` and `decisions.md`. Read them before writing code; there is no declared debt under `backend/`.
- **No prose in the code**: no comments, no docstrings. Rename instead of explaining.
- **Code is written in English**: modules, types, methods, variables, test names, error messages.
- **No free function at module level**: every function hangs off a type.
- **`plugin/` never imports from `backend/`.** The backend imports the plugin's pure renderers and readers; what the plugin does not export is copied as a literal **with a contract test that renders the plugin's own output and compares**.
- **A non-zero exit code is data, not an exception.** `ToolRunner` never throws; the adapter interprets `output.failed` and the error channel.
- **The caller declares whether its call is safe to repeat.** Reads are `safeToRepeat: true`; writes (`issue create`, `issue comment`) are `safeToRepeat: false`.
- **One status per decision of whoever receives it**: 4xx fix the request, 503 the tool refused, 502 the tool answered something unreadable.
- **Closed vocabularies, never loose strings**, dispatched exhaustively with no catch-all branch.
- **Suite is run from `backend/`.** Fast subset: `npx vitest run --exclude '**/*-real-process.test.js'`. Whole suite before handing anything over.
- **Every test file's fixture class is its mother**: named scenarios with sensible defaults, and a scripted double raises when asked for an answer nobody wrote.

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/domain/value-objects/go.js` | **Create.** The GO: the issue it answers and the nonce that closes it, with both guards |
| `backend/src/domain/exceptions.js` | **Modify.** Add `GoFailure` and `GoNotAnswered` |
| `backend/src/domain/ports/plan-issues.js` | **Modify.** Add `answerGo({ go, repository })` |
| `backend/src/infrastructure/gh-plan-issues.js` | **Modify.** Implement `answerGo` with `goBody` from the plugin |
| `backend/src/application/actions/implement-plan.js` | **Create.** The use case and its `Params` |
| `backend/src/infrastructure/http.js` | **Modify.** Host `Refusal` and the too-large body projection, which every endpoint shares |
| `backend/src/infrastructure/start-plan-route.js` | **Modify.** Import `Refusal` from `http.js`; drop the transport-level outcome |
| `backend/src/infrastructure/api-server.js` | **Modify.** Project 413 without knowing any endpoint; mount the new route |
| `backend/src/infrastructure/implement-plan-route.js` | **Create.** The controller, its request model, its refusal projections |
| `backend/src/infrastructure/ct-next-plan-agents.js` | **Create.** The `PlanAgents` adapter that dispatches with `ct-next`, and the reader of its stdout |
| `backend/src/infrastructure/cmux-plan-agents.js` | **Delete.** Replaced by the adapter above |
| `backend/src/infrastructure/ct-api.mjs` | **Modify.** Wire both use cases and the path to `ct-next.mjs` |

---

### Task 1: The GO, its failure, and the port method that answers it

**Files:**
- Create: `backend/src/domain/value-objects/go.js`
- Modify: `backend/src/domain/exceptions.js`
- Modify: `backend/src/domain/ports/plan-issues.js`
- Modify: `backend/src/infrastructure/gh-plan-issues.js`
- Test: `backend/__tests__/infrastructure/gh-plan-issues.test.js`

**Interfaces:**
- Consumes: `Gh` (`gh.js`), `ProcessOutput` (`tool-runner.js`), `RepositoryName`.
- Produces: `new Go({ issue, nonce })` with fields `issue` (integer ≥ 1) and `nonce` (8 lowercase hex), statics `Go.isWellFormedIssue(value)`, `Go.isWellFormedNonce(value)`, `Go.NONCE_EXAMPLE = 'a1b2c3d4'`, and `toString()` returning `#<issue>`. `PlanIssues.answerGo({ go, repository })` resolving to nothing. `GoNotAnswered` under `GoFailure` under `PlanFailure`. `GhPlanIssues.goArgvFor({ go, repository })`.

**Note on the issue guard:** `PlanIssue` already refuses an issue numbered below one. That sentence living in two value objects is boundary idiom, not a business decision — no business change forces touching both at once (`plugin/conventions/decisions.md`) — and a GO cannot depend on carrying a url it has no use for.

- [ ] **Step 1: Write the failing tests**

Append to `backend/__tests__/infrastructure/gh-plan-issues.test.js`, and add `Go` and `GoNotAnswered`/`GoFailure` to the imports at the top of that file:

```javascript
import { Go } from '../../src/domain/value-objects/go.js'
import { GoNotAnswered, GoFailure } from '../../src/domain/exceptions.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { goBody } from '../../../plugin/scripts/go-response.js'

describe('GhPlanIssues answering the GO', () => {
  const GO = new Go({ issue: 7, nonce: 'a1b2c3d4' })

  it('the_call_it_makes_comments_the_go_on_the_issue_the_human_answered', async () => {
    const gh = GhDouble.created('https://github.com/josemerca/ct-loop-sandbox/issues/7#issuecomment-1\n')

    await gh.issues().answerGo({ go: GO, repository: GhDouble.REPOSITORY })

    expect(gh.calls).toEqual([[
      'issue', 'comment', '7',
      '--repo', GhDouble.REPOSITORY.text,
      '--body', '-OK a1b2c3d4',
    ]])
  })

  it('the_body_it_publishes_is_the_one_the_plugin_matcher_recognises_and_not_a_second_spelling', () => {
    const argv = GhPlanIssues.goArgvFor({ go: GO, repository: GhDouble.REPOSITORY })

    expect(argv[argv.length - 1]).toBe(goBody(GO.nonce))
  })

  it('a_gh_that_refuses_to_comment_arrives_typed_so_the_boundary_can_tell_it_from_a_crash', async () => {
    const gh = GhDouble.refusing('could not add comment: HTTP 404')

    const refusal = await gh.issues({ attempts: 1 })
      .answerGo({ go: GO, repository: GhDouble.REPOSITORY })
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(GoNotAnswered)
    expect(refusal).toBeInstanceOf(GoFailure)
    expect(refusal.message).toContain('HTTP 404')
  })

  it('answering_the_go_is_never_repeated_on_its_own_because_a_lost_answer_may_have_been_published', async () => {
    const gh = GhDouble.refusing('connection reset by peer', 4)

    await gh.issues({ attempts: 3 })
      .answerGo({ go: GO, repository: GhDouble.REPOSITORY })
      .catch(() => null)

    expect(gh.calls).toHaveLength(1)
  })

  it('a_go_that_names_no_readable_issue_or_no_nonce_cannot_be_built_at_all', () => {
    expect(() => new Go({ issue: 0, nonce: 'a1b2c3d4' })).toThrow(/numbered from one/)
    expect(() => new Go({ issue: 7, nonce: 'nope' })).toThrow(/nonce such as a1b2c3d4/)
    expect(() => new Go({ issue: 7, nonce: 'A1B2C3D4' })).toThrow(/nonce such as a1b2c3d4/)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanIssues().answerGo({ go: GO, repository: GhDouble.REPOSITORY }))
      .rejects.toThrow(/must implement answerGo/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/infrastructure/gh-plan-issues.test.js`
Expected: FAIL — cannot resolve `../../src/domain/value-objects/go.js`.

- [ ] **Step 3: Write the value object**

Create `backend/src/domain/value-objects/go.js`:

```javascript
export class Go {
  static #NONCE = /^[0-9a-f]{8}$/
  static NONCE_EXAMPLE = 'a1b2c3d4'

  constructor({ issue, nonce }) {
    if (!Go.isWellFormedIssue(issue)) {
      throw new Error(`a go answers an issue numbered from one, got ${JSON.stringify(issue)}`)
    }
    if (!Go.isWellFormedNonce(nonce)) {
      throw new Error(`a go carries a nonce such as ${Go.NONCE_EXAMPLE}, got ${JSON.stringify(nonce)}`)
    }
    this.issue = issue
    this.nonce = nonce
    Object.freeze(this)
  }

  static isWellFormedIssue(issue) {
    return Number.isInteger(issue) && issue >= 1
  }

  static isWellFormedNonce(nonce) {
    return typeof nonce === 'string' && Go.#NONCE.test(nonce)
  }

  toString() {
    return `#${this.issue}`
  }
}
```

- [ ] **Step 4: Add the failure family**

Append to `backend/src/domain/exceptions.js`:

```javascript
export class GoFailure extends PlanFailure {}

export class GoNotAnswered extends GoFailure {}
```

- [ ] **Step 5: Grow the port**

In `backend/src/domain/ports/plan-issues.js`, add a second method to the existing class:

```javascript
  async answerGo({ go, repository }) {
    throw new Error(
      `${this.constructor.name} must implement answerGo({ go, repository }), asked for ${go} in ${repository}`
    )
  }
```

- [ ] **Step 6: Implement it in the adapter**

In `backend/src/infrastructure/gh-plan-issues.js`, add `goBody` to the plugin imports and `GoNotAnswered` to the exceptions import, then add to `GhPlanIssues`:

```javascript
  static goArgvFor({ go, repository }) {
    return [
      'issue', 'comment', String(go.issue),
      '--repo', repository.text,
      '--body', goBody(go.nonce),
    ]
  }

  async answerGo({ go, repository }) {
    const outcome = await this.gh.run(GhPlanIssues.goArgvFor({ go, repository }), { safeToRepeat: false })
    if (outcome.failed) {
      throw new GoNotAnswered(`${Gh.BIN} issue comment failed: ${outcome.stderr.trim()}`)
    }
  }
```

The plugin import line is `import { goBody } from '../../../plugin/scripts/go-response.js'`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run __tests__/infrastructure/gh-plan-issues.test.js`
Expected: PASS, all of them.

- [ ] **Step 8: Run the fast subset**

Run: `npx vitest run --exclude '**/*-real-process.test.js'`
Expected: PASS — 261 existing tests plus the new ones.

- [ ] **Step 9: Commit**

```bash
git add backend/src/domain/value-objects/go.js backend/src/domain/exceptions.js \
        backend/src/domain/ports/plan-issues.js backend/src/infrastructure/gh-plan-issues.js \
        backend/__tests__/infrastructure/gh-plan-issues.test.js
git commit -m "feat: el GO viaja tipado y gh sabe contestarlo en el issue"
```

---

### Task 2: The use case

**Files:**
- Create: `backend/src/application/actions/implement-plan.js`
- Test: `backend/__tests__/application/implement-plan.test.js`

**Interfaces:**
- Consumes: `Go`, `RepositoryName`, `PlanIssues.answerGo` (Task 1).
- Produces: `new ImplementPlanParams({ go, repository })` (frozen) and `new ImplementPlan({ planIssues }).execute(params)`, which resolves to nothing. There is no `Result`: what the front needs to paint the answer is what it sent, and a type nobody reads is a type to maintain.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/application/implement-plan.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { ImplementPlan, ImplementPlanParams } from '../../src/application/actions/implement-plan.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { Go } from '../../src/domain/value-objects/go.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { GoNotAnswered } from '../../src/domain/exceptions.js'

class PlanIssuesDouble extends PlanIssues {
  constructor(answer = null) {
    super()
    this.answer = answer
    this.asked = []
  }

  static refusing(cause) {
    return new PlanIssuesDouble(cause)
  }

  async answerGo({ go, repository }) {
    this.asked.push({ go, repository })
    if (this.answer instanceof Error) throw this.answer
  }
}

class Flow {
  static GO = new Go({ issue: 7, nonce: 'a1b2c3d4' })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor({ planIssues } = {}) {
    this.planIssues = planIssues ?? new PlanIssuesDouble()
  }

  async run(go = Flow.GO) {
    return new ImplementPlan(this).execute(
      new ImplementPlanParams({ go, repository: Flow.REPOSITORY })
    )
  }
}

describe('ImplementPlan', () => {
  it('the_go_it_was_given_is_the_one_that_reaches_the_issue_whole', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planIssues.asked).toEqual([{ go: Flow.GO, repository: Flow.REPOSITORY }])
  })

  it('a_go_that_cannot_be_published_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planIssues: PlanIssuesDouble.refusing(new GoNotAnswered('HTTP 403')) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(GoNotAnswered)
    expect(refusal.name).toBe('GoNotAnswered')
    expect(refusal.message).toBe('HTTP 403')
  })

  it('what_goes_in_cannot_be_edited_after_the_use_case_settled_it', async () => {
    const params = new ImplementPlanParams({ go: Flow.GO, repository: Flow.REPOSITORY })

    await new ImplementPlan(new Flow()).execute(params)

    expect(Object.isFrozen(params)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/application/implement-plan.test.js`
Expected: FAIL — cannot resolve `../../src/application/actions/implement-plan.js`.

- [ ] **Step 3: Write the use case**

Create `backend/src/application/actions/implement-plan.js`:

```javascript
export class ImplementPlanParams {
  constructor({ go, repository }) {
    this.go = go
    this.repository = repository
    Object.freeze(this)
  }
}

export class ImplementPlan {
  constructor({ planIssues }) {
    this.planIssues = planIssues
  }

  async execute(params) {
    await this.planIssues.answerGo({ go: params.go, repository: params.repository })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/application/implement-plan.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/application/actions/implement-plan.js \
        backend/__tests__/application/implement-plan.test.js
git commit -m "feat: el caso de uso que contesta el go del plan"
```

---

### Task 3: What both endpoints share moves to `http.js`

Pure refactor: no behaviour changes, and the 261 existing tests are the net. `Refusal` lives inside a controller today; importing it from there would tie the two controllers to each other. The too-large body is a **transport** outcome — `PlanRequest.from` never produces it, `api-server.js` does — so it leaves the endpoint's vocabulary and stops making the server's last net know about one endpoint's request model.

**Files:**
- Modify: `backend/src/infrastructure/http.js`
- Modify: `backend/src/infrastructure/start-plan-route.js:13,62-64,107-110` (the outcome member, the `tooLarge` factory, its projection)
- Modify: `backend/src/infrastructure/api-server.js:5,22-24` (the import and the projection)
- Modify: `backend/__tests__/infrastructure/plan-refusal.test.js:1-4,34-36`
- Test: `backend/__tests__/infrastructure/http.test.js`

**Interfaces:**
- Produces: `Refusal` exported from `http.js` with `{ status, error }`; `BodyRefusal.tooLarge()` returning a `Refusal` of status 413 and error `body must not exceed 8192 bytes`. `PlanRequestOutcome` no longer has `BODY_TOO_LARGE`, and `PlanRequest.tooLarge()` is gone.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/http.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { Refusal, BodyRefusal, JsonBody } from '../../src/infrastructure/http.js'

describe('Refusal', () => {
  it('a_status_that_is_not_a_refusal_or_a_reason_that_says_nothing_cannot_be_built', () => {
    expect(() => new Refusal({ status: 200, error: 'fine' })).toThrow(/client or server status/)
    expect(() => new Refusal({ status: 400, error: '  ' })).toThrow(/says why/)
  })
})

describe('BodyRefusal', () => {
  it('a_body_over_the_cap_is_answered_with_the_status_that_names_the_size_and_not_a_plain_400', () => {
    const refusal = BodyRefusal.tooLarge()

    expect(refusal).toBeInstanceOf(Refusal)
    expect(refusal.status).toBe(413)
  })

  it('the_size_it_names_is_the_cap_the_reader_enforces_and_not_a_number_typed_twice', () => {
    expect(BodyRefusal.tooLarge().error).toBe(`body must not exceed ${JsonBody.MAX_BYTES} bytes`)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/infrastructure/http.test.js`
Expected: FAIL — `Refusal` and `BodyRefusal` are not exported from `http.js`.

- [ ] **Step 3: Move `Refusal` into `http.js` and add `BodyRefusal`**

In `backend/src/infrastructure/http.js`, add both classes after `JsonBody`:

```javascript
export class Refusal {
  constructor({ status, error }) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new Error(`a refusal answers with a client or server status, got ${JSON.stringify(status)}`)
    }
    if (typeof error !== 'string' || error.trim().length === 0) {
      throw new Error(`a refusal says why, got ${JSON.stringify(error)}`)
    }
    this.status = status
    this.error = error
    Object.freeze(this)
  }
}

export class BodyRefusal {
  static tooLarge() {
    return new Refusal({ status: 413, error: `body must not exceed ${JsonBody.MAX_BYTES} bytes` })
  }
}
```

- [ ] **Step 4: Take the moved pieces out of the controller**

In `backend/src/infrastructure/start-plan-route.js`:
- Delete the `Refusal` class (it now lives in `http.js`) and import it instead: change the first import to `import { Answer, JsonBody, Refusal } from './http.js'`.
- Delete `BODY_TOO_LARGE: 'body-too-large',` from `PlanRequestOutcome`.
- Delete the `static tooLarge()` factory from `PlanRequest`.
- Delete the `[PlanRequestOutcome.BODY_TOO_LARGE]` entry from `PlanRefusal.#BY_OUTCOME`.

`Refusal` is no longer exported from this module. The only place outside that imported it is
`plan-refusal.test.js`, which Step 6 points at `http.js`.

- [ ] **Step 5: Project the 413 without naming an endpoint**

In `backend/src/infrastructure/api-server.js`, change the import line 5 to
`import { Answer, Route, Browsers, JsonBody, BodyRefusal } from './http.js'`, delete the
`import { StartPlanRoute, PlanRequest, PlanRefusal } from './start-plan-route.js'` names that are no
longer used (keep `StartPlanRoute`), and replace the body of the too-large branch:

```javascript
    if (cause.type === Failures.#TOO_LARGE) {
      Answer.refuseAs(response, BodyRefusal.tooLarge())
      return
    }
```

- [ ] **Step 6: Point the existing test at the new home**

In `backend/__tests__/infrastructure/plan-refusal.test.js`:
- Change the import to `import { PlanRequest, PlanRequestOutcome, PlanRefusal, PlanCollapse } from '../../src/infrastructure/start-plan-route.js'` and add `import { Refusal } from '../../src/infrastructure/http.js'`.
- Delete the test `a_status_that_is_not_a_refusal_or_a_reason_that_says_nothing_cannot_be_built` and the test `a_body_over_the_cap_is_answered_with_the_status_that_names_the_size_and_not_a_plain_400`: both now live in `http.test.js`.

- [ ] **Step 7: Run the fast subset**

Run: `npx vitest run --exclude '**/*-real-process.test.js'`
Expected: PASS. The end-to-end 413 assertion in `api-server.test.js:522` still passes — the status and the message are unchanged.

- [ ] **Step 8: Commit**

```bash
git add backend/src/infrastructure/http.js backend/src/infrastructure/start-plan-route.js \
        backend/src/infrastructure/api-server.js \
        backend/__tests__/infrastructure/http.test.js \
        backend/__tests__/infrastructure/plan-refusal.test.js
git commit -m "refactor: lo que todo endpoint repite baja a http.js"
```

---

### Task 4: The controller and its route

**Files:**
- Create: `backend/src/infrastructure/implement-plan-route.js`
- Modify: `backend/src/infrastructure/api-server.js` (constructor and `#route`)
- Modify: `backend/src/infrastructure/ct-api.mjs` (wire the second use case)
- Test: `backend/__tests__/infrastructure/implement-plan-route.test.js`

**Interfaces:**
- Consumes: `ImplementPlan`, `ImplementPlanParams` (Task 2); `Go` (Task 1); `Answer`, `JsonBody`, `Refusal` (`http.js`, Task 3).
- Produces: `ImplementPlanRoute.PATH = '/implement-plan'`, `ImplementPlanRoute.METHOD = 'POST'`, `ImplementPlanRoute.handledBy(implementPlan)`, `ImplementPlanRoute.refuseOtherMethods`. `ApiServer` takes `{ port, startPlan, implementPlan, frontendRoot }`.
- The request model is this endpoint's own (`GoRequest`, `GoRequestOutcome`, `GoRefusal`, `GoCollapse`). What resembles `start-plan-route.js` — the body outcomes and their sentences — stays duplicated on purpose: boundary idiom, not a business decision, so the rule of three applies and has not been reached (`plugin/conventions/decisions.md`).

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/implement-plan-route.test.js`:

```javascript
import { describe, it, expect, afterEach } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { Go } from '../../src/domain/value-objects/go.js'
import { GoNotAnswered } from '../../src/domain/exceptions.js'

class ImplementPlanSpy {
  constructor() {
    this.asked = []
  }

  static failingWith(cause) {
    const spy = new ImplementPlanSpy()
    spy.execute = async () => {
      throw cause
    }

    return spy
  }

  static buggy() {
    const spy = new ImplementPlanSpy()
    spy.execute = async () => {
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params) {
    this.asked.push({ issue: params.go.issue, nonce: params.go.nonce, repo: params.repository.text })
  }
}

class RunningApi {
  static #started = []
  static PATH = '/implement-plan'
  static ACCEPTED_BODY = '{"repo":"josemerca/ct-loop-sandbox","issue":7,"go":"a1b2c3d4"}'
  static ANSWER = '{"status":"implementing","repo":"josemerca/ct-loop-sandbox","issue":7}'
  static spy = null

  static async listening(spy = new ImplementPlanSpy()) {
    RunningApi.spy = spy
    const server = new ApiServer({ port: 0, startPlan: null, implementPlan: spy })
    const port = await server.start()
    RunningApi.#started.push(server)

    return port
  }

  static async stopAll() {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async post(port, body, headers = { 'Content-Type': 'application/json' }) {
    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST', body, headers })
  }

  static async asking(body) {
    const port = await RunningApi.listening()

    return RunningApi.post(port, body)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ImplementPlanRoute', () => {
  it('an_accepted_go_answers_that_the_implementation_is_under_way_with_the_issue_it_unblocked', async () => {
    const response = await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(await response.text()).toBe(RunningApi.ANSWER)
  })

  it('the_three_fields_reach_the_use_case_as_domain_values_and_not_as_the_raw_json', async () => {
    await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(RunningApi.spy.asked).toEqual([
      { issue: 7, nonce: 'a1b2c3d4', repo: 'josemerca/ct-loop-sandbox' },
    ])
  })

  it('a_malformed_nonce_is_refused_naming_the_shape_it_wanted_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"repo":"josemerca/ct-loop-sandbox","issue":7,"go":"nope"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: `go must be a nonce such as ${Go.NONCE_EXAMPLE}` })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_issue_that_is_not_a_whole_number_from_one_is_refused_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"repo":"josemerca/ct-loop-sandbox","issue":"7","go":"a1b2c3d4"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'issue must be a whole number from one' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_malformed_repository_is_refused_before_it_can_become_an_argument_of_gh', async () => {
    const response = await RunningApi.asking('{"repo":"-o","issue":7,"go":"a1b2c3d4"}')

    expect(response.status).toBe(400)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_field_nobody_declared_is_named_in_the_refusal_instead_of_being_ignored', async () => {
    const response = await RunningApi.asking(
      '{"repo":"josemerca/ct-loop-sandbox","issue":7,"go":"a1b2c3d4","force":true}'
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'unknown field: force' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_body_that_is_not_a_json_object_is_refused_as_such', async () => {
    const response = await RunningApi.asking('[]')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'body must be a JSON object' })
  })

  it('a_tool_that_refuses_to_publish_the_go_answers_that_trying_again_may_work', async () => {
    const port = await RunningApi.listening(
      ImplementPlanSpy.failingWith(new GoNotAnswered('gh issue comment failed: HTTP 500'))
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(503)
    expect((await response.json()).error).toContain('could not answer the go')
  })

  it('a_bug_of_ours_is_not_dressed_up_as_the_tool_refusing', async () => {
    const port = await RunningApi.listening(ImplementPlanSpy.buggy())

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'request failed' })
  })

  it('a_body_with_no_json_content_type_is_refused_before_it_is_read', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY, { 'Content-Type': 'text/plain' })

    expect(response.status).toBe(415)
  })

  it('any_method_other_than_post_is_refused_saying_which_one_is_allowed', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'GET' })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/infrastructure/implement-plan-route.test.js`
Expected: FAIL — 404 on `/implement-plan`, because nothing mounts it.

- [ ] **Step 3: Write the controller**

Create `backend/src/infrastructure/implement-plan-route.js`:

```javascript
import { Answer, JsonBody, Refusal } from './http.js'
import { ImplementPlanParams } from '../application/actions/implement-plan.js'
import { Go } from '../domain/value-objects/go.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { PlanFailure, GoNotAnswered } from '../domain/exceptions.js'

export const GoRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ISSUE: 'malformed-issue',
  MALFORMED_GO: 'malformed-go',
})

export class GoRequest {
  static REPO_FIELD = 'repo'
  static ISSUE_FIELD = 'issue'
  static GO_FIELD = 'go'
  static KNOWN_FIELDS = Object.freeze([
    GoRequest.REPO_FIELD, GoRequest.ISSUE_FIELD, GoRequest.GO_FIELD,
  ])

  constructor({ outcome, go, repository, fields }) {
    if (!Object.values(GoRequestOutcome).includes(outcome)) {
      throw new Error(`outcome must be a GoRequestOutcome member, got ${outcome}`)
    }
    if ((outcome === GoRequestOutcome.ACCEPTED) === (go === null)) {
      throw new Error(`outcome ${outcome} disagrees with its go, got ${go}`)
    }
    if ((outcome === GoRequestOutcome.ACCEPTED) === (repository === null)) {
      throw new Error(`outcome ${outcome} disagrees with its repository, got ${repository}`)
    }
    if (outcome !== GoRequestOutcome.UNKNOWN_FIELD && fields.length > 0) {
      throw new Error(`outcome ${outcome} must carry no fields, got ${fields.join(', ')}`)
    }
    if (outcome === GoRequestOutcome.UNKNOWN_FIELD && fields.length === 0) {
      throw new Error('an unknown-field outcome must name the fields it rejected')
    }
    this.outcome = outcome
    this.go = go
    this.repository = repository
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted(go, repository) {
    return new GoRequest({ outcome: GoRequestOutcome.ACCEPTED, go, repository, fields: [] })
  }

  static refused(outcome) {
    return new GoRequest({ outcome, go: null, repository: null, fields: [] })
  }

  static withUnknownFields(fields) {
    return new GoRequest({
      outcome: GoRequestOutcome.UNKNOWN_FIELD, go: null, repository: null, fields,
    })
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return GoRequest.refused(GoRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return GoRequest.refused(GoRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter((field) => !GoRequest.KNOWN_FIELDS.includes(field))
    if (unknown.length > 0) {
      return GoRequest.withUnknownFields(unknown.sort())
    }
    if (!RepositoryName.isWellFormed(parsed[GoRequest.REPO_FIELD])) {
      return GoRequest.refused(GoRequestOutcome.MALFORMED_REPO)
    }
    if (!Go.isWellFormedIssue(parsed[GoRequest.ISSUE_FIELD])) {
      return GoRequest.refused(GoRequestOutcome.MALFORMED_ISSUE)
    }
    if (!Go.isWellFormedNonce(parsed[GoRequest.GO_FIELD])) {
      return GoRequest.refused(GoRequestOutcome.MALFORMED_GO)
    }

    return GoRequest.accepted(
      new Go({ issue: parsed[GoRequest.ISSUE_FIELD], nonce: parsed[GoRequest.GO_FIELD] }),
      new RepositoryName(parsed[GoRequest.REPO_FIELD])
    )
  }
}

export class GoRefusal {
  static #BY_OUTCOME = Object.freeze({
    [GoRequestOutcome.BODY_NOT_A_JSON_OBJECT]: () =>
      new Refusal({ status: 400, error: 'body must be a JSON object' }),
    [GoRequestOutcome.MALFORMED_REPO]: () => new Refusal({
      status: 400,
      error: `${GoRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    }),
    [GoRequestOutcome.MALFORMED_ISSUE]: () => new Refusal({
      status: 400,
      error: `${GoRequest.ISSUE_FIELD} must be a whole number from one`,
    }),
    [GoRequestOutcome.MALFORMED_GO]: () => new Refusal({
      status: 400,
      error: `${GoRequest.GO_FIELD} must be a nonce such as ${Go.NONCE_EXAMPLE}`,
    }),
    [GoRequestOutcome.UNKNOWN_FIELD]: (asked) => new Refusal({
      status: 400,
      error: `unknown field: ${asked.fields.join(', ')}`,
    }),
  })

  static of(asked) {
    const declared = GoRefusal.#BY_OUTCOME[asked.outcome]
    if (declared === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }

    return declared(asked)
  }

  static declaredOutcomes() {
    return Object.keys(GoRefusal.#BY_OUTCOME)
  }
}

export class GoCollapse {
  static #REFUSED = 503

  static #BY_FAILURE = [[GoNotAnswered, GoCollapse.#REFUSED]]

  static of(cause) {
    const declared = GoCollapse.#BY_FAILURE.find(([failure]) => cause.constructor === failure)
    if (declared === undefined) {
      throw new Error(`no status declared for ${cause.constructor.name}`)
    }

    return new Refusal({ status: declared[1], error: `could not answer the go: ${cause.message}` })
  }

  static declaredFailures() {
    return GoCollapse.#BY_FAILURE.map(([failure]) => failure.name)
  }
}

export class ImplementPlanRoute {
  static PATH = '/implement-plan'
  static METHOD = 'POST'

  static handledBy(implementPlan) {
    return async (request, response) => {
      const asked = GoRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== GoRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, GoRefusal.of(asked))
        return
      }
      await ImplementPlanRoute.#accept(implementPlan, response, asked)
    }
  }

  static async #accept(implementPlan, response, asked) {
    try {
      await implementPlan.execute(
        new ImplementPlanParams({ go: asked.go, repository: asked.repository })
      )
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, GoCollapse.of(cause))
      return
    }
    Answer.send(response, 202, {
      status: 'implementing',
      [GoRequest.REPO_FIELD]: asked.repository.text,
      [GoRequest.ISSUE_FIELD]: asked.go.issue,
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ImplementPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method not allowed')
  }
}
```

- [ ] **Step 4: Mount it**

In `backend/src/infrastructure/api-server.js`, add the import
`import { ImplementPlanRoute } from './implement-plan-route.js'`, take `implementPlan` in the
constructor (`constructor({ port, startPlan, implementPlan, frontendRoot = null })`, storing
`this.implementPlan = implementPlan`), and add to `#route()` right after the `app.all` of the first
route:

```javascript
    app.post(
      ImplementPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      ImplementPlanRoute.handledBy(this.implementPlan)
    )
    app.all(ImplementPlanRoute.PATH, ImplementPlanRoute.refuseOtherMethods)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/infrastructure/implement-plan-route.test.js`
Expected: PASS, all of them.

- [ ] **Step 6: Wire the entrypoint**

In `backend/src/infrastructure/ct-api.mjs`, add `import { ImplementPlan } from '../application/actions/implement-plan.js'`, and inside `run()` build the shared adapter once so both use cases talk to the same `gh`:

```javascript
    const planIssues = new GhPlanIssues({ gh: CtApi.#talkingTo(Gh.BIN, Gh) })
    const startPlan = new StartPlan({
      userStories: new AcliUserStories({ acli: CtApi.#talkingTo(AcliUserStories.BIN, ExternalTool) }),
      planIssues,
      planAgents: new CmuxPlanAgents({ run: CtApi.#tool(CmuxPlanAgents.BIN), cwd: process.cwd() }),
    })
    const server = new ApiServer({
      port: asked.port,
      startPlan,
      implementPlan: new ImplementPlan({ planIssues }),
      frontendRoot: FrontendBuild.root(),
    })
```

- [ ] **Step 7: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, including the real-process tests of the entrypoint.

- [ ] **Step 8: Commit**

```bash
git add backend/src/infrastructure/implement-plan-route.js \
        backend/src/infrastructure/api-server.js backend/src/infrastructure/ct-api.mjs \
        backend/__tests__/infrastructure/implement-plan-route.test.js
git commit -m "feat: POST /implement-plan contesta el go del humano en el issue"
```

---

### Task 5: Reading what `ct-next` printed

The only fragile copy in this design: `ct-next` speaks prose, and this reader depends on its shape. Paid for as `plugin/conventions/decisions.md` demands — a contract test that renders the plugin's **own** output and compares, so rewriting both halves passes and touching one fails.

Verified shapes, from `plugin/scripts/ct-next.mjs:3675,3695,3703` and `plugin/scripts/go-channel.js:33`:

```
lanzado #47 en .worktrees/47 — verificado: la sesión cmux está corriendo en ese directorio, …
  GO de #47: contesta exactamente `-OK 7f3a91c2` en un comentario del issue.
```

**Files:**
- Create: `backend/src/infrastructure/ct-next-plan-agents.js` (the reader only; the adapter arrives in Task 6)
- Test: `backend/__tests__/infrastructure/ct-next-plan-agents.test.js`

**Interfaces:**
- Consumes: `Go` (Task 1).
- Produces: `CtNextReport.goIn(printed, issue)` returning a `Go` or `null` when the dictation line for that issue is absent; `CtNextReport.dispatchedIn(printed)` returning the array of issue numbers `ct-next` said it launched or would launch, in the order printed.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/ct-next-plan-agents.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { CtNextReport } from '../../src/infrastructure/ct-next-plan-agents.js'
import { Go } from '../../src/domain/value-objects/go.js'
import { goDictationLine } from '../../../plugin/scripts/go-channel.js'

class Printed {
  static LAUNCHED = 'lanzado #47 en .worktrees/47 — verificado: la sesión cmux está corriendo'
  static WATCHING = '  vigilante del -OK de #47 lanzado (pid 8412) — cuando contestes el go'

  static ofADispatch(issue = 47, nonce = '7f3a91c2') {
    return [
      'rama base resuelta: main',
      `lanzado #${issue} en .worktrees/${issue} — verificado: la sesión cmux está corriendo`,
      `  vigilante del -OK de #${issue} lanzado (pid 8412) — cuando contestes el go`,
      goDictationLine(issue, nonce),
      'lanzados 1/1 slice(s) seleccionados de esta tanda.',
      '',
    ].join('\n')
  }

  static ofADryRun(issue = 47) {
    return [
      'rama base resuelta: main',
      'En vuelo: ninguno (0/1 del cap ocupados).',
      `\n=== slice #${issue} (el buscador acepta acentos) ===`,
      'cmux new-workspace --name "sandbox · #47 el buscador"',
      '',
    ].join('\n')
  }
}

describe('CtNextReport reading the GO', () => {
  it('the_nonce_it_reads_is_the_one_the_plugin_dictated_for_that_issue', () => {
    const go = CtNextReport.goIn(Printed.ofADispatch(47, '7f3a91c2'), 47)

    expect(go).toBeInstanceOf(Go)
    expect(go.issue).toBe(47)
    expect(go.nonce).toBe('7f3a91c2')
  })

  it('the_line_it_parses_is_the_plugins_own_and_not_a_second_spelling_of_it', () => {
    const dictated = goDictationLine(9, 'beef1234')

    expect(CtNextReport.goIn(dictated, 9).nonce).toBe('beef1234')
  })

  it('a_dictation_line_for_another_issue_is_not_mistaken_for_ours', () => {
    expect(CtNextReport.goIn(Printed.ofADispatch(48, '7f3a91c2'), 47)).toBeNull()
  })

  it('output_with_no_dictation_line_answers_that_there_is_no_go_instead_of_inventing_one', () => {
    expect(CtNextReport.goIn(`${Printed.LAUNCHED}\n${Printed.WATCHING}\n`, 47)).toBeNull()
  })

  it('the_notice_of_the_watcher_that_also_names_the_token_is_not_read_as_the_dictation', () => {
    expect(CtNextReport.goIn(`${Printed.WATCHING}\n`, 47)).toBeNull()
  })
})

describe('CtNextReport reading which issues it dispatched', () => {
  it('the_issue_a_dry_run_says_it_would_launch_is_the_one_it_reports', () => {
    expect(CtNextReport.dispatchedIn(Printed.ofADryRun(47))).toEqual([47])
  })

  it('the_issue_a_real_run_says_it_launched_is_the_one_it_reports', () => {
    expect(CtNextReport.dispatchedIn(Printed.ofADispatch(47))).toEqual([47])
  })

  it('output_that_dispatched_nothing_reports_an_empty_list_and_not_a_zero', () => {
    expect(CtNextReport.dispatchedIn('En vuelo: ninguno (0/1 del cap ocupados).\n')).toEqual([])
  })

  it('every_issue_it_names_travels_in_the_order_printed_so_a_caller_can_tell_the_first', () => {
    const printed = `${Printed.ofADryRun(47)}\n=== slice #48 (otra cosa) ===\n`

    expect(CtNextReport.dispatchedIn(printed)).toEqual([47, 48])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/infrastructure/ct-next-plan-agents.test.js`
Expected: FAIL — cannot resolve `../../src/infrastructure/ct-next-plan-agents.js`.

- [ ] **Step 3: Write the reader**

Create `backend/src/infrastructure/ct-next-plan-agents.js`:

```javascript
import { Go } from '../domain/value-objects/go.js'

export class CtNextReport {
  static #DICTATION = /^\s*GO de #(\d+): contesta exactamente `-OK ([0-9a-f]{8})`/m
  static #DISPATCHED = /^(?:lanzado #(\d+) en |=== slice #(\d+) \()/gm

  static goIn(printed, issue) {
    const found = String(printed).match(CtNextReport.#DICTATION)
    if (found === null || Number(found[1]) !== issue) return null

    return new Go({ issue, nonce: found[2] })
  }

  static dispatchedIn(printed) {
    return [...String(printed).matchAll(CtNextReport.#DISPATCHED)]
      .map((found) => Number(found[1] ?? found[2]))
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/infrastructure/ct-next-plan-agents.test.js`
Expected: PASS, all nine.

- [ ] **Step 5: Commit**

```bash
git add backend/src/infrastructure/ct-next-plan-agents.js \
        backend/__tests__/infrastructure/ct-next-plan-agents.test.js
git commit -m "feat: el lector del stdout de ct-next, medido contra la línea del plugin"
```

---

### Task 6: Dispatching with `ct-next`

Two calls, in this order: `--dry-run` to find out which issue it would dispatch, and the real one only if that issue is the one we just created. `ct-next` has no `--issue N` (verified: its flags are `--repo`, `--cap`, `--base`, `--dry-run`), so this guard is what keeps a second ready issue from being dispatched in our name. The race between the two calls is accepted: one slice in flight, `--cap 1`.

**Files:**
- Modify: `backend/src/infrastructure/ct-next-plan-agents.js` (add the adapter beside its reader)
- Modify: `backend/src/domain/exceptions.js` (add `PlanAgentNotAsked`)
- Test: `backend/__tests__/infrastructure/ct-next-plan-agents.test.js`

**Interfaces:**
- Consumes: `CtNextReport` (Task 5), `PlanAgents` port, `ProcessOutput`, `Go`, `PlanIssue`, `UserStoryKey`.
- Produces: `new CtNextPlanAgents({ run, program })` where `run` is `(argv) => Promise<ProcessOutput>` and `program` is the absolute path of `ct-next.mjs`. `CtNextPlanAgents.argvFor({ repository, program, dryRun })`. `launch({ story, issue, repository })` resolves to a `Go`. `PlanAgentNotAsked` under `PlanAgentFailure` for a dispatcher that would have launched someone else's issue.

**Note:** `PlanAgents.launch` gains `repository`, because `ct-next` needs `--repo`. Update the port's signature and its unimplemented message accordingly.

**Two fields this adapter does NOT take**, unlike the echo adapter it replaces: the binary (`node`) is already fixed inside `run` by the entrypoint, and `cwd` is not passed to `execFile` at all — `ct-next` inherits the backend's working directory, which is the spec's declared debt 3 (the backend runs inside the governed checkout). A constructor field nobody reads is a field to maintain.

- [ ] **Step 1: Write the failing test**

Append to `backend/__tests__/infrastructure/ct-next-plan-agents.test.js`, adding these imports at the top:

```javascript
import { CtNextPlanAgents } from '../../src/infrastructure/ct-next-plan-agents.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import {
  PlanAgentNotLaunched, PlanAgentNotNamed, PlanAgentNotAsked, PlanAgentFailure,
} from '../../src/domain/exceptions.js'
```

```javascript
class CtNextDouble {
  static PROGRAM = '/plugin/scripts/ct-next.mjs'
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static STORY = new UserStoryKey('MO_SHOP-42')
  static ISSUE = new PlanIssue({ number: 47, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/47' })

  constructor(answers) {
    this.answers = answers
    this.calls = []
  }

  static answering(...printed) {
    return new CtNextDouble(printed.map((out) => new ProcessOutput({ code: 0, stdout: out, stderr: '' })))
  }

  static refusing(said) {
    return new CtNextDouble([new ProcessOutput({ code: 1, stdout: '', stderr: said })])
  }

  static dispatching(issue = 47, nonce = '7f3a91c2') {
    return CtNextDouble.answering(Printed.ofADryRun(issue), Printed.ofADispatch(issue, nonce))
  }

  agents() {
    return new CtNextPlanAgents({
      program: CtNextDouble.PROGRAM,
      run: (argv) => {
        this.calls.push(argv)
        const answer = this.answers[this.calls.length - 1]
        if (answer === undefined) {
          throw new Error(`nobody wrote an answer for call ${this.calls.length}: ${argv.join(' ')}`)
        }

        return Promise.resolve(answer)
      },
    })
  }

  async launch(issue = CtNextDouble.ISSUE) {
    return this.agents().launch({
      story: CtNextDouble.STORY, issue, repository: CtNextDouble.REPOSITORY,
    })
  }

  async refusal(issue = CtNextDouble.ISSUE) {
    return this.launch(issue).catch((cause) => cause)
  }
}

describe('CtNextPlanAgents', () => {
  it('it_asks_in_dry_run_first_and_only_then_dispatches_for_real', async () => {
    const ctNext = CtNextDouble.dispatching()

    await ctNext.launch()

    expect(ctNext.calls).toEqual([
      [CtNextDouble.PROGRAM, '--repo', CtNextDouble.REPOSITORY.text, '--cap', '1', '--dry-run'],
      [CtNextDouble.PROGRAM, '--repo', CtNextDouble.REPOSITORY.text, '--cap', '1'],
    ])
  })

  it('the_go_of_the_dispatch_is_what_comes_back_so_the_front_can_answer_it_later', async () => {
    const go = await CtNextDouble.dispatching(47, 'beef1234').launch()

    expect(go).toBeInstanceOf(Go)
    expect(go.issue).toBe(47)
    expect(go.nonce).toBe('beef1234')
  })

  it('a_dispatcher_about_to_launch_somebody_elses_issue_is_stopped_before_it_mutates_anything', async () => {
    const ctNext = new CtNextDouble([
      new ProcessOutput({ code: 0, stdout: Printed.ofADryRun(48), stderr: '' }),
    ])

    const refusal = await ctNext.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotAsked)
    expect(refusal.message).toContain('#48')
    expect(refusal.message).toContain('#47')
    expect(ctNext.calls).toHaveLength(1)
  })

  it('a_dry_run_that_would_dispatch_nothing_is_stopped_too_instead_of_launching_blind', async () => {
    const ctNext = new CtNextDouble([
      new ProcessOutput({ code: 0, stdout: 'En vuelo: ninguno (0/1 del cap ocupados).\n', stderr: '' }),
    ])

    expect(await ctNext.refusal()).toBeInstanceOf(PlanAgentNotAsked)
    expect(ctNext.calls).toHaveLength(1)
  })

  it('a_ct_next_that_refuses_the_call_arrives_typed_so_the_caller_can_tell_it_from_a_crash', async () => {
    const refusal = await CtNextDouble.refusing('cmux no está en el PATH de este proceso').refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain('cmux no está en el PATH')
  })

  it('a_dispatch_that_printed_no_go_is_told_apart_from_a_dispatch_that_failed', async () => {
    const ctNext = CtNextDouble.answering(Printed.ofADryRun(47), Printed.LAUNCHED)

    const unreadable = await ctNext.refusal()

    expect(unreadable).toBeInstanceOf(PlanAgentNotNamed)
    expect(unreadable).not.toBeInstanceOf(PlanAgentNotLaunched)
    expect(unreadable).toBeInstanceOf(PlanAgentFailure)
  })

  it('the_port_says_which_arguments_it_needs_when_nobody_implemented_it', async () => {
    await expect(new PlanAgents().launch({
      story: CtNextDouble.STORY, issue: CtNextDouble.ISSUE, repository: CtNextDouble.REPOSITORY,
    })).rejects.toThrow(/must implement launch/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/infrastructure/ct-next-plan-agents.test.js`
Expected: FAIL — `CtNextPlanAgents` is not exported.

- [ ] **Step 3: Add the failure**

Append to `backend/src/domain/exceptions.js`:

```javascript
export class PlanAgentNotAsked extends PlanAgentFailure {}
```

- [ ] **Step 4: Write the adapter**

Add to `backend/src/infrastructure/ct-next-plan-agents.js` (keeping `CtNextReport` where it is):

```javascript
import { PlanAgents } from '../domain/ports/plan-agents.js'
import { PlanAgentNotLaunched, PlanAgentNotNamed, PlanAgentNotAsked } from '../domain/exceptions.js'

export class CtNextPlanAgents extends PlanAgents {
  static CAP = '1'

  constructor({ run, program }) {
    super()
    this.run = run
    this.program = program
  }

  static argvFor({ repository, program, dryRun }) {
    const argv = [program, '--repo', repository.text, '--cap', CtNextPlanAgents.CAP]

    return dryRun ? [...argv, '--dry-run'] : argv
  }

  async launch({ story, issue, repository }) {
    await this.#refuseUnlessItWouldDispatch(issue, repository)
    const printed = await this.#dispatch(repository, false)
    const go = CtNextReport.goIn(printed, issue.number)
    if (go === null) {
      throw new PlanAgentNotNamed(
        `ct-next dispatched ${issue} for ${story} and did not dictate its go, it printed ${JSON.stringify(printed)}`
      )
    }

    return go
  }

  async #refuseUnlessItWouldDispatch(issue, repository) {
    const [next] = CtNextReport.dispatchedIn(await this.#dispatch(repository, true))
    if (next === issue.number) return

    throw new PlanAgentNotAsked(
      next === undefined
        ? `ct-next would dispatch nothing in ${repository}, so ${issue} is not next: promote it or wait for the slice in flight`
        : `ct-next would dispatch #${next} in ${repository}, not ${issue}: nothing was launched`
    )
  }

  async #dispatch(repository, dryRun) {
    const argv = CtNextPlanAgents.argvFor({ repository, program: this.program, dryRun })
    const output = await this.run(argv)
    if (output.failed) {
      throw new PlanAgentNotLaunched(`ct-next ${dryRun ? '--dry-run ' : ''}failed: ${output.stderr.trim()}`)
    }

    return output.stdout
  }
}
```

- [ ] **Step 5: Grow the port's signature**

In `backend/src/domain/ports/plan-agents.js`:

```javascript
export class PlanAgents {
  async launch({ story, issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement launch({ story, issue, repository }), asked for ${story} on ${issue} in ${repository}`
    )
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run __tests__/infrastructure/ct-next-plan-agents.test.js`
Expected: PASS. `cmux-plan-agents.test.js` now fails on the port's message — that is Task 7.

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/ct-next-plan-agents.js backend/src/domain/exceptions.js \
        backend/src/domain/ports/plan-agents.js \
        backend/__tests__/infrastructure/ct-next-plan-agents.test.js
git commit -m "feat: el despacho de verdad — ct-next con la guarda del dry-run"
```

---

### Task 7: `/start-plan` hands the front the GO

**Files:**
- Modify: `backend/src/application/actions/start-plan.js`
- Modify: `backend/src/infrastructure/start-plan-route.js` (the answer and the collapse table)
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Delete: `backend/src/infrastructure/cmux-plan-agents.js`
- Delete: `backend/__tests__/infrastructure/cmux-plan-agents.test.js`
- Modify: `backend/__tests__/application/start-plan.test.js`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

**Interfaces:**
- Consumes: `CtNextPlanAgents` (Task 6), `Go` (Task 1).
- Produces: `StartPlanResult` carrying `{ issue, go }` instead of `{ issue, agent }`. The answer of `POST /start-plan` becomes `{"status":"started","id":…,"repo":…,"issue":{"number":…,"url":…},"go":"<nonce>"}`.

- [ ] **Step 1: Update the application test**

In `backend/__tests__/application/start-plan.test.js`, add
`import { Go } from '../../src/domain/value-objects/go.js'` and replace the double and the three
tests that name the agent:

```javascript
class PlanAgentsDouble extends PlanAgents {
  static LAUNCHED = new Go({ issue: 7, nonce: 'a1b2c3d4' })

  constructor(answer = PlanAgentsDouble.LAUNCHED) {
    super()
    this.answer = answer
    this.asked = []
  }

  async launch({ story, issue, repository }) {
    this.asked.push({ story, issue, repository })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}
```

```javascript
  it('the_agent_is_launched_on_the_issue_that_was_just_created_and_not_on_the_story_alone', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([
      { story: Flow.STORY, issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY },
    ])
  })

  it('both_the_issue_and_the_go_come_back_so_the_caller_can_answer_it_when_a_human_decides', async () => {
    const started = await new Flow().run()

    expect(started.issue).toBe(PlanIssuesDouble.OPENED)
    expect(started.go).toBe(PlanAgentsDouble.LAUNCHED)
  })

  it('the_story_reaches_the_agent_whole_so_the_tab_can_be_named_after_it', async () => {
    const flow = new Flow()

    await flow.run()

    expect(String(flow.planAgents.asked[0].story)).toBe('MO_SHOP-42')
  })
```

And in the last test of the file, the one about unimplemented ports, pass the repository:

```javascript
    await expect(new PlanAgents().launch({
      story: Flow.STORY, issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement launch/)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/application/start-plan.test.js`
Expected: FAIL — the double is asked without `repository`, and `started.go` is undefined.

- [ ] **Step 3: Carry the repository and the GO through the use case**

In `backend/src/application/actions/start-plan.js`, rename the result's second field and pass the
repository on:

```javascript
export class StartPlanResult {
  constructor({ issue, go }) {
    this.issue = issue
    this.go = go
    Object.freeze(this)
  }
}
```

and in `execute`:

```javascript
  async execute(params) {
    const story = await this.userStories.detail(params.story)
    const issue = await this.planIssues.open({ story, repository: params.repository })
    const go = await this.planAgents.launch({
      story: params.story, issue, repository: params.repository,
    })

    return new StartPlanResult({ issue, go })
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/application/start-plan.test.js`
Expected: PASS.

- [ ] **Step 5: Update the controller and its test**

In `backend/src/infrastructure/start-plan-route.js`, replace `agent: started.agent` in the 202 payload
with `go: started.go.nonce`, and add `[PlanAgentNotAsked, PlanCollapse.#REFUSED]` to
`PlanCollapse.#BY_FAILURE` (importing `PlanAgentNotAsked` from the exceptions): a dispatcher that
refused because our issue was not next is the tool declining, and trying again after promoting it may
work.

In `backend/__tests__/infrastructure/api-server.test.js`, add
`import { Go } from '../../src/domain/value-objects/go.js'` and make these three edits:

```javascript
class StartPlanSpy {
  static GO = new Go({ issue: 7, nonce: 'a1b2c3d4' })
  static ISSUE = new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' })
```

```javascript
  async execute(params) {
    this.asked.push(params.story.text)
    this.repositories.push(params.repository.text)
    if (this.failing) throw new PlanAgentNotLaunched('cmux is not reachable')
    return new StartPlanResult({ issue: StartPlanSpy.ISSUE, go: StartPlanSpy.GO })
  }
```

```javascript
  static ANSWER =
    '{"status":"started","id":"ABC-123","repo":"owner/name",' +
    '"issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"go":"a1b2c3d4"}'
```

And in `RunningApi.listening`, give the mounted second route an explicit collaborator so these tests
say what they wire:

```javascript
    const server = new ApiServer({ port: 0, startPlan: RunningApi.spy, implementPlan: null, ...options })
```

One test name at `api-server.test.js:164` still promises the old answer. Rename it — the name is the
sentence, so a name that says `agent` where the answer now carries the GO is a lie the suite tells:

```javascript
  it('start_plan_accepts_and_answers_with_the_go_of_the_dispatch_rather_than_waiting_for_it', async () => {
```

- [ ] **Step 6: Retire the echo adapter and wire the real one**

Delete `backend/src/infrastructure/cmux-plan-agents.js` and
`backend/__tests__/infrastructure/cmux-plan-agents.test.js`.

In `backend/src/infrastructure/ct-api.mjs`, drop the `CmuxPlanAgents` import, add
`import { CtNextPlanAgents } from './ct-next-plan-agents.js'`, teach `FrontendBuild`'s sibling how to
find the program, and wire it:

```javascript
class PluginPrograms {
  static #HERE = dirname(fileURLToPath(import.meta.url))

  static ctNext() {
    return join(PluginPrograms.#HERE, '..', '..', '..', 'plugin', 'scripts', 'ct-next.mjs')
  }
}
```

```javascript
      planAgents: new CtNextPlanAgents({
        run: CtApi.#tool(process.execPath),
        program: PluginPrograms.ctNext(),
      }),
```

- [ ] **Step 7: Run the whole suite**

Run: `npx vitest run`
Expected: PASS. `ct-api-real-process.test.js` needs no edit — verified: it asserts the bound port, a
body cut halfway, and the 503 whose message starts with `could not start the plan: acli jira failed:`,
and never the second field of an accepted answer.

- [ ] **Step 8: Commit**

```bash
git add backend/src/application/actions/start-plan.js backend/src/infrastructure/start-plan-route.js \
        backend/src/infrastructure/ct-api.mjs backend/__tests__/application/start-plan.test.js \
        backend/__tests__/infrastructure/api-server.test.js
git rm backend/src/infrastructure/cmux-plan-agents.js \
       backend/__tests__/infrastructure/cmux-plan-agents.test.js
git commit -m "feat: start-plan entrega el go al front y el echo de cmux se retira"
```

---

### Task 8: The mutation sweep, and the README

`backend/conventions/testing.md` requires the sweep after each round: mutate production code one
change at a time, run the whole suite, and hunt the mutations that leave it green. Commit the tree
first — a sweep killed mid-run leaves a mutation glued to the tree.

**Files:**
- Modify: `README.md` (the table naming the endpoints)
- Modify: whichever test files the sweep proves are watching nothing

- [ ] **Step 1: Confirm the tree is committed and green**

Run: `git status --porcelain` (expect empty) and `npx vitest run` (expect all green).

- [ ] **Step 2: Sweep the new production code**

One mutation at a time, restoring the file and verifying it is identical before the next. Each of
these must turn the suite red; a green one is a finding to fix with a test:

- `go.js`: `issue >= 1` → `issue >= 0`; the nonce regex `{8}` → `{7,8}`; drop the `Object.freeze`
  (this one is declared unmeasured — do not chase it).
- `ct-next-plan-agents.js`: `next === issue.number` → `next !== undefined`; `dryRun ? [...argv, '--dry-run'] : argv` → always `argv`; `[next]` → `next` of the last element.
- `implement-plan-route.js`: swap the order of the `MALFORMED_ISSUE` and `MALFORMED_GO` guards;
  `safeToRepeat: false` → `true` in `gh-plan-issues.js#answerGo`; the 202 status → 200.
- `ct-next-plan-agents.js#CtNextReport`: drop the `Number(found[1]) !== issue` comparison.

- [ ] **Step 3: Fix every green mutation with a test, then re-run**

Run: `npx vitest run`
Expected: PASS with the new tests, and the mutation red when reapplied.

- [ ] **Step 4: Update the README**

In `README.md`, the row that reads `La API HTTP local que la interfaz consume (`POST /start-plan`)`
becomes `La API HTTP local que la interfaz consume (`POST /start-plan`, `POST /implement-plan`)`.

- [ ] **Step 5: Run the whole suite one last time**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md backend/__tests__
git commit -m "test: los agujeros que la barrida de mutación dejó al descubierto"
```

---

## What this plan does not build

Declared in the spec and deliberately absent here: `--issue N`, `--no-launch` and `--emit json` in the
plugin; checking that the cmux session is still alive before answering the GO; holding the
pseudo-terminal from the backend; pushing the session when the watcher already died; and any change
under `plugin/`.
