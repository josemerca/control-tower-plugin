# What a diff does not add

Applies to: **every diff under `backend/`**. One rule, and the rest of this
document is the shapes it takes: **the burden of proof is on what is added, and
it is discharged against the problem being solved today**. "It might one day"
does not discharge it.

Every rule here was paid for: each was broken in this backend, shipped, and
removed later with no behaviour changed. The cases live in the history and in
the pull requests that added them; this document keeps the rule and the question
that decides it, which is what does not go stale.

**Nothing here authorises skipping a layer.** The three layers, the ports, the
value objects and the direction of the dependencies are how this backend is
built, not complexity to trim. What is trimmed is what defends against what
cannot happen.

## The guard lives where the value enters from outside

The check on what a value **carries** happens once, at the door the outside
value arrives through: the model that reads the request, the type built from
what a tool printed. Downstream of that door every caller is our own code, and
a second opinion about the same content defends against a caller that does not
exist — and brings tests that can only fail if the language does.

**This is not the invariant a type keeps for itself.** `domain.md` says which
guard belongs inside a value object: the one that makes it that value and not
any value, so that a broken one cannot be constructed at all. That guard is the
type's reason to exist, and it stays whether or not today's callers already
satisfy it — the day one of them stops satisfying it is the day it earns its
keep, and by then nobody is reading this document. What does not belong there
is the check that re-verifies what the type of its own argument already
guarantees.

The question, then, is not where the value came from but **whose invariant this
is**: the type being built keeps its own, and forms no second opinion about a
value another type already vouched for.

## A field, a branch and a public symbol answer to a call that exists

Not to one that could exist. A field that crosses a layer, a parameter with a
default, a branch for a state, a method made public, an `export`: each is
justified by a caller in the tree today and by nothing else. What is added for a
consumer that has not arrived is carried by every layer it crosses until someone
removes it, and that someone has to prove first that nobody uses it.

The question: **which call breaks without it?** Name it. If none does, it goes.

## An unreachable check is not a check

`testing.md` already says a guard no use case can reach is not a test waiting
to be written. The other half: it is not a guard waiting to be kept either. A
condition on a state the code cannot reach — a key that cannot repeat, a value
that cannot be null on that line, a case the branch beside it already handles —
protects nothing and reads as if it did, so the next reader defends against the
same ghost. The mutation sweep is where these surface, and a surviving mutation
has two possible repairs, not one: the test nobody wrote, or the line nobody
needs. Which of the two, `testing.md` decides.

## Observability answers to a reader who exists

A log line, a metric, a trace, a field in an answer: each names who reads it and
what they do differently for having read it. A line nobody reads is noise in the
channel of the lines someone does read, and a message written for a reader who
is not at that channel reaches nobody. What exists only to produce it — a writer
injected for it, its tests — leaves with it.

The question: **who reads this, and where?**

## A request from a review or a judgement is not exempt

The burden of proof does not move when the addition is asked for by a reviewer,
a verifier or a judge. Nothing about a review makes a guard reachable or gives a
field a caller. A review that looks for what is missing finds it, and complying
costs less than answering — which is how these accumulate, each one reasonable
on its own, and why this is written here instead of left to whoever is
implementing.

Where the burden cannot be discharged, the request goes back as a finding for a
human to decide, and is not implemented meanwhile.

## What other documents own, and this one does not repeat

- A **new type or a new module**: `architecture.md`.
- The **guard a value object keeps for itself**: `domain.md`.
- A **guard no use case can reach**, and what is left unmeasured on purpose:
  `testing.md`.
- **Markers, budgets and retries nobody measured**: `infrastructure.md`.

## Antipatterns

- A second check on what a value carries, downstream of the door it came in by.
- A check in a constructor that re-verifies what the type of its argument
  already guarantees.
- A field crossing a layer with no consumer at the other end.
- An `export`, a public method, a parameter or a default with no caller.
- A condition on a state the code cannot reach, with a test that can only fail
  if the language does.
- A log line, a trace or a field of an answer with no reader named.
- An addition implemented because a review asked for it, with the burden of
  proof undischarged.
