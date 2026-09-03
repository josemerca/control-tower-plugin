# El claim y el go en el backend — Implementation Plan

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the spec and `backend/conventions/` win.

**Spec:** `docs/superpowers/specs/2026-09-02-claim-y-go-en-el-backend-design.md`

**Branch:** `alcaptar/claim_y_go`, cut from `alcaptar/implement_plan` — it changes the errand that
branch introduces. That branch landed as PR #66 and `main` was merged in afterwards; the merge brought two
decisions of its own: the cmux session is addressed by its **handle** (`agent`) and not by its title, and
the `repo` field had been cut from this endpoint. It comes back — see the spec's §3.

**Tech stack:** Node 24 ESM, express 5, vitest 4. No new dependency.

## 1. Context and goal

`POST /start-plan` creates the plan issue with `status:ready` and never touches it again, and the
implementation errand forbids `dispatch-check --release` because no go is recorded. So every
program of the plugin that reads GitHub sees a slice that is still queued: `/ct-next` would
redispatch it, `/ct-status` shows it as dispatchable, `/ct-harvest` measures `ready→claim` and
`claim→release` as `null`, and the four remaining gates of `--release` never run.

This slice makes the backend leave GitHub exactly as a `/ct-next` dispatch would: it claims the
issue before cutting the worktree, mints the go and answers it on the issue when the human presses
the button, and tells the agent to release.

### Desired end state

- `POST /start-plan` claims the issue (`status:ready` → `status:in-progress`) after opening it and
  **before** cutting the worktree, and returns it to `status:ready` if the worktree or the launch
  fail.
- `POST /implement-plan` mints a nonce, writes its sha256 where `dispatch-check` reads it, comments
  `-OK <nonce>` on the issue, and only then types the errand.
- The implementation errand orders `dispatch-check --release` instead of forbidding it.
- What the backend writes is read back by the plugin's own readers in a contract test.
- Three new 503s. No success response changes, and the nonce travels in none of them.

### Out of scope

The harvest (merge, worktree, branch, cmux tab); the front; the coordinator's `.agent/STATE.md`;
checking the tab is still alive; sowing `status:in-review` inside the plugin; and what to do with
the merge watcher that `--release` launches.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Where the claim happens | in `StartPlan`, after `open`, before `prepare` |
| Label the issue is born with | `status:ready`, unchanged — the timeline keeps its `labeled` event |
| Compensation when `prepare` or `launch` fail | `requeue` back to `status:ready`, swallowed like `undo` already is |
| A failed `requeue` | warns on the injected `stderr` naming the exact `gh` command, never throws |
| Who mints the go | the backend, inside `ImplementPlan`, one nonce per request |
| Nonce shape | four random bytes, lowercase hexadecimal |
| What the registry file stores | the sha256 of the nonce, never the nonce |
| Nothing is imported from `plugin/scripts/` | production code writes its own format; **tests** import the plugin's readers |
| A value object for the nonce | no — the adapter composes it from random bytes; a string suffices |
| File permissions on the registry | none set; no reader checks them and the file holds a hash |
| `status:in-progress` missing from the repo | `claim` sows it, reusing the loop `open` already has |
| `status:in-review` missing from the repo | `claim` sows it before claiming, and refuses to claim if it cannot: this slice is what makes the errand order `--release`, so the precondition is ours |

## 3. Reference patterns

Files to imitate:
`backend/src/infrastructure/git-workspace.js` (adapter with static argv builders, injected
`stderr`, best-effort `undo`), `backend/src/infrastructure/plan-contract-progress.js` (adapter with
injected runner and `stderr`), `backend/src/domain/ports/workspace.js` (port with two methods and
throwing defaults), `backend/src/application/actions/start-plan.js` (use case with compensation),
`backend/__tests__/application/start-plan.test.js` (doubles as mothers, named scenarios),
`backend/__tests__/infrastructure/gh-plan-issues.test.js` (adapter test as a scripted
conversation).

Rules to obey:
`backend/conventions/README.md`, `backend/conventions/architecture.md`,
`backend/conventions/domain.md`, `backend/conventions/infrastructure.md`,
`backend/conventions/testing.md`, `plugin/conventions/style.md`, `plugin/conventions/defects.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/testing.md`.

