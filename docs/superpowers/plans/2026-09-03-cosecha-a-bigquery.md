# La cosecha viaja a BigQuery — `/ct-harvest --bq`

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, this document's §2 and the five documents of
> `plugin/conventions/` win.

## 1. Context and goal

`plugin/scripts/ct-harvest.mjs` lee GitHub con `gh` y compone una fila por slice del epic
(`harvestSlice` en `plugin/scripts/harvest.js`: fases en segundos, reopens, requeues, episodios
`blocked`, tamaño del PR) más la telemetría del juez agregada por `plugin/scripts/run-metrics.js`.
La imprime como tabla markdown o, con `--json`, como `{repo, milestone, filas, motivos, telemetry}`.
Ahí termina: el dato está estructurado y no viaja a ningún sitio.

Se pide que, al terminar una cosecha, las filas se carguen en una tabla de BigQuery con la CLI
`bq` que los desarrolladores ya tienen autenticada, igual que `gh`. El «cómo» es un flag nuevo del
comando que ya existe, `--bq <proyecto:dataset.tabla>`; sin el flag nada cambia. El transporte es
`bq load` de un NDJSON: gratis, crea la tabla en la primera carga con el esquema que viaja en el
plugin, y admite columnas nuevas sin migración.

### Desired end state

- `node plugin/scripts/ct-harvest.mjs --repo o/r --milestone E --bq p:d.t` cosecha como hoy y,
  si la cosecha está completa, escribe `rows.ndjson` (una línea por slice) y `schema.json` en un
  directorio temporal y ejecuta `bq --project_id=p --headless load --source_format=NEWLINE_DELIMITED_JSON
  --schema_update_option=ALLOW_FIELD_ADDITION --schema=<dir>/schema.json p:d.t <dir>/rows.ndjson`.
  Con exit 0 de `bq`: stderr dice `BigQuery: N filas cargadas en p:d.t (harvest_id <uuid>)`, el
  directorio se borra, exit 0.
- Cosecha incompleta (`motivos` no vacío): no se invoca `bq`, stderr lo dice, exit 1 (ya lo era).
- `bq` sale distinto de 0: un motivo con el código, el diagnóstico, el directorio que se conserva y
  el comando exacto para reintentar a mano; exit 1.
- `--bq` mal formado o sin valor: exit 2 antes de la primera llamada a `gh`.
- Todo lo que el informe imprime como `—` llega como `null` JSON, nunca como `0`.
- El esquema se declara UNA vez en código (`HarvestTable.SCHEMA`); el fichero de esquema y cada
  fila se derivan de esa declaración.
- stdout intacto (tabla o JSON); todo lo de BigQuery va por stderr.
- Módulos nuevos conformes y dados de alta en `NacidosConformes.RUTAS`; `bq` falso para los tests;
  doc del comando; versión 0.53.0.

### Out of scope

- Crear el dataset, dar permisos, particionar o clusterizar la tabla: decisión única de quien
  posee el proyecto, fuera del plugin.
- Cargar la telemetría por intento (`docs/superpowers/metrics/issue-<n>.jsonl`) como segunda tabla.
- Deduplicar o `MERGE`: cada cosecha se AÑADE como foto con `harvest_id`/`harvested_at`; la
  «última cosecha» es una vista del consumidor.
