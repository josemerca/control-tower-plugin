# Fork de superpowers — origen y costuras

Los skills de este directorio (salvo `state-template`, que es propio) son un
fork de **superpowers 6.0.3** (Jesse Vincent, MIT — ver
[LICENSE-superpowers](./LICENSE-superpowers)), tomado del cache local
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/` el
2026-08-07 (F32). Se invocan como `control-tower-loop:<nombre>`.

## Alcance

**Forkados (11)** — los usados de verdad según el barrido de 2.704 transcripts
de F31 §5: brainstorming · executing-plans · finishing-a-development-branch ·
receiving-code-review · subagent-driven-development · systematic-debugging ·
test-driven-development · using-git-worktrees · verification-before-completion ·
writing-plans · writing-skills.

**Descartados, y por qué:**

- `dispatching-parallel-agents` (0 usos): su hueco lo ocupa CT entre slices,
  con aislamiento real; dentro del slice el diseño es secuencial a propósito.
- `requesting-code-review` (0 invocaciones directas): su único consumo real
  era `code-reviewer.md` como fichero desde subagent-driven-development —
  ese fichero viaja ahora DENTRO de `subagent-driven-development/`.
- `using-superpowers` (meta-skill de la instalación upstream): su papel lo
  hace el propio plugin.
- `frontend-design` (2 usos): existe standalone.

## Las 3 costuras reescritas (F31 §5) — NO pisar en cherry-picks

1. **brainstorming**: el estado terminal ya NO es invocar writing-plans — es
   escribir el execution spec (`docs/superpowers/specs/*-execution.md`, DRAFT,
   procedencia por decisión) y pedir la congelación (15 líneas). El design doc
   se conserva como `Handoff origen:`.
2. **subagent-driven-development**: la rama «no plan» ya NO manda a brainstorm —
   manda a escribir el plan ahora con writing-plans, scoped al issue.
3. **finishing-a-development-branch**: paso 0 nuevo — si existe
   `.agent/SLICE.md` (despacho de CT) no hay menú: PR + `--release` + PARAR.
   El merge es humano.

Reescritura mecánica en todos: el namespace upstream `superpowers:` pasó a
`control-tower-loop:`, y las referencias a `../using-superpowers/references/`
y a `../requesting-code-review/` se eliminaron o reapuntaron.

## Cherry-picks desde upstream

Comparar contra 6.0.3 (el cache local o el tag upstream), traer el diff, y
re-aplicar las 3 costuras si el diff las toca. `__tests__/skills-fork.test.js`
vigila las costuras y que ninguna referencia al namespace viejo sobreviva:
si un cherry-pick lo rompe, el test lo dice.
