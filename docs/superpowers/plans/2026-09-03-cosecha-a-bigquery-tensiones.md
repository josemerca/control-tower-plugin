# Las tres tensiones que dejó la cosecha a BigQuery — un lector, un marcador y una doc que no miente

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, this document's §2 and the five documents of
> `plugin/conventions/` win.

## 1. Context and goal

Dos planes ya ejecutados en esta rama —`docs/superpowers/plans/2026-09-03-cosecha-a-bigquery.md`
(el flag manual `/ct-harvest --bq`) y `docs/superpowers/plans/2026-09-03-cosecha-a-bigquery-automatica.md`
(la carga en `dispatch-check --collect` y el arranque del backend)— dejaron la cosecha viajando a
BigQuery y, declaradas por los jueces, tres tensiones sin cerrar. Las tres son de la misma clase:
una decisión escrita dos veces, una regla de la vara que este repo no había aterrizado, y una
frase de documentación que afirma más de lo que el código hace.

1. **La versión del manifiesto se lee dos veces.** `plugin/scripts/ct-step.mjs` la saca con una
   IIFE sobre `PLUGIN_ROOT`; `LedgerIdentity`, en `plugin/scripts/harvest-ledger.js`, con su
   propio `MANIFEST` y su privado. Y las dos lecturas ya no dicen lo mismo: ante `version: ""`
   una devuelve `null` y la otra la cadena vacía.
2. **El repo no tenía marcador de «test con subproceso real».** `plugin/conventions/testing.md` lo
   exige y deja la forma a cada repo; el backend ya eligió la suya y el plugin no, así que los
   tests spawn que los dos planes anteriores añadieron nacieron sin marcar.
3. **La doc de `/ct-harvest` dice «Todo `—` del informe llega como `NULL`»** y el informe tiene
   celdas combinadas —`vara ct`, `brief`, `Veredictos`— que en la tabla son varias columnas, cada
   una con su propio `NULL`.

El plan 2 declara en su §1 Out of scope y en su assumption 10 que el lector de `ct-step.mjs` queda
fuera de su alcance; la coordinadora enmendará esas dos frases para que apunten a este plan. Este
plan **no toca el plan 2**.

### Desired end state

- Un solo módulo lee el manifiesto del plugin: `plugin/scripts/plugin-manifest.js`, nacido
  conforme y dado de alta en `NacidosConformes.RUTAS`. `ct-step.mjs` y `LedgerIdentity` lo llaman;
  ninguno vuelve a abrir `package.json`. La regla es UNA: `version` no vacía, si no `null`.
- El plugin adopta el marcador del backend, el sufijo `-real-process.test.js`. Los siete tests de
  `RUTAS` que lanzan un proceso real lo llevan, y `plugin/__tests__/modulos-conformes.test.js` lo
  mide en las dos direcciones: quien espawnea lo lleva, y quien lo lleva espawnea.
- `npm run test:fast` existe en `plugin/package.json` y el README lo documenta diciendo la verdad:
  hoy sólo los tests nacidos conformes están marcados, los otros 67 son deuda declarada y por eso
  el subset rápido todavía no es rápido.
- `plugin/commands/ct-harvest.md` sustituye la frase de la celda por la regla de la COLUMNA y trae
  el mapa celda del informe → columnas de la tabla, incluida la celda combinada `vara ct`, que
  puede llegar como un número y un `NULL` en la misma fila.
- `npm test` sigue verde sin tocar el test `the_identity_from_the_environment_reads_the_plugin_version_from_its_own_manifest`.

### Out of scope

- Renombrar los 67 ficheros de `plugin/__tests__/` que espawnean y no están en `RUTAS`: es una
  barrida de repo que decide Juanjo, y meterla aquí haría ilegible el diff de estas tres tensiones.
- Traducir al inglés los nombres castellanos de los ficheros renombrados: el renombre cambia el
  marcador, no la deuda de idioma de los nombres.
