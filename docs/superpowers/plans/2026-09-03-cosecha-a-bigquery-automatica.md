# La cosecha automática también carga en BigQuery — `dispatch-check --collect --bq` y `CT_HARVEST_BQ_TABLE`

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, this document's §2 and the convention documents
> of `plugin/conventions/` and `backend/conventions/` win.

## 1. Context and goal

El plan `docs/superpowers/plans/2026-09-03-cosecha-a-bigquery.md`, ya ejecutado en esta rama,
dejó el transporte: `plugin/scripts/harvest-table.js` (el esquema declarado una vez y la fila),
`plugin/scripts/bigquery-load.js` (`bq load` con runner inyectado) y el flag manual
`/ct-harvest --bq`. Pero la cosecha que importa es la automática: el backend
(`backend/src/infrastructure/harvest-clock.js`) barre el checkout cada 60 s y pide al plugin
`dispatch-check <n> --repo <o/r> --collect` por cada slice mergeado. Ese camino recoge el
worktree, la rama y la sesión de cmux, y sus métricas no viajan a ningún sitio.

Se pide que la carga forme parte de ese camino: al recoger un slice, su fila entra en la tabla
de BigQuery, y la tabla se declara UNA vez, en el entorno del backend, no a mano en cada
invocación. Las lecturas por issue que hoy viven en `plugin/scripts/ct-harvest.mjs` pasan a un
módulo que usan los dos caminos, y la carga con su identidad y su directorio temporal a otro.

### Desired end state

- `CT_HARVEST_BQ_TABLE=p:d.t make run-backend` arranca el backend y cada barrido invoca
  `dispatch-check <n> --repo <o/r> --collect --bq p:d.t`. Sin la variable, el argv es el de hoy.
- `dispatch-check <n> --repo R --collect --bq T`: cuando la guarda dice cosechar, lee de GitHub la
  fila del slice (issue, timeline, PR que lo cerró, telemetría), la carga con `bq load` y SOLO
  después cierra cmux y borra worktree y rama. stdout `collected #n: … ; 1 fila cargada en T
  (harvest_id <uuid>)`, exit 0.
- Una lectura de GitHub que falla: exit 3, `no se pudo leer la cosecha de #n: <lectura> falló
  (<detalle>) — no se ha tocado nada, el siguiente barrido reintenta.` Un `bq` que falla: exit 10,
  `kept #n: BigQuery (T) rechazó la fila: bq salió con <c>: <detalle> — no se ha borrado nada, el
  siguiente barrido reintenta`. Los códigos son los que el backend ya entiende: no cambia su contrato.
- `--bq` mal formado en `dispatch-check`: exit 2. `--dry-run` con `--bq`: no lee ni carga, y la
  línea termina en `; y cargaría 1 fila en T`. Sin `--bq`, argv de `gh` y salida idénticos a hoy.
- Una sola implementación de las lecturas por slice (`SliceHarvest`) y de la carga con identidad y
  directorio (`HarvestLedger`), usadas por `/ct-harvest` y por `--collect`. `/ct-harvest` no cambia
  de comportamiento: sus tests actuales siguen en verde sin tocarlos.
- El backend valida `CT_HARVEST_BQ_TABLE` al arrancar con el mismo lector que el plugin
  (`BigQueryTable.parse`), rechaza el arranque si está mal formada, y lo dice en su `usage`.
- Una tabla para todos los equipos: cada fila lleva `repo`, `milestone` e `issue`; la clave natural
  de un slice es `(repo, issue)`. `milestone` pasa a `NULLABLE`: un slice sin milestone es un
  `NULL` honesto, no un arranque roto.
- Docs al día: README del plugin (Puerta 3), `commands/ct-next.md` (F20), `commands/ct-harvest.md`,
  README raíz y `Makefile` (`run-backend` pasa la variable).

### Out of scope

- Deduplicar filas, particionar o clusterizar la tabla; una vista «última cosecha por (repo,
  issue)» es del consumidor.
- Presupuesto de reintentos o backoff: el tick de 60 s ES el reintento.
- Distinguir un 404 de un fallo transitorio al listar la telemetría: este repo no parsea códigos
  HTTP y no empieza aquí.
- Un nuevo código de salida de `dispatch-check` o un nuevo `HarvestOutcome` en el backend.
- Cambiar el esquema salvo `milestone` a `NULLABLE`; cambiar la versión (0.53.0 ya está en la rama,
  sin publicar).
- Tocar `ct-step.mjs` (su lector de versión sigue siendo deuda declarada).

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Disparo | dentro de `dispatch-check --collect`, tras `rehearse` y solo si su desenlace es `WOULD_COLLECT`; nunca en `--dry-run` |
| Orden | primero la fila a BigQuery, después cmux, worktree y rama; si la carga falla no se borra nada |
| Códigos | lectura de GitHub fallida o cosecha incompleta → exit 3 (`dieErr`); `bq` rechaza → exit 10 (`dieOut`); `--bq` mal formado → exit 2; sin código nuevo |
| Directorio temporal tras un rechazo | en `--collect` se borra (el reintento es el siguiente barrido); en `/ct-harvest` se conserva y se imprime el comando de reintento, como hoy |
| Dónde vive la tabla | `CT_HARVEST_BQ_TABLE` en el entorno del backend; `Invocation.from` la lee con `BigQueryTable.parse`; vacía o ausente = no configurada; mal formada = arranque rehusado (`MALFORMED_HARVEST_TABLE`) |
| Cómo llega al plugin | `DispatchCheckHarvest.argvFor` añade `'--bq', harvestTable.id` al final del argv cuando hay tabla; sin tabla, argv idéntico a hoy |
| Lecturas por slice | `SliceHarvest` con `gh` inyectado `(argv) => { code, stdout, stderr }`; argv literalmente los de hoy (`--paginate --slurp`, campos de `pr view`, `Accept: application/vnd.github.raw`) |
| El issue | `/ct-harvest` lo pasa del listado; `--collect` lo lee con `gh issue view <n> --repo <R> --json number,title,state,closedAt,labels,milestone,closedByPullRequestsReferences` |
| Índice de telemetría | `TelemetryIndex.read({ gh, repo })` UNA vez por corrida (un listado); fallo del listado → estado `no-leido` en la fila, no es un fallo de la cosecha |
| Desenlaces de la lectura | `SliceHarvestOutcome = { COMPLETE, INCOMPLETE, NOT_READ }`: timeline fallido → `NOT_READ` sin fila; PR o fichero de telemetría fallidos → `INCOMPLETE` con fila y `failures`; varios PRs cerrando → `closers` en el informe, se cosecha el primero |
| Quién carga | `/ct-harvest` carga `COMPLETE` e `INCOMPLETE` solo si no hay motivos (como hoy: incompleta = exit 1 sin carga); `--collect` carga solo `COMPLETE` |
| Identidad | `LedgerIdentity.fromEnvironment()`: `pluginVersion` del `package.json` del plugin (`null` si ilegible), `actor` `os.userInfo().username`, `now()` ISO, `nextId()` `randomUUID()` |
| Tope de `bq` en `--collect` | `COLLECT_BQ_TIMEOUT_MS = 120_000`, constante del bloque como las de git y cmux |
| Backend importa del plugin | `import { BigQueryTable } from '../../../plugin/scripts/bigquery-load.js'`, como `git-workspace.js` importa `state-paths.js` |
| Textos de `--collect` | en castellano, estilo del anfitrión, con la forma `<estado> #<n>: …` que el backend y sus tests ya conocen |