- Que el backend o el front invoquen `--bq` solos.
- Cambiar qué mide la cosecha o el informe de stdout.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Transporte | `bq load` de NDJSON; nunca `bq insert` (streaming, de pago, exige tabla previa) ni `INSERT` SQL (factura bytes) |
| Flag | `--bq <proyecto:dataset.tabla>`, leído con el `arg()` que ya tiene el fichero; sin flag, comportamiento y argv de `gh` idénticos a hoy |
| Forma del id | `^([A-Za-z0-9-]+):([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$`; lo que no encaje es exit 2 |
| argv de `bq` | `--project_id=<proyecto>`, `--headless`, `load`, `--source_format=NEWLINE_DELIMITED_JSON`, `--schema_update_option=ALLOW_FIELD_ADDITION`, `--schema=<dir>/schema.json`, `<id>`, `<dir>/rows.ndjson`, en ese orden |
| Esquema | declarado UNA vez en `HarvestTable.SCHEMA` (lista de `HarvestColumn`); `schemaJson()` y `rowFor()` se derivan de la misma lista |
| Nulos | la regla «`—` es `null`, no `0`» vive en el modelo de frontera (`HarvestColumn.valueOf`), no en el agregador ni en el esquema |
| Clave ausente | `rowFor` lanza si una clave que el esquema consume llega `undefined`: `null` es medida ausente, `undefined` es un contrato que cambió |
| Solo cosecha completa | con `motivos` no vacío no se invoca `bq`; la cosecha se rehace desde GitHub, así que no se pierde nada |
| Cosecha vacía | cero filas y `--bq`: no se invoca `bq`, stderr `BigQuery: nada que cargar — el milestone no tiene slices`, exit 0 |
| Identidad | `harvest_id` = `randomUUID()`, `harvested_at` = `new Date().toISOString()`, `repo`, `milestone`, `plugin_version` = `version` del `package.json` del plugin (`null` si ilegible), `actor` = `os.userInfo().username` |
| Directorio temporal | `mkdtempSync(join(tmpdir(), 'ct-harvest-bq-'))`, creado y borrado por el entrypoint: se borra tras `LOADED`, se conserva y se nombra tras `REJECTED` |
| Tope del subproceso | el `CHILD_TIMEOUT_MS` que ya existe en `ct-harvest.mjs`; el adaptador recibe el runner con el tope puesto y no lo elige |
| Desenlaces | `LoadOutcome = { LOADED: 'loaded', REJECTED: 'rejected' }`; proyección exhaustiva a (canal, texto, exit) en el entrypoint; desenlace sin fila lanza |
| Columnas | `snake_case`; las de telemetría reutilizan los nombres del `jsonl` (`rubric_sin_vara`, `findings_vara_ct`, `brief_bytes`…) porque son contrato |
| Valores de vocabulario | `telemetry_status` y `merge_source` viajan con la grafía del contrato `--json`: `ok`/`sin-fichero`/`no-leido`, `pr-merged`/`issue-closed` |
| Versión | `0.53.0` en `plugin/package.json`, `plugin/.claude-plugin/plugin.json` y la tabla del `plugin/README.md` |

## 3. Reference patterns

Files to imitate: `plugin/scripts/slice-collector.js` (adaptador con runners inyectados,
vocabulario cerrado de desenlaces, informe con constructores estáticos), `plugin/scripts/slice-collection.js`
(objetos de valor y constructores de argv), `plugin/__tests__/slice-collector.test.js` (dobles
`ScriptedRunner`/`Conversation` que lanzan si nadie escribió la respuesta, madres con escenarios
nombrados), `plugin/__tests__/ct-harvest.test.js` (bancada spawn con el `gh` falso por PATH),
`plugin/__tests__/fixtures/fake-cmux-bin/cmux` (binario falso gobernado por variables de entorno),
`plugin/__tests__/modulos-conformes.test.js` (la lista `RUTAS` de módulos nacidos conformes).