- Cambiar la versión del plugin: sigue `0.55.0`, porque esto es una corrección dentro de la misma
  pull request que publicó las dos cosechas.
- Tocar `plugin/conventions/testing.md`: es la vara que viaja a otros repos y ya dice lo que hay
  que hacer; la FORMA del marcador es una elección de este repo.
- Tocar `plugin/vitest.config.js`, el backend, o unificar `actor` (`ct-step.mjs` usa `git config
  user.email` y la cosecha `os.userInfo().username`: decisión cerrada en el plan 1, assumption 6).
- Cambiar qué mide la cosecha, el informe de stdout o el esquema de la tabla.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| Un solo lector del manifiesto | módulo nuevo `plugin/scripts/plugin-manifest.js`, que usan `ct-step.mjs` y `LedgerIdentity`; ninguno de los dos vuelve a leer `package.json` |
| Dirección de la dependencia | el módulo nuevo, y no `harvest-ledger.js`: que el paso importara de la cosecha sería al revés |
| La regla de la versión | `version` si es una cadena no vacía, `null` en cualquier otro caso — se acaba la divergencia entre el OR de `ct-step.mjs` y el nullish de `LedgerIdentity` |
| Cómo se prueba el manifiesto ilegible | la ruta entra por el constructor y `PluginManifest.installed()` da el instalado: ningún test toca el `package.json` real |
| Lo que pierde `LedgerIdentity` | `MANIFEST`, `#pluginVersionFromManifest` y el import de `node:fs`; `fromEnvironment()` pide la versión al módulo nuevo |
| Marcador de proceso real | el MISMO que el backend: sufijo de fichero `-real-process.test.js` (una decisión, un sitio, mismo repo) |
| Quién lo mide | `plugin/__tests__/modulos-conformes.test.js`, sobre `RUTAS`, en las dos direcciones: quien importa `node:child_process` lleva el sufijo, y quien lleva el sufijo importa `node:child_process` |
| Alcance del renombre | los siete tests de `RUTAS` que espawnean; los otros 67 quedan como deuda declarada |
| El `-real-git` ad hoc | se suelta: el sufijo ya dice que lanza un proceso, y dos grafías de la misma decisión en el mismo nombre es lo que `plugin/conventions/decisions.md` prohíbe |
| Subset rápido | `plugin/package.json` gana `"test:fast": "vitest run --exclude '**/*-real-process.test.js'"`; `npm test` no cambia |
| Lo que el README declara | que el subset rápido todavía no es rápido, con el número de ficheros sin marcar |
| La doc de `/ct-harvest` | la regla pasa de la celda a la COLUMNA, con el mapa celda → columnas; la sección «La telemetría del juez, por slice» no se repite, se remite a ella |
| Versión | sigue `0.55.0`: corrección dentro de la misma pull request |

## 3. Reference patterns

Files to imitate: `plugin/scripts/bigquery-load.js` (módulo nacido conforme: campos privados,
estáticos de constructor, `Object.freeze`, cero prosa), `plugin/scripts/plugin-yardstick.js` (un
tipo que localiza ficheros del propio plugin), `plugin/__tests__/plugin-yardstick.test.js` y
`plugin/__tests__/bigquery-load.test.js` (madres con escenarios nombrados, aserción sobre el
payload literal), `plugin/__tests__/modulos-conformes.test.js` (la lista `RUTAS`, los estáticos que
devuelven la lista de infractores y el `toEqual([])` como aserción),
`plugin/__tests__/harvest-ledger.test.js` (el test de la identidad que NO se toca),
`backend/conventions/testing.md` §«Where the suite runs» y
`backend/__tests__/infrastructure/ct-api-real-process.test.js` (el marcador tal y como el backend
ya lo usa), `plugin/commands/ct-harvest.md` §«La telemetría del juez, por slice» (el registro de la
doc del comando: castellano, prosa, negrita para la regla).

