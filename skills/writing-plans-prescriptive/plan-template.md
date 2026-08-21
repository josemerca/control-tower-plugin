# {{#<issue> — what this slice delivers}}

> **This plan is written to be executed by task-scoped subagents with zero context and no
> authority to decide.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it must honour and the exact commands that verify it — not the
> bodies: those you write test-first. Do not improvise on names, signatures, constants or test
> names: they are decided here. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

{{Current state of the code this slice touches, with real paths and symbols. What the issue
asks for, in one paragraph.}}

### Desired end state

{{Concrete list of what exists when every task is done — mirror the issue's acceptance
criteria.}}

### Out of scope

{{What this slice deliberately does not do — start from the issue's "Out of scope /
Protected" section. If nothing: N/A — <reason>.}}

## 2. Closed decisions (do NOT reopen)

| Decision | Value |
|---|---|
| {{decision}} | {{an order, not an option}} |

## 3. Reference patterns

{{The yardstick of this repo for this slice, in two lists. It is the only part of the plan that
tells the implementer how code is written here and the judge what to block on, so every path you
name is grepped by `--check-plan`: a path that does not exist fails the plan.}}

Files to imitate: {{real files whose shape the implementer copies — same role, same layer. Or
N/A — <reason>.}}

Rules to obey: {{this repo's own convention documents, by path — `AGENTS.md`, `CLAUDE.md`, a file
under `docs/conventions/`, `CONTRIBUTING` — plus any skill the issue's "Contexto del epic" names
(a skill is not a path and is not checked on disk). Or N/A — this repo declares none.}}

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| {{path}} | create / modify | {{who}} | Contract / Call site / Current state / Final text / prose (config) / none (body by TDD) |

## 5. Interfaces

Consumes: {{the interface the issue declares for its dependency — names and signatures inline,
no code block; or N/A — no dependencies. If it has to be quoted from the repo, quote it inside
the task that consumes it, with `Current state (path, lines A-B):`.}}
Produces: {{what later slices rely on — one exported name and signature per line, no code
block: the block lives in the task that creates the file, which is what the task brief
carries. Or N/A — <reason>.}}

## 6. Test strategy

{{What gets tested and how, following AGENTS.md commands. If a task carries no tests, say so
here with the reason so the implementer does not invent them.}}

## 7. Tasks

### Task 1 — {{name}}

**Objective:** {{one sentence: the observable behavior this commit delivers}}

**Files:** {{exact paths between backticks, each marked (create) or (modify)}}

Current state (path/to/file.ext, lines A-B):

{{ONLY the tramo that changes, max 12 lines, copied verbatim from the repo — the validator
greps it.}}

Contract (path/to/file.ext):

{{Max 25 lines: types, interfaces, exact signatures, typed errors, and constants the implementer
cannot derive (formats, flags, magic values). NO function bodies: those are written test-first.}}

Call site (path/to/consumer.ext):

{{Max 10 lines, before -> after: how the call reads in the consumer once this task is done —
route, handler, component usage.}}

Final text (path/to/doc.md):

{{Max 12 lines, text artifacts only (.md/.txt/.rst/.adoc): the exact replacement wording, and
only claims you verified against the repo. Never for code or configuration.}}

{{Configuration (tsconfig, package.json, CI workflows, lockfiles) never gets a block: state the
change in prose with the value inline. A task with no block at all says so with the exact line:
No code — <reason>. Blocks add up to 30 lines per task, and each task fits on ONE A4 page: 3500
characters. If a task does not fit, the task is two — never collapse two commits into one.}}

**TDD:** {{red first: literal test name and the assertion that pins the boundary → minimal green
| No TDD — <reason>}}

**Tests:** {{added: named one by one / removed on purpose: named one by one | N/A — <reason>}}

**Verification:** {{what the commands prove, in prose if it helps — but the commands themselves
go in the fenced block below, one per line, already run. A program executes this block: prose
with arrows and parentheses is not executable, and `--check-plan` rejects a task without it.}}

```bash
{{command}}   # {{expected: exit 0 — the comment says what exit 0 will mean here}}
```

{{The program scores this block by EXIT CODE and nothing else, so every command has to be a
predicate: a command whose exit code IS the claim. Anything you want to assert about a count, a
line or a piece of output goes inside `test`: `test "$(… | grep -c 'x')" -eq 2`,
`test "$(wc -l < f)" -le 150`, `test -z "$(git status --porcelain)"`. Never leave the claim in
the comment while the exit code says something else — `grep -c` exits 0 for "found at least
one" and 1 for "found none", so `grep -c … # expected: 0` is green exactly when it should be
red. `--check-plan` rejects the commands it can prove cannot measure their own claim.}}

### Task 2 — {{name}}

**Objective:** {{...}}

**Files:** {{...}}

{{Same four block roles, same budgets.}}

**TDD:** {{... | No TDD — <reason>}}

**Tests:** {{... | N/A — <reason>}}

**Verification:** {{...}}

```bash
{{command}}   # {{expected: exit 0 — a predicate, as in Task 1}}
```

## 8. Global verification

{{End-to-end validation once every task is committed: commands, what to look at.}}

## 9. Assumptions

{{Numbered: every ambiguity resolved without asking, what was decided, and its provenance
(issue / epic context / repo convention / own call).}}
