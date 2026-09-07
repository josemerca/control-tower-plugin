# El `repo_list` de POST /start-plan — Implementation Plan

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, §2 of this plan and `backend/conventions/` win.

**Spec:** none — there is no separate design document; every decision is closed in §2 of this plan,
and the four that a human took are marked as such.

**Branch:** `feat/repo-list-en-start-plan`, cut from `main` at d89e415 (the merge of PR #119, the
`user_comment` slice). Every `Current state` block below reads verbatim at that base.

**Tech stack:** Node 24 ESM, express 5, vitest 4. No new dependency.

## 1. Context and goal

`POST /start-plan` plans for exactly one repository. `PlanRequest.from` demands `repo`
(`owner/name`) and `path` (absolute), `GitWorkspace.confirm` refuses unless the `origin` of that
`path` is that very repo, and from there the repository is half of everything: it hosts the plan
issue (`gh issue create --repo`), it is where the worktree is cut, it travels literally into the
agent's errand, it names the cmux tab `ct-plan-<owner>__<name>-issue-<n>`, and `repo#issue` is the
identity a plan is known by in `PlanSessions`, `ActivePlans`, `PlanReviewWatch`, both disk
registries and `GET /plan-events/:issue?repo=…`.

So planning the same work across two repositories means two calls, by hand, one after the other.
This slice adds a second way to say where to plan: a field `repo_list`, a list of `{ repo, path }`
pairs, and each pair gets **its own plan** — its own issue, its own worktree, its own agent, its own
`repo#issue`. Nothing downstream of the use case learns a new shape, which is exactly why fan-out
was the shape chosen: a started plan is identified today the same way it will be identified
tomorrow.

### Desired end state

- `POST /start-plan` accepts `repo_list`: a non-empty list of objects with exactly `repo` and `path`.
- `repo` + `path` keep working exactly as today, and a body that uses them answers a 202 that is
  **byte-identical** to today's.
- `repo_list` beside `repo` or `path`: 400 `target-said-twice`. Neither of the three: 400
  `malformed-repo` as today.
- A list that is not a non-empty list of `{ repo, path }`: 400 `malformed-repo-list`. An entry whose
  `repo` or `path` is malformed: 400 `malformed-repo` / `malformed-path`, with the detail naming
  `repo_list[<i>].repo` / `repo_list[<i>].path`. The same repository twice: 400 `repo-listed-twice`.
- Every target's checkout is confirmed, and the story read, **before any issue is opened**: a
  failure there is a 400 and nothing was started.
- Once things are moving, a target that fails does not stop the others: 202 with
  `started: [...]` and `failed: [{ repo, code, detail }]`.
- Every target failed: 400 `no-plan-started`, carrying the same `failed` list.
- `GET /plan-events/:issue`, `POST /implement-plan`, the registries, the recovery and the harvest
  are untouched: each started plan is still one `repo#issue`.

### Out of scope

