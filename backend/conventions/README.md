# The backend's yardstick

What binds in `backend/` and in what order. Written because the harness that
writes this code cannot learn: a convention that is not loaded into the session
measures nothing, so these documents exist to be Read before writing code, not
after.

## Precedence

1. `backend/conventions/` — this folder: what is specific to the backend.
2. `plugin/conventions/` — the repository's yardstick: style, defects,
   architecture, decisions, testing. It binds on every diff here too, and this
   folder never restates it: a rule written twice is already the defect.
3. The `backend-best-practices` skill — general guidance; it yields to both.

## What to load, by task

| Task | Read |
|---|---|
| Any diff | `plugin/conventions/style.md`, `plugin/conventions/defects.md` |
| A new module or moving one | `architecture.md` here, `plugin/conventions/architecture.md` |
| Touching `domain/` | `domain.md` here |
| An adapter, a boundary, an endpoint | `infrastructure.md` here |
| Writing or judging tests | `testing.md` here, `plugin/conventions/testing.md` |