Nothing "just in case". Simple does not mean fewer layers: it means adding nothing that does not
solve today's problem. Do not guard values this code composes itself.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/ports/plan-issues.js` | modify | `StartPlan`, `ImplementPlan` | Contract (T1, T3) |
| `backend/src/domain/exceptions.js` | modify | routes, adapters | Contract (T1, T3) |
| `backend/src/application/actions/start-plan.js` | modify | `StartPlanRoute` | Current state (T1) |
| `backend/src/infrastructure/start-plan-route.js` | modify | `ApiServer` | Contract (T1) |
| `backend/src/infrastructure/gh-plan-issues.js` | modify | `ct-api.mjs` | Current state + Contract (T2, T5) |
| `backend/src/domain/ports/go-registry.js` | create | `ImplementPlan` | Contract (T3) |
| `backend/src/application/actions/implement-plan.js` | modify | `ImplementPlanRoute` | Current state (T3) |
| `backend/src/infrastructure/implement-plan-route.js` | modify | `ApiServer` | Current state (T3) |
| `backend/src/infrastructure/disk-go-registry.js` | create | `ct-api.mjs` | Contract (T4) |
| `backend/src/infrastructure/plan-agent-brief.js` | modify | `CmuxPlanAgents` | Current state (T6) |
| `backend/src/infrastructure/ct-api.mjs` | modify | — | Call site (T7) |
| `backend/src/infrastructure/invocation.js` | modify | `ct-api.mjs`, the contract test | Contract (T8) |

## 5. Interfaces

Consumes: `dispatch-check.mjs --release` reads the registry with `readGoCommitment({ repo, issue,
configDir, home })` from `plugin/scripts/go-registry.js` and matches the comment with
`matchesGo(body, commitment)` from `plugin/scripts/go-response.js`. Both are the other half of the
contract this slice writes; only tests import them.

Produces:
`PlanIssues.claim({ issue, repository })` — mutates, resolves to nothing.
`PlanIssues.requeue({ issue, repository })` — mutates, resolves to nothing, never throws.
`PlanIssues.answerGo({ issueNumber, repository, nonce })` — mutates, resolves to nothing.
`GoRegistry.mint({ issueNumber, repository })` — resolves to the nonce, a string.
`PlanIssueNotClaimed`, `PlanGoNotAnswered` under `PlanIssueFailure`; `GoFailure` under
`PlanFailure` with `GoNotRecorded` under it.

## 6. Test strategy

Outside-in, from `backend/`, as `backend/conventions/testing.md` orders: the use cases with every
port doubled at the constructor, asserting what each port received and that a later port was never
asked when an earlier step failed; then the adapters, cut right before the tool, asserting the
literal argv and the literal text written.

The boundary with the plugin gets its own assertion (T5): what `DiskGoRegistry` writes is read by
`readGoCommitment`, and the comment `answerGo` sends is matched by `matchesGo` against that same
commitment. That test is the declared-copy measurement of `plugin/conventions/decisions.md`.

The domain has no tests of its own. No new real-process test: the entrypoint's happy path already
covers the wiring, and nothing here can be observed by a process without `gh`.

Fast subset per change, whole suite before handing over:
`npx vitest run --exclude '**/*-real-process.test.js'` — 19 files, 512 tests green today.

## 7. Tasks

### Task 1 — El claim entra en el caso de uso y en la frontera HTTP

**Objective:** `StartPlan` claims the issue before cutting the worktree and returns it to the queue
when a later step fails.

