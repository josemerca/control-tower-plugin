# Pedir cambios al plan — Implementation Plan

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

El carril del backend lleva una historia de usuario hasta un plan escrito y commiteado, y ahí
ofrece una sola salida: `POST /implement-plan`, que acuña el go y manda implementar. No hay
forma de decir «cambia esto» sin ir a la ventana de cmux y teclearlo a mano.

Hoy `StartPlan` (`backend/src/application/actions/start-plan.js`) abre la issue, la reclama,
corta el worktree, lanza el agente y devuelve un `PlanWatch` con `issue`, `located` y
`repository`, que `StartPlanRoute` guarda en `PlanSessions`. `GET /plan-events/:issue` lo usa
para leer el estado del plan con `PlanContractProgress`, que sale de `dispatch-check
--check-plan` y de `git status` sobre `docs/superpowers/plans`. El stream muere al llegar a
`ready` porque `PlanEvents` declara ese estado como final.

Este slice añade el buzón: un comentario de la issue que empiece por `-REVIEW` es una petición
de cambios, y un vigilante que corre dentro del proceso de la API se la entrega al mismo agente,
en el mismo worktree, para que rehaga el plan que ya commiteó. Diseño:
`docs/superpowers/specs/2026-09-03-pedir-cambios-al-plan-design.md`.

### Desired end state

- `PlanIssues` sabe contestar qué cambios se han pedido en una issue, y `GhPlanIssues` los lee
  de `gh issue view --json comments` quedándose con los comentarios que empiezan por `-REVIEW`.
- `PlanAgents` sabe pedirle a un agente que revise su plan con esos cambios, y `CmuxPlanAgents`
  lo teclea en su sesión con el encargo de `PlanAgentBrief`, en una sola línea.
- `PlanWatch` nombra también al agente que escribe el plan.
- `PlanReviewWatch` sondea la issue cada 30 segundos, despacha cada petición nueva una sola vez,
  sobrevive a un fallo del sondeo y para cuando se le dice.
- `POST /start-plan` pone la issue en vigilancia; `POST /implement-plan` la levanta y olvida la
  sesión.
- El stream de `/plan-events/:issue` ya no termina en `ready`: sigue vivo y vuelve a decir
  `writing` cuando el plan se toca.
- El encargo de revisión le manda al agente republicar el plan rehecho en la issue, así que se
  puede pedir un segundo cambio leyendo el hilo.
- El cuerpo de la issue dice que un comentario que empiece por `-REVIEW` pide cambios.

### Out of scope

- El frontend, entero. Sigue cerrando el `EventSource` al ver `ready`, así que en esta ronda
  nadie consume la vuelta a `writing` y el botón «Implementar» sigue visible mientras el plan se
  rehace. Es el slice siguiente.
- Ventanas de comentarios previos, caducidad de la vigilancia, reintentos y estados nuevos del
  plan: el diseño los descarta uno a uno en su §8.
- Mover labels. El claim de `start-plan` deja la issue en `status:in-progress` y ahí se queda
  mientras el plan se escribe y se rehace.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| El token que dispara una revisión | `-REVIEW`, al principio del cuerpo del comentario; el resto es el texto de la petición |
| Cómo se reconoce | `body.startsWith('-REVIEW')`, sin nonce, sin ventana de ids previos y sin caja exacta en el resto |
| Nombre del quinto método de `PlanIssues` | `changesAsked({ issue, repository })` |
| Nombre del tercer método de `PlanAgents` | `review({ agent, issue, repository, changes })` |
| Lo que devuelve `changesAsked` | una lista de `ChangeAsked`, clase congelada con `id` y `text`, dentro de `gh-plan-issues.js` |
| Quién recuerda lo ya atendido | `PlanReviewWatch`, nunca el puerto ni `PlanSessions` |
| Familia de las excepciones del sondeo | `PlanChangesFailure`, propia, con `PlanChangesNotRead` y `PlanChangesNotUnderstood` |
| Excepción de `review` en el adaptador | `PlanAgentNotResumed`, la que ya lanza `CmuxPlanAgents#type`; no se acuña ninguna |
| El campo `agent` de `PlanWatch` | sin guarda, y no por la regla del argv: no cruza ninguna frontera de entrada |
| Tick del sondeo | 30 segundos, constante del entrypoint |
| Primer sondeo | después del primer `sleep`, nunca al arrancar |
| Estados del plan | siguen siendo `writing` y `ready`; no se añade ninguno |
| Final del stream de eventos | ninguno por estado: solo lo termina una desconexión o un fallo del contrato |
| `reviews` en `ApiServer` | parámetro sin valor por defecto: los dos ficheros de test que construyen `ApiServer` pasan un doble |
| El encargo de revisión republica el plan | sí, como comentario del issue, antes de parar |
| Dónde se anuncia el token al humano | una línea en `PlanIssueBody.of()`, junto a donde el plugin ya explica el `-OK` |
| La fixture del stream tras quitar los finales | `EventsDouble.collected(cancelled)` se llama con un `cancelled` que corta al agotarse las respuestas guionizadas |
| El nombre de la constante que aplana el encargo | `WHITESPACE`: colapsa espacios, tabuladores y saltos, y el nombre lo dice |

## 3. Reference patterns

