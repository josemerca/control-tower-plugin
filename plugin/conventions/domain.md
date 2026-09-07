# The domain and its words

Applies to: **every diff** — the rule about names binds wherever a domain word
is chosen, not only inside the domain layer.

## The domain does not speak any tool's language

The port declares what the domain needs, not what the adapter knows how to do
— and the name is where that rule is won or lost. Both defects this document
exists to prevent were shipped and had to be renamed:

- A type named for what a session-launching tool hands out, when the domain
  needed *someone to plan*.
- A type named for what an issue tracker sells, when the domain needed *the
  story to plan*.

The test: if swapping the adapter for another implementation
makes the name a lie, the name belongs to the adapter, not to the port.

## One port per collaborator, growing with methods

The port cuts by **who is on the other side**, never by step of the flow.
When the flow gains a step against a collaborator it already has, the port
gains a method; a port per step would multiply seams without adding one thing
that can be swapped.

**A collaborator is identified by what is asked of it, not by the executable
or the service that answers.** Two ports that end up reaching the same
system are one collaborator only if they ask it the same thing; when the
questions are different, they are two, and folding them into one port with
two methods would join what has nothing to share but where it lives. What
may never be duplicated is the intent: the same question asked from two
places, or the same rule decided twice (`conventions/decisions.md`).
Repeated shape is not the subject; repeated intent is.

## Value objects

Frozen at construction, and guarding, for themselves,
**what makes them this value and not any value**: the shape they demand,
quoting what they got. That guard is the whole point of the type — it is
what makes a broken one impossible to construct, so no consumer downstream
has to wonder — and it stays even on the day every caller already satisfies
it.

What does not belong inside is the check that
**re-verifies what another type already guarantees** — whether the value
received is an instance of the value object the caller had to build in
order to call at all. That one adds no invariant, because the type it asks
about already carries it. The line is which invariant is *this* type's own:
guard that one, and only that one. What happens downstream of a door is
`conventions/simplicity.md`'s business.

## Exceptions: families of two causes

A family of errors around one collaborator separates the two things it can
do wrong, because they are repaired in different places: the call itself
failed, with the reason on its own error channel, and it answered something
we cannot read, meaning our contract with it broke. A caller that does not
care catches the family; projecting each cause outward to its own signal is
`conventions/boundaries.md`'s work.

## Antipatterns

- A tool's noun in a port, a value object or an exception.
- A port whose method list mirrors a tool's own list of operations.
- A new step of the flow arriving as a new port against an old collaborator.
