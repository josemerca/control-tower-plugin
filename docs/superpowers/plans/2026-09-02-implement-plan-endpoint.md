# Implement-plan endpoint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /implement-plan`, which writes one line into the cmux tab where the plan agent is parked so it implements the plan it just committed, driven by the plugin's own `ct-step`.

**Architecture:** The agent is not waiting for anything in GitHub — it stopped because its errand told it to, and it resumes when someone types in its tab. So this endpoint is `cmux send` plus `cmux send-key Enter`, both already written in `CmuxPlanAgents`, carrying a second errand composed by `PlanAgentBrief`. No new domain type, no state kept between requests: the front sends back the three values it already has.

**Tech Stack:** Node 24 ESM, express 5, vitest 4. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-01-implement-plan-endpoint-design.md`

## Global Constraints

- **The yardstick binds entire, old module or new**: `backend/conventions/` (README, architecture, domain, infrastructure, testing) plus `plugin/conventions/style.md`, `defects.md` and `decisions.md`. Read them before writing code; there is no declared debt under `backend/`.
- **Nothing "just in case".** Simple does not mean fewer layers: it means adding nothing that does not solve today's problem. Do not guard values this code composes itself — `domain.md` asks for validation of what **ends up in an argv**, and that is the whole licence.
- **No prose in the code**: no comments, no docstrings. Rename instead of explaining.
- **Code is written in English**: modules, types, methods, variables, test names, error messages. The exception is the errand's text, which an agent reads and is product copy.
- **No free function at module level**: every function hangs off a type.
- **The domain speaks no tool's language.** cmux, gh, acli and git exist only in `infrastructure/`.
- **One port per collaborator, growing with methods.** A new step of the flow against an old collaborator is a method, never a new port.
- **A non-zero exit code is data, not an exception.** `ToolRunner` never throws; the adapter interprets.
- **The domain has no tests of its own**: every guard is reached through the use case that carries it (`backend/conventions/testing.md`).
- **Suite runs from `backend/`.** Fast subset: `npx vitest run --exclude '**/*-real-process.test.js'`. Whole suite before handing anything over.
- **Real-process tests are only two kinds**: the entrypoint's happy path and `ToolRunner`. Do not add a third.

## File Structure

| File | Responsibility |
|---|---|
| `backend/src/infrastructure/plan-agent-brief.js` | **Modify.** Take `ctStep`; compose the one-line errand that resumes the agent |
| `backend/src/domain/exceptions.js` | **Modify.** Add `PlanAgentNotResumed` under `PlanAgentFailure` |
| `backend/src/domain/ports/plan-agents.js` | **Modify.** Add `resume({ story, issue, repository })` |
| `backend/src/infrastructure/cmux-plan-agents.js` | **Modify.** Implement `resume` with the send argv builders it already has |
| `backend/src/application/actions/implement-plan.js` | **Create.** The use case and its `Params` |
| `backend/src/infrastructure/implement-plan-route.js` | **Create.** The controller, its request model, its refusal projections |
| `backend/src/infrastructure/api-server.js` | **Modify.** Take `implementPlan`, mount the route |
| `backend/src/infrastructure/ct-api.mjs` | **Modify.** Resolve `ct-step.mjs`, wire the second use case |
| `README.md` | **Modify.** Name the endpoint |

---

### Task 1: The errand that resumes the agent

One line, not nine: `cmux send` types what it receives and `send-key Enter` runs it, so a newline
inside the text would run the order half-written. The plugin's watcher sends a single line for this
exact reason (`ct-watch-go.mjs:159`).

**Files:**
- Modify: `backend/src/infrastructure/plan-agent-brief.js`
- Test: `backend/__tests__/infrastructure/plan-agent-brief.test.js`

**Interfaces:**
- Consumes: `RepositoryName`.
- Produces: `new PlanAgentBrief({ dispatchCheck, conventions, ctStep })` — the third path validated like its two siblings, absolute — and `implementationErrandFor({ issue, repository })` returning a single-line string, where `issue` is
  the **number** — the only thing the errand interpolates, and the only thing that arrives over HTTP.
  Its sibling `errandFor` takes the `PlanIssue` that `gh` just handed back; the divergence is
  deliberate and the existing test of `errandFor` already passes a bare `{ number: 42 }`, so no
  contract narrows here.

- [ ] **Step 1: Write the failing tests**

Append to `backend/__tests__/infrastructure/plan-agent-brief.test.js`:

```javascript
describe('PlanAgentBrief resuming the agent', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).implementationErrandFor({ issue: 42, repository: new RepositoryName('owner/name') })

  it('it_is_one_single_line_because_a_newline_would_run_the_order_half_written', () => {
    expect(errand()).not.toContain('\n')
  })

  it('it_says_a_person_closed_the_gate_so_the_agent_knows_the_pause_is_over', () => {
    expect(errand()).toMatch(/plan/)
    expect(errand()).toMatch(/#42/)
  })

  it('it_hands_the_driving_to_ct_step_by_absolute_path_instead_of_describing_the_sequence', () => {
    expect(errand()).toContain('node /plugin/scripts/ct-step.mjs next --plan')
    expect(errand()).toContain('--issue 42')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('it_names_the_plan_by_where_the_first_errand_told_it_to_commit_it', () => {
    expect(errand()).toContain('docs/superpowers/plans/')
  })

  it('it_ends_at_an_open_pull_request_that_closes_the_issue_and_stops_before_the_merge', () => {
    expect(errand()).toContain('Closes #42')
    expect(errand()).toMatch(/PARA/)
    expect(errand()).toMatch(/no la mergees/i)
  })

  it('it_waves_off_the_release_that_ct_step_will_suggest_so_the_agent_does_not_crash_into_exit_9', () => {
    expect(errand()).toContain('dispatch-check --release')
    expect(errand()).toMatch(/no ejecutes/i)
  })

  it('it_never_promises_a_permission_nobody_mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
  })

  it('a_brief_that_cannot_name_ct_step_refuses_to_exist_instead_of_shipping_the_word_undefined', () => {
    expect(() => new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
    })).toThrow(/ct-step/)
    expect(() => new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
      ctStep: 'scripts/ct-step.mjs',
    })).toThrow(/ct-step/)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/infrastructure/plan-agent-brief.test.js`
Expected: FAIL — `implementationErrandFor` is not a function, and the constructor accepts a brief with no `ctStep`.

- [ ] **Step 3: Take the third path and compose the errand**

In `backend/src/infrastructure/plan-agent-brief.js`, add the guard beside its two siblings and store it:

```javascript
  constructor({ dispatchCheck, conventions, ctStep }) {
    if (typeof dispatchCheck !== 'string' || !isAbsolute(dispatchCheck)) {
      throw new Error(`the errand names dispatch-check by absolute path, got ${JSON.stringify(dispatchCheck)}`)
    }
    if (typeof conventions !== 'string' || !isAbsolute(conventions)) {
      throw new Error(`the errand names where the yardstick lives, got ${JSON.stringify(conventions)}`)
    }
    if (typeof ctStep !== 'string' || !isAbsolute(ctStep)) {
      throw new Error(`the errand names ct-step by absolute path, got ${JSON.stringify(ctStep)}`)
    }
    this.dispatchCheck = dispatchCheck
    this.conventions = conventions
    this.ctStep = ctStep
    Object.freeze(this)
  }