Files to imitate: `backend/src/application/actions/implement-plan.js` (la acción que solo
delega, con sus `Params`), `backend/src/application/queries/read-plan-progress.js` (la consulta
de solo lectura con `Params` y `Result`), `backend/src/infrastructure/acli-user-stories.js` (el
adaptador que parsea un envoltorio JSON y separa las dos causas de fallo),
`backend/src/infrastructure/plan-events-route.js` (el bucle con `sleep` inyectado y su cancelación),
`backend/__tests__/application/implement-plan.test.js` (la acción medida con puertos doblados),
`backend/__tests__/infrastructure/gh-plan-issues.test.js` (el adaptador medido con `gh` como
conversación guionizada).

Rules to obey: `backend/conventions/README.md`, `backend/conventions/architecture.md`,
`backend/conventions/domain.md`, `backend/conventions/infrastructure.md`,
`backend/conventions/testing.md`, y la vara de Control Tower en `plugin/conventions/` —
`plugin/conventions/defects.md`, `plugin/conventions/style.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/testing.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/ports/plan-agents.js` | modify | `CmuxPlanAgents`, `ReviewPlan` | Contract (Task 1) |
| `backend/src/application/actions/review-plan.js` | create | `PlanReviewWatch` | Contract (Task 1) |
| `backend/src/domain/ports/plan-issues.js` | modify | `GhPlanIssues`, `ReadChangesAsked` | Contract (Task 2) |
| `backend/src/application/queries/read-changes-asked.js` | create | `PlanReviewWatch` | Contract (Task 2) |
| `backend/src/domain/value-objects/plan-watch.js` | modify | `PlanSessions`, `PlanReviewWatch` | Current state (Task 3) |
| `backend/src/application/actions/start-plan.js` | modify | `StartPlanRoute` | Call site (Task 3) |
| `backend/src/domain/exceptions.js` | modify | `GhPlanIssues`, `PlanReviewWatch` | Contract (Task 4) |
| `backend/src/infrastructure/gh-plan-issues.js` | modify | `ReadChangesAsked`, `PlanReviewWatch` | Contract (Tasks 4 y 9) |
| `backend/src/infrastructure/plan-agent-brief.js` | modify | `CmuxPlanAgents` | Contract (Task 5) |
| `backend/src/infrastructure/cmux-plan-agents.js` | modify | `ReviewPlan` | Contract (Task 5) |
| `backend/src/infrastructure/plan-review-watch.js` | create | `StartPlanRoute`, `ImplementPlanRoute` | Contract (Task 6) |
| `backend/src/infrastructure/plan-events-route.js` | modify | `ApiServer` | Current state (Task 7) |
| `backend/src/infrastructure/start-plan-route.js` | modify | `ApiServer` | Call site (Task 8) |
| `backend/src/infrastructure/implement-plan-route.js` | modify | `ApiServer` | Call site (Task 8) |
| `backend/src/infrastructure/api-server.js` | modify | `ct-api.mjs` | Call site (Task 8) |
| `backend/src/infrastructure/ct-api.mjs` | modify | nadie: es el entrypoint | prose (config del grafo) |

## 5. Interfaces

Consumes: `PlanIssues.open/claim/requeue/answerGo` y `PlanAgents.launch/resume` tal como los deja
la rama `alcaptar/claim_y_go`; `PlanSessions.remember/watching/forget`
(`backend/src/infrastructure/plan-events-route.js`); `ReadPlanProgress.execute(params)` y su
`Result` con `state`.

Produces:
`PlanIssues.changesAsked({ issue, repository }) => Promise<Array<{ id, text }>>`
`PlanAgents.review({ agent, issue, repository, changes }) => Promise<void>`
`ReviewPlan.execute(new ReviewPlanParams({ agent, issue, repository, changes })) => Promise<void>`
`ReadChangesAsked.execute(new ReadChangesAskedParams({ issue, repository })) => Promise<ReadChangesAskedResult>`
`PlanReviewWatch.start(watch) => void`, `PlanReviewWatch.stop(issueNumber) => void`
`PlanAgentBrief.reviewErrandFor({ issueNumber, repository, changes }) => string`
`ChangeAsked { id, text }`, congelada, exportada desde `gh-plan-issues.js`
`GhPlanIssues.CHANGES_TOKEN` y `GhPlanIssues.CHANGES_LINE`

## 6. Test strategy

Los comandos son los de `backend/conventions/testing.md`: la suite corre desde `backend/`, y en
este plan cada tarea la invoca con `npm test --prefix backend -- <ruta del test>` desde la raíz
del repositorio, que es donde queda el worktree.

Cada capa se mide como manda ese documento: las dos acciones y la consulta con sus puertos
doblados por constructor, afirmando qué recibió cada puerto; los dos adaptadores cortando justo
antes de `gh` y de `cmux`, con el argv literal y una transcripción real; las rutas contra un
servidor escuchando, con `fetch`, afirmando status y cuerpo literal. El vigilante es
infraestructura con sus dos colaboradores y su `sleep` inyectados, y se mide como el bucle de
`PlanEvents`: contando lo que despachó y lo que no.