Rules to obey: este repo no declara .agent/conventions.md, AGENTS.md ni CLAUDE.md — N/A. La vara es
la del propio plugin y ata en todo diff: `plugin/conventions/style.md` (inglés, sin prosa, toda
función cuelga de un tipo), `plugin/conventions/architecture.md` (un concepto nuevo es un módulo
nuevo y nace conforme; la dirección de las dependencias),
`plugin/conventions/decisions.md` (una decisión se escribe una vez, aunque las dos redacciones
difieran), `plugin/conventions/testing.md` (el nombre del test es la frase; un test que lanza un
subproceso real va marcado; la aserción vista en rojo por su motivo) y
`plugin/conventions/defects.md`. `plugin/scripts/ct-step.mjs` y
`plugin/__tests__/modulos-conformes.test.js` son deuda declarada (castellano, prosa en el primero):
lo que se les añade sigue el estilo del anfitrión, salvo los nombres de test, que van en inglés
ASCII porque ese mismo fichero lo mide.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/plugin-manifest.js` | create | `ct-step.mjs`, `harvest-ledger.js` | Contract |
| `plugin/__tests__/plugin-manifest.test.js` | create | vitest | none (body by TDD) |
| `plugin/scripts/harvest-ledger.js` | modify | `ct-harvest.mjs`, `dispatch-check.mjs` | Current state / Call site |
| `plugin/scripts/ct-step.mjs` | modify | el desarrollador | Current state / Call site / prose |
| `plugin/__tests__/modulos-conformes.test.js` | modify | vitest | Current state / prose |
| los siete tests de `RUTAS` que espawnean | modify + create | vitest | prose (`git mv`) |
| `plugin/package.json` | modify | quien corre la suite | prose (config) |
| `plugin/README.md` | modify | quien desarrolla | Current state / Final text |
| `plugin/commands/ct-harvest.md` | modify | quien lee el comando | Current state / Final text |

## 5. Interfaces

Consumes: nada nuevo. `HarvestIdentity`, `HarvestTable`, `BigQueryLoad` y `LoadOutcome` siguen con
la firma que tienen; `LedgerIdentity.fromEnvironment()` sigue devolviendo lo mismo y con el mismo
`pluginVersion`, sólo que lo pide en otro sitio.

Produces:
- `PluginManifest` en `plugin/scripts/plugin-manifest.js`: `PluginManifest.PATH` (la `URL` del
  manifiesto instalado), `PluginManifest.installed(): PluginManifest`,
  `new PluginManifest(path)`, `get version(): string | null`.
- En `plugin/__tests__/modulos-conformes.test.js`, para su propio uso: `NacidosConformes.MARCADOR`,
  `NacidosConformes.lanzaProcesosReales(ruta)`, `NacidosConformes.sinMarcador()`,
  `NacidosConformes.marcadorDeAdorno()`.
- El script `test:fast` de `plugin/package.json`.
- Retirados: `LedgerIdentity.MANIFEST` y `LedgerIdentity.#pluginVersionFromManifest()`.

## 6. Test strategy

`PluginManifest` se prueba en proceso, contra manifiestos escritos por el test en un `mkdtemp` de
`node:fs`: así el caso «manifiesto ilegible» y el caso «`version` vacía» se cubren sin tocar el
`package.json` real, y el caso «el instalado» se compara contra el `version` que el propio test
lee del manifiesto del plugin. El marcador de proceso real se mide mecánicamente en
`plugin/__tests__/modulos-conformes.test.js`, como las otras reglas de ese fichero: dos estáticos
que devuelven la lista de infractores y dos aserciones `toEqual([])`, que fallan nombrando los
ficheros. Las tareas 3 y 4 no añaden comportamiento: la red es la suite entera, que corre al final
de cada tarea. El test `the_identity_from_the_environment_reads_the_plugin_version_from_its_own_manifest`
de `plugin/__tests__/harvest-ledger.test.js` no se toca y tiene que seguir verde: es la prueba de
que el refactor de la tarea 1 preserva el comportamiento. Cada aserción nueva se rompe a mano una
vez y se ve caer por el motivo de su nombre. Ningún control clava el total de la suite.