```

and add the second errand, which is the only method of this class that must fit on one line:

```javascript
  implementationErrandFor({ issue, repository }) {
    return [
      `El gate \`plan\` del issue #${issue} de ${repository.text} lo ha cerrado una persona:`,
      'implementa AHORA el plan que commiteaste, sin reescribirlo.',
      `Pregunta el paso con \`node ${this.ctStep} next --plan <tu plan de docs/superpowers/plans/> --issue ${issue}\``,
      'y obedece exactamente lo que conteste, tarea a tarea, hasta que el run quede entregado.',
      `Entonces abre la pull request con \`Closes #${issue}\` en el cuerpo y PARA: no la mergees,`,
      'no crees worktrees nuevos, y NO ejecutes `dispatch-check --release` aunque ct-step te lo diga',
      '(en este flujo el issue no se reclama y el permiso que esa puerta exige no se acuña: saldría por 9).',
    ].join(' ')
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/infrastructure/plan-agent-brief.test.js`
Expected: PASS.

- [ ] **Step 5: Give the existing wiring its third path**

The brief is built in two places, and both now need `ctStep` or they throw at startup. In
`backend/src/infrastructure/ct-api.mjs`, add to `PluginTree`:

```javascript
  static ctStep() {
    return join(PluginTree.#root(), 'scripts', 'ct-step.mjs')
  }
```

and add `ctStep: PluginTree.ctStep()` where the `PlanAgentBrief` is constructed. Then grep for any
other construction and give it the path too:

Run: `grep -rn "new PlanAgentBrief" backend/src backend/__tests__`
Expected: every hit either passes `ctStep` or is a test that asserts its absence.

- [ ] **Step 6: Run the whole suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/plan-agent-brief.js backend/src/infrastructure/ct-api.mjs \
        backend/__tests__/infrastructure/plan-agent-brief.test.js
git commit -m "feat(brief): el encargo que reanuda al agente, en una sola línea"
```

---

### Task 2: The port and the adapter that type the line

**Files:**
- Modify: `backend/src/domain/exceptions.js`
- Modify: `backend/src/domain/ports/plan-agents.js`
- Modify: `backend/src/infrastructure/cmux-plan-agents.js`
- Test: `backend/__tests__/infrastructure/cmux-plan-agents.test.js`

**Interfaces:**
- Consumes: `UserStoryKey`, `RepositoryName`, `ProcessOutput`, and the fixtures already in that test file.
- Produces: `PlanAgents.resume({ story, issue, repository })` resolving to nothing, with `issue` the **number**; `CmuxPlanAgents.resume` sending `['send', '--workspace', 'ct-plan-<story>', <errand>]` and then `['send-key', '--workspace', 'ct-plan-<story>', 'Enter']`; `PlanAgentNotResumed` under `PlanAgentFailure`.
- **One cause, not two**, unlike this adapter's `launch`: nothing is read back from `cmux send`, so there is no contract of ours it could break. Declared in the spec so it is not read as a family half written.

- [ ] **Step 1: Write the failing tests**

Add `PlanAgentNotResumed` to the exceptions imported at the top of
`backend/__tests__/infrastructure/cmux-plan-agents.test.js`, then append:

```javascript
class ResumeDouble {
  static STORY = new UserStoryKey('ABC-42')
  static ISSUE = 42
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static TAB = 'ct-plan-ABC-42'
  static ERRAND = 'implementa el plan de #42'

  constructor(answers) {
    this.answers = answers
    this.calls = []
    this.brief = {
      asked: [],
      implementationErrandFor: ({ issue, repository }) => {
        this.brief.asked.push({ issue, repository })

        return ResumeDouble.ERRAND
      },
    }
  }

  static accepting() {
    return new ResumeDouble([
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
    ])
  }

  static refusing(said) {
    return new ResumeDouble([new ProcessOutput({ code: 1, stdout: '', stderr: said })])
  }

  static refusingTheEnter(said) {
    return new ResumeDouble([
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 1, stdout: '', stderr: said }),
    ])
  }

  agents() {
    return new CmuxPlanAgents({
      brief: this.brief,
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

  async resume() {
    return this.agents().resume({
      story: ResumeDouble.STORY, issue: ResumeDouble.ISSUE, repository: ResumeDouble.REPOSITORY,
    })
  }

  async refusal() {
    return this.resume().catch((cause) => cause)
  }
}

describe('CmuxPlanAgents resuming a parked agent', () => {
  it('it_types_the_errand_in_the_tab_it_named_when_it_launched_it_and_then_presses_enter', async () => {
    const cmux = ResumeDouble.accepting()

    await cmux.resume()

    expect(cmux.calls).toEqual([
      ['send', '--workspace', ResumeDouble.TAB, ResumeDouble.ERRAND],
      ['send-key', '--workspace', ResumeDouble.TAB, 'Enter'],
    ])
  })

  it('the_errand_it_types_is_the_one_the_brief_composed_for_that_issue_and_repository', async () => {
    const cmux = ResumeDouble.accepting()

    await cmux.resume()

    expect(cmux.brief.asked).toEqual([
      { issue: ResumeDouble.ISSUE, repository: ResumeDouble.REPOSITORY },
    ])
  })

  it('a_cmux_that_refuses_to_write_arrives_typed_so_the_boundary_can_tell_it_from_a_crash', async () => {
    const refusal = await ResumeDouble.refusing('Access denied - only processes started inside cmux').refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal).toBeInstanceOf(PlanAgentFailure)
    expect(refusal.message).toContain('Access denied')
  })

  it('an_enter_that_never_lands_is_reported_because_the_line_is_sitting_there_unrun', async () => {
    const refusal = await ResumeDouble.refusingTheEnter('no such workspace').refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toContain('no such workspace')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().resume({
      story: ResumeDouble.STORY, issue: ResumeDouble.ISSUE, repository: ResumeDouble.REPOSITORY,
    })).rejects.toThrow(/must implement resume/)
  })
})
```

Add `PlanAgents` to that file's imports: `import { PlanAgents } from '../../src/domain/ports/plan-agents.js'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/infrastructure/cmux-plan-agents.test.js`
Expected: FAIL — `resume` is not a function.

- [ ] **Step 3: Add the failure**

Append to `backend/src/domain/exceptions.js`, inside the `PlanAgentFailure` family:

```javascript
export class PlanAgentNotResumed extends PlanAgentFailure {}
```

- [ ] **Step 4: Grow the port**

In `backend/src/domain/ports/plan-agents.js`, add the second method:

```javascript
  async resume({ story, issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement resume({ story, issue, repository }), asked for ${story} on ${issue} in ${repository}`
    )
  }
