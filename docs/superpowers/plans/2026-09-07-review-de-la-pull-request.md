# Pedir fixes en la pull request — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que una persona pida fixes con el botón de review de GitHub sobre la pull request de un plan, y que esos fixes lleguen al agente que sigue vivo en su ventana de cmux.

**Architecture:** un vigilante nuevo, hermano del que ya atiende las reviews del plan, instanciado sobre el mismo bucle genérico con otros dos colaboradores. Lee las reviews nativas de la pull request, sólo entrega con el issue en `status:in-review` (que es la señal de que el agente no está ocupado), y antes de teclear devuelve el issue al banco de trabajo con `dispatch-check --reopen`. La interfaz gana un cuarto paso que hace visible en qué punto está la entrega.

**Tech Stack:** Node 24 ESM, express 5, vitest 4 en backend; React 19 con TypeScript y vitest en frontend. Ninguna dependencia nueva.

**Spec:** `docs/superpowers/specs/2026-09-07-review-de-la-pull-request-design.md` (commit `f3ccfa3`)

**Branch:** `alcaptar/review_de_la_pr`, cortada de `main`.

## Global Constraints

Copiadas literalmente de las varas que ligan en todo diff de este repo. Los requisitos de cada tarea las incluyen implícitamente.

- **La suite se corre desde `backend/`, nunca desde la raíz.** Subconjunto rápido: `npx vitest run --exclude '**/*-real-process.test.js'`. El frontend se corre desde `frontend/` con `npx vitest run`.
- **Sin comentarios en el código nuevo.** `plugin/conventions/style.md`. Lo que un comentario explicaría va en el nombre, o en el cuerpo de la pull request.
- **El código nuevo en inglés**, y en clases: no hay funciones sueltas exportadas (`plugin/conventions/style.md`). Los textos de cara a la persona —encargos al agente, copia de la interfaz— en castellano.
- **Un concepto por módulo, y la carpeta es el discriminador, nunca un sufijo en el nombre.** Prohibidos `*VO`, `*Port`, `*UseCase` (`backend/conventions/architecture.md`).
- **Un tipo nuevo tiene la carga de la prueba.** La respuesta por defecto a comportamiento nuevo es un método en un tipo que ya existe, y a un tipo nuevo, meterlo en el módulo que lo consume (`backend/conventions/architecture.md`).
- **Nada por si acaso.** Un campo, una rama o un símbolo público responden a una llamada que existe hoy. La pregunta es: qué llamada se rompe sin él (`backend/conventions/simplicity.md`).
- **El dominio no tiene tests propios.** Todo value object y toda policy se alcanzan a través del caso de uso que los lleva (`backend/conventions/testing.md`).
- **La mother de cada fichero de test es su clase fixture**, con escenarios nombrados y defectos sensatos (`backend/conventions/testing.md`). En frontend, las mothers viven en `frontend/src/__scenarios__/`.
- **Un adaptador se mide con el argv literal y el parseo de salida grabada real**, no con formas inventadas (`backend/conventions/testing.md`).
- **Los dos modos de fallo de cada adaptador se distinguen**: la herramienta negándose (`*NotRead`) y la herramienta contestando algo ilegible (`*NotUnderstood`), y el test prueba que uno no es instancia del otro (`backend/conventions/testing.md`).
- **Un doble que contesta una conversación escrita revienta** si le preguntan por una respuesta que nadie escribió (`backend/conventions/testing.md`).

---

## 1. Context and goal

Hoy `ImplementPlanRoute.#accept` apaga el sistema en dos líneas (`backend/src/infrastructure/implement-plan-route.js:185-186`): mata el vigilante de reviews del plan y olvida la sesión del stream. El agente implementa, abre la pull request, la libera con `dispatch-check --release --no-watch-merge` y para, vivo en su ventana. A partir de ahí nadie lee nada y nadie le habla.

### Desired end state

Una persona abre la pull request, deja una review pidiendo cambios —con cuerpo, con comentarios de línea, o sólo con un comentario de línea suelto— y sin hacer nada más:

1. el vigilante la ve en su siguiente tick,
2. el issue vuelve a `status:in-progress` con `dispatch-check --reopen`,
3. el agente recibe en su ventana el encargo con el texto de la review y las anclas `fichero:línea`,
4. la interfaz pasa de "Pull request #N en revisión" a "Corrigiendo lo pedido…",
5. el agente corrige, pushea y repite el `--release`, con lo que el issue vuelve a `in-review` y la interfaz también,
6. y una segunda review pedida mientras corregía se atiende en la vuelta siguiente, sin haberse tecleado encima.

### Out of scope

- Vigilar la integración continua y mergear. El bucle no tiene nada que decir sobre el merge.
- La cosecha del carril web.
- Persistir el estado del bucle: la idempotencia sigue siendo el conjunto en memoria del vigilante.
- Leer comentarios de la pestaña Conversation (`issues/<n>/comments`).

## 2. Closed decisions (take as given)

No se relitigan durante la implementación. Cada una está argumentada en la sección del spec que se cita.

1. **Dos mecanismos distintos, no uno con un parámetro.** El bucle del plan y el de la pull request son dos instancias con dos fuentes y dos encargos (spec §1).
2. **Reviews nativas de GitHub, sin token.** Cruzando `pulls/<n>/reviews` con `pulls/<n>/comments` (spec §3).
3. **Una review pide cambios si su estado es `CHANGES_REQUESTED` o `COMMENTED` y trae cuerpo con texto o al menos un comentario.** La segunda mitad cubre el comentario de línea suelto, que es el caso más frecuente (spec §3).
4. **La puerta es la etiqueta.** Sólo se entrega con el issue en `in-review`. Es lo que evita teclearle encima a un agente a media corrección (spec §5.3).
5. **`--reopen` va antes de teclear** (spec §5.4).
6. **El aplanado de cuerpo más anclas lo hace el adaptador**, no el brief (spec §4.3).
7. **`isInReview` devuelve un booleano**, no la etiqueta: la cadena `status:in-review` es infraestructura (spec §4.2).
8. **Un cambio se marca atendido antes de entregarse, y una entrega fallida no se reintenta.** Decisión existente, fijada por `a_delivery_that_failed_is_not_retried_forever_and_says_so`. No se toca.
9. **Si el `--reopen` funciona y el `cmux send` falla, el bucle queda parado y sólo se avisa.** No se parchea hasta saber si ocurre (spec §8).

## 3. Reference patterns

Leer antes de empezar. Cada pieza nueva tiene un hermano exacto ya escrito en el repo:

| Lo nuevo | Su hermano | Qué copiar |
|---|---|---|
| `PullRequests`, `Workbench` | `backend/src/domain/ports/harvest.js` | el `throw new Error` con el nombre del método y los argumentos |
| `GhPullRequests` | `backend/src/infrastructure/gh-plan-issues.js` | `static argvFor`, el parseo que distingue `NotRead` de `NotUnderstood` |
| `DispatchCheckWorkbench` | `backend/src/infrastructure/dispatch-check-harvest.js` | la proyección `#BY_CODE`, `declaredCodes()`, y negarse a interpretar un código no declarado |
| `ReadFixesAsked` | `backend/src/application/queries/read-changes-asked.js` | Params congelados, Result con una sola propiedad |
| `RequestFixes` | `backend/src/application/actions/review-plan.js` | la acción que sólo orquesta puertos |
| `DeliveryPolicy` | `backend/src/domain/policies/launch-policy.js` | la regla y su vocabulario en el mismo módulo |
| Test de query | `backend/__tests__/application/read-changes-asked.test.js` | `PlanIssuesDouble extends`, el `asking()` local |
| Test de acción | `backend/__tests__/application/review-plan.test.js` | la clase `Flow` como mother, `refusing(cause)` |
| Test de adaptador | `backend/__tests__/infrastructure/gh-plan-issues.test.js` | `GhDouble` con `answers` escritas y el `throw` cuando falta una |
| Cuarto paso | `frontend/src/pages/home/Home.tsx` | `WorkflowStep` con `status`, `isExpanded`, `canCollapse` |
| Mother de frontend | `frontend/src/__scenarios__/PlanEventsMother.ts` | el objeto con los frames como funciones |

## 4. Inventory

**Se crean (backend):**

| Fichero | Responsabilidad |
|---|---|
| `src/domain/value-objects/change-asked.js` | `ChangeAsked { id, text }`, extraído de `gh-plan-issues.js` |
| `src/domain/ports/pull-requests.js` | `PullRequests`: `openOf`, `fixesAsked` |
| `src/domain/ports/workbench.js` | `Workbench`: `reopen` |
| `src/domain/policies/delivery-policy.js` | `DeliveryState` y `DeliveryPolicy.of` |
| `src/application/queries/read-fixes-asked.js` | el tick del vigilante: localizar, mirar la puerta, leer |
| `src/application/queries/read-delivery-progress.js` | el lector del stream durante la entrega |
| `src/application/actions/request-fixes.js` | reabrir y teclear, en ese orden |
| `src/infrastructure/gh-pull-requests.js` | `GhPullRequests` y `OpenPullRequest` |
| `src/infrastructure/dispatch-check-workbench.js` | `DispatchCheckWorkbench` |
| `src/infrastructure/review-watch.js` | `ReviewWatch`, renombrado de `plan-review-watch.js` |

**Se modifican (backend):**

| Fichero | Cambio |
|---|---|
| `src/domain/exceptions.js` | `PullRequestFailure`, `PullRequestNotRead`, `PullRequestNotUnderstood`, `WorkbenchFailure`, `SliceNotReopened`, `ReopenNotUnderstood` |
| `src/domain/ports/plan-issues.js` | `isInReview` |
| `src/domain/ports/plan-agents.js` | `fix` |
| `src/domain/value-objects/plan-watch.js` | campo `delivering` |
| `src/infrastructure/gh-plan-issues.js` | `isInReview`, y `ChangeAsked` pasa a reexportarse desde dominio |
| `src/infrastructure/cmux-plan-agents.js` | `fix` |
| `src/infrastructure/plan-agent-brief.js` | `fixErrandFor` |
| `src/infrastructure/plan-events-route.js` | el stream elige lector y el frame lleva la pull request |
| `src/infrastructure/implement-plan-route.js` | releva los vigilantes en vez de apagarlos |
| `src/infrastructure/api-server.js` | un colaborador más |
| `src/infrastructure/ct-api.mjs` | el montaje |

**Se crean y modifican (frontend):**

| Fichero | Cambio |
|---|---|
| `src/app/plan-events/PlanEvents.types.ts` | `PlanState` con cinco valores, `PlanEvent` con `pullRequest` |
| `src/app/plan-events/client.ts` | pasa `pullRequest` al listener |
| `src/app/plan-events/usePlanProgress.ts` | las fases nuevas |
| `src/app/plan-events/components/plan-progress/PlanProgress.tsx` | recibe el progreso como propiedad |
| `src/app/plan-events/components/delivery-progress/DeliveryProgress.tsx` | crear: el contenido del cuarto paso |
| `src/pages/home/Home.tsx` | sube el hook, añade el cuarto paso |
| `src/__scenarios__/PlanEventsMother.ts` | los frames nuevos |

## 5. Interfaces

Las firmas que las tareas se pasan entre sí. Un implementador ve sólo su tarea: esto es de donde saca los nombres.

```js
// domain/value-objects/change-asked.js
class ChangeAsked { constructor({ id, text }) }          // congelado

// domain/ports/pull-requests.js
class PullRequests {
  async openOf({ issue, repository })                     // -> OpenPullRequest | null
  async fixesAsked({ pullRequest, repository })           // -> ChangeAsked[]
}

// domain/ports/workbench.js
class Workbench { async reopen({ issue, repository }) }   // -> undefined, o lanza

// domain/ports/plan-issues.js (añadido)
async isInReview({ issue, repository })                   // -> boolean

// domain/ports/plan-agents.js (añadido)
async fix({ agent, issue, repository, changes })          // -> undefined, o lanza

// domain/policies/delivery-policy.js
class DeliveryState { static IMPLEMENTING; static IN_REVIEW; static FIXING }
class DeliveryPolicy { static of({ pullRequest, inReview }) }   // -> DeliveryState

// infrastructure/gh-pull-requests.js
class OpenPullRequest { constructor({ number, url }) }    // congelado

// application/queries/read-fixes-asked.js
class ReadFixesAskedParams { constructor({ issue, repository }) }
class ReadFixesAsked {
  constructor({ pullRequests, planIssues })
  async execute(params)                                   // -> { changes: ChangeAsked[] }
}

// application/queries/read-delivery-progress.js
class ReadDeliveryProgressParams { constructor({ issue, repository }) }
class ReadDeliveryProgress {
  constructor({ pullRequests, planIssues })
  async execute(params)                                   // -> { state, pullRequest }
}

// application/actions/request-fixes.js
class RequestFixesParams { constructor({ agent, issue, repository, changes }) }
class RequestFixes {
  constructor({ workbench, planAgents })
  async execute(params)                                   // -> undefined, o lanza
}

// infrastructure/review-watch.js
class ReviewWatch { constructor({ asked, review, sleep, stderr, label }) }
```

