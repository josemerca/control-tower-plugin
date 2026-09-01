# What a test pins

Applies to: **every diff**.

## No prose here either

Test code follows `conventions/code.md` like any production code, no-prose rule
included. What is specific to a test: **its name is the sentence**, and it says
what is guaranteed and why, not which method is called:
`a_finding_without_a_line_leaves_the_key_out_instead_of_emitting_null`, not
`finding_is_serialised`.

Test helpers hang off their test type, like any other function. What several test
types of the same module share lives in a type they inherit from, not in a loose
function and not in a shared module imported from one place only.

## The objects a test needs are built by a mother

A mother gives sensible defaults and lets each test name **only what its case
changes**, which is what makes the assertion readable. Without them the same
object gets copied into two files with different values and neither says why.

Its methods are **named scenarios**, not one builder with everything defaulted,
so the test says which case it is about without reading the arguments.

## What the assertion is on

- **The observable effect**: what the port received, what the use case returned.
- **At a boundary, the literal payload** sent or received, not a model of it
  reimplemented in the test. Comparing against your own model of the format is
  rewriting the mapping and approving it by construction.

## Doubles

- **A double doubles what its name says and nothing more.** If one port serves
  two consumers, the double intercepts one and lets the other through for real.
  One that answered any input with the other's answer would make the test pass or
  fail for the wrong reason.
- **A double of a whole conversation answers by what it is asked, not by order**,
  and **raises when nobody wrote an answer** for a request. That is what makes
  "it does not repeat work already done" checkable: if it repeated, the double
  would not have to answer and the test falls with the request in front of you.
- **Values are not doubled**: real instances.
- **The arrange is not built with the piece under test.** The state an adapter is
  going to read is set up with the real tool, not with the adapter itself.

## What gets tested, and what does not

- **Outside-in, in this order**: first the application layer with the ports
  doubled, then infrastructure. What is inside the domain is covered **along that
  path**, not with tests of its own. The one exception is a value with validation
  of its own that cannot be reached any other way.
- **A test that only checks that a data holder stores what you passed it measures
  the language, not the code.**
- **Before adding a test, check whether the behaviour is already covered.** It
  only goes in if it adds a distinct dimension.
- **A test that launches a real subprocess is marked as such**, so a fast subset
  exists. The marker shortens the loop, not what is required.

## An assertion is not finished until it has been seen to fail for the reason its name gives

Break by hand the one thing the assertion says it protects — remove the sentence,
invert the condition, delete the line — run it, confirm it turns red, and restore it.

This is not the red phase of the cycle. The red phase proves a test fails when the
behaviour is missing. This proves a test fails when the concrete thing its name
promises is broken. They part where it matters: a test can pass its red phase and
still be weaker than its own name, because it goes green with the protection
removed and the rest of the text untouched.

It bites hardest on an assertion over a document or a piece of text, where the
subject is one sentence among many others, and on an assertion that matches loose —
a substring, a word that also shows up elsewhere, a count of elements — when the
distinctive sentence was there to use instead.

When the two do not agree, fix it: if the name says a rule declares something and
the assertion is satisfied by something that is not the declaration, either the
name changes or the assertion changes — and it is almost always the assertion that
is wrong, because the name says what the test actually meant to protect.

Whoever writes the assertion runs it. Whoever judges the diff has nothing to run it
with, so applies this by reading: ask whether that assertion could fail for the
reason its name gives, and if it could not, that is the finding.

## Antipatterns

- A test named after the method it calls.
- A test helper at module level, or repeated in two files.
- An object built by hand in the test when a mother exists, or the mother's
  constants duplicated in the test.
- An assertion against a reimplemented model of the format instead of the literal
  payload.
- An arrange built with the piece under test.
- A doubled value.
- A test of the domain reachable from the application layer.
- A test that launches a real subprocess without its marker.
- An assertion that stays green once the one thing it names has been broken by hand.
