# El `user_comment` de POST /start-plan — Implementation Plan

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, §2 of this plan and `backend/conventions/` win.

**Spec:** none — there is no separate design document; every decision is closed in §2 of this plan.

**Branch:** `feat/user-comment-en-start-plan`, cut from `main` at 1ad63b9.

**Tech stack:** Node 24 ESM, express 5, vitest 4. No new dependency.

## 1. Context and goal

`POST /start-plan` only knows how to plan a Jira user story: `PlanRequest.from` demands `id`
(`ABC-123`), `StartPlan` reads it with `userStories.detail`, and `PlanIssueBody` builds the whole
GitHub issue out of that story — title `KEY summary`, first line `> Historia de usuario: KEY`,
`## Contexto del epic` from the Jira description. So work that has no ticket cannot be planned at
all, even though the issue is what the agent hydrates from and where it publishes the plan.

This slice adds a second way to say what to plan: a free-text field `user_comment`. With `id` and
`user_comment` the story is still read from Jira and the comment travels beside it into the issue.
With only `user_comment` nothing is asked of Jira: the issue is born from the comment, and it is
still the issue that the agent reads and comments the plan on — which is the tracking Juanjo asked
for, and which already exists in `PlanAgentBrief.errandFor`.

### Desired end state

- `POST /start-plan` accepts `user_comment` (text) and `id` becomes optional.
- Neither of the two: 400 `nothing-to-plan`. A `user_comment` that is not text or is only
  whitespace: 400 `malformed-user-comment`.
- `id` + `user_comment`: Jira is read as today, and the comment reaches the issue body.
- `user_comment` alone: `acli` is never launched, the issue's title and body are derived from the
  comment, and the comment reaches the body silenced by `PlanIssueBody.quieted`.
- The comment always lives in one section of its own, `## Comentario de quien pide el plan`, and
  the plan errand sends the agent there.
- `id` in the 202 and in `GET /active-plans` is `null` when there is no story; the cmux tab is
  named `ct-plan-<repo>-issue-<n>` and a plan named that way is still recovered after a restart.
- No new endpoint, no new dependency, and every body that works today answers exactly as today.

### Out of scope

The frontend (`frontend/src/app/start-plan/StartPlan.types.ts` types `id` as `string`; a comment-only
plan answers `null` and the form still sends `id`, so nothing it does today breaks — teaching it to
send a comment is another branch). Writing the comment back to Jira. Reading the comment from
anywhere but the request body. Editing the issue after it is open. `POST /implement-plan`,
`GET /implement-progress/:issue` and the harvest, none of which know about the story.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Name of the field | `user_comment`, literal, text |
| `id` | optional; when it is present it is validated exactly as today |
| Neither of the two | 400, code `nothing-to-plan`, detail naming both fields |
| `id` + `user_comment` | Jira is read as today; the issue is born from the story **and** carries the comment |
| `user_comment` alone | `acli` is never asked; the issue is born from the comment, silenced with `quieted` |
| Traceability | the comment travels in the issue body, which is where the agent reads and publishes |
| Endpoint | the same `POST /start-plan`; no new one |
| Frontend | out of scope; the backend must not break what it consumes today with `id` |
| New dependency | none |
| The domain type for a comment | a value object `PlanComment` of its own, beside `UserStoryKey`: the boundary builds it, the adapter consumes it, and its guard (text that is not blank) is what makes a blank comment unrepresentable in the issue body |
| "Nothing was asked" | refused at the HTTP door, not by a type wrapping both fields: the door is the only place that can answer it with a `code`, and a wrapper would ride through `PlanBriefing` and `PlanWatch` with no reader |
| Where the comment travels | request → `StartPlanParams.comment` → `planIssues.open` → `PlanIssueBody`, and nowhere else: neither `PlanBriefing` nor `PlanWatch` has a reader for it |
| `story` when there is no Jira story | `null` in `StartPlanParams`, `PlanBriefing` and `PlanWatch`; `UserStory` is never built with a null key, because its name would stop being true |
| The `id` the API answers | `null`, from a single place: `PlanWatch.storyText()`, used by the 202, by `/active-plans` and by the implementation marker, so `matches` keeps comparing like with like |
| Where the comment goes in the body | its own section `## Comentario de quien pide el plan`, in both cases, right after `## Descripción`; emitted only when there is a comment |
| Title with no story | the first non-blank line of the comment, whitespace collapsed, cut at 72 characters |
| First line of a body with no story | `> Plan pedido a mano: no hay historia de usuario en Jira.` |
| Order of validation | unknown fields → `id` if present → `user_comment` if present → neither present → `repo` → `path` |
| A malformed `user_comment` | anything that is not a string, and a string that is blank once trimmed |
| The cmux tab with no story | `ct-plan-<owner>__<name>-issue-<n>`, and `CmuxActivePlan` learns to read it back |
| The errand and the heading | `plan-agent-brief.js` names the section through `PlanIssueBody.COMMENT_SECTION`; a second literal of the same heading is one decision written twice |

