# Defects no diff may introduce

Applies to: **every diff**, with no exemption.

This document is part of ct's yardstick, which travels with the plugin. How it
relates to the conventions of the repository you are working in is stated in the
header of the block that carried it here.

Its companion `conventions/style.md` grants a **declared debt** exemption to a
module that was already there: what you add to such a module may follow the style
of its host. **That exemption stops at this document.** Every rule below binds on
every diff, in a module born today and in one that was already there, because
none of them is a matter of how the code reads. Each one leaves representable a
state that the rest of the code then has to defend against, or hides from the
consumer a distinction it needed to see.

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
  member fails visibly — where the language allows it, at compile time or by the
  type checker; where it does not, in the test that covers that dispatch —
  instead of falling silently into the default branch.

## No raw map as the return value of logic

A map that crosses two of your own functions gets read by key lookup in the
consumer, and there a misspelled key and an absent one are the same thing. A raw
map is a serialization boundary, never the return value of logic.

**The boundary is the last step before the wire, and it is one step.** That the
consumer will eventually serialize does not make a raw map its legitimate input.
A module that receives a map and still decides anything with it — which key to
file it under, whether to include it at all, what to do when it is empty — is
logic reading a map by key lookup, and that is this defect however close to the
wire it sits.

## Two fields that have to agree

Two fields that have to agree leave the state that must not exist representable;
one field makes it impossible. Where a flag says the same thing as the
non-emptiness of a value, the flag goes and the answer is derived — so a run that
dies halfway cannot resume asserting something it does not have.

**A sentinel value is that second field wearing the first field's clothes.** The
empty string standing for "no message", zero standing for "never happened", a
date in 1970 standing for "unset": each one spends a value the vocabulary needed
and leaves every consumer to remember the convention. The absence goes in the
type, where the consumer cannot forget it.

## Errors are named for what happens, not for where

A hierarchy only where the consumer needs to tell two cases apart. An error
inherits from the type that fits it, not from the root error type.

## Antipatterns

- A string compared by hand where a closed vocabulary belongs.
- A boolean where the consumer needs to tell two states apart.
- An optional standing in for an absent member of a vocabulary.
- A catch-all branch in a dispatch over a closed vocabulary.
- A raw map returned by logic, or handed to a module that still decides with it.
- A flag that repeats what another field already says.
- A sentinel value standing for an absence the type could have carried.
- An error named for the module that raised it.