## 3. Reference patterns

Files to imitate: `plugin/scripts/slice-collector.js` y `plugin/scripts/bigquery-load.js`
(adaptadores con runners inyectados, vocabularios cerrados, informes con constructores estáticos),
`plugin/scripts/harvest-table.js` (modelo de frontera), `plugin/__tests__/bigquery-load.test.js` y
`plugin/__tests__/slice-collector.test.js` (dobles `ScriptedRunner` que lanzan sin respuesta escrita,
madres), `plugin/__tests__/dispatch-check-collect.test.js` (bancada con git real, `gh` y `cmux`
falsos) y `plugin/__tests__/ct-harvest-bq.test.js` (clase `Bench`, `bq` falso). En el backend:
`backend/src/infrastructure/dispatch-check-harvest.js`, `backend/src/infrastructure/invocation.js`,
`backend/__tests__/infrastructure/invocation.test.js` y
`backend/__tests__/infrastructure/dispatch-check-harvest.test.js`.

Rules to obey: este repo no declara .agent/conventions.md, AGENTS.md ni CLAUDE.md — N/A. La vara
de ct ata en todo diff: `plugin/conventions/style.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/defects.md`, `plugin/conventions/testing.md`, `plugin/conventions/decisions.md`.
Bajo `backend/` se suman, sin exención alguna, `backend/conventions/architecture.md` (un tipo nuevo
tiene la carga de la prueba; el backend se apoya en el plugin y nunca al revés) y
`backend/conventions/domain.md` (el dominio no habla el idioma de ninguna herramienta; lenguaje
ubicuo en su tabla). `plugin/scripts/ct-harvest.mjs`, `plugin/scripts/dispatch-check.mjs` y
`plugin/__tests__/fixtures/fake-gh-bin/gh` son deuda declarada (castellano, funciones libres): lo
que se les añade sigue al anfitrión, y `plugin/conventions/defects.md` ata igual.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/slice-harvest.js` | create | `ct-harvest.mjs`, `dispatch-check.mjs` | Contract |
| `plugin/__tests__/slice-harvest.test.js` | create | vitest | none (body by TDD) |
| `plugin/scripts/harvest-ledger.js` | create | `ct-harvest.mjs`, `dispatch-check.mjs` | Contract |
| `plugin/__tests__/harvest-ledger.test.js` | create | vitest | none (body by TDD) |
| `plugin/__tests__/modulos-conformes.test.js` | modify | vitest | prose |
| `plugin/scripts/ct-harvest.mjs` | modify | el desarrollador | Current state / Call site |
| `plugin/scripts/harvest-table.js`, `plugin/__tests__/harvest-table.test.js` | modify | `HarvestLedger` | prose |
| `plugin/scripts/dispatch-check.mjs` | modify | el backend | Current state / Call site |
| `plugin/__tests__/fixtures/fake-gh-bin/gh` | modify | los tests spawn | prose |
| `plugin/__tests__/dispatch-check-collect-bq.test.js` | create | vitest | none (body by TDD) |
| `backend/src/infrastructure/invocation.js` | modify | `ct-api.mjs` | Current state / Contract |
| `backend/__tests__/infrastructure/invocation.test.js` | modify | vitest | none (body by TDD) |
| `backend/src/infrastructure/dispatch-check-harvest.js` | modify | `ct-api.mjs` | Current state / Contract |
| `backend/__tests__/infrastructure/dispatch-check-harvest.test.js` | modify | vitest | none (body by TDD) |
| `backend/src/infrastructure/ct-api.mjs` | modify | quien arranca el backend | Current state / Call site |
| `backend/conventions/domain.md` | modify | quien escribe backend | Final text |
| `plugin/README.md`, `plugin/commands/ct-next.md`, `plugin/commands/ct-harvest.md`, `README.md`, `Makefile` | modify | quien lee | Final text / prose (config) |

## 5. Interfaces

Consumes: `harvestSlice` y `closingPrNumbers` de `plugin/scripts/harvest.js`; `aggregateVerdictMeasures`,
`aggregateBriefMeasures`, `METRICS_REPO_DIR` y `metricsRepoRelPath` de `plugin/scripts/run-metrics.js`;
`HarvestIdentity`, `HarvestTable` de `plugin/scripts/harvest-table.js`; `BigQueryLoad`, `BigQueryTable`,
`LoadOutcome` de `plugin/scripts/bigquery-load.js`; `SliceCollector`, `CollectionOutcome` de
`plugin/scripts/slice-collector.js`. Ninguno cambia de firma.

Produces:
- `SliceRead`, `SliceHarvestOutcome`, `IndexOutcome` (vocabularios cerrados), `SliceReadFailure`,
  `SliceHarvestReport`, `TelemetryIndex.read({ gh, repo })`, `new SliceHarvest({ gh })` con
  `harvest({ repo, issue, index })` y `harvestIssue({ repo, number, index })`.
- `LedgerIdentity.fromEnvironment()`, `LedgerReport`, `new HarvestLedger({ table, bq, workspace, identity })`
  con `record({ repo, milestone, rows })`.
- Backend: `Invocation.HARVEST_TABLE_VARIABLE`, `InvocationOutcome.MALFORMED_HARVEST_TABLE`, el campo
  `harvestTable` de `Invocation`; `DispatchCheckHarvest.argvFor({ dispatchCheck, issueNumber, repository, harvestTable })`.

## 6. Test strategy

De fuera adentro y sin red. Los módulos nuevos del plugin se prueban con `ScriptedRunner` (graba lo
que se le pidió, lanza si nadie escribió la respuesta) y, para el ledger, con un doble de directorio y
`node:fs` real para leer lo escrito. Los dos entrypoints por spawn: `/ct-harvest` con sus tests
actuales intactos como red del refactor; `--collect --bq` con una bancada nueva sobre un repo git
real y `gh`, `cmux` y `bq` falsos en el PATH. El backend con sus dobles actuales (`HarvestDouble`,
`Invoked`). Cada fichero nuevo nace conforme y se da de alta en `NacidosConformes.RUTAS` en la tarea
que lo crea. Ningún control clava el total de la suite. Cada aserción se rompe a mano una vez. Las
suites enteras (`npm test` en `plugin/` y en `backend/`) cierran el plan en §8.

## 7. Tasks

### Task 1 — `slice-harvest.js` nace: el índice de telemetría y el informe de una cosecha

**Objective:** existe el módulo con sus vocabularios cerrados, el informe de una cosecha por slice y la lectura única del índice de telemetría, para que la tarea siguiente cuelgue de él las lecturas del slice.

**Files:** `plugin/scripts/slice-harvest.js` (create), `plugin/__tests__/slice-harvest.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify: alta de los dos)

