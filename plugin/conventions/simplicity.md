# What a diff does not add

Applies to: **every diff**.

One rule, and the rest of this document is the shapes it takes: **the burden of proof is on what is added, and
it is discharged against the problem being solved today**. "It might one day"
does not discharge it.

**Nothing here authorises dropping a layer.** The layers between the parts
of a system, the ports between them and the value objects are how a system
is built, not complexity to trim. What is trimmed is what defends against
what cannot happen.

## The guard lives where the value enters from outside

The check on what a value carries happens once, at the door the outside value
arrives through: the shape that reads a request, the type built from what an
external answer printed. Downstream of that door every caller is code this
diff already trusts, so a second opinion about the same content defends
against a caller that does not exist. The question is not where the value came
from but whose responsibility this is: the thing built at the door owns its
own check, and forms no second opinion about a value another part of the
system already vouched for. The guard a value object keeps for itself, once
it exists, is `conventions/domain.md`'s business, not this one's.

## A field, a branch and a public symbol answer to a call that exists

Not to one that could exist. A field that crosses a layer, a parameter with a
default, a branch for a state, a method made public, an export: each is
justified by a caller that exists today and by nothing else. What is added
for a consumer that has not arrived is carried by every layer it crosses
until someone removes it, and that someone has to prove first that nobody
uses it.

The question: **which call breaks without it?** Name it. If none does, it goes.

## An unreachable check is not a check

A condition on a state that cannot occur — a key that cannot repeat, a value
that cannot be missing at that point, a case the branch beside it already
handles — protects nothing and reads as if it did. A surviving mutant at that
line has two possible repairs, not one: the test nobody wrote, or the line
nobody needs. Which of the two, `conventions/testing.md` decides.

## Observability answers to a reader who exists

A log line, a metric, a trace, a field in an answer: each names who reads it
and what they do differently for having read it. A line nobody reads is noise
in the channel of the lines someone does read. What exists only to produce
it — the wiring built for it, the checks written against it — leaves with it.

The question: **who reads this, and where?**

## A request from a review or a judgement is not exempt

The burden of proof does not move when the addition is asked for by a reviewer,
a verifier or a judge. Nothing about a review makes a guard reachable or gives
a field a caller. A review that looks for what is missing finds it, and
complying costs less than answering — which is how these accumulate, each one
reasonable on its own.

Where the burden cannot be discharged, the request goes back as a finding for a human to decide, and is not implemented meanwhile.

## What other documents own, and this one does not repeat

- A **new module**: `conventions/architecture.md`.
- **What a check is missing, and what is left unmeasured on purpose**:
  `conventions/testing.md`.
- **What the door itself owes to what arrives through it**:
  `conventions/boundaries.md`.
- **What the plan asked for is a different question from this one.** That
  question is about the sentence a task traces back to; this one is about the
  caller that would break without the addition. A plan can ask for a field
  that no caller in the tree uses — that gap is measured here, not there.

## Antipatterns

- A second check on what a value carries, downstream of the door it came in by.
- A field crossing a layer with no consumer at the other end.
- A public symbol, a parameter or a default with no caller.
- A condition on a state that cannot occur, with a check that can only fail if
  the layer above it changes.
- A log line, a trace or a field of an answer with no reader named.
- An addition implemented because a review asked for it, with the burden of
  proof undischarged.
