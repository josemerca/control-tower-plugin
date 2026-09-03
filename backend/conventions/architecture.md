# Where each thing lives in the backend

Applies to: **every diff under `backend/`**. The three layers, the direction of
dependencies, the shape of a use case and "one concept per module" are the
repository's rules and live in `plugin/conventions/architecture.md`; this
document only adds what the backend decided on top. There is no declared debt
here: everything under `backend/` was born under this yardstick and conforms
entire, old file or new.

## The layout

```
src/
  domain/
    value-objects/   one value object per module
    ports/           one port per collaborator
    policies/        exact rules with their configuration beside them
    exceptions.js    the catalogue, one file on purpose
  application/
    actions/         one use case per module, with its Params and Result
    queries/         one read-only use case per module, with its Params and
                     Result; told apart from actions by the folder
  infrastructure/
    ct-api.mjs       the entrypoint: the only place that assembles the graph
    api-server.js    what every endpoint shares: mounting, the last net, listen, stop
    http.js          generic plumbing: answers, routing hygiene, origin filter, body reader
    harvest-clock.js the sweep: every minute, survey the checkout and ask the
                     plugin to collect each prepared workspace
    <endpoint>-route.js   one controller per endpoint, its request model and
                          its refusal projections inside
    <tool>-<port>.js      one adapter per port, named after its implementation
```

Inside a layer, the folder is the discriminator, never a suffix on the name.

## A new type has the burden of proof

The default answer to new behaviour is **a method on a type that already
exists**, and the default answer to a new type is **inside the module that
consumes it**. A type earns a module of its own only when something else
constructs it, another module consumes it, or it carries its own algebra — and
"the tests build it" grants nothing: a test double is not a consumer and tests
are not a layer.

This was paid for, so it is a rule and not a taste: three types shipped in
their own modules and had to come back home, and the count of classes said
"over-designed" while the count of concepts did not. The calls already made,
kept so they are not relitigated:

- **The payload only its owner constructs shares the owner's file.** A process
  output lives with the runner that produces it; a refusal with the projections
  that build it; a policy's budget and decision with the policy.
- **A boundary model shares its adapter's file while the adapter is its only
  consumer** — the envelope acli prints lives inside `acli-user-stories.js`,
  the issue body inside `gh-plan-issues.js`. The issue body is a contract with
  GitHub and not with `gh`, so the day a second GitHub adapter exists it is
  extracted along that line; the divergence is declared in the history.
- **A class nobody instantiates is a namespace**, tolerated only because
  `plugin/conventions/style.md` bans loose functions — never a reason to grant
  it a module. If a namespace has one consumer, it lives inside it.
- **A client per tool, never a client per call.** One trunk for talking to
  external tools, one subclass per tool that has an idiom of its own, one
  adapter per port. A tool whose subclass would add nothing is wired with the
  bare trunk instead of getting an empty class.

## One controller per endpoint

The route, its request model with the closed vocabulary of outcomes, and the
projections that turn each outcome and each failure into an HTTP answer travel
in one module — the relation Params and Result keep with their action. The next
endpoint is one new file and one mounting line in `api-server.js`. What every
endpoint would repeat (answering, trailing slashes, the origin filter, the JSON
body reader) lives in `http.js` and nowhere else.

## The backend leans on the plugin, never the reverse

`backend/` imports the plugin's pure renderers and readers
(`plugin/scripts/groom.js`, `gh-issue-map.js`, `gates.js`, `scope.js`) instead
of transcribing their headings or their formats: the plugin is the authority on
what an issue says and how it is read. The plugin is distributed alone and must
never import from `backend/`. What the plugin does not export is copied as a
literal **with a contract test that renders the plugin's own output and
compares** — the declared-copy rule of `plugin/conventions/decisions.md`.

## Antipatterns

- A suffix doing a folder's job (`*VO`, `*Port`, `*UseCase`).
- A new type for what a method on an existing type could carry.
- A module whose only consumer is one other module, with no second constructor
  and no algebra of its own.
- A second endpoint's parsing or refusals inside `api-server.js` or `http.js`.
- A plugin heading transcribed without the contract test that measures the copy.
- `plugin/` importing anything from `backend/`.