`issue` es siempre un `PlanIssue` (`{ number, url }`) en los `Params` y en los puertos que reciben `{ issue, repository }`; es un número desnudo en `planAgents.fix({ issue })`, igual que en `review()`. `repository` es siempre un `RepositoryName`.

## 6. Test strategy

Outside-in, según `backend/conventions/testing.md`:

- **Aplicación:** los puertos doblados por constructor; la aserción es sobre lo que cada puerto recibió y lo que el caso de uso devolvió. El orden se fija con puntos de corte: cuando un paso falla, a los puertos posteriores no se les preguntó nada.
- **Adaptadores:** cortados justo antes de la herramienta; la aserción es el argv literal y el parseo de salida grabada real.
- **Dominio:** nada propio. `DeliveryPolicy` se mide a través de las dos queries que la llevan.
- **Frontend:** a través de `Home`, con `FakeEventSource` y los frames de `PlanEventsMother`.

**Las transcripciones tienen que ser reales.** La Tarea 2 empieza capturándolas de una pull request de verdad con los tres casos que llegan. Un fichero de transcripciones inventadas es un fallo de la tarea.

---

## 7. Tasks

### Task 1 — `ChangeAsked` sale a dominio

**Objective:** el value object que hoy vive dentro de `gh-plan-issues.js` pasa a su módulo, porque va a tener un segundo constructor. Refactor puro: ningún comportamiento cambia.

**Files:**
- Create: `backend/src/domain/value-objects/change-asked.js`
- Modify: `backend/src/infrastructure/gh-plan-issues.js` (quita la clase, la importa y la reexporta)
- Modify: `backend/__tests__/infrastructure/gh-plan-issues.test.js:2` (import)
- Modify: `backend/__tests__/infrastructure/plan-review-watch.test.js:3` (import)

**Interfaces:**
- Consumes: nada.
- Produces: `ChangeAsked { id, text }` desde `domain/value-objects/change-asked.js`.

- [ ] **Step 1: Correr la suite rápida y anotar que está verde**

```bash
cd backend && npx vitest run --exclude '**/*-real-process.test.js'
```
Esperado: PASS. Es la línea base: este refactor no puede cambiar ningún resultado.

- [ ] **Step 2: Crear el módulo del value object**

```js
// backend/src/domain/value-objects/change-asked.js
export class ChangeAsked {
  constructor({ id, text }) {
    this.id = id
    this.text = text
    Object.freeze(this)
  }
}
```

- [ ] **Step 3: Quitar la clase del adaptador y reexportarla**

En `backend/src/infrastructure/gh-plan-issues.js`, borrar el bloque `export class ChangeAsked { ... }` y añadir junto a los demás imports:

```js
import { ChangeAsked } from '../domain/value-objects/change-asked.js'
```

y, tras la clase `GhPlanIssues`, la línea que mantiene vivos los imports que ya existen:

```js
export { ChangeAsked }
```

- [ ] **Step 4: Apuntar los tests al módulo nuevo**

En `backend/__tests__/infrastructure/gh-plan-issues.test.js` y en `backend/__tests__/infrastructure/plan-review-watch.test.js`, cambiar el import de `ChangeAsked` para que venga de `../../src/domain/value-objects/change-asked.js`.

- [ ] **Step 5: Correr la suite rápida**

```bash
cd backend && npx vitest run --exclude '**/*-real-process.test.js'
```
Esperado: PASS, con el mismo número de tests que en el Step 1.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/value-objects/change-asked.js backend/src/infrastructure/gh-plan-issues.js backend/__tests__/infrastructure/gh-plan-issues.test.js backend/__tests__/infrastructure/plan-review-watch.test.js
git commit -m "refactor: move ChangeAsked to the domain for its second constructor"
```

---

### Task 2 — El puerto de pull requests y su adaptador

**Objective:** `GhPullRequests` localiza la pull request abierta de la rama del slice y traduce las reviews de GitHub a `ChangeAsked`, aplanando cuerpo y anclas.

**Files:**
- Create: `backend/src/domain/ports/pull-requests.js`
- Create: `backend/src/infrastructure/gh-pull-requests.js`
- Create: `backend/__tests__/infrastructure/gh-pull-requests.test.js`
- Create: `backend/__tests__/fixtures/gh-pull-request-reviews.json` (transcripción real)
- Modify: `backend/src/domain/exceptions.js` (tres clases nuevas al final)

**Interfaces:**
- Consumes: `ChangeAsked` de la Tarea 1.
- Produces: `PullRequests` con `openOf` y `fixesAsked`; `OpenPullRequest { number, url }`; `PullRequestNotRead` y `PullRequestNotUnderstood`.

- [ ] **Step 1: Capturar las transcripciones reales**

Sobre una pull request de verdad —vale la de este trabajo— dejar los tres casos que llegan: una review con cuerpo, una review con dos comentarios de línea, y un comentario de línea suelto sin abrir review. Luego:

```bash
gh api repos/<owner>/<repo>/pulls/<n>/reviews  > /tmp/reviews.json
gh api repos/<owner>/<repo>/pulls/<n>/comments > /tmp/comments.json
```

Guardar en `backend/__tests__/fixtures/gh-pull-request-reviews.json` un objeto con las dos respuestas tal como salieron, recortando sólo los campos que el adaptador lee (`id`, `state`, `body` en reviews; `body`, `path`, `line`, `pull_request_review_id` en comments) y anonimizando nombres de persona. Anotar en el mensaje del commit el número de la pull request de la que salieron.

Si no hay forma de capturarlas, **parar y decirlo**: `testing.md` prohíbe las formas inventadas y esta tarea no se puede cerrar sin ellas.

- [ ] **Step 2: Escribir los tests que fallan**

```js
// backend/__tests__/infrastructure/gh-pull-requests.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GhPullRequests, OpenPullRequest } from '../../src/infrastructure/gh-pull-requests.js'
import { Gh } from '../../src/infrastructure/gh.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.js'
import { SleepDouble } from '../sleep-double.js'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PullRequestNotRead, PullRequestNotUnderstood } from '../../src/domain/exceptions.js'

const RECORDED = JSON.parse(
  readFileSync(new URL('../fixtures/gh-pull-request-reviews.json', import.meta.url), 'utf8')
)

class GhDouble {
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static PULL_REQUEST = new OpenPullRequest({
    number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42',
  })
  static LISTED = `[{"number":42,"url":"https://github.com/josemerca/ct-loop-sandbox/pull/42"}]\n`

  constructor(answers) {
    this.answers = answers
    this.calls = []
    this.sleeping = new SleepDouble()
  }

  static answering(...printed) {
    return new GhDouble(printed.map((stdout) => new ProcessOutput({ code: 0, stdout, stderr: '' })))
  }

  static refusing(said) {
    return new GhDouble([new ProcessOutput({ code: 1, stdout: '', stderr: said })])
  }

  static reading() {
    return GhDouble.answering(JSON.stringify(RECORDED.reviews), JSON.stringify(RECORDED.comments))
  }

  pullRequests() {
    return new GhPullRequests({
      gh: new Gh({
        launch: (argv) => {
          this.calls.push(argv)
          const answer = this.answers[this.calls.length - 1]
          if (answer === undefined) {
            throw new Error(`nobody wrote an answer for call ${this.calls.length}: ${argv.join(' ')}`)
          }

          return Promise.resolve(answer)
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 3, waitSeconds: 2 }) }),
        sleep: (seconds) => this.sleeping.sleep(seconds),
      }),
    })
  }

  async openOf() {
    return this.pullRequests().openOf({ issue: GhDouble.ISSUE, repository: GhDouble.REPOSITORY })
  }

  async fixesAsked() {
    return this.pullRequests()
      .fixesAsked({ pullRequest: GhDouble.PULL_REQUEST, repository: GhDouble.REPOSITORY })
  }
}

describe('GhPullRequests', () => {
  it('the_branch_it_asks_about_is_the_one_the_loop_derives_from_the_issue', async () => {
    const gh = GhDouble.answering(GhDouble.LISTED)

    await gh.openOf()

    expect(gh.calls).toEqual([[
      'pr', 'list', '--repo', 'josemerca/ct-loop-sandbox',
      '--head', 'feat/7', '--state', 'open', '--json', 'number,url', '--limit', '1',
    ]])
  })

  it('a_branch_with_no_pull_request_answers_null_and_not_an_empty_object', async () => {
    const found = await GhDouble.answering('[]\n').openOf()

    expect(found).toBeNull()
  })

  it('the_pull_request_it_found_carries_the_number_and_the_url_gh_reported', async () => {
    const found = await GhDouble.answering(GhDouble.LISTED).openOf()

    expect(found).toEqual(GhDouble.PULL_REQUEST)
  })

  it('gh_refusing_to_list_travels_out_as_not_read_and_not_as_an_absent_pull_request', async () => {
    const refusal = await GhDouble.refusing('HTTP 404').openOf().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotRead)
    expect(refusal).not.toBeInstanceOf(PullRequestNotUnderstood)
  })

  it('a_listing_that_is_not_json_travels_out_as_not_understood', async () => {
    const refusal = await GhDouble.answering('no soy json\n').openOf().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotUnderstood)
    expect(refusal).not.toBeInstanceOf(PullRequestNotRead)
  })

  it('it_reads_the_reviews_and_the_line_comments_of_that_pull_request', async () => {
    const gh = GhDouble.reading()

    await gh.fixesAsked()

    expect(gh.calls).toEqual([
      ['api', 'repos/josemerca/ct-loop-sandbox/pulls/42/reviews'],
      ['api', 'repos/josemerca/ct-loop-sandbox/pulls/42/comments'],
    ])
  })

  it('a_review_with_a_body_and_its_line_comments_is_flattened_into_one_change', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([{ id: 101, state: 'CHANGES_REQUESTED', body: 'varias cosas' }]),
        stderr: '',
      }),
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([
          { body: 'revienta con []', path: 'src/foo.js', line: 42, pull_request_review_id: 101 },
          { body: 'esto sobra', path: 'src/bar.js', line: 17, pull_request_review_id: 101 },
        ]),
        stderr: '',
      }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked).toEqual([new ChangeAsked({
      id: '101',
      text: 'varias cosas\nsrc/foo.js:42: revienta con []\nsrc/bar.js:17: esto sobra',
    })])
  })

  it('a_lone_line_comment_with_no_review_body_is_a_change_too_because_that_is_how_github_wraps_it', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([{ id: 102, state: 'COMMENTED', body: '' }]),
        stderr: '',
      }),
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([
          { body: 'esta linea sobra', path: 'src/foo.js', line: 9, pull_request_review_id: 102 },
        ]),
        stderr: '',
      }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked).toEqual([new ChangeAsked({ id: '102', text: 'src/foo.js:9: esta linea sobra' })])
  })

  it('a_comment_with_no_line_is_anchored_to_its_file_alone', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([{ id: 103, state: 'COMMENTED', body: '' }]),
        stderr: '',
      }),
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([
          { body: 'este fichero entero', path: 'src/foo.js', line: null, pull_request_review_id: 103 },
        ]),
        stderr: '',
      }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked).toEqual([new ChangeAsked({ id: '103', text: 'src/foo.js: este fichero entero' })])
  })

  it('an_approval_a_draft_and_a_dismissal_ask_for_nothing', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([
          { id: 1, state: 'APPROVED', body: 'se ve bien' },
          { id: 2, state: 'PENDING', body: 'todavia lo escribo' },
          { id: 3, state: 'DISMISSED', body: 'descartada' },
        ]),
        stderr: '',
      }),
      new ProcessOutput({ code: 0, stdout: '[]', stderr: '' }),
    ])

    expect(await gh.fixesAsked()).toEqual([])
  })

  it('a_review_with_neither_body_nor_comments_asks_for_nothing', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([{ id: 4, state: 'COMMENTED', body: '   ' }]),
        stderr: '',
      }),
      new ProcessOutput({ code: 0, stdout: '[]', stderr: '' }),
    ])

    expect(await gh.fixesAsked()).toEqual([])
  })

  it('the_changes_come_back_in_the_order_of_the_review_ids_so_the_oldest_is_attended_first', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([
          { id: 150, state: 'CHANGES_REQUESTED', body: 'la segunda vuelta' },
          { id: 101, state: 'CHANGES_REQUESTED', body: 'la primera' },
        ]),
        stderr: '',
      }),
      new ProcessOutput({ code: 0, stdout: '[]', stderr: '' }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked.map((change) => change.text)).toEqual(['la primera', 'la segunda vuelta'])
  })

  it('a_review_gh_sent_without_the_fields_this_reads_travels_out_as_not_understood', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 0, stdout: JSON.stringify([{ id: 101 }]), stderr: '' }),
      new ProcessOutput({ code: 0, stdout: '[]', stderr: '' }),
    ])

    const refusal = await gh.fixesAsked().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotUnderstood)
  })

  it('the_recorded_transcript_of_a_real_pull_request_is_read_without_being_rejected', async () => {
    const asked = await GhDouble.reading().fixesAsked()

    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((change) => change instanceof ChangeAsked)).toBe(true)
  })
})
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/infrastructure/gh-pull-requests.test.js
```
Esperado: FAIL, no resuelve `../../src/infrastructure/gh-pull-requests.js`.

- [ ] **Step 4: Añadir las excepciones**

Al final de `backend/src/domain/exceptions.js`:

```js
export class PullRequestFailure extends PlanFailure {}

