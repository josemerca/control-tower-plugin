# {{#<issue> — what this slice delivers}}

> **This plan is written to be executed by task-scoped subagents with zero context and no
> authority to decide.** Every diff embeds the current state (copied verbatim from the repo)
> and the complete final state. Do not improvise: follow the tasks literally. On ambiguity,
> the issue body and AGENTS.md win.

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

{{Real files in this repo the implementer must imitate.}}

## 4. Inventory

{{Every file this slice creates or modifies, with what consumes it.}}

## 5. Interfaces

Consumes: {{the interface the issue's "Dependencias" section declares — copied exactly, or
N/A — no dependencies}}
Produces: {{what later slices rely on — exact names, signatures, types, or N/A — <reason>}}

## 6. Test strategy

{{What gets tested and how, following AGENTS.md commands. If a task carries no tests, say so
here with the reason so the implementer does not invent them.}}

## 7. Tasks

### Task 1 — {{name}}

**Objective:** {{one sentence: the observable behavior this commit delivers}}

**Files:** {{exact paths}}

Current state (path/to/file.ext):

{{code block copied verbatim from the repo — or the line "Current state: does not exist."
followed by the complete final content}}

**TDD:** {{red first: literal test name and assertion → minimal green | No TDD — <reason>}}

**Tests:** {{added: named one by one / removed on purpose: named one by one | N/A — <reason>}}

**Verification:** {{exact command and expected output}}

### Task 2 — {{name}}

**Objective:** {{...}}

**Files:** {{...}}

{{Diffs with the same Current state convention.}}

**TDD:** {{... | No TDD — <reason>}}

**Tests:** {{... | N/A — <reason>}}

**Verification:** {{...}}

## 8. Global verification

{{End-to-end validation once every task is committed: commands, what to look at.}}

## 9. Assumptions

{{Numbered: every ambiguity resolved without asking, what was decided, and its provenance
(issue / epic context / repo convention / own call).}}
