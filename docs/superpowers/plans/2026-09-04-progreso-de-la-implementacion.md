# El progreso de la implementación — Implementation Plan

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the spec and `backend/conventions/` win.

**Spec:** `docs/superpowers/specs/2026-09-04-progreso-de-la-implementacion-design.md`

**Branch:** `alcaptar/seguimiento_cmux`, cut from `main`.

**Tech stack:** Node 24 ESM, express 5, vitest 4. No new dependency.

## 1. Context and goal

`POST /implement-plan` answers `202` and the interface goes quiet. The slice then runs for hours
inside a cmux tab and emits nothing: nobody outside that tab knows which task of how many is being
written, judged or committed.

Nothing has to be asked of the agent. `ct-step` already persists the position of the run in
`<worktree>/.agent/run-<issue>.json` and rewrites it on every transition. This slice publishes it.

### Desired end state

- `GET /implement-progress/:issue?root=<path>` answers the step, the task, its name, the attempt
  and the discards, read from the run file of that worktree.
- A worktree whose run file does not exist yet answers `starting`, not an error.
- A run that closed as delivered answers `delivered`.
- `POST /start-plan` returns the checkout root, which is what the endpoint needs to be called at
  all.
- Nothing is imported from `plugin/scripts/` by production code; a contract test feeds our reader
  with runs built by the plugin's own `newRun`/`after`.

### Out of scope

The frontend, which is somebody else's (no client, no polling, no component). The metrics JSONL
timeline. Any hook of the plugin. Telling a blocked run from a running one — the run file does not
say, and §9.1 records why we do not guess.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Path of the run file | `<root>/.worktrees/<issue>/.agent/run-<issue>.json`, derived with `GitWorkspace.pathFor` |
| What identifies the run | `root` (query) and `issue` (path segment). **No `repo`** |
| The step vocabulary | `STEPS` of `run-machine.js` verbatim, plus `starting` and `delivered` |
| Field naming in the JSON answer | `total_tasks` in snake case; everything else is one word |
| Where the "no task here" rule lives | inside `ImplementationState.of`, nowhere else |
| The attempt | `controlRetries + judgeRetries + correctionRetries + 1`, written ourselves |
| A blocked run | not derived. The run file only persists `closed` on delivery |
| Refusal codes | two: `malformed-root` and `implementation-progress-not-read` |
| A non-numeric `issue` | no refusal code. `Number(…)` in the request model, then `not-read` |
| Where the task name comes from | the `### Task <n> — <name>` headings of the file `run.plan` names |
| Nothing is imported from `plugin/scripts/` | production writes its own readers; **tests** import the plugin's |
| Caching the read by `mtime` | no. No measured problem |
| Comments in `backend/src` | **none**. `__tests__/yardstick.js` has a prose detector that fails the suite on any. The `//` annotations in this plan's contract blocks are notes to the reader — they are not code to copy |

## 3. Reference patterns

Files to imitate:
`backend/src/domain/ports/plan-progress.js` (port with one method and a throwing default),
`backend/src/domain/value-objects/plan-state.js` (the value of the sibling phase),
`backend/src/infrastructure/plan-contract-progress.js` (adapter with injected collaborators and
static path builders), `backend/src/application/queries/read-plan-progress.js` (read-only use case
with its Params and Result), `backend/src/infrastructure/plan-events-route.js` (controller with its
request model, its outcome vocabulary and its refusal projections in one module),
`backend/src/infrastructure/implement-plan-route.js` (the `*Collapse` projection from a typed
failure to a `Refusal`).

