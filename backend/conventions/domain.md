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

## Ubiquitous language

| Term | Meaning |
|---|---|
| **User story** | What Jira calls a ticket: the work to plan, identified by its key (`ABC-123`) |
| **Plan issue** | The GitHub issue that hosts a plan: the plan is posted there, the GO is answered there, the dispatcher reads its labels |
| **Plan agent** | Whoever writes the plan for a story; today a Claude in a cmux tab |
| **GO** | The human's `-OK <nonce>` on the issue that releases the agent |
| **Repository name** | `owner/name`; validated because it becomes an argument of `gh` |

## Value objects

Frozen at construction, guards that name the shape they demand and quote what
they got (`a user story key looks like ABC-123, got "nope"`). A value that
crosses into an argv is validated here precisely because of where it ends up:
the shape of `RepositoryName` exists to make `-o`, `..` and whitespace
unrepresentable before `gh` ever sees them.

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