export class PullRequestNotRead extends PullRequestFailure {}

export class PullRequestNotUnderstood extends PullRequestFailure {}
```

- [ ] **Step 5: Escribir el puerto**

```js
// backend/src/domain/ports/pull-requests.js
export class PullRequests {
  async openOf({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement openOf({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }

  async fixesAsked({ pullRequest, repository }) {
    throw new Error(
      `${this.constructor.name} must implement fixesAsked({ pullRequest, repository }), asked for ${pullRequest?.number} in ${repository}`
    )
  }
}
```

- [ ] **Step 6: Escribir el adaptador**

```js
// backend/src/infrastructure/gh-pull-requests.js
import { PullRequests } from '../domain/ports/pull-requests.js'
import { ChangeAsked } from '../domain/value-objects/change-asked.js'
import { PullRequestNotRead, PullRequestNotUnderstood } from '../domain/exceptions.js'
import { Gh } from './gh.js'

export class OpenPullRequest {
  constructor({ number, url }) {
    this.number = number
    this.url = url
    Object.freeze(this)
  }
}

export class GhPullRequests extends PullRequests {
  static ASKS = Object.freeze(['CHANGES_REQUESTED', 'COMMENTED'])

  constructor({ gh }) {
    super()
    this.gh = gh
  }

  static branchOf(issue) {
    return `feat/${issue.number}`
  }

  static listArgvFor({ issue, repository }) {
    return [
      'pr', 'list', '--repo', repository.text,
      '--head', GhPullRequests.branchOf(issue),
      '--state', 'open', '--json', 'number,url', '--limit', '1',
    ]
  }

  static reviewsArgvFor({ pullRequest, repository }) {
    return ['api', `repos/${repository.text}/pulls/${pullRequest.number}/reviews`]
  }

  static commentsArgvFor({ pullRequest, repository }) {
    return ['api', `repos/${repository.text}/pulls/${pullRequest.number}/comments`]
  }

  async openOf({ issue, repository }) {
    const printed = await this.#read(GhPullRequests.listArgvFor({ issue, repository }))
    const listed = GhPullRequests.#arrayIn(printed, `the pull requests of ${GhPullRequests.branchOf(issue)}`)
    if (listed.length === 0) return null

    const found = listed[0]
    if (!Number.isInteger(found?.number) || typeof found?.url !== 'string') {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} named a pull request without the number and the url this reads, it printed ${JSON.stringify(printed)}`
      )
    }

    return new OpenPullRequest({ number: found.number, url: found.url })
  }

  async fixesAsked({ pullRequest, repository }) {
    const reviews = GhPullRequests.#arrayIn(
      await this.#read(GhPullRequests.reviewsArgvFor({ pullRequest, repository })),
      `the reviews of #${pullRequest.number}`
    )
    const comments = GhPullRequests.#arrayIn(
      await this.#read(GhPullRequests.commentsArgvFor({ pullRequest, repository })),
      `the comments of #${pullRequest.number}`
    )
    const anchored = GhPullRequests.#byReview(comments, pullRequest)

    return GhPullRequests.#asked(reviews, anchored, pullRequest)
  }

  static #asked(reviews, anchored, pullRequest) {
    const changes = []
    for (const review of [...reviews].sort((one, other) => GhPullRequests.#idOf(one, pullRequest) - GhPullRequests.#idOf(other, pullRequest))) {
      const id = GhPullRequests.#idOf(review, pullRequest)
      const carried = anchored.get(id) ?? []
      if (!GhPullRequests.#asksForAChange(review, carried, pullRequest)) continue

      changes.push(new ChangeAsked({ id: String(id), text: GhPullRequests.#textOf(review, carried) }))
    }

    return changes
  }

  static #asksForAChange(review, carried, pullRequest) {
    if (typeof review?.state !== 'string' || typeof review?.body !== 'string') {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} sent a review of #${pullRequest.number} without the state and the body this reads, it printed ${JSON.stringify(review)}`
      )
    }
    if (!GhPullRequests.ASKS.includes(review.state)) return false

    return review.body.trim().length > 0 || carried.length > 0
  }

  static #textOf(review, carried) {
    const parts = review.body.trim().length > 0 ? [review.body.trim()] : []
    parts.push(...carried.map((comment) => GhPullRequests.#anchored(comment)))

    return parts.join('\n')
  }

  static #anchored(comment) {
    const where = Number.isInteger(comment.line) ? `${comment.path}:${comment.line}` : comment.path

    return `${where}: ${comment.body.trim()}`
  }

  static #byReview(comments, pullRequest) {
    const anchored = new Map()
    for (const comment of comments) {
      if (typeof comment?.body !== 'string' || typeof comment?.path !== 'string') {
        throw new PullRequestNotUnderstood(
          `${Gh.BIN} sent a comment of #${pullRequest.number} without the body and the path this reads, it printed ${JSON.stringify(comment)}`
        )
      }
      const id = comment.pull_request_review_id
      if (!anchored.has(id)) anchored.set(id, [])
      anchored.get(id).push(comment)
    }

    return anchored
  }

  static #idOf(review, pullRequest) {
    if (!Number.isInteger(review?.id)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} sent a review of #${pullRequest.number} without the id this reads, it printed ${JSON.stringify(review)}`
      )
    }

    return review.id
  }

  static #arrayIn(printed, what) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} answered something that is not json for ${what}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed)) {
      throw new PullRequestNotUnderstood(
        `${Gh.BIN} answered ${what} without a list, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed
  }

  async #read(argv) {
    const outcome = await this.gh.run(argv, { safeToRepeat: true })
    if (outcome.failed) {
      throw new PullRequestNotRead(`${Gh.BIN} ${argv[0]} failed: ${outcome.stderr.trim()}`)
    }

    return outcome.stdout
  }
}
```

- [ ] **Step 7: Correr los tests hasta verde**

```bash
cd backend && npx vitest run __tests__/infrastructure/gh-pull-requests.test.js
```
Esperado: PASS, los catorce.

- [ ] **Step 8: Correr la suite rápida**

```bash
cd backend && npx vitest run --exclude '**/*-real-process.test.js'
```
Esperado: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/domain/ports/pull-requests.js backend/src/infrastructure/gh-pull-requests.js backend/src/domain/exceptions.js backend/__tests__/infrastructure/gh-pull-requests.test.js backend/__tests__/fixtures/gh-pull-request-reviews.json
git commit -m "feat: read the reviews of a pull request as changes asked for"
```

---

### Task 3 — La etiqueta del issue se puede preguntar

**Objective:** `GhPlanIssues` contesta si el issue está exactamente en `status:in-review`, que es la puerta del vigilante.

**Files:**
- Modify: `backend/src/domain/ports/plan-issues.js` (método nuevo)
- Modify: `backend/src/infrastructure/gh-plan-issues.js` (`isInReview` y su argv)
- Modify: `backend/__tests__/infrastructure/gh-plan-issues.test.js` (escenarios nuevos en `GhDouble`)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `PlanIssues.isInReview({ issue, repository })` que devuelve un booleano, y lanza `PlanChangesNotRead` o `PlanChangesNotUnderstood` reutilizando el catálogo del adaptador.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `GhDouble` en `backend/__tests__/infrastructure/gh-plan-issues.test.js`:

```js
  static labelled(...names) {
    return GhDouble.created(JSON.stringify({ labels: names.map((name) => ({ name })) }))
  }

  async inReviewFor(issue = GhDouble.OPENED) {
    return this.issues().isInReview({ issue, repository: GhDouble.REPOSITORY })
  }
```

y estos tests al `describe` que ya existe:

```js
  it('asking_whether_an_issue_is_in_review_reads_its_labels_and_nothing_else', async () => {
    const gh = GhDouble.labelled('status:in-review')

    await gh.inReviewFor()

    expect(gh.calls).toEqual([[
      'issue', 'view', '7', '--repo', 'josemerca/ct-loop-sandbox', '--json', 'labels',
    ]])
  })

  it('an_issue_carrying_only_the_in_review_label_is_in_review', async () => {
    expect(await GhDouble.labelled('status:in-review').inReviewFor()).toBe(true)
  })

  it('an_issue_in_progress_is_not_in_review_so_the_gate_stays_shut_while_it_is_being_fixed', async () => {
    expect(await GhDouble.labelled('status:in-progress').inReviewFor()).toBe(false)
  })

  it('an_issue_carrying_two_status_labels_at_once_is_not_in_review_because_that_state_is_ambiguous', async () => {
    expect(await GhDouble.labelled('status:in-review', 'status:in-progress').inReviewFor()).toBe(false)
  })

  it('an_issue_with_no_status_label_is_not_in_review', async () => {
    expect(await GhDouble.labelled('area:plan').inReviewFor()).toBe(false)
  })

  it('gh_refusing_to_read_the_labels_travels_out_typed_instead_of_answering_false', async () => {
    const refusal = await GhDouble.refusing('HTTP 404').inReviewFor().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanChangesNotRead)
    expect(refusal).not.toBeInstanceOf(PlanChangesNotUnderstood)
  })

  it('labels_gh_sent_in_a_shape_this_cannot_read_travel_out_as_not_understood', async () => {
    const refusal = await GhDouble.created('{"labels":"ninguna"}').inReviewFor().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanChangesNotUnderstood)
    expect(refusal).not.toBeInstanceOf(PlanChangesNotRead)
  })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js