Tests to imitate:
`backend/__tests__/infrastructure/api-server.test.js` (a listening server and `fetch`, asserting the
literal JSON body), `backend/__tests__/application/read-plan-progress.test.js` (the port doubled at
the constructor), `backend/__tests__/infrastructure/plan-contract-progress.test.js` (adapter cut
right before the tool), `backend/__tests__/infrastructure/plugin-contract.test.js` (what crosses the
boundary, measured against the plugin's own code).

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/exceptions.js` | modify | adapter, route | Contract (T1) |
| `backend/src/domain/ports/implementation-progress.js` | create | `ReadImplementationProgress` | Contract (T1) |
| `backend/src/domain/value-objects/implementation-state.js` | create | adapter, route | Contract (T1) |
| `backend/src/application/queries/read-implementation-progress.js` | create | `ct-api.mjs` | Contract (T1) |
| `backend/__tests__/infrastructure/plan-refusal.test.js` | modify | — | Current state (T1) |
| `backend/src/infrastructure/run-file-progress.js` | create | `ct-api.mjs` | Contract (T2, T3) |
| `backend/src/infrastructure/implement-progress-route.js` | create | `ApiServer` | Contract (T4) |
| `backend/src/infrastructure/api-server.js` | modify | `ct-api.mjs` | Current state (T4) |
| `backend/__tests__/infrastructure/refusal-codes.test.js` | modify | — | Current state (T4) |
| `backend/src/infrastructure/start-plan-route.js` | modify | `ApiServer` | Current state (T5) |
| `backend/src/infrastructure/ct-api.mjs` | modify | — | Call site (T6) |
| `backend/__tests__/infrastructure/plugin-contract.test.js` | modify | — | Contract (T6) |

## 5. Interfaces

Consumes (tests only): `STEPS`, `RUN_STATES`, `OUTCOMES`, `newRun`, `after`, `DEFAULT_BUDGETS` from
`plugin/scripts/run-machine.js`; `StepSeal` from `plugin/scripts/dispatch-gate.js`; `extractTasks`
from `plugin/scripts/plan-tasks.js`. All three modules are pure.

Produces:

```
ImplementationStep                                    frozen object, ten string members
ImplementationState.of({ step, task, totalTasks, name, attempt, discards })
                                                      -> ImplementationState, frozen
ImplementationProgress.of({ root, issue })            -> Promise<ImplementationState>
ReadImplementationProgressParams({ root, issue })
ReadImplementationProgress({ implementationProgress }).execute(params)
                                                      -> Promise<{ state }>
RunFileProgress({ read, exists })                     read(path) -> Promise<string|null>
                                                      exists(path) -> Promise<boolean>
ImplementProgressRoute.PATH  = '/implement-progress/:issue'
ImplementProgressRoute.handledBy(readImplementationProgress)
ImplementationProgressFailure < PlanFailure
ImplementationProgressNotRead < ImplementationProgressFailure
```

## 6. Test strategy

Outside-in, from `backend/`, as `backend/conventions/testing.md` orders. The query with its port
doubled at the constructor; the adapter cut right before the disk, asserting the literal paths read
and the parse of the two **real** run files recorded in the spec; the controller through a listening
server and `fetch`, asserting the literal JSON body, with every refusal also asserting the query was
never asked. The domain has no tests of its own.

The boundary with the plugin gets its own assertion (T6), in the file that already holds the others:
runs built by the plugin's `newRun`/`after` are serialised as `ct-step` serialises them and fed to
our reader, and our attempt matches `StepSeal.attemptOf`. The same test asserts our vocabulary
covers `STEPS` entire.

Fast subset per change, whole suite before handing over:
`npx vitest run --exclude '**/*-real-process.test.js'` — 29 files, 763 tests green today, 1.3s.

## 7. Tasks

### Task 1 — El puerto, el valor y la consulta

**Objective:** the domain can say where a run is, and a read-only use case asks a port for it.

**Files:**
- Modify: `backend/src/domain/exceptions.js`
- Create: `backend/src/domain/ports/implementation-progress.js`
- Create: `backend/src/domain/value-objects/implementation-state.js`
- Create: `backend/src/application/queries/read-implementation-progress.js`
- Create: `backend/__tests__/application/read-implementation-progress.test.js`

Current state (`backend/src/domain/exceptions.js`, the two lines the new family goes after):

```javascript
export class PlanProgressFailure extends PlanFailure {}

export class PlanProgressNotRead extends PlanProgressFailure {}
```

Contract (`backend/src/domain/exceptions.js`, appended in the order the file already uses — family
first, then its causes):

```javascript
export class ImplementationProgressFailure extends PlanFailure {}

export class ImplementationProgressNotRead extends ImplementationProgressFailure {}
```

One cause and not two: `PlanProgressFailure` above sets the precedent, and the spec's §4 records
why `not-understood` was folded into it.

Contract (`backend/src/domain/ports/implementation-progress.js`):

```javascript
export class ImplementationProgress {
  async of({ root, issue }) {
    throw new Error(
      `${this.constructor.name} must implement of({ root, issue }), asked for ${issue} at ${root}`
    )
  }
}
```

Contract (`backend/src/domain/value-objects/implementation-state.js`):

```javascript
export const ImplementationStep = Object.freeze({
  STARTING: 'starting',
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  COMMIT: 'commit',
  RECONCILE: 'reconcile',
  GLOBAL: 'global',
  SLICE_JUDGE: 'slice-judge',
  E2E: 'e2e',
  DELIVERED: 'delivered',
})

export class ImplementationState {
  // The steps that belong to the slice and to no task, plus the two edges of the run.
  // A step in here can carry no task, no task name and no attempt.
  // Public: `RunFileProgress` asks it whether a step is worth opening the plan for.
  static TASKLESS = Object.freeze([
    ImplementationStep.STARTING, ImplementationStep.RECONCILE, ImplementationStep.GLOBAL,
    ImplementationStep.SLICE_JUDGE, ImplementationStep.E2E, ImplementationStep.DELIVERED,
  ])

  constructor({ step, task, totalTasks, name, attempt, discards })  // freezes
  static of({ step, task, totalTasks, name, attempt, discards })
  static starting()
}
```

`of` is the **only** place the rule lives: when `step` is in `TASKLESS`, it nulls `task`, `name` and
`attempt` whatever the caller passed, and keeps `totalTasks` and `discards`. T2 and T3 are where
that rule is measured, through the adapter that feeds it raw run files. Any other step keeps
the six as given. `starting()` is `of` with `step: STARTING` and the other five `null`.

`TASKLESS` is not our reckoning: its four middle members are `PASOS_DE_SLICE` of `ct-step.mjs:201`
—`[RECONCILE, GLOBAL, SLICE_JUDGE, E2E]`— plus the two edges. `RECONCILE` belongs there although
`run-machine.js` lists it among the per-task steps, because `ct-step` reconciles once, after the
last task is committed, with `run.task` frozen on that last one.

Write it **once**. That file's own comment records what the second copy cost: when `e2e` arrived,
the copy that had not been updated attributed every `e2e` row to the last task of the plan. This is
the same list and the same trap.

Contract (`backend/src/application/queries/read-implementation-progress.js`), the exact shape of
`read-plan-progress.js` beside it:

```javascript
export class ReadImplementationProgressParams {
  constructor({ root, issue })   // freezes
}

class ReadImplementationProgressResult {
  constructor({ state })         // freezes
}

export class ReadImplementationProgress {
  constructor({ implementationProgress })
  async execute(params)          // -> ReadImplementationProgressResult
}
```

**TDD:** red first —
`it('the_query_hands_the_port_the_root_and_the_issue_it_was_asked_about')` with a double recording
what it received; then `it('what_the_port_answers_travels_back_whole_inside_the_result')`.

**Two cases and not five.** The normalising rule of `of` is not measured here: a double that
fabricates an `ImplementationState` so the test can look at it is a test of the domain with another
name, and `testing.md` forbids those. It is measured in T2 and T3, where there is raw data to
normalise — a real run file whose `task` must not survive into a slice step.

**Tests:** added: the two above.

**Verification:**

```bash
cd backend
npx vitest run __tests__/application/read-implementation-progress.test.js   # exit 0
```

### Task 2 — El adaptador lee el run file

**Objective:** `RunFileProgress` turns the run file of a worktree into an `ImplementationState`,
still with no task name.

**Files:**
- Create: `backend/src/infrastructure/run-file-progress.js`
- Create: `backend/__tests__/infrastructure/run-file-progress.test.js`

Contract (`backend/src/infrastructure/run-file-progress.js`):

```javascript
export class RunFileProgress extends ImplementationProgress {
  static AGENT_DIRECTORY = '.agent'
  static worktreeFor(root, issue)   // GitWorkspace.pathFor(root, { number: issue })
  static runFileFor(root, issue)    // `${worktree}/.agent/run-${issue}.json`
  static attemptOf(run)             // run.controlRetries + run.judgeRetries + run.correctionRetries + 1
  constructor({ read, exists })
  async of({ root, issue })       // root is a CheckoutRoot; issue is a number
}
```

`root` arrives as the `CheckoutRoot` the route built, and the adapter passes `root.text` on — the
same thing `GitWorkspace.prepare` does with it.

`GitWorkspace.pathFor(root, issue)` is `${root}/.worktrees/${issue.number}` and takes the issue as
an object with a `number`. It is imported from `./git-workspace.js` — one adapter reusing another
adapter's static path builder, so where a worktree lives is written once. Do **not** copy the
string.

The order `of` works in, and it matters:

1. `exists(worktreeFor(root, issue))` is `false` → throw `ImplementationProgressNotRead` naming the
   path that is not there. This is what keeps a deleted worktree from looking like a run that has
   not started.
2. `read(runFileFor(root, issue))` is `null` → `ImplementationState.starting()`.
3. `JSON.parse` throws, or the text is not an object → throw `ImplementationProgressNotRead` naming
   the file. `ct-step` writes with `writeFileSync`, which is not atomic, so a half-written file is a
   real reading and the caller polls again.
4. `run.closed === 'delivered'` → `of({ step: DELIVERED, totalTasks: run.tasksTotal, discards: run.discards })`.
5. Otherwise → `of({ step: run.step, task: run.task, totalTasks: run.tasksTotal, name: null,
   attempt: attemptOf(run), discards: run.discards })`.

`run.step` travels **unmapped**: the contract emits `STEPS` verbatim, which is the spec's §4.

`attemptOf` is ours and not imported: `StepSeal.attemptOf` lives in the plugin, and T6 measures ours
against it.

**TDD:** red first — `it('the_state_of_a_task_comes_from_the_run_file_of_that_worktree')`, feeding
the **literal** run file of `banco-de-la-puerta` recorded in the spec:

```json
{"plan":"docs/superpowers/plans/2026-09-03-issue-99-el-banco.md","issue":99,
 "baseSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","task":1,"tasksTotal":3,
 "e2eRuns":[],"step":"implement","controlRetries":0,"judgeRetries":0,
 "correctionRetries":0,"reconcileRetries":0,"discards":0,"spendUsd":0}
```

and asserting `{ step: 'implement', task: 1, totalTasks: 3, name: null, attempt: 1, discards: 0 }`
plus that `read` was asked for the literal path
`/checkout/.worktrees/99/.agent/run-99.json`. Then:

- `it('a_run_the_step_program_has_not_created_yet_is_a_slice_that_is_starting')` — `exists` true,
  `read` answers `null`.
- `it('a_worktree_that_is_not_there_is_not_a_run_that_has_not_started')` — `exists` false, expect
  `ImplementationProgressNotRead`, and assert `read` was never called.
- `it('a_run_that_closed_delivered_says_so_and_forgets_the_task_it_stopped_on')` — the second real
  file, the one of `repo-pulse` (`"task": 7, "tasksTotal": 7, "step": "slice-judge",
  "sliceCommits": 1, "closed": "delivered"`, its huge `lastVerdict` cut down to `{"ruling":"PASS"}`
  because nothing reads it), expecting `{ step: 'delivered', task: null, totalTasks: 7, name: null,
  attempt: null, discards: 0 }`.
- `it('a_step_of_the_slice_answers_the_total_but_no_task_and_no_attempt')` — a run with
  `step: 'global', task: 7, tasksTotal: 7, discards: 1` and no `closed`, expecting
  `{ step: 'global', task: null, totalTasks: 7, name: null, attempt: null, discards: 1 }`. This is
  the case that proves `run.task`, frozen on the last task, does not reach the answer.
- `it('the_attempt_counts_the_three_retries_that_reset_with_every_task')` — a run with
  `controlRetries: 1, judgeRetries: 2, correctionRetries: 0` on `step: 'judge'`, expecting
  `attempt: 4`.
- `it('half_a_json_is_a_file_that_could_not_be_read_and_not_a_run_without_tasks')` — `read` answers
  `'{"task": 3, "tasksTot'`, expect `ImplementationProgressNotRead` whose message names the file.

**Tests:** added: the seven above.

**Verification:**

```bash
cd backend
npx vitest run __tests__/infrastructure/run-file-progress.test.js   # exit 0
test "$(grep -c "\.worktrees/" src/infrastructure/run-file-progress.js)" -eq 0   # the path comes from GitWorkspace
```

### Task 3 — El nombre de la tarea sale del plan

**Objective:** the state of a task carries the name of that task, read from the plan the run names.

**Files:**
- Modify: `backend/src/infrastructure/run-file-progress.js`
- Modify: `backend/__tests__/infrastructure/run-file-progress.test.js`

Contract (`backend/src/infrastructure/run-file-progress.js`, added to the module — the class has one
consumer, the adapter beside it, so `architecture.md` keeps it in this file and does not export it):

```javascript
class PlanTaskNames {
  static HEADING = /^### Task (\d+) — (.*)$/
  static FENCE = '```'
  static of(markdown)   // -> Map<number, string>, the trimmed name by task number
}
```

The separator in `HEADING` is an **em dash** (`—`, U+2014), copied from `TASK_HEADING` in
`plugin/scripts/plan-tasks.js:61`. A hyphen matches nothing.

`of` walks the lines toggling a boolean on every line that starts with `FENCE`, and only tests the
heading on lines outside a fence. That is the whole of what `annotate` does in the plugin for this
purpose; the rest of `extractTasks` validates the plan's contract, which no caller here needs.

`RunFileProgress.of` gains one step, between 4 and 5 of Task 2: when
`ImplementationState.TASKLESS` does **not** contain `run.step`, read `${worktree}/${run.plan}` and
look the name up by `run.task`. Asking the value object is what keeps the list of slice steps in one
place; do not write a second copy of it here. `run.plan` is a path **relative to the
worktree** (`docs/superpowers/plans/2026-09-03-issue-99-el-banco.md` in the real file).

Two absences are `null` and never a failure: a plan the disk does not hand back (`read` answers
`null`) and a plan with no heading for that number. The name is a label on a screen, and a slice
whose plan was moved still has a step and a task worth answering — `not-read` is for the state, not
for its decoration.

**TDD:** red first — `it('the_name_of_the_task_comes_from_the_heading_of_that_number_in_the_plan')`,
scripting `read` to answer the run file and then this plan, built line by line so the fence is a
value and not a literal — a plan file cannot hold a nested fence, and this document is itself parsed
by `extractTasks`:

```javascript
const FENCE = '`'.repeat(3)
const PLAN = [
  '# Un plan',
  '',
  '### Task 1 — el primero',
  '### Task 2 — el lector del plan',
  '',
  FENCE,
  '### Task 3 — el de dentro de un bloque',
  FENCE,
  '',
].join('\n')
```

with `run.task: 2`, expecting `name: 'el lector del plan'`, and asserting `read` was asked for
`/checkout/.worktrees/99/docs/superpowers/plans/….md`. Then:

- `it('a_heading_inside_a_fenced_block_is_not_a_task')` — ask for task 3 on that same plan and
  expect `name: null`.
- `it('a_plan_that_is_not_on_disk_costs_the_name_and_not_the_state')` — `read` answers the run file
  and then `null`; expect the state whole with `name: null`.
- `it('a_step_of_the_slice_does_not_go_looking_for_a_plan')` — a delivered run; assert `read` was
  called **once**.

**Tests:** added: the four above. The `name: null` of Task 2's first case becomes the real name in
that test's plan, or stays `null` if its double answers no plan — either way the six earlier cases
keep asserting what they asserted.

**Verification:**

```bash
cd backend
npx vitest run __tests__/infrastructure/run-file-progress.test.js   # exit 0: ten cases
test "$(grep -c 'plan-tasks' src/infrastructure/run-file-progress.js)" -eq 0   # nothing imported from the plugin
```

### Task 4 — La ruta y su montaje

**Objective:** `GET /implement-progress/:issue?root=…` answers the state as JSON, and refuses a
missing root.

**Files:**
- Create: `backend/src/infrastructure/implement-progress-route.js`
- Modify: `backend/src/infrastructure/api-server.js`
- Modify: `backend/__tests__/infrastructure/refusal-codes.test.js`
- Create: `backend/__tests__/infrastructure/implement-progress-route.test.js`

Contract (`backend/src/infrastructure/implement-progress-route.js`):

```javascript
export const ProgressRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ROOT: 'malformed-root',
})

