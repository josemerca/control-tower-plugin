# How code is written here

Applies to: **every diff**.

This document is part of ct's yardstick, which travels with the plugin. How it
relates to the conventions of the repository you are working in is stated in the
header of the block that carried it here.

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
constants, vocabulary members, errors, test names, and the messages a person
reads. The one exception is a value fixed by an external contract, which keeps
the spelling that contract gives it.

## No free function at module level: every function hangs off a type

Method, class method or static method, the entrypoint included. What was a
handful of private module functions plus a few loose constants is almost always a
type waiting to be born, and naming it is what says whose logic that is.

This is not cosmetic. A handful of loose functions that were really one piece
hides that the piece is missing an argument it needs to do its job. Named, the
absence shows.

## Closed vocabulary instead of loose strings and booleans

A value that classifies something is a member of a closed vocabulary, not a
string compared by hand.

- **An answer carries the vocabulary, not a boolean derived from it.** A boolean
  collapses states that get fixed differently, and its consumer cannot separate
  them again.
- **An absent state is a member of the vocabulary, not an optional.** Declaring
  it inside the vocabulary is what keeps a defensive branch out of every place
  that touches the value.
- **Dispatch over it exhaustively, with no catch-all branch**, so that adding a
  member breaks the build instead of falling silently into the default.

## No raw map as the return value of logic

A map that crosses two of your own functions gets read by key lookup in the
consumer, and there a misspelled key and an absent one are the same thing. A raw
map is a serialization boundary, never the return value of logic.

## Two fields that have to agree

Two fields that have to agree leave the state that must not exist representable;
one field makes it impossible. Where a flag says the same thing as the
non-emptiness of a value, the flag goes and the answer is derived — so a run that
dies halfway cannot resume asserting something it does not have.

## Errors are named for what happens, not for where

A hierarchy only where the consumer needs to tell two cases apart. An error
inherits from the type that fits it, not from the root error type.

## Antipatterns

- A comment or a docstring explaining code that could be renamed. **Rewrite the code.**
- An identifier in a language other than English that is not contract data.
- A function at module level. **Find its type.**
- A string compared by hand where a closed vocabulary belongs.
- A boolean where the consumer needs to tell two states apart.
- An optional standing in for an absent member of a vocabulary.
- A catch-all branch in a dispatch over a closed vocabulary.
- A raw map returned by logic.
- A flag that repeats what another field already says.
