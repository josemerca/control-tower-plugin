# The backend's boundaries

Applies to: **every diff under `backend/`**.

## Talking to a tool: four steps, each with one job

```
ToolRunner      launches a binary with its budget; never throws: the exit code is data
ExternalTool    the conversation: asks the policy whether a failure is worth retrying
Gh (idiom)      extends the trunk with what only that tool writes
<tool>-<port>   the adapter: the argv, the parsing, the typed errors
```

- **A non-zero exit code is data, not an exception.** The reason lives in the
  error channel and a throw erases it; the adapter interprets.
- **The caller declares whether its call is safe to repeat.** A read is
  (`safeToRepeat: true`); `gh issue create` is not — a lost answer may be an
  answer that created the issue, and the retry opens a second one. Only
  transient failures of repeatable calls are retried, on the policy's budget.
- **The trunk knows the network's idiom; the subclass knows the tool's.**
  Generic markers (connection reset, timeouts, DNS, 5xx) live once in
  `ExternalTool`; what only `gh` writes lives in `Gh`. A tool with no measured
  idiom of its own (acli today) inherits the trunk bare — inventing markers
  nobody measured is a preference dressed as a rule.
- **A rate limit is not a blip.** GitHub documents waiting 60 seconds or more;
  retrying it on the blip cadence lengthens the block instead of clearing it,
  so it is deliberately absent from the transient markers.
- **A missing label is a datum, not a failure**: read which one, sow it with
  `--force` (the benign-race argument is `ct-groom.mjs`'s), retry the creation,
  and never sow a label that is not ours.

## Boundary models

- **The conversion to the domain lives in the model, with one door**: what the
  tool printed goes in, the domain object comes out. A model that keeps the
  domain object's fields and lets the adapter map by hand is the same type
  written twice.
- **Project only the keys you consume** (`--fields summary,description`); a
  foreign envelope is validated by projection, and an answer missing what we
  declared we read fails with the tool's own words quoted.
- **Text from another system gets its active syntax quieted before it reaches
  GitHub.** Measured: a Jira description saying `Slice #7` autolinked our issue
  into a stranger's timeline, and an `@handle` would have notified a person.
  Bare `#N`, `owner/repo#N`, GitHub URLs and `@handles` are fenced as code;
  what was already code stays; an email does not split at its `@`.

## Answering HTTP

- **The projection from a vocabulary to HTTP is exhaustive and returns a value
  object**, never an object literal; an unmapped member throws instead of
  guessing.
- **This API is a backend for one frontend, and that frontend decides by
  `code`, not by status.** Every refusal answers `{code, detail}` — one shape,
  so the frontend has one thing to parse regardless of which door refused it.
  A refusal our own application judged — the request was malformed, a tool
  refused, a tool answered something we cannot read, nobody is watching that
  issue — always answers 400: the status stopped being the signal, so it
  stopped needing to vary. A refusal of the protocol itself — the wrong
  method, an unreadable or oversized body, a foreign origin, a route that does
  not exist — keeps the status HTTP already gives it, because that one is not
  a decision about a request that reached the application; its body is
  `{code, detail}` too, so the shape stays one across the whole API.
- **A `code` is declared explicitly, in kebab-case, next to the `detail` it
  comes with**, never derived from an exception's class name: deriving it
  would wire the answer to a name that lives in the domain, and renaming that
  exception would silently change what the frontend receives.
- **An `Origin` is admitted only when it is the page this server hosts**,
  vouched by a loopback `Host`; any other page on any port is a foreign site.

## Antipatterns

- An adapter that decides policy: retries, budgets, what a failure costs.
- A `try/catch` around a launch — failure comes back as data.
- `issue create` (or any non-idempotent write) declared repeatable.
- A mapping helper outside the boundary model that owns the format.
- Outside text reaching an issue body unquieted.
