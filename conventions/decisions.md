# Where a decision lives

Applies to: **every diff**.

A business rule is written **once**, and the first copy is already the defect. No
threshold authorises it, because what breaks is not tidiness, it is coherence.

Two similar pieces of code that drift leave ugly code. Two places that decide the
same thing and drift leave a program that contradicts itself, and the symptom
does not appear where the copy is — it appears where someone believed it.

## The yardstick

**If this decision changed, how many files would have to be touched for the
program to stay coherent?** One, or it is spread.

Ask it about the change, not about the text. Two places that today say the same
thing in different words are already spread, which is why the yardstick cannot be
resemblance: no duplicate detector pairs them.

## What does not count

The idiom of a boundary is not a rule. Checking an exit code in every adapter
that launches a process, or the shape of an envelope in every model that
validates one, is the same sentence, not the same decision, and each place
answers for its own.

The question that separates them: **is there a business change that forces
touching both at once?** If there is not, it is idiom, and the rule of three
applies to it — extract when extracting leaves the place better, and waiting
until then is correct.

## What does not fix it

- **A helper both copies call from where they were.** The decision is still
  spread, now with an indirection in front of it.
- **A field without its question.** Whatever holds the data owns the question. If
  every consumer derives the condition by hand from a field, the rule is spread
  among them even though the field lives in one place: the field is not the
  decision.

## When the copy is unavoidable

The two halves of a contract that crosses a process boundary have to exist twice.
There the copy is **declared and measured with a test that compares the two**, so
that rewriting both passes and touching one fails. What is not acceptable is
leaving it implicit: a copy nobody compares will drift, and the only difference
from the case above is that this one was known.

## Why this is a convention and not a linter

Because this code is written by a harness that **cannot learn**. Every invocation
starts with no memory of the previous ones, so when it needs a rule that already
exists in another file it does not reuse it — it does not know it is there — it
derives it again where it needs it.

What that produces is not literal copies, it is different wordings of the same
decision, and no tool pairs them by shape. The only place it can be caught is
when someone writes the second one, with the question about the change in front
of them.

## Antipatterns

- A business rule written in two places, **even when the two wordings differ**.
- The same partition of a closed vocabulary declared in more than one place. An
  exhaustive dispatch does not protect against this: it forces you to mention a
  new member, not to classify it the same way everywhere.
- A helper both copies call from where they were.
- Something that holds the data and not the question, with every consumer
  formulating it by hand.
- An unavoidable copy of the two halves of a contract with no test comparing them.