```

- [ ] **Step 5: Implement it in the adapter**

In `backend/src/infrastructure/cmux-plan-agents.js`, add `PlanAgentNotResumed` to the exceptions
import and add the method, reusing the two argv builders that are already there:

```javascript
  async resume({ story, issue, repository }) {
    const errand = this.brief.implementationErrandFor({ issue, repository })
    const name = CmuxPlanAgents.nameFor(story)
    await this.#type(CmuxPlanAgents.sendArgvFor(name, errand))
    await this.#type(CmuxPlanAgents.enterArgvFor(name))
  }

  async #type(argv) {
    const output = await this.run(argv)
    if (output.failed) {
      throw new PlanAgentNotResumed(`${CmuxPlanAgents.BIN} ${argv[0]} failed: ${output.stderr.trim()}`)
    }
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/infrastructure/cmux-plan-agents.test.js`
Expected: PASS, the new ones and the launch ones untouched.

- [ ] **Step 7: Commit**

```bash
git add backend/src/domain/exceptions.js backend/src/domain/ports/plan-agents.js \
        backend/src/infrastructure/cmux-plan-agents.js \
        backend/__tests__/infrastructure/cmux-plan-agents.test.js
git commit -m "feat(cmux): la línea que reanuda al agente parado en el gate"
```

---

### Task 3: The use case

**Files:**
- Create: `backend/src/application/actions/implement-plan.js`
- Test: `backend/__tests__/application/implement-plan.test.js`

**Interfaces:**
- Consumes: `PlanAgents.resume` (Task 2), `UserStoryKey`, `RepositoryName`.
- Produces: `new ImplementPlanParams({ story, issue, repository })` (frozen, `issue` the number) and `new ImplementPlan({ planAgents }).execute(params)`, resolving to nothing. No `Result`: the front already has everything the answer carries.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/application/implement-plan.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { ImplementPlan, ImplementPlanParams } from '../../src/application/actions/implement-plan.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.js'

class PlanAgentsDouble extends PlanAgents {
  constructor(answer = null) {
    super()
    this.answer = answer
    this.asked = []
  }

  static refusing(cause) {
    return new PlanAgentsDouble(cause)
  }

  async resume({ story, issue, repository }) {
    this.asked.push({ story, issue, repository })
    if (this.answer instanceof Error) throw this.answer
  }
}

class Flow {
  static STORY = new UserStoryKey('XOP-4909')
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')

  constructor({ planAgents } = {}) {
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run() {
    return new ImplementPlan(this).execute(new ImplementPlanParams({
      story: Flow.STORY, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    }))
  }
}

describe('ImplementPlan', () => {
  it('the_agent_it_resumes_is_the_one_of_the_story_and_issue_it_was_given', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([
      { story: Flow.STORY, issue: Flow.ISSUE, repository: Flow.REPOSITORY },
    ])
  })

  it('an_agent_that_cannot_be_resumed_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.name).toBe('PlanAgentNotResumed')
    expect(refusal.message).toBe('no such workspace')
  })

  it('what_goes_in_cannot_be_edited_after_the_use_case_settled_it', async () => {
    const params = new ImplementPlanParams({
      story: Flow.STORY, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    })

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
  constructor({ story, issue, repository }) {
    this.story = story
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

export class ImplementPlan {
  constructor({ planAgents }) {
    this.planAgents = planAgents
  }

  async execute(params) {
    await this.planAgents.resume({
      story: params.story, issue: params.issue, repository: params.repository,
    })
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
git commit -m "feat: el caso de uso que manda implementar el plan"
```