Las dos causas de fallo de `changesAsked` se prueban por separado y se afirma que una no es
instancia de la otra, como ya hace `backend/__tests__/infrastructure/acli-user-stories.test.js`.
La transcripción de `gh issue view --json comments` que usan los tests es real, grabada de
`jjponz/rust-monitoring#7`: cada comentario trae `author`, `authorAssociation`, `body`,
`createdAt`, `id`, `includesCreatedEdit`, `isMinimized`, `minimizedReason`, `reactionGroups`,
`url` y `viewerDidAuthor`, y de todos ellos este slice solo lee `id` y `body`.

## 7. Tasks

### Task 1 — `ReviewPlan`, y el tercer método del puerto del agente

**Objective:** el caso de uso que le pide al agente que escribió el plan rehacerlo con los cambios
que le llegan.

**Files:** `backend/src/application/actions/review-plan.js` (create),
`backend/src/domain/ports/plan-agents.js` (modify)

Contract (backend/src/application/actions/review-plan.js):

```js
export class ReviewPlanParams {
  constructor({ agent, issue, repository, changes })  // los cuatro tal cual, y congela
}

export class ReviewPlan {
  constructor({ planAgents })
  async execute(params)  // planAgents.review({ agent, issue, repository, changes })
}
```

Contract (backend/src/domain/ports/plan-agents.js):

```js
async review({ agent, issue, repository, changes }) {
  throw new Error(
    `${this.constructor.name} must implement review({ agent, issue, repository, changes }), asked for ${agent} on ${issue} in ${repository}`
  )
}
```

El `issue` de esta acción es el **número**, como en `ImplementPlanParams`, y `changes` es el texto
de la petición entero: recortarlo aquí sería decidir por el agente qué parte de lo que escribió
una persona le llega.

**TDD:** rojo primero con
`it('the_agent_it_asks_to_review_is_the_handle_it_was_given_and_not_one_it_derived')` en
`backend/__tests__/application/review-plan.test.js`, con la forma de
`backend/__tests__/application/implement-plan.test.js`: un `PlanAgentsDouble` que apunta lo que
recibe, y la aserción es que `review` recibió exactamente los cuatro campos de los `Params`, con
el texto sin tocar.

**Tests:** added: `review-plan.test.js` con
'the_agent_it_asks_to_review_is_the_handle_it_was_given_and_not_one_it_derived',
'an_agent_that_cannot_be_reached_travels_out_typed_instead_of_being_turned_into_a_status' y
'a_port_that_nobody_implemented_says_so_instead_of_answering_undefined'.

**Verification:** el test de la acción en verde, y la carpeta de aplicación entera para probar que
el método nuevo del puerto no rompe a los dobles que ya lo extienden.

```bash
npm test --prefix backend -- __tests__/application/review-plan.test.js   # expected: exit 0 — la acción entrega los cuatro campos
npm test --prefix backend -- __tests__/application   # expected: exit 0 — start-plan e implement-plan siguen verdes
```

### Task 2 — `ReadChangesAsked`, y el quinto método del puerto de la issue

**Objective:** la consulta que contesta qué cambios se han pedido en una issue.

**Files:** `backend/src/application/queries/read-changes-asked.js` (create),
`backend/src/domain/ports/plan-issues.js` (modify)

Contract (backend/src/application/queries/read-changes-asked.js):

```js
export class ReadChangesAskedParams {
  constructor({ issue, repository })  // issue es el PlanIssue que lleva la watch
}

export class ReadChangesAskedResult {
  constructor({ changes })  // la lista tal cual la dio el puerto
}

export class ReadChangesAsked {
  constructor({ planIssues })
  async execute(params)  // Result con planIssues.changesAsked({ issue, repository })
}
```

Contract (backend/src/domain/ports/plan-issues.js):

```js
async changesAsked({ issue, repository }) {
  throw new Error(
    `${this.constructor.name} must implement changesAsked({ issue, repository }), asked for ${issue?.number} in ${repository}`
  )
}
```

El puerto crece con un método y no nace un puerto nuevo porque el colaborador es el mismo —la
issue— y eso lo manda `backend/conventions/domain.md`. La consulta no filtra ni recuerda nada:
devuelve lo que el puerto contesta, en el mismo orden.

**TDD:** rojo primero con
`it('what_it_hands_back_is_every_change_asked_for_in_the_order_the_issue_holds_them')` en
`backend/__tests__/application/read-changes-asked.test.js`, con la forma de
`backend/__tests__/application/read-plan-progress.test.js`: la aserción es que el `Result` lleva
la lista idéntica a la del doble y que el puerto recibió el `issue` y el `repository` que llegaron.

**Tests:** added: `read-changes-asked.test.js` con
'what_it_hands_back_is_every_change_asked_for_in_the_order_the_issue_holds_them',
'an_issue_with_nothing_asked_of_it_answers_an_empty_list_and_not_a_null' y
'a_port_that_nobody_implemented_says_so_instead_of_answering_undefined'.

**Verification:** el test de la consulta en verde y la carpeta de aplicación entera.

```bash
npm test --prefix backend -- __tests__/application/read-changes-asked.test.js   # expected: exit 0 — la consulta devuelve la lista intacta
npm test --prefix backend -- __tests__/application   # expected: exit 0 — los dobles de PlanIssues siguen valiendo
```

### Task 3 — La watch nombra al agente que escribe el plan

**Objective:** que la sesión que el backend recuerda diga a quién hay que entregarle los cambios.

**Files:** `backend/src/domain/value-objects/plan-watch.js` (modify),
`backend/src/application/actions/start-plan.js` (modify)

