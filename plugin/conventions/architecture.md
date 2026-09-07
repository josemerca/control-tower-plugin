# Where each thing lives

Applies to: **new modules**.

A module that was already there and does not conform is the repository's
**declared debt**: what you add to it follows the style of its host, and that is
not a finding — half a migration reads worse than none.

The hole that exemption opens is closed in the same breath, because otherwise the
cheapest way to dodge this document is to write new code inside an old file:
**a new concept is a new module and is born conforming.** Sheltering under the
host's style covers only what genuinely extends what was already there; placing
a new concept inside an old file to inherit the exemption **is** a finding.

## The three layers, and the direction of dependencies

Infrastructure knows application and domain. Application knows domain. Domain
knows nobody.

- **Domain** — values, ports, policies and errors. No input/output, no knowledge
  of any other layer, and no serialization: translating to the keys of an
  external contract is the boundary's work.
- **Application** — the use cases. They orchestrate; the logic lives in the
  domain and the input/output behind a port.
- **Infrastructure** — adapters, boundary models and entrypoints. The only layer
  that knows there is a subprocess, a filesystem or another service on the other
  side. What it owes at that edge is `conventions/boundaries.md`.

The layers and what lives inside them **show in the tree**: one folder per
layer, and inside each layer one folder per kind of inhabitant — the value
objects, the ports and the policies apart from each other inside domain; the
actions apart from the queries inside application; the adapters apart from
the controllers inside infrastructure. Which name the root folder gets and
what a file is called is the repository's own choice; what this rule fixes is
that **the folder is the discriminator, never a suffix on the name.**

## One concept per module

One concept per module, and with it whatever does not exist without it. The
yardstick is deliberately hard: **if you delete the main concept, is the other
type left with no consumer and no meaning of its own?** Only then do they share a
file.

And the other way round: a type with a life of its own is a concept and goes to
its own module, even if today it is only used beside the other one. It has a life
of its own if something else constructs it, if another layer consumes it, or if
it carries its own algebra. Without that half, "does not exist without it"
stretches to justify any grouping by habit.

## A new type has the burden of proof

New behaviour defaults to **a method on a type that already exists**, and a
new type defaults to **inside the module that consumes it**. A type earns a
module of its own only when something else constructs it, another module
consumes it, or it carries its own algebra — and "the tests build it" grants
nothing: **a test double is not a consumer**, and tests are not a layer.

This was paid for, so it is a rule and not a taste: three types once shipped
in their own modules and had to come back home, and the count of classes
said "over-designed" while the count of concepts did not.

The calls already made, kept so they are not relitigated:

- **The payload only its owner constructs shares the owner's file.**
- **The model that converts what an adapter receives or sends shares that
  adapter's file while the adapter is its only consumer.** The day a second
  adapter needs the same conversion, it is extracted along that line, and
  the split is declared in the history.
- **A class nobody instantiates is a namespace**, tolerated only because
  `conventions/style.md` bans loose functions — never a reason to grant it
  a module of its own. A namespace with one consumer lives inside it.
- **One client per external system, never a client per call.**

## One controller per endpoint

The route, its request model with the closed vocabulary of outcomes, and the
projections that turn each outcome and each failure into an answer travel
together in one module — the same relation Params and Result keep with
their use case. The next endpoint is one new file and one line that wires it
in. What every endpoint would otherwise repeat lives in a module of its own,
never inside an endpoint's own file.

## The shape of a use case

- Dependencies enter **through the constructor, by name**. It depends on ports,
  never on adapters: a use case does not know there is a subprocess on the other
  side.
- **No suffix on the type**, on its parameters or on its result.
- The main method takes a parameters object and returns a result object, both
  immutable and declared beside it — never a raw map (`conventions/defects.md`).
  **A use case that answers something declares its result object even when it
  carries a single field**, so every answer of the program is read the same way
  and none of them has to be opened to find out how its answer arrives; one
  that answers nothing declares none.
- **A use case is not measured by its size.** One that only hands its
  parameters to a port earns its module the same as one that orchestrates five:
  what it buys is the seam — whoever conducts stops knowing which port that
  step needs, and the step can grow without the conductor changing — and that
  is worth the same with a body of one line or of twenty.
- **A configuration value enters as data, not behind a port.** A port whose only
  method returns a constant is indirection; what the object buys is that values
  which have to agree travel together and their coherence can be checked in one
  place.
- **What it does not do**: it does not translate to external formats, it does not
  catch errors to turn them into what its invoker receives
  (`conventions/boundaries.md`), and it does not decide retry or budget policy.
- **Mutation and reading are told apart by where they live**, not by a suffix on
  the type. Something that mutates and also returns data is still a mutation:
  what classifies it is that it mutates, not that it answers.

## A policy is the exact rule

The exact rule — which step comes after a result, what counts as exhausted — is a
domain object, not prose and not a conditional inside a use case. Immutable, with
**its configuration injected**, no input/output and knowing nobody.

- **Total or explicit**: an input the policy does not describe **raises** its
  error instead of falling into a catch-all branch, so it shows at the moment
  instead of passing for "nothing happened".
- **It returns the whole effect**, not a boolean and not a map: what comes next
  and the state it leaves travel together. A consumer that had to recompose that
  would have the policy spread again.

## Conducting is not executing

Something that drives a flow end to end **invokes** its steps. Each dispatched
step enters through its own use case, and whoever conducts does not talk to the
ports that step needs to do its work.

The line, so it is not widened by precedent: **if its result projects to an
outcome the flow receives, it is a step.** A prior check — asking whether what a
step will need exists, preparing something before the loop — may still go against
the port from whoever conducts: it is not a step and it has no result the flow
consumes. The yardstick is not the size of the call.

And translating a step's result into the flow's vocabulary is not the conductor's
either: that projection lives on the destination's side, or every new step brings
its own conditional to the conductor and the rule ends up spread among the places
that invoke it.

## Leaving a record is not conducting

Whoever decides the flow does not compose the telemetry. It decides **when** a
record has to be left; **how** it is left is another use case, invoked like any
other. The rule bites once the conductor would have to name telemetry types in
order to build them; while it only passes data to a port, there is nothing to
extract.

## Antipatterns

- A new concept placed inside a non-conforming old file to inherit its exemption.
- The domain importing from application or from infrastructure.
- A use case importing from infrastructure, or depending on an adapter.
- A use case with a suffix on its type, its parameters or its result.
- A mapping helper in the use case instead of in the boundary model.
- A conditional in the conductor that translates a step's result.
- A policy that returns a boolean instead of the whole effect.
- A policy with a catch-all branch for an input it does not describe.
- A port whose only method returns a constant.
- A suffix doing a folder's job.
- A new type for what a method on an existing type could carry.
- A module whose only consumer is one other module, with no second
  constructor and no algebra of its own.
- A second endpoint's parsing or refusals inside what its endpoints share.