`POST /implement-plan`, `GET /plan-events/:issue`, the GO, the registries, the recovery and the
harvest: **not because this slice ducks them, but because the decision in §2 is that they stay as
they are**. Each started plan is one `repo#issue`, so each is read, given its GO, implemented and
released one repository at a time, exactly as today — the launch is what happens together, nothing
after it does. Also out: any `path` inferred rather than given, one issue shared by several
repositories, and cross-repo coordination between the N agents. And the frontend
(`StartPlanRequest` types `repo` and `path` as `string`, the form has one input of each and
`WorkflowSnapshot` holds one plan); it keeps sending what it sends today and keeps getting today's
answer, so nothing it does breaks.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Name of the field | `repo_list`, literal |
| What a list means | **fan-out** (human's call): one plan issue, one agent and one identity `repo#issue` per entry |
| Shape of an entry | an object with **exactly** the keys `repo` and `path`; the pair travels together because it is the pair `workspace.confirm` validates (human's call) |
| `repo` and `path` | still accepted, unchanged, for one repository (human's call) |
| `repo_list` beside `repo` or `path` | 400 `target-said-twice`, detail `repo_list already says where to plan, so repo and path must not be given beside it` (human's call) |
| A list that is not a non-empty array of such objects | 400 `malformed-repo-list`, detail `repo_list must be a non-empty list of { repo, path }` |
| An entry whose `repo` is not `owner/name` | 400 `malformed-repo`, detail `repo_list[<i>].repo must be a repository such as owner/name` |
| An entry whose `path` is not absolute | 400 `malformed-path`, detail `repo_list[<i>].path must be an absolute path` |
| The same repository twice in the list | 400 `repo-listed-twice`, detail `repo_list names ${asked.named} twice` |
| How a refusal knows which field to name | `PlanRequest.named`, the literal name of the field the refusal is about; `null` for the refusals that name no field |
| Order of validation | unknown fields → `id` → `user_comment` → neither of the two → `repo_list` beside `repo`/`path` → the list's shape → each entry in order, `repo` before `path` → duplicates → (no list) `repo` → `path` |
| Pre-flight | every target's checkout is confirmed **and** the story is read once, before any issue is opened; a failure there throws and the whole call is a 400 with nothing started (human's call) |
| How many times Jira is read | **once** per call, whatever the number of targets |
| A target that fails once issues are being opened | the remaining targets go on; its own cleanup is the rollback `StartPlan` already does (requeue the issue, undo the worktree) |
| The 202 of a listed request | `{ status: 'started', started: [...], failed: [...] }` |
| Each `started` entry | the fields today's single answer has, minus `status`: `id`, `repo`, `issue`, `agent`, `branch`, `worktree`, `root` |
| Each `failed` entry | `{ repo, code, detail }`, with `code` and `detail` taken from the existing `PlanCollapse` — no second projection of a failure |
| Every target failed | 400 `no-plan-started`, body `{ code, detail, failed: [...] }` |
| The 202 of a `repo` request | byte-identical to today, `RunningApi.ANSWER` included |
| The shape follows the field, not the count | a `repo_list` of one entry answers the listed shape |
| The pair repo + path | a value object `PlanTarget` of its own, in `domain/value-objects/`: the route constructs it, the action consumes it, and it keeps no guard beyond what `RepositoryName` and `CheckoutRoot` already guarantee |
| Who fans out | the use case: `StartPlan.execute` takes `targets` and N=1 is not a special case. The route decides nothing but the shape of the answer |
| What the route reads to choose the shape | `PlanRequest.listed`, true only when the body used `repo_list` |
| What happens after the launch | the plans are launched simultaneously, and from there **each repository is driven independently, exactly as today**: its own plan to read, its own GO, its own `POST /implement-plan`, its own pull request. One press implements one repository (human's call) |
| New port, new endpoint, new dependency | none |
| Frontend | out of scope (human's call): `repo_list` is reached by API for now, the way `/start-plan` was already used on repo-pulse. Teaching the form to add repo+path pairs, and `Home.tsx` to hold N plans in flight, is another branch with its own plan. The backend must not change one byte of what it answers a body with `repo` |

## 3. Reference patterns

Files to imitate:
`backend/src/domain/value-objects/plan-comment.js` and
`backend/src/domain/value-objects/checkout-root.js` (value object, frozen, `isWellFormed`, no
`toString` without a reader), `backend/src/infrastructure/start-plan-route.js` (request model,
closed vocabulary of outcomes, refusals as an exhaustive `Projection`),
`backend/src/application/actions/start-plan.js` (use case orchestrating ports, with its `Params`
and `Result` beside it), `backend/__tests__/application/start-plan.test.js` (doubles as mothers
with named scenarios, `steps` pinning the order), `backend/__tests__/infrastructure/plan-request.test.js`
(order of refusals, one assertion per first-thing-wrong),
`backend/__tests__/infrastructure/api-server.test.js` (the boundary through a listening server and
`fetch`, asserting the literal JSON body).

Rules to obey:
`backend/conventions/README.md`, `backend/conventions/architecture.md`,
`backend/conventions/domain.md`, `backend/conventions/infrastructure.md`,
`backend/conventions/simplicity.md`, `backend/conventions/testing.md`,
`plugin/conventions/style.md`, `plugin/conventions/defects.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/testing.md`.

Nothing "just in case". The guard on what the body carries happens once, at the HTTP door;
`PlanTarget` forms no second opinion about a `RepositoryName` that was already built. No branch for
a target count that cannot arrive.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/plan-target.js` | create | `PlanRequest`, `StartPlan` | Contract (T1) |
| `backend/src/application/actions/start-plan.js` | modify | `StartPlanRoute` | Current state + Contract (T1) |
| `backend/src/infrastructure/start-plan-route.js` | modify | `ApiServer` | Current state + Call site + Contract (T1, T2, T3, T4) |
| `backend/__tests__/application/start-plan.test.js` | modify | — | prose (T1) |
| `backend/__tests__/infrastructure/plan-request.test.js` | modify | — | prose (T2, T3) |
| `backend/__tests__/infrastructure/plan-refusal.test.js` | modify | — | prose (T3) |
| `backend/__tests__/infrastructure/api-server.test.js` | modify | — | prose (T1, T3, T4) |

## 5. Interfaces

Consumes: N/A — no dependency slice; every port this touches (`Workspace`, `UserStories`,
`PlanIssues`, `PlanAgents`, `CheckoutRegistry`) keeps the signature it has today.

Produces:
`PlanTarget` — `new PlanTarget({ repository, root })`, read through `.repository` and `.root`.
`StartPlanParams` — `new StartPlanParams({ story, comment, targets })`, `targets` a non-empty list
of `PlanTarget`.
`StartPlanResult` — `.started`, a list of `PlanStarted` (`.repository`, `.agent`, `.watch`), and
`.failed`, a list of `PlanNotStarted` (`.repository`, `.cause`).
`PlanRequest` — `.targets` (list of `PlanTarget`), `.listed` (boolean), `.named` (the field a
refusal is about, or `null`).
`PlanRequestOutcome.TARGET_SAID_TWICE`, `.MALFORMED_REPO_LIST`, `.REPO_LISTED_TWICE`,
`.NO_PLAN_STARTED`.

## 6. Test strategy

Outside-in from `backend/`, as `backend/conventions/testing.md` orders. The use case with every
port doubled at the constructor, asserting what each port received, that `userStories` was asked
**once** for a call with several targets, and that no issue was opened when a later target's
checkout could not be confirmed — the order pinned by the `steps` list the `Flow` mother already
keeps. The boundary through a listening server and `fetch`, asserting the literal JSON body of the
new 202 and of every new refusal, plus that the use case was never asked when the body was refused.
`PlanRequest.from` directly for the order in which two things wrong in one body are told apart.

The domain has no tests of its own: `PlanTarget` is reached through `PlanRequest` and through the
use case. No new real-process test — nothing here can be observed by spawning a process that has
no `gh` and no `git` remote.

Fast subset per change, whole suite before handing over:
`npx vitest run --exclude '**/*-real-process.test.js'` — 34 files, 929 tests green today.

## 7. Tasks

### Task 1 — El caso de uso planifica para una lista de destinos

**Objective:** `StartPlan` takes a list of targets and answers what started and what did not, with
the HTTP behaviour of a one-repository body unchanged.

**Files:**
- Create: `backend/src/domain/value-objects/plan-target.js`
- Modify: `backend/src/application/actions/start-plan.js`
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/application/start-plan.test.js`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

Current state (backend/src/application/actions/start-plan.js, lines 4-12):

```javascript
export class StartPlanParams {
  constructor({ story, comment, repository, root }) {
    this.story = story
    this.comment = comment
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }
}
```

Contract (backend/src/domain/value-objects/plan-target.js and .../actions/start-plan.js):

```javascript
export class PlanTarget {
  constructor({ repository, root })   // frozen; no guard: both arguments are already value objects
}
// start-plan.js, beside StartPlanParams:
export class StartPlanParams { constructor({ story, comment, targets }) }
export class PlanStarted { constructor({ repository, agent, watch }) }
export class PlanNotStarted { constructor({ repository, cause }) }
export class StartPlanResult { constructor({ started, failed }) }
```

`execute` becomes the two phases §2 closed. Pre-flight, which throws: `confirm` for every target
in order, keeping each canonical root, then the story read once. Then per target, in order, today's
body with the target's repository and root and the story passed in rather than read; a `PlanFailure`
from a target's own steps becomes a `PlanNotStarted` and the next target goes on, anything else
keeps propagating. `#accept` builds one `PlanTarget`, and a `failed` of one collapses through
`PlanCollapse.of(failed[0].cause)` exactly as today; the 202 reads `repo` from
`started.watch.repository.text`.

**TDD:** red first — `it('the_story_is_read_once_however_many_repositories_were_asked_for')`, two
targets, `userStories.asked` of length 1 and `planIssues.asked` of length 2. Then the pre-flight
boundary: `it('no_issue_is_opened_when_the_second_checkout_cannot_be_confirmed')`, the failure
propagating **and** `planIssues.asked` empty; and past it,
`it('a_repository_that_fails_while_starting_does_not_stop_the_ones_behind_it')`, `started` and
`failed` each carrying one, the failed one being the one asked to fail.

**Tests:** added: the three above, plus `Flow.OTHER_TARGET` and `flow.runAcross(targets)` on the
`Flow` mother. Modified: `Flow.run` builds `targets: [new PlanTarget(...)]`;
`WorkspaceDouble.confirm` can be told which root to refuse; `StartPlanSpy` records `params.targets`
and answers one `PlanStarted`. Removed on purpose: none.

**Verification:** the use case fans out and the boundary answers what it answered before.

```bash
npx vitest run __tests__/application/start-plan.test.js   # exit 0: pre-flight, fan-out, per-target failure
test "$(grep -c 'read_once_however_many_repositories' __tests__/application/start-plan.test.js)" -eq 1
npx vitest run __tests__/infrastructure/api-server.test.js   # exit 0: the 202 of a one-repo body is untouched
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else regressed
```

### Task 2 — El rechazo nombra el campo del que habla

**Objective:** a refusal about a field takes that field's name from the request instead of from a
constant, with every answer byte-identical to today's.

**Files:**
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/infrastructure/plan-request.test.js`

Current state (backend/src/infrastructure/start-plan-route.js, lines 50-52):

```javascript
  static refused(outcome) {
    return new PlanRequest({ outcome, story: null, comment: null, repository: null, root: null, fields: [] })
  }
```

Current state (backend/src/infrastructure/start-plan-route.js, lines 126-135):

```javascript
    [PlanRequestOutcome.MALFORMED_REPO, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_REPO,
      detail: `${PlanRequest.REPO_FIELD} must be a repository such as ${RepositoryName.EXAMPLE}`,
    })],
    [PlanRequestOutcome.MALFORMED_PATH, () => new Refusal({
      status: 400,
      code: PlanRequestOutcome.MALFORMED_PATH,
      detail: `${PlanRequest.PATH_FIELD} must be an absolute path`,
    })],
```

Contract (backend/src/infrastructure/start-plan-route.js):

```javascript
static refused(outcome, named = null)   // `named`: the literal name of the field the refusal is about
// and the two projections above take the request, as UNKNOWN_FIELD already does:
[PlanRequestOutcome.MALFORMED_REPO, (asked) => new Refusal({
  status: 400, code: PlanRequestOutcome.MALFORMED_REPO,
  detail: `${asked.named} must be a repository such as ${RepositoryName.EXAMPLE}`,
})],
```

`PlanRequest` gains `named`, defaulting to `null`, frozen with the rest. `refused` passes
`PlanRequest.REPO_FIELD` and `PlanRequest.PATH_FIELD` at the two call sites that already refuse for
those two reasons, so both details keep reading `repo must be…` and `path must be…` letter for
letter. The refusals that name no field (`body-not-a-json-object`, `nothing-to-plan`,
`malformed-id`, `malformed-user-comment`, `unknown-field`) keep their static detail and leave
`named` at `null`.

**TDD:** red first — `it('the_refusal_about_a_field_carries_the_name_of_the_field_it_is_about')` in
`plan-request.test.js`, asserting `PlanRequest.from('{"id":"ABC-1"}').named` is `'repo'` and that
`PlanRequest.from('{"id":"ABC-1","repo":"owner/name"}').named` is `'path'`, and that a
`nothing-to-plan` body leaves `named` at `null`.

**Tests:** added: the one above. Modified: none — every existing assertion on a literal detail is
what proves this task changed no answer. Removed on purpose: none.

**Verification:** the details are the same bytes, now built from the request.

```bash
npx vitest run __tests__/infrastructure/plan-request.test.js   # exit 0: `named` says which field
npx vitest run __tests__/infrastructure/plan-refusal.test.js   # exit 0: every outcome still declared
npx vitest run __tests__/infrastructure/api-server.test.js   # exit 0: the literal 400 bodies are untouched
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else regressed
```

### Task 3 — La frontera lee `repo_list` y responde por cada repo

**Objective:** a body with `repo_list` starts one plan per entry and answers what started and what
did not.

**Files:**
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/infrastructure/plan-request.test.js`
- Modify: `backend/__tests__/infrastructure/plan-refusal.test.js`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

Current state (backend/src/infrastructure/start-plan-route.js, lines 27-34):

```javascript
export class PlanRequest {
  static ID_FIELD = 'id'
  static COMMENT_FIELD = 'user_comment'
  static REPO_FIELD = 'repo'
  static PATH_FIELD = 'path'
  static KNOWN_FIELDS = Object.freeze([
    PlanRequest.ID_FIELD, PlanRequest.COMMENT_FIELD, PlanRequest.REPO_FIELD, PlanRequest.PATH_FIELD,
  ])
```

Contract (backend/src/infrastructure/start-plan-route.js):

```javascript
static REPO_LIST_FIELD = 'repo_list'   // joins KNOWN_FIELDS
static ENTRY_FIELDS = Object.freeze(['repo', 'path'])   // exactly these keys, in an entry
// PlanRequestOutcome gains, each with its Refusal in the Projection:
TARGET_SAID_TWICE: 'target-said-twice'      // the three details are §2's, literally
MALFORMED_REPO_LIST: 'malformed-repo-list'
REPO_LISTED_TWICE: 'repo-listed-twice'
// and PlanRequest carries what the route reads:
this.targets   // non-empty list of PlanTarget, one entry long for a body with `repo`
this.listed    // true only when the body used `repo_list`
```

The order of the new refusals, and the `named` each sets, are §2's, applied where §2 puts them:
after `nothing-to-plan`, before today's `repo`. `#accept`, when `asked.listed`, sends a 202 whose
`started` is one object per `PlanStarted` — today's fields minus `status`, `repo` from
`plan.watch.repository.text` — and whose `failed` is `{ repo, code, detail }` per `PlanNotStarted`,
from `PlanCollapse.of(cause)`. `sessions.remember` and `reviews.start` run for every started plan.

**TDD:** red first — `it('a_body_that_says_where_to_plan_twice_is_refused_by_that_name')`,
`target-said-twice` for `repo_list` with `repo` and with `path`. Then the shape boundary:
`it('a_repo_list_that_is_not_a_non_empty_list_of_pairs_is_refused_as_one')`, with `[]` on the limit
and one valid pair just past it. Then
`it('a_malformed_entry_is_named_by_its_position_in_the_list')`,
`it('the_same_repository_twice_in_one_list_is_refused_before_anything_starts')` and
`it('a_repo_list_of_one_entry_answers_the_listed_shape_and_not_the_single_one')`.

**Tests:** added: the five above in `plan-request.test.js`, and in `api-server.test.js`
`it('a_plan_asked_for_across_two_repositories_answers_what_started_and_what_did_not')` asserting the
**literal** JSON body, one entry in `started` and one in `failed`. Modified: `plan-refusal.test.js`
covers the three new outcomes through `declaredOutcomes()`; `StartPlanSpy.failingOne()` answers one
`PlanStarted` and one `PlanNotStarted`. Removed on purpose: none.

**Verification:** the list is parsed, refused and served, and one repository answers as it did.

```bash
npx vitest run __tests__/infrastructure/plan-request.test.js   # exit 0: the order of the new refusals
npx vitest run __tests__/infrastructure/plan-refusal.test.js   # exit 0: the vocabulary stays exhaustive
npx vitest run __tests__/infrastructure/api-server.test.js   # exit 0: the literal 202 of a listed body
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else regressed
```

### Task 4 — Cuando no arrancó ninguno, la llamada no dice que arrancó

**Objective:** a listed request whose every target failed is a 400 that carries why, instead of a
202 with an empty `started`.

**Files:**
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/infrastructure/plan-refusal.test.js`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

Current state (backend/src/infrastructure/start-plan-route.js, lines 216-227):

```javascript
    sessions.remember(started.watch)
    reviews.start(started.watch)
    Answer.send(response, 202, {
      status: 'started',
      [PlanRequest.ID_FIELD]: started.watch.storyText(),
      [PlanRequest.REPO_FIELD]: asked.repository.text,
      issue: { number: started.watch.issue.number, url: started.watch.issue.url },
      agent: started.agent,
      branch: started.watch.located.branch,
      worktree: started.watch.located.path,
      root: started.watch.located.root,
    })
```

Contract (backend/src/infrastructure/start-plan-route.js):

```javascript
NO_PLAN_STARTED: 'no-plan-started'   // detail: `no plan started: every repository of repo_list failed`
// answered as 400 with the failures beside the code:
Answer.send(response, 400, { code, detail, failed })   // `failed`, the same objects the 202 carries
```

Only the listed path can reach it: a body with `repo` whose single target failed keeps collapsing
through `PlanCollapse` into the 400 it answers today, and a listed body with at least one
`PlanStarted` keeps its 202. The reader is whoever called with a list: without this they would have
to inspect `started.length` to tell a total failure from a success.

**TDD:** red first — `it('a_listed_request_whose_every_repository_failed_is_not_a_202')` in
`api-server.test.js`, asserting status 400 and the literal body, with `failed` carrying both
repositories and their codes. On the other side of the limit,
`it('a_listed_request_where_one_of_the_two_started_is_still_a_202')`.

**Tests:** added: the two above. Modified: `plan-refusal.test.js` counts `no-plan-started` among the
declared outcomes; `StartPlanSpy.failingAll()` answers two `PlanNotStarted` and no `PlanStarted`.
Removed on purpose: none.

**Verification:** nothing answers 202 without having started something.

```bash
npx vitest run __tests__/infrastructure/api-server.test.js   # exit 0: 400 when none started, 202 when one did
test "$(grep -c 'no-plan-started' src/infrastructure/start-plan-route.js)" -ge 1
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: the whole fast subset
```

## 8. Global verification

Every task committed, run from `backend/`. The whole suite green, the real-process tests included,
and the two claims this slice must not have broken: a one-repository body answers the same bytes it
answered before (the literal `RunningApi.ANSWER` still asserted in `api-server.test.js`), and no
endpoint but `/start-plan` learned anything about a list.

```bash
npx vitest run   # exit 0: every file, real-process tests included
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: the fast subset
test "$(grep -c 'RunningApi.ANSWER' __tests__/infrastructure/api-server.test.js)" -ge 2
test -z "$(grep -l 'repo_list' src/infrastructure/implement-plan-route.js src/infrastructure/plan-events-route.js src/infrastructure/active-plans-route.js)"
test -z "$(git status --porcelain)"   # exit 0: every task committed, nothing left in the tree
```

By human eyes, once the suite is green: start the API and ask it for a plan across two real
checkouts, then check that each repository got its own issue and its own cmux tab, and that
`GET /active-plans` lists both.

## 9. Assumptions

1. **`PlanTarget` earns a module of its own.** `backend/conventions/architecture.md` puts the burden
   of proof on a new type: this one is constructed in `start-plan-route.js` and consumed in
   `application/actions/start-plan.js`, which is the two-consumer test that document sets. Its
   constructor keeps **no** guard, because `RepositoryName` and `CheckoutRoot` already carry theirs
   and `domain.md` forbids the second opinion. Provenance: repo convention.
2. **`PlanStarted` and `PlanNotStarted` live inside `start-plan.js`**, beside `StartPlanParams` and
   `StartPlanResult`: "the payload only its owner constructs shares the owner's file". Provenance:
   repo convention.
3. **A repository listed twice is refused.** Two issues in the same repository for one call is a
   typo far more often than an intention, and the pre-flight is where the call can still say so for
   free. Provenance: own call — the human closed the shape of the list, not this.
4. **`no-plan-started` is a 400, not a 202 with an empty `started`.** The human chose "validate
   everything first, start partially"; what a call answers when *nothing* started was not put to
   them. A 202 whose `started` is empty reports success for a call that did nothing. Provenance:
   own call, and the one worth a second look at the gate.
5. **A malformed entry reuses `malformed-repo` / `malformed-path`** rather than getting codes of its
   own: the mistake is the same one, and what a caller needs extra is *which* entry — which is what
   `named` carries. It keeps the vocabulary at eleven outcomes instead of thirteen. Provenance: own
   call.
6. **The story is read once per call.** Nothing changes for one target; for N, reading Jira N times
   for one answer would be N chances to fail at something already known. Provenance: own call.
7. **The lifecycle after the launch is unchanged by decision, not by omission** (§2, last row):
   the human closed that each repository is driven independently from the moment its plan exists.
   What made that safe to plan is that a started plan is identified by `repo#issue` today and
   tomorrow, so `/plan-events`, `/implement-plan`, both disk registries, the cmux recovery and the
   harvest each act on one plan and needed no change. Provenance: human's call.
8. **Task 3 leaves one narrow state behind for one commit**: between Task 3 and Task 4, a listed
   request whose every target failed answers 202 with an empty `started`. Task 4 is the next commit
   and closes it. The alternative was a branch no body could reach, which
   `backend/conventions/simplicity.md` refuses outright. Provenance: own call.
9. **Two repositories that differ only in case are two targets, and the slice ships that way.**
   `repo-listed-twice` compares the entry's `repo` as a string, and `RepositoryName` stores what it
   was given, so `[{repo: 'owner/name'}, {repo: 'Owner/Name'}]` fans out two plans against what
   GitHub considers one repository — which is the very thing that refusal exists to prevent. Found
   by the task-3 judge, which correctly declined to fix it here: normalising the case inside the
   duplicate loop or inside `PlanTarget` would be exactly the second opinion about a
   `RepositoryName` that `backend/conventions/domain.md` and `simplicity.md` forbid. Where "the same
   repository" is decided is the value object, and Juanjo chose the domain fix — `RepositoryName`
   canonicalising its case at construction, with the precedent of `PlanComment.trim()` — as a slice
   of its own, because it changes the `repo#issue` identity everywhere and its real cost is the
   migration of names already written to disk and to cmux tab titles. Provenance: judge finding,
   human's call on the remedy.
10. **`NO_PLAN_STARTED` is a member of `PlanRequestOutcome` that `PlanRequest.from` never returns.**
   The rest of that vocabulary means "how parsing the request resolved"; this one is decided by the
   route after the use case answered, so the route builds a throwaway `PlanRequest` to project it.
   It is safe — the outcome cannot collide with the parsing dispatch, because nothing produces it
   there — but `plan-refusal.test.js`'s exhaustiveness test cannot catch the drift: it proves every
   member has a `Refusal`, not that every member is reachable from `from()`. This plan's §7 Task 4
   Contract block dictated that shape, so it is the plan's call and not the implementer's, and the
   task-4 judge flagged it as plan-mandated. Provenance: judge finding on a decision this plan made.