Current state (backend/src/domain/value-objects/plan-watch.js, lines 14-19):

```js
    }
    this.issue = issue
    this.located = located
    this.repository = repository
    Object.freeze(this)
  }
```

Call site (backend/src/application/actions/start-plan.js):

```js
    return new StartPlanResult({
      agent,
      watch: new PlanWatch({ issue, located, repository: params.repository, agent }),
    })
```

El campo entra sin guarda, a diferencia de los otros tres, y la razón **no** es la del argv: el
handle sí acaba en uno (`cmux-plan-agents.js:46`, `sendArgvFor`). La razón es que no cruza
ninguna frontera de entrada — lo produce `CmuxPlanAgents#open` con la expresión
`/^OK\s+(workspace:\d+)\s*$/m`, que lo restringe más que cualquier guarda que repitiéramos aquí.
De propina, los cuatro ficheros de test que ya construyen `PlanWatch` a mano siguen valiendo sin
tocarlos.

**TDD:** rojo primero dentro del test que ya cubre esa dimensión,
`backend/__tests__/application/start-plan.test.js:204`
`the_agent_and_everything_needed_to_watch_the_plan_come_back_as_one_thing_the_caller_cannot_misspell`,
que ya comprueba campo por campo lo que lleva la watch: se le añade la aserción de que
`started.watch.agent` es el mismo handle que `started.agent`. No nace un test nuevo porque
`plugin/conventions/testing.md` solo admite uno que añada una dimensión distinta, y ésta es la
misma.

**Tests:** N/A — la dimensión ya está cubierta y lo que entra es una aserción en
`the_agent_and_everything_needed_to_watch_the_plan_come_back_as_one_thing_the_caller_cannot_misspell`.

**Verification:** el test del arranque en verde, y las dos carpetas de test que construyen
`PlanWatch` para probar que nada más se movió.

```bash
npm test --prefix backend -- __tests__/application/start-plan.test.js   # expected: exit 0 — la watch lleva el agente
npm test --prefix backend -- __tests__/infrastructure   # expected: exit 0 — los cuatro sitios que la construyen a mano siguen verdes
```

### Task 4 — El adaptador lee de la issue los cambios que se han pedido

**Objective:** `GhPlanIssues` contesta qué comentarios de la issue empiezan por `-REVIEW` y qué
piden.

**Files:** `backend/src/infrastructure/gh-plan-issues.js` (modify),
`backend/src/domain/exceptions.js` (modify)

Contract (backend/src/domain/exceptions.js):

```js
export class PlanChangesFailure extends PlanFailure {}
export class PlanChangesNotRead extends PlanChangesFailure {}
export class PlanChangesNotUnderstood extends PlanChangesFailure {}
```

Contract (backend/src/infrastructure/gh-plan-issues.js):

```js
export class ChangeAsked {   // junto a PlanIssueBody: el adaptador la compone y la congela
  constructor({ id, text })  // esos dos, de los once campos que gh imprime por comentario
}
  static CHANGES_TOKEN = '-REVIEW'
  static changesArgvFor({ issue, repository })
  // ['issue', 'view', String(issue.number), '--repo', repository.text, '--json', 'comments']
  async changesAsked({ issue, repository })
  // Promise<ChangeAsked[]>: los comentarios cuyo body empieza por el token, en el orden que
  // imprime gh, con text = el resto del body tras el token, con trim.
  // gh que falla -> PlanChangesNotRead; salida que no es json, o sin `comments` array,
  // o un comentario sin `id` cadena -> PlanChangesNotUnderstood.
```

Clase y no `{ id, text }` crudo porque el mapa cruzaría tres módulos y el último decide con él
—`attended.has(change.id)`—, que es el defecto de la sección «No raw map as the return value of
logic» de `plugin/conventions/defects.md`. Y es una lectura, así que va con
`{ safeToRepeat: true }`: `backend/conventions/infrastructure.md` nombra el antipatrón al revés.

**TDD:** rojo primero con
`it('only_the_comments_that_open_with_the_token_count_as_a_change_asked_for')` en
`backend/__tests__/infrastructure/gh-plan-issues.test.js`. La conversación guionizada de `gh`
contesta la transcripción real de §6, con sus once campos por comentario e `id` con la forma que
GitHub imprime —`IC_kwDOT9lB5c8AAAABRB_tVQ`—, y estos cuerpos: el del plan, que abre por
`## Plan del slice`; un `-OK` pelado; un `-OK 3f9a1c2b`; y uno que abre por el token. La aserción
es que solo sale ese, con su `id` y con el texto sin el token. El límite se pincha con dos casos:
un comentario que **es** el token pelado —entra, con texto vacío— y uno que lo lleva en medio del
cuerpo, que no entra.

**Tests:** added, en `gh-plan-issues.test.js`:
'the_changes_asked_for_are_read_with_the_argv_gh_understands',
'only_the_comments_that_open_with_the_token_count_as_a_change_asked_for',
'a_gh_that_refused_is_told_apart_from_a_gh_that_answered_something_unreadable'. Y en
`backend/__tests__/infrastructure/plan-refusal.test.js`: `PlanChangesFailure` entra en su lista
`FAMILIES` y en la exclusión del filtro, con
'a_failure_of_reading_the_changes_asked_for_has_no_status_here_because_it_only_reaches_stderr'
al lado del que ya dice lo mismo de `PlanProgressFailure`.

