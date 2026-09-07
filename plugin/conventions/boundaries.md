# The outer edge

Applies to: **every diff**.

The edge is where this program stops and something it does not control begins.
What a field crosses inside is a layer (`conventions/architecture.md`); what
crosses the edge is this document's subject.

## Talking to an external system

- **The failure of the external system is data, not an exception**, and it gets
  interpreted: the exit code of a process, the status and body of a response,
  the error a driver hands back. The reason travels on that system's own
  diagnostic channel, and a throw at the call site erases it.
- **The caller declares whether its call is safe to repeat.** A read is; a
  creation is not: a lost answer may be one that already created the thing, and
  the retry creates a second. Only transient failures of repeatable calls are
  retried, on the policy's budget.
- **No external system is called without a cap**, and
  **the adapter does not choose the cap**: it arrives through the constructor with
  no default, because applying one is this layer's work and choosing it is
  policy — the time a call may take, the time a query may hold a lock. On
  exhaustion it fails closed and what was half written is discarded.
- **The trunk knows the network's idiom; the subclass knows the tool's.** A
  reset connection, a timeout, a name that does not resolve, a server error:
  measured once in the shared type. What only one system writes lives in its own
  subclass, and a system with no measured idiom inherits the trunk bare —
  inventing markers nobody measured is a preference dressed as a rule.
- **A rate limit is not a blip.** A system documenting a wait of a minute or
  more is not retried on the transient cadence: that lengthens the block instead
  of clearing it, so it stays out of the transient markers.

## Boundary models

- **The conversion to the domain lives in the boundary model, with one door**:
  what the other side sent goes in, the domain object comes out, and back the
  same way; a model that leaves the adapter to map field by field is that type
  written twice. The same conversion lives there both ways, never as a
  mapping helper inside a use case.
- **You enter by the contract's name, not by the field's name**, and everything
  the other side sees comes from there: the schema sent to it, the validation of
  what it returns, and what gets emitted.
- **What comes from outside is validated on entry, with no exceptions and no
  forced cast**: a cast checks nothing, it only silences the type checker.
- **An unknown key is a rejection, not a field to ignore**: the other side
  changed shape and our assumptions may be stale.
- **Project only the keys you consume**, and a foreign format with an open
  vocabulary is **validated by projection**: rejecting unknown keys over the
  whole object breaks the read with every field the other side adds, which is
  that reader's whole job. Project by hand a structure with exactly the keys
  you consume and validate that, still rejecting the unknown inside it. A key we
  declared that arrives missing or wrongly typed still breaks the read, quoting
  the other system's own words; an input that is not the expected format is
  corruption and raises.
- **How tight to validate a field:** what wrong value would pass for good, and
  what decision would be taken with it? "None that matters" licenses lax.
- **A validation error does not leave the boundary layer**: it is translated to
  the domain error the outer edge knows how to map.
- **An adapter is named after its implementation, not after its port**, so the
  pair reads in the name and two implementations fit without renaming anything.
- **An adapter does not decide policy** — retries, budgets, what to do with a
  failure and what it costs.
- **Text from another system gets its active syntax quieted** before it enters
  a document of a third one. Measured: a description carrying `#7` autolinked
  our record into a stranger's timeline, and an `@handle` would have notified a
  person. What was already quoted stays; an address does not split at its `@`.

## Answering outwards

- **The projection from the domain's vocabulary outwards
  is exhaustive and returns a value object** (`conventions/defects.md`): a member
  nobody mapped raises instead of being guessed. The two causes a failure family
  separates (`conventions/domain.md`) reach two codes, because they are repaired
  in different places.
- **The code of an answer is declared explicitly, beside its detail, and
  never derived from an exception's class name**: that would wire the answer to
  a name living in the domain, so renaming the exception would silently change
  what the caller receives.

## The outer edge of the program

- **It is the only place that assembles the dependency graph**: it picks the
  concrete adapters and injects them. There is no injection container — one
  adapter per port — and the test seam is the constructor.
- **It translates the domain's errors into the vocabulary of whoever invoked
  the program**, and that vocabulary has two shapes. In **a program that ends**
  it is the exit code, the result on the standard channel and the diagnosis on
  the error channel, always separate; in **a service that answers** it is the
  response, and the translator is called a handler — the one place that maps a
  domain error to an answer, and nothing else answers outwards.
- **One code per decision of whoever receives, not one per error.** The
  yardstick is what the receiver does differently: exit codes and the codes of a
  response are counted the same way.

## Antipatterns

- A cast at the boundary.
- A boundary model that ignores unknown keys.
- An adapter that decides policy.
- A call to an external system with no cap, or an adapter that picks its own.
- A validation error leaving the boundary layer.
- A catch around a call whose failure already comes back as data.
- A non-idempotent write declared safe to repeat.
- Outside text reaching another system's document unquieted.
