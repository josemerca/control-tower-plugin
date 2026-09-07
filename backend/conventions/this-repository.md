# What only this repository decides

What binds here and does not travel with the plugin.

## Precedence

1. This document — what is specific to this backend.
2. `plugin/conventions/` — the travelling yardstick; it binds on every diff
   here too, and this document never restates it. The header every brief
   carries states how the two resolve when they clash.
3. The `backend-best-practices` skill — general guidance; it yields to both.
   Where it shows something else — its Object Mothers section illustrates
   with a test of a domain entity on its own — the travelling yardstick's
   three outside-in testing rules win. An example teaches by imitation; this
   is the rule.

## No declared debt

There is no declared debt in `backend/`: every rule that binds here binds on
every diff, old module or new. `plugin/conventions/style.md` and
`plugin/conventions/architecture.md` grant a declared-debt exemption to a
module that was already there — the one exemption in the whole travelling
yardstick — and this repository does not take it.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **User story** | What Jira calls a ticket: the work to plan, identified by its key (`ABC-123`) |
| **Plan issue** | The GitHub issue that hosts a plan: the plan is posted there, the GO is answered there, the dispatcher reads its labels |
| **Plan agent** | Whoever writes the plan for a story; today a Claude in a cmux tab |
| **GO** | The human's `-OK <nonce>` on the issue that releases the agent |
| **Repository name** | `owner/name`; validated because it becomes an argument of `gh` |
| **Checkout root** | The absolute path of the local git clone where a plan's worktree is cut; validated because it becomes an argument of `git -C` |
| **Prepared workspace** | A worktree `.worktrees/<n>` on branch `feat/<n>` that a plan agent works in |
| **Harvest** | Collecting what a delivered slice left behind — its worktree, its branch, its agent — once its pull request merged; the plugin's `dispatch-check --collect` does it, the backend only decides when |
| **Harvest ledger** | The BigQuery table where every harvested slice leaves its row, shared by every team and told apart by `repo`; the plugin loads it, the backend only says which table (`CT_HARVEST_BQ_TABLE`) |

## Naming an exception family

Every family under `PlanFailure` names its two causes: **the command
failed** (`*NotRead`, `*NotCreated`, `*NotLaunched`) and **it answered
something we cannot read** (`*NotUnderstood`, `*NotNamed`). The boundary
projects each cause to its own `code`.

Jira, GitHub, cmux, acli and gh exist only in `infrastructure/`.

## The backend leans on the plugin, never the reverse

`backend/` imports the plugin's pure renderers and readers
(`plugin/scripts/groom.js`, `gh-issue-map.js`, `gates.js`, `scope.js`) instead
of transcribing their headings or their formats: the plugin is the authority on
what an issue says and how it is read. The plugin is distributed alone and must
never import from `backend/`. What the plugin does not export is copied here
as a literal, with a contract test that renders the plugin's own output and
compares — `backend/__tests__/infrastructure/plugin-contract.test.js` — the
declared-copy rule for the one contract that crosses this boundary.

## Talking to a tool

Four steps, each with one job — the concrete types of this backend:

```
ToolRunner      launches a binary with its budget
ExternalTool    the conversation: asks the policy whether a failure is worth retrying
Gh (idiom)      what only `gh` writes
<tool>-<port>   the adapter: the argv, the parsing, the typed errors
```

- **The flag is named `safeToRepeat`.** `gh issue create` never gets `true`.
- **A missing label is a datum, not a failure**: read which one, sow it with
  `--force` (the benign-race argument is `ct-groom.mjs`'s), retry the
  creation, and never sow a label that is not ours.
- **Bare `#N`, `owner/repo#N`, GitHub URLs and `@handles` are fenced as
  code** before text from another system reaches an issue.

## The layout

The root folder is `src/`. Inside it, `domain/value-objects`, `domain/ports`
and `domain/policies` are the three kinds of domain inhabitant apart from
each other, and `application/actions` and `application/queries` are the two
kinds of use case. Every domain exception lives together in the one file
`exceptions.js`, the catalogue exemption `plugin/conventions/architecture.md`
allows for a kind declared together on purpose.

A controller under `infrastructure/` is named `<endpoint>-route.js`, one
file per endpoint.

What each file under `infrastructure/` is, concretely, in this backend — the
repository's own choice of names, not a pattern:

```
infrastructure/
  ct-api.mjs         the entrypoint
  api-server.js      what every endpoint shares: mounting, the last net, listen, stop
  http.js            generic plumbing: answering, routing hygiene, the origin filter, the body reader
  harvest-clock.js   the sweep: every minute, asks a registry which clones
                      it served a plan for and surveys each in turn
  invocation.js      moved out of the entrypoint until it is observable
                      without spawning a process — the reason it exists
```

## Answering HTTP in this API

- **This API is a backend for one frontend, and that frontend decides by
  `code`, not by status.** Every refusal answers `{code, detail}` — one shape,
  so the frontend has one thing to parse regardless of which door refused it.
- **A refusal our own application judged always answers 400**: the request was
  malformed, a tool refused, a tool answered something we cannot read, nobody
  is watching that issue. The status stopped being the signal, so it stopped
  needing to vary.
- **A refusal of the protocol itself keeps the status HTTP already gives it**:
  the wrong method, an unreadable or oversized body, a foreign origin, a route
  that does not exist. That one is not a decision about a request that reached
  the application; its body is `{code, detail}` too, so the shape stays one
  across the whole API.
- **The wire format of a `code` is kebab-case.**
- **An `Origin` is admitted only when it is the page this server hosts**,
  vouched by a loopback `Host`; any other page on any port is a foreign site.

## Where the suite runs

From `backend/`, never the repository root. The fast subset is `npx vitest run --exclude '**/*-real-process.test.js'`. During a working session, run the fast subset per change and the whole suite before handing anything over.

## Testing: a failing test must not leak a process

This suite launches real processes by design. Every spawned child is
killed in `afterEach`, not after the assertion.