Contract (plugin/scripts/slice-harvest.js):

```js
export const SliceRead = Object.freeze({ ISSUE: 'gh issue view', TIMELINE: 'gh api timeline', PULL_REQUEST: 'gh pr view', TELEMETRY_INDEX: 'gh api contents (dir)', TELEMETRY_FILE: 'gh api contents' })
export const SliceHarvestOutcome = Object.freeze({ COMPLETE: 'complete', INCOMPLETE: 'incomplete', NOT_READ: 'not-read' })
export const IndexOutcome = Object.freeze({ LISTED: 'listed', NOT_READ: 'not-read' })
export class SliceReadFailure {
  constructor({ read, subject, detail })
}
export class TelemetryIndex {
  static read({ gh, repo })            // gh: (argv) => { code, stdout, stderr }
  constructor({ outcome, files, detail })
  has(fileName)
}
export class SliceHarvestReport {
  constructor({ outcome, row, failures, closers })
  static notRead(failure)              // NOT_READ, row null, failures [failure], closers []
  static of({ row, failures, closers }) // INCOMPLETE si failures.length > 0, COMPLETE si no
}
```

`TelemetryIndex.read` pide `['api', \`repos/${repo}/contents/${METRICS_REPO_DIR}\`]` (la constante de `plugin/scripts/run-metrics.js`), exige que la respuesta parseada sea un array y se queda con los `name` de las entradas con `type === 'file'`; un `code` distinto de 0, un JSON ilegible o algo que no sea un array es `NOT_READ` con `detail = stderr.trim() || stdout.trim() || '(gh printed nothing)'`, o el mensaje del parseo. El vocabulario `SliceRead` lleva el nombre de cada lectura tal como lo verá quien lea un motivo.

**TDD:** `it('an_index_listed_with_files_knows_which_slices_left_telemetry_and_asked_gh_exactly_once')` — con un `ScriptedRunner` que responde al argv literal con `[{name:'issue-12.jsonl',type:'file'},{name:'issue-99.jsonl',type:'file'}]`: `has('issue-12.jsonl')` es `true`, `has('issue-13.jsonl')` es `false`, `outcome` es `LISTED`, y el runner grabó una sola petición.

**Tests:** añadidos — el de arriba; `a_listing_that_fails_is_not_read_and_carries_the_diagnosis_of_gh`; `a_listing_that_is_not_an_array_is_not_read_instead_of_an_empty_index`; `a_report_with_failures_is_incomplete_and_one_without_them_is_complete`; `a_report_not_read_carries_its_failure_and_no_row`.

**Verification:** los tests del módulo y la conformidad pasan; los dos ficheros están en `RUTAS`.

```bash
(cd plugin && npx vitest run __tests__/slice-harvest.test.js __tests__/modulos-conformes.test.js)
test "$(grep -c "'scripts/slice-harvest.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
test "$(grep -c "'__tests__/slice-harvest.test.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
```

### Task 2 — `SliceHarvest`: las lecturas de un slice, con el argv de hoy y sus desenlaces

**Objective:** dado un `gh` inyectado, `SliceHarvest` lee lo que hoy lee `ct-harvest.mjs` por issue (timeline, PR que lo cerró, fichero de telemetría) con el mismo argv y devuelve la fila con su desenlace.

**Files:** `plugin/scripts/slice-harvest.js` (modify), `plugin/__tests__/slice-harvest.test.js` (modify)

Contract (plugin/scripts/slice-harvest.js):

```js
export class SliceHarvest {
  static ISSUE_FIELDS = 'number,title,state,closedAt,labels,milestone,closedByPullRequestsReferences'
  static PULL_REQUEST_FIELDS = 'number,mergedAt,additions,deletions,changedFiles,reviews,comments'
  static RAW_ACCEPT = 'Accept: application/vnd.github.raw'
  static NO_COUNTS                       // el SIN_CUENTAS de ct-harvest.mjs, tal cual
  constructor({ gh })
  harvestIssue({ repo, number, index })  // gh issue view <number> --repo <repo> --json ISSUE_FIELDS; fallo → notRead(ISSUE)
  harvest({ repo, issue, index })        // SliceHarvestReport
}
```

Argv, literalmente los de `ct-harvest.mjs` hoy: timeline `['api', \`repos/${repo}/issues/${n}/timeline\`, '--paginate', '--slurp']` y `.flat()`; PR `['pr', 'view', String(p), '--repo', repo, '--json', PULL_REQUEST_FIELDS]` proyectado a `{ number, mergedAt, additions, deletions, changedFiles, reviews: reviews.length, reviewComments: comments.length }`; fichero `['api', \`repos/${repo}/contents/${rel}\`, '-H', RAW_ACCEPT]` con `rel = metricsRepoRelPath(n)`. La fila es `harvestSlice({ events, issue, pr })` más `telemetry`, con las reglas de hoy: índice `NOT_READ` → `{ status: 'no-leido', path: null, ...NO_COUNTS }`; fichero ausente del índice → `sin-fichero`; fichero leído → `{ status: 'ok', path: rel, ...aggregateVerdictMeasures(texto), ...aggregateBriefMeasures(texto) }`; fichero ilegible → `no-leido` con `path: rel` más `SliceReadFailure({ read: TELEMETRY_FILE, subject: rel, detail })`. Timeline fallido → `notRead(TIMELINE)`. PR fallido → fila con `pr: null` más `SliceReadFailure({ read: PULL_REQUEST, subject: p, detail })`. `closers = closingPrNumbers(issue, repo)` entero, y se lee solo el primero.