## 7. Tasks

### Task 1 — `PluginManifest`: un solo lector de la versión del plugin

**Objective:** la versión del manifiesto del plugin se lee en un único módulo, con una única regla, y los dos entrypoints que la necesitaban se la piden a él.

**Files:** `plugin/scripts/plugin-manifest.js` (create), `plugin/__tests__/plugin-manifest.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify), `plugin/scripts/harvest-ledger.js` (modify), `plugin/scripts/ct-step.mjs` (modify)

Contract (plugin/scripts/plugin-manifest.js):

```js
export class PluginManifest {
  static PATH = new URL('../package.json', import.meta.url)
  static installed()
  constructor(path)
  get version()
}
```

El módulo y su test se dan de alta en `NacidosConformes.RUTAS`. `installed()` es
`new PluginManifest(PluginManifest.PATH)`.
`version` devuelve la clave `version` del JSON si es cadena no vacía, y `null` en todo lo demás:
ausente, vacía, no cadena, JSON roto o fichero ilegible. Sólo importa `node:fs`.

Current state (plugin/scripts/ct-step.mjs, lines 409-415):

```js
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8')).version || null
  } catch {
    return null
  }
})()
```

Call site (plugin/scripts/ct-step.mjs):

```js
const PLUGIN_VERSION = PluginManifest.installed().version
```

El `import { PluginManifest } from './plugin-manifest.js'` va arriba, con los demás, en el estilo
del anfitrión. `PLUGIN_ROOT` se queda: lo usan otras cuatro líneas del fichero.

Current state (plugin/scripts/harvest-ledger.js, lines 27-33):

```js
  static #pluginVersionFromManifest() {
    try {
      return JSON.parse(readFileSync(LedgerIdentity.MANIFEST, 'utf8')).version ?? null
    } catch {
      return null
    }
  }
```

Call site (plugin/scripts/harvest-ledger.js):

```js
      pluginVersion: PluginManifest.installed().version,
