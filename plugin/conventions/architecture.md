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
  side.

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
  catch errors to turn them into exit codes, and it does not decide retry or
  budget policy.
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

## The boundary

- **What comes from outside is validated on entry, with no exceptions and no
  forced cast**: a cast checks nothing, it only silences the type checker.
- **An unknown key is a rejection, not a field to ignore.** It means the other
  side changed shape and our assumptions may be stale.
- **You enter by the contract's name, not by the field's name**, and everything
  the other side sees comes from there: the schema sent to it, the validation of
  what it returns, and what gets emitted.
- **A foreign format with an open vocabulary is validated by projection.** When
  what arrives is not a contract this program defines, rejecting unknown keys
  over the whole object breaks the read with every field the other side adds,
  which is the very job that reader has. Project by hand a structure with exactly
  the keys you consume and validate that, still rejecting the unknown. A key you
  do claim to know that is missing or arrives with the wrong type still breaks.
  And an input that is not the expected format is corruption, not one more
  variant: it raises instead of being swallowed.
- **How tight to validate a field:** what wrong value would pass for good, and
  what decision would be taken with it? If the answer is "none that matters", lax
  is fine.
- **The conversion to the domain lives in the boundary model**, both ways. Never
  a mapping helper in the use case.
- **A validation error does not leave the layer**: it is translated to the domain
  error the entrypoint knows how to map.
- **An adapter is named after its implementation, not after its port**, so the
  pair reads in the name and two implementations fit without renaming anything.
- **An adapter does not decide policy** — retries, budgets, what to do with a
  failure.
- **No call to an external process is launched without a cap, and the adapter
  does not choose the cap**: it arrives through the constructor with no default,
  because applying a cap is this layer's work and deciding which one is policy.
  On exhaustion it fails closed and whatever the process had written is
  discarded: half an answer is not an answer.
- **A non-zero exit code is data, not an exception**: it gets interpreted,
  because the reason is on the diagnostic channel and an exception erases it.
- **A port for a constant value is indirection; an invariant among several values
  asks for an object.**

## The entrypoint

- **It is the only place that assembles the dependency graph**: it picks the
  concrete adapters and injects them. There is no injection container — one
  adapter per port — and the test seam is the constructor.
- **It maps the domain's errors to exit codes**, with the result on the standard
  channel and the diagnosis on the error channel, always separate.
- **One code per decision of whoever invokes, not one per error.** The yardstick
  is what the receiver does differently.

## Antipatterns

- A new concept placed inside a non-conforming old file to inherit its exemption.
- The domain importing from application or from infrastructure.
- A use case importing from infrastructure, or depending on an adapter.
- A use case with a suffix on its type, its parameters or its result.
- A mapping helper in the use case instead of in the boundary model.
- A conditional in the conductor that translates a step's result.
- A policy that returns a boolean instead of the whole effect.
- A policy with a catch-all branch for an input it does not describe.
- A cast at the boundary.
- A boundary model that ignores unknown keys.
- An adapter that decides policy.
- A call to an external process with no cap, or an adapter that picks its own.
- A validation error leaving the boundary layer.
- A port whose only method returns a constant.