export class ProgressRequest {
  static ROOT_FIELD = 'root'
  constructor({ outcome, root, issue })          // freezes
  static from(rawIssue, rawRoot)                 // -> ProgressRequest
}

export class ProgressRefusal {
  static of(asked)                               // -> Refusal, via Projection
  static declaredOutcomes()
}

export class ProgressCollapse {
  static of(cause)                               // ImplementationProgressNotRead -> 400
  static declaredFailures()
  static declaredCodes()
}

export class ImplementProgressRoute {
  static PATH = '/implement-progress/:issue'
  static METHOD = 'GET'
  static handledBy(readImplementationProgress)
}
```

`handledBy` takes the query object and calls
`readImplementationProgress.execute(new ReadImplementationProgressParams({ root: asked.root, issue: asked.issue }))`.

`from` builds `root` with `new CheckoutRoot(rawRoot)` when `CheckoutRoot.isWellFormed(rawRoot)`, and
refuses with `MALFORMED_ROOT` otherwise — the door guard of `simplicity.md`, and the same shape
`EventsRequest.from` uses for `RepositoryName`.

`issue` is `Number(rawIssue)` and there is no refusal for it: the spec's §3 and §4 decided that, and
the conversion is there because the value composes a disk path — `Number('../../etc')` is `NaN` and
cannot climb out of the checkout.

The refusal detail is
`root is an absolute path such as ${CheckoutRoot.EXAMPLE}`, and the collapse code is
`implementation-progress-not-read` at status `400`, which is what `ImplementCollapse` and
`PlanCollapse` already answer for a typed failure.

The answer body, built by the route and not by the value object — the snake case belongs to the
wire:

```javascript
{
  step: state.step,
  task: state.task,
  total_tasks: state.totalTasks,
  name: state.name,
  attempt: state.attempt,
  discards: state.discards,
}
```

Current state (`backend/src/infrastructure/api-server.js`, the block the new route goes after):

```javascript
    app.get(
      PlanEventsRoute.PATH,
      Browsers.turnAwayForeign,
      PlanEventsRoute.handledBy(this.sessions, this.planEvents)
    )
