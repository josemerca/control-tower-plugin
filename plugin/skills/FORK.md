# Fork de superpowers — origen y costuras

Los skills de este directorio (salvo `state-template` y
`writing-plans-prescriptive`, que son propios) son un
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

**De los 11, se DISTRIBUYEN 10.** `writing-skills` se movió (#93) a
`docs/superpowers/skills/writing-skills/`: sigue forkado, sigue en el repo y
sigue rigiendo cómo se escribe una skill de este plugin, pero lo lee quien
DESARROLLA el plugin, nunca un agente del loop — y `plugin/` es el `source` del
marketplace, así que ahí dentro solo viajaba pesando en cada instalación. El
barrido de «el fork es cerrado» de `skills-fork.test.js` lo sigue cubriendo en
su ruta nueva: salir del paquete no lo saca del fork.

**Descartados, y por qué:**

- `dispatching-parallel-agents` (0 usos): su hueco lo ocupa CT entre slices,
  con aislamiento real; dentro del slice el diseño es secuencial a propósito.
- `requesting-code-review` (0 invocaciones directas): su único consumo real
  era `code-reviewer.md` como fichero desde subagent-driven-development, que
  viajó un tiempo DENTRO de `subagent-driven-development/` y se borró en #93
  junto a los otros dos prompts bundleados (ver abajo).
- `using-superpowers` (meta-skill de la instalación upstream): su papel lo
  hace el propio plugin.
- `frontend-design` (2 usos): existe standalone.

## Los tres prompts de subagent-driven-development, borrados (#93)

`implementer-prompt.md`, `task-reviewer-prompt.md` y `code-reviewer.md` ya no
están. No los leía nada: el kickoff de un slice despachado **prohíbe** conducir
con esa skill (`scripts/kickoff.js`, la línea que dice que la secuencia la dicta
la máquina), y los prompts que el loop sí usa viven en `prompts/` y `agents/`
—`task-implementer.md`, `ct-judge.md`, `ct-slice-judge.md`—, declarados con sus
herramientas. Lo único de esa skill que se usa en cada tarea es su script
`scripts/task-brief`, que extrae una tarea del plan; ése se queda.

Un cherry-pick de upstream los devolvería: no los restaures. `SKILL.md` los
sustituye por una frase que dice dónde están los prompts de verdad, y
`skills-fork.test.js` se pone rojo si alguno vuelve o si `SKILL.md` los enlaza.

## Los cuatro forkados que no referencia ningún artefacto del loop

Medido en #93: `executing-plans`, `receiving-code-review`,
`systematic-debugging` y `verification-before-completion` no los nombra ningún
comando, ningún agente, ningún prompt ni ningún script del loop. Llegan a una
sesión solo si el modelo decide invocarlos por su descripción, que es
exactamente para lo que existe una skill — pero nada del loop cuenta con ellos.

**No se retiran, y la decisión queda para el mantenedor.** Las dos salidas son
legítimas y ninguna es obvia desde aquí: nombrarlos en el kickoff (si el agente
de un slice debe poder invocarlos: depurar sistemáticamente, verificar antes de
declarar hecho, encajar una review) o sacarlos del fork (si el loop ya cubre su
papel con sus propios mecanismos — `ct-step controls` verifica, el juez revisa,
`ct-step` conduce). Lo que no se hace es borrarlos por no encontrar una
referencia: son baratos de mantener y caros de reponer, y el barrido de F31 §5
los encontró en uso real. Esta entrada existe para que la próxima vez que
alguien busque skills sin referencia encuentre la medición hecha y la decisión
pendiente, en vez de repetir el barrido.

`writing-skills` era el quinto de esa lista; su caso ya está resuelto arriba
(fuera del paquete, dentro del repo).

## Las costuras reescritas (F31 §5 y F-jjponz) — NO pisar en cherry-picks

1. **brainstorming**: el estado terminal ya NO es invocar writing-plans — es
   escribir el execution spec (`docs/superpowers/specs/*-execution.md`, DRAFT,
   procedencia por decisión) y pedir la congelación (15 líneas). El design doc
   se conserva como `Handoff origen:`.
2. **subagent-driven-development**: la rama «no plan» ya NO manda a brainstorm —
   manda a escribir el plan ahora con writing-plans, scoped al issue.
3. **finishing-a-development-branch**: paso 0 nuevo — si existe
   `.agent/SLICE.md` (despacho de CT) no hay menú: PR + `--release` + PARAR.
   El merge es humano.
4. **subagent-driven-development** (segunda costura sobre el mismo fichero,
   F-jjponz-1): la rama «no plan» ya no manda a writing-plans sino a
   `writing-plans-prescriptive` — skill PROPIA (no existe upstream), con
   contrato mecánico en `scripts/plan-contract.js` y gate duro en
   `--release`. Un cherry-pick de upstream que restaure writing-plans aquí
   desarma el gate: lo vigila `skills-fork.test.js` (costura 4).
5. **subagent-driven-development** (tercera costura sobre el mismo fichero,
   F-jjponz-4): la selección de modelo daba por hecho que la tarea traía el
   código completo —«when the task's plan text contains the complete code to
   write, the implementation is transcription plus testing: use the cheapest
   tier»— y desde que el plan lleva contratos y no cuerpos eso es falso para
   TODA tarea: enrutaría al tier más barato justo el eslabón que ahora escribe
   el código. El suelo pasa a ser el tier intermedio para todo implementador, y
   el tier barato queda para arreglos mecánicos de un fichero. Un cherry-pick
   que restaure el atajo devuelve la regresión: lo vigila `skills-fork.test.js`
   (costura 5).
6. **test-driven-development** (F39): `prompts/task-implementer.md` ya no lleva el
   ciclo escrito dentro — carga `control-tower-loop:test-driven-development`. A
   partir de aquí, un cherry-pick de upstream sobre esa skill cambia el
   comportamiento del implementador de `ct-step`, que antes era inmune. El fork
   se tomó de 6.0.3; comprueba qué cambió en el ciclo antes de traerlo. Lo
   vigila `skills-fork.test.js` (costura 6).

Reescritura mecánica en todos: el namespace upstream `superpowers:` pasó a
`control-tower-loop:`, y las referencias a `../using-superpowers/references/`
y a `../requesting-code-review/` se eliminaron o reapuntaron.

## Cherry-picks desde upstream

Comparar contra 6.0.3 (el cache local o el tag upstream), traer el diff, y
re-aplicar las costuras si el diff las toca. `__tests__/skills-fork.test.js`
vigila las costuras y que ninguna referencia al namespace viejo sobreviva:
si un cherry-pick lo rompe, el test lo dice.