**TDD:** `it('a_slice_with_timeline_pull_request_and_telemetry_comes_back_complete_with_the_row_ct_harvest_prints_today')` — `toEqual` contra `{ ...harvestSlice({ events, issue, pr }), telemetry: {...} }` construido con los mismos módulos puros, y el runner grabó exactamente los tres argv. Madre `GitHubAnswers` con `.merged()`, `.timelineDown()`, `.pullRequestDown()`, `.telemetryFileDown()`, `.twoClosers()`.

**Tests:** añadidos — el de arriba; `a_timeline_that_cannot_be_read_is_not_read_and_carries_no_row`; `a_pull_request_that_cannot_be_read_leaves_the_row_incomplete_with_pr_null_and_names_the_read`; `a_telemetry_file_that_cannot_be_read_lands_as_no_leido_and_names_its_path`; `two_closing_pull_requests_are_reported_and_only_the_first_is_read`; `harvest_issue_asks_for_the_issue_with_the_exact_fields_and_a_failure_there_is_not_read`.

**Verification:** los tests del módulo pasan y sigue conforme.

```bash
(cd plugin && npx vitest run __tests__/slice-harvest.test.js __tests__/modulos-conformes.test.js)
```

### Task 3 — `/ct-harvest` lee cada slice con `SliceHarvest`, sin cambiar de comportamiento

**Objective:** `ct-harvest.mjs` deja de tener sus propias lecturas por issue y compone sus filas y sus motivos desde `SliceHarvestReport`, con la misma salida, los mismos motivos y el mismo argv de `gh` que hoy.

**Files:** `plugin/scripts/ct-harvest.mjs` (modify)

Current state (plugin/scripts/ct-harvest.mjs, lines 161-162):

```js
function timelineDe(n) {
  return JSON.parse(gh(['api', `repos/${repo}/issues/${n}/timeline`, '--paginate', '--slurp']))
```

Current state (plugin/scripts/ct-harvest.mjs, lines 269-269):

```js
for (const f of filas) f.telemetry = telemetriaDe(f.issue)
```

Call site (plugin/scripts/ct-harvest.mjs):

```js
const ghRunner = (a) => { try { return { code: 0, stdout: gh(a), stderr: '' } } catch (e) { return { code: 1, stdout: '', stderr: e.message } } }
const indice = TelemetryIndex.read({ gh: ghRunner, repo })
const cosechador = new SliceHarvest({ gh: ghRunner })
for (const issue of issues) {
  const informe = cosechador.harvest({ repo, issue, index: indice })
  if (informe.closers.length > 1) motivos.push(`el issue #${issue.number} lo cierran ${informe.closers.length} PRs (${informe.closers.map((n) => `#${n}`).join(', ')}); la fila cosecha solo el #${informe.closers[0]}`)
  for (const f of informe.failures) motivos.push(motivoDe(issue.number, f))
  if (informe.row) filas.push(informe.row)
}
```

Desaparecen `timelineDe`, `datosDelPr`, el listado del directorio, `SIN_CUENTAS`, `telemetriaDe` y el bucle actual; `dirTelemetria` pasa a derivarse de `indice.outcome` (`IndexOutcome.NOT_READ` → `{ status: 'no-leido', why: indice.detail }`) para que el bloque de telemetría del informe imprima lo mismo. `motivoDe(n, f)` es una función del anfitrión que reproduce los tres textos de hoy según `f.read`: `no se pudo leer el timeline del issue #${n}: ${detail}`, `no se pudieron leer los datos del PR #${subject} (issue #${n}): ${detail}`, `no se pudo leer la telemetría ${subject} (issue #${n}): ${detail}`; un `read` sin texto lanza. Las filas siguen ordenándose por issue y `telemetry` sigue viajando dentro de cada fila.

**TDD:** No TDD — refactor que preserva comportamiento; la red son los 27 tests de `plugin/__tests__/ct-harvest.test.js` y `plugin/__tests__/ct-harvest-bq.test.js`, que cubren los tres estados de telemetría, el fallo de fichero con exit 1, el listado no leído y el `--json`.

**Tests:** N/A — ninguno añadido ni quitado.

**Verification:** los dos ficheros de tests del comando siguen en verde y el fichero ya no define las lecturas.

```bash
(cd plugin && npx vitest run __tests__/ct-harvest.test.js __tests__/ct-harvest-bq.test.js)
test "$(grep -c 'function timelineDe\|function datosDelPr\|function telemetriaDe\|const SIN_CUENTAS' plugin/scripts/ct-harvest.mjs)" -eq 0
grep -q "from './slice-harvest.js'" plugin/scripts/ct-harvest.mjs
```

### Task 4 — `HarvestLedger`: la carga con su identidad y su directorio, en un módulo

**Objective:** dado la tabla, el runner de `bq`, un espacio de trabajo y una identidad, el ledger construye `HarvestIdentity`, proyecta las filas con `HarvestTable`, carga con `BigQueryLoad` y devuelve un informe con el `harvest_id`; borra el directorio si cargó y lo deja si no.