Rules to obey: este repo no declara .agent/conventions.md, AGENTS.md ni CLAUDE.md — N/A. La vara
es la del propio plugin, y ata en todo diff: `plugin/conventions/style.md` (inglés, sin prosa,
toda función cuelga de un tipo), `plugin/conventions/architecture.md` (frontera validada por
proyección; el adaptador no elige tope ni política; exit distinto de cero es dato),
`plugin/conventions/defects.md` (vocabulario cerrado, sin mapas crudos como retorno de lógica, sin
centinelas, sin dos campos que deban concordar), `plugin/conventions/testing.md` (el nombre del
test es la frase; madres; aserción vista en rojo por su motivo) y `plugin/conventions/decisions.md`.
`plugin/scripts/ct-harvest.mjs` es deuda declarada (castellano, funciones libres): lo que se le
añade sigue el estilo del anfitrión, pero `plugin/conventions/defects.md` ata igual.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/harvest-table.js` | create | `ct-harvest.mjs` | Contract |
| `plugin/__tests__/harvest-table.test.js` | create | vitest | none (body by TDD) |
| `plugin/scripts/bigquery-load.js` | create | `ct-harvest.mjs` | Contract |
| `plugin/__tests__/bigquery-load.test.js` | create | vitest | none (body by TDD) |
| `plugin/__tests__/fixtures/fake-bq-bin/bq` | create | `ct-harvest-bq.test.js` | prose |
| `plugin/__tests__/ct-harvest-bq.test.js` | create | vitest | none (body by TDD) |
| `plugin/__tests__/modulos-conformes.test.js` | modify | vitest | prose |
| `plugin/scripts/ct-harvest.mjs` | modify | el desarrollador | Current state / Call site |
| `plugin/commands/ct-harvest.md` | modify | quien lee el comando | Current state / Final text |
| `plugin/package.json`, `plugin/.claude-plugin/plugin.json`, `plugin/README.md` | modify | `manifest.test.js` | prose (config) |

## 5. Interfaces

Consumes: la fila de `--json` tal y como hoy la produce `ct-harvest.mjs` — el objeto de
`harvestSlice({ events, issue, pr })` de `plugin/scripts/harvest.js` con `telemetry` dentro
(`{ status, path, ...aggregateVerdictMeasures(texto), ...aggregateBriefMeasures(texto) }` de
`plugin/scripts/run-metrics.js`, o el `SIN_CUENTAS` del propio entrypoint). No se toca ninguno.

Produces:
- `HarvestIdentity` — `new HarvestIdentity({ harvestId, harvestedAt, repo, milestone, pluginVersion, actor })`.
- `HarvestColumn` — `new HarvestColumn({ name, type, mode, fields, valueOf })`, `declaration()`.
- `HarvestTable.SCHEMA: HarvestColumn[]`, `HarvestTable.schemaJson(): string`,
  `HarvestTable.rowFor({ row, identity }): object` (el objeto de cable, clave por columna).
- `BigQueryTable.parse(text): BigQueryTable | null`, con `project` e `id`.
- `LoadOutcome`, `LoadReport` (`outcome, table, rowCount, directory, argv, code, detail`,
  `retryCommand`), `BigQueryLoad.argvFor({ table, directory }): string[]`,
  `new BigQueryLoad({ bq, directory }).load({ table, rows, schemaJson }): LoadReport`.

## 6. Test strategy

De fuera adentro y sin red: `harvest-table` se prueba contra el payload literal de la fila y del
esquema; `bigquery-load` con un `ScriptedRunner` que graba el argv y lanza ante una petición sin
respuesta escrita, leyendo con `node:fs` real lo que el adaptador dejó en un `mkdtemp`; el
entrypoint por spawn con `gh` y `bq` falsos en el PATH, como `ct-harvest.test.js`. Cada fichero
nuevo nace conforme y se da de alta en `NacidosConformes.RUTAS` en la tarea que lo crea; los
nombres de test son frases en inglés ASCII. Ningún control clava el total de la suite. Cada
aserción se rompe a mano una vez y se ve caer por el motivo de su nombre. La suite entera
(`npm test` en `plugin/`, que es `npm run build && vitest run`) cierra cada tarea.

## 7. Tasks

### Task 1 — `HarvestTable`: el esquema declarado una vez y la fila de un slice

**Objective:** una fila de la cosecha se proyecta a un objeto de cable con los nombres del esquema, donde todo `null` sigue siendo `null`, y el esquema JSON sale de la misma lista.

**Files:** `plugin/scripts/harvest-table.js` (create), `plugin/__tests__/harvest-table.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify: alta de los dos)

Contract (plugin/scripts/harvest-table.js):

```js
export class HarvestIdentity {
  constructor({ harvestId, harvestedAt, repo, milestone, pluginVersion, actor })
}
export class HarvestColumn {
  static REQUIRED = 'REQUIRED'
  static NULLABLE = 'NULLABLE'
  static REPEATED = 'REPEATED'
  constructor({ name, type, mode, fields = null, valueOf })
  declaration()
}
export class HarvestTable {
  static SCHEMA
  static schemaJson()
  static rowFor({ row, identity })
}
```

`declaration()` devuelve `{ name, type, mode }` y añade `fields` (array de declaraciones) solo en
el `RECORD`. `schemaJson()` es `JSON.stringify(SCHEMA.map((c) => c.declaration()))`. `rowFor` es
`Object.fromEntries(SCHEMA.map((c) => [c.name, c.valueOf(row, identity)]))`, y cada `valueOf` lanza
`new Error(\`the harvest row carries no "<clave>"\`)` si la clave que consume llega `undefined`.

Columnas de esta tarea, en este orden. Identidad, `REQUIRED` salvo aviso: `harvest_id STRING`,
`harvested_at TIMESTAMP`, `repo STRING`, `milestone STRING`, `plugin_version STRING NULLABLE`,
`actor STRING`. Slice: `issue INTEGER REQUIRED` (`row.issue`); `title`, `type`, `gate`, `area`
`STRING NULLABLE`; `ready_to_claim_seconds`, `claim_to_release_seconds`, `release_to_merge_seconds`
`INTEGER NULLABLE` (de `readyToClaim`, `claimToRelease`, `releaseToMerge`); `merge_source STRING
NULLABLE`; `reopens`, `requeues` `INTEGER REQUIRED`; `blocked RECORD REPEATED` con `started_at
TIMESTAMP REQUIRED`, `ended_at TIMESTAMP NULLABLE`, `seconds INTEGER NULLABLE` (de `from`, `to`,
`seconds` de cada episodio). PR, todo `INTEGER NULLABLE`: `pr`, `additions`, `deletions`,
`changed_files`, `reviews`, `review_comments`.

