---
name: writing-plans-prescriptive
description: Use when dispatched for a Control Tower slice, before touching production code — turns the issue into a prescriptive plan that closes every decision, leaves the bodies to TDD, and passes plan-contract validation
---

# Writing Plans (Prescriptive)

## Overview

The implementer is a task-scoped subagent: it arrives with zero context, it decides nothing,
and it writes code test-first. Your job is **smart plan, cheap execution** — close every
**decision** (names, signatures, typed errors, non-derivable constants, test names, exact
commands) and hand every **body** to TDD.

That split is what makes the plan a **knowledge checkpoint**: committed as the branch's first
commit, cheap for a human to read, and cheap to implement again from scratch if the first
attempt goes wrong. A plan that carries the final content of a module is code instead of a
checkpoint, and it costs twice. Measured in the field: one slice plan reached 73.868 characters,
65% of its lines inside code blocks, too big to publish as a single issue comment, and five
of that slice's commits went to defects that had travelled inside it (a leaked temp directory, a
bare `catch` that swallowed real git failures, a type export that leaked author emails, a
documentation line that asserted something false, and four test vectors that missed the
threshold they claimed to pin). Code written blind, with no compiler and nothing executed,
arrives with defects nobody sees: the human `plan` gate that should catch them had 74k
characters to read, and at that size an OK is an act of faith.

**Announce at start:** "I'm using the writing-plans-prescriptive skill to write the slice plan."

This skill is the Control Tower port of crear-plan-detallado. Three things
are non-negotiable and machine-checked by `plan-contract.js`: the fixed structure, the
**literality rule** (every quoted current state exists verbatim in the repo), and the
**block taxonomy** below.

## Input: the issue is the frozen spec

You were dispatched for exactly one issue. Its body carries everything you are allowed to
plan from: the acceptance criteria (EARS), the "Out of scope / Protected" section, the
"Contexto del epic" and "Contexto heredado" sections, and the "Dependencias" section with the
interface this slice consumes. The execution spec stays out of reach on purpose: the issue is
the whole input.

**Zero questions.** There is no human in this session. Every ambiguity you resolve goes to
`## 9. Assumptions` with its provenance (issue / epic context / repo convention / your call).
If something genuinely prevents planning, set the `blocked` field in `.agent/SLICE.md` and
stop there: a blocker travels as that field, which is the one thing a guess cannot do.

## What a code block carries

Before writing any task, read the actual files this slice will touch and at least one
analogous file as a reference pattern.

**And find this repo's written yardstick, because `## 3. Reference patterns` carries both.**
An analogous file shows the shape; a convention document states the rule, and a rule holds even
where no analogous file exists — which is why a slice on an empty repo still has something to
measure against. Look for `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, anything under a
`docs/conventions/` or `rules` directory, and the project skills under `.claude/skills`.
Start from `.agent/conventions.md` where the repo declares one: that file is the repo's own
declaration, seeded by `/ct-init` and confirmed by a human, and it is what keeps slice 14 citing
the same yardstick as slice 3. List under `Rules to obey:` the entries that bear on this slice —
you are selecting, not transporting: the program pastes that file into every task brief anyway,
so omitting an entry does not hide it from the judge. The
issue's "Contexto del epic" is where a human may have named them already. List what you find
under `Rules to obey:`, **by path**, and if the repo declares none, say so with `N/A — <reason>`
rather than inventing a plausible one: `--check-plan` reads every path you name there and fails
the plan on one that is not in the repo. This section is what the judge opens to decide whether
the diff honours this repo's conventions, so a path cited from memory leaves implementer and
judge measuring against a file that is not there.

Then every code block you write declares its **role** on
the line right above it. The validator enforces the labels and their budgets:

| Label above the block | What goes inside | Budget |
|---|---|---|
| `Current state (path[, lines A-B]):` | the tramo that changes, copied **verbatim** from the file | 12 lines |
| `Contract (path):` | types, interfaces, exact signatures, typed errors, and constants the implementer cannot derive (a `git log` format string, a set of flags, a magic value) — **declarations only** | 25 lines |
| `Call site (path):` | how the call reads in the consumer once this task is done: route, handler, component usage, before → after | 10 lines |
| `Final text (path.md):` | the exact replacement wording, only where the literal text IS the deliverable — `.md`, `.txt`, `.rst`, `.adoc` | 12 lines |

A task adds up to **30** lines across its blocks. Command blocks (```bash, or any block right
after `**Verification:**`) are exempt from that total: they carry commands, and content that
matters travels as `Contract (path):` — which is why the validator reads a heredoc as a file
sneaking in.