**Files:** `plugin/scripts/harvest-ledger.js` (create), `plugin/__tests__/harvest-ledger.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify: alta de los dos)

Contract (plugin/scripts/harvest-ledger.js):

```js
export class LedgerIdentity {
  static MANIFEST = new URL('../package.json', import.meta.url)
  static fromEnvironment()             // { pluginVersion: string|null, actor: userInfo().username, now: () => ISO, nextId: () => randomUUID() }
  constructor({ pluginVersion, actor, now, nextId })
}
export class LedgerReport {
  constructor({ outcome, table, rowCount, harvestId, directory, code, detail, retryCommand })
  static from({ identity, load })      // identity: HarvestIdentity; load: LoadReport
}
export class HarvestLedger {
  constructor({ table, bq, workspace, identity })   // workspace: { create: () => string, remove: (directory) => void }
  record({ repo, milestone, rows })   // LedgerReport; rows son filas de la cosecha (no proyectadas)
}
```

`record` crea el directorio con `workspace.create()`, construye `new HarvestIdentity({ harvestId: identity.nextId(), harvestedAt: identity.now(), repo, milestone, pluginVersion, actor })`, proyecta `rows.map((row) => HarvestTable.rowFor({ row, identity }))`, llama a `new BigQueryLoad({ bq, directory }).load({ table, rows, schemaJson: HarvestTable.schemaJson() })` y devuelve `LedgerReport.from`. Con `LoadOutcome.LOADED` llama a `workspace.remove(directory)`; con `REJECTED` no toca el directorio: quién lo conserva es decisión del entrypoint. `pluginVersion` se lee del manifiesto en `fromEnvironment` y es `null` si no se puede leer; nunca un centinela.

**TDD:** `it('a_loaded_record_carries_the_harvest_id_it_minted_and_removes_the_directory_it_created')` — con `nextId: () => 'uuid-1'`, `now: () => '2026-09-03T10:00:00.000Z'`, un runner que responde `{ code: 0 }` y un doble de `workspace` que graba `create`/`remove`: el informe trae `outcome` LOADED, `harvestId` 'uuid-1', `rowCount` 2, y `remove` se llamó con el directorio creado. El fichero `rows.ndjson` leído con `node:fs` lleva `"harvest_id":"uuid-1"` en cada línea.

**Tests:** añadidos — el de arriba; `a_rejected_record_leaves_the_directory_in_place_and_carries_code_detail_and_retry_command`; `the_identity_from_the_environment_reads_the_plugin_version_from_its_own_manifest` (igual a `version` de `plugin/package.json` leído por el test con `node:fs`); `a_null_milestone_travels_as_null_in_every_row`.

**Verification:** los tests del módulo y la conformidad pasan; los dos ficheros están en `RUTAS`.

```bash
(cd plugin && npx vitest run __tests__/harvest-ledger.test.js __tests__/modulos-conformes.test.js)
test "$(grep -c "'scripts/harvest-ledger.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
test "$(grep -c "'__tests__/harvest-ledger.test.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
```

### Task 5 — `/ct-harvest --bq` carga con `HarvestLedger`, y `milestone` admite `NULL`

**Objective:** el bloque de carga de `ct-harvest.mjs` se reduce a construir el ledger y proyectar su informe, con la misma salida que hoy; `HarvestTable` declara `milestone` como `NULLABLE`.

**Files:** `plugin/scripts/ct-harvest.mjs` (modify), `plugin/scripts/harvest-table.js` (modify), `plugin/__tests__/harvest-table.test.js` (modify)

Current state (plugin/scripts/ct-harvest.mjs, lines 271-271):

```js
if (bqTable && motivos.length) console.error(`BigQuery: no se carga — la cosecha está incompleta (${motivos.length} lectura(s) sin completar)`)
```

Call site (plugin/scripts/ct-harvest.mjs):

```js
else if (bqTable) {
  const ledger = new HarvestLedger({ table: bqTable, bq: bqRunner, workspace: { create: () => mkdtempSync(join(tmpdir(), 'ct-harvest-bq-')), remove: (d) => rmSync(d, { recursive: true, force: true }) }, identity: LedgerIdentity.fromEnvironment() })
  const informe = ledger.record({ repo, milestone, rows: filas })
  const PROYECCION_BQ = {
    [LoadOutcome.LOADED]: () => console.error(`BigQuery: ${informe.rowCount} filas cargadas en ${informe.table.id} (harvest_id ${informe.harvestId})`),
    [LoadOutcome.REJECTED]: () => motivos.push(`no se pudo cargar en BigQuery (${informe.table.id}): bq salió con ${informe.code}: ${informe.detail}. Los ficheros quedan en ${informe.directory}; reintenta a mano: ${informe.retryCommand}`),
  }
  PROYECCION_BQ[informe.outcome]()
}
```

Desaparecen de `ct-harvest.mjs` `versionDelPlugin`, `PLUGIN_VERSION` y los imports que solo ellos usaban (`randomUUID`, `userInfo`, `readFileSync`, `dirname`, `fileURLToPath`, `HarvestIdentity`, `HarvestTable`, `BigQueryLoad`); `bqRunner` se queda. En `plugin/scripts/harvest-table.js` la columna `milestone` pasa de `HarvestColumn.REQUIRED` a `HarvestColumn.NULLABLE`; nada más cambia allí.

**TDD:** `it('a_slice_without_milestone_lands_with_null_and_the_schema_admits_it')` en `plugin/__tests__/harvest-table.test.js` — identidad con `milestone: null`: `rowFor` da `milestone: null` y la declaración de la columna `milestone` en `schemaJson()` lleva `mode: 'NULLABLE'`.

**Tests:** añadidos — el de arriba. Los de `ct-harvest-bq.test.js` no cambian y siguen midiendo el mensaje de stderr, el argv de `bq` y las filas capturadas.

**Verification:** los tests del comando, del esquema y la conformidad pasan; el fichero ya no lee el manifiesto.

```bash
(cd plugin && npx vitest run __tests__/ct-harvest.test.js __tests__/ct-harvest-bq.test.js __tests__/harvest-table.test.js __tests__/modulos-conformes.test.js)
test "$(grep -c 'versionDelPlugin\|randomUUID\|userInfo' plugin/scripts/ct-harvest.mjs)" -eq 0
grep -q "from './harvest-ledger.js'" plugin/scripts/ct-harvest.mjs
```

### Task 6 — `dispatch-check --collect` acepta `--bq`, lo valida y lo anuncia en seco

**Objective:** `dispatch-check --collect` lee y valida `--bq` antes de tocar GitHub, lo nombra en `--dry-run`, y sin el flag no cambia ni un argv; el `gh` falso aprende a devolver un issue entero.

**Files:** `plugin/scripts/dispatch-check.mjs` (modify), `plugin/__tests__/fixtures/fake-gh-bin/gh` (modify), `plugin/__tests__/dispatch-check-collect-bq.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify: alta del test)

Current state (plugin/scripts/dispatch-check.mjs, lines 202-202):

```js
const usage = 'uso: dispatch-check.mjs <issue#> --repo <o/r> [--release | --reopen | --requeue | --check-plan | --collect] [--dry-run]'
```

Call site (plugin/scripts/dispatch-check.mjs):

