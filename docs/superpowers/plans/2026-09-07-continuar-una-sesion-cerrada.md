# Continuar una sesión cerrada — Implementation Plan

**Backlog:** Notion, «Control tower backlog» → «Continuar una sesión que hayamos cerrado
previamente» (`Estado: En progreso`). La ficha está vacía: todo lo que sigue se decidió en la
sesión de planificación del 2026-09-07.

**Tech stack:** Node 24 ESM, express 5, vitest 4, React 19 + vite. No new dependency.

## 1. Context and goal

`ActivePlanRecovery` (#101) recovers a plan only while its cmux workspace is alive: it reads the
window list and matches the title `ct-plan-<owner>__<repo>-<TICKET>` against a cwd of the shape
`<root>/.worktrees/<n>` (`backend/src/infrastructure/active-plan-recovery.js:11`). A session that
was **closed** has no cmux entry, so today nothing can see it and the work in its worktree is
unreachable from the app.

What survives the close, and is therefore the material this feature reads:

| Artefact | Where | What it says |
|---|---|---|
| Worktree and branch | `<root>/.worktrees/<n>`, `feat/<n>` | the slice existed, and its issue number |
| Slice seed | `<worktree>/.agent/SLICE.md` | `github_issue`, `branch`, `base_sha`, gates, status, baseline |
| Run file | `<worktree>/.agent/run-<n>` | step, task, total, attempt, discards of the implementation |
| Plan issue | GitHub | the plan itself, its claim, and the title `<TICKET> <summary>` |
| Go commitment | `<state>/go/<owner>__<repo>-<n>.json` | a person had already pressed «implementar» |
| Implementation start | `<state>/implementation-starts/<owner>__<repo>-<n>.json` | repo, issue, agent, story, root, branch, worktree |

### Desired end state

- The person names a local checkout in the UI and sees the **incomplete sessions** found there.
- Each row says which phase the session is in, derived by the program from the artefacts above.
- The person continues one, and the app reattaches an agent to the **existing** worktree.
- From that moment the session behaves like one started in this same app: plan events, the human
  gate and the implementation action all work on it.

### Out of scope

Harvesting or closing a session; deleting an abandoned worktree; resuming a session whose worktree
is gone but whose issue is open; listing sessions across every checkout at once (the person names
one checkout per query); and any change to how a *fresh* plan starts.

## 2. Decisions

- **D1 — The checkout travels in the request.** `root` is a query parameter, as in
  `/implement-progress`. `MemoryCheckoutRegistry` is in memory and #101 repopulates it only from
  cmux entries, which by definition do not exist here, so the backend cannot be the source of the
  list. This also removes the need to persist a registry.
- **D2 — The program decides the phase, the person confirms.** Same doctrine as #100 and #101: the
  phase is read from the seed, the run file, the go marker and the implementation-start record. The
  UI never asks the person which phase to resume from.
- **D3 — The UI drives it.** New entry point next to «Arrancar plan», not a plugin command.
- **D4 — Reattaching is a `launch`, never a `resume`.** `CmuxPlanAgents.resume()` types a line into
  an existing workspace addressed by its handle, and a closed session left no handle behind. So
  reattaching opens a new cmux workspace with `--cwd` on the existing worktree, with an errand that
  says *continue*, and the errand is new material: none of the three existing ones (plan,
  implementation, review) describes arriving at work already in progress.
- **D5 — The user-story key comes from the issue title.** The seed does not carry it
  (`SliceSeed.textFor` has `github_issue` and no story), and the cmux title that did carry it is
  gone. The issue title is `<KEY> <summary>` (`PlanIssueBody.titleFor`), so `gh` is the
  authoritative source; the implementation-start record is a second one when it exists. The key is
  needed because the cmux window name is derived from it.
- **D6 — No feature flag.** The repo has no flag machinery — the only env-gated values are the port
  and the harvest table — and building one would be a larger change than this feature. Safety comes
  from the order instead: every slice ships a UI that shows only what the backend can answer
  truthfully at that point.
- **D7 — Resuming never cuts a worktree.** It therefore never pays the baseline that
  `GitWorkspace.prepare` measures, and it must not sow a seed over the one already there.

## 3. Slices

Each slice is deployable on its own. Reads come before writes, and no slice mixes them.

### Slice 0 — The front keeps the root it is given (prerequisite)

`GET`/read side only. The 202 of `/start-plan` has answered `root` since #84 and the front discards
it; the snapshot validation instead checks that the worktree lives under the path the **person
typed** (`frontend/src/app/workflow-snapshot/validation.ts:46`). Since git canonicalises the root,
a symlinked or non-canonical path makes that check fail and the workflow is dropped in silence.
Slice 5 adopts a resumed session through that same validation, so this is fixed first: the front
stores `root` and validates containment against it.

Value on its own: reloading the page stops losing a workflow started from a non-canonical path.

### Slice 1 — The route exists and the UI can ask (wiring, GET)

`GET /incomplete-sessions?root=<path>` mounted with the origin guard, its 405, and its
`malformed-root` refusal; the answer is a fixed empty list. The path joins `API_PATHS` in the vite
config. In the UI, a «Continuar una sesión» panel with the local-path field, which renders the empty
answer as «no incomplete sessions here».

Proves end to end: mount, guard, refusal vocabulary, dev proxy, and the new UI surface.

### Slice 2 — The list is real (GET)

The query confirms the checkout the way `/start-plan` does (the repo is read from the checkout, not
from the person), enumerates `<root>/.worktrees/*`, and answers one entry per worktree with issue
number, branch, worktree and root. Still no phase and no writes.

### Slice 3 — Each session says where it stopped (GET)

The phase is derived: whether the plan is written and committed (the same reading `/plan-events`
already performs), the implementation progress from the run file (the reader #100 introduced), the
go commitment, and the implementation-start record. The story key is read from the issue title.
The UI shows phase and progress per row.

After this slice the feature already answers the question that motivated it — *what did I leave
half done here* — without anything being resumable yet.

### Slice 4 — Continuing reattaches an agent (write)

`POST /resume-session` with the checkout, the issue and the story: it opens a cmux workspace on the
existing worktree with the *continue* errand, registers the session so `/plan-events` and
`/active-plans` see it, and answers what it reattached. It does not touch the seed, the branch or
the issue.

### Slice 5 — The resumed session lands in the normal flow (write side, UI)

The UI adopts the answer of slice 4 into the workflow it already has, through the same path #101
uses for a recovered plan, so the plan step, the human gate and the implementation action work on a
resumed session exactly as on a fresh one.

### Slice 6 — The guards, and the end-to-end test

On the write path: a session already alive in cmux is not duplicated but adopted; a worktree whose
issue does not exist, or whose issue belongs to another repo, is reported and not resumed; a second
`POST` for the same session is idempotent. With every infrastructure detail in place, the happy
integration test of resuming runs without mocking the action.

## 4. Risks

- **The cmux dependency is accepted for now.** Reattaching means opening a workspace, so the
  feature is as available as cmux is. `listCmuxWorkspaces` already distinguishes «I could not ask»
  from «there is nothing», and slice 6 must keep that distinction rather than reporting an
  unreachable cmux as «no session is alive».
- **An abandoned worktree may be stale.** Its base may be far behind the branch it was cut from.
  This plan reports the state and resumes; deciding what to do about a stale base stays with the
  person, and reconciling it is not in scope.
- **The continue errand is new material.** It is the only part of this feature with no precedent to
  copy, and the one most likely to need a second pass after the first real run.