```

Se van con el privado el `static MANIFEST` y el `import { readFileSync } from 'node:fs'`, ya sin
otro uso.

**TDD:** `it('a_manifest_whose_version_is_the_empty_string_answers_null_and_never_the_empty_string')` — el manifiesto `{"version": ""}` escrito por el test da `null`, y el vecino `{"version": "0.0.1"}` da `'0.0.1'`. Madres: `Manifests.withVersion(value)` y `Manifests.unreadable()`, que escriben en un `mkdtemp` borrado en `afterEach`.

**Tests:** añadidos — 'a_manifest_whose_version_is_the_empty_string_answers_null_and_never_the_empty_string', 'the_installed_manifest_answers_the_version_the_plugin_declares' (contra el `version` que el propio test lee del manifiesto), 'a_manifest_that_cannot_be_read_answers_null_instead_of_raising', 'a_manifest_without_a_version_key_answers_null'. Ninguno se retira a propósito, y `the_identity_from_the_environment_reads_the_plugin_version_from_its_own_manifest` sigue como está y sigue verde.

**Verification:** el módulo nuevo y su test pasan, la identidad sigue midiendo lo mismo, y no queda un segundo lector.

```bash
(cd plugin && npx vitest run __tests__/plugin-manifest.test.js __tests__/harvest-ledger.test.js __tests__/modulos-conformes.test.js)
test "$(grep -c "'scripts/plugin-manifest.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
test "$(grep -c "'__tests__/plugin-manifest.test.js'" plugin/__tests__/modulos-conformes.test.js)" -eq 1
test "$(grep -c 'MANIFEST' plugin/scripts/harvest-ledger.js)" -eq 0
test "$(grep -c "join(PLUGIN_ROOT, 'package.json')" plugin/scripts/ct-step.mjs)" -eq 0
(cd plugin && npm test)
```

### Task 2 — el marcador `-real-process.test.js` y su regla

**Objective:** los siete tests nacidos conformes que lanzan un proceso real lo dicen en su nombre, y el guardián de la conformidad impide espawnear sin marcador o llevarlo de adorno.

**Files:** `plugin/__tests__/branch-reconciliation-real-git.test.js` (modify), `plugin/__tests__/branch-reconciliation-real-process.test.js` (create), `plugin/__tests__/branch-reconciliation-real-git-produccion.test.js` (modify), `plugin/__tests__/branch-reconciliation-produccion-real-process.test.js` (create), `plugin/__tests__/branch-reconciliation-base-ilegible.test.js` (modify), `plugin/__tests__/branch-reconciliation-base-ilegible-real-process.test.js` (create), `plugin/__tests__/seccion-del-plan.test.js` (modify), `plugin/__tests__/seccion-del-plan-real-process.test.js` (create), `plugin/__tests__/dispatch-guard.test.js` (modify), `plugin/__tests__/dispatch-guard-real-process.test.js` (create), `plugin/__tests__/ct-harvest-bq.test.js` (modify), `plugin/__tests__/ct-harvest-bq-real-process.test.js` (create), `plugin/__tests__/dispatch-check-collect-bq.test.js` (modify), `plugin/__tests__/dispatch-check-collect-bq-real-process.test.js` (create), `plugin/__tests__/modulos-conformes.test.js` (modify), `plugin/scripts/ct-step.mjs` (modify)

Cada par de rutas de arriba es un `git mv` dentro de `plugin/__tests__/`, de la `(modify)` a la
`(create)`, sin tocar el contenido: todos resuelven sus rutas contra su propio directorio, y nada
más los nombra.

Current state (plugin/__tests__/modulos-conformes.test.js, lines 19-21):

```js
    '__tests__/branch-reconciliation-real-git.test.js',
    '__tests__/branch-reconciliation-real-git-produccion.test.js',
    '__tests__/branch-reconciliation-base-ilegible.test.js',
