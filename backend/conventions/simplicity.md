# What a diff does not add

Applies to: **every diff under `backend/`**. One sentence, and the rest of this
document is the shapes it took after it was broken: **the burden of proof is on
what is added, and it is discharged against the problem being solved today**.
"It might one day" does not discharge it.

Every case below was written, reviewed, shipped, and then removed: six commits
of subtraction under `backend/`, none of them changing behaviour. The yardstick
caught not one, and where a judge did reach one it reached it as a missing test
— which is the opposite repair, and is how several of these grew.

**Nothing here authorises skipping a layer.** The three layers, the ports, the
value objects and the direction of the dependencies are how this backend is
built, not complexity to trim. What is trimmed is what defends against what
cannot happen.

## The guard lives where the value enters from outside

A value this code composes itself gets none. `domain.md` says which values are
validated in the value object — the ones that cross into an argv, because of
where they end up — and this is its converse, written down because that silence
was read as licence:

- `bin`, a constant that never varies, got a shape, a duplicated example and
  three tests.
- `PlanBriefing` got guards on `located` and `issue`, which `StartPlan` composes
  from its own ports.
- `WorkspaceLocation` got guards on values `GitWorkspace` builds itself.
- `ImplementRequest`'s constructor got five `throw`s no real call can reach: its
  three factories are the only constructors and they already satisfy those
  invariants.

The check happens once, where the outside value arrives: the factory that reads
the request, the value object that will end up in an argv. Downstream of that
point every caller is our own code, and a second check there guards nothing.

## A field, a branch and a public symbol answer to a call that exists

Not to one that could exist. `repo` crossed the request, the use case, the port,
the adapter and the errand, and its whole use was one clause of a text that
`ct-step`, `gh pr create` and the tab's name never needed. `ImplementRequest`
was exported with no importer, `isWellFormedIssue` was public with one internal
caller, `implementPlan` carried a default nobody passes.

The question is never whether it might be needed. It is which call breaks
without it.

## An unreachable check is not a check

`#forget`'s guard protected the registry from a dead loop deleting another
entry under the same key — a key that cannot repeat, because every `/start-plan`
opens a new issue. It got there as the fix to a finding that said nothing
measured that guard: moved into a private method, nothing measured it there
either, and the path that needed it already had a public method that was
measured.

That is where the mutation sweep points: the surviving mutation was the line,
not a missing test. Which of the two it is in any given case, `testing.md`
decides — it owns the sweep and what is left unmeasured.

## Observability answers to a reader who exists

The plan's progress trace printed some 3,000 identical lines headed
`dispatch-check failed` while the agent was writing its plan — exit 6 is the
expected state for all that time, not a failure — and the text it poured ("fix
the plan and try again") spoke to a reader the server log does not have. It left
with six tests and with the injected stderr writer that existed only for it.

A log line, a metric, a field in an answer: name who reads it and what they do
differently for having read it. The failure that mattered, not being able to
ask, already travelled typed to the client.

## A request from a review or a judgement is not exempt

The burden of proof does not move when the addition is asked for by a reviewer,
a verifier or a judge. Every guard in the first section arrived that way, and
none of them was wrong on its own; together they made the solution bigger
without solving anything. Complying with a review costs less than answering it,
which is why this rule is written here instead of being left to whoever is
implementing.

Where the burden cannot be discharged, the request goes back as a finding for a
human to decide, and is not implemented meanwhile.

## What other documents own, and this one does not repeat

- A **new type or a new module**: `architecture.md` — the default answer to new
  behaviour is a method on a type that already exists.
- A **guard no use case can reach**, and what is left unmeasured on purpose:
  `testing.md`.
- **Markers, budgets and retries nobody measured**: `infrastructure.md`.

## Antipatterns

- A guard on a value this code composes.
- A `throw` in a constructor whose every caller is a factory in this repository.
- A field crossing a layer to serve one clause of a text.
- An `export`, a public method or a default with no caller.
- A check on a state the code cannot reach, with a test that measures the
  language.
- A log line, a trace or a field of an answer with no reader named.
- An addition implemented because a review asked for it, with the burden of
  proof undischarged.