**TDD:** `it('the_row_of_a_slice_carries_the_identity_and_the_phases_in_seconds_under_the_schema_names')` — `toEqual` contra el objeto literal completo. Madres: `HarvestRows.merged()`, `.unmeasured()` (fases `null`), `.stillBlocked()`; `Identities.today()`.

**Tests:** añadidos — el de arriba; `a_phase_nobody_measured_lands_as_null_and_never_as_zero`; `a_blocked_episode_still_open_lands_with_ended_at_and_seconds_null`; `a_row_missing_a_key_the_schema_consumes_raises_instead_of_landing_a_hole` (`toThrow(/reopens/)`); `the_schema_json_declares_blocked_as_a_repeated_record_with_its_three_fields` (contra la declaración literal).

**Verification:** los tests del módulo y la conformidad pasan; el módulo y su test están en `RUTAS`.

```bash
(cd plugin && npx vitest run __tests__/harvest-table.test.js __tests__/modulos-conformes.test.js)
test "$(grep -c "'scripts/harvest-table.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
test "$(grep -c "'__tests__/harvest-table.test.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
```

### Task 2 — `HarvestTable`: las columnas de la telemetría del juez, con sus nulos

**Objective:** la telemetría de cada slice llega a la fila con los nombres del `jsonl`, y toda medida que ningún veredicto trajo llega como `null` aunque el agregado diga `0`.

**Files:** `plugin/scripts/harvest-table.js` (modify), `plugin/__tests__/harvest-table.test.js` (modify)

Contract (plugin/scripts/harvest-table.js):

```
telemetry_status            STRING  REQUIRED  row.telemetry.status; fuera de {ok, sin-fichero, no-leido} lanza
telemetry_path              STRING  NULLABLE  row.telemetry.path
verdicts                    INTEGER NULLABLE  status ok -> telemetry.verdicts; si no, null
malformed_lines             INTEGER NULLABLE  ok -> telemetry.malformed
rubric_sin_vara             INTEGER NULLABLE  ok && telemetry.measured > 0 -> rubricSinVara
rubric_sin_vara_legacy      INTEGER NULLABLE  ok -> telemetry.legacy
rubric_vara_ct_docs         INTEGER NULLABLE  ok && measuredVaraCtDocs > 0 -> varaCtDocs
rubric_vara_ct_docs_legacy  INTEGER NULLABLE  ok -> legacyVaraCtDocs
findings_vara_ct            INTEGER NULLABLE  ok && measuredFindingsVaraCt > 0 -> findingsVaraCt
findings_vara_ct_legacy     INTEGER NULLABLE  ok -> legacyFindingsVaraCt
findings_by_rule            RECORD  REPEATED  { rule STRING REQUIRED, findings INTEGER REQUIRED }; ok -> entradas ordenadas por rule; si no, []
brief_attempts              INTEGER NULLABLE  ok -> briefAttempts
brief_legacy                INTEGER NULLABLE  ok -> briefLegacy
brief_vara_ct_docs          INTEGER NULLABLE  ok && briefMeasured > 0 -> briefVaraCtDocs
brief_bytes                 INTEGER NULLABLE  ok && briefMeasured > 0 -> briefBytes
```

Las quince se añaden a `SCHEMA` detrás de las de la Task 1, en este orden. La condición `measured > 0`
se evalúa AQUÍ, en `valueOf`, aunque el agregador ya devuelva `null`: la regla es de la frontera. El
vocabulario de `telemetry_status` es una constante cerrada del módulo (`TelemetryStatus`), y un
valor fuera de él lanza `new Error(\`unknown telemetry status "<valor>"\`)`.

**TDD:** `it('a_measure_no_verdict_carried_lands_as_null_even_when_the_aggregate_says_zero')` — fila con `telemetry.measured: 0, rubricSinVara: 0` → `rubric_sin_vara: null`; y el simétrico con `measured: 2, rubricSinVara: 0` → `0`. Madre nueva: `HarvestRows.withTelemetry(overrides)`, `.withoutTelemetryFile()`.

**Tests:** añadidos — el de arriba; `a_slice_without_telemetry_file_carries_its_status_and_null_in_every_count`; `findings_by_rule_land_as_repeated_records_sorted_by_rule` (`{ patrones: 2, alcance: 1 }` → `[{ rule: 'alcance', findings: 1 }, { rule: 'patrones', findings: 2 }]`); `a_telemetry_status_outside_the_vocabulary_raises_instead_of_landing`.

**Verification:** los tests del módulo pasan y el esquema declara `findings_by_rule` como repetido.

