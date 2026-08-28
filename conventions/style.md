# How code is written here

Applies to: **every diff**.

This document is part of ct's yardstick, which travels with the plugin. How it
relates to the conventions of the repository you are working in is stated in the
header of the block that carried it here.

A module that was already there and does not conform is the repository's
**declared debt**, and the debt is exactly as wide as this document's three
rules: no prose, the language its identifiers are written in, and that every
function hangs off a type. What you add to such a module may follow the style of
its host there, and that is not a finding — half a migration reads worse than
none. **The exemption ends at this document**: the rules of
`conventions/defects.md` bind on every diff, old module and new alike.

The hole that exemption opens is closed in the same breath, because otherwise
the cheapest way to dodge this document is to write new code inside an old
file: **a new concept is a new module and is born conforming.** Sheltering
under the host's style covers only what genuinely extends what was already
there; placing a new concept inside an old file to inherit the exemption **is**
a finding.

## No prose in the code

No comments and no docstrings. If a piece of code cannot be understood without a
paragraph beside it, the fix is the code: names that say what they do, small
functions with one responsibility, types that make misuse impossible, named
constants instead of literals.

A conditional that needed three lines of explanation is almost always a named
function waiting to be born, and an invariant explained in prose is almost always
a missing test.

## Code is written in English

File and module names, types, functions, methods, variables, parameters,
constants, vocabulary members, errors, test names, and diagnostic or log
messages. The one exception is a value fixed by an external contract, which
keeps the spelling that contract gives it.

**This does not cover text an end user reads.** Product copy, labels, and any
message surfaced in a user-facing interface are not this document's business:
their language is the product's decision, not this rule's.

## No free function at module level: every function hangs off a type

Method, class method or static method, the entrypoint included. What was a
handful of private module functions plus a few loose constants is almost always a
type waiting to be born, and naming it is what says whose logic that is.

This is not cosmetic. A handful of loose functions that were really one piece
hides that the piece is missing an argument it needs to do its job. Named, the
absence shows.

## Antipatterns

- A comment or a docstring explaining code that could be renamed. **Rewrite the code.**
- An identifier in a language other than English that is not contract data.
- A function at module level. **Find its type.**
