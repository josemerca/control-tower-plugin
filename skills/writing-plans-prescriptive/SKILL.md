---
name: writing-plans-prescriptive
description: Use when dispatched for a Control Tower slice, before touching production code — turns the issue into a prescriptive plan with verbatim current-state diffs that passes plan-contract validation
---

# Writing Plans (Prescriptive)

## Overview

Write the slice plan assuming the implementer is a task-scoped subagent with **zero context
and no authority to decide**: it can only open the file the plan names and paste the code the
plan shows. If a step requires the implementer to deduce, search, choose, or adapt, the plan
is incomplete — resolve it yourself and write it down literally.

**Announce at start:** "I'm using the writing-plans-prescriptive skill to write the slice plan."

This skill is the Control Tower port of a personal skill (crear-plan-detallado). Two things
are non-negotiable and machine-checked by `plan-contract.js`: the fixed structure, and the
**literality rule** (every quoted current state must exist verbatim in the repo).

## Input: the issue is the frozen spec

You were dispatched for exactly one issue. Its body carries everything you are allowed to
plan from: the acceptance criteria (EARS), the "Out of scope / Protected" section, the
"Contexto del epic" and "Contexto heredado" sections, and the "Dependencias" section with the
interface this slice consumes. The execution spec itself is out of reach on purpose — do not
go looking for it.

**Zero questions.** There is no human in this session. Every ambiguity you resolve goes to
`## 9. Assumptions` with its provenance (issue / epic context / repo convention / your call).
If something genuinely prevents planning, set the `blocked` field in `.agent/SLICE.md` and
stop — never guess through a blocker.

## Ground every diff in the real repo

Before writing any task, read the actual files this slice will touch and at least one
analogous file as a reference pattern. Then quote the current state with this exact
convention, which the validator enforces:

- A line `Current state (path/to/file.ext):` (optionally `Current state (path, lines 10-20):`)
  followed by a code block whose content is copied **verbatim** from that file.
- For files the plan creates: the exact line `Current state: does not exist.` followed by the
  complete final content in a code block.

Never quote from memory — the validator greps the repo and refuses citations that do not
match.

## Structure

Copy `plan-template.md` (in this skill's directory) and fill every hole. The 9 sections are
fixed; never delete or rename one — a section that does not apply gets `N/A — <reason>`.

Tasks live under `## 7. Tasks` as `### Task N — <name>`, numbered from 1 with no gaps.
**One task = one commit.** Each task carries: `**Objective:**` (one sentence),
`**Files:**` (exact paths), the diffs (current state → final state, complete code — no
placeholders, no "add error handling", no references to symbols no task defines),
`**TDD:**` (the failing test first, with its literal name and assertion, or
`No TDD — <reason>`), `**Tests:**` (added / deliberately removed, named one by one), and
`**Verification:**` (exact commands and expected output).

`## 5. Interfaces` is not optional prose: `Consumes` must quote the interface the issue's
"Dependencias" section declares (copy it exactly), and `Produces` names what later slices
will rely on — exact signatures, parameter and return types.

## Save, validate, commit

1. Save to `docs/superpowers/plans/YYYY-MM-DD-issue-<n>-<slug>.md`, where `<n>` is the GitHub
   issue number from `.agent/SLICE.md` (`github_issue`). The `issue-<n>-` segment is how the
   release gate finds the plan — do not rename it.
2. Validate with the command the kickoff gave you (`dispatch-check <n> --repo <o/r>
   --check-plan`). Fix and re-run until exit 0. `--release` runs the same check and refuses
   without a valid committed plan.
3. Commit the plan as the branch's first commit: it travels in the PR and gets reviewed with
   the code.
4. Every slice carries the `plan` gate by default (check `.agent/SLICE.md` `gates` field —
   it is absent only when the spec waived it with `!plan` for this row): post the plan as an
   issue comment and STOP until a human replies OK. You do not close that gate.

## Execution handoff

With the plan committed (and the `plan` gate closed, if present), continue with
control-tower-loop:subagent-driven-development: its "Have implementation plan?" diamond finds
the plan and dispatches a fresh subagent per task. The subagents never inherit your context —
that is why the plan had to be prescriptive.