```

Contract (`backend/src/infrastructure/api-server.js`): the constructor takes one more collaborator,
`implementProgress`, kept on `this`, and the route is mounted the same way — `app.get`,
`Browsers.turnAwayForeign`, the handler. **No `app.all` with `refuseOtherMethods`**: `PlanEventsRoute`,
the only other GET, does not have one, and a POST here falls through to `Failures.nothingMatched`.

Current state (`backend/__tests__/infrastructure/refusal-codes.test.js`): `RequestVocabularies.codes()`
spreads `PlanRequestOutcome`, `ImplementRequestOutcome` and `EventsRequestOutcome`, and the second
test spreads `PlanCollapse.declaredCodes()` and `ImplementCollapse.declaredCodes()`.

Contract: `ProgressRequestOutcome` joins the first list and `ProgressCollapse.declaredCodes()` the
second. `malformed-root` is a **new** code, shared with nobody, so
`SharedOnPurposeAcrossRequestVocabularies.CODES` is not touched and both tests stay green as they
are.

**TDD:** red first —
`it('a_run_in_the_middle_of_a_task_answers_the_step_the_task_and_its_name')`, through a listening
server and `fetch` on `/implement-progress/99?root=%2Fcheckout`, asserting `200` and the literal
body `{"step":"judge","task":3,"total_tasks":7,"name":"el lector del plan","attempt":2,"discards":0}`.
Then:

- `it('the_wire_says_total_tasks_and_the_value_object_says_totalTasks')` — assert the parsed body has
  own property `total_tasks` and does not have `totalTasks`.
- `it('a_slice_that_has_not_started_answers_starting_with_nothing_filled_in')` — `200` and
  `{"step":"starting","task":null,"total_tasks":null,"name":null,"attempt":null,"discards":null}`.
- `it('a_call_with_no_root_is_refused_and_the_progress_is_never_read')` —
  `/implement-progress/99`, `400`, body
  `{"code":"malformed-root","detail":"root is an absolute path such as /Users/you/repos/name"}`,
  and the query spy recorded no call.
- `it('a_relative_root_is_refused_the_same_way')` — `?root=repos/name`.
- `it('a_worktree_that_is_not_there_collapses_into_a_progress_that_could_not_be_read')` — the query
  throws `ImplementationProgressNotRead('no worktree at /checkout/.worktrees/99')`, expect `400` and
  `{"code":"implementation-progress-not-read","detail":"no worktree at /checkout/.worktrees/99"}`.
- `it('an_issue_that_is_not_a_number_reaches_the_query_as_NaN_and_not_as_a_refusal')` —
  `/implement-progress/abc?root=%2Fcheckout`; assert the query **was** asked and that the `issue` it
  received is `NaN` (`Number.isNaN(spy.asked[0].issue)`).
- `it('a_bug_of_ours_is_not_dressed_up_as_a_refusal')` — the query throws `TypeError`, expect `500`
  through the last net, following the `buggy()` case `api-server.test.js` already has.

**Tests:** added: the eight above. Modified: none — the two in `refusal-codes.test.js` gain the new
vocabulary in their inputs and keep their assertions.

**Verification:**

```bash
cd backend
npx vitest run __tests__/infrastructure/implement-progress-route.test.js   # exit 0
npx vitest run __tests__/infrastructure/refusal-codes.test.js              # exit 0: no code collides
npx vitest run --exclude '**/*-real-process.test.js'                       # exit 0: nothing else moved
```

### Task 5 — El 202 del arranque devuelve la raíz del checkout

**Objective:** whoever starts a plan gets the checkout root back, which is what the new endpoint
needs to be called at all.

**Files:**
- Modify: `backend/src/infrastructure/start-plan-route.js:187-195`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

Current state (`backend/src/infrastructure/start-plan-route.js:187-195`):

```javascript
    Answer.send(response, 202, {
      status: 'started',
      [PlanRequest.ID_FIELD]: asked.story.text,
      [PlanRequest.REPO_FIELD]: asked.repository.text,
      issue: { number: started.watch.issue.number, url: started.watch.issue.url },
      agent: started.agent,
      branch: started.watch.located.branch,
      worktree: started.watch.located.path,
    })