```js
const bqArg = arg('--bq', null)
if (bqArg === true) dieErr(`--bq inválido: "(sin valor)" — ${usage}`, 2)
const bqTable = bqArg === null ? null : BigQueryTable.parse(bqArg)
if (bqArg !== null && !bqTable) dieErr(`--bq inválido: "${bqArg}" — debe tener la forma proyecto:dataset.tabla (p.ej. mi-proyecto:control_tower.harvest).`, 2)
```

El `usage` termina en `[--dry-run] [--bq <proyecto:dataset.tabla>]`. El bloque va junto a los demás flags, antes de cualquier `gh`, con `import { BigQueryTable, LoadOutcome } from './bigquery-load.js'` arriba. En la proyección de `--collect`, la línea de `WOULD_COLLECT` añade `` ` ; y cargaría 1 fila en ${bqTable.id}` `` cuando hay tabla; nada más cambia en esta tarea. En el `gh` falso, dentro del bloque de `issue view`, una invocación que contiene `--json number,title` responde `process.env.FAKE_GH_ISSUE_VIEW_JSON || '{}'` antes del camino de `labels`.

**TDD:** `it('a_malformed_table_exits_2_before_any_gh_call')` — bancada `Bench` calcada de `dispatch-check-collect.test.js` (repo git real, `fake-gh-bin`, `fake-cmux-bin` y `fake-bq-bin` en PATH): `--collect --bq nope` sale 2, stderr `/--bq inválido/`, y no existe el log de argv de `gh`.

**Tests:** añadidos — el de arriba; `without_the_flag_the_gh_argv_is_exactly_the_one_pull_request_list_of_today` (el log de `gh` es la única línea `pr list … --limit 10` y no existe el log de `bq`); `a_dry_run_with_the_flag_calls_neither_gh_beyond_today_nor_bq_and_says_it_would_load` (stdout termina en `; y cargaría 1 fila en p:d.t`, el worktree sigue).

**Verification:** los tests nuevos y los de siempre del `--collect` pasan; el rechazo llega antes de `gh`.

```bash
(cd plugin && npx vitest run __tests__/dispatch-check-collect-bq.test.js __tests__/dispatch-check-collect.test.js __tests__/modulos-conformes.test.js)
test "$(grep -c "'__tests__/dispatch-check-collect-bq.test.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
node plugin/scripts/dispatch-check.mjs 7 --repo o/r --collect --bq nope >/dev/null 2>&1; test $? -eq 2
```

### Task 7 — `dispatch-check --collect --bq`: la fila viaja antes de que se borre nada

**Objective:** con `--bq` válido y la guarda diciendo cosechar, `dispatch-check` carga la fila del slice y solo después borra; una lectura fallida es exit 3 y un `bq` que rechaza es exit 10, sin borrar nada.

**Files:** `plugin/scripts/dispatch-check.mjs` (modify), `plugin/__tests__/dispatch-check-collect-bq.test.js` (modify)

Current state (plugin/scripts/dispatch-check.mjs, lines 1418-1420):

```js
  const report = dryRun
    ? collector.rehearse({ artifacts: a, repo })
    : collector.collect({ artifacts: a, repo })
```

Call site (plugin/scripts/dispatch-check.mjs):

```js
  let cargada = ''
  if (bqTable && !dryRun && collector.rehearse({ artifacts: a, repo }).outcome === CollectionOutcome.WOULD_COLLECT) {
    const cosecha = new SliceHarvest({ gh: ghRunner }).harvestIssue({ repo, number: issue, index: TelemetryIndex.read({ gh: ghRunner, repo }) })
    if (cosecha.outcome !== SliceHarvestOutcome.COMPLETE) dieErr(`no se pudo leer la cosecha de #${issue}: ${lecturaFallida(cosecha)} — no se ha tocado nada, el siguiente barrido reintenta.`, 3)
    const ledger = new HarvestLedger({ table: bqTable, bq: localRunner('bq', COLLECT_BQ_TIMEOUT_MS), workspace: espacioTemporal, identity: LedgerIdentity.fromEnvironment() }).record({ repo, milestone: cosecha.row.milestone, rows: [cosecha.row] })
    if (ledger.outcome === LoadOutcome.REJECTED) { espacioTemporal.remove(ledger.directory); dieOut(`kept #${issue}: BigQuery (${bqTable.id}) rechazó la fila: bq salió con ${ledger.code}: ${ledger.detail} — no se ha borrado nada, el siguiente barrido reintenta`, 10) }
    cargada = ` ; 1 fila cargada en ${bqTable.id} (harvest_id ${ledger.harvestId})`
  }
