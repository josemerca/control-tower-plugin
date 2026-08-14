---
name: writing-plans-prescriptive
description: Use when dispatched for a Control Tower slice, before touching production code — turns the issue into a prescriptive plan that closes every decision, leaves the bodies to TDD, and passes plan-contract validation
---

# Writing Plans (Prescriptive)

## Overview

The implementer is a task-scoped subagent with **zero context and no authority to decide** —
but it can write code, and it will write it test-first. So your job is to close every
**decision** (names, signatures, typed errors, non-derivable constants, test names, exact
commands) and to leave every **body** to TDD.

A plan that pastes the final content of a module is not more prescriptive: it is a code dump,
and it costs twice. Measured in the field: one slice plan reached 73.868 characters with 65% of
its lines inside code blocks, too big to publish as a single issue comment — and five of that
slice's commits went to fixing defects that had travelled pasted in the plan (a leaked temp
directory, a bare `catch` that swallowed real git failures, a type export that leaked author
emails, a documentation line that asserted something false, and four test vectors that did not
pin the threshold they claimed to pin). Code written blind, with no compiler and nothing
executed, arrives with defects that nobody sees — because the human `plan` gate that should
catch them had 74k characters to review, and at that size an OK is an act of faith.

**Announce at start:** "I'm using the writing-plans-prescriptive skill to write the slice plan."

This skill is the Control Tower port of a personal skill (crear-plan-detallado). Three things
are non-negotiable and machine-checked by `plan-contract.js`: the fixed structure, the
**literality rule** (every quoted current state must exist verbatim in the repo), and the
**block taxonomy** below.

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

## What carries a code block — and what does not

Before writing any task, read the actual files this slice will touch and at least one
analogous file as a reference pattern. Then every code block you write declares its **role** on
the line right above it. The validator enforces the labels and their budgets:

| Label above the block | What goes inside | Budget |
|---|---|---|
| `Current state (path[, lines A-B]):` | the tramo that changes, copied **verbatim** from the file | 12 lines |
| `Contract (path):` | types, interfaces, exact signatures, typed errors, and constants the implementer cannot derive (a `git log` format string, a set of flags, a magic value) — **no function bodies** | 25 lines |
| `Call site (path):` | how the call reads in the consumer once this task is done: route, handler, component usage, before → after | 10 lines |
| `Final text (path.md):` | the exact replacement wording, only where the literal text IS the deliverable — `.md`, `.txt`, `.rst`, `.adoc` | 12 lines |