```

Contract: one field more, `root: started.watch.located.root`, after `worktree`. `WorkspaceLocation`
already carries `root` and `GitWorkspace.prepare` already fills it (`new WorkspaceLocation({ root:
root.text, path, branch })`), so nothing upstream changes.

`StartPlanSpy.LOCATED` in `api-server.test.js` is already
`new WorkspaceLocation({ root: '/repo/checkout', path: '/repo/checkout/.worktrees/7', branch: 'feat/7' })`,
so the double needs no change either — only the assertion on the body does.

**TDD:** red first — extend the existing case that asserts the literal `202` body with
`root: '/repo/checkout'` and watch it fail, then add the field. Plus one new case,
`it('the_root_the_answer_carries_is_the_checkout_and_not_the_worktree')`, asserting `root` and
`worktree` are different values and that `worktree` starts with `root`.

**Tests:** added: one. Modified: the existing assertion on the `202` body of `POST /start-plan`.

**Verification:**

```bash
cd backend
npx vitest run __tests__/infrastructure/api-server.test.js   # exit 0
```

### Task 6 — El montaje y la vuelta contra el plugin

**Objective:** the endpoint is wired into the running API, and what we read is measured against the
program that writes it.

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Modify: `backend/__tests__/infrastructure/plugin-contract.test.js`
- Modify: `backend/__tests__/infrastructure/ct-api-real-process.test.js`

Current state (`backend/src/infrastructure/ct-api.mjs`, the `Disk` namespace):

```javascript
class Disk {
  static realpathOf(path) { … }
  static async write(path, text) { … }
  static async read(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (failure) {
      if (failure.code === 'ENOENT') return null
      throw failure
    }
  }
  static async remove(path) { … }
}
```

Contract (`backend/src/infrastructure/ct-api.mjs`):

- `Disk` gains `static async exists(path)`: `stat(path)` and `true`, `false` on any throw. Import
  `stat` from `node:fs/promises` beside `readFile`.
- `Disk.read` is reused as it is — it already answers `null` on `ENOENT`, which is exactly the
  contract `RunFileProgress` was written against.
- `ApiServer` receives `implementProgress`: the **query object**, not a function —
  `new ReadImplementationProgress({ implementationProgress: new RunFileProgress({ read: Disk.read, exists: Disk.exists }) })`.
  The route builds its own `ReadImplementationProgressParams`, exactly as `StartPlanRoute` and
  `ImplementPlanRoute` build theirs. `PlanEvents` is handed a function instead because its stream
  needs a loop; this endpoint has none.
- `ReadImplementationProgressParams` is therefore imported by the route, not by `ct-api.mjs`.

Contract (`backend/__tests__/infrastructure/plugin-contract.test.js`), one more `describe` beside the
ones already there, importing from the plugin — the only place that may:

```javascript
import { STEPS, RUN_STATES, OUTCOMES, newRun, after, DEFAULT_BUDGETS } from '../../../plugin/scripts/run-machine.js'
import { StepSeal } from '../../../plugin/scripts/dispatch-gate.js'
import { extractTasks } from '../../../plugin/scripts/plan-tasks.js'
```

Four cases:

- `it('every_step_the_machine_can_reach_is_a_step_our_vocabulary_declares')` — assert
  `Object.values(STEPS).every((step) => Object.values(ImplementationStep).includes(step))`, and that
  `Object.values(ImplementationStep)` has exactly `Object.values(STEPS).length + 2` members. This is
  the test that falls the day the machine grows a ninth step.
- `it('a_run_the_machine_just_created_is_read_as_the_first_task_about_to_be_implemented')` — build
  `newRun({ plan: 'docs/superpowers/plans/p.md', issue: 7, baseSha: 'a'.repeat(40), tasksTotal: 3, e2eRuns: [] })`,
  serialise it with `JSON.stringify(run, null, 2) + '\n'` exactly as `ct-step` does, feed it to
  `RunFileProgress`, and expect `{ step: 'implement', task: 1, totalTasks: 3, attempt: 1 }`.
- `it('our_attempt_is_the_one_the_dispatch_gate_counts')` — walk a run through `after(run,
  OUTCOMES.FAILED, DEFAULT_BUDGETS)` until a retry counter moves, then assert
  `RunFileProgress.attemptOf(run) === StepSeal.attemptOf(run)`.
- `it('the_delivered_run_the_machine_closes_is_the_delivered_run_we_answer')` — a run carrying
  `closed: RUN_STATES.DELIVERED` reads back as `step: 'delivered'`.

And one for the plan reader, in the same `describe`:

- `it('the_task_names_we_read_are_the_ones_the_plugin_extracts')` — take **this very plan**
  (`docs/superpowers/plans/2026-09-04-progreso-de-la-implementacion.md`, read from disk), run it
  through `extractTasks` and through `RunFileProgress` via a doubled `read`, and assert the name of
  every task matches for every `n`. A real plan with six tasks and fenced blocks holding `###`
  headings is a better fixture than an invented one, and it is the file the executor already has.