```

Va justo antes de las tres líneas citadas. `COLLECT_BQ_TIMEOUT_MS = 120_000` junto a las constantes de git y cmux; `espacioTemporal` crea con `mkdtempSync(join(tmpdir(), 'ct-collect-bq-'))` y borra con `rmSync` recursivo; `lecturaFallida(c)` es `` `${c.failures[0].read} falló (${c.failures[0].detail})` ``. La línea de `COLLECTED` termina en `${cargada}`.

**TDD:** `it('a_merged_slice_loads_its_row_and_only_then_loses_worktree_branch_and_session')` — `FAKE_GH_ISSUE_VIEW_JSON` de un issue cerrado #7 con milestone, `FAKE_GH_PR_LIST` mergeada en la punta: exit 0, stdout contiene `; 1 fila cargada en p:d.t (harvest_id `, el `rows.ndjson` capturado tiene una línea con `"issue":7` y `"repo":"o/r"`, el argv de `bq` empieza por `--project_id=p --headless load`, y el worktree ya no existe.

**Tests:** añadidos — el de arriba; `a_rejected_load_keeps_worktree_branch_and_session_and_exits_10_naming_bq` (`FAKE_BQ_EXIT_CODE=2`); `a_timeline_that_cannot_be_read_exits_3_touches_nothing_and_never_calls_bq` (`FAKE_GH_TIMELINE_FAIL=1`).

**Verification:** los tests del `--collect` con y sin `--bq` pasan.

```bash
(cd plugin && npx vitest run __tests__/dispatch-check-collect-bq.test.js __tests__/dispatch-check-collect.test.js)
```

### Task 8 — el backend lee `CT_HARVEST_BQ_TABLE` al arrancar

**Objective:** `Invocation` conoce la tabla de BigQuery del entorno, rehúsa el arranque si está mal formada y la expone al cableado; vacía o ausente significa «sin tabla».

**Files:** `backend/src/infrastructure/invocation.js` (modify), `backend/__tests__/infrastructure/invocation.test.js` (modify)

Current state (backend/src/infrastructure/invocation.js, lines 8-11):

```js
  static DEFAULT_PORT = 8787
  static PORT_VARIABLE = 'CT_API_PORT'
  static CLAIM_PREFIX = 'CT_CLAIM_'
  static CHILD_TIMEOUT_VARIABLE = 'CT_CLAIM_CHILD_TIMEOUT_MS'
```

Contract (backend/src/infrastructure/invocation.js):

```js
import { BigQueryTable } from '../../../plugin/scripts/bigquery-load.js'
export const InvocationOutcome = Object.freeze({ READY, UNEXPECTED_ARGUMENT, MALFORMED_PORT, MALFORMED_HARVEST_TABLE: 'malformed-harvest-table' })
export class Invocation {
  static HARVEST_TABLE_VARIABLE = 'CT_HARVEST_BQ_TABLE'
  constructor({ outcome, port, harvestTable, reason })   // harvestTable: BigQueryTable | null; null también en READY sin variable
  static from(argv, environment)                         // lee el puerto como hoy y después la tabla
}
```

La tabla se lee después del puerto: `given === undefined || given === ''` → `harvestTable: null`; `BigQueryTable.parse(given)` nulo → `#refused(MALFORMED_HARVEST_TABLE, \`${HARVEST_TABLE_VARIABLE} must look like proyecto:dataset.tabla, got ${JSON.stringify(given)}\`)`; si parsea, `READY` con la instancia. Los rechazos siguen llevando `port: null` y `harvestTable: null`. `harvestEnvironment` no cambia: la variable viaja al hijo por el argv, no por el entorno.

**TDD:** `it('a_well_formed_harvest_table_in_the_environment_reaches_the_invocation_parsed')` — `Invocation.from([], { CT_HARVEST_BQ_TABLE: 'p:d.t' })` da `READY` y `harvestTable.id === 'p:d.t'`.

**Tests:** añadidos — el de arriba; `without_the_variable_or_with_it_empty_there_is_no_harvest_table_and_the_port_still_settles`; `a_malformed_harvest_table_refuses_the_start_naming_the_variable_and_what_it_got`. Madre `Invoked.withHarvestTable(given)`.

**Verification:** los tests de `Invocation` pasan y el fichero importa el lector del plugin.

```bash
(cd backend && npx vitest run __tests__/infrastructure/invocation.test.js)
grep -q "plugin/scripts/bigquery-load.js" backend/src/infrastructure/invocation.js
```

### Task 9 — el backend pide la carga en cada barrido

**Objective:** cuando el arranque trae tabla, `DispatchCheckHarvest` añade `--bq <tabla>` al argv de cada cosecha, `ct-api.mjs` la cablea y la nombra en su `usage`, y el lenguaje ubicuo la recoge.

**Files:** `backend/src/infrastructure/dispatch-check-harvest.js` (modify), `backend/__tests__/infrastructure/dispatch-check-harvest.test.js` (modify), `backend/src/infrastructure/ct-api.mjs` (modify), `backend/conventions/domain.md` (modify)

Current state (backend/src/infrastructure/dispatch-check-harvest.js, lines 38-40):

```js
  static argvFor({ dispatchCheck, issueNumber, repository }) {
    return [dispatchCheck, String(issueNumber), '--repo', repository.text, '--collect']
  }
```

Contract (backend/src/infrastructure/dispatch-check-harvest.js):

```js
  constructor({ node, dispatchCheck, root, harvestTable })   // harvestTable: BigQueryTable | null
  static argvFor({ dispatchCheck, issueNumber, repository, harvestTable })
  // con tabla: [...los cinco de hoy, '--bq', harvestTable.id]; sin tabla: los cinco de hoy
```

Current state (backend/src/infrastructure/ct-api.mjs, lines 87-88):

```js
  static #USAGE =
    `usage: ct-api.mjs (no arguments; set ${Invocation.PORT_VARIABLE} to pick a port, 0 for an ephemeral one)`
```

El `usage` pasa a `… 0 for an ephemeral one; set ${Invocation.HARVEST_TABLE_VARIABLE} to proyecto:dataset.tabla so every harvest loads its row into BigQuery)`. `#harvestClock` recibe `asked.harvestTable` desde `run` y lo pasa al constructor de `DispatchCheckHarvest`; ningún otro cableado cambia.

Final text (backend/conventions/domain.md):

```
| **Harvest ledger** | The BigQuery table where every harvested slice leaves its row, shared by every team and told apart by `repo`; the plugin loads it, the backend only says which table (`CT_HARVEST_BQ_TABLE`) |
```

Va como fila nueva de la tabla «Ubiquitous language», justo debajo de la fila **Harvest**.

**TDD:** `it('with_a_harvest_table_the_command_asks_the_plugin_to_load_the_row_after_the_five_arguments_of_today')` — `argvFor` con `harvestTable: BigQueryTable.parse('p:d.t')` es `[CHECK, '7', '--repo', 'owner/name', '--collect', '--bq', 'p:d.t']`, y `collect()` corre exactamente ese argv.

**Tests:** añadidos — el de arriba; `without_a_harvest_table_the_argv_is_byte_for_byte_the_one_of_today`. `HarvestDouble` gana el parámetro `harvestTable` con `null` por defecto.

**Verification:** la suite del backend pasa y la fila del lenguaje ubicuo está.

```bash
(cd backend && npm test)
grep -q 'Harvest ledger' backend/conventions/domain.md
grep -q 'HARVEST_TABLE_VARIABLE' backend/src/infrastructure/ct-api.mjs
```

### Task 10 — la documentación y el `Makefile`

**Objective:** quien lee cómo se recoge un slice, cómo se arranca el backend o qué hace `/ct-harvest --bq` encuentra el camino automático y la variable que lo enciende.

**Files:** `plugin/README.md` (modify), `plugin/commands/ct-next.md` (modify), `plugin/commands/ct-harvest.md` (modify), `README.md` (modify), `Makefile` (modify)

Current state (plugin/README.md, lines 67-67):

```
si no, no toca nada y dice cuál de las tres falla (`--dry-run` lo cuenta sin mutar).
```

Final text (plugin/README.md):

```
si no, no toca nada y dice cuál de las tres falla (`--dry-run` lo cuenta sin mutar). Con `--bq <proyecto:dataset.tabla>` —que el backend añade solo cuando arranca con `CT_HARVEST_BQ_TABLE`— antes de borrar carga en BigQuery la fila de ese slice (fases, reopens, requeues, PR y telemetría del juez); si la carga falla no se borra nada y el siguiente barrido reintenta.
```

Current state (plugin/commands/ct-next.md, lines 118-118):

```
este comando es la puerta por la que un barrido puede recogerla sin que nadie decida a ojo.
```

Final text (plugin/commands/ct-next.md):

```
este comando es la puerta por la que un barrido puede recogerla sin que nadie decida a ojo. Y con `--bq <proyecto:dataset.tabla>` la recogida deja antes la fila del slice en BigQuery: si la carga falla, exit `10` y nada se borra.
```

Final text (plugin/commands/ct-harvest.md):

```
Este comando carga un epic entero a posteriori. La carga de cada slice al recogerlo la hace la cosecha automática: `dispatch-check <n> --repo <o/r> --collect --bq <tabla>`, que el backend invoca cada minuto cuando arranca con `CT_HARVEST_BQ_TABLE`.
```

Va como párrafo final de la sección «A BigQuery, con la CLI de `bq`». En `README.md` (raíz), tras la frase que nombra `make run-backend`, una frase nueva: *`CT_HARVEST_BQ_TABLE=proyecto:dataset.tabla make run-backend` hace además que cada slice recogido deje su fila en esa tabla de BigQuery; sin la variable, la cosecha no carga nada.* En `Makefile`, el objetivo `run-backend` pasa a `CT_API_PORT=$(CT_API_PORT) CT_HARVEST_BQ_TABLE=$(CT_HARVEST_BQ_TABLE) node backend/src/infrastructure/ct-api.mjs`, y la cabecera de ayuda de `run-backend` añade `; CT_HARVEST_BQ_TABLE=proyecto:dataset.tabla carga cada slice recogido en BigQuery`.

No code — documentación y configuración: los bloques son texto literal y el `Makefile` va en prosa.

**TDD:** No TDD — documentación y configuración.

**Tests:** N/A — ninguno añadido ni quitado.

**Verification:** los textos están y el `Makefile` pasa la variable.

```bash
grep -q 'CT_HARVEST_BQ_TABLE' plugin/README.md
grep -q 'CT_HARVEST_BQ_TABLE' README.md
grep -q -- '--collect --bq' plugin/commands/ct-harvest.md
grep -q 'exit `10` y nada se borra' plugin/commands/ct-next.md
grep -q 'CT_HARVEST_BQ_TABLE=$(CT_HARVEST_BQ_TABLE) node backend/src/infrastructure/ct-api.mjs' Makefile
(cd plugin && npx vitest run __tests__/manifest.test.js __tests__/frontera-de-distribucion.test.js)
```

## 8. Global verification

Con las diez tareas commiteadas: las dos suites en verde, el `--collect` rehúsa una tabla mal
formada antes de tocar GitHub, el backend rehúsa arrancar con la variable mal formada, y el árbol
está limpio. Lo que hay que mirar con ojos, cuando exista el dataset: arrancar el backend con
`CT_HARVEST_BQ_TABLE`, mergear la PR de un slice real y ver aparecer su fila en la tabla al minuto,
con `harvest_id` propio y `NULL` donde el informe imprime `—`.

```bash
(cd plugin && npm test)
(cd backend && npm test)
node plugin/scripts/dispatch-check.mjs 7 --repo o/r --collect --bq nope >/dev/null 2>&1; test $? -eq 2
CT_HARVEST_BQ_TABLE=nope node backend/src/infrastructure/ct-api.mjs >/dev/null 2>&1; test $? -eq 2
test -z "$(git status --porcelain)"
```

## 9. Assumptions

1. **Cargar antes de borrar** — decisión propia: la fila sale de GitHub, no del worktree, así que el orden no cambia el dato; lo que compra es que un fallo de carga deje el slice tal cual y el siguiente barrido lo reintente sin que nadie teclee nada.
2. **Sin código de salida nuevo** — `3` (no leído, reintenta) y `10` (conservado, nada borrado) ya dicen exactamente lo que pasa; un código nuevo obligaría a tocar el contrato del backend (`DispatchCheckHarvest`, `HarvestOutcome`, `SweepLine`) por una distinción que el barrido no trata distinto.
3. **La variable la lee el backend y viaja por argv** — el plugin mantiene «todo en argv»; el entorno que el backend pasa al hijo ya se filtra (`harvestEnvironment`) y meter la tabla ahí sería una segunda vía para el mismo dato.
4. **Vacía = ausente** — `make run-backend` exporta `CT_HARVEST_BQ_TABLE=$(CT_HARVEST_BQ_TABLE)` aunque nadie la haya dado, y eso llega como cadena vacía; tratarla como ausente evita que el `Makefile` rompa el arranque por defecto.
5. **El backend importa `BigQueryTable` del plugin** — `backend/conventions/architecture.md`: el backend se apoya en los lectores del plugin en vez de transcribir su regex.
6. **`milestone` NULLABLE** — un slice recogido puede no tener milestone y `REQUIRED` haría rechazar la carga para siempre; un `NULL` es honesto. No hay tabla creada todavía, así que no hace falta relajar nada en BigQuery.
7. **Índice de telemetría no leído no es fallo** — mismo criterio que `/ct-harvest` hoy: un repo sin `docs/superpowers/metrics` lista con error y bloquearía la cosecha para siempre; la fila lo dice con `telemetry_status = no-leido`.
8. **`INCOMPLETE` no se carga en `--collect`** — una fila con huecos por una lectura transitoria quedaría para siempre; el siguiente barrido lo reintenta gratis.
9. **Dos `gh pr list` en el camino con `--bq`** — `rehearse` antes de cargar y `collect` después vuelve a leer la PR; es una lectura barata y evita abrir la API privada de `SliceCollector`. Sin `--bq` se llama a `collect` directamente y el argv de hoy no cambia.
10. **`LedgerIdentity` localiza el manifiesto desde su propio módulo** — así los dos entrypoints dejan de leer `package.json` cada uno por su lado; `ct-step.mjs` sigue con su lector, deuda declarada fuera de este plan.
11. **Los textos de `--collect` siguen en castellano** — es el entrypoint de deuda declarada y el backend los repite tal cual en su stderr; cambiar de idioma ahí sería una decisión de producto, no de este plan.
12. **El plan no lleva número de issue** — misma convención que `docs/superpowers/plans/2026-09-03-cosecha-a-bigquery.md`; se valida con `validatePlan` con rutas relativas a la raíz.