**Each task fits on one A4 page: 3500 characters, about 50 lines.** The task is the unit
because it is what a human reads in one sitting at the gate, and exactly what the implementer
receives as its task brief. The plan as a whole has no ceiling: a plan with twelve tasks is a
badly cut slice, and that gets fixed where there is a human, when the spec is frozen.

If a task does not fit, keep the prose that explains the decisions and cut the blocks down to
the decisions themselves. If it still does not fit, **the task is two** — one task is one commit,
and splitting a commit is in your hands. Splitting the slice is not: it was cut with a human in
the room, so two commits' worth of work stays two tasks.

Three things travel without a block:

- **A function body** travels as its signature plus the failing test. The implementer writes it
  with the compiler and the real API in front of it, which is where a leaked temp directory or a
  bare `catch` gets caught.
- **A test file** travels as a name and an assertion — see below.
- **Configuration** travels as prose with the value inline — see below.

Blocks live **inside a `### Task N` section**, because the task is what travels. `ct-step` hands
each implementer its **task brief** (`scripts/task-brief --with-plan-context PLAN_FILE N`): the
task, preceded by `### Desired end state`, `### Out of scope`, `## 2. Closed decisions` and
`## 3. Reference patterns`. Those last three are the **yardstick**: where they contradict the
task, they win, so a decision closed in §2 and a rule cited in §3 do reach the implementer. The
rest of the plan stays behind, `## 5. Interfaces` included: name signatures in prose there and
put the block in the task that creates the file.

Every citation comes from the file open in front of you: the validator greps the repo and
accepts what matches it. A `Current state` citation is one **contiguous** tramo, copied end to
end, byte for byte. If the tramo you need contains code fences, quote around them as several
smaller citations — a nested fence desynchronises the parser.

## Configuration travels as prose

`tsconfig`, `package.json`, CI workflows, lockfiles, `.gitignore`, `Dockerfile`: state the change
in prose with the value inline. For example — *`server/package.json`: the `build` script becomes
`tsc --noEmit -p tsconfig.json && tsc -p tsconfig.build.json`; `server/tsconfig.json` adds
`"noEmit": true` and moves `rootDir`/`outDir` to a new `tsconfig.build.json` that excludes
`src/**/*.test.ts`.* Three lines of prose replaced 75 lines of JSON in a real plan, and the
implementer had the same information. The `**Verification:**` of that task (run the build,
expect exit 0) proves more than a pasted config does.

## Tests: the name and the assertion

A test travels as two things, both inline: `**TDD:**` carries its literal name and the
assertion that pins the behaviour, and `**Tests:**` lists every test added or deliberately
removed, by name. The body — arrange, fixtures, helpers — is the implementer's, written red
first.

Pin the **boundary**: boundary value analysis, one case at the limit and one on the other side
of it. A real plan wrote four cases for an "80% of authors" threshold and none of them
discriminated it, so mutating 80 to 70 left the whole suite green and the acceptance criterion
unpinned. Say what has to be impossible to break:
*`it('la concentración es el mínimo de autores que suma el 80%')` — a case exactly at 80 and one
just below.*

Citing an assertion that already exists, in order to change it, is a `Current state` citation
over the test file: that one is allowed, and it goes through the literality check.

## Text you dictate must be true

`Final text` blocks for documentation are the one place where the plan writes prose that lands
in the repo. Verify each claim against the repo before writing it: a real plan dictated the line
"the analysis is the ONLY code that runs git" while the same plan created a fixture helper that
also ran git, and the false line shipped. Same rule for `**Verification:**`: run the command
first, write down what you saw, and put the command in the block as a **predicate** — the
program that runs it scores the exit code and reads nothing else, so the claim belongs in the
command. A real plan shipped `git diff HEAD -- AGENTS.md | grep -c 'marker'   # expected: 0`
past this gate and past a human one: `grep -c` exits 0 on at least one match and 1 on none, so
that control went green exactly in the case it existed to forbid. The predicate form is
`test "$(git diff HEAD -- AGENTS.md | grep -c 'marker')" -eq 0`, and `--check-plan` now rejects
the commands it can prove cannot measure their own claim.

**Cite the files your slice rewrites, normally.** `--check-plan` reads the working tree (you
have not implemented anything yet) and `--release` reads the **base of the branch** — the same
state you wrote the plan against. So a citation of a file your tasks later rewrite keeps
validating after the work is done. Never relabel a `Current state (path):` block as prose to
get past the gate: that silently removes it from the only check that proves the plan describes
the real repo.

## Structure