**Verification:** el adaptador y el test de exhaustividad de las proyecciones, que es el que
sabría decir si la familia nueva se ha quedado sin sitio.

```bash
npm test --prefix backend -- __tests__/infrastructure/gh-plan-issues.test.js   # expected: exit 0 — argv literal y parseo de la transcripción real
npm test --prefix backend -- __tests__/infrastructure/plan-refusal.test.js   # expected: exit 0 — la familia nueva no exige un status muerto
```

### Task 5 — El encargo de rehacer el plan, y en una sola línea

**Objective:** el texto que recibe el agente, tecleado en su sesión de cmux.

**Files:** `backend/src/infrastructure/plan-agent-brief.js` (modify),
`backend/src/infrastructure/cmux-plan-agents.js` (modify)

Contract (backend/src/infrastructure/plan-agent-brief.js):

```js
  static WHITESPACE = /\s+/g  // el encargo se teclea en un pty: un salto sería un Enter

  reviewErrandFor({ issueNumber, repository, changes })  // => string sin ningún '\n'
```

Contract (backend/src/infrastructure/cmux-plan-agents.js):

```js
  async review({ agent, issue, repository, changes })
  // errand = brief.reviewErrandFor({ issueNumber: issue, repository, changes })
  // #type(CmuxPlanAgents.sendArgvFor(agent, errand)) y luego #type(enterArgvFor(agent)),
  // igual que resume: el fallo sale como PlanAgentNotResumed, sin acuñar ninguna nueva
```

El encargo dice, en este orden: que una persona ha pedido cambios en el plan del issue N;
cuáles, con el texto aplanado; que lo rehaga sin implementar nada y sin reescribirlo de cero; que
lo revalide con `node <dispatchCheck> N --repo <owner/name> --check-plan` hasta exit 0; que lo
recommitee; **que publique el plan rehecho como comentario del issue**; y que pare otra vez, sin
pull request y sin worktrees nuevos —la misma cláusula `NO_NEW_WORKTREES` que ya usan los otros
dos encargos. Se une con espacios, como `implementationErrandFor`, y por el mismo motivo que
ahora se declara en `WHITESPACE`.

La cláusula de republicar es lo que hace que el ciclo funcione más de una vez: el plan llegó a la
issue por el paso 9 de `plugin/skills/writing-plans-prescriptive/SKILL.md`, y `--check-plan` es
read-only y no habla con GitHub. Sin republicar, quien quiera pedir un segundo cambio tendría
delante el plan viejo.

**TDD:** rojo primero con
`it('the_errand_is_one_line_even_when_the_person_wrote_the_change_across_several')` en
`backend/__tests__/infrastructure/plan-agent-brief.test.js`: el `changes` del caso lleva dos
saltos de línea y un tabulador, y la aserción es que el encargo no contiene ningún `\n` y que las
palabras de la petición siguen ahí, separadas por un espacio.

**Tests:** added, en `plan-agent-brief.test.js`:
'the_errand_is_one_line_even_when_the_person_wrote_the_change_across_several',
'the_errand_names_the_issue_the_plan_and_the_command_that_validates_it',
'the_errand_orders_the_reworked_plan_back_onto_the_issue_so_the_next_change_can_be_asked_for'. Y en
`backend/__tests__/infrastructure/cmux-plan-agents.test.js`:
'a_review_is_typed_into_the_session_with_send_and_then_enter',
'a_session_that_did_not_take_the_line_travels_out_as_the_agent_not_resumed'.

**Verification:** los dos ficheros del adaptador de cmux y del encargo.

```bash
npm test --prefix backend -- __tests__/infrastructure/plan-agent-brief.test.js   # expected: exit 0 — el encargo cabe en una línea
npm test --prefix backend -- __tests__/infrastructure/cmux-plan-agents.test.js   # expected: exit 0 — send y send-key con su argv literal
```

### Task 6 — El vigilante

**Objective:** el bucle que sondea la issue, despacha cada petición nueva una sola vez y para
cuando se le dice.

**Files:** `backend/src/infrastructure/plan-review-watch.js` (create)

Contract (backend/src/infrastructure/plan-review-watch.js):

```js
export class PlanReviewWatch {
  constructor({ asked, review, sleep, stderr })
  // asked(watch) => Promise<{ changes }>; review({ agent, issue, repository, changes }) => Promise<void>
  // las dos las compone el entrypoint sobre la aplicación, como el `read` de PlanEvents

  start(watch)      // recuerda { stopped: false, attended: new Set() } por watch.issue.number
  stop(issueNumber) // marca stopped; el bucle muere en su siguiente vuelta
}
```

El bucle: `await sleep()` **primero**, y solo entonces preguntar — así el arranque de la API no
lee una issue que acaba de nacer. Cada vuelta pide los cambios, y de los que vuelven despacha los
que no estén en `attended`: **una llamada a `review` por petición**, con `changes: change.text`
—el texto, nunca la lista ni el `ChangeAsked`—, apuntando el `id` **antes** de despachar: si la entrega falla, la
petición se pierde con su motivo en `stderr` en vez de repetirse cada treinta segundos para
siempre. Un `PlanFailure` de cualquiera de las dos llamadas se escribe en `stderr` y la vigilancia
sigue viva, como hace `ct-watch-go` con un `gh` que se cae; cualquier otro error sube, porque es
un defecto nuestro.

