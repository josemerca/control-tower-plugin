# What only this repository decides

What binds here and does not travel with the plugin. The travelling yardstick
of `plugin/conventions/` binds on every diff under `backend/` too; the header
every brief carries already states how the two resolve when they clash.

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

## The backend leans on the plugin, never the reverse

`backend/` imports the plugin's pure renderers and readers
(`plugin/scripts/groom.js`, `gh-issue-map.js`, `gates.js`, `scope.js`) instead
of transcribing their headings or their formats: the plugin is the authority on
what an issue says and how it is read. The plugin is distributed alone and must
never import from `backend/`. What the plugin does not export is copied here
as a literal, with a contract test that renders the plugin's own output and
compares — `backend/__tests__/infrastructure/plugin-contract.test.js` — the
declared-copy rule for the one contract that crosses this boundary.

## The layout

What each file under `infrastructure/` is, concretely, in this backend — the
repository's own choice of names, not a pattern:

```
infrastructure/
  ct-api.mjs         the entrypoint
  api-server.js      what every endpoint shares: mounting, the last net, listen, stop
  http.js            generic plumbing: answering, routing hygiene, the origin filter, the body reader
  harvest-clock.js   the sweep: every minute, asks a registry which clones
                      it served a plan for and surveys each in turn
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
- **An `Origin` is admitted only when it is the page this server hosts**,
  vouched by a loopback `Host`; any other page on any port is a foreign site.