Copy the `plan-template.md` next to this file and fill every hole. The 9 sections are
fixed, in that order and with those names; one that does not apply keeps its heading and gets
`N/A — <reason>`.

Tasks live under `## 7. Tasks` as `### Task N — <name>`, numbered from 1, consecutively.
**One task = one commit.** Each task carries: `**Objective:**` (one sentence),
`**Files:**` (exact paths, with create/modify), its labelled blocks (at least one, or the exact
line `No code — <reason>` for a task that is configuration in prose or documentation),
`**TDD:**` (the failing test first, with its literal name and assertion, or
`No TDD — <reason>`), `**Tests:**` (added / deliberately removed, named one by one), and
`**Verification:**` (exact commands, already run, and their output) — **the commands go in a
fenced block right after the marker, one per line, each one a predicate**, because the thing
that runs them is a program that reads their exit code and nothing else. `--check-plan` fails a
task whose `**Verification:**` has no command block, and one whose commands cannot measure what
they claim.

Every name in the plan resolves: a value where a `TBD` would go, the concrete handling instead
of "add error handling", the decision spelled out instead of "similar to Task 3", and a task
that defines each symbol the plan mentions. **Decisions are closed here; bodies are written
there.**

`## 5. Interfaces` is prose, with no blocks: `Consumes` names the interface the issue's
"Dependencias" section declares — and if the issue puts it in its description rather than in that
section, take it from there — and `Produces` names what later slices will rely on, one exported
name and signature per line. The block that creates the file lives in its task, because that is
what the task brief carries.

## Examples

All four come from the same real slice: a git-history analysis module in a Node/TypeScript
monorepo, planned as 1.271 lines of code across 22 A4 pages — with five of the slice's commits
spent on defects that had travelled inside the plan.

**1. A new module with logic — `server/src/analysis/git.ts`.** One `Contract
(server/src/analysis/git.ts):` block of about ten lines, carrying what cannot be derived or
invented — and which, in the real slice, survived byte for byte:

- the format string `'%x00%H%x1f%aI%x1f%aE'`, with the reason inline: `%aE` applies `.mailmap`,
  `%ae` does not;
- the flag list `--no-merges --no-renames --root --name-only`;
- `type CodigoErrorAnalisis = 'no-es-repo-git' | 'git-ha-fallado'` and the shape of the error
  class that carries it;
- `interface Historial { headSha: string | null; commits: Commit[] }`;
- three signatures: `leerHistorial(repo): Promise<Historial>`,
  `leerHeadSha(repo): Promise<string | null>` (null when there is no HEAD),
  `parsearHistorial(salida: string): Commit[]`.

The body of `parsearHistorial` stays with the implementer: the format above plus the test
`it('lee el formato de git log con separadores NUL y US')` determines it. Keep the diagnostic
sentence — *if the `.mailmap` test fails returning the raw email, the format is using `%ae`
instead of `%aE`* — because that is contract knowledge, not a body. It replaces 113 lines of
final content, of which the implementer rewrote 84%, with two of the branch's defects in the
part it pasted first.

**2. A test helper — `server/src/testing/repo-fixture.ts`.** Four signatures (`CommitFixture`,
`RepoFixture`, `crearRepoFixture(opciones?)`, `commitsSinMerges(ruta)`) plus one line of closed
decisions in prose: *dates pinned with `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`, repo created
under `mkdtempSync(tmpdir())`, `limpiar()` removes it, fixtures only.* It replaces 106 lines of
helper plus 43 of its test, rewritten 84% and 77%, whose pasted version leaked a temp directory
on failure.

**3. Configuration — `server/tsconfig.json` and `server/package.json`.** The prose of the
configuration section above, in place of 75 lines of JSON across two blocks.

**4. `## 5. Interfaces` and its task — `index.ts`.** §5 names the surface in prose
(`walkHistory(repo, ventana, opciones?) => Promise<Analisis>`, `leerHeadSha`, `ErrorAnalisis`,
`VENTANAS`, and the exported types), and the `Contract (server/src/analysis/index.ts):` block
lives in the task that creates the file — the only text the implementer will read. It replaces
34 lines in §5 plus 40 in the task, for a 42-line file.

## Save, validate, commit

1. Save to `docs/superpowers/plans/YYYY-MM-DD-issue-<n>-<slug>.md`, where `<n>` is the GitHub
   issue number from `.agent/SLICE.md` (`github_issue`). The `issue-<n>-` segment is how the
   release gate finds the plan — keep it.
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
the plan and dispatches a fresh subagent per task. The subagents start with none of your context,
which is why the plan is prescriptive.