---

### Task 4: The controller and its route

**Files:**
- Create: `backend/src/infrastructure/implement-plan-route.js`
- Modify: `backend/src/infrastructure/api-server.js`
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Test: `backend/__tests__/infrastructure/implement-plan-route.test.js`

**Interfaces:**
- Consumes: `ImplementPlan`, `ImplementPlanParams` (Task 3); `Answer`, `JsonBody`, `Refusal` from `http.js`; `UserStoryKey`, `RepositoryName`.
- Produces: `ImplementPlanRoute.PATH = '/implement-plan'`, `METHOD = 'POST'`, `handledBy(implementPlan)`, `refuseOtherMethods`. `ApiServer` takes `implementPlan` in its constructor options.
- The request carries `{ id, repo, issue }`. `id` and `repo` reuse their value objects; the issue number is validated in the request model the way `EventsRequest` validates the one in its route, and travels **as a number**. No `PlanIssue` is built here: it would need a url nobody sent, and composing one to satisfy a guard is inventing a datum to get past a type.

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/infrastructure/implement-plan-route.test.js`:

```javascript
import { describe, it, expect, afterEach } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.js'

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
    this.asked.push({
      story: params.story.text,
      issue: params.issue,
      repo: params.repository.text,
    })
  }
}

class RunningApi {
  static #started = []
  static PATH = '/implement-plan'
  static ACCEPTED_BODY = '{"id":"XOP-4909","repo":"jjponz/repo-pulse","issue":33}'
  static ANSWER = '{"status":"implementing","id":"XOP-4909","repo":"jjponz/repo-pulse","issue":33}'
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
    return RunningApi.post(await RunningApi.listening(), body)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ImplementPlanRoute', () => {
  it('an_accepted_order_answers_that_the_implementation_is_under_way', async () => {
    const response = await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe(RunningApi.ANSWER)
  })