**TDD:** rojo primero con
`it('the_same_change_is_never_handed_over_twice_however_long_the_issue_keeps_it')` en
`backend/__tests__/infrastructure/plan-review-watch.test.js`: el doble contesta **la misma**
petición en tres sondeos seguidos y la aserción es que `review` se llamó una vez, y con
`{ agent, issue, repository, changes }` donde `changes` es el `text` de esa petición —no la lista
ni el objeto—, que es el error que el nombre plural invita a cometer. El límite del otro lado:
una segunda petición con otro `id` en el tercer sondeo sí se despacha.

**Tests:** added: `plan-review-watch.test.js` con
'a_change_asked_for_is_handed_to_the_agent_that_wrote_that_plan',
'the_same_change_is_never_handed_over_twice_however_long_the_issue_keeps_it',
'it_asks_the_issue_only_after_the_first_wait_so_a_brand_new_issue_is_not_read',
'a_sounding_that_failed_is_written_to_stderr_and_the_watch_lives_on',
'a_delivery_that_failed_is_not_retried_forever_and_says_so',
'a_watch_it_was_told_to_stop_asks_the_issue_nothing_else'.

**Verification:** el fichero del vigilante en verde.

```bash
npm test --prefix backend -- __tests__/infrastructure/plan-review-watch.test.js   # expected: exit 0 — despacha una vez, sobrevive al fallo y para
```

### Task 7 — El stream de eventos deja de terminar en `ready`

**Objective:** que `/plan-events/:issue` siga vivo tras `ready` y pueda decir `writing` otra vez.

**Files:** `backend/src/infrastructure/plan-events-route.js` (modify)

Current state (backend/src/infrastructure/plan-events-route.js, lines 98-105):

```js
  static #ENDINGS = Object.freeze({
    [PlanState.WRITING]: false,
    [PlanState.READY]: true,
  })

  static declaredStates() {
    return Object.keys(PlanEvents.#ENDINGS)
  }
```

Con ese tramo se van `endsAt` y sus dos únicas líneas en `stream()`: el
`const ends = PlanEvents.endsAt(read.state)` y el `if (ends) return`. El bucle queda en leer, emitir si cambió, dormir y
mirar si se ha cancelado. Con `#ENDINGS` se van dos cosas más, y las dos se borran aquí:
`PlanState.declared()` (`backend/src/domain/value-objects/plan-state.js`), que queda sin
consumidores, y el `import` de `PlanState` en `plan-events-route.js`, que queda sin usar.

**TDD:** rojo primero con
`it('the_stream_lives_on_after_ready_so_a_plan_that_is_being_reworked_can_say_so')` en
`backend/__tests__/infrastructure/plan-events-route.test.js`: el doble contesta `ready`,
`writing`, `ready`, y salen tres frames en ese orden. Como el generador ya no se cierra solo, a
`collected` se le pasa el `cancelled` que la fixture ya acepta y nadie usaba, cortando al
agotarse las respuestas guionizadas; sin eso el doble lanza su `Error` de «read more times than
this test scripted» y el test mide la fixture, no el stream.

**Tests:** added, en `plan-events-route.test.js`:
'the_stream_lives_on_after_ready_so_a_plan_that_is_being_reworked_can_say_so'; y en
`backend/__tests__/infrastructure/api-server.test.js`:
'a_watch_survives_ready_so_the_page_can_come_back_while_the_plan_is_reworked', que hereda el
sitio del que se va y afirma lo contrario: segunda suscripción, 200.
Removed on purpose: en `plan-events-route.test.js`,
'it_stops_after_ready_because_there_is_nothing_left_to_watch',
'every_plan_state_says_whether_it_ends_the_watch_so_a_third_one_cannot_arrive_as_writing',
'a_plan_state_nobody_declared_an_ending_for_raises_instead_of_being_polled_forever_as_if_unfinished';
y en `api-server.test.js`,
'a_second_subscription_after_ready_is_a_404_so_an_event_source_gives_up_instead_of_reconnecting_forever'.

Y cuatro se **corrigen**, porque el cambio los pone rojos. Los tres de
`plan-events-route.test.js` que agotan sus respuestas
—`it_emits_the_first_state_it_reads_so_a_late_subscriber_is_not_left_blank`,
`a_state_that_did_not_change_is_not_repeated_down_the_wire`,
`it_waits_between_reads_instead_of_spinning`— llaman a `collected` con ese `cancelled`, y el
tercero mide el `slept` que salga de ahí. Y en `api-server.test.js`,
`a_plan_that_started_is_remembered_so_the_page_can_watch_it_by_the_issue_it_opened` lee un frame
y aborta en vez del cuerpo entero, que ya no acaba; los tests de ese fichero que estrenan bucle
sin final llevan el `sleepMs` que `ProgressSpy` ya acepta, para no dejar un bucle caliente.

**Verification:** los dos ficheros que miden el stream. Un bucle que ya no termina convierte un
fallo en una espera, así que lo que se mira es que ninguno se cuelgue.

```bash
npm test --prefix backend -- __tests__/infrastructure/plan-events-route.test.js   # expected: exit 0 — el stream sobrevive a ready
npm test --prefix backend -- __tests__/infrastructure/api-server.test.js   # expected: exit 0 — ninguna prueba del stream se queda colgada
```