```
Esperado: FAIL, `isInReview is not a function`.

- [ ] **Step 3: Declarar el método en el puerto**

En `backend/src/domain/ports/plan-issues.js`, junto a los demás:

```js
  async isInReview({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement isInReview({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }
```

- [ ] **Step 4: Implementarlo en el adaptador**

En `backend/src/infrastructure/gh-plan-issues.js`, junto a los demás `static ...ArgvFor`:

```js
  static labelsArgvFor({ issue, repository }) {
    return ['issue', 'view', String(issue.number), '--repo', repository.text, '--json', 'labels']
  }
```

y como método:

```js
  async isInReview({ issue, repository }) {
    const outcome = await this.gh.run(
      GhPlanIssues.labelsArgvFor({ issue, repository }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      throw new PlanChangesNotRead(`${Gh.BIN} issue view failed: ${outcome.stderr.trim()}`)
    }

    return GhPlanIssues.#onlyStatusIn(outcome.stdout, issue) === GhPlanIssues.IN_REVIEW_LABEL
  }

  static #onlyStatusIn(printed, issue) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered something that is not json for the labels of ${issue.number}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (!Array.isArray(parsed?.labels)) {
      throw new PlanChangesNotUnderstood(
        `${Gh.BIN} answered without the labels of ${issue.number}, it printed ${JSON.stringify(printed)}`
      )
    }
    const status = parsed.labels
      .map((label) => label?.name)
      .filter((name) => typeof name === 'string' && name.startsWith('status:'))

    return status.length === 1 ? status[0] : null
  }
```

- [ ] **Step 5: Correr los tests hasta verde**

```bash
cd backend && npx vitest run __tests__/infrastructure/gh-plan-issues.test.js
```
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/ports/plan-issues.js backend/src/infrastructure/gh-plan-issues.js backend/__tests__/infrastructure/gh-plan-issues.test.js
git commit -m "feat: ask an issue whether it stands exactly in review"
```

---

### Task 4 — El banco de trabajo: `--reopen` detrás de un puerto

**Objective:** `DispatchCheckWorkbench` devuelve el issue de `in-review` a `in-progress`, proyectando cada código que `dispatch-check --reopen` declara y negándose a interpretar uno que no.

**Files:**
- Create: `backend/src/domain/ports/workbench.js`
- Create: `backend/src/infrastructure/dispatch-check-workbench.js`
- Create: `backend/__tests__/infrastructure/dispatch-check-workbench.test.js`
- Modify: `backend/src/domain/exceptions.js` (tres clases nuevas)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `Workbench.reopen({ issue, repository })`; `SliceNotReopened` y `ReopenNotUnderstood` bajo `WorkbenchFailure`; `DispatchCheckWorkbench.declaredCodes()`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// backend/__tests__/infrastructure/dispatch-check-workbench.test.js
import { describe, it, expect } from 'vitest'
import { DispatchCheckWorkbench } from '../../src/infrastructure/dispatch-check-workbench.js'
import { Workbench } from '../../src/domain/ports/workbench.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { SliceNotReopened, ReopenNotUnderstood } from '../../src/domain/exceptions.js'

class NodeDouble {
  static DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor(answer) {
    this.answer = answer
    this.calls = []
  }

  static exiting(code, { stdout = '', stderr = '' } = {}) {
    return new NodeDouble(new ProcessOutput({ code, stdout, stderr }))
  }

  workbench() {
    return new DispatchCheckWorkbench({
      node: (argv, options) => {
        this.calls.push({ argv, options })

        return Promise.resolve(this.answer)
      },
      dispatchCheck: NodeDouble.DISPATCH_CHECK,
    })
  }

  async reopen() {
    return this.workbench().reopen({ issue: NodeDouble.ISSUE, repository: NodeDouble.REPOSITORY })
  }

  async refusal() {
    return this.reopen().catch((cause) => cause)
  }
}

describe('DispatchCheckWorkbench', () => {
  it('the_invocation_it_sends_is_the_reopen_of_that_issue_in_that_repository', async () => {
    const node = NodeDouble.exiting(0)

    await node.reopen()

    expect(node.calls.map((call) => call.argv)).toEqual([[
      NodeDouble.DISPATCH_CHECK, '7', '--repo', 'josemerca/ct-loop-sandbox', '--reopen',
    ]])
  })

  it('a_reopened_slice_comes_back_without_a_refusal_so_the_errand_can_be_typed', async () => {
    await expect(NodeDouble.exiting(0).reopen()).resolves.toBeUndefined()
  })

  it('a_label_that_could_not_be_written_travels_out_as_not_reopened_because_the_issue_stays_in_review', async () => {
    const refusal = await NodeDouble.exiting(1, { stderr: 'no se pudo reabrir #7' }).refusal()

    expect(refusal).toBeInstanceOf(SliceNotReopened)
    expect(refusal).not.toBeInstanceOf(ReopenNotUnderstood)
    expect(refusal.message).toContain('no se pudo reabrir #7')
  })

  it('a_precondition_that_does_not_hold_travels_out_as_not_reopened_and_says_nothing_was_touched', async () => {
    const refusal = await NodeDouble.exiting(2, { stderr: '#7 ya está en status:ready' }).refusal()

    expect(refusal).toBeInstanceOf(SliceNotReopened)
    expect(refusal.message).toContain('ya está en status:ready')
  })

  it('a_state_that_could_not_be_read_travels_out_as_not_reopened_so_the_next_tick_can_try_again', async () => {
    const refusal = await NodeDouble.exiting(3, { stderr: 'no se pudo leer el estado' }).refusal()

    expect(refusal).toBeInstanceOf(SliceNotReopened)
  })

  it('a_code_the_contract_never_declared_travels_out_as_not_understood_instead_of_being_guessed', async () => {
    const refusal = await NodeDouble.exiting(9, { stdout: 'algo', stderr: 'otra cosa' }).refusal()

    expect(refusal).toBeInstanceOf(ReopenNotUnderstood)
    expect(refusal).not.toBeInstanceOf(SliceNotReopened)
    expect(refusal.message).toContain('9')
  })

  it('the_declared_codes_are_the_four_the_reopen_contract_names', () => {
    expect(DispatchCheckWorkbench.declaredCodes().sort()).toEqual([0, 1, 2, 3])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new Workbench().reopen({
      issue: NodeDouble.ISSUE, repository: NodeDouble.REPOSITORY,
    })).rejects.toThrow(/must implement reopen/)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/infrastructure/dispatch-check-workbench.test.js
```
Esperado: FAIL, no resuelve los dos módulos nuevos.

- [ ] **Step 3: Añadir las excepciones**

Al final de `backend/src/domain/exceptions.js`:

```js
export class WorkbenchFailure extends PlanFailure {}

export class SliceNotReopened extends WorkbenchFailure {}

export class ReopenNotUnderstood extends WorkbenchFailure {}
```

- [ ] **Step 4: Escribir el puerto**

```js
// backend/src/domain/ports/workbench.js
export class Workbench {
  async reopen({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement reopen({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }
}
```

- [ ] **Step 5: Escribir el adaptador**

```js
// backend/src/infrastructure/dispatch-check-workbench.js
import { Workbench } from '../domain/ports/workbench.js'
import { SliceNotReopened, ReopenNotUnderstood } from '../domain/exceptions.js'

export class DispatchCheckWorkbench extends Workbench {
  static COMMAND = 'dispatch-check --reopen'
  static REOPENED = 0
  static LABEL_NOT_WRITTEN = 1
  static PRECONDITION_UNMET = 2
  static STATE_NOT_READ = 3

  static #BY_CODE = Object.freeze({
    [DispatchCheckWorkbench.REOPENED]: () => undefined,
    [DispatchCheckWorkbench.LABEL_NOT_WRITTEN]: (said, issue) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} could not move the label of #${issue.number}, which stays in review: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckWorkbench.PRECONDITION_UNMET]: (said, issue) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} refused to reopen #${issue.number} and touched no label: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckWorkbench.STATE_NOT_READ]: (said, issue) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} could not read the state of #${issue.number} and touched no label, so the next tick can try again: ${said.stderr.trim()}`
      )
    },
  })

  constructor({ node, dispatchCheck }) {
    super()
    this.node = node
    this.dispatchCheck = dispatchCheck
  }

  static argvFor({ dispatchCheck, issue, repository }) {
    return [dispatchCheck, String(issue.number), '--repo', repository.text, '--reopen']
  }

  static declaredCodes() {
    return Object.keys(DispatchCheckWorkbench.#BY_CODE).map(Number)
  }

  async reopen({ issue, repository }) {
    const said = await this.node(
      DispatchCheckWorkbench.argvFor({ dispatchCheck: this.dispatchCheck, issue, repository })
    )
    const projected = DispatchCheckWorkbench.#BY_CODE[said.code]
    if (projected === undefined) {
      throw new ReopenNotUnderstood(
        `${DispatchCheckWorkbench.COMMAND} exited ${said.code} for #${issue.number} and the reopen contract declares only ${DispatchCheckWorkbench.declaredCodes().join(', ')}: stdout ${JSON.stringify(said.stdout.trim())}, stderr ${JSON.stringify(said.stderr.trim())}`
      )
    }

    return projected(said, issue)
  }
}
```

- [ ] **Step 6: Correr los tests hasta verde**

```bash
cd backend && npx vitest run __tests__/infrastructure/dispatch-check-workbench.test.js
```
Esperado: PASS, los ocho.

- [ ] **Step 7: Commit**

```bash
git add backend/src/domain/ports/workbench.js backend/src/infrastructure/dispatch-check-workbench.js backend/src/domain/exceptions.js backend/__tests__/infrastructure/dispatch-check-workbench.test.js
git commit -m "feat: send a reviewed slice back to the workbench"
```

---

### Task 5 — El tick del vigilante: la política y la query

**Objective:** `ReadFixesAsked` localiza la pull request, mira la puerta y sólo entonces lee las reviews. `DeliveryPolicy` decide, y se mide a través de esta query.

**Files:**
- Create: `backend/src/domain/policies/delivery-policy.js`
- Create: `backend/src/application/queries/read-fixes-asked.js`
- Create: `backend/__tests__/application/read-fixes-asked.test.js`

**Interfaces:**
- Consumes: `PullRequests` y `OpenPullRequest` (Tarea 2), `PlanIssues.isInReview` (Tarea 3), `ChangeAsked` (Tarea 1).
- Produces: `ReadFixesAsked` con `execute` que devuelve `{ changes }`; `DeliveryState.IMPLEMENTING`, `DeliveryState.IN_REVIEW`, `DeliveryState.FIXING`; `DeliveryPolicy.of({ pullRequest, inReview })`.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// backend/__tests__/application/read-fixes-asked.test.js
import { describe, it, expect } from 'vitest'
import { ReadFixesAsked, ReadFixesAskedParams } from '../../src/application/queries/read-fixes-asked.js'
import { PullRequests } from '../../src/domain/ports/pull-requests.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { OpenPullRequest } from '../../src/infrastructure/gh-pull-requests.js'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PullRequestNotRead } from '../../src/domain/exceptions.js'

class PullRequestsDouble extends PullRequests {
  constructor({ open = null, asked = [], failing = null } = {}) {
    super()
    this.open = open
    this.answer = asked
    this.failing = failing
    this.located = []
    this.read = []
  }

  async openOf(subject) {
    this.located.push(subject)
    if (this.failing !== null) throw this.failing

    return this.open
  }

  async fixesAsked(subject) {
    this.read.push(subject)

    return this.answer
  }
}

class PlanIssuesDouble extends PlanIssues {
  constructor(inReview = true) {
    super()
    this.inReview = inReview
    this.asked = []
  }

  async isInReview(subject) {
    this.asked.push(subject)

    return this.inReview
  }
}

class Flow {
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static PULL_REQUEST = new OpenPullRequest({
    number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42',
  })
  static A_CHANGE = new ChangeAsked({ id: '101', text: 'src/foo.js:42: revienta con []' })

  constructor({ pullRequests, planIssues } = {}) {
    this.pullRequests = pullRequests ?? new PullRequestsDouble()
    this.planIssues = planIssues ?? new PlanIssuesDouble()
  }

  static implementing() {
    return new Flow({ pullRequests: new PullRequestsDouble({ open: null }) })
  }

  static inReview(asked = [Flow.A_CHANGE]) {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST, asked }),
      planIssues: new PlanIssuesDouble(true),
    })
  }

  static fixing() {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST, asked: [Flow.A_CHANGE] }),
      planIssues: new PlanIssuesDouble(false),
    })
  }

  async run() {
    return new ReadFixesAsked(this).execute(new ReadFixesAskedParams({
      issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    }))
  }
}

describe('ReadFixesAsked', () => {
  it('the_pull_request_it_looks_for_is_the_one_of_the_issue_and_the_repository_it_was_given', async () => {
    const flow = Flow.inReview()

    await flow.run()

    expect(flow.pullRequests.located).toEqual([{ issue: Flow.ISSUE, repository: Flow.REPOSITORY }])
  })

  it('a_branch_with_no_pull_request_yet_asks_for_no_reviews_because_there_is_nothing_to_review', async () => {
    const flow = Flow.implementing()

    const read = await flow.run()

    expect(read.changes).toEqual([])
    expect(flow.pullRequests.read).toEqual([])
    expect(flow.planIssues.asked).toEqual([])
  })

  it('an_issue_still_being_fixed_hands_nothing_over_so_nothing_is_typed_over_a_busy_agent', async () => {
    const flow = Flow.fixing()

    const read = await flow.run()

    expect(read.changes).toEqual([])
    expect(flow.pullRequests.read).toEqual([])
  })

  it('an_issue_in_review_hands_over_every_change_asked_for_in_its_pull_request', async () => {
    const flow = Flow.inReview()

    const read = await flow.run()

    expect(read.changes).toEqual([Flow.A_CHANGE])
    expect(flow.pullRequests.read).toEqual([
      { pullRequest: Flow.PULL_REQUEST, repository: Flow.REPOSITORY },
    ])
  })

  it('a_pull_request_in_review_with_nothing_asked_of_it_answers_an_empty_list_and_not_a_null', async () => {
    const read = await Flow.inReview([]).run()

    expect(read.changes).toEqual([])
  })

  it('the_gate_is_asked_about_the_issue_and_the_repository_it_was_given', async () => {
    const flow = Flow.inReview()

    await flow.run()

    expect(flow.planIssues.asked).toEqual([{ issue: Flow.ISSUE, repository: Flow.REPOSITORY }])
  })

  it('a_pull_request_that_could_not_be_located_travels_out_typed_instead_of_looking_like_no_pull_request', async () => {
    const flow = new Flow({
      pullRequests: new PullRequestsDouble({ failing: new PullRequestNotRead('HTTP 502') }),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotRead)
    expect(flow.planIssues.asked).toEqual([])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PullRequests().openOf({ issue: Flow.ISSUE, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement openOf/)
    await expect(new PlanIssues().isInReview({ issue: Flow.ISSUE, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement isInReview/)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/application/read-fixes-asked.test.js
```
Esperado: FAIL, no resuelve `read-fixes-asked.js`.

- [ ] **Step 3: Escribir la política**

```js
// backend/src/domain/policies/delivery-policy.js
export class DeliveryState {
  static IMPLEMENTING = 'implementing'
  static IN_REVIEW = 'in-review'
  static FIXING = 'fixing'
}

export class DeliveryPolicy {
  static of({ pullRequest, inReview }) {
    if (pullRequest === null) return DeliveryState.IMPLEMENTING

    return inReview ? DeliveryState.IN_REVIEW : DeliveryState.FIXING
  }
}
```

- [ ] **Step 4: Escribir la query**

```js
// backend/src/application/queries/read-fixes-asked.js
import { DeliveryPolicy, DeliveryState } from '../../domain/policies/delivery-policy.js'

export class ReadFixesAskedParams {
  constructor({ issue, repository }) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadFixesAskedResult {
  constructor({ changes }) {
    this.changes = changes
    Object.freeze(this)
  }
}

export class ReadFixesAsked {
  constructor({ pullRequests, planIssues }) {
    this.pullRequests = pullRequests
    this.planIssues = planIssues
  }

  async execute(params) {
    const pullRequest = await this.pullRequests.openOf({
      issue: params.issue, repository: params.repository,
    })
    if (pullRequest === null) return new ReadFixesAskedResult({ changes: [] })

    const inReview = await this.planIssues.isInReview({
      issue: params.issue, repository: params.repository,
    })
    if (DeliveryPolicy.of({ pullRequest, inReview }) !== DeliveryState.IN_REVIEW) {
      return new ReadFixesAskedResult({ changes: [] })
    }

    return new ReadFixesAskedResult({
      changes: await this.pullRequests.fixesAsked({ pullRequest, repository: params.repository }),
    })
  }
}
```

- [ ] **Step 5: Correr los tests hasta verde**

```bash
cd backend && npx vitest run __tests__/application/read-fixes-asked.test.js
```
Esperado: PASS, los ocho.

- [ ] **Step 6: Commit**

```bash
git add backend/src/domain/policies/delivery-policy.js backend/src/application/queries/read-fixes-asked.js backend/__tests__/application/read-fixes-asked.test.js
git commit -m "feat: read the fixes asked for only while the issue stands in review"
```

---

### Task 6 — La acción que reabre y entrega, en ese orden

**Objective:** `RequestFixes` devuelve el issue al banco de trabajo y sólo entonces teclea el encargo. Si el reabrir falla, al agente no se le dice nada.

**Files:**
- Create: `backend/src/application/actions/request-fixes.js`
- Create: `backend/__tests__/application/request-fixes.test.js`
- Modify: `backend/src/domain/ports/plan-agents.js` (`fix`)

**Interfaces:**
- Consumes: `Workbench.reopen` (Tarea 4).
- Produces: `RequestFixes` con `execute`; `PlanAgents.fix({ agent, issue, repository, changes })`, donde `issue` es un número desnudo.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// backend/__tests__/application/request-fixes.test.js
import { describe, it, expect } from 'vitest'
import { RequestFixes, RequestFixesParams } from '../../src/application/actions/request-fixes.js'
import { Workbench } from '../../src/domain/ports/workbench.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { SliceNotReopened, PlanAgentNotResumed } from '../../src/domain/exceptions.js'

class WorkbenchDouble extends Workbench {
  constructor(failing = null) {
    super()
    this.failing = failing
    this.asked = []
  }

  static refusing(cause) {
    return new WorkbenchDouble(cause)
  }

  async reopen(subject) {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing
  }
}

class PlanAgentsDouble extends PlanAgents {
  constructor(failing = null) {
    super()
    this.failing = failing
    this.asked = []
  }

  static refusing(cause) {
    return new PlanAgentsDouble(cause)
  }

  async fix(subject) {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing
  }
}

class Flow {
  static AGENT = 'workspace:20'
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static CHANGES = 'src/foo.js:42: revienta con []'

  constructor({ workbench, planAgents } = {}) {
    this.workbench = workbench ?? new WorkbenchDouble()
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  static reopened() {
    return new Flow()
  }

  static refusingTheReopen(cause = new SliceNotReopened('sigue en in-review')) {
    return new Flow({ workbench: WorkbenchDouble.refusing(cause) })
  }

  async run() {
    return new RequestFixes(this).execute(new RequestFixesParams({
      agent: Flow.AGENT,
      issue: Flow.ISSUE,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
    }))
  }
}

describe('RequestFixes', () => {
  it('the_issue_goes_back_to_the_workbench_before_the_agent_is_told_anything', async () => {
    const flow = Flow.reopened()

    await flow.run()

    expect(flow.workbench.asked).toEqual([{ issue: Flow.ISSUE, repository: Flow.REPOSITORY }])
    expect(flow.planAgents.asked).toEqual([{
      agent: Flow.AGENT,
      issue: Flow.ISSUE.number,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
    }])
  })

  it('a_reopen_that_failed_leaves_the_agent_untold_so_the_change_is_not_half_delivered', async () => {
    const flow = Flow.refusingTheReopen()

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(SliceNotReopened)
    expect(flow.planAgents.asked).toEqual([])
  })

  it('an_agent_that_cannot_be_reached_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({
      planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toBe('no such workspace')
  })

  it('the_agent_it_types_into_is_the_handle_it_was_given_and_not_one_it_derived', async () => {
    const flow = Flow.reopened()

    await flow.run()

    expect(flow.planAgents.asked[0].agent).toBe(Flow.AGENT)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().fix({
      agent: Flow.AGENT, issue: Flow.ISSUE.number, repository: Flow.REPOSITORY, changes: Flow.CHANGES,
    })).rejects.toThrow(/must implement fix/)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/application/request-fixes.test.js
```
Esperado: FAIL, no resuelve `request-fixes.js`.

- [ ] **Step 3: Declarar `fix` en el puerto de agentes**

En `backend/src/domain/ports/plan-agents.js`, junto a `review`:

```js
  async fix({ agent, issue, repository, changes }) {
    throw new Error(
      `${this.constructor.name} must implement fix({ agent, issue, repository, changes }), asked for ${agent} on ${issue} in ${repository}`
    )
  }
```

- [ ] **Step 4: Escribir la acción**

```js
// backend/src/application/actions/request-fixes.js
export class RequestFixesParams {
  constructor({ agent, issue, repository, changes }) {
    this.agent = agent
    this.issue = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class RequestFixes {
  constructor({ workbench, planAgents }) {
    this.workbench = workbench
    this.planAgents = planAgents
  }

  async execute(params) {
    await this.workbench.reopen({ issue: params.issue, repository: params.repository })
    await this.planAgents.fix({
      agent: params.agent,
      issue: params.issue.number,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
```

- [ ] **Step 5: Correr los tests hasta verde**

```bash
cd backend && npx vitest run __tests__/application/request-fixes.test.js
```
Esperado: PASS, los cinco.

- [ ] **Step 6: Commit**

```bash
git add backend/src/application/actions/request-fixes.js backend/src/domain/ports/plan-agents.js backend/__tests__/application/request-fixes.test.js
git commit -m "feat: reopen the slice before typing the fixes into its agent"
```

---

### Task 7 — El encargo que se le teclea al agente

**Objective:** `PlanAgentBrief.fixErrandFor` redacta el recado de la review, y `CmuxPlanAgents.fix` lo teclea en la sesión viva.

**Files:**
- Modify: `backend/src/infrastructure/plan-agent-brief.js` (`fixErrandFor`)
- Modify: `backend/src/infrastructure/cmux-plan-agents.js` (`fix`)
- Modify: `backend/__tests__/infrastructure/plan-agent-brief.test.js` (tests nuevos)
- Modify: `backend/__tests__/infrastructure/cmux-plan-agents.test.js` (tests nuevos)

**Interfaces:**
- Consumes: `PlanAgents.fix` (Tarea 6).
- Produces: `PlanAgentBrief.fixErrandFor({ issueNumber, repository, changes })` que devuelve una cadena; `CmuxPlanAgents.fix` que la teclea.

- [ ] **Step 1: Escribir los tests que fallan**

En `backend/__tests__/infrastructure/plan-agent-brief.test.js`, un cuarto `describe` al final, con el `errand` local que los tres anteriores ya usan:

```js
describe('PlanAgentBrief asking the agent to fix its pull request', () => {
  const CHANGES = 'varias cosas\nsrc/foo.js:42: revienta\tcon []'
  const errand = (changes = CHANGES) => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).fixErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name'), changes })

  it('the_errand_is_one_line_even_when_the_review_spread_the_anchors_across_several', () => {
    expect(errand()).not.toContain('\n')
    expect(errand()).not.toContain('\t')
    expect(errand()).toContain('varias cosas src/foo.js:42: revienta con []')
  })

  it('the_errand_orders_correcting_over_the_branch_and_the_pull_request_that_already_exist', () => {
    expect(errand()).toContain('sin rehacer el plan')
    expect(errand()).toContain('sin abrir otra pull request')
    expect(errand()).toContain(PlanAgentBrief.NO_NEW_WORKTREES)
  })

  it('the_errand_orders_the_release_that_puts_the_issue_back_in_review', () => {
    expect(errand()).toContain('#42')
    expect(errand()).toContain(
      'node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --release --no-watch-merge'
    )
  })

  it('the_errand_forbids_merging_because_that_gate_stays_human', () => {
    expect(errand()).toMatch(/no la mergees/i)
  })
})
```

Y en `backend/__tests__/infrastructure/cmux-plan-agents.test.js`, sobre `ResumeDouble`, que es la fixture que ya cubre `resume` y `review`. Añadirle la constante, el doble del brief y los dos métodos:

```js
  static FIX_ERRAND = 'corrige la pull request de #42'
  static FIXES = 'src/foo.js:42: revienta con []'
```

```js
      fixErrandFor: ({ issueNumber, repository, changes }) => {
        this.brief.fixed.push({ issueNumber, repository, changes })

        return ResumeDouble.FIX_ERRAND
      },
```

—con `fixed: []` junto a `asked: []` y `reviewed: []`— y:

```js
  async fix() {
    return this.agents().fix({
      agent: ResumeDouble.AGENT,
      issue: ResumeDouble.ISSUE,
      repository: ResumeDouble.REPOSITORY,
      changes: ResumeDouble.FIXES,
    })
  }

  async fixRefusal() {
    return this.fix().catch((cause) => cause)
  }
```

Y un `describe` nuevo con los tests:

```js
describe('CmuxPlanAgents typing the fixes of a pull request', () => {
  it('it_types_the_fix_errand_on_the_handle_it_was_given_and_then_presses_enter', async () => {
    const cmux = ResumeDouble.accepting()

    await cmux.fix()

    expect(cmux.calls).toEqual([
      ['send', '--workspace', ResumeDouble.AGENT, ResumeDouble.FIX_ERRAND],
      ['send-key', '--workspace', ResumeDouble.AGENT, 'Enter'],
    ])
  })

  it('the_errand_it_types_is_the_one_the_brief_composed_for_those_changes', async () => {
    const cmux = ResumeDouble.accepting()

    await cmux.fix()

    expect(cmux.brief.fixed).toEqual([{
      issueNumber: ResumeDouble.ISSUE,
      repository: ResumeDouble.REPOSITORY,
      changes: ResumeDouble.FIXES,
    }])
  })

  it('a_fix_that_could_not_be_typed_travels_out_typed', async () => {
    const refusal = await ResumeDouble.refusing('no such workspace').fixRefusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
  })

  it('an_enter_that_failed_travels_out_typed_because_the_errand_sits_unrun', async () => {
    const refusal = await ResumeDouble.refusingTheEnter('lost the session').fixRefusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
  })
})
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/infrastructure/plan-agent-brief.test.js __tests__/infrastructure/cmux-plan-agents.test.js
```
Esperado: FAIL, `fixErrandFor is not a function` y `fix is not a function`.

- [ ] **Step 3: Escribir el encargo**

En `backend/src/infrastructure/plan-agent-brief.js`, junto a `reviewErrandFor`:

```js
  fixErrandFor({ issueNumber, repository, changes }) {
    const dispatchCheck = this.dispatchCheck
    const named = repository.text

    return [
      `Un humano ha revisado la pull request del issue #${issueNumber} y pide estos cambios:`,
      `«${String(changes).replace(PlanAgentBrief.WHITESPACE, ' ').trim()}».`,
      'Corrígelos sobre la rama y el worktree que ya tienes, sin rehacer el plan,',
      `${PlanAgentBrief.NO_NEW_WORKTREES} y sin abrir otra pull request: la que hay sigue abierta y recoge lo que pushees.`,
      'Cuando lo tengas en verde, vuelve a liberar con',
      `\`node ${dispatchCheck} ${issueNumber} --repo ${named} --release --no-watch-merge\`, que devuelve el issue a revisión.`,
      'Y entonces PARA: no la mergees.',
    ].join(' ')
  }
```

- [ ] **Step 4: Teclearlo desde el adaptador**

En `backend/src/infrastructure/cmux-plan-agents.js`, junto a `review`:

```js
  async fix({ agent, issue, repository, changes }) {
    const errand = this.brief.fixErrandFor({ issueNumber: issue, repository, changes })
    await this.#type(CmuxPlanAgents.sendArgvFor(agent, errand))
    await this.#type(CmuxPlanAgents.enterArgvFor(agent))
  }
```

- [ ] **Step 5: Correr los tests hasta verde**

```bash
cd backend && npx vitest run __tests__/infrastructure/plan-agent-brief.test.js __tests__/infrastructure/cmux-plan-agents.test.js
```
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/plan-agent-brief.js backend/src/infrastructure/cmux-plan-agents.js backend/__tests__/infrastructure/plan-agent-brief.test.js backend/__tests__/infrastructure/cmux-plan-agents.test.js
git commit -m "feat: word the errand that asks the agent to fix its pull request"
```

---

### Task 8 — El vigilante se generaliza

**Objective:** `PlanReviewWatch` pasa a `ReviewWatch` con el prefijo de sus avisos inyectado, para que puedan existir dos instancias que se lean distintas en el registro de errores. Ningún comportamiento cambia.

**Files:**
- Create: `backend/src/infrastructure/review-watch.js` (movido de `plan-review-watch.js`)
- Delete: `backend/src/infrastructure/plan-review-watch.js`
- Create: `backend/__tests__/infrastructure/review-watch.test.js` (movido)
- Delete: `backend/__tests__/infrastructure/plan-review-watch.test.js`
- Modify: `backend/src/infrastructure/ct-api.mjs` (el import y el montaje del vigilante del plan)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `ReviewWatch` con `constructor({ asked, review, sleep, stderr, label })`, `start(watch)`, `stop({ issue, repository })`.

- [ ] **Step 1: Mover los dos ficheros con git**

```bash
cd /Users/acapdev/orca/workspaces/control-tower-plugin/review_de_la_pr
git mv backend/src/infrastructure/plan-review-watch.js backend/src/infrastructure/review-watch.js
git mv backend/__tests__/infrastructure/plan-review-watch.test.js backend/__tests__/infrastructure/review-watch.test.js
```

- [ ] **Step 2: Escribir el test del prefijo, que falla**

En `backend/__tests__/infrastructure/review-watch.test.js`: cambiar el import a `../../src/infrastructure/review-watch.js`, las dos apariciones de `PlanReviewWatch` a `ReviewWatch`, y el `describe` a `ReviewWatch`.

Un sondeo que falla ya se escribe pasando el error dentro de los sondeos —`#reviews()` hace `if (answer instanceof Error) return Promise.reject(answer)`—, así que no hace falta escenario nuevo. Lo que se añade a `WatchDouble` es el prefijo: un `label` con defecto, aceptado en el constructor y pasado al vigilante.

```js
  static LABEL = 'plan review watch'

  constructor(soundings, { refusingTheDelivery = null, waits = null, stoppingOnDelivery = false, label = WatchDouble.LABEL } = {}) {
```

—guardando `this.label = label` y pasando `label: this.label` en el `new ReviewWatch({ ... })` de `#reviews()`— más el escenario y el test:

```js
  static labelled(label) {
    return new WatchDouble([new PlanChangesNotRead('HTTP 502')], { label })
  }
```

```js
  it('the_label_it_was_given_prefixes_what_it_writes_so_two_watches_can_be_told_apart', async () => {
    const watched = WatchDouble.labelled('pull request review watch')

    await watched.run()

    expect(watched.warnings.join('')).toContain('pull request review watch: owner/name#7')
  })

  it('the_watch_of_the_plan_keeps_saying_which_one_it_is', async () => {
    const watched = WatchDouble.answering(new PlanChangesNotRead('HTTP 502'))

    await watched.run()

    expect(watched.warnings.join('')).toContain('plan review watch:')
  })
```

El prefijo esperado sale de `WatchDouble.SUBJECT`, que lleva `josemerca/ct-loop-sandbox` y el número 7.

- [ ] **Step 3: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/infrastructure/review-watch.test.js
```
Esperado: FAIL, el aviso sigue diciendo `plan review watch:`.

- [ ] **Step 4: Renombrar la clase y parametrizar el prefijo**

En `backend/src/infrastructure/review-watch.js`: renombrar `PlanReviewWatch` a `ReviewWatch` (las tres apariciones internas de `PlanReviewWatch.#keyFor` incluidas), aceptar `label` en el constructor, y cambiar `#warn`:

```js
  constructor({ asked, review, sleep, stderr, label }) {
    this.asked = asked
    this.review = review
    this.sleep = sleep
    this.stderr = stderr
    this.label = label
    this.live = new Map()
  }
```

```js
  #warn(watch, said) {
    this.stderr(`${this.label}: ${watch.repository.text}#${watch.issue.number} ${said}\n`)
  }
```

- [ ] **Step 5: Apuntar el montaje del vigilante del plan**

En `backend/src/infrastructure/ct-api.mjs`: el import pasa a `import { ReviewWatch } from './review-watch.js'`, y en `#planReviews` el `new PlanReviewWatch({...})` pasa a `new ReviewWatch({ ..., label: 'plan review watch' })`.

- [ ] **Step 6: Correr la suite rápida**

```bash
cd backend && npx vitest run --exclude '**/*-real-process.test.js'
```
Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/infrastructure/review-watch.js backend/__tests__/infrastructure/review-watch.test.js backend/src/infrastructure/ct-api.mjs
git commit -m "refactor: make the review watch name what it watches"
```

---

### Task 9 — El progreso de la entrega y el stream que elige lector

**Objective:** el stream sobrevive a la implementación y contesta los tres estados de entrega con la pull request, eligiendo lector por el campo `delivering` de la sesión.

**Files:**
- Create: `backend/src/application/queries/read-delivery-progress.js`
- Create: `backend/__tests__/application/read-delivery-progress.test.js`
- Modify: `backend/src/domain/value-objects/plan-watch.js` (campo `delivering`)
- Modify: `backend/src/infrastructure/plan-events-route.js` (lector y frame)
- Modify: `backend/__tests__/infrastructure/plan-events-route.test.js` (tests nuevos)

**Interfaces:**
- Consumes: `PullRequests.openOf` (Tarea 2), `PlanIssues.isInReview` (Tarea 3), `DeliveryPolicy` (Tarea 5).
- Produces: `ReadDeliveryProgress` que devuelve `{ state, pullRequest }`; `PlanEvents.DELIVERY_NOT_READ`; `PlanWatch` con `delivering`.

- [ ] **Step 1: Escribir el test de la query, que falla**

```js
// backend/__tests__/application/read-delivery-progress.test.js
import { describe, it, expect } from 'vitest'
import {
  ReadDeliveryProgress, ReadDeliveryProgressParams,
} from '../../src/application/queries/read-delivery-progress.js'
import { DeliveryState } from '../../src/domain/policies/delivery-policy.js'
import { PullRequests } from '../../src/domain/ports/pull-requests.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { OpenPullRequest } from '../../src/infrastructure/gh-pull-requests.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PullRequestNotRead } from '../../src/domain/exceptions.js'

class PullRequestsDouble extends PullRequests {
  constructor({ open = null, failing = null } = {}) {
    super()
    this.open = open
    this.failing = failing
  }

  async openOf() {
    if (this.failing !== null) throw this.failing

    return this.open
  }
}

class PlanIssuesDouble extends PlanIssues {
  constructor(inReview) {
    super()
    this.inReview = inReview
  }

  async isInReview() {
    return this.inReview
  }
}

class Flow {
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static PULL_REQUEST = new OpenPullRequest({
    number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42',
  })

  constructor({ pullRequests, planIssues } = {}) {
    this.pullRequests = pullRequests ?? new PullRequestsDouble()
    this.planIssues = planIssues ?? new PlanIssuesDouble(true)
  }

  static implementing() {
    return new Flow({ pullRequests: new PullRequestsDouble({ open: null }) })
  }

  static inReview() {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST }),
      planIssues: new PlanIssuesDouble(true),
    })
  }

  static fixing() {
    return new Flow({
      pullRequests: new PullRequestsDouble({ open: Flow.PULL_REQUEST }),
      planIssues: new PlanIssuesDouble(false),
    })
  }

  async run() {
    return new ReadDeliveryProgress(this).execute(new ReadDeliveryProgressParams({
      issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    }))
  }
}

describe('ReadDeliveryProgress', () => {
  it('with_no_pull_request_yet_the_agent_is_still_implementing_and_there_is_nothing_to_link', async () => {
    const read = await Flow.implementing().run()

    expect(read.state).toBe(DeliveryState.IMPLEMENTING)
    expect(read.pullRequest).toBeNull()
  })

  it('an_open_pull_request_on_an_issue_in_review_is_waiting_for_a_person', async () => {
    const read = await Flow.inReview().run()

    expect(read.state).toBe(DeliveryState.IN_REVIEW)
    expect(read.pullRequest).toEqual(Flow.PULL_REQUEST)
  })

  it('an_open_pull_request_on_an_issue_back_in_progress_is_being_fixed', async () => {
    const read = await Flow.fixing().run()

    expect(read.state).toBe(DeliveryState.FIXING)
    expect(read.pullRequest).toEqual(Flow.PULL_REQUEST)
  })

  it('a_pull_request_that_could_not_be_located_travels_out_typed_instead_of_looking_like_implementing', async () => {
    const flow = new Flow({
      pullRequests: new PullRequestsDouble({ failing: new PullRequestNotRead('HTTP 502') }),
    })

    await expect(flow.run()).rejects.toBeInstanceOf(PullRequestNotRead)
  })
})
```

- [ ] **Step 2: Correr el test para verificar que falla**

```bash
cd backend && npx vitest run __tests__/application/read-delivery-progress.test.js
```
Esperado: FAIL, no resuelve `read-delivery-progress.js`.

- [ ] **Step 3: Escribir la query**

```js
// backend/src/application/queries/read-delivery-progress.js
import { DeliveryPolicy } from '../../domain/policies/delivery-policy.js'

export class ReadDeliveryProgressParams {
  constructor({ issue, repository }) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadDeliveryProgressResult {
  constructor({ state, pullRequest }) {
    this.state = state
    this.pullRequest = pullRequest
    Object.freeze(this)
  }
}

export class ReadDeliveryProgress {
  constructor({ pullRequests, planIssues }) {
    this.pullRequests = pullRequests
    this.planIssues = planIssues
  }

  async execute(params) {
    const pullRequest = await this.pullRequests.openOf({
      issue: params.issue, repository: params.repository,
    })
    if (pullRequest === null) {
      return new ReadDeliveryProgressResult({
        state: DeliveryPolicy.of({ pullRequest, inReview: false }), pullRequest: null,
      })
    }
    const inReview = await this.planIssues.isInReview({
      issue: params.issue, repository: params.repository,
    })

    return new ReadDeliveryProgressResult({
      state: DeliveryPolicy.of({ pullRequest, inReview }), pullRequest,
    })
  }
}
```

- [ ] **Step 4: Dar a la sesión el campo que dice en qué fase está**

```js
// backend/src/domain/value-objects/plan-watch.js
export class PlanWatch {
  constructor({ issue, located, repository, agent, delivering = false }) {
    this.issue = issue
    this.located = located
    this.repository = repository
    this.agent = agent
    this.delivering = delivering
    Object.freeze(this)
  }
}
```

- [ ] **Step 5: Escribir los tests del stream, que fallan**

En `backend/__tests__/infrastructure/plan-events-route.test.js`. `EventsDouble` guiona hoy un solo lector con `read`; se le añade el segundo, un sujeto que entrega, y la cuenta de veces que se preguntó al lector del plan:

```js
  static DELIVERING = new PlanWatch({
    issue: new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' }),
    located: new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' }),
    repository: new RepositoryName('owner/name'),
    delivering: true,
  })

  static PULL_REQUEST = { number: 42, url: 'https://github.com/owner/name/pull/42' }

  static delivering(...answers) {
    return new EventsDouble(answers)
  }

  static inReview() {
    return { state: DeliveryState.IN_REVIEW, pullRequest: EventsDouble.PULL_REQUEST }
  }
```

En `events()`, junto a `read`, el lector de entrega —que consume la misma lista guionada y devuelve el objeto entero en vez de envolver un estado— y un contador `this.planReads += 1` dentro de `read`:

```js
      readDelivery: () => {
        if (this.answers.length === 0) {
          throw new Error('the delivery was read more times than this test scripted an answer for')
        }

        const answer = this.answers.shift()
        if (answer instanceof Error) return Promise.reject(answer)

        return Promise.resolve(answer)
      },
```

y un `collectedDelivering()` gemelo de `collected()` que recorre el stream con `EventsDouble.DELIVERING`. Los tests:

```js
  it('a_session_that_is_delivering_is_read_by_the_delivery_reader_and_never_by_the_plan_one', async () => {
    const double = EventsDouble.delivering(EventsDouble.inReview())

    const frames = await double.collectedDelivering(double.cancellingWhenExhausted())

    expect(double.planReads).toBe(0)
    expect(frames[0]).toContain('"state":"in-review"')
  })

  it('the_frame_of_a_delivery_carries_the_number_and_the_url_of_its_pull_request', async () => {
    const double = EventsDouble.delivering(EventsDouble.inReview())

    const frames = await double.collectedDelivering(double.cancellingWhenExhausted())

    expect(frames[0]).toContain('"number":42')
    expect(frames[0]).toContain('"url":"https://github.com/owner/name/pull/42"')
  })

  it('the_frame_of_a_plan_still_carries_the_state_alone', async () => {
    const frames = await new EventsDouble([PlanState.WRITING]).collected(() => true)

    expect(frames[0]).toBe('data: {"state":"writing"}\n\n')
  })

  it('a_delivery_that_could_not_be_read_ends_the_stream_with_its_own_code', async () => {
    const double = EventsDouble.delivering(new PullRequestNotRead('HTTP 502'))

    const frames = await double.collectedDelivering()

    expect(frames.at(-1)).toContain(PlanEvents.DELIVERY_NOT_READ)
    expect(frames.at(-1)).toContain('HTTP 502')
  })

  it('the_same_delivery_state_twice_running_is_sent_once', async () => {
    const double = EventsDouble.delivering(EventsDouble.inReview(), EventsDouble.inReview())

    const frames = await double.collectedDelivering(double.cancellingWhenExhausted())

    expect(frames.filter((frame) => frame.includes('"state":"in-review"'))).toHaveLength(1)
  })

  it('a_pull_request_that_appears_moves_the_delivery_on_without_a_second_frame_of_the_old_state', async () => {
    const double = EventsDouble.delivering(
      { state: DeliveryState.IMPLEMENTING, pullRequest: null },
      EventsDouble.inReview(),
    )

    const frames = await double.collectedDelivering(double.cancellingWhenExhausted())

    expect(frames).toHaveLength(2)
    expect(frames[0]).toContain('"state":"implementing"')
    expect(frames[1]).toContain('"state":"in-review"')
  })
```

Con los imports de `DeliveryState` y `PullRequestNotRead` en la cabecera del fichero.

- [ ] **Step 6: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/infrastructure/plan-events-route.test.js
```
Esperado: FAIL, `PlanEvents` no acepta el lector de entrega.

- [ ] **Step 7: Hacer que el stream elija lector y el frame lleve la pull request**

En `backend/src/infrastructure/plan-events-route.js`, sustituir la clase `PlanEvents` por:

```js
export class PlanEvents {
  constructor({ read, readDelivery, sleep }) {
    this.read = read
    this.readDelivery = readDelivery
    this.sleep = sleep
  }

  static ERROR_EVENT = 'error'
  static PROGRESS_NOT_READ = 'plan-progress-not-read'
  static DELIVERY_NOT_READ = 'delivery-progress-not-read'

  static frameFor(state, pullRequest = null) {
    const said = pullRequest === null
      ? { state }
      : { state, pullRequest: { number: pullRequest.number, url: pullRequest.url } }

    return `data: ${JSON.stringify(said)}\n\n`
  }

  static failureFrameFor(cause, code) {
    return `event: ${PlanEvents.ERROR_EVENT}\ndata: ${JSON.stringify({ code, detail: cause.message })}\n\n`
  }

  async *stream(session, cancelled) {
    let last = null
    for (;;) {
      let read
      try {
        read = session.delivering ? await this.readDelivery(session) : await this.read(session)
      } catch (cause) {
        if (!(cause instanceof PlanFailure)) throw cause
        yield PlanEvents.failureFrameFor(cause, session.delivering
          ? PlanEvents.DELIVERY_NOT_READ
          : PlanEvents.PROGRESS_NOT_READ)
        return
      }
      if (read.state !== last) {
        last = read.state
        yield PlanEvents.frameFor(read.state, read.pullRequest ?? null)
      }
      await this.sleep()
      if (cancelled()) return
    }
  }
}
```

y cambiar el import de `PlanProgressFailure` por `PlanFailure` en la cabecera del fichero.

- [ ] **Step 8: Añadir el código nuevo al test de códigos distintos**

En `backend/__tests__/infrastructure/refusal-codes.test.js`, en `EventStreamCodes`:

```js
  static VALUES = Object.freeze([PlanEvents.PROGRESS_NOT_READ, PlanEvents.DELIVERY_NOT_READ])
```

- [ ] **Step 9: Correr la suite rápida**

```bash
cd backend && npx vitest run --exclude '**/*-real-process.test.js'
```
Esperado: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/application/queries/read-delivery-progress.js backend/__tests__/application/read-delivery-progress.test.js backend/src/domain/value-objects/plan-watch.js backend/src/infrastructure/plan-events-route.js backend/__tests__/infrastructure/plan-events-route.test.js backend/__tests__/infrastructure/refusal-codes.test.js
git commit -m "feat: keep the stream alive through the delivery of a plan"
```

---

### Task 10 — La ruta releva los vigilantes en vez de apagarlos

**Objective:** al aceptar la implementación, el vigilante del plan muere y arranca el de la pull request, con la sesión marcada como entregando.

**Files:**
- Modify: `backend/src/infrastructure/implement-plan-route.js:164-192`
- Modify: `backend/src/infrastructure/api-server.js` (un colaborador más)
- Modify: `backend/__tests__/infrastructure/implement-plan-route.test.js`

**Interfaces:**
- Consumes: `PlanWatch.delivering` (Tarea 9), `ReviewWatch` (Tarea 8).
- Produces: `ImplementPlanRoute.handledBy(implementPlan, sessions, reviews, pullRequestReviews)`.

- [ ] **Step 1: Escribir los tests que fallan**

En `backend/__tests__/infrastructure/implement-plan-route.test.js`. `RunningApi` monta hoy un `ReviewsSpy` en `RunningApi.reviews` (línea 73); se le añade un segundo, `RunningApi.pullRequestReviews`, montado igual y pasado al `ApiServer`. `ReviewsSpy` ya lleva `started` y `stopped`, así que sirve tal cual para los dos. El cuerpo aceptado es `RunningApi.ACCEPTED_BODY`, con issue **33** y repositorio `jjponz/repo-pulse`, la sesión recordada es `RunningApi.WATCHED`, y se postea con `RunningApi.post(port, body)`. Los tests:

```js
  it('accepting_the_implementation_stops_watching_the_plan_because_that_gate_is_closed', async () => {
    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(RunningApi.reviews.stopped).toEqual([
      { issue: 33, repository: RunningApi.WATCHED.repository },
    ])
  })

  it('accepting_the_implementation_starts_watching_the_pull_request_that_does_not_exist_yet', async () => {
    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(RunningApi.pullRequestReviews.started).toHaveLength(1)
    expect(RunningApi.pullRequestReviews.started[0].issue.number).toBe(33)
  })

  it('the_session_it_keeps_is_marked_as_delivering_so_the_stream_reads_the_delivery', async () => {
    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    const kept = sessions.find({ issue: 33, repository: RunningApi.WATCHED.repository })

    expect(kept.delivering).toBe(true)
    expect(kept.agent).toBe(RunningApi.WATCHED.agent)
  })

  it('the_watch_it_starts_is_the_session_it_kept_and_not_a_fresh_one', async () => {
    await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(RunningApi.pullRequestReviews.started[0])
      .toBe(sessions.find({ issue: 33, repository: RunningApi.WATCHED.repository }))
  })

  it('a_refused_implementation_neither_starts_the_pull_request_watch_nor_marks_the_session', async () => {
    await RunningApi.post(port, '{"agent":"workspace:20","issue":33,"repo":"no-soy-un-repo"}')

    expect(RunningApi.pullRequestReviews.started).toEqual([])
  })

  it('an_implementation_of_an_issue_nobody_is_watching_answers_the_same_and_starts_nothing', async () => {
    sessions.forget({ issue: 33, repository: RunningApi.WATCHED.repository })

    const answered = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(answered.status).toBe(202)
    expect(RunningApi.pullRequestReviews.started).toEqual([])
  })
```

Estos tests van en el `describe('implementing the plan lifts the watch on its issue')` que ya existe (línea 294), y `sessions` es el campo estático `RunningApi.sessions`, no una variable local — así que las líneas de arriba se escriben con `RunningApi.sessions.find(...)` y `RunningApi.sessions.forget(...)`. El `port` es lo que devuelve `await RunningApi.listening()`.

`RunningApi.NO_EVENTS` construye un `PlanEvents` con `read` y `sleep`; con el lector nuevo de la Tarea 9 conviene darle también un `readDelivery` que rechace igual, para que el doble siga diciendo que esta suite no streamea nada:

```js
  static NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    readDelivery: () => Promise.reject(new Error('this suite never streams delivery events')),
    sleep: () => Promise.resolve(),
  })
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

```bash
cd backend && npx vitest run __tests__/infrastructure/implement-plan-route.test.js
```
Esperado: FAIL, la ruta no conoce `pullRequestReviews`.

- [ ] **Step 3: Relevar los vigilantes en la ruta**

En `backend/src/infrastructure/implement-plan-route.js`, cambiar la firma y el cuerpo:

```js
  static handledBy(implementPlan, sessions, reviews, pullRequestReviews) {
    return async (request, response) => {
      const asked = ImplementRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== ImplementRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, ImplementRefusal.of(asked))
        return
      }
      await ImplementPlanRoute.#accept(implementPlan, sessions, reviews, pullRequestReviews, response, asked)
    }
  }

  static async #accept(implementPlan, sessions, reviews, pullRequestReviews, response, asked) {
    try {
      await implementPlan.execute(new ImplementPlanParams({
        agent: asked.agent, issue: asked.issue, repository: asked.repository,
      }))
    } catch (cause) {
      if (!(cause instanceof PlanFailure)) throw cause
      Answer.refuseAs(response, ImplementCollapse.of(cause))
      return
    }
    reviews.stop({ issue: asked.issue, repository: asked.repository })
    ImplementPlanRoute.#deliver(sessions, pullRequestReviews, asked)
    Answer.send(response, 202, {
      status: 'implementing',
      [ImplementRequest.AGENT_FIELD]: asked.agent,
      [ImplementRequest.ISSUE_FIELD]: asked.issue,
    })
  }

  static #deliver(sessions, pullRequestReviews, asked) {
    const watched = sessions.find({ issue: asked.issue, repository: asked.repository })
    if (watched === null) return

    const delivering = new PlanWatch({ ...watched, delivering: true })
    sessions.remember(delivering)
    pullRequestReviews.start(delivering)
  }
```

y añadir el import de `PlanWatch` desde `../domain/value-objects/plan-watch.js`.

- [ ] **Step 4: Pasar el colaborador desde el servidor**

En `backend/src/infrastructure/api-server.js`: aceptar `pullRequestReviews` en el constructor, guardarlo, y pasarlo en la línea de montaje de `ImplementPlanRoute.handledBy(this.implementPlan, this.sessions, this.reviews, this.pullRequestReviews)`.

- [ ] **Step 5: Correr los tests hasta verde**

```bash
cd backend && npx vitest run __tests__/infrastructure/implement-plan-route.test.js __tests__/infrastructure/api-server.test.js
```
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/infrastructure/implement-plan-route.js backend/src/infrastructure/api-server.js backend/__tests__/infrastructure/implement-plan-route.test.js
git commit -m "feat: hand the watch over to the pull request when implementation starts"
```

---

### Task 11 — El montaje en el entrypoint

**Objective:** `ct-api.mjs` construye los dos adaptadores nuevos, la query, la acción y el segundo vigilante, y se lo pasa al servidor.

**Files:**
- Modify: `backend/src/infrastructure/ct-api.mjs`
- Modify: `backend/__tests__/infrastructure/ct-api-real-process.test.js` (si el arranque asegura colaboradores)

**Interfaces:**
- Consumes: todo lo de las tareas 2 a 10.
- Produces: nada nuevo. Es el cableado.

- [ ] **Step 1: Añadir el montaje**

En `backend/src/infrastructure/ct-api.mjs`, junto a `#planReviews`:

```js
  static #pullRequestReviews(pullRequests, planIssues, planAgents, workbench) {
    const readFixesAsked = new ReadFixesAsked({ pullRequests, planIssues })
    const requestFixes = new RequestFixes({ workbench, planAgents })

    return new ReviewWatch({
      asked: (watch) => readFixesAsked.execute(new ReadFixesAskedParams(watch)),
      review: (params) => requestFixes.execute(new RequestFixesParams(params)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_ASKS),
      stderr: (line) => process.stderr.write(line),
      label: 'pull request review watch',
    })
  }
```

y en `#planEvents`, aceptar los puertos y montar el segundo lector:

```js
  static #planEvents(git, pullRequests, planIssues) {
    const readPlanProgress = new ReadPlanProgress({
      planProgress: new PlanContractProgress({
        node: CtApi.#tool(process.execPath),
        git,
        dispatchCheck: PluginTree.dispatchCheck(),
      }),
    })
    const readDeliveryProgress = new ReadDeliveryProgress({ pullRequests, planIssues })

    return new PlanEvents({
      read: (session) => readPlanProgress.execute(new ReadPlanProgressParams(session)),
      readDelivery: (session) => readDeliveryProgress.execute(new ReadDeliveryProgressParams(session)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_READS),
    })
  }
```

En `run`, tras construir `planIssues`:

```js
    const pullRequests = new GhPullRequests({ gh: CtApi.#talkingTo(Gh.BIN, Gh) })
    const workbench = new DispatchCheckWorkbench({
      node: CtApi.#tool(process.execPath),
      dispatchCheck: PluginTree.dispatchCheck(),
    })
```

y en el `new ApiServer({...})`:

```js
      pullRequestReviews: CtApi.#pullRequestReviews(pullRequests, planIssues, planAgents, workbench),
      planEvents: CtApi.#planEvents(git, pullRequests, planIssues),
```

Añadir los imports de `GhPullRequests`, `DispatchCheckWorkbench`, `ReadFixesAsked`, `ReadFixesAskedParams`, `RequestFixes`, `RequestFixesParams`, `ReadDeliveryProgress` y `ReadDeliveryProgressParams`.

- [ ] **Step 2: Correr la suite entera, incluidos los procesos reales**

```bash
cd backend && npx vitest run
```
Esperado: PASS. Tarda unos minutos: es la única vez que hace falta la suite completa antes del frontend.

- [ ] **Step 3: Commit**

```bash
git add backend/src/infrastructure/ct-api.mjs backend/__tests__/infrastructure/ct-api-real-process.test.js
git commit -m "feat: wire the pull request review watch into the entrypoint"
```

---

### Task 12 — El cuarto paso en la interfaz

**Objective:** la interfaz deja de quedarse ciega tras implementar: una sola suscripción al stream alimenta el paso del plan y un cuarto paso de Revisión que enlaza la pull request.

**Files:**
- Modify: `frontend/src/app/plan-events/PlanEvents.types.ts`
- Modify: `frontend/src/app/plan-events/client.ts`
- Modify: `frontend/src/app/plan-events/usePlanProgress.ts`
- Modify: `frontend/src/app/plan-events/components/plan-progress/PlanProgress.tsx`
- Create: `frontend/src/app/plan-events/components/delivery-progress/DeliveryProgress.tsx`
- Create: `frontend/src/app/plan-events/components/delivery-progress/DeliveryProgress.css`
- Create: `frontend/src/app/plan-events/components/delivery-progress/index.ts`
- Modify: `frontend/src/pages/home/Home.tsx`
- Modify: `frontend/src/__scenarios__/PlanEventsMother.ts`
- Modify: `frontend/src/pages/home/__tests__/Home.planEvents.test.tsx`

**Interfaces:**
- Consumes: el contrato de eventos de la Tarea 9.
- Produces: nada que otra tarea consuma. Es la última.

- [ ] **Step 1: Ampliar la mother con los frames nuevos**

```ts
// frontend/src/__scenarios__/PlanEventsMother.ts (añadir)
const PULL_REQUEST = { number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42' }

const implementing = () => '{"state":"implementing"}'
const inReview = () => `{"state":"in-review","pullRequest":${JSON.stringify(PULL_REQUEST)}}`
const fixing = () => `{"state":"fixing","pullRequest":${JSON.stringify(PULL_REQUEST)}}`
const deliveryUnreadable = () =>
  '{"code":"delivery-progress-not-read","detail":"gh pr list failed: HTTP 502"}'
```

y exportarlos junto a `PULL_REQUEST` en el objeto `PlanEventsMother`.

- [ ] **Step 2: Escribir los tests que fallan**

En `frontend/src/pages/home/__tests__/Home.planEvents.test.tsx`:

```tsx
  const implementationStarted = async () => {
    const opened = await planStarted()
    await streamFrame(PlanEventsMother.writing())
    await streamFrame(PlanEventsMother.ready())
    backendAnswering(ImplementPlanMother.implementing())
    await opened.user.click(screen.getByRole('button', { name: 'Implementar plan' }))

    return opened
  }

  it('should say the agent is implementing while there is no pull request yet', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.implementing())

    expect(screen.getByText('Implementando…')).toBeInTheDocument()
  })

  it('should link the pull request once it is open and waiting for a review', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.inReview())

    expect(screen.getByRole('link', { name: 'Pull request #42' }))
      .toHaveAttribute('href', PlanEventsMother.PULL_REQUEST.url)
    expect(screen.getByRole('button', { name: /Revisión Activo/ })).toBeInTheDocument()
  })

  it('should say it is fixing what the review asked for', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.inReview())
    await streamFrame(PlanEventsMother.fixing())

    expect(screen.getByText('Corrigiendo lo pedido…')).toBeInTheDocument()
  })

  it('should go back to waiting for a review once the fixes are released', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.fixing())
    await streamFrame(PlanEventsMother.inReview())

    expect(screen.getByText('Pull request #42 en revisión')).toBeInTheDocument()
  })

  it('should complete the implementation step once the pull request exists', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.inReview())

    expect(screen.getByRole('button', { name: /Implementación Completado/ })).toBeInTheDocument()
  })

  it('should say so when the delivery cannot be read', async () => {
    await implementationStarted()

    await streamFailure(PlanEventsMother.deliveryUnreadable())

    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 502')
  })

  it('should watch the issue through a single subscription however many steps read it', async () => {
    await implementationStarted()

    await streamFrame(PlanEventsMother.inReview())

    expect(FakeEventSource.opened).toHaveLength(1)
  })
```

`FakeEventSource.opened` ya existe: es el array estático de instancias que `install()` vacía en cada test, así que no hay que añadirle nada.

- [ ] **Step 3: Correr los tests para verificar que fallan**

```bash
cd frontend && npx vitest run src/pages/home/__tests__/Home.planEvents.test.tsx
```
Esperado: FAIL, no existe el texto `Implementando…` ni el cuarto paso.

- [ ] **Step 4: Ampliar los tipos y el cliente**

```ts
// frontend/src/app/plan-events/PlanEvents.types.ts
export type PlanState = 'writing' | 'ready' | 'implementing' | 'in-review' | 'fixing'

export type PullRequest = {
  number: number
  url: string
}

export type PlanEvent = {
  state: PlanState
  pullRequest?: PullRequest
}

export type PlanEventsListener = {
  onState: (state: PlanState, pullRequest: PullRequest | null) => void
  onFailure: (error: string) => void
  onUnreachable: () => void
}
```

En `client.ts`, pasar `event.pullRequest ?? null` como segundo argumento de `onState`.

- [ ] **Step 5: Ampliar el hook**

```ts
// frontend/src/app/plan-events/usePlanProgress.ts
type PlanProgress =
  | { phase: 'connecting' }
  | { phase: 'writing' }
  | { phase: 'ready' }
  | { phase: 'implementing' }
  | { phase: 'in-review'; pullRequest: PullRequest }
  | { phase: 'fixing'; pullRequest: PullRequest }
  | { phase: 'failed'; error: string }
  | { phase: 'unreachable' }
```

y en el `onState`, construir la fase con la pull request cuando llegue:

```ts
      onState: (state, pullRequest) => setProgress(
        pullRequest === null
          ? ({ phase: state } as PlanProgress)
          : ({ phase: state, pullRequest } as PlanProgress)
      ),
```

- [ ] **Step 6: Subir el hook a `Home` y bajar el progreso a los dos pasos**

En `PlanProgress.tsx`, quitar la llamada a `usePlanProgress` y aceptar `progress` como propiedad, dejando el resto igual. En `Home.tsx`:

```tsx
const DELIVERED: PlanProgress['phase'][] = ['in-review', 'fixing']

const Home = () => {
  const [started, setStarted] = useState<StartedPlan | null>(null)
  const progress = usePlanProgress(started?.issue.number ?? null, started?.repo ?? null)
  ...
  const isDelivered = DELIVERED.includes(progress.phase)
  const implementationStatus: WorkflowStepStatus = !isPlanReady
    ? 'pending'
    : isDelivered ? 'completed' : 'active'
  const reviewStatus: WorkflowStepStatus = isDelivered ? 'active' : 'pending'
```

añadiendo el cuarto `WorkflowStep` con `title="Revisión"` que rinde `<DeliveryProgress progress={progress} />` y moviendo dentro de él el botón "Arrancar otro plan".

El hook pasa a aceptar que todavía no haya plan, porque `Home` lo monta antes de que exista. Su firma y su guarda:

```ts
const usePlanProgress = (issue: number | null, repo: string | null): PlanProgress => {
  const [progress, setProgress] = useState<PlanProgress>(CONNECTING)

  useEffect(() => {
    if (issue === null || repo === null) return
    setProgress(CONNECTING)
    const subscription = PlanEventsClient.watch(issue, repo, { ... })

    return subscription.close
  }, [issue, repo])

  return progress
}
```

Eso mantiene la promesa del test de una sola suscripción: el efecto no abre nada mientras no hay plan, y cuando lo hay abre una.

- [ ] **Step 7: Escribir el contenido del cuarto paso**

```tsx
// frontend/src/app/plan-events/components/delivery-progress/DeliveryProgress.tsx
import { PlanProgress } from 'app/plan-events/usePlanProgress'
import { Banner } from 'system-ui/banner'
import './DeliveryProgress.css'

const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

type DeliveryProgressProps = {
  progress: PlanProgress
}

const DeliveryProgress = ({ progress }: DeliveryProgressProps) => (
  <section className="delivery-progress" aria-label="Progreso de la entrega">
    {progress.phase === 'implementing' && (
      <p className="delivery-progress__state" role="status">Implementando…</p>
    )}
    {progress.phase === 'in-review' && (
      <p className="delivery-progress__state" role="status" aria-live="polite">
        <a href={progress.pullRequest.url} target="_blank" rel="noreferrer">
          Pull request #{progress.pullRequest.number}
        </a>{' '}
        en revisión
      </p>
    )}
    {progress.phase === 'fixing' && (
      <p className="delivery-progress__state" role="status" aria-live="polite">
        Corrigiendo lo pedido…
      </p>
    )}
    {progress.phase === 'failed' && <Banner type="error" role="alert" title={progress.error} />}
    {progress.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
  </section>
)

export { DeliveryProgress }
export type { DeliveryProgressProps }
```

Con su `index.ts` reexportándolo y un `DeliveryProgress.css` copiando las reglas de `PlanProgress.css` con el prefijo nuevo.

Ojo con el test `should link the pull request once it is open and waiting for a review`: pide un enlace accesible como `Pull request #42` y un texto `Pull request #42 en revisión`; el marcado de arriba da los dos.

- [ ] **Step 8: Correr los tests del frontend hasta verde**

```bash
cd frontend && npx vitest run
```
Esperado: PASS, incluidos los tests de `Home.startPlan` y `Home.implementPlan` que ya existían.

- [ ] **Step 9: Correr las dos suites enteras**

```bash
cd backend && npx vitest run && cd ../frontend && npx vitest run
```
Esperado: PASS las dos.

- [ ] **Step 10: Commit**

```bash
git add frontend/src
git commit -m "feat: show where the delivery of a plan stands and link its pull request"
```

---

## 8. La prueba de punta a punta, a mano

Los tests no cubren el bucle entero contra GitHub y cmux de verdad. Antes de abrir la pull request de este trabajo, correrlo una vez sobre un repo de pruebas:

- [ ] Arrancar la interfaz de programación de aplicaciones y la interfaz, y lanzar un plan sobre una historia de prueba.
- [ ] Dar el go, dejar que el agente implemente y abra su pull request.
- [ ] Comprobar que el cuarto paso pasa a "Pull request #N en revisión" con su enlace.
- [ ] Dejar una review con cuerpo y dos comentarios de línea. Comprobar que el issue vuelve a `status:in-progress`, que el cuarto paso dice "Corrigiendo lo pedido…", y que el agente recibe el encargo con las dos anclas `fichero:línea`.
- [ ] **Confirmar que el segundo `--release` pasa la puerta del go** (código 9). En el papel pasa —el compromiso no se borra y el comentario `-OK <nonce>` sigue en el issue—, pero nadie lo ha visto ocurrir. Si falla, parar: el bucle no se cierra y hay que decidir qué hacer con esa puerta.
- [ ] Añadir un comentario de línea suelto, sin abrir review, y comprobar que también llega.
- [ ] Pedir una segunda review mientras el agente corrige, y comprobar que no se le teclea encima y que se atiende cuando vuelve a `in-review`.

Lo que salga de aquí va al cuerpo de la pull request.

## 9. Lo que este plan no hace

- No vigila la integración continua ni mergea.
- No recoge la cosecha del carril web.
- No persiste el estado del bucle: un reinicio del backend re-teclea las reviews ya atendidas.
- No lee los comentarios de la pestaña Conversation.
- No parchea el fallo a medias del punto 9 de las decisiones cerradas.

## 10. Al terminar

El documento de diseño no viaja en la pull request: se retira en su propio commit, y su contenido va al cuerpo de la pull request.

```bash
git rm docs/superpowers/specs/2026-09-07-review-de-la-pull-request-design.md
git rm docs/superpowers/plans/2026-09-07-review-de-la-pull-request.md
git commit -m "docs: retire the design and the plan of the pull request review loop"
```