  it('the_three_fields_reach_the_use_case_as_domain_values_and_not_as_the_raw_json', async () => {
    await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(RunningApi.spy.asked).toEqual([
      { story: 'XOP-4909', issue: 33, repo: 'jjponz/repo-pulse' },
    ])
  })

  it('a_malformed_story_key_is_refused_naming_the_shape_it_wanted_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"id":"nope","repo":"jjponz/repo-pulse","issue":33}')

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^id must be a user story key/)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_issue_that_is_not_a_whole_number_from_one_is_refused_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"id":"XOP-4909","repo":"jjponz/repo-pulse","issue":"33"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'issue must be a whole number from one' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_malformed_repository_is_refused_before_it_can_become_an_argument_of_a_tool', async () => {
    const response = await RunningApi.asking('{"id":"XOP-4909","repo":"-o","issue":33}')

    expect(response.status).toBe(400)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_field_nobody_declared_is_named_in_the_refusal_instead_of_being_ignored', async () => {
    const response = await RunningApi.asking(
      '{"id":"XOP-4909","repo":"jjponz/repo-pulse","issue":33,"force":true}'
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

  it('a_tool_that_refuses_to_write_in_the_tab_answers_that_trying_again_may_work', async () => {
    const port = await RunningApi.listening(
      ImplementPlanSpy.failingWith(new PlanAgentNotResumed('cmux send failed: no such workspace'))
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/^could not implement the plan: /)
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
import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { PlanFailure, PlanAgentNotResumed } from '../domain/exceptions.js'

export const ImplementRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  MALFORMED_REPO: 'malformed-repo',
  MALFORMED_ISSUE: 'malformed-issue',
})

export class ImplementRequest {
  static ID_FIELD = 'id'
  static REPO_FIELD = 'repo'
  static ISSUE_FIELD = 'issue'
  static KNOWN_FIELDS = Object.freeze([
    ImplementRequest.ID_FIELD, ImplementRequest.REPO_FIELD, ImplementRequest.ISSUE_FIELD,
  ])

  constructor({ outcome, story, issue, repository, fields }) {
    if (!Object.values(ImplementRequestOutcome).includes(outcome)) {
      throw new Error(`outcome must be an ImplementRequestOutcome member, got ${outcome}`)
    }
    if ((outcome === ImplementRequestOutcome.ACCEPTED) === (story === null)) {
      throw new Error(`outcome ${outcome} disagrees with its story, got ${story}`)
    }
    if ((outcome === ImplementRequestOutcome.ACCEPTED) === (issue === null)) {
      throw new Error(`outcome ${outcome} disagrees with its issue, got ${issue}`)
    }
    if ((outcome === ImplementRequestOutcome.ACCEPTED) === (repository === null)) {
      throw new Error(`outcome ${outcome} disagrees with its repository, got ${repository}`)
    }
    if (outcome !== ImplementRequestOutcome.UNKNOWN_FIELD && fields.length > 0) {
      throw new Error(`outcome ${outcome} must carry no fields, got ${fields.join(', ')}`)
    }
    if (outcome === ImplementRequestOutcome.UNKNOWN_FIELD && fields.length === 0) {
      throw new Error('an unknown-field outcome must name the fields it rejected')
    }
    this.outcome = outcome
    this.story = story
    this.issue = issue
    this.repository = repository
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted({ story, issue, repository }) {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.ACCEPTED, story, issue, repository, fields: [],
    })
  }

  static refused(outcome) {
    return new ImplementRequest({
      outcome, story: null, issue: null, repository: null, fields: [],
    })
  }

  static withUnknownFields(fields) {
    return new ImplementRequest({
      outcome: ImplementRequestOutcome.UNKNOWN_FIELD,
      story: null, issue: null, repository: null, fields,
    })
  }

  static isWellFormedIssue(given) {
    return Number.isInteger(given) && given >= 1
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return ImplementRequest.refused(ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return ImplementRequest.refused(ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter(
      (field) => !ImplementRequest.KNOWN_FIELDS.includes(field)
    )
    if (unknown.length > 0) {
      return ImplementRequest.withUnknownFields(unknown.sort())
    }
    if (!UserStoryKey.isWellFormed(parsed[ImplementRequest.ID_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_ID)
    }
    if (!RepositoryName.isWellFormed(parsed[ImplementRequest.REPO_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_REPO)
    }
    if (!ImplementRequest.isWellFormedIssue(parsed[ImplementRequest.ISSUE_FIELD])) {
      return ImplementRequest.refused(ImplementRequestOutcome.MALFORMED_ISSUE)
    }

    return ImplementRequest.accepted({
      story: new UserStoryKey(parsed[ImplementRequest.ID_FIELD]),
      issue: parsed[ImplementRequest.ISSUE_FIELD],
      repository: new RepositoryName(parsed[ImplementRequest.REPO_FIELD]),
    })
  }
}

export class ImplementRefusal {
  static #BY_OUTCOME = Object.freeze({
    [ImplementRequestOutcome.BODY_NOT_A_JSON_OBJECT]: () =>
      new Refusal({ status: 400, error: 'body must be a JSON object' }),
    [ImplementRequestOutcome.MALFORMED_ID]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.ID_FIELD} must be a user story key such as ${UserStoryKey.EXAMPLE}`,
    }),
    [ImplementRequestOutcome.MALFORMED_REPO]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    }),
    [ImplementRequestOutcome.MALFORMED_ISSUE]: () => new Refusal({
      status: 400,
      error: `${ImplementRequest.ISSUE_FIELD} must be a whole number from one`,
    }),
    [ImplementRequestOutcome.UNKNOWN_FIELD]: (asked) => new Refusal({
      status: 400,
      error: `unknown field: ${asked.fields.join(', ')}`,
    }),
  })

  static of(asked) {
    const declared = ImplementRefusal.#BY_OUTCOME[asked.outcome]
    if (declared === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }

    return declared(asked)
  }

  static declaredOutcomes() {
    return Object.keys(ImplementRefusal.#BY_OUTCOME)
  }
}

export class ImplementCollapse {
  static #REFUSED = 503

  static #BY_FAILURE = [[PlanAgentNotResumed, ImplementCollapse.#REFUSED]]

  static of(cause) {
    const declared = ImplementCollapse.#BY_FAILURE.find(([failure]) => cause.constructor === failure)
    if (declared === undefined) {
      throw new Error(`no status declared for ${cause.constructor.name}`)
    }

    return new Refusal({
      status: declared[1], error: `could not implement the plan: ${cause.message}`,
    })
  }

  static declaredFailures() {
    return ImplementCollapse.#BY_FAILURE.map(([failure]) => failure.name)
  }
}

export class ImplementPlanRoute {
  static PATH = '/implement-plan'
  static METHOD = 'POST'

  static handledBy(implementPlan) {
    return async (request, response) => {
      const asked = ImplementRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== ImplementRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ImplementRefusal.of(asked))
        return
      }
      await ImplementPlanRoute.#accept(implementPlan, response, asked)
    }
  }

  static async #accept(implementPlan, response, asked) {
    try {
      await implementPlan.execute(new ImplementPlanParams({
        story: asked.story, issue: asked.issue, repository: asked.repository,
      }))
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, ImplementCollapse.of(cause))
      return
    }
    Answer.send(response, 202, {
      status: 'implementing',
      [ImplementRequest.ID_FIELD]: asked.story.text,
      [ImplementRequest.REPO_FIELD]: asked.repository.text,
      [ImplementRequest.ISSUE_FIELD]: asked.issue,
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', ImplementPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method not allowed')
  }
}
```

- [ ] **Step 4: Mount it**

In `backend/src/infrastructure/api-server.js`, add
`import { ImplementPlanRoute } from './implement-plan-route.js'`, take `implementPlan` in the
constructor options (storing `this.implementPlan = implementPlan`), and add to `#route()` after the
`app.all` of the start-plan route:

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
Expected: PASS, all eleven.

- [ ] **Step 6: Wire the entrypoint**

In `backend/src/infrastructure/ct-api.mjs`, add
`import { ImplementPlan } from '../application/actions/implement-plan.js'`, hold the adapter that
`StartPlan` already builds in a variable so both use cases share one, and pass the second use case to
the server:

```javascript
    const planAgents = new CmuxPlanAgents({ /* the arguments already there, unchanged */ })
```

```javascript
    const server = new ApiServer({
      port: asked.port,
      startPlan,
      implementPlan: new ImplementPlan({ planAgents }),
      planEvents,
      sessions,
      frontendRoot: FrontendBuild.root(),
    })
```

Keep the names of the existing options exactly as they are in the file; only `implementPlan` is new.

- [ ] **Step 7: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, including the entrypoint's real-process happy path.

- [ ] **Step 8: Commit**

```bash
git add backend/src/infrastructure/implement-plan-route.js \
        backend/src/infrastructure/api-server.js backend/src/infrastructure/ct-api.mjs \
        backend/__tests__/infrastructure/implement-plan-route.test.js
git commit -m "feat: POST /implement-plan reanuda al agente y le pasa la conducción a ct-step"
```

---

### Task 5: The mutation sweep, and the README

`backend/conventions/testing.md` requires the sweep after each round. Commit the tree first — a sweep
killed mid-run leaves a mutation glued to the tree.

**Files:**
- Modify: `README.md`
- Modify: whichever test files the sweep proves are watching nothing

- [ ] **Step 1: Confirm the tree is committed and green**

Run: `git status --porcelain` (expect empty) and `npx vitest run` (expect all green).

- [ ] **Step 2: Sweep the new production code**

One mutation at a time, restoring the file and verifying it is identical before the next. Each of
these must turn the suite red; a green one is a finding to fix with a test:

- `plan-agent-brief.js`: `.join(' ')` → `.join('\n')` (the one-line rule); drop the `ctStep` guard;
  remove the `PARA` sentence from the errand's array; remove the sentence that waves off `--release`.
- `cmux-plan-agents.js`: in `resume`, swap the order of the two `#type` calls; drop the second one
  entirely; `output.failed` → `false` inside `#type`.
- `implement-plan-route.js`: swap the `MALFORMED_REPO` and `MALFORMED_ISSUE` guards; `given >= 1` →
  `given >= 0`; the 202 status → 200; drop `[ImplementRequest.ISSUE_FIELD]` from the answer.
- `implement-plan.js`: pass `params.story` where `params.issue` goes.

- [ ] **Step 3: Fix every green mutation with a test, then re-run**

Run: `npx vitest run`
Expected: PASS with the new tests, and each mutation red when reapplied.

- [ ] **Step 4: Update the README**

In `README.md`, the row of the table that names the backend's endpoints gains this one, keeping the
sentence's shape: the local HTTP API the interface consumes (`POST /start-plan`,
`GET /plan-events/:issue`, `POST /implement-plan`).

- [ ] **Step 5: Run the whole suite one last time**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md backend/__tests__
git commit -m "test: los agujeros que la barrida de mutación dejó al descubierto"
```

---

## Trying it for real

Not a task: the check a person does. The API **has to be started from a cmux tab** — cmux refuses any
process not born inside it — and from the root of the governed checkout, because it cuts worktrees
from `process.cwd()`. The bench is `jjponz/repo-pulse` with the story `XOP-4909`.

```
POST /start-plan     {"id":"XOP-4909","repo":"jjponz/repo-pulse"}
GET  /plan-events/<n>   -N     # until it says ready
POST /implement-plan {"id":"XOP-4909","repo":"jjponz/repo-pulse","issue":<n>}
```

Then watch the tab: the agent should answer `ct-step next`, start the first task, and end with a pull
request open against the base branch — which is where the second human decision lives.

## What this plan does not build

Answering the GO in the issue and the nonce entire; `ct-next` and its envelope; checking that the tab
is still alive; `dispatch-check --release` and the two gates that go with it; the issue's labels, which
nobody claims in this flow; the 413 residue in `api-server.js`; and any change under `plugin/`.