## 3. Reference patterns

Files to imitate:
`backend/src/domain/value-objects/user-story-key.js` (value object with `isWellFormed`, a guard that
quotes what it got, and `toString`), `backend/src/infrastructure/start-plan-route.js` (request model,
closed vocabulary of outcomes, refusals as an exhaustive `Projection`),
`backend/src/infrastructure/gh-plan-issues.js` (boundary model composing the issue out of the
plugin's renderers), `backend/src/application/actions/start-plan.js` (use case orchestrating ports),
`backend/__tests__/application/start-plan.test.js` (doubles as mothers with named scenarios),
`backend/__tests__/infrastructure/plan-issue-body.test.js` (the body read back with the plugin's own
readers), `backend/__tests__/infrastructure/plan-request.test.js` (order of refusals, one assertion
per first-thing-wrong).

Rules to obey:
`backend/conventions/README.md`, `backend/conventions/architecture.md`,
`backend/conventions/domain.md`, `backend/conventions/infrastructure.md`,
`backend/conventions/simplicity.md`, `backend/conventions/testing.md`,
`plugin/conventions/style.md`, `plugin/conventions/defects.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/testing.md`.

Nothing "just in case". The guard on what the comment carries happens once, at the HTTP door;
downstream every caller is our own code. Text from outside never reaches an issue body unquieted.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/plan-comment.js` | create | `PlanRequest`, `PlanIssueBody` | Contract (T1) |
| `backend/src/domain/ports/plan-issues.js` | modify | `StartPlan`, `GhPlanIssues` | prose (T1) |
| `backend/src/application/actions/start-plan.js` | modify | `StartPlanRoute` | Current state (T1) |
| `backend/src/infrastructure/gh-plan-issues.js` | modify | `ct-api.mjs`, `StartPlan` | Current state + Contract (T2, T3) |
| `backend/src/domain/value-objects/plan-watch.js` | modify | routes, registries | Contract (T4) |
| `backend/src/infrastructure/active-plans-route.js` | modify | `ApiServer` | Current state (T4) |
| `backend/src/infrastructure/disk-implementation-start-registry.js` | modify | `ct-api.mjs` | prose (T4) |
| `backend/src/infrastructure/cmux-plan-agents.js` | modify | `ct-api.mjs`, `CmuxActivePlan` | Current state + Contract (T5) |
| `backend/src/infrastructure/active-plan-recovery.js` | modify | `ApiServer` | Contract (T5) |
| `backend/src/infrastructure/plan-agent-brief.js` | modify | `CmuxPlanAgents` | Current state + Contract (T6) |
| `backend/src/infrastructure/start-plan-route.js` | modify | `ApiServer` | Current state + Contract (T1, T4, T7) |

## 5. Interfaces

Consumes: the plugin's own renderers and headings, already imported by `gh-plan-issues.js` —
`renderDescripcion`, `renderAcContent`, `renderGatesContent`, `renderProtectedLine`, `gatesOf`,
`EPIC_CONTEXT_HEADING`, `INHERITED_CONTEXT_HEADING`, `INHERITED_CONTEXT_PLACEHOLDER`,
`GATES_HEADING` from `plugin/scripts/groom.js`, and `gateLabels` from `plugin/scripts/gates.js`.
Nothing new is imported from the plugin, and the plugin gains no reader of this field.

Produces:
`PlanComment` — `new PlanComment(text)`, `PlanComment.isWellFormed(text)`, `toString()`.
`PlanWatch.storyText()` — the story's text, or `null` when the plan has no story.
`PlanIssues.open({ story, comment, repository })` — `story` and `comment` are each either their
value object or `null`, never both `null`.
`PlanIssueBody.of({ story, comment })`, `PlanIssueBody.titleFor({ story, comment })`,
`PlanIssueBody.labels({ story, comment })`, `PlanIssueBody.COMMENT_SECTION`.
`CmuxPlanAgents.nameFor({ story, repository, issueNumber })`.
`PlanRequestOutcome.MALFORMED_USER_COMMENT`, `PlanRequestOutcome.NOTHING_TO_PLAN`.

## 6. Test strategy

Outside-in from `backend/`, as `backend/conventions/testing.md` orders. The use case with every port
doubled at the constructor, asserting what each port received and that `userStories` was never asked
when there is no story. The adapters cut right before the tool: the literal argv of `gh issue create`
and the literal text of the issue body, whose sections are read back with the plugin's own
`mapGhIssue`, `extractAc` and `parseScope` in the test file that already does it. The boundary
through a listening server and `fetch`, asserting the literal JSON body of every new refusal.

The domain has no tests of its own: `PlanComment` is reached through `PlanRequest` and through the
issue body. No new real-process test — nothing here can be observed by spawning a process that has
no `acli` and no `gh`.

Fast subset per change, whole suite before handing over:
`npx vitest run --exclude '**/*-real-process.test.js'` — 34 files, 892 tests green today.

## 7. Tasks

### Task 1 — El dominio gana el comentario y el caso de uso planifica sin historia

**Objective:** `StartPlan` plans from a comment without asking Jira anything, and carries the comment
to the issue.

**Files:**
- Create: `backend/src/domain/value-objects/plan-comment.js`
- Modify: `backend/src/domain/ports/plan-issues.js`
- Modify: `backend/src/application/actions/start-plan.js`
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/application/start-plan.test.js`

Current state (backend/src/application/actions/start-plan.js, lines 30-35):

```javascript
  async execute(params) {
    const root = await this.workspace.confirm({ root: params.root, repository: params.repository })
    const story = await this.userStories.detail(params.story)
    const issue = await this.planIssues.open({ story, repository: params.repository })
    await this.planIssues.claim({ issue, repository: params.repository })
    const located = await this.#prepare(params, issue, root)
```

Contract (backend/src/domain/value-objects/plan-comment.js):

```javascript
export class PlanComment {
  static EXAMPLE = 'un texto que diga qué hay que planificar'
  constructor(text)                  // this.text = text.trim(); frozen; throws quoting what it got
  static isWellFormed(text)          // typeof text === 'string' && text.trim().length > 0
  toString()                         // this.text
}
```

`StartPlanParams` takes `{ story, comment, repository, root }`, both `story` and `comment` nullable.
`execute` reads the story only when there is one — `params.story === null ? null : await
this.userStories.detail(params.story)` — and opens with
`{ story, comment: params.comment, repository }`. `PlanBriefing` and `PlanWatch` keep receiving
`params.story`, now possibly `null`; neither gains the comment, because neither has a reader for it.
`PlanIssues.open` becomes `open({ story, comment, repository })` and its unimplemented message keeps
naming `story?.key`. `null` is the one representation of "absent" for both fields. And
`StartPlanRoute.#accept` passes `comment: null` into `StartPlanParams` until Task 7 hands it the
comment the body carried: between the two, a request that works today builds the same params it
builds now, and no `undefined` ever reaches `open` — that is the only line of the route this task
touches.

**TDD:** red first — `it('a_plan_asked_for_with_only_a_comment_never_asks_jira_for_anything')`,
asserting `userStories.asked` is empty **and** that `planIssues.asked[0]` carries
`{ story: null, comment: <the comment> }`. Then
`it('the_comment_reaches_the_issue_beside_the_story_when_both_were_asked_for')` and, on the other
side of the limit, `it('a_plan_asked_for_with_only_a_story_opens_its_issue_with_no_comment_at_all')`
asserting `comment` is `null`.

**Tests:** added: the three above in `start-plan.test.js`, plus `Flow.COMMENT` and the named
scenarios `flow.runWithComment()` and `flow.runWithOnlyAComment()` on the existing `Flow` mother.
Modified: `PlanIssuesDouble.open` records `comment`. Removed on purpose: none.

**Verification:** the use case suite passes and Jira is provably not asked.

```bash
npx vitest run __tests__/application/start-plan.test.js   # exit 0: the flow with and without a story
test "$(grep -c 'only_a_comment_never_asks_jira' __tests__/application/start-plan.test.js)" -eq 1
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else regressed
```

### Task 2 — El comentario llega al issue en una sección propia

**Objective:** the issue body carries the comment in a section of its own, between the description
and the epic context.

**Files:**
- Modify: `backend/src/infrastructure/gh-plan-issues.js`
- Modify: `backend/__tests__/infrastructure/plan-issue-body.test.js`
- Modify: `backend/__tests__/infrastructure/gh-plan-issues.test.js`
- Modify: `backend/__tests__/infrastructure/plugin-contract.test.js`

Current state (backend/src/infrastructure/gh-plan-issues.js, lines 275-284):

```javascript
  static of(story) {
    const row = PlanIssueBody.rowFor(story)

    return [
      `> Historia de usuario: ${story.key}`,
      PlanIssueBody.CHANGES_LINE,
      '',
      PlanIssueBody.DESCRIPTION_HEADING,
      renderDescripcion(row) ?? `_${story.key} no trae resumen en Jira._`,
      '',
```

Contract (backend/src/infrastructure/gh-plan-issues.js):

```javascript
static COMMENT_SECTION = 'Comentario de quien pide el plan'
static COMMENT_HEADING = `## ${PlanIssueBody.COMMENT_SECTION}`
static of({ story, comment })
static titleFor({ story, comment })
static labels({ story, comment })
static rowFor({ story, comment })
// GhPlanIssues.argvFor({ story, comment, repository }); open({ story, comment, repository })
```

The four statics take the pair from now on; only `of` reads the comment, and `story` is still always
a `UserStory` in this task. `of` emits `COMMENT_HEADING`, then
`PlanIssueBody.quieted(comment.text)`, then a blank line, between `## Descripción` and
`EPIC_CONTEXT_HEADING` — and **only when `comment !== null`**, so a body asked for with a story
alone comes out byte for byte as it does today. Every other section, the label list and the sowing
loop are untouched.

**TDD:** red first — `it('the_comment_reaches_the_issue_in_a_section_of_its_own_so_the_agent_knows_who_asked')`
asserting the body contains `'## Comentario de quien pide el plan\nlo que pide el humano'`. Then
`it('an_issue_number_written_in_the_comment_does_not_reach_out_and_touch_that_issue')`, and — the
other side of the limit — `it('a_story_asked_for_without_a_comment_writes_the_body_it_wrote_before')`
asserting the section is absent.

**Tests:** added: the three above. Modified: `Opened.asGithubSees` and every call of
`PlanIssueBody.of`/`titleFor`/`labels` in both files take `{ story, comment }`; `GhDouble.openFor`
passes a comment; `every_section_the_plugin_writes_and_we_can_fill_is_there_in_the_order_it_writes_them`
keeps its six headings for a story with no comment, and a new
`it('the_section_of_the_comment_sits_between_the_description_and_the_epic_context')` pins the seven.
The one call of `PlanIssueBody.of` in `plugin-contract.test.js` (the errand's headings measured
against the body) takes `{ story, comment: null }` too — the third caller of the old signature,
found by the fast subset going red.

**Verification:** the body suite and the adapter suite pass, and the heading is declared once.

```bash
npx vitest run __tests__/infrastructure/plan-issue-body.test.js   # exit 0: the section and the quieting
npx vitest run __tests__/infrastructure/gh-plan-issues.test.js   # exit 0: the create argv still literal
test "$(grep -c 'Comentario de quien pide el plan' src/infrastructure/gh-plan-issues.js)" -eq 1
```

### Task 3 — Un issue sin historia de usuario: título, primera línea y contexto

**Objective:** when there is no user story, the issue is titled and opened from the comment instead
of reading `null` where a Jira key used to be.

**Files:**
- Modify: `backend/src/infrastructure/gh-plan-issues.js`
- Modify: `backend/__tests__/infrastructure/plan-issue-body.test.js`

Current state (backend/src/infrastructure/gh-plan-issues.js, lines 247-251):

```javascript
  static rowFor(story) {
    return {
      n: null,
      name: story.summary,
      entrega: PlanIssueBody.quieted(story.summary),
```

Current state (backend/src/infrastructure/gh-plan-issues.js, lines 260-264):

```javascript
  static #epicContextOf(story) {
    return story.hasDescription()
      ? PlanIssueBody.quieted(story.description)
      : `_${story.key} no trae descripción en Jira: la historia de usuario está sin escribir._`
  }
```

Contract (backend/src/infrastructure/gh-plan-issues.js):

```javascript
static NO_STORY_LINE = '> Plan pedido a mano: no hay historia de usuario en Jira.'
static NO_STORY_EPIC_CONTEXT = '_El plan no viene de una historia de usuario de Jira._'
static NO_HEADLINE = '_El comentario no trae una primera línea que resuma lo que se pide._'
static HEADLINE_LIMIT = 72
static HEADLINE_CUT = '…'
static headlineOf(comment)   // first non-blank line, /\s+/g -> ' ', trimmed; longer than
                             // HEADLINE_LIMIT -> sliced to LIMIT - 1 plus HEADLINE_CUT
```

With `story === null`: `titleFor` answers `headlineOf(comment)`; the first line of `of` is
`NO_STORY_LINE`; `rowFor` takes `name` from `headlineOf(comment)` and `entrega` from
`quieted(name)`; `#epicContextOf` answers `NO_STORY_EPIC_CONTEXT`; and the `renderDescripcion`
fallback is `NO_HEADLINE` instead of the sentence that names a key. With a story, all five behave
exactly as before. `labels` needs no branch of its own: the gates come from the row's other columns.

**TDD:** red first — `it('an_issue_with_no_user_story_is_titled_by_the_first_line_of_the_comment')`.
Then `it('a_first_line_longer_than_a_github_title_is_cut_and_says_it_was_cut')` — one comment whose
first line is exactly 72 characters, kept whole, and one of 73, cut to 72 ending in `…`;
`it('the_first_line_of_a_body_with_no_story_says_the_plan_was_asked_by_hand_instead_of_naming_a_key')`;
`it('a_body_with_no_story_says_there_is_no_jira_story_where_the_epic_context_goes')`;
`it('a_comment_whose_first_line_carries_no_words_says_so_instead_of_leaving_the_description_blank')`
over the comment `'—'`.

**Tests:** added: the five above, plus `Opened.commentOnly()` on the existing mother. Removed on
purpose: none — `a_story_with_no_summary_worth_the_name_says_so_instead_of_leaving_the_section_blank`
and `a_story_with_no_description_says_the_user_story_is_unwritten_instead_of_leaving_a_blank` stay
untouched, which is what proves the story path did not move.

**Verification:** the body suite passes and the plugin still reads the sections of a body with no
story.

```bash
npx vitest run __tests__/infrastructure/plan-issue-body.test.js   # exit 0: title, first line, context
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else regressed
test "$(grep -c 'HEADLINE_LIMIT = 72' src/infrastructure/gh-plan-issues.js)" -eq 1
```

### Task 4 — El `id` que responde la API cuando no hay historia

**Objective:** the `id` of a plan with no user story is `null` everywhere the API says it, decided in
one place.

**Files:**
- Modify: `backend/src/domain/value-objects/plan-watch.js`
- Modify: `backend/src/infrastructure/active-plans-route.js`
- Modify: `backend/src/infrastructure/disk-implementation-start-registry.js`
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/infrastructure/disk-implementation-start-registry.test.js`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

Current state (backend/src/infrastructure/active-plans-route.js, lines 59-63):

```javascript
  static #project(phase, watch) {
    return {
      phase,
      request: {
        id: watch.story.text,
```

Contract (backend/src/domain/value-objects/plan-watch.js):

```javascript
storyText()   // this.story === null ? null : this.story.text
```

The four places that read `watch.story.text` — `ActivePlans.#project` twice,
`DiskImplementationStartRegistry.recordFor` and the 202 of `StartPlanRoute.#accept` — call
`watch.storyText()` instead. The 202 stops reading `asked.story.text` and reads
`started.watch.storyText()`: the same value for every body that works today, and one decision
instead of four. `matches` needs no change — it compares `recordFor` against `recordFor`, so a
`null` story on both sides still agrees, and `null` survives the round trip through JSON.

**TDD:** red first — `it('the_id_of_a_plan_with_no_user_story_is_null_instead_of_the_word_undefined')`
in `disk-implementation-start-registry.test.js`, asserting the written JSON contains `"story": null`.
Then `it('the_marker_of_a_plan_with_no_user_story_still_matches_itself_after_a_restart')`, asserting
`matches` is true for a watch built with `story: null`.

**Tests:** added: the two above, plus `WATCH_WITHOUT_A_STORY` beside the existing `WATCH`. Modified:
`StartPlanSpy.execute` in `api-server.test.js` records `params.story === null ? null :
params.story.text`, so a comment-only request can reach it in Task 7. Removed on purpose: none — the
202 and `/active-plans` assertions keep their literal `"id":"ABC-123"`, which is what proves this
task changed nothing for a plan that has a story.

**Verification:** the registry suite and the whole HTTP surface pass unchanged, and the projection
lives in one place.

```bash
npx vitest run __tests__/infrastructure/disk-implementation-start-registry.test.js   # exit 0
npx vitest run __tests__/infrastructure/api-server.test.js   # exit 0: the 202 body byte for byte
test "$(grep -cF 'watch.story.text' src/infrastructure/active-plans-route.js)" -eq 0
```

### Task 5 — La pestaña de cmux y la recuperación de un plan sin historia

**Objective:** the cmux tab of a plan with no story is named after its issue, and a tab named that
way comes back as a plan with no story after the API restarts.

**Files:**
- Modify: `backend/src/infrastructure/cmux-plan-agents.js`
- Modify: `backend/src/infrastructure/active-plan-recovery.js`
- Modify: `backend/__tests__/infrastructure/cmux-plan-agents.test.js`
- Modify: `backend/__tests__/infrastructure/active-plan-recovery.test.js`

Current state (backend/src/infrastructure/cmux-plan-agents.js, lines 33-35):

```javascript
  static nameFor(story, repository) {
    return `ct-plan-${repository.text.replace(/\//g, '__')}-${story}`
  }
```

Contract (backend/src/infrastructure/cmux-plan-agents.js):

```javascript
static NO_STORY_PREFIX = 'issue-'
static nameFor({ story, repository, issueNumber })
  // `ct-plan-${repository.text.replace(/\//g, '__')}-` then, when story === null,
  // `${CmuxPlanAgents.NO_STORY_PREFIX}${issueNumber}`, else `${story}`
```

Contract (backend/src/infrastructure/active-plan-recovery.js):

```javascript
static #TITLE = /^ct-plan-(.+)-(issue-[1-9]\d*|[A-Z][A-Z0-9_]*-\d+)$/
static #NO_STORY = new RegExp(`^${CmuxPlanAgents.NO_STORY_PREFIX}[1-9]\\d*$`)
```

`argvFor(briefing, typed)` passes `{ story: briefing.story, repository: briefing.repository,
issueNumber: briefing.issue.number }`. In `CmuxActivePlan.parse` the tail is read once: when
`#NO_STORY` matches it, `story` is `null` and the `UserStoryKey.isWellFormed` check is skipped;
otherwise it stays exactly as today. The round-trip guard `nameFor(...) !== entry.title` keeps
running with the new signature, so a title this backend could not have written is still refused.
The issue number keeps coming from the worktree path, never from the title.

**TDD:** red first —
`it('the_tab_of_a_plan_with_no_user_story_is_named_after_its_issue_instead_of_the_word_null')`,
asserting the literal `--name ct-plan-josemerca__ct-loop-sandbox-issue-7` in the argv. Then
`it('a_tab_named_after_its_issue_comes_back_as_a_plan_with_no_user_story')`, asserting
`CmuxActivePlan.parse` answers a watch whose `storyText()` is `null` and whose issue is the one in
the worktree path; and `it('a_tab_whose_tail_is_neither_a_story_key_nor_an_issue_number_is_still_ignored')`.

**Tests:** added: the three above. Modified: the existing `ignores_a_malformed_or_unknown_entry`
table keeps `ct-plan-jjponz__repo-pulse-not-a-story`, which must still be ignored, and gains
`ct-plan-jjponz__repo-pulse-issue-0` — a number the tab name can never carry.

**Verification:** both suites pass and the prefix is declared once.

```bash
npx vitest run __tests__/infrastructure/cmux-plan-agents.test.js   # exit 0: the literal tab name
npx vitest run __tests__/infrastructure/active-plan-recovery.test.js   # exit 0: both tails read back
test "$(grep -c "NO_STORY_PREFIX = 'issue-'" src/infrastructure/cmux-plan-agents.js)" -eq 1
```

### Task 6 — El encargo manda al agente leer lo que pidió quien arrancó el plan

**Objective:** the plan errand sends the agent to the comment's section and says what to plan from
when the issue declares no acceptance criteria.

**Files:**
- Modify: `backend/src/infrastructure/plan-agent-brief.js`
- Modify: `backend/__tests__/infrastructure/plan-agent-brief.test.js`

Current state (backend/src/infrastructure/plan-agent-brief.js, lines 25-26):

```javascript
      `Hidrátate del issue: \`gh issue view ${issue.number} --repo ${named}\`. Sus criterios de aceptación y su sección "## Out of scope / Protected" son la entrada del plan.`,
      `Lee también sus secciones "${PlanAgentBrief.EPIC_CONTEXT}" y "${PlanAgentBrief.INHERITED_CONTEXT}": traen lo que condiciona este trabajo y no cabe en los criterios de aceptación. Si están vacías o no aparecen, no hay nada que heredar y no lo busques fuera del issue.`,
```

Contract (backend/src/infrastructure/plan-agent-brief.js):

```javascript
import { PlanIssueBody } from './gh-plan-issues.js'
// one new line right after the two above, using PlanIssueBody.COMMENT_SECTION:
`Si el issue trae la sección "${PlanIssueBody.COMMENT_SECTION}", eso es lo que una persona pidió a
mano y es entrada del plan igual que los criterios de aceptación. Y si el issue no declara ningún
criterio de aceptación, esa sección es TODA la entrada: no hay spec de donde rellenarlos, así que
los criterios los propones tú en el plan y no te pares a buscarlos fuera del issue.`
```

That line is one single line in the errand, joined with `'\n'` like its neighbours. The section name
comes from `PlanIssueBody.COMMENT_SECTION` and is never retyped here: the heading is one decision,
and the issue body is the only place that owns it. `errandFor` gains no parameter — the line is
unconditional, because the agent reads the issue and the issue is what says whether the section is
there.

**TDD:** red first —
`it('it_sends_the_agent_to_the_section_where_a_person_wrote_by_hand_what_they_want_planned')`,
asserting the errand contains `'Comentario de quien pide el plan'` and that it names it as
`entrada del plan`. Then
`it('it_says_the_criteria_are_the_agents_to_propose_when_the_issue_declares_none_instead_of_leaving_it_stuck')`,
asserting the errand contains `'no hay spec de donde rellenarlos'`.

**Tests:** added: the two above. Removed on purpose: none — every existing assertion about the
errand still holds, which is what proves the new line displaced nothing.

**Verification:** the errand suite passes and the heading is not retyped in the brief.

```bash
npx vitest run __tests__/infrastructure/plan-agent-brief.test.js   # exit 0: the new line and the old
test "$(grep -c 'COMMENT_SECTION' src/infrastructure/plan-agent-brief.js)" -eq 1
npx vitest run --exclude '**/*-real-process.test.js'   # exit 0: nothing else regressed
```

### Task 7 — La frontera HTTP acepta `user_comment`

**Objective:** `POST /start-plan` accepts `user_comment`, makes `id` optional, and refuses by name a
body that says nothing to plan.

**Files:**
- Modify: `backend/src/infrastructure/start-plan-route.js`
- Modify: `backend/__tests__/infrastructure/plan-request.test.js`
- Modify: `backend/__tests__/infrastructure/api-server.test.js`

Current state (backend/src/infrastructure/start-plan-route.js, lines 67-70):

```javascript
    const given = parsed[PlanRequest.ID_FIELD]
    if (!UserStoryKey.isWellFormed(given)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_ID)
    }
```

Contract (backend/src/infrastructure/start-plan-route.js):

```javascript
MALFORMED_USER_COMMENT: 'malformed-user-comment'   // in PlanRequestOutcome
NOTHING_TO_PLAN: 'nothing-to-plan'                 // in PlanRequestOutcome
static COMMENT_FIELD = 'user_comment'              // added to PlanRequest.KNOWN_FIELDS
static accepted(story, comment, repository, root)  // `comment` on the frozen PlanRequest, null when absent
// PlanRefusal.#BY_OUTCOME gains, with status 400:
//   MALFORMED_USER_COMMENT -> `${PlanRequest.COMMENT_FIELD} must be text saying what to plan`
//   NOTHING_TO_PLAN -> `either ${PlanRequest.ID_FIELD} or ${PlanRequest.COMMENT_FIELD} must say what to plan`
```

`from` asks `Object.hasOwn(parsed, field)` to tell absent from present: a present `id` is validated
exactly as today, an absent one is skipped, and an explicit `null` counts as present and malformed.
Order: unknown fields → `id` if present → `user_comment` if present → neither present
(`NOTHING_TO_PLAN`) → `repo` → `path`. `refused` and `withUnknownFields` carry `comment: null`.
`#accept` passes `comment: asked.comment` into `StartPlanParams`.

**TDD:** red first — `it('a_body_with_neither_an_id_nor_a_comment_is_refused_by_naming_both_fields')`
in `plan-request.test.js`. Then
`it('a_body_with_a_comment_and_no_id_is_accepted_because_the_comment_says_what_to_plan')`;
`it('a_comment_that_is_not_text_or_is_only_whitespace_is_refused_before_it_becomes_an_issue_body')`
over `123`, `null`, `''` and `'   '`;
`it('a_malformed_id_is_reported_before_the_comment_so_the_first_thing_wrong_is_what_gets_named')`;
`it('an_accepted_body_hands_back_the_comment_as_a_domain_value_and_not_as_the_raw_string')`.

**Tests:** added: the five above. Modified: in `api-server.test.js`,
`a_body_with_no_id_is_refused_because_there_is_nothing_to_plan_without_one` is renamed
`a_body_with_neither_an_id_nor_a_comment_is_refused_because_nothing_says_what_to_plan` and asserts
the literal `{"code":"nothing-to-plan","detail":"either id or user_comment must say what to plan"}`,
plus one new test on the literal 202 of a comment-only body, whose `id` is `null`. Not modified:
`every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash` in
`plan-refusal.test.js`, which goes red until both outcomes are declared.

**Verification:** the request suite, the exhaustiveness suite and the whole HTTP surface pass.

```bash
npx vitest run __tests__/infrastructure/plan-request.test.js   # exit 0: order and acceptance
npx vitest run __tests__/infrastructure/plan-refusal.test.js   # exit 0: both outcomes declared
npx vitest run __tests__/infrastructure/api-server.test.js   # exit 0: the literal bodies
test "$(grep -c "COMMENT_FIELD = 'user_comment'" src/infrastructure/start-plan-route.js)" -eq 1
```

## 8. Global verification

Every task committed, the whole suite green from `backend/`, the yardstick accepting the new module,
and nothing left in the working tree. Then the end-to-end run by hand, which no command here
replaces and which Juanjo runs himself: start the API, and `POST /start-plan` three times against a
real clone — once with `id` and `repo` and `path` only (the issue must look exactly as it does
today), once with `id` plus `user_comment` (the issue gains `## Comentario de quien pide el plan`),
and once with `user_comment` alone (no `acli` call, the title is the comment's first line, the 202
answers `"id":null`, and the cmux tab reads `ct-plan-<owner>__<name>-issue-<n>`). In the third case,
check on the issue that the agent hydrates from it and publishes its plan as a comment.

```bash
npx vitest run   # exit 0: the whole backend suite, real-process tests included
npx vitest run __tests__/yardstick.test.js   # exit 0: english, no prose, every function on a type
test "$(grep -rlF 'watch.story.text' src/ | wc -l | tr -d ' ')" -eq 0
test -z "$(git status --porcelain)"   # exit 0: every task committed, nothing left in the tree
```

## 9. Assumptions

1. **No issue and no `.agent/SLICE.md`.** This is not a CT-dispatched slice: the work happens on a
   development branch of this repository, so the plan file carries no `issue-<n>-` segment and is
   not posted as an issue comment. Provenance: the repository's own plans under
   `docs/superpowers/plans/`, which follow this shape.
2. **`--check-plan` does not read the issue.** `validatePlan` in `plugin/scripts/plan-contract.js`
   validates the markdown alone, so an issue born from a comment with no acceptance criteria cannot
   make the agent's own `--check-plan` fail. What would leave the agent stuck is the errand telling
   it the criteria are the input of the plan; that is what Task 6 fixes. Provenance: read in
   `plan-contract.js`.
3. **The recovery is in scope even though nothing crashes without it.** A tab named
   `ct-plan-<repo>-null` would simply not parse, so a comment-only plan would silently vanish from
   `/active-plans` after a restart. `nameFor` has to change anyway and `active-plan-recovery.js`
   calls it, so the same commit teaches it to read the new tail. Provenance: own call, from reading
   `CmuxActivePlan.parse`.
4. **`null`, not an absent key, is how the API says "no user story".** The frontend types `id` as
   `string`; both `null` and an absent key are a lie to that type, and `null` is the one that
   survives JSON both ways, which is what keeps `DiskImplementationStartRegistry.matches` comparing
   like with like. Provenance: own call, following the repository's NULL-as-declared-absence rule
   from the harvest.
5. **`UserStory` is never built without a key.** Its name would stop being true, and
   `PlanIssueBody.titleFor` and the epic-context line would both read `null`. Provenance:
   `backend/conventions/domain.md`, and the two renames it records.
6. **The comment does not travel in `PlanBriefing` or `PlanWatch`.** The agent reads it from the
   issue, so no reader exists at the other end. Provenance: `backend/conventions/simplicity.md`.
7. **The heading is not a plugin heading.** `## Comentario de quien pide el plan` is ours, so it
   needs no declared-copy contract test; the six sections the plugin does write keep theirs.
   Provenance: `backend/conventions/architecture.md`.
8. **A comment whose first line is only a no-value marker is reachable.** `user_comment: "—"` passes
   the boundary and would leave `renderDescripcion` with nothing, which is why `NO_HEADLINE` exists
   rather than being a guard against the impossible. Provenance: read in `plugin/scripts/groom.js`.