### Task 8 — Las rutas la arrancan y la paran, y el entrypoint la monta

**Objective:** que `POST /start-plan` ponga la issue en vigilancia y `POST /implement-plan` la
levante, con el grafo cableado en el entrypoint.

**Files:** `backend/src/infrastructure/start-plan-route.js` (modify),
`backend/src/infrastructure/implement-plan-route.js` (modify),
`backend/src/infrastructure/api-server.js` (modify),
`backend/src/infrastructure/ct-api.mjs` (modify),
`backend/__tests__/infrastructure/api-server.test.js` (modify),
`backend/__tests__/infrastructure/implement-plan-route.test.js` (modify)

Call site (backend/src/infrastructure/start-plan-route.js):

```js
  static handledBy(startPlan, sessions, reviews)  // el tercer colaborador
    sessions.remember(started.watch)
    reviews.start(started.watch)
```

Call site (backend/src/infrastructure/implement-plan-route.js):

```js
  static handledBy(implementPlan, sessions, reviews)
    // tras el 202, y solo tras el 202:
    reviews.stop(asked.issue)
    sessions.forget(asked.issue)
```

Call site (backend/src/infrastructure/api-server.js):

```js
    constructor({ ..., reviews })  // sin valor por defecto: quien monta el servidor lo pasa
    StartPlanRoute.handledBy(this.startPlan, this.sessions, this.reviews)
    ImplementPlanRoute.handledBy(this.implementPlan, this.sessions, this.reviews)
```

`ct-api.mjs` construye el vigilante junto a los demás: `asked` es
`(watch) => readChangesAsked.execute(new ReadChangesAskedParams(watch))` sobre un
`ReadChangesAsked` con el `planIssues` que la rama ya comparte, `review` es
`(params) => reviewPlan.execute(new ReviewPlanParams(params))`, `sleep` es
`CtApi.#waiting(CtApi.#SECONDS_BETWEEN_ASKS)` con la constante nueva a 30, y `stderr` es el mismo
`(line) => process.stderr.write(line)` que ya recibe `GhPlanIssues`.

**TDD:** rojo primero con
`it('a_plan_that_started_is_put_under_watch_so_a_change_asked_for_reaches_its_agent')` en
`backend/__tests__/infrastructure/api-server.test.js`: un doble que apunta `start`/`stop`, y la
aserción es que tras el `202` del arranque tiene la watch de ese arranque, y tras el `202` de
implementar tiene ese número en `stop`. El otro lado: un `400` de implementar no para nada.

`reviews` no tiene valor por defecto, así que las once construcciones de `ApiServer` en los
tests se quedan sin él: diez en `api-server.test.js` —su helper `RunningApi` y las directas— y
`implement-plan-route.test.js:51`. Las dos fixtures pasan el doble por defecto, y por eso los dos
ficheros están en `**Files:**`.

**Tests:** added, en `api-server.test.js`:
'a_plan_that_started_is_put_under_watch_so_a_change_asked_for_reaches_its_agent',
'implementing_the_plan_lifts_the_watch_because_there_is_nothing_left_to_ask_for',
'a_refused_request_to_implement_lifts_no_watch'.

**Verification:** los dos ficheros de las rutas y la suite entera con su vara. El test de proceso
real no mide nada de esto y no se le pide que lo haga: su único `start-plan` muere en `acli` con
un `503` sin llegar a arrancar ninguna vigilancia, y `backend/conventions/testing.md` dice que
del entrypoint no se mide nada más arrancándolo.

```bash
npm test --prefix backend -- __tests__/infrastructure/implement-plan-route.test.js   # expected: exit 0 — implementar levanta la vigilancia y su fixture la dobla
npm test --prefix backend   # expected: exit 0 — la suite entera, con backend/__tests__/yardstick.test.js dentro
```

### Task 9 — El cuerpo de la issue dice cómo se piden cambios

**Objective:** que quien lee la issue sepa que un comentario que empiece por `-REVIEW` pide
cambios en el plan.

**Files:** `backend/src/infrastructure/gh-plan-issues.js` (modify)

Contract (backend/src/infrastructure/gh-plan-issues.js):

```js
  static CHANGES_LINE = `> Para pedir cambios en el plan, comenta en este issue empezando por ` +
    `\`${GhPlanIssues.CHANGES_TOKEN}\`, y lo que escribas detrás es lo que se le pide al agente.`
  // PlanIssueBody.of la emite justo detrás de la línea "> Historia de usuario: <clave>"