```

Las siete entradas de `RUTAS` pasan a los nombres nuevos, en su sitio. `NacidosConformes` gana
`MARCADOR = '-real-process.test.js'`; `lanzaProcesosReales(ruta)`, que dice si el fichero importa
`node:child_process`; `sinMarcador()`, las rutas de `RUTAS` acabadas en `.test.js` que espawnean sin
`MARCADOR`; y `marcadorDeAdorno()`, la conversa. Las dos devuelven listas, como `prosaEn`, para que
el fallo nombre al infractor. En `ct-step.mjs`, línea 1214,
el comentario que nombra `__tests__/seccion-del-plan.test.js` pasa al nombre nuevo.

**TDD:** `it('a_test_born_conforming_that_launches_a_real_process_carries_the_marker_in_its_file_name')` — `expect(NacidosConformes.sinMarcador()).toEqual([])`, que antes del `git mv` cae nombrando los siete.

**Tests:** añadidos — 'a_test_born_conforming_that_launches_a_real_process_carries_the_marker_in_its_file_name' y 'a_test_born_conforming_that_carries_the_marker_really_launches_a_real_process' (`expect(NacidosConformes.marcadorDeAdorno()).toEqual([])`), en un `describe` nuevo. Ninguno se retira a propósito: los ficheros movidos conservan sus tests intactos.

**Verification:** los siete llevan el marcador, ninguno su nombre viejo, y `RUTAS` está al día.

```bash
(cd plugin && npx vitest run __tests__/modulos-conformes.test.js)
test "$(ls plugin/__tests__/*-real-process.test.js | wc -l)" -eq 7
test -z "$(ls plugin/__tests__/seccion-del-plan.test.js plugin/__tests__/ct-harvest-bq.test.js 2>/dev/null)"
test "$(grep -c "^    '__tests__/.*-real-process\.test\.js'," plugin/__tests__/modulos-conformes.test.js)" -eq 7
test "$(grep -c 'seccion-del-plan-real-process.test.js' plugin/scripts/ct-step.mjs)" -eq 1
(cd plugin && npm test)
```

### Task 3 — `npm run test:fast`, y el README dice cuánto vale hoy

**Objective:** el marcador compra un subset rápido invocable, y quien lo lee sabe que todavía no es rápido y por qué.

**Files:** `plugin/package.json` (modify), `plugin/README.md` (modify)

Configuración en prosa: `plugin/package.json` gana un tercer script,
`"test:fast": "vitest run --exclude '**/*-real-process.test.js'"`, detrás de `"test"`. No
reconstruye `dist/` a propósito —eso es lo que lo hace rápido— y por eso `npm test` no cambia: es
el que sigue cerrando cada tarea.

Current state (plugin/README.md, lines 254-256):

```
npm install
npm test            # construye dist/ y corre la suite (vitest)
npm run build       # sólo el bundle de los hooks
```

Final text (plugin/README.md):

```
npm install
npm test            # construye dist/ y corre la suite (vitest)
npm run test:fast   # la suite sin los tests que lanzan un proceso de verdad
npm run build       # sólo el bundle de los hooks
```

Y un párrafo nuevo justo detrás del bloque, antes del encabezado «La regla del `dist/`»:

Final text (plugin/README.md):

```
`npm run test:fast` corre la suite **sin los tests que lanzan un proceso de verdad**, marcados con el sufijo `-real-process.test.js` — el mismo marcador que usa el backend, porque es la misma decisión y este repo la escribe una vez. Hoy sólo lo llevan los tests nacidos conformes: de los 74 ficheros de `__tests__/` que importan `node:child_process` quedan **67 sin marcar**, así que el subset rápido **todavía no es rápido**. Es deuda declarada y se salda renombrando. Lo que ya está atado es que un test nacido conforme no puede espawnear sin su marcador ni llevarlo de adorno: lo mide `__tests__/modulos-conformes.test.js`.
```

No code — configuración descrita en prosa y documentación cuyo texto literal es el entregable.

**TDD:** No TDD — un script de npm y un párrafo del README no añaden comportamiento que poner en rojo; la regla del marcador ya la mide la tarea 2.

**Tests:** N/A — ninguno añadido ni retirado.

**Verification:** el subset corre, el script está una sola vez y el README dice las dos cosas.

```bash
(cd plugin && npm run test:fast)
test "$(grep -c 'test:fast' plugin/package.json)" -eq 1
grep -q 'npm run test:fast' plugin/README.md
grep -q 'todavía no es rápido' plugin/README.md
grep -q '67 sin marcar' plugin/README.md
(cd plugin && npm test)
```

### Task 4 — la doc de `/ct-harvest`: de la celda del informe a las columnas de la tabla

**Objective:** quien lee `/ct-harvest --bq` sabe que la regla del `NULL` es de la columna y no de la celda, y tiene el mapa de celda a columnas.

**Files:** `plugin/commands/ct-harvest.md` (modify)

Current state (plugin/commands/ct-harvest.md, lines 64-64):

```
**Solo se carga una cosecha completa.** Con lecturas sin completar no se invoca `bq`: la cosecha se rehace desde GitHub, así que no se pierde nada. Todo `—` del informe llega como `NULL`, nunca como `0`. Si `bq` falla, el motivo trae el código, el diagnóstico, el directorio con los ficheros y el comando exacto para reintentar a mano. Todo lo de BigQuery va por stderr: stdout sigue siendo la tabla o el JSON. Sin el flag, nada cambia.
```

Final text (plugin/commands/ct-harvest.md):

```
**Solo se carga una cosecha completa.** Con lecturas sin completar no se invoca `bq`: la cosecha se rehace desde GitHub, así que no se pierde nada. **Ningún `—` del informe llega como `0`: la regla es de la COLUMNA, no de la celda**, y una celda combinada reparte un `NULL` por cada columna que la compone — el mapa está debajo. Si `bq` falla, el motivo trae el código, el diagnóstico, el directorio con los ficheros y el comando exacto para reintentar a mano. Todo lo de BigQuery va por stderr: stdout sigue siendo la tabla o el JSON. Sin el flag, nada cambia.
```

Y dos párrafos detrás, antes del que empieza «Este comando carga un epic entero»:

Final text (plugin/commands/ct-harvest.md):

```
**De la celda a la columna.** Uno a uno: cada `—` de una fase es `NULL` en su `*_seconds`, y un slice sin PR deja `pr`, `additions`, `deletions`, `changed_files`, `reviews` y `review_comments` en `NULL`; el `*` de `release→merge` no es columna, es `merge_source = 'issue-closed'`. Combinadas, en la telemetría: `Veredictos` son `verdicts` y `rubric_sin_vara_legacy`; `sin-vara` es `rubric_sin_vara`; `Hallazgos por regla` es `findings_by_rule` (registro repetido de `{rule, findings}`, que va `[]` y no `NULL` cuando no hay veredictos o no hay fichero); `vara ct` son `rubric_vara_ct_docs`, `findings_vara_ct`, `rubric_vara_ct_docs_legacy` y `findings_vara_ct_legacy`; `brief` son `brief_vara_ct_docs`, `brief_bytes`, `brief_legacy` y `brief_attempts`. Con `telemetry_status` distinto de `ok`, todas las cuentas van `NULL`.