Current state (`backend/__tests__/infrastructure/ct-api-real-process.test.js`): the happy path
starts the real process and drives one whole request.

Contract: one case more, `it('the_progress_of_a_slice_is_served_by_the_running_api')` — make a
temporary directory with `.worktrees/7/.agent/run-7.json` holding a minimal run, `fetch`
`/implement-progress/7?root=<tmp>` against the started server, and assert the `200` body. That is
the entrypoint's happy path and nothing else, which is all `testing.md` allows it.

**Tests:** added: five in `plugin-contract.test.js`, one in `ct-api-real-process.test.js`.

**Verification:**

```bash
cd backend
npx vitest run __tests__/infrastructure/plugin-contract.test.js   # exit 0: the plugin and we agree
npx vitest run __tests__/infrastructure/ct-api-real-process.test.js
test "$(grep -rl 'plugin/scripts/' src/ | wc -l | tr -d ' ')" -eq 2   # only the two imports that predate the rule
```

The two that predate it are `cmux-plan-agents.js` (`launch-sentinel.js`, `shquote.js`) and
`git-workspace.js` (`state-paths.js`). Nothing this slice adds appears in that list.

## 8. Global verification

Every task committed, the whole suite green from `backend/`, and the endpoint answering a real
worktree. The by-hand run no command here replaces: start the API, `POST /start-plan` against
`repo-pulse` with `XOP-4909`, check the `202` now carries `root`, press implement, and poll
`/implement-progress/<issue>?root=…` while the slice runs — it must walk `starting` →
`implement` → `controls` → `judge` → `commit` and land on `delivered`.