```bash
(cd plugin && npx vitest run __tests__/harvest-table.test.js __tests__/modulos-conformes.test.js)
node -e "import('./plugin/scripts/harvest-table.js').then((m) => { const s = JSON.parse(m.HarvestTable.schemaJson()); process.exit(s.some((c) => c.name === 'findings_by_rule' && c.mode === 'REPEATED') ? 0 : 1) })"
```

### Task 3 — `BigQueryLoad`: el adaptador que escribe el NDJSON y llama a `bq load`

**Objective:** dado un directorio, una tabla y las filas, el adaptador deja `rows.ndjson` y `schema.json` en disco, invoca `bq` con el argv exacto y devuelve un informe cuyo desenlace es el exit code de `bq` interpretado como dato.

**Files:** `plugin/scripts/bigquery-load.js` (create), `plugin/__tests__/bigquery-load.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify: alta de los dos)

Contract (plugin/scripts/bigquery-load.js):

```js
export const LoadOutcome = Object.freeze({ LOADED: 'loaded', REJECTED: 'rejected' })
export class BigQueryTable {
  static ID = /^([A-Za-z0-9-]+):([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/
  static parse(text)
  get project()
  get id()
}
export class LoadReport {
  constructor({ outcome, table, rowCount, directory, argv, code, detail })
  static loaded({ table, rowCount, directory, argv })
  static rejected({ table, rowCount, directory, argv, code, detail })
  get retryCommand()
}
export class BigQueryLoad {
  static PROGRAM = 'bq'
  static ROWS_FILE = 'rows.ndjson'
  static SCHEMA_FILE = 'schema.json'
  static SOURCE_FORMAT = '--source_format=NEWLINE_DELIMITED_JSON'
  static SCHEMA_UPDATE = '--schema_update_option=ALLOW_FIELD_ADDITION'
  static argvFor({ table, directory })
  constructor({ bq, directory })
  load({ table, rows, schemaJson })
}
```

`parse` devuelve `null` si `ID` no encaja. `argvFor` devuelve `[\`--project_id=${table.project}\`,
'--headless', 'load', SOURCE_FORMAT, SCHEMA_UPDATE, \`--schema=${join(directory, SCHEMA_FILE)}\`,
table.id, join(directory, ROWS_FILE)]`. `load` escribe el NDJSON (`rows.map((r) => JSON.stringify(r) + '\n').join('')`)
y `schemaJson` tal cual, llama a `bq(argv)` — un `(argv) => { code, stdout, stderr }` con el tope ya
puesto — y proyecta: `code === 0` → `loaded`; otro → `rejected` con `code` y `detail = (stderr.trim() || stdout.trim())`.
`retryCommand` es `[PROGRAM, ...argv].join(' ')`. El adaptador no borra el directorio ni decide reintentos.

**TDD:** `it('a_load_writes_one_line_per_row_the_schema_and_calls_bq_with_the_exact_argv')` — el runner grabado recibe el array literal; `readFileSync(join(dir, 'rows.ndjson'))` es `JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n'`. Dobles como en `slice-collector.test.js`; el `mkdtemp` lo crea el test con `node:fs`, no el adaptador.

**Tests:** añadidos — el de arriba; `a_non_zero_exit_of_bq_is_a_rejected_report_that_carries_the_code_the_diagnosis_and_the_retry_command`; `a_failure_with_silent_stderr_still_carries_the_exit_code_and_reads_stdout_as_the_diagnosis`; `a_table_id_without_project_or_with_a_space_does_not_parse` (`'p:d.t'` sí; `'d.t'`, `'p:d'`, `'p:d.t x'` → `null`).

**Verification:** los tests del módulo y la conformidad pasan; el módulo y su test están en `RUTAS`.

```bash
(cd plugin && npx vitest run __tests__/bigquery-load.test.js __tests__/modulos-conformes.test.js)
test "$(grep -c "'scripts/bigquery-load.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
test "$(grep -c "'__tests__/bigquery-load.test.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
```

### Task 4 — `--bq` se acepta y se valida, y nace el `bq` falso

**Objective:** `ct-harvest.mjs` acepta `--bq`, rechaza con exit 2 un valor ausente o mal formado antes de tocar GitHub, y sin el flag no cambia ni una llamada; el `bq` falso queda listo para la Task 5.

**Files:** `plugin/scripts/ct-harvest.mjs` (modify), `plugin/__tests__/fixtures/fake-bq-bin/bq` (create), `plugin/__tests__/ct-harvest-bq.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify: alta del test y del falso)

Current state (plugin/scripts/ct-harvest.mjs, lines 66-66):

```js
const usage = 'uso: ct-harvest.mjs --repo <owner/repo> --milestone <título> [--json]'
```

Current state (plugin/scripts/ct-harvest.mjs, lines 79-80):

```js
if (typeof milestone !== 'string' || milestone.length === 0) { console.error(usage); process.exit(2) }

const comoJson = process.argv.includes('--json')
```

Call site (plugin/scripts/ct-harvest.mjs):

```js
const bqArg = arg('--bq', null)
if (bqArg === true) { console.error(`--bq inválido: "(sin valor)" — ${usage}`); process.exit(2) }
const bqTable = bqArg === null ? null : BigQueryTable.parse(bqArg)
if (bqArg !== null && !bqTable) {
  console.error(`--bq inválido: "${bqArg}" — debe tener la forma proyecto:dataset.tabla (p.ej. mi-proyecto:control_tower.harvest).`)
  process.exit(2)
}
```

El `usage` pasa a terminar en `[--json] [--bq <proyecto:dataset.tabla>]`. El bloque del call site va
entre las dos líneas citadas, con `import { BigQueryTable } from './bigquery-load.js'` arriba, en el
estilo del anfitrión.

El `bq` falso es un script node ejecutable (`chmod +x`), sin prosa, con una clase `FakeBq` y un
`main(argv)`; lo gobiernan: `FAKE_BQ_ARGV_LOG_FILE` (añade `argv.join(' ') + '\n'`),
`FAKE_BQ_CAPTURE_DIR` (copia allí, con su nombre base, el fichero de `--schema=` y el último
argumento), `FAKE_BQ_EXIT_CODE` (por defecto `0`; si no es `0`, escribe `FAKE_BQ_STDERR` o
`fake-bq: load failed` en stderr y sale con ese código).

**TDD:** `it('a_malformed_table_id_exits_2_before_reading_github')` — `--bq nope`: `status` 2, stderr `/--bq inválido/`, y el `FAKE_GH_ARGV_LOG_FILE` no existe. Bancada calcada de `ct-harvest.test.js` con `fake-gh-bin` y `fake-bq-bin` en el PATH, en una clase `Bench`.

**Tests:** añadidos — el de arriba; `a_dangling_bq_flag_exits_2_naming_the_missing_value`; `without_the_flag_bq_is_never_invoked_and_the_harvest_exits_0` (no existe `FAKE_BQ_ARGV_LOG_FILE`).

**Verification:** los tests nuevos y los de siempre pasan; el falso es ejecutable; el rechazo llega antes de `gh`.

```bash
(cd plugin && npx vitest run __tests__/ct-harvest-bq.test.js __tests__/ct-harvest.test.js __tests__/modulos-conformes.test.js)
test -x plugin/__tests__/fixtures/fake-bq-bin/bq
node plugin/scripts/ct-harvest.mjs --repo o/r --milestone E --bq nope >/dev/null 2>&1; test $? -eq 2
```

### Task 5 — la carga: solo cosecha completa, proyección exhaustiva del desenlace

**Objective:** con `--bq` válido, una cosecha completa se carga con `bq load` y lo dice por stderr; una incompleta o vacía no invoca `bq`; un `bq` que falla deja motivo, directorio y comando de reintento.

**Files:** `plugin/scripts/ct-harvest.mjs` (modify), `plugin/__tests__/ct-harvest-bq.test.js` (modify)

Current state (plugin/scripts/ct-harvest.mjs, lines 231-233):

```js
for (const f of filas) f.telemetry = telemetriaDe(f.issue)

if (comoJson) {
```

Call site (plugin/scripts/ct-harvest.mjs):

```js
if (bqTable && motivos.length) console.error(`BigQuery: no se carga — la cosecha está incompleta (${motivos.length} lectura(s) sin completar)`)
else if (bqTable && !filas.length) console.error('BigQuery: nada que cargar — el milestone no tiene slices')
else if (bqTable) {
  const directory = mkdtempSync(join(tmpdir(), 'ct-harvest-bq-'))
  const identity = new HarvestIdentity({ harvestId: randomUUID(), harvestedAt: new Date().toISOString(), repo, milestone, pluginVersion: PLUGIN_VERSION, actor: userInfo().username })
  const report = new BigQueryLoad({ bq: bqRunner, directory }).load({ table: bqTable, rows: filas.map((row) => HarvestTable.rowFor({ row, identity })), schemaJson: HarvestTable.schemaJson() })
  PROYECCION_BQ[report.outcome](report)
}
```

Va entre las dos líneas citadas. `bqRunner` es el runner local del anfitrión, calcado de `localRunner`
en `plugin/scripts/dispatch-check.mjs`: `execFileSync('bq', argv, { encoding: 'utf8', stdio: ['ignore',
'pipe', 'pipe'], timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' })`, y ante excepción `{ code: e.status ?? 1,
stdout, stderr }`. `PLUGIN_VERSION` se lee del `package.json` junto al script (`../package.json`
desde `import.meta.url`), `null` si falla. `PROYECCION_BQ` es un objeto con exactamente dos claves:
`LOADED` → `rmSync(directory, { recursive: true, force: true })` y stderr `BigQuery: ${rowCount} filas
cargadas en ${table.id} (harvest_id ${identity.harvestId})`; `REJECTED` → `motivos.push(\`no se pudo
cargar en BigQuery (${table.id}): bq salió con ${code}: ${detail}. Los ficheros quedan en ${directory};
reintenta a mano: ${retryCommand}\`)`. Un desenlace sin clave lanza. Los imports nuevos (`node:crypto`, `node:os`, `node:fs`, `node:path`,
`node:url` y los dos módulos nuevos) van arriba, en el estilo del anfitrión.

**TDD:** `it('a_complete_harvest_loads_one_row_per_slice_and_says_so_on_stderr_with_exit_0')` — el `rows.ndjson` capturado tiene dos líneas, `issue` 12 y 13, `telemetry_status` `ok` y `sin-fichero`; el argv grabado encaja con `/^--project_id=p --headless load --source_format=NEWLINE_DELIMITED_JSON --schema_update_option=ALLOW_FIELD_ADDITION --schema=\S+\/schema\.json p:d\.t \S+\/rows\.ndjson$/`; stderr `/BigQuery: 2 filas cargadas en p:d\.t/`.

**Tests:** añadidos — el de arriba; `with_json_the_stdout_stays_a_single_json_document_when_loading`; `an_incomplete_harvest_never_calls_bq_and_exits_1` (`FAKE_GH_TIMELINE_FAIL=1`); `a_bq_failure_is_a_motive_naming_the_exit_code_the_kept_directory_and_the_retry_command_with_exit_1` (`FAKE_BQ_EXIT_CODE=2`; el directorio nombrado en stderr existe); `an_empty_milestone_does_not_call_bq_and_exits_0` (`FAKE_GH_LIST_SEQUENCE=[[]]`).

**Verification:** los tests del entrypoint pasan y la suite entera sigue verde.

```bash
(cd plugin && npx vitest run __tests__/ct-harvest-bq.test.js __tests__/ct-harvest.test.js)
(cd plugin && npm test)
```

### Task 6 — la doc del comando y la versión 0.53.0

**Objective:** quien lee `/ct-harvest` sabe qué hace `--bq`, qué no carga y por qué, y el plugin instalado anuncia la versión que lo trae.

**Files:** `plugin/commands/ct-harvest.md` (modify), `plugin/package.json` (modify), `plugin/.claude-plugin/plugin.json` (modify), `plugin/README.md` (modify)

Current state (plugin/commands/ct-harvest.md, lines 2-2):

```
description: Cosecha del epic — el coste real de cada slice, sacado del timeline de GitHub. Cero campos manuales. Sólo lee.
```

Final text (plugin/commands/ct-harvest.md):

```
description: Cosecha del epic — el coste real de cada slice, sacado del timeline de GitHub. Cero campos manuales. Sólo lee de GitHub; con --bq carga la cosecha en BigQuery.
```

Current state (plugin/commands/ct-harvest.md, lines 5-5):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --repo "<owner/repo>" --milestone "<título del epic>" [--json]
```

Final text (plugin/commands/ct-harvest.md):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --repo "<owner/repo>" --milestone "<título del epic>" [--json] [--bq <proyecto:dataset.tabla>]
```

Sección nueva, justo antes de `## Los códigos de salida`:

Final text (plugin/commands/ct-harvest.md):

```
## A BigQuery, con la CLI de `bq`

`--bq <proyecto:dataset.tabla>` carga la cosecha en esa tabla al terminar, con el `bq` que ya tienes autenticado (como `gh`): `bq load` de un NDJSON, una fila por slice y cosecha, con `harvest_id` y `harvested_at`. Cada corrida se **añade** como una foto; nada se sobrescribe. El esquema viaja en el plugin, la tabla se crea en la primera carga si no existe y una columna nueva de una versión posterior se añade sola (`ALLOW_FIELD_ADDITION`). El dataset y sus permisos son de quien posee el proyecto, no del comando.

**Solo se carga una cosecha completa.** Con lecturas sin completar no se invoca `bq`: la cosecha se rehace desde GitHub, así que no se pierde nada. Todo `—` del informe llega como `NULL`, nunca como `0`. Si `bq` falla, el motivo trae el código, el diagnóstico, el directorio con los ficheros y el comando exacto para reintentar a mano. Todo lo de BigQuery va por stderr: stdout sigue siendo la tabla o el JSON. Sin el flag, nada cambia.
```

En la tabla de códigos de salida, la fila de `1` pasa a decir «falló una lectura de `gh` o la carga
en BigQuery». Configuración en prosa: `plugin/package.json` y `plugin/.claude-plugin/plugin.json`
declaran `"version": "0.53.0"`; en `plugin/README.md` la fila `| Versión |` nombra `` `0.53.0` ``.

No code — documentación y versión: los bloques de arriba son texto literal y la configuración va en prosa.

**TDD:** No TDD — documentación y versión; `manifest.test.js` ya ata que las dos versiones coincidan y que el README las anuncie.

**Tests:** N/A — ninguno añadido ni quitado.

**Verification:** las versiones coinciden y el README y la doc del comando dicen lo nuevo.

```bash
(cd plugin && npm test)
test "$(grep -c '"version": "0.53.0"' plugin/package.json)" -eq 1
test "$(grep -c '"version": "0.53.0"' plugin/.claude-plugin/plugin.json)" -eq 1
grep -q '`0.53.0`' plugin/README.md
grep -q -- '--bq <proyecto:dataset.tabla>' plugin/commands/ct-harvest.md
grep -q 'Solo se carga una cosecha completa' plugin/commands/ct-harvest.md
```

## 8. Global verification

Con las seis tareas commiteadas: la suite entera en verde, el `bq` real en la máquina, el rechazo
del flag mal formado antes de tocar GitHub, y el árbol limpio. Lo que un programa no puede medir
y hay que mirar con ojos: una cosecha real de un epic real con `--bq` contra un dataset donde el
desarrollador tenga permiso de escritura, seguida de un `bq query` que cuente filas por
`harvest_id` y muestre `NULL` donde el informe imprimía `—`.

```bash
(cd plugin && npm test)
command -v bq
node plugin/scripts/ct-harvest.mjs --repo o/r --milestone E --bq nope >/dev/null 2>&1; test $? -eq 2
test -z "$(git status --porcelain)"
```

## 9. Assumptions

1. **`bq load` y no `bq insert` ni DML** — decisión propia: los load jobs son gratis, crean la tabla con el esquema dado y admiten `ALLOW_FIELD_ADDITION`; el streaming cuesta dinero y exige tabla previa; el `INSERT` factura bytes.
2. **El dataset existe y el desarrollador tiene `bigquery.dataEditor` en él y `bigquery.jobUser` en el proyecto** — fuera del plugin, decisión única de quien posee el proyecto. El comando no crea datasets ni pide permisos; si faltan, `bq` falla y el motivo lo dice.
3. **`--project_id=<proyecto>` como flag global** — comprobado el 2026-09-03 en esta máquina: `~/.bigqueryrc` está vacío, así que `bq` no tiene proyecto por defecto para el job; se deriva del propio id de la tabla.
4. **`--headless`** — comprobado: `bq --headless version` sale 0 con BigQuery CLI 2.1.31; evita cualquier prompt interactivo en un subproceso sin stdin.
5. **Sin flags de particionado ni clustering** — una carga con particionado distinto al de una tabla existente falla; el diseño físico de la tabla es del dueño del dataset.
6. **`actor` es `os.userInfo().username`** — `ct-harvest.mjs` no depende de `git` y «no hay checkout que suponer» (cabecera del propio fichero); leer `git config user.email` metería una dependencia nueva por un campo de auditoría.
7. **`rowFor` devuelve un objeto plano** — es la frontera de serialización, «el último paso antes del cable» (`defects.md`): el adaptador lo `JSON.stringify` sin leer una sola clave.
8. **Grafía de `telemetry_status` y `merge_source`** — la del contrato `--json` (`style.md`: un valor fijado por un contrato externo conserva su grafía).
9. **Clave ausente lanza, `null` viaja** — `architecture.md`, validación por proyección: una clave que el esquema dice conocer y llega `undefined` es un contrato que cambió, no una medida ausente.
10. **Cosecha vacía es exit 0 con aviso** — decisión propia: no tener nada que cargar no es un fallo, y el aviso impide leer el silencio como carga hecha.
11. **El plan no lleva número de issue en el nombre** — convención de los planes propios del repo (p. ej. `docs/superpowers/plans/2026-08-28-reconciliacion-de-ramas.md`); se valida con `validatePlan` de `plugin/scripts/plan-contract.js` con rutas relativas a la raíz. Si el trabajo se despacha por el loop, el fichero se renombra con `issue-<n>-`.
12. **Versión 0.53.0** — un flag nuevo es una feature; misma escala que `0.52.0` para `--collect`.
13. **`bq --quiet` no se usa** — no está confirmado en la ayuda de esta versión y stderr ya se captura entero; el diagnóstico completo viaja en el motivo.