**Files:**
- Modify: `backend/src/domain/ports/plan-issues.js`
- Modify: `backend/src/domain/exceptions.js`
- Modify: `backend/src/application/actions/start-plan.js`
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/application/start-plan.test.js`
- Modify: `backend/__tests__/infrastructure/plan-refusal.test.js`

Current state (backend/src/application/actions/start-plan.js, lines 28-32):

```javascript
  async execute(params) {
    const story = await this.userStories.detail(params.story)
    const issue = await this.planIssues.open({ story, repository: params.repository })
    const located = await this.workspace.prepare({ issue, repository: params.repository })
    const agent = await this.#launch(params, issue, located)
```

Contract (backend/src/domain/ports/plan-issues.js):

```javascript
async claim({ issue, repository })   // throws unless implemented, naming issue?.number and repository
async requeue({ issue, repository }) // same shape; the adapter never throws for a refusal
```

Contract (backend/src/domain/exceptions.js):

```javascript
export class PlanIssueNotClaimed extends PlanIssueFailure {}
```

`PlanCollapse.#BY_FAILURE` gains `[PlanIssueNotClaimed, PlanCollapse.#REFUSED]` — 503: the tool
refused and trying again may work. It reads nothing back, so there is no 502 twin.

`execute` becomes `detail → open → claim → prepare → launch`. `prepare` failing requeues; `launch`
failing undoes the worktree and then requeues. Both compensations are swallowed exactly as
`#abandon` already swallows `undo`.

**TDD:** red first — `it('the_issue_is_claimed_before_the_worktree_is_cut_so_a_second_dispatcher_cannot_take_it')`,
asserting `planIssues.claimed` carries the opened issue **and** that `workspace.asked` is empty
when the claim throws. Then
`it('a_worktree_that_could_not_be_cut_puts_the_issue_back_in_the_queue_instead_of_leaving_a_claim_nobody_works')`
and
`it('an_agent_that_never_launched_puts_the_issue_back_in_the_queue_after_the_worktree_is_undone')`,
each asserting `planIssues.requeued` names the issue and, in the second, that `workspace.undone`
came first.
`it('a_requeue_that_fails_does_not_replace_the_failure_the_caller_has_to_hear')` — the original
`WorkspaceNotPrepared` still surfaces when `requeue` throws.

**Tests:** added: the four above in `start-plan.test.js`; `PlanIssuesDouble` gains
`claimed`/`requeued` arrays and the named scenarios `refusingToClaim(said)` and
`leakingOnRequeue(said)`. Modified: `plan-refusal.test.js` asserts `PlanIssueNotClaimed` projects
to 503 with the literal body `could not start the plan: gh issue edit failed: nope`.

**Verification:** the use case suite and the exhaustiveness suite pass, and the claim is asserted
by name.

```bash
npx vitest run __tests__/application/start-plan.test.js   # exit 0: the use case honours the new order
npx vitest run __tests__/infrastructure/plan-refusal.test.js   # exit 0: every failure still has a status
test "$(grep -c 'claimed_before_the_worktree_is_cut' __tests__/application/start-plan.test.js)" -eq 1
```

### Task 2 — El adaptador reclama, devuelve a la cola y siembra la label que falte

**Objective:** `GhPlanIssues` moves the status label in both directions, sowing
`status:in-progress` when the repo does not have it.

**Files:**
- Modify: `backend/src/infrastructure/gh-plan-issues.js`
- Modify: `backend/__tests__/infrastructure/gh-plan-issues.test.js`

Current state (backend/src/infrastructure/gh-plan-issues.js, lines 56-59):

```javascript
  async #createSowingLabels({ story, repository }) {
    const argv = GhPlanIssues.argvFor({ story, repository })
    const ours = PlanIssueBody.labels(story)
    const sown = new Set()
```

Contract (backend/src/infrastructure/gh-plan-issues.js):

```javascript
static IN_PROGRESS_LABEL = 'status:in-progress'
static statusArgvFor({ issue, repository, adding, removing })
  // ['issue', 'edit', String(issue.number), '--repo', repository.text,
  //  '--add-label', adding, '--remove-label', removing]
async claim({ issue, repository })    // adding IN_PROGRESS_LABEL, removing PlanIssueBody.READY_LABEL
async requeue({ issue, repository })  // the mirror image
constructor({ gh, stderr = (line) => process.stderr.write(line) })
```

`#createSowingLabels` is renamed `#sowing({ argv, ours, repository })` and takes the argv instead of
composing it: `open` and `claim` fail for the same reason (`gh` resolves a label name to an id and
refuses when it does not exist) and are repaired the same way, so the loop is one decision, not two
coincidental copies. `open` passes `PlanIssueBody.labels(story)`; `claim` passes
`[GhPlanIssues.IN_PROGRESS_LABEL]`. Neither is `safeToRepeat`: both are writes.

`requeue` never throws on a refusal — it writes one line to `stderr` naming the exact
`gh issue edit … --add-label status:ready --remove-label status:in-progress` a human can run, the
same shape `GitWorkspace.#warn` already uses.

**TDD:** red first — `it('claiming_an_issue_sends_the_label_swap_gh_understands')` asserting the
literal argv. Then `it('a_status_label_the_repo_does_not_have_is_sown_and_the_claim_retried')`
(scripted refusal `'status:in-progress' not found`, then the `label create --force` argv, then
success), `it('a_label_that_is_not_ours_is_not_sown_and_the_claim_fails_with_what_gh_said')`, and
`it('a_requeue_gh_refused_names_the_command_a_human_can_run_instead_of_throwing')` asserting the
warning contains `--add-label status:ready`.

**Tests:** added: the four above. Removed on purpose: none — the existing `open` tests keep
passing over the renamed private loop, which is what proves the refactor preserved it.

**Verification:** the adapter suite passes, and the sowing loop exists once.

```bash
npx vitest run __tests__/infrastructure/gh-plan-issues.test.js   # exit 0: argv, sowing and the warning
test "$(grep -c 'labelMissingIn' src/infrastructure/gh-plan-issues.js)" -eq 1
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else regressed
```

### Task 3 — El go entra en el dominio, en el caso de uso y en la frontera HTTP

**Objective:** `ImplementPlan` mints the go and answers it on the issue before resuming the agent.

**Files:**
- Create: `backend/src/domain/ports/go-registry.js`
- Modify: `backend/src/domain/ports/plan-issues.js`
- Modify: `backend/src/domain/exceptions.js`
- Modify: `backend/src/application/actions/implement-plan.js`
- Modify: `backend/src/infrastructure/implement-plan-route.js`
- Modify: `backend/__tests__/application/implement-plan.test.js`
- Modify: `backend/__tests__/infrastructure/plan-refusal.test.js`

Current state (backend/src/application/actions/implement-plan.js, lines 9-17):

```javascript
export class ImplementPlan {
  constructor({ planAgents }) {
    this.planAgents = planAgents
  }

  async execute(params) {
    await this.planAgents.resume({ agent: params.agent, issue: params.issue })
  }
```

Contract (backend/src/domain/ports/go-registry.js):

```javascript
export class GoRegistry {
  async mint({ issueNumber, repository })   // resolves to the nonce; throws unless implemented
}
```

Contract (backend/src/domain/exceptions.js):

```javascript
export class PlanGoNotAnswered extends PlanIssueFailure {}
export class GoFailure extends PlanFailure {}
export class GoNotRecorded extends GoFailure {}
```

`PlanIssues` gains `async answerGo({ issueNumber, repository, nonce })`. `ImplementPlan`'s
constructor takes `{ goRegistry, planIssues, planAgents }` and `execute` becomes
`mint → answerGo → resume`, passing the minted nonce to `answerGo` and nothing else. No
compensation: pressing the button again mints a fresh go and the previous comment stops matching.

`ImplementCollapse.#BY_FAILURE` gains `[GoNotRecorded, …#REFUSED]` and
`[PlanGoNotAnswered, …#REFUSED]`. `plan-refusal.test.js` adds `'GoFailure'` to its `FAMILIES` list.

**TDD:** red first —
`it('the_go_is_recorded_and_answered_on_the_issue_before_the_agent_is_told_to_implement')`,
asserting the order and that `planIssues.answered` carries the nonce `mint` returned. Then
`it('a_go_that_could_not_be_recorded_never_reaches_the_issue_nor_the_agent')` and
`it('a_go_the_issue_did_not_take_leaves_the_agent_parked_instead_of_working_without_a_gate')`,
each asserting the later ports were never asked.

**Tests:** added: the three above in `implement-plan.test.js`, plus `GoRegistryDouble` and
`PlanIssuesDouble` with the scenarios `refusing(said)`. Modified: `implement-plan-route.test.js` asserts both new
causes project to 503 with their literal body and that `GoFailure` itself raises
`no status declared`; `plan-refusal.test.js` only adds `'GoFailure'` to its list of families.

**Verification:** the use case suite and the exhaustiveness suite pass.

```bash
npx vitest run __tests__/application/implement-plan.test.js   # exit 0: mint, answer, resume, in order
npx vitest run __tests__/infrastructure/plan-refusal.test.js   # exit 0: both causes declared
test "$(grep -c 'GoFailure' __tests__/infrastructure/plan-refusal.test.js)" -eq 1
```

### Task 4 — El adaptador que escribe el registro del go en disco

**Objective:** `DiskGoRegistry` mints a nonce and writes its sha256 where `dispatch-check` looks
for it.

**Files:**
- Create: `backend/src/infrastructure/disk-go-registry.js`
- Create: `backend/__tests__/infrastructure/disk-go-registry.test.js`

Contract (backend/src/infrastructure/disk-go-registry.js):

```javascript
export class DiskGoRegistry extends GoRegistry {
  static NONCE_BYTES = 4
  static DIRECTORY = 'go'
  static nonceFrom(bytes)               // Buffer -> lowercase hexadecimal
  static commitmentOf(nonce)            // sha256 hexadecimal digest of the nonce
  static fileNameFor({ issueNumber, repository })
    // `${repository.text.replace(/\//g, '__')}-${issueNumber}.json` — no character sanitiser:
    // RepositoryName already restricts the shape, and guarding a value this code validated is
    // exactly what §4.4 refuses to add
  static pathFor({ issueNumber, repository, root })
  static contentFor({ issueNumber, repository, commitment })
    // `${JSON.stringify({ repo, issue, commitment }, null, 2)}\n`
  constructor({ random, write, root })  // random(bytes) -> Buffer; root is the control-tower dir
  async mint({ issueNumber, repository })   // GoNotRecorded when write refuses
}
```

`root` is the `control-tower` directory itself, so the file lands at
`<root>/go/<owner>__<name>-<n>.json`. It arrives with no default: choosing where the coordinator's
state lives is the entrypoint's job, not this adapter's.

The nonce is returned in the clear and **never written**: the file carries only the commitment.

**TDD:** red first — `it('the_file_lands_where_dispatch_check_looks_for_the_go_of_that_repo_and_issue')`
asserting the literal path with `random` fixed to `Buffer.from([1, 2, 3, 4])`. Then
`it('the_slash_of_a_repository_becomes_a_double_underscore_so_the_name_is_one_path_segment')`,
`it('the_nonce_is_returned_in_the_clear_and_only_its_digest_reaches_the_disk')` asserting the
written text contains the sha256 of `01020304` and not the string `01020304`, and
`it('a_registry_the_disk_refused_is_a_go_that_was_never_recorded')` for `GoNotRecorded`.

**Tests:** added: the four above.

**Verification:** the adapter suite passes and the nonce is absent from what was written.

```bash
npx vitest run __tests__/infrastructure/disk-go-registry.test.js   # exit 0: path, name, digest, refusal
test "$(grep -c 'only_its_digest_reaches_the_disk' __tests__/infrastructure/disk-go-registry.test.js)" -eq 1
```

### Task 5 — El comentario del go, y la vuelta completa contra los lectores del plugin

**Objective:** `answerGo` comments the go on the issue in the exact shape `--release` matches, and a
contract test proves the plugin reads both halves of what the backend wrote.

**Files:**
- Modify: `backend/src/infrastructure/gh-plan-issues.js`
- Modify: `backend/__tests__/infrastructure/gh-plan-issues.test.js`
- Create: `backend/__tests__/infrastructure/go-contract.test.js`

Contract (backend/src/infrastructure/gh-plan-issues.js):

```javascript
static GO_TOKEN = '-OK'
static goBodyFor(nonce)               // `${GhPlanIssues.GO_TOKEN} ${nonce}`
static goArgvFor({ issueNumber, repository, nonce })
  // ['issue', 'comment', String(issueNumber), '--repo', repository.text,
  //  '--body', GhPlanIssues.goBodyFor(nonce)]
async answerGo({ issueNumber, repository, nonce })   // PlanGoNotAnswered when gh refuses
```

`GO_TOKEN` and the body's shape are a declared copy of the plugin's `GO_TOKEN` and `goBody`: the
two halves of a contract that crosses a process boundary have to exist twice, and
`plugin/conventions/decisions.md` requires the copy be measured by a test comparing them. That test
is `go-contract.test.js`, the only place in this slice that imports from `plugin/`.

Not `safeToRepeat`: a lost answer may be an answer, and the retry would post a second comment.

**TDD:** red first — `it('answering_the_go_sends_the_comment_gh_understands')` asserting the literal
argv. Then `it('a_comment_gh_refused_is_a_go_the_issue_never_took')`. In `go-contract.test.js`:
`it('the_release_gate_of_the_plugin_reads_the_commitment_this_backend_wrote')` — write with
`DiskGoRegistry` into a temporary root, read with `readGoCommitment`, and assert the commitment
comes back; then
`it('the_release_gate_of_the_plugin_matches_the_comment_this_backend_sends')` — feed
`goBodyFor(nonce)` and that same commitment to `matchesGo` and assert it holds.

**Tests:** added: the two adapter tests and the two contract tests.

**Verification:** the adapter suite and the contract suite pass, and only the contract test reaches
into the plugin.

```bash
npx vitest run __tests__/infrastructure/gh-plan-issues.test.js   # exit 0: the go comment argv and its refusal
npx vitest run __tests__/infrastructure/go-contract.test.js   # exit 0: the plugin reads both halves
test "$(grep -rl 'plugin/scripts/go-' src/ | wc -l | tr -d ' ')" -eq 0
```

### Task 6 — El encargo manda liberar en vez de prohibirlo

**Objective:** the implementation errand orders `dispatch-check --release`, because the go it
needs is now recorded and the issue is claimed.

**Files:**
- Modify: `backend/src/infrastructure/plan-agent-brief.js`
- Modify: `backend/__tests__/infrastructure/plan-agent-brief.test.js`

Current state (backend/src/infrastructure/plan-agent-brief.js, lines 55-57):

```javascript
      `Entonces abre la pull request con \`Closes #${issueNumber}\` en el cuerpo y PARA: no la mergees,`,
      `${PlanAgentBrief.NO_NEW_WORKTREES}, y NO ejecutes \`dispatch-check --release\` aunque ct-step te lo diga`,
      '(en este flujo el issue no se reclama y el permiso que esa puerta exige no se acuña: saldría por 9).',
```

Those three lines become: open the pull request with `Closes #<n>` in the body, then release with
`node <dispatchCheck> <n> --repo <repo> --release`, and stop there without merging and without new
worktrees. The `dispatchCheck` path is already in the constructor and already validated absolute.

Still one single line: `cmux send` types what it receives and `send-key Enter` runs it, so a
newline would run the order half-written.

**TDD:** red first — `it('it_orders_the_release_that_moves_the_issue_to_review_instead_of_forbidding_it')`,
asserting the errand contains `node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --release`
and **not** the words that forbade it. Then
`it('it_still_stops_before_the_merge_because_that_is_the_second_human_decision')`.

**Tests:** added: the two above. Removed on purpose:
`it('it_waves_off_the_release_that_ct_step_will_suggest_so_the_agent_does_not_crash_into_exit_9')`
and `it('it_says_why_no_release_permission_gets_minted_in_this_flow')` — the reason both existed is
gone, and leaving either would pin the behaviour this task removes.

**Verification:** the brief suite passes and the errand is still one line.

```bash
npx vitest run __tests__/infrastructure/plan-agent-brief.test.js   # exit 0: the release is ordered
test "$(grep -ci 'no ejecutes' src/infrastructure/plan-agent-brief.js)" -eq 0   # 1 before this task
test "$(grep -c -- '--release' src/infrastructure/plan-agent-brief.js)" -eq 1
```

### Task 7 — El montaje en el entrypoint

**Objective:** the entrypoint builds `DiskGoRegistry` and hands the go's two collaborators to
`ImplementPlan`.

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`

Call site (backend/src/infrastructure/ct-api.mjs):

```javascript
const planIssues = new GhPlanIssues({ gh: CtApi.#talkingTo(Gh.BIN, Gh) })
// before: implementPlan: new ImplementPlan({ planAgents })
// after:
implementPlan: new ImplementPlan({
  goRegistry: new DiskGoRegistry({ random: randomBytes, write: Disk.write, root: asked.stateRoot }),
  planIssues,
  planAgents,
}),
```

The root of that registry is **not** resolved here: it arrives already validated on
`Invocation.stateRoot`, so the entrypoint only injects it. That is what lets a test compare it
against the plugin's own `controlTowerDir` instead of trusting a literal nobody measures, and what
turns an unresolvable home into a printed refusal rather than a stack trace before the port line.
The single `planIssues` instance is shared with `StartPlan`: one adapter per port, and the
entrypoint injects its `stderr` explicitly, as it already does for `GitWorkspace`.

The README needs no change: its `backend/` row already names both endpoints, and neither the claim
nor the go adds one.

**TDD:** No TDD — the entrypoint's wiring is covered by the real-process happy path that already
exists, and `backend/conventions/testing.md` forbids measuring anything else about it by spawning a
process.

**Tests:** N/A — no test is added; the whole suite is the verification.

**Verification:** the whole suite passes, including the real-process tests that spawn the
entrypoint, and the yardstick accepts the two new modules.

```bash
npx vitest run   # exit 0: the whole suite, real-process tests included
npx vitest run __tests__/yardstick.test.js   # exit 0: English, no prose, every function on a type
test "$(grep -c 'DiskGoRegistry' src/infrastructure/ct-api.mjs)" -eq 2
```

### Task 8b — El plugin gana la forma de renunciar al vigilante del merge

**Objective:** a release in a flow with no coordinator session waives the merge watcher instead of
delivering its notice to whatever cmux tab happens to sit in the main checkout.

**Files:**
- Modify: `plugin/scripts/dispatch-check.mjs`
- Modify: `plugin/__tests__/dispatch-check-watch-merge.test.js`
- Modify: `plugin/commands/ct-next.md`, `plugin/README.md`
- Modify: `backend/src/infrastructure/plan-agent-brief.js` and its test

Contract (plugin/scripts/dispatch-check.mjs):

```javascript
const noWatchMerge = has('--no-watch-merge')
// usage gains [--no-watch-merge]; the launch site becomes
// if (noWatchMerge) errLine(<why nobody will be told>) else lanzarVigilanteDelMerge(issue)
```

The errand's release command becomes `--release --no-watch-merge`. `dispatch-check.mjs` is the
repository's declared debt under `plugin/conventions/style.md`, and its host style documents every
decision in prose, so the flag arrives with the reasoning beside it. The `dist/` rule does not
apply: no hook references this script.

**TDD:** red first — `it('con --no-watch-merge no lanza nada, y el release sigue siendo un éxito')`,
asserting exit 0, `released #9`, and that the recorder log never appears; then
`it('con --no-watch-merge se dice que la cosecha queda sin avisar, para que el silencio no se lea como entregado')`.
On the backend side,
`it('the_release_it_orders_waives_the_merge_watcher_because_this_flow_has_no_coordinator_to_notify')`.

**Tests:** added: the three above.

**Verification:** the watcher suite and every plugin suite that names a release still pass.

```bash
npx vitest run __tests__/dispatch-check-watch-merge.test.js   # exit 0, run from plugin/
test "$(grep -c -- '--no-watch-merge' scripts/dispatch-check.mjs)" -ge 3
```

### Task 8 — La raíz del estado se valida en la invocación y se mide contra el plugin

**Objective:** the directory the go is written into arrives validated on `Invocation`, so a test can
compare it against the plugin's own resolution and an unresolvable home refuses instead of crashing.

**Files:**
- Modify: `backend/src/infrastructure/invocation.js`
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Modify: `backend/__tests__/infrastructure/invocation.test.js`
- Rename and extend: `backend/__tests__/infrastructure/go-contract.test.js` →
  `backend/__tests__/infrastructure/plugin-contract.test.js`

Contract (backend/src/infrastructure/invocation.js):

```javascript
static CONFIG_VARIABLE = 'CLAUDE_CONFIG_DIR'
static STATE_DIRECTORY = 'control-tower'
static DEFAULT_CONFIG_DIRECTORY = '.claude'
static configuredIn(environment, home)   // the config dir asked for, or <home>/.claude
static stateRootIn(environment, home)    // <configured>/control-tower, or null if not absolute
static from(argv, environment, home)     // gains a third argument and `stateRoot` on the result
// InvocationOutcome gains UNKNOWN_STATE_HOME
```

This exists because the entrypoint composed that path from three private literals nobody measured,
and `plugin/conventions/decisions.md` requires the two halves of a cross-process contract be
**compared by a test**. `backend/conventions/testing.md` names the precedent: logic that can be
observed without a process moves out of the entrypoint until it can, *"which is why
`invocation.js` exists"*.

**TDD:** red first — `it('the_state_root_this_backend_resolves_is_the_one_the_plugin_computes_for_the_same_environment')`
in the contract test, comparing `Invocation.stateRootIn` against the plugin's `controlTowerDir` for
a bare environment and one naming `CLAUDE_CONFIG_DIR`; and
`it('a_home_that_resolves_to_nothing_is_refused_by_name_instead_of_writing_the_go_where_nobody_reads')`
asserting the outcome and the literal reason.

**Tests:** added: the two above, plus the shape of the root with and without the variable, an empty
variable falling back to the home, a non-absolute one refused, and a refused invocation carrying no
root. Also `it('both_ends_of_the_claim_are_labels_the_loop_declares_instead_of_names_invented_here')`,
which measures the other transcribed copy against `LOOP_STATUS_LABELS`.

**Verification:** the two suites pass and an empty home no longer reaches a stack trace.

```bash
npx vitest run __tests__/infrastructure/invocation.test.js   # exit 0: the root and its refusal
npx vitest run __tests__/infrastructure/plugin-contract.test.js   # exit 0: both halves compared
test "$(HOME='' CT_API_PORT=0 node src/infrastructure/ct-api.mjs 2>&1 | grep -c 'could not be resolved')" -eq 1
```

## 8. Global verification

Every task committed, the whole suite green from `backend/`, and the two halves of the go contract
measured against the plugin's own readers. Then the end-to-end run by hand, which no command here
can replace: start the API from a cmux tab in `repo-pulse`, `POST /start-plan` with `XOP-4909`,
check with `gh issue view <n> --json labels` that the issue is in `status:in-progress`, wait for
`ready` on the event stream, `POST /implement-plan`, and check the issue carries an `-OK` comment
before the agent starts working.

```bash
npx vitest run   # exit 0: the whole backend suite
npx vitest run __tests__/infrastructure/go-contract.test.js   # exit 0: the plugin reads what we wrote
test "$(grep -rl 'plugin/scripts/go-' src/ | wc -l | tr -d ' ')" -eq 0
test -z "$(git status --porcelain)"   # exit 0: every task committed, nothing left in the tree
```

## 9. Assumptions

1. **No issue and no `.agent/SLICE.md`.** This is not a CT-dispatched slice: the work happens on a
   development branch of this repository, so `dispatch-check --check-plan` has no issue to validate
   against and the plan is not posted as an issue comment. Provenance: the repository's own plans
   under `docs/superpowers/plans/` follow this shape.
2. **`requeue` warns instead of throwing.** The spec named a `PlanIssueNotRequeued`; it is dropped.
   A typed error that only ever gets swallowed in compensation would still have to be declared in
   `PlanCollapse` to keep the exhaustiveness test green, and that mapping would be dead — a status
   for a failure that cannot reach a client. Provenance: own call, following `GitWorkspace.undo`.
3. **`GoFailure` keeps a single cause.** Writing the registry reads nothing back, so the family has
   one member where the others have two. Provenance: `PlanProgressFailure` already sets that
   precedent in `main`.
4. **The registry's root is injected, not derived.** The adapter does not read `CLAUDE_CONFIG_DIR`;
   the entrypoint does. Provenance: `backend/conventions/architecture.md` — an adapter does not
   decide where state lives.
5. **`status:in-review` is not sown.** In a repository that never ran `/ct-groom`, the agent's
   `--release` would die on the missing label. The fix belongs where the label is written, which is
   the plugin. Both test repositories already have it. Provenance: spec §2.4.
6. **The merge watcher is left to fail.** `--release` launches it and it will find no coordinator
   session, log that and exit 1. Provenance: spec §2.5.