```bash
cd backend
npx vitest run                                                  # exit 0: the whole suite
npx vitest run --exclude '**/*-real-process.test.js'            # exit 0: 29+ files
npx vitest run __tests__/yardstick.test.js __tests__/yardstick-real-process.test.js
test -z "$(git status --porcelain)"                             # exit 0: everything committed
```

There is no `eslint` in this repository — no config, no dependency, no script.
The linter's job is done by the yardstick above, which walks every file git
knows about and fails on prose in `src`, loose functions, Spanish identifiers
and Spanish test names.

## 9. Assumptions

1. **A blocked run is not deducible and is not deduced.** `ct-step.mjs:1963` persists `closed` only
   on `DELIVERED`; the eight failing closures of `RUN_STATES` leave no trace in the file. Deriving
   them from the counters against `DEFAULT_BUDGETS` would reimplement the decision table outside the
   table. Provenance: spec §2.
2. **`reconcile` answers with no task.** `run-machine.js` counts it among the per-task steps, but
   `ct-step` runs it once, after the last task is committed, with `run.task` frozen on that last
   one. Provenance: not a call of ours — `PASOS_DE_SLICE` at `ct-step.mjs:201` is
   `[RECONCILE, GLOBAL, SLICE_JUDGE, E2E]`, and that list is what `esDeSlice` consults when the
   program attributes a measurement.
3. **A missing plan costs the name, not the state.** The name decorates a screen; a slice whose plan
   file moved still has a step and a task worth answering. Provenance: own call, following the
   spec's rule that an absence is declared and not filled.
4. **`ImplementationProgressFailure` keeps a single cause.** Reading a file cannot both refuse and
   answer garbage in a way any caller tells apart. Provenance: `PlanProgressFailure` sets that
   precedent in `main`, and the spec's §4 records the fold.
5. **No `refuseOtherMethods`.** Only the POST routes declare one; `PlanEventsRoute`, the only GET,
   does not. Provenance: `backend/src/infrastructure/api-server.js:55-77`.
6. **No issue and no `.agent/SLICE.md`.** This is not a CT-dispatched slice: the work happens on a
   development branch of this repository, so `dispatch-check --check-plan` has no issue to validate
   against. Provenance: the repository's own plans under `docs/superpowers/plans/` follow this
   shape.