A task adds up to **30** lines across its blocks (a task is one commit), and the whole plan to
**40**. Command blocks (```bash, or any block right after `**Verification:**`) are exempt from
those totals, and must not smuggle a file in through a heredoc.

**The whole plan fits on one A4 page: 3500 characters, about 50 lines.** That is the real
constraint, and the budgets above only exist to keep you inside it. The gate asks a human to
*read* the plan before any code is written; what does not fit on a page is not read, it is
skimmed, and what gets skimmed lets defects through — that is exactly how five of them shipped
in the slice measured above. If your plan does not fit, do not shrink the prose that explains the
decisions: cut the blocks to the decisions only.
And if it still does not fit, **the slice is two** — atomic changes were already the doctrine;
this contract just makes it checkable.

Three things never get a block:

- **A function body.** The signature plus the failing test define it; the implementer writes it
  with the compiler and the real API in front of it, which is exactly where a leaked temp
  directory or a bare `catch` gets caught.
- **A test file** — see below.
- **Configuration** — see below.

Blocks live **inside a `### Task N` section, nowhere else**.
`subagent-driven-development` hands each implementer its **task brief** (`scripts/task-brief
PLAN_FILE N`), which extracts that task and nothing more, so a block written in
`## 5. Interfaces` never reaches the subagent that needs it. Name signatures in prose there, and
put the block in the task.

Never quote from memory — the validator greps the repo and refuses citations that do not
match. A `Current state` citation must be a **contiguous** tramo, byte for byte: no ellipsis, no
"rest unchanged", no lines stitched together. If the tramo you need to quote itself contains
code fences, quote around them in several smaller citations — a nested fence desynchronises the
parser.

## Configuration is prose, never a block

`tsconfig`, `package.json`, CI workflows, lockfiles, `.gitignore`, `Dockerfile`: state the change
in prose with the value inline. For example — *`server/package.json`: the `build` script becomes
`tsc --noEmit -p tsconfig.json && tsc -p tsconfig.build.json`; `server/tsconfig.json` adds
`"noEmit": true` and moves `rootDir`/`outDir` to a new `tsconfig.build.json` that excludes
`src/**/*.test.ts`.* Three lines of prose replaced 75 lines of JSON in a real plan, and the
implementer had exactly the same information. The `**Verification:**` of that task (run the build,
expect exit 0) proves more than a pasted config ever did.

## Tests: the name and the assertion, never the file

A test file **never appears as a block**. `**TDD:**` carries the literal test name and the
assertion that pins the behaviour, inline; `**Tests:**` lists every test added or deliberately
removed, by name. The body — arrange, fixtures, helpers — is the implementer's, written red
first.

Pin the **boundary**, not four arbitrary vectors: a real plan wrote four cases for an "80% of
authors" threshold and none of them discriminated it, so mutating 80 to 70 left the whole suite
green and the acceptance criterion unpinned. Say what must be impossible to break:
*`it('la concentración es el mínimo de autores que suma el 80%')` — a case exactly at 80 and one
just below.*

Citing an assertion that already exists, in order to change it, is a `Current state` citation
over the test file: that one is allowed, and it goes through the literality check.

## Text you dictate must be true

`Final text` blocks for documentation are the one place where the plan writes prose that lands
in the repo. Verify each claim against the repo before writing it: a real plan dictated the line
"the analysis is the ONLY code that runs git" while the same plan created a fixture helper that
also ran git, and the false line shipped. Same rule for `**Verification:**`: run the command
first, then write the output you saw. A `grep -c` that "should print 2" and prints 3 is a task
whose verification cannot pass.

**Cite the files your slice rewrites, normally.** `--check-plan` reads the working tree (you
have not implemented anything yet) and `--release` reads the **base of the branch** — the same
state you wrote the plan against. So a citation of a file your tasks later rewrite keeps
validating after the work is done. Never relabel a `Current state (path):` block as prose to
get past the gate: that silently removes it from the only check that proves the plan describes
the real repo.

## Structure

Copy `plan-template.md` (in this skill's directory) and fill every hole. The 9 sections are
fixed; never delete or rename one — a section that does not apply gets `N/A — <reason>`.

Tasks live under `## 7. Tasks` as `### Task N — <name>`, numbered from 1 with no gaps.
**One task = one commit.** Each task carries: `**Objective:**` (one sentence),
`**Files:**` (exact paths, with create/modify), its labelled blocks (at least one, or the exact
line `No code — <reason>` for a task that is configuration in prose or documentation),
`**TDD:**` (the failing test first, with its literal name and assertion, or
`No TDD — <reason>`), `**Tests:**` (added / deliberately removed, named one by one), and
`**Verification:**` (exact commands, already run, and their output).

No placeholders and no open decisions anywhere: not `TBD`, not "add error handling", not
"similar to Task 3", and no reference to a symbol no task defines. What you must not leave open
is a **decision**; what you must not write down is a **body**.

`## 5. Interfaces` is prose, with no blocks: `Consumes` names the interface the issue's
"Dependencias" section declares — and if the issue puts it in its description rather than in that
section, take it from there — and `Produces` names what later slices will rely on, one exported
name and signature per line. The block that creates the file lives in its task, because that is
what the task brief carries.

## Examples

All four come from the same real slice: a git-history analysis module in a Node/TypeScript
monorepo. That plan measured 1.271 lines of code across 22 A4 pages. Specified with the rules
above, its eight tasks no longer fit on one page — so that slice was really three, and the
budgets say so instead of leaving it to taste.

**1. A new module with logic — `server/src/analysis/git.ts`.**

Wrong (what was written): `Current state: does not exist.` plus 113 lines of final content. The
implementer rewrote 84% of it, and two of the defects that reached the branch were in the parts
it pasted first.

Right: one `Contract (server/src/analysis/git.ts):` block of about ten lines, with only what
cannot be derived or invented — and which, in the real slice, survived byte for byte:

- the format string `'%x00%H%x1f%aI%x1f%aE'`, with the reason inline: `%aE` applies `.mailmap`,
  `%ae` does not;
- the flag list `--no-merges --no-renames --root --name-only`;
- `type CodigoErrorAnalisis = 'no-es-repo-git' | 'git-ha-fallado'` and the shape of the error
  class that carries it;
- `interface Historial { headSha: string | null; commits: Commit[] }`;
- three signatures: `leerHistorial(repo): Promise<Historial>`,
  `leerHeadSha(repo): Promise<string | null>` (null when there is no HEAD),
  `parsearHistorial(salida: string): Commit[]`.

The body of `parsearHistorial` does not go: the format above plus the test
`it('lee el formato de git log con separadores NUL y US')` determines it. Keep the diagnostic
sentence, though — *if the `.mailmap` test fails returning the raw email, the format is using
`%ae` instead of `%aE`* — because that is contract knowledge, not a body.

**2. A test helper — `server/src/testing/repo-fixture.ts`.** Wrong: 106 lines of helper plus 43 of
its test; the implementer rewrote 84% and 77% respectively, and the pasted version leaked a temp
directory on failure. Right: four signatures (`CommitFixture`, `RepoFixture`,
`crearRepoFixture(opciones?)`, `commitsSinMerges(ruta)`) plus one line of closed decisions in
prose: *dates pinned with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, repo created under
`mkdtempSync(tmpdir())`, `limpiar()` removes it, never against real clones.*

**3. Configuration — `server/tsconfig.json` and `server/package.json`.** Wrong: 75 lines of JSON
across two blocks. Right: the prose of the configuration section above.

**4. Duplication between `## 5. Interfaces` and its task — `index.ts`.** Wrong: 34 lines in
§5 `Produces` plus 40 in the task, for a 42-line file. Right: §5 names the surface in prose
(`walkHistory(repo, ventana, opciones?) => Promise<Analisis>`, `leerHeadSha`, `ErrorAnalisis`,
`VENTANAS`, and the exported types), and the `Contract (server/src/analysis/index.ts):` block
lives in the task that creates the file — the only text the implementer will read.

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
