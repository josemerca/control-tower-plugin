# The backend's domain

Applies to: **every diff under `backend/`** — the rule about names binds wherever a domain word is chosen, not only inside `src/domain/`.

## The domain does not speak any tool's language

The port declares what the domain needs, not what the adapter knows how to do
— and the name is where that rule is won or lost. Both defects this document
exists to prevent were shipped and had to be renamed:

- `PlanSession` named what cmux hands out; the domain needed *someone to plan*
  → `PlanAgents.launch()`.
- `Ticket` named what Jira sells; the domain needed *the user story to plan*
  → `UserStory`, `UserStories.detail()`.

The test: if swapping the adapter for another implementation makes the name a
lie, the name belongs to the adapter, not to the port. Jira, GitHub, cmux,
acli and gh exist only in `infrastructure/`.

## One port per collaborator, growing with methods

The port cuts by **who is on the other side**, never by step of the flow.
When the flow gains a step against a collaborator it already has, the port
gains a method; a port per step would multiply seams without adding one thing
that can be swapped.

**A collaborator is identified by what is asked of it, not by the executable
that answers.** Two ports that end up launching the same binary are one
collaborator only if they ask it the same thing; when the questions are
different — whether a merged slice can be collected, whether a plan meets its
contract — they are two, and folding them into one port with two methods
would join what has nothing to share but a path on disk. What may never be
duplicated is the intent: the same question asked from two places, or the same
rule decided twice (`conventions/decisions.md`). Repeated shape is not the
subject; repeated intent is.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **User story** | What Jira calls a ticket: the work to plan, identified by its key (`ABC-123`) |
| **Plan issue** | The GitHub issue that hosts a plan: the plan is posted there, the GO is answered there, the dispatcher reads its labels |
| **Plan agent** | Whoever writes the plan for a story; today a Claude in a cmux tab |
| **GO** | The human's `-OK <nonce>` on the issue that releases the agent |
| **Repository name** | `owner/name`; validated because it becomes an argument of `gh` |
| **Prepared workspace** | A worktree `.worktrees/<n>` on branch `feat/<n>` that a plan agent works in |
| **Harvest** | Collecting what a delivered slice left behind — its worktree, its branch, its agent — once its pull request merged; the plugin's `dispatch-check --collect` does it, the backend only decides when |

## Value objects

Frozen at construction, and **guarding whatever it is that makes them this
value and not any value**: the shape they demand, quoting what they got
(`a user story key looks like ABC-123, got "nope"`). That guard is the whole
point of the type — it is what makes a broken one impossible to construct, so
no consumer downstream has to wonder — and it is never the defensive extra that
`conventions/simplicity.md` refuses. A value that crosses into an argv is
guarded here precisely because of where it ends up: the shape of
`RepositoryName` exists to make `-o`, `..` and whitespace unrepresentable
before `gh` ever sees them.

What does not belong inside is the check that **re-verifies what another type
already guarantees** — whether the value received is an instance of the value
object the caller had to build in order to call at all. That one adds no
invariant, because the type it asks about carries it. The line is which
invariant is *this* type's own: guard that one, and only that one. What happens
downstream of a door is `conventions/simplicity.md`'s business, and two fields
that have to agree are `conventions/defects.md`'s.

## Exceptions: families of two causes

Every family under `PlanFailure` separates the two things a tool can do wrong,
because they are repaired in different places: **the command failed** (`*NotRead`,
`*NotCreated`, `*NotLaunched` — the reason is in its error channel) and **it
answered something we cannot read** (`*NotUnderstood`, `*NotNamed` — our
contract with the tool broke). A caller that does not care catches the family;
the boundary projects the two causes to different statuses.

## Antipatterns

- A tool's noun in a port, a value object or an exception.
- A port whose method list mirrors a CLI's subcommands.
- A new step of the flow arriving as a new port against an old collaborator.