```

Sin esto el buzón no tiene dirección, y el repositorio ya midió ese fallo con el otro token:
`plugin/scripts/go-response.js` cuenta que alguien escribió `-OK` pelado, no pasó nada, «miró,
sí — y no tenía nada que mirar», porque el formato estaba escrito en un sitio distinto del que
esa persona estaba leyendo. Aquí `-REVIEW` no está escrito en ningún sitio.

Lo que esta tarea **no** hace: tocar la sección de gates que el cuerpo hereda del plugin, que en
este carril dice del `-OK` cosas que no son verdad —un nonce que «/ct-next imprimió al
despachar», un vigilante lanzado por una coordinadora— cuando aquí el go lo acuña
`POST /implement-plan`. Es deuda anterior a este slice y arreglarla es tocar el contrato con el
plugin; queda declarada en §9 del diseño.

**TDD:** rojo primero con
`it('the_issue_body_names_the_token_that_asks_for_changes_so_the_mailbox_has_an_address')` en
`backend/__tests__/infrastructure/plan-issue-body.test.js`: la aserción es que el cuerpo que
compone `PlanIssueBody.of(story)` contiene `GhPlanIssues.CHANGES_TOKEN`, y que lo hace **una**
vez, para que la línea no se duplique con la de los gates.

**Tests:** added, en `plan-issue-body.test.js`:
'the_issue_body_names_the_token_that_asks_for_changes_so_the_mailbox_has_an_address'.

**Verification:** el cuerpo de la issue y el adaptador que lo escribe, más el test de contrato con
los lectores del plugin: la línea nueva no puede romper lo que `mapGhIssue` lee de ese cuerpo.

```bash
npm test --prefix backend -- __tests__/infrastructure/plan-issue-body.test.js   # expected: exit 0 — el cuerpo nombra el token una vez
npm test --prefix backend -- __tests__/infrastructure/plugin-contract.test.js   # expected: exit 0 — los lectores del plugin siguen leyendo el cuerpo
```

## 8. Global verification

Con las ocho tareas comiteadas, la suite entera del backend en verde —la vara de
`backend/__tests__/yardstick.test.js` incluida, que mide cada fichero nuevo por estar en el
disco— y el árbol limpio.

Lo que **no** se puede correr aquí y hay que mirar a ojo con `cmux`, `gh` y un repo gobernado
delante: arrancar la API, lanzar un plan de verdad, esperar a que el agente publique el plan en
la issue, comentar `-REVIEW` con un cambio pequeño, y comprobar tres cosas — que la sesión del
agente recibe el encargo, que el fichero del plan cambia y se recommitea, y que el stream de
`/plan-events/:issue` dice `writing` y vuelve a `ready`.

```bash
npm test --prefix backend   # expected: exit 0 — la suite entera del backend y su vara
test -z "$(git status --porcelain)"   # expected: exit 0 — nada sin commitear, el plan incluido
```

## 9. Assumptions

1. **El token es `-REVIEW` y no `-CAMBIOS`.** Decisión propia, aprobada al diseñar: el hilo de la
   issue ya tiene el `-OK` que acuña `GhPlanIssues.GO_TOKEN`, y los dos permisos que una persona
   teclea ahí hablan el mismo idioma. Cambiarlo cuesta una constante.
2. **El plan se escribió contra la rama `alcaptar/claim_y_go`**, que a esta fecha está sin
   mergear. Los dos tramos que se citan verbatim —`plan-watch.js` y `plan-events-route.js`— no los
   toca esa rama, así que las citas valen antes y después del merge; lo que sí cambia con ella es
   el cableado del entrypoint de la tarea 8.
3. **`PlanWatch.agent` sin guarda**, y **no** por la regla del argv: el handle sí acaba en uno
   (`cmux-plan-agents.js:46`). La razón es que no cruza ninguna frontera de entrada — lo compone
   `CmuxPlanAgents#open` con una expresión que ya lo restringe—, así que repetir la guarda aquí
   validaría lo que este código acaba de construir.
4. **Familia propia para las excepciones del sondeo.** Lo obliga
   `backend/__tests__/infrastructure/plan-refusal.test.js`, que exige un status declarado para toda
   excepción bajo `PlanFailure` salvo las que excluye a mano; dentro de `PlanIssueFailure` habría
   que declararle a `PlanCollapse` un status que nadie sirve.
5. **El `id` se apunta antes de despachar.** Decisión propia: entre repetir una petición cada
   treinta segundos y perderla dejando el motivo en `stderr`, se elige perderla. Sin humano
   delante, lo primero es una sesión de cmux recibiendo el mismo párrafo para siempre.
6. **La lectura va con `safeToRepeat: true`.** No escribe nada, y
   `backend/conventions/infrastructure.md` nombra el antipatrón contrario.
7. **Los comandos se invocan desde la raíz del worktree con `--prefix backend`.** Es lo que hace
   `Makefile` y lo que respeta la regla de `backend/conventions/testing.md` de que la suite corre
   desde `backend/`.
8. **La tarea 7 no la necesita el vigilante.** Se incluye porque quien encarga el slice pidió
   tocar `plan-events-route` sabiendo que su consumidor llega en el slice del front: el vigilante
   recibe la watch por parámetro y no consulta `PlanSessions`, así que funcionaría sin ella.
9. **Las dos causas de `PlanChangesFailure` se conservan** aunque hoy el único consumidor capture
   la familia. `plugin/conventions/defects.md` pide jerarquía solo donde el consumidor separa dos
   casos, pero `backend/conventions/README.md` declara que para los diffs de `backend/` mandan
   primero sus propios documentos, y `domain.md` exige las dos causas en toda familia porque «se
   reparan en sitios distintos»; los cuatro adaptadores del backend ya lo hacen así.
10. **El aviso del token va en el cuerpo de la issue y no en un comentario**, a diferencia del
   `GO_FORMAT_REPLY` del plugin: un comentario contestando a quien se equivocó exige reconocer el
   intento, y eso es la máquina de estados que este slice no tiene.