**Media celda puede ser un número y la otra media un `NULL`.** El informe exige las DOS mitades para imprimir `vara ct` o `brief` —el porqué está arriba, en «La telemetría del juez, por slice»—, pero la tabla no las junta: un `—` en `vara ct` puede ser en la fila `rubric_vara_ct_docs` con un número y `findings_vara_ct` en `NULL`, o al revés. Cada columna dice lo que se midió de ella, que es más de lo que decía la celda.
```

No code — documentación: el texto literal de los bloques ES el entregable.

**TDD:** No TDD — documentación; no hay comportamiento que poner en rojo.

**Tests:** N/A — ninguno añadido ni retirado.

**Verification:** la frase vieja no queda y el mapa nombra las columnas combinadas.

```bash
test "$(grep -c -F 'Todo `—` del informe llega como `NULL`' plugin/commands/ct-harvest.md)" -eq 0
grep -q 'De la celda a la columna' plugin/commands/ct-harvest.md
grep -q 'Media celda puede ser un número' plugin/commands/ct-harvest.md
grep -q 'rubric_vara_ct_docs_legacy' plugin/commands/ct-harvest.md
grep -q 'issue-closed' plugin/commands/ct-harvest.md
```

## 8. Global verification

Con las cuatro tareas commiteadas: la suite entera en verde, el subset rápido corriendo por su
nombre, los siete ficheros marcados, la frase vieja de la doc desaparecida y el árbol limpio. Lo
que un programa no mide y hay que mirar con ojos: que `npm run test:fast` de verdad excluye siete
ficheros y no cero (comparar el recuento de ficheros de las dos corridas), y que el mapa de
`plugin/commands/ct-harvest.md` nombra las mismas columnas que `HarvestTable.SCHEMA` declara.

```bash
(cd plugin && npm test)
(cd plugin && npm run test:fast)
test "$(ls plugin/__tests__/*-real-process.test.js | wc -l)" -eq 7
test "$(grep -c -F 'Todo `—` del informe llega como `NULL`' plugin/commands/ct-harvest.md)" -eq 0
test -z "$(git status --porcelain)"
```

## 9. Assumptions

1. **El módulo nuevo se llama `plugin/scripts/plugin-manifest.js`** — decisión propia: es un concepto nuevo («el manifiesto del plugin instalado»), y `plugin/conventions/architecture.md` manda que un concepto nuevo sea un módulo nuevo nacido conforme. Meterlo en `harvest-ledger.js` invertiría la dirección de la dependencia: el paso no sabe de la cosecha.
2. **La regla es «`version` no vacía, si no `null`»** — de las dos que hay hoy, es la del OR de `ct-step.mjs`. Una cadena vacía en `version` no es una versión, y hacerla viajar a una columna de BigQuery sería un dato inventado; `null` es la ausencia declarada que el resto del esquema ya usa.
3. **La ruta entra por el constructor y `installed()` da la instalada** — decisión propia, para que el caso «manifiesto ilegible» tenga test sin tocar el `package.json` real. `plugin/conventions/testing.md`: el arrange no se construye con la pieza bajo prueba, y aquí el arrange es un fichero.
4. **`ct-step.mjs` sigue siendo deuda declarada** — el import y la constante nuevos siguen el estilo del anfitrión (castellano, constantes de módulo); lo que se exige conforme es el módulo nuevo, no el fichero que lo llama.
5. **El plugin adopta el sufijo del backend y no inventa el suyo** — `plugin/conventions/testing.md` deja la forma a cada repo, y este repo ya la eligió en `backend/conventions/testing.md`. Dos marcadores en el mismo repo serían la misma decisión escrita dos veces, que es justo lo que `plugin/conventions/decisions.md` prohíbe.
6. **Los `branch-reconciliation-real-git*` sueltan su `-real-git`** — ese trozo del nombre decía exactamente lo que el sufijo dice ahora, y conservarlo dejaría dos grafías de la misma decisión dentro del mismo nombre de fichero. Se conserva `produccion`, que sí distingue dos casos distintos.
7. **Los nombres castellanos de los ficheros movidos no se traducen** — el renombre cambia el marcador; traducir los nombres sería una decisión de otra escala y ensuciaría el diff de esta corrección.
8. **Los otros 67 no se renombran aquí** — es una barrida de repo que decide Juanjo. La regla mecánica se acota a `RUTAS` porque es la lista que este repo ya usa para «nacido conforme»; extenderla a los 132 ficheros pondría la suite en rojo hasta que la barrida esté hecha.
9. **La regla se mide con dos listas de infractores y no con un bucle por ruta** — es el idiom que ya tiene `plugin/__tests__/modulos-conformes.test.js` (`prosaEn` y compañía devuelven la lista y el test afirma `toEqual([])`), y una lista nombra a los siete infractores de una vez en vez de repartirlos en siete fallos.
10. **`test:fast` no reconstruye `dist/`** — es lo que lo hace rápido, y el precio está declarado: `npm test` sigue siendo el que construye y el que cierra cada tarea, tal y como manda «la regla del `dist/`» del README.
11. **El README dice el número exacto de ficheros sin marcar** — medido el 2026-09-03: 74 de los 132 ficheros de `plugin/__tests__/*.test.js` importan `node:child_process`, siete de ellos en `RUTAS`. Un texto que dijera sólo «queda deuda» no le diría a nadie cuánto vale hoy el subset.
12. **La doc remite a «La telemetría del juez, por slice» y no la repite** — esa sección ya explica por qué se exigen las dos mitades; repetir el porqué dejaría dos textos que pueden divergir, y lo nuevo es sólo el mapa a las columnas.
13. **La versión sigue en `0.55.0`** — las tres tensiones son correcciones de lo que esta misma rama introdujo y viajan en la misma pull request; subir la versión anunciaría una entrega que no existe.
14. **El plan no lleva número de issue en el nombre** — misma convención que los dos planes anteriores de esta rama; se valida con `validatePlan` de `plugin/scripts/plan-contract.js` con rutas relativas a la raíz del repo.
