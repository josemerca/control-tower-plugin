#!/usr/bin/env node
// CANAL DE SALIDA (F16/H2) — el criterio es común a los TRES ejecutables del
// plugin (ct-next.mjs, ct-groom.mjs, dispatch-check.mjs) y está escrito entero
// en ct-next.mjs, junto a su `warn()`:
//
//   STDOUT = el PRODUCTO. Aquí: el JSON del plan en --dry-run, y el acta de lo
//            que se creó/reconcilió de verdad (milestone, issues, project).
//   STDERR = el DIAGNÓSTICO. `aviso:`, `recordatorio:`, el informe de drift,
//            y todos los abortos.
//
// Este fichero YA cumplía el criterio (es el que sirvió de referencia cuando
// se descubrió que ct-next.mjs mandaba sus avisos por stdout). Queda dicho
// aquí para que el siguiente que añada una línea de salida sepa a qué canal
// va sin tener que inferirlo del vecindario.
import { readFileSync, realpathSync } from 'node:fs'
import { resolve as resolvePath, relative as relativePath } from 'node:path'
import { execFileSync } from 'node:child_process'
import { analyzeSlicesTable, isNoValueCell } from './slices.js'
import { groomPlan, readEpicContext, EPIC_CONTEXT_HEADING, analyzeSpecFreeze, HYPOTHESIS_REASONS } from './groom.js'
// F10: de "la ruta que me pasaron en argv + --section" a una URL absoluta
// verificada contra GitHub (o a una referencia honesta sin enlace, diciendo
// por qué). Ver scripts/spec-link.js para las tres decisiones que toma y por
// qué las toma así.
import { resolveSpecRef } from './spec-link.js'
import { flattenIssuePages, flattenPages, realIssuesOnly, findByMarker, partitionByEpic, epicTitleOf } from './gh-issues.js'
import { pickCurrentIteration, hasProjectItem } from './project-fields.js'
import { parseStrictInt } from './argnum.js'
// extractOrder (F5, importante 4): para detectar issues huérfanos — un issue
// con marcador ct-order:N cuyo slice N ya no está en la tabla §9 actual.
// resolveStatus (F6, grave 2): el MISMO criterio con el que el dispatcher
// decide en qué estado está un issue (incluida la precedencia cuando hay más
// de una label `status:`, y el "sin ninguna label status: = backlog") — es lo
// que hace verdadero, y no una suposición, el recordatorio de "esto todavía
// no lo va a despachar nadie" que este script imprime al final.
import { extractOrder, resolveStatus, extractSpecLink, specTarget } from './gh-issue-map.js'
// F5: capa pura de reconciliación — decide QUÉ cuenta como divergencia entre
// un issue existente y lo que el plan produce hoy, CÓMO se reporta, y CÓMO
// se traduce a los flags de `gh issue edit`/`--body` para aplicarla. Ver
// scripts/reconcile.js para la justificación completa de cada decisión (qué
// se compara, qué se excluye a propósito, y por qué).
import { diffIssue, hasDrift, formatDrift, buildReconcileEditArgs, buildReconcileBody, reconcileGaps, hasReconcileGap } from './reconcile.js'
// ADDENDA (F3): única fuente de verdad de qué valores de "Tipo" tienen un
// addendum de kickoff — ver el aviso de "Tipo" no reconocido más abajo.
import { ADDENDA } from './kickoff.js'
// F21: los gates humanos, separados del `Tipo` técnico. `resolveGates` es la
// única fuente de verdad de qué gates tiene un slice y de todo lo que hay que
// decir en voz alta sobre ellos (un gate que el Tipo no implica, una renuncia,
// una renuncia inerte, un token que no existe).
import { GATES, TYPE_GATES, resolveGates, resolveE2e, parseGateCell } from './gates.js'

// `arg()` solo devuelve un string cuando el flag realmente trae un valor: si
// el flag es el último token de argv, o el token siguiente es a su vez otro
// flag (empieza por `--`), devolvemos `true` (presente-sin-valor) en vez de
// colarlo como valor. Mismo patrón que dispatch-check.mjs/ct-next.mjs — fix de
// la review final (finding 3): la versión anterior de este `arg()` tomaba
// literalmente `process.argv[i + 1]`, sin comprobar que fuera un valor real.
// Verificado en vivo contra el sandbox: `--milestone` como último token de
// argv hacía que `milestone` fuera el booleano `true`, y una corrida real
// entonces CREABA un milestone en GitHub literalmente titulado "true" y le
// enganchaba todos los issues del epic; `--milestone --dry-run` se comía el
// `--dry-run` como si fuera el valor del milestone; `--project` sin valor se
// convertía en `1` en el JSON del dry-run (`Number(true) === 1`). Los
// call-sites de milestone/project de más abajo, además de este endurecimiento
// del propio `arg()`, validan explícitamente que el valor recibido no sea
// `true` (presente-sin-valor) antes de usarlo.
const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}
const has = (flag) => process.argv.includes(flag)

const specFile = process.argv[2]
if (!specFile || specFile.startsWith('--')) { console.error('uso: ct-groom.mjs <spec> --repo <o/r> [--milestone t] [--project n] [--dry-run]'); process.exit(2) }
const repo = arg('--repo')
const milestone = arg('--milestone', 'Epic')
const project = arg('--project')
const dryRun = has('--dry-run')
// F5: opt-in, NUNCA por defecto — un issue existente puede haber sido
// editado a propósito, llevar discusión, o estar cerrado; el comportamiento
// por defecto es detectar y reportar divergencia, nunca tocar nada sin que
// se pida explícitamente (ver el bloque de reconciliación más abajo).
const reconcileFlag = has('--reconcile')
// Decisión de producto (review round 5): --reconcile se marca EXPERIMENTAL.
// Cinco rondas de review, cada una encontrando una forma NUEVA de corromper
// un body real (vallas de código con longitud/carácter equivocados,
// comentarios HTML multilínea, encabezados que no son "## " literal,
// secciones duplicadas) son evidencia de que la relación entre "markdown
// que un humano puede escribir de verdad" y "lo que el escáner cubre" no
// se conoce todavía por completo. La mitad de DETECCIÓN de esta feature
// (todo lo de arriba, sin --reconcile) nunca escribe nada — es segura por
// construcción. La mitad de APLICACIÓN sí escribe en datos reales del
// usuario, así que el aviso se imprime en cuanto se sabe que el flag está
// presente — ANTES de cualquier validación o mutación, con o sin
// --dry-run (el aviso es sobre el RIESGO del flag, no sobre si esta
// corrida en concreto llega a mutar algo) — y NUNCA aparece sin el flag:
// el comportamiento por defecto (detectar, reportar, exit 3) no cambia ni
// gana avisos nuevos.
if (reconcileFlag) {
  console.error('aviso: --reconcile es EXPERIMENTAL — en las pruebas de esta feature ha corrompido bodies de issues reales de cuatro formas distintas ya encontradas y arregladas (vallas de código con el carácter/longitud de cierre equivocados, comentarios HTML multilínea, encabezados que no son "## " literal, secciones duplicadas que no se pueden resolver solas) — revisa el diff del issue en GitHub después de cada corrida, no confíes en el mensaje "reconciliado" a ciegas.')
}

// Validación explícita: con el `arg()` endurecido de arriba, un `--milestone`
// colgante (último token, o seguido de otro flag) devuelve `true` en vez de
// colar el flag siguiente como valor — pero sigue siendo responsabilidad del
// call-site rechazarlo en vez de dejarlo fluir hacia `gh` como si fuera un
// título de milestone real.
if (milestone === true || typeof milestone !== 'string' || milestone.length === 0) {
  console.error(`--milestone requiere un valor: recibido "${milestone === true ? '(sin valor)' : milestone}"`)
  process.exit(2)
}
// --section: OBSOLETO desde F10, y se dice en voz alta en vez de aceptarlo
// callando.
//
// Nunca sirvió para localizar nada: la tabla §9 se encuentra por su CABECERA
// DE COLUMNAS ("Slice" + "Dep"), no por ningún número de sección — así ha
// sido siempre (ver slices.js#analyzeSlicesTable), y el propio contrato que
// siembra /ct-init ya lo admitía. Lo único que hacía `--section N` era
// componer el ancla del enlace al spec como "#N"... un ancla que en GitHub no
// existe: el encabezado real "## 9. Slices" tiene el id "9-slices". O sea que
// el único trabajo del flag era producir un enlace roto.
//
// F6 le había puesto una validación de call-site (rechazar `--section`
// colgante, que renderizaba "spec.md#true") — correcta para lo que el flag
// hacía entonces, pero ahora sería exigir un valor para algo que no se usa.
// Se acepta el flag en cualquier forma, se ignora, y se avisa: quien tenga el
// comando escrito en un script, un alias o un slash command (commands/
// ct-groom.md lo llevaba) no ve su invocación romperse de golpe, pero tampoco
// se queda creyendo que sigue decidiendo algo.
if (process.argv.includes('--section')) {
  console.error('aviso: --section está obsoleto y se IGNORA — el ancla del enlace al spec sale ahora del encabezado real bajo el que vive la tabla (p.ej. "## 9. Slices" → "#9-slices"), y la tabla se localiza, como siempre, por su cabecera de columnas ("Slice" + "Dep"), no por ningún número de sección. Puedes quitarlo de la invocación.')
}
// Mismo criterio para --project: si se pasó el flag pero sin valor numérico
// real, abortamos en vez de dejar que `Number(true) === 1` decida en
// silencio contra qué Project v2 operar.
// D4 (revisión de los argumentos numéricos de todo el plugin): `Number(...)`
// es fiel con la basura de cola (`Number('7x')` es NaN, se rechazaba bien),
// pero aceptaba valores que NO son enteros — `--project 2.9` pasaba
// `Number.isFinite(...) && > 0` y viajaba tal cual a `gh project view 2.9`,
// que falla tarde y de forma confusa. parseStrictInt exige dígitos decimales
// a secas, el mismo criterio que `--cap` en ct-next.mjs y que el `<issue#>`
// de dispatch-check.mjs.
// `projectNum` (no `project`) es lo que usa TODO el camino posterior — el
// dry-run, `gh project view/item-add/item-list`, y las guardas `if (...)`.
// Validar un valor y usar otro es el mismo defecto que esta tanda arregla en
// otros sitios: `--project +7` pasaba la validación y luego llamaba a
// `gh project view +7`.
const projectNum = typeof project === 'string' ? parseStrictInt(project) : null
if (project !== undefined && (projectNum === null || projectNum <= 0)) {
  console.error(`--project inválido: "${project === true ? '(sin valor)' : project}" — debe ser un entero positivo en dígitos decimales a secas (sin signo "+"/"-", sin espacios, sin punto ni exponente)`)
  process.exit(2)
}
// --repo: un `--repo` colgante (arg() endurecido) da `true`, no un string —
// `if (!repo)` de más abajo no lo detecta porque `true` es truthy. Menos
// peligroso que milestone/project (acaba en `gh api repos/true/...`, 404,
// aborta antes de mutar nada), pero inconsistente con ct-next.mjs/
// dispatch-check.mjs, que ya validan `typeof !== 'string'` en vez de un
// check solo-falsy. No exigimos --repo aquí (sigue siendo opcional en
// --dry-run, ver más abajo): solo rechazamos el caso "se pasó el flag pero
// sin valor real".
if (repo !== undefined && typeof repo !== 'string') {
  console.error('--repo inválido: "(sin valor)" — usa --repo <owner/repo>')
  process.exit(2)
}

let specMd
try {
  specMd = readFileSync(specFile, 'utf8')
} catch (e) {
  console.error(`no se pudo leer el spec: ${specFile} (${e.code || e.message})`)
  process.exit(2)
}
// F1 (informe del incidente): un spec real, escrito por alguien que no había
// leído commands/ct-groom.md, produjo una tabla §9 que parseSlices() convertía
// en 0 slices — en total silencio. `/ct-groom --dry-run` imprimía
// `{"issues": [], ...}` y salía 0; una corrida real habría creado el
// milestone, cero issues, y reportado éxito. `analyzeSlicesTable` (a
// diferencia de `parseSlices`, que sigue devolviendo solo `Slice[]` para no
// romper el contrato del que dependen otros módulos/tests) trae el reporte
// completo de qué se pudo y qué NO se pudo parsear, y por qué. Todas las
// comprobaciones de abajo corren ANTES de `--dry-run` y ANTES de cualquier
// mutación de GitHub — un dry-run que valida menos que la corrida real es una
// trampa.
const report = analyzeSlicesTable(specMd)

// Mejora de uso (review round 2): con varios defectos a la vez, abortar en
// el PRIMERO que se encuentra fuerza hasta ocho ejecuciones para verlos
// todos — la misma noria de "arregla uno, vuelve a correr, descubre el
// siguiente" que convirtió el em dash en una trampa. Cada comprobación de
// abajo ya agrega TODAS las filas de su propia clase (no solo la primera);
// aquí se agregan además TODAS las clases que disparan, y se imprimen
// juntas antes de un único `process.exit(2)`.
const hardErrors = []

// F32 — la puerta de congelación (ver groom.js#analyzeSpecFreeze): corre
// sobre el spec ENTERO, antes de cualquier mutación y también bajo --dry-run
// (misma doctrina que F1: un dry-run que valida menos que la corrida real es
// una trampa). Se agrega a hardErrors como todo lo demás — las averías de
// congelación y las de tabla se reportan JUNTAS, un solo exit 2.
const freeze = analyzeSpecFreeze(specMd)
if (freeze.clarifications.length) {
  const first = freeze.clarifications[0]
  hardErrors.push(`el spec tiene ${freeze.clarifications.length} marcador(es) "[NEEDS CLARIFICATION" sin resolver (ejemplo, línea ${first.line}: "${first.raw}") — se admiten mientras el spec está en DRAFT, pero groom solo acepta specs CONGELADOS y congelar con uno pendiente es inválido: resuélvelo con quien decide, o apárcalo en "## Decisiones aparcadas", y vuelve a intentarlo`)
}
if (freeze.hypothesis === HYPOTHESIS_REASONS.ABSENT) {
  hardErrors.push('el spec no tiene sección "## Hipótesis" — sin apuesta falsable no es un epic y no entra por groom: añade "## Hipótesis del experimento" con la apuesta del epic (su calidad la juzga el humano en la congelación; groom solo mira que exista). El trabajo sin apuesta (mantenimiento, bugfixes) va como issues sueltos, no por groom')
} else if (freeze.hypothesis === HYPOTHESIS_REASONS.EMPTY) {
  hardErrors.push('la sección "## Hipótesis" del spec está vacía — escribe la apuesta falsable del epic bajo esa cabecera (un comentario de plantilla que sobrevive no cuenta como apuesta) y vuelve a intentarlo')
}

if (!report.tableFound) {
  // Distingue "no hay ninguna tabla markdown en el spec" de "hay tabla(s),
  // pero ninguna con cabecera Slice/Dep" (review de F1): son causas y
  // arreglos distintos, y el propio detector ya sabe cuál de las dos pasó
  // (report.pipeRowsFound).
  if (report.pipeRowsFound) {
    hardErrors.push('se encontraron filas de tabla markdown en el spec, pero ninguna cabecera con columnas "Slice" y "Dep" — añade (o corrige) la fila de cabecera de la tabla §9 con esas columnas (p.ej. "| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |")')
  } else {
    hardErrors.push('no se encontró ninguna tabla markdown (ninguna línea empieza por "|") en el spec — añade la tabla §9 de slices bajo su sección (ver commands/ct-groom.md)')
  }
} else if (report.missingRequiredColumns.length) {
  // F3: "Entrega" salió de esta lista — ya no es obligatoria (el título del
  // issue ahora sale de "Slice"; "Entrega" pasó a ser una descripción
  // opcional del cuerpo, ver OPTIONAL_COLUMN_CONSEQUENCE más abajo). "Slice"
  // no puede faltar como columna sin que la tabla entera deje de
  // reconocerse como la tabla §9 (ver el comentario en
  // slices.js#analyzeSlicesTable), así que "#" queda como el único caso real
  // de esta rama.
  for (const missing of report.missingRequiredColumns) {
    if (missing === '#') {
      hardErrors.push('la tabla §9 no tiene columna "#" — sin ella no hay orden de slice ni se pueden resolver las dependencias (merge-after); añade una columna de cabecera "#" con un entero puro por fila (1, 2, 3…)')
    }
  }
} else {
  // Los checks de aquí abajo son a nivel de FILA, y solo tienen sentido si
  // la cabecera ya es estructuralmente válida (si faltara "#" como columna,
  // cada fila heredaría ese problema de forma derivada — p.ej. todas
  // aparecerían en skippedRows con valor "" — y mostrarlo junto al mensaje
  // de columna ausente sería ruido, no señal nueva).

  // Punto 3 de la review de F1: una línea en blanco (o cualquier otra sin
  // "|") a mitad de la tabla truncaba el escaneo en silencio — las filas
  // posteriores desaparecían, medio epic se creaba igualmente, y el
  // proceso salía con éxito. analyzeSlicesTable ya no trunca (escanea todo
  // el bloque hasta la siguiente cabecera markdown, o hasta la cabecera de
  // una tabla nueva), pero reporta el hueco para que se arregle en vez de
  // dejarlo pasar.
  if (report.rowsAfterGap.length) {
    const first = report.rowsAfterGap[0]
    hardErrors.push(`${report.rowsAfterGap.length} fila(s) de datos de la tabla §9 aparecen después de una interrupción (línea en blanco, o una línea sin "|") dentro del bloque de la tabla (ejemplo: "${first.raw}") — la tabla debe ser un único bloque markdown contiguo, sin líneas en blanco entre las filas; une las filas en un solo bloque y vuelve a intentarlo`)
  }
  if (report.skippedRows.length) {
    const first = report.skippedRows[0]
    hardErrors.push(`${report.skippedRows.length} fila(s) de la tabla §9 tienen "#" que no es un entero a secas (ejemplo: "${first.value}") — "#" debe ser un entero puro como "1", nunca "S1" ni "**1**"; corrige esas filas (quita cualquier letra o negrita) y vuelve a intentarlo`)
  }
  // Punto 4 de la review de F1 (y puntos a/b de la review round 2): solo
  // se validaba la CABECERA, nunca las celdas — una fila con "Slice" vacía
  // (o con un marcador de "sin valor" como "–"), o con un número de celdas
  // distinto al de la cabecera (de menos, o de más por un "|" sin escapar),
  // parseaba igual y producía un issue titulado "#N" a secas (o con
  // columnas desplazadas), sin AC ni deps, exit 0. F3: el exigido pasó de
  // "Entrega" a "Slice" — el título del issue ahora sale de ahí.
  if (report.invalidRows.length) {
    const first = report.invalidRows[0]
    hardErrors.push(`${report.invalidRows.length} fila(s) de la tabla §9 están incompletas (ejemplo, slice #${first.n}: ${first.reason}) — sin "Slice" no hay título de issue; completa esas filas con todas las columnas de la cabecera y vuelve a intentarlo`)
  }
  if (report.totalDataRows === 0) {
    hardErrors.push('la tabla §9 no tiene ninguna fila de datos — añade al menos una fila con "#" y "Slice"')
  }
  // F2 (señalado tras verificar F1 contra el spec real): una celda "Dep"
  // con contenido (que no sea un marcador de "sin dependencias" —
  // "-"/"–"/"—"/etc., ver isNoValueCell en slices.js) de la que no se
  // extrajo ninguna "#N" — p.ej. "S1" en vez de "#1" — es MÁS grave que el
  // caso de 0 filas de arriba: no rompe el índice de orden, así que la
  // fila se parsea igual, el groom sale con exit 0, crea milestone e
  // issues... pero sin ninguna línea `merge-after`. El grafo de
  // dependencias se borra en silencio mientras todo aparenta funcionar —
  // /ct-next despacharía un slice dependiente sin esperar al merge del que
  // dependía. Mismo criterio que las filas con "#" malformado: abortar
  // fuerte, nombrando cuántas filas, un valor ofensor, el formato
  // correcto, Y (CRITICAL 1 de la review: la mitad que faltaba) qué
  // escribir si de verdad no hay dependencias.
  if (report.malformedDepRows.length) {
    const first = report.malformedDepRows[0]
    hardErrors.push(`${report.malformedDepRows.length} fila(s) de la tabla §9 tienen "Dep" con contenido pero sin ninguna dependencia reconocible (ejemplo, slice #${first.n}: "${first.raw}") — el formato es #N (p.ej. "#1", "#2, #3"), no "S1"; si no hay dependencias, escribe "–"; corrige esas filas y vuelve a intentarlo`)
  }
  // Punto 5 de la review de F1: las deps no se contrastaban contra los
  // slices que existen de verdad en la tabla. "#99" en una tabla de 2
  // slices, o "#3" en el propio slice 3 (auto-referencia, nunca
  // legítima), parseaban sin problema y llegarían a GitHub como
  // `merge-after` — un grafo equivocado escrito en los issues (el
  // dispatcher lo acaba reportando como deps-unmet, así que no es del todo
  // silencioso, pero sigue siendo un grafo equivocado que no hacía falta
  // escribir).
  // ==========================================================================
  // F21 — LA COLUMNA `Gate`. Dos condiciones de abort, y las dos son
  // deliberadamente DUROS (no avisos) por el mismo motivo, que es distinto del
  // que aplica a `Tipo`:
  //
  //   - un `Tipo` desconocido sigue siendo una label legítima para un humano
  //     (`type:ios` se entiende), y lo único que se pierde es un addendum. Por
  //     eso se avisa y se sigue.
  //   - un `Gate` desconocido no produce NADA: ni label, ni línea en el
  //     kickoff, ni línea en el cuerpo del issue. Escribir `Gate: seguridad` y
  //     que el groom siga adelante en silencio dejaría al autor convencido de
  //     que ha puesto un gate donde no hay ninguno — que es EXACTAMENTE la
  //     avería que esta ronda cierra, reintroducida por la puerta de al lado.
  //     Y aceptarlo emitiendo la label igual sería peor: un `gate:seguridad`
  //     que nadie sabe cómo cerrar, y que el kickoff no puede explicarle al
  //     agente.
  //
  // Esto ESTRECHA lo que el sistema acepta, así que crea una categoría nueva
  // de rechazo — y esa categoría necesita voz propia: los dos mensajes nombran
  // el vocabulario ENTERO (derivado de `GATES`, no de una lista repetida aquí)
  // y la sintaxis de renuncia, para que el remedio esté en el propio mensaje.
  // Van en `hardErrors`, es decir ANTES de la primera mutación: un spec con un
  // gate mal escrito no crea milestone, ni labels, ni issues.
  const unknownGateRows = []
  const contradictoryGateRows = []
  for (const s of report.slices) {
    const g = resolveGates(s.type, s.gate)
    for (const u of g.unknown) unknownGateRows.push({ n: s.n, token: u })
    for (const c of g.contradictions) contradictoryGateRows.push({ n: s.n, token: c })
  }
  if (unknownGateRows.length) {
    const first = unknownGateRows[0]
    hardErrors.push(`${unknownGateRows.length} valor(es) de la columna "Gate" de la tabla §9 no son ningún gate conocido (ejemplo, slice #${first.n}: "${first.token}") — los gates que este plugin sabe explicarle al agente y escribir en el issue son: ${Object.keys(GATES).join(', ')}. Un gate que no está en esa lista no produce label, ni línea de kickoff, ni nada en el cuerpo del issue: sería un gate que solo existe en el spec. Para RENUNCIAR a un gate que implica el "Tipo" del slice, escribe "!<gate>" (p.ej. "!visual"); para no declarar nada, deja la celda vacía o con "–". Si de verdad hace falta un gate nuevo, se añade a scripts/gates.js con su texto para el agente y para el issue`)
  }
  if (contradictoryGateRows.length) {
    const first = contradictoryGateRows[0]
    hardErrors.push(`${contradictoryGateRows.length} fila(s) de la tabla §9 piden y renuncian al MISMO gate en la columna "Gate" (ejemplo, slice #${first.n}: "${first.token}" y "!${first.token}") — no se elige un ganador en silencio sobre un gate humano: deja solo uno de los dos y vuelve a intentarlo`)
  }

  // Las cuatro condiciones de abort de la columna E2E. Todas comparten forma
  // con las dos de `Gate` (arriba) y con el mismo criterio: /ct-groom valida
  // TODO antes de escribir nada, y --dry-run comprueba exactamente lo mismo.
  //
  // Review round 2 (finding 2): las tres primeras versiones de estos mensajes
  // sólo nombraban la fila ("slice #N"), nunca lo que había escrito en la
  // celda — a diferencia de las dos de `Gate` de arriba, que sí citan el
  // token literal. "slice #5 tiene un problema" manda al autor a buscarlo;
  // citar la celda se lo pone delante. `quoteCell` normaliza el caso vacío
  // (nunca imprimir "" a secas) porque una celda vacía y una con espacios en
  // blanco son indistinguibles a simple vista sin decirlo explícitamente.
  const quoteCell = (raw) => {
    const trimmed = String(raw ?? '').trim()
    return trimmed ? `"${trimmed}"` : '(vacía)'
  }
  const e2eUndeclaredRows = []
  const e2eContradictoryRows = []
  const e2eGateWithoutRunsRows = []
  for (const s of report.slices) {
    const r = resolveE2e(s.e2e)
    // Sólo se exige decisión si la COLUMNA existe: un spec anterior a esta
    // ronda no la tiene, y ahí "no declarado" es el estado correcto de todas
    // sus filas. La columna presente es el compromiso; ausente, no hay nada
    // que reprochar.
    if (report.e2eColumnPresent && !r.declared) e2eUndeclaredRows.push({ n: s.n, cell: s.e2e })
    if (r.contradiction) e2eContradictoryRows.push({ n: s.n, cell: s.e2e })
    if (parseGateCell(s.gate).add.includes('e2e') && r.runs.length === 0) e2eGateWithoutRunsRows.push({ n: s.n, none: r.none, gateCell: s.gate, e2eCell: s.e2e })
  }
  if (e2eUndeclaredRows.length) {
    const first = e2eUndeclaredRows[0]
    hardErrors.push(`${e2eUndeclaredRows.length} fila(s) de la tabla §9 tienen la columna "E2E" sin declarar (ejemplo, slice #${first.n}: ${quoteCell(first.cell)}) — esta tabla TIENE columna "E2E", así que cada fila tiene que decidir: escribe el recorrido a atravesar, o "no" si este slice no tiene nada que atravesar. Un guion ahí significa "no he declarado nada" (el mismo significado que en Dep/Acepta/Protegido/Área/Toca), y con eso no se distingue "se pensó y no hay" de "nadie rellenó la columna" — que es justo la ambigüedad que el token "no" existe para quitar. Si este epic no usa e2e en absoluto, quita la columna entera`)
  }
  if (e2eContradictoryRows.length) {
    const first = e2eContradictoryRows[0]
    hardErrors.push(`${e2eContradictoryRows.length} fila(s) de la tabla §9 dicen "no" Y declaran un recorrido en la MISMA celda "E2E" (ejemplo, slice #${first.n}: ${quoteCell(first.cell)}) — no se elige un ganador en silencio: deja el recorrido, o deja el "no", y vuelve a intentarlo`)
  }
  if (e2eGateWithoutRunsRows.length) {
    const first = e2eGateWithoutRunsRows[0]
    hardErrors.push(`${e2eGateWithoutRunsRows.length} fila(s) de la tabla §9 declaran el gate "e2e" en la columna "Gate" pero su celda "E2E" ${first.none ? 'dice "no"' : 'está sin declarar'} (ejemplo, slice #${first.n}: Gate=${quoteCell(first.gateCell)}, E2E=${quoteCell(first.e2eCell)}) — nadie sabría qué atravesar. El gate "e2e" no se escribe a mano: se DERIVA de que la columna "E2E" traiga un recorrido. Quita el "e2e" de la columna "Gate" y escribe el recorrido en "E2E"`)
  }

  if (report.invalidDepRefs.length) {
    const first = report.invalidDepRefs[0]
    const example = first.reason === 'self'
      ? `slice #${first.n} depende de sí mismo (#${first.dep})`
      : `slice #${first.n} depende de #${first.dep}, que no existe en la tabla`
    hardErrors.push(`${report.invalidDepRefs.length} referencia(s) de "Dep" en la tabla §9 apuntan a un slice que no existe o a sí mismas (ejemplo: ${example}) — cada "#N" en Dep debe apuntar a un "#" que exista en la tabla y sea distinto del propio slice; corrige esas filas y vuelve a intentarlo`)
  }
}

if (hardErrors.length) {
  for (const msg of hardErrors) console.error(msg)
  process.exit(2)
}

// Columnas opcionales ausentes (Tipo/Acepta/Protegido/Área/Toca): degradan el
// issue creado (sin label type:, sin AC, sin Protegido explícito, o con la
// maquinaria de colisión/serialización inerte para estos slices) pero no
// impiden crear issues razonables — se avisa por stderr y se continúa, no se
// aborta.
const OPTIONAL_COLUMN_CONSEQUENCE = {
  Tipo: 'los issues se crearán sin label "type:"',
  // F3: "Entrega" se une a esta lista — ya no es obligatoria (el título
  // sale de "Slice"), así que su ausencia degrada en vez de abortar, igual
  // que Tipo/Acepta/Protegido/Área/Toca.
  Entrega: 'los issues se crearán sin sección "Descripción" en el cuerpo',
  Acepta: 'los issues se crearán sin criterios de aceptación',
  Protegido: 'los issues se crearán sin sección "Protegido" explícita',
  'Área': 'la maquinaria de colisión (claim.js#tokensOf) queda inerte para todos los slices de este epic',
  Toca: 'la serialización de touches (dispatch.js#SERIALIZING_TOUCHES) queda inerte para todos los slices de este epic',
}
for (const col of report.missingOptionalColumns) {
  console.error(`aviso: la tabla §9 no tiene columna "${col}" — ${OPTIONAL_COLUMN_CONSEQUENCE[col] || 'se omite esa información en los issues'}`)
}

// F5 (review, punto 2): el spec es autoridad de un prefijo de label
// (`type:`/`area:`/`touches:`) SOLO si la tabla §9 trae la columna que lo
// alimenta (Tipo/Área/Toca) — sin la columna, el spec no tiene NINGUNA
// opinión sobre ese prefijo, y reclamarla igual reportaría como "sobra" una
// label que un humano puso a mano por su cuenta (ruido que entrena a
// ignorar el resto del reporte de divergencia, ver reconcile.js). Se deriva
// de `report.missingOptionalColumns` (ya calculado arriba para el aviso de
// columna ausente) en vez de mantener una segunda comprobación — una sola
// fuente de verdad de "qué columnas trae esta tabla".
const ownedLabelPrefixes = []
if (!report.missingOptionalColumns.includes('Tipo')) ownedLabelPrefixes.push('type:')
if (!report.missingOptionalColumns.includes('Área')) ownedLabelPrefixes.push('area:')
if (!report.missingOptionalColumns.includes('Toca')) ownedLabelPrefixes.push('touches:')
// F21 — `gate:` sigue la misma regla, con una fuente doble: el spec tiene una
// opinión sobre los gates de un slice si trae la columna `Gate` (declaración
// explícita) O si trae la columna `Tipo` (los gates que el tipo implica —
// gates.js#TYPE_GATES). Sin ninguna de las dos, el spec no produce ninguna
// label `gate:` y no debe reclamar autoridad sobre una que un humano haya
// puesto a mano. Con cualquiera de las dos sí: un issue que conserva un
// `gate:visual` que el spec ya no produce es una divergencia real, y de las
// que importan — es un gate humano que alguien va a esperar y nadie va a
// pedir (o al revés).
if (report.gateColumnPresent || !report.missingOptionalColumns.includes('Tipo')) ownedLabelPrefixes.push('gate:')
// F3: "Tipo" decide, además de la label "type:<valor>", qué addendum recibe
// el agente despachado — kickoff.js#renderKickoff hace
// `ADDENDA[slice.type] || ''` en silencio, así que un valor que no sea
// ninguna key de ADDENDA (p.ej. "ios"/"swift" para un slice de UI real, en
// vez de "ui") deja al agente SIN el addendum correspondiente — grave en
// concreto para "ui", cuyo addendum impone el gate de screenshot
// obligatorio — sin que nada lo señale. Se avisa, no se aborta: el valor
// sigue siendo una label "type:" legítima aunque no tenga addendum (p.ej.
// un tipo nuevo que aún no se ha añadido a ADDENDA a propósito).
//
// KNOWN_TYPES se deriva de `Object.keys(ADDENDA)` (kickoff.js) en vez de
// mantener una segunda lista hardcodeada aquí: ADDENDA sigue siendo la
// ÚNICA fuente de verdad de qué tipos tienen addendum — añadir uno nuevo
// ahí (o corregir el nombre de uno existente) se refleja en este aviso sin
// tocar este fichero, así las dos listas no pueden divergir.
const KNOWN_TYPES = Object.keys(ADDENDA)
for (const s of report.slices) {
  // Review de F3, finding 1: un marcador de "sin valor" en "Tipo" ("–", "-",
  // "—", etc. — isNoValueCell, el MISMO criterio que ya usan Dep/Acepta/
  // Protegido/Área/Toca) significa "sin tipo", no un valor desconocido. Sin
  // este chequeo, este aviso acusaba de error tipográfico a un autor que
  // escribió exactamente el marcador que el propio contrato enseña a usar
  // en todas las demás columnas ("revisa si es un error tipográfico" sobre
  // un "–" es ruido, no señal). buildLabels (groom.js) ya trata este mismo
  // marcador como "sin type:" — coherente con eso.
  if (s.type && !isNoValueCell(s.type) && !KNOWN_TYPES.includes(s.type)) {
    // F21: este aviso nombra ahora la SEGUNDA consecuencia, que hasta esta
    // ronda no existía y es más grave que la primera. Un `Tipo` con una errata
    // (`UI` en vez de `ui`, `ios` en vez de `ui`) no solo se queda sin
    // addendum: se queda además sin los GATES que ese tipo implicaría — la
    // comparación es exacta también en gates.js#TYPE_GATES. Callar la mitad
    // "gate" de la consecuencia sería reintroducir en este aviso el mismo
    // problema que la columna `Gate` viene a cerrar. Se dice cuál sería el
    // gate perdido cuando el valor se parece a un tipo que sí implica alguno.
    const gateNote = Object.keys(TYPE_GATES).length
      ? ` — y tampoco los gates humanos que un Tipo reconocido implicaría (${Object.entries(TYPE_GATES).map(([t, gs]) => `${t}→${gs.join('/')}`).join(', ')}): si este slice necesita alguno, decláralo en la columna "Gate"`
      : ''
    console.error(`aviso: valor "${s.type}" en columna Tipo (slice #${s.n}) no es ninguno de los tipos reconocidos por el dispatcher (${KNOWN_TYPES.join(', ')}) — el agente despachado para este slice no recibirá ningún addendum de tipo (ver scripts/kickoff.js#ADDENDA)${gateNote}; revisa si es un error tipográfico o si falta añadir su addendum`)
  }
}
// ============================================================================
// F21 — LOS GATES, DICHOS EN VOZ ALTA. El encargo no era solo "que se pueda
// declarar un gate": era que el sistema lo DIGA. Quien groomea tiene que ver,
// sin ir a buscarlo, que un slice lleva un gate que no viene de su `Tipo` —y
// sobre todo que a un slice le han QUITADO uno—, porque las dos cosas son
// decisiones sobre qué se comprueba antes de mergear y ninguna de las dos debe
// poder colarse en un diff de spec sin que nadie la lea.
//
// Los cuatro avisos van por stderr y NO abortan: los cuatro describen
// configuraciones legítimas (o inocuas), a diferencia de los dos hardErrors de
// más arriba. Solo se habla cuando hay algo que decir — un slice cuyos gates
// salen tal cual de su `Tipo` (el caso masivamente mayoritario) no imprime
// nada, que es lo que mantiene útiles a los que sí salen.
// ============================================================================
// e2eAddedAdvisory (task "e2e al cierre del slice", adición 2): el mensaje
// genérico de `g.added` dice "es deliberado (para eso está la columna
// "Gate")" — FALSO para `e2e`, que no se declara ahí: se DERIVA de que la fila
// traiga recorridos en la columna "E2E", y escribirlo a mano en "Gate" es uno
// de los cuatro aborts que la columna E2E ya construyó (ver
// e2eGateWithoutRunsRows, arriba). Un aviso que manda al autor a la columna
// equivocada es peor que ningún aviso, así que este texto nombra "E2E" y
// nunca "Gate".
//
// Por qué vive en una función y se llama desde DOS sitios: `e2e` nunca lo
// implica ningún `Tipo` (no vive en TYPE_GATES), así que `resolveGates` lo
// clasifica como "implied" (silencioso, igual que un gate de Tipo) en vez de
// "added" en el caso normal (fila con recorridos, sin nada escrito a mano en
// "Gate") — y por tanto el bucle de `g.added`, de abajo, nunca lo ve en ese
// caso, que es el único que ocurre en la práctica (el otro, "Gate: e2e" a
// mano, ya aborta antes de llegar aquí). Sin el segundo disparador, pasar
// `s.e2e` a `resolveGates` (adición 1) no cambiaría nada visible: el gate
// seguiría llegando al issue por las labels y el reporte de groom seguiría sin
// mencionarlo — exactamente la fuga que F21 cerró para "Gate", reabierta para
// "E2E".
function e2eAddedAdvisory(n) {
  return `aviso: el slice #${n} lleva el gate "e2e" porque su fila declara recorridos en la columna "E2E" (no en "Gate": ese gate no se declara ahí, se DERIVA) — se dice en voz alta porque cambia lo que hay que comprobar antes de mergear: el issue llevará la label "gate:e2e", el agente despachado recibirá la instrucción, y quien revise el PR tiene que cerrarlo`
}

// e2eRedundantAdvisory / e2eWaivedAdvisory / e2eInertWaiverAdvisory (review de
// la adición 2, finding 1 y 2): los mismos "es deliberado (para eso está la
// columna Gate)" / "que implica su Tipo" / "su Tipo no implica ese gate" son
// FALSOS para `e2e` en `redundant`/`waived`/`inertWaivers`, exactamente por el
// motivo que ya cerró `added` — y en el caso de `redundant`, la review
// encontró que una fila con `Gate: e2e` MÁS recorridos reales imprime a la
// vez `e2eAddedAdvisory` (correcta) y el mensaje genérico de `redundant`
// (que dice "su Tipo ya implica" el gate): dos afirmaciones contradictorias
// sobre el MISMO gate, tres líneas de stderr aparte. Ninguna de las tres
// clasificaciones depende del `Tipo` para `e2e` — dependen de si la fila
// declara recorridos en "E2E", así que los tres textos nombran esa columna.
function e2eRedundantAdvisory(n, gateCell) {
  return `aviso: el slice #${n} declara el gate "e2e" (celda "Gate": "${gateCell}"), pero su fila YA lo lleva porque declara recorridos en la columna "E2E" — es redundante, no un error: el resultado es el mismo con la celda "Gate" vacía`
}
function e2eWaivedAdvisory(n, gateCell) {
  // A diferencia del mensaje genérico de `waived`, este SÍ dice la
  // consecuencia sin rodeos (pedido explícito de la review): la fila trae
  // recorridos de verdad y la renuncia se los lleva por delante igual.
  return `aviso: el slice #${n} RENUNCIA al gate "e2e" (celda "Gate": "${gateCell}"), pero su fila declara recorridos en la columna "E2E" — la renuncia se aplica igual: esos recorridos NO se le pedirán al agente, "gate:e2e" no aparecerá como label del issue, y nadie los atravesará antes de mergear. Si no era eso lo que querías, quita el "!" de esa celda`
}
function e2eInertWaiverAdvisory(n) {
  return `aviso: el slice #${n} renuncia al gate "e2e" con "!e2e" en la columna "Gate", pero su fila no declara recorridos en la columna "E2E": la renuncia no hace nada (no había nada que quitar). Se dice para que no te quedes con la idea de haber retirado un gate que nunca estuvo`
}

for (const s of report.slices) {
  const g = resolveGates(s.type, s.gate, s.e2e)
  const typeRef = s.type && !isNoValueCell(s.type) ? `"${s.type}"` : '(sin Tipo)'
  for (const gate of g.added) {
    if (gate === 'e2e') { console.error(e2eAddedAdvisory(s.n)); continue }
    console.error(`aviso: el slice #${s.n} declara el gate "${gate}", que su Tipo ${typeRef} no implica — es deliberado (para eso está la columna "Gate"), y se dice en voz alta porque cambia lo que hay que comprobar antes de mergear: el issue llevará la label "gate:${gate}", el agente despachado recibirá la instrucción, y quien revise el PR tiene que cerrarlo`)
  }
  // El caso REAL (ver el comentario de `e2eAddedAdvisory`): con recorridos y
  // sin nada escrito a mano en "Gate", `e2e` sale en `implied`, no en
  // `added`. `g.added.includes('e2e')` es inalcanzable en una corrida que
  // pase de los hardErrors (ver arriba), pero se comprueba igual para no
  // anunciar el mismo gate dos veces si alguna vez dejara de serlo.
  if (g.implied.includes('e2e') && !g.added.includes('e2e')) console.error(e2eAddedAdvisory(s.n))
  for (const gate of g.waived) {
    if (gate === 'e2e') { console.error(e2eWaivedAdvisory(s.n, s.gate)); continue }
    console.error(`aviso: el slice #${s.n} RENUNCIA al gate "${gate}" que implica su Tipo ${typeRef} (celda "Gate": "${s.gate}") — ese gate NO se le pedirá al agente, no aparecerá como label del issue y nadie lo comprobará antes de mergear. Si no era eso lo que querías, quita el "!" de esa celda`)
  }
  for (const gate of g.inertWaivers) {
    if (gate === 'e2e') { console.error(e2eInertWaiverAdvisory(s.n)); continue }
    console.error(`aviso: el slice #${s.n} renuncia al gate "${gate}", pero su Tipo ${typeRef} no implica ese gate: la renuncia no hace nada (no había nada que quitar). Se dice para que no te quedes con la idea de haber retirado un gate que nunca estuvo`)
  }
  for (const gate of g.redundant) {
    if (gate === 'e2e') { console.error(e2eRedundantAdvisory(s.n, s.gate)); continue }
    console.error(`aviso: el slice #${s.n} declara el gate "${gate}", que su Tipo ${typeRef} ya implica — es redundante, no un error: el resultado es el mismo con la celda "Gate" vacía`)
  }
}

// Valores de Área/Toca con el prefijo de LA OTRA columna (p.ej. "area:x"
// dentro de Toca): se toleró el valor (no se descartó), pero probablemente
// sea un despiste de columna — se avisa para que el autor pueda revisar.
for (const w of report.prefixWarnings) {
  console.error(`aviso: valor "${w.raw}" en columna ${w.column} (slice #${w.n}) trae el prefijo "${w.otherPrefix}:" de la otra columna — se ha usado el valor igualmente, revisa si está en la columna correcta`)
}
// Punto 6 de la review de F1: un valor de Área/Toca que, tras quitar
// prefijo/marcado y normalizar, queda vacío (p.ej. "area:" sin nada detrás,
// o "???" sin ningún carácter label-safe) se descartaba sin avisar — la
// misma inercia de colisión/serialización que el aviso de columna ausente
// de arriba, pero por celda. Coherente con ese mismo estándar: se avisa,
// no se aborta (el resto del slice sigue siendo válido).
for (const w of report.emptyTokenWarnings) {
  const labelPrefix = w.column === 'Área' ? 'area:' : 'touches:'
  console.error(`aviso: valor "${w.raw}" en columna ${w.column} (slice #${w.n}) queda vacío tras normalizar — no se genera ninguna label "${labelPrefix}" para ese valor, la maquinaria de colisión/serialización queda inerte para ese slice`)
}

// F10 — el enlace al spec. Se resuelve AQUÍ, una sola vez por corrida (la
// ruta y la sección son las mismas para todos los slices), y ANTES de la rama
// de --dry-run: el preview tiene que enseñar el MISMO body que escribiría la
// corrida real, incluidos sus avisos. Es la misma regla que F1 fijó para la
// validación de la tabla y F5 para la detección de divergencia — un dry-run
// que informa de menos que la corrida real es una trampa.
//
// `runForSpecLink` mantiene stderr en 'pipe' (no 'inherit', a diferencia de
// `gh()` más abajo): TODOS los fallos de aquí son casos previstos que este
// script traduce a un aviso propio y legible (el spec no está en un repo, no
// tiene remoto, no está empujado…), así que dejar salir además el error crudo
// de git/gh solo añadiría ruido a algo que ya se está explicando.
const SPEC_LINK_MAX_BUFFER = 20 * 1024 * 1024
const runForSpecLink = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: SPEC_LINK_MAX_BUFFER }).trim()
// realpathSync: `git -C <dir> rev-parse --show-toplevel` devuelve la raíz ya
// resuelta de enlaces simbólicos, así que sin resolver también el spec la
// resta de rutas daría "fuera del repo" para cualquiera que trabaje bajo un
// symlink (en macOS, /tmp -> /private/tmp lo hace saltar a diario). Si el
// realpath falla (fichero borrado entre el readFileSync de arriba y esto),
// se sigue con la ruta absoluta a secas: resolveSpecRef degrada sola.
let specAbsPath
try { specAbsPath = realpathSync(resolvePath(specFile)) } catch { specAbsPath = resolvePath(specFile) }
const { ref: specRef, warnings: specLinkWarnings } = resolveSpecRef({
  specFile: specAbsPath,
  displayPath: specFile,
  heading: report.sectionHeading,
  run: runForSpecLink,
  relativize: (root, file) => relativePath(root, file),
})
for (const w of specLinkWarnings) console.error(w)

// El contexto común del epic: una sección del spec, fuera de la tabla de
// slices, cuyo texto viaja idéntico al cuerpo de cada issue. Sus avisos se
// imprimen aquí, junto a los del enlace al spec, y NUNCA abortan: un spec sin
// esa sección es un spec válido, y bloquear un groom entero por una sección
// opcional malformada sería desproporcionado. El remedio va dentro del aviso.
const { content: epicContext, reason: epicContextReason, warnings: epicContextWarnings } = readEpicContext(specMd)
for (const w of epicContextWarnings) console.error(w)

const slices = report.slices
// groomPlan lanza si hay órdenes de slice duplicados en la tabla §9 (T14/W-A):
// se captura aquí y se reporta con la misma convención que el resto de errores
// de validación de este wrapper (spec inexistente, --milestone/--project/
// --repo inválidos) — mensaje limpio por console.error + exit(2), nunca el
// stack trace crudo de una excepción sin capturar.
let plan
try {
  plan = groomPlan(slices, { milestone, specRef, epicContext, epicContextReason })
} catch (e) {
  console.error(e.message)
  process.exit(2)
}

// maxBuffer explícito (finding 7 de la review final): el default de Node para
// execFileSync es 1 MiB. El `--paginate` de más abajo sobre TODOS los issues y
// PRs de un repo (con bodies completos) puede superar eso con facilidad en un
// repo con unos pocos cientos de issues — Node aborta ruidosamente en vez de
// truncar en silencio (bien), pero eso haría /ct-groom inusable contra un
// repo real. 20 MiB es generoso para miles de issues/PRs con body completo
// sin ser "sin límite" de verdad (un runaway real seguiría abortando).
const GH_MAX_BUFFER = 20 * 1024 * 1024
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: GH_MAX_BUFFER }).trim()

// F5 — detección de divergencia (existence-only → contenido real). Hasta
// ahora, todo lo de aquí abajo vivía DESPUÉS de la salida de --dry-run: un
// dry-run nunca llegaba siquiera a mirar si los issues ya existentes seguían
// coincidiendo con lo que el plan produce hoy. Eso es exactamente la misma
// trampa que F1 ya cerró para la validación de la tabla ("un dry-run que
// valida menos que la corrida real es una trampa") — aquí aplica igual: el
// fetch de issues (lectura, sin mutar nada) se adelanta a ANTES de la rama de
// --dry-run, para que el reporte de divergencia sea idéntico se ejecute o no
// de verdad. Solo se intenta si hay un `--repo` real (string): en dry-run sin
// --repo no hay contra qué comparar, así que se preserva el comportamiento de
// siempre (solo imprime el plan, nunca toca `gh`).
// fieldDriftCategories: las categorías que viajan por FLAGS de `gh issue edit`
// (buildReconcileEditArgs) — título/milestone/labels. No tienen rama de
// rendición: si divergen, se aplican. Descripción/Protegido/Gates a propósito
// NO aparecen aquí ni abajo: --reconcile nunca las toca (ver
// buildReconcileBody en scripts/reconcile.js), así que no pertenecen a "lo que
// se ha escrito".
function fieldDriftCategories(diff) {
  const cats = []
  if (diff.title) cats.push('título')
  if (diff.milestone) cats.push('milestone')
  if (diff.labels.missing.length || diff.labels.extra.length) cats.push('labels')
  return cats
}

// appliedCategories: qué se ha ESCRITO de verdad en este issue — flags +
// cuerpo. Es la única lista que puede aparecer en la línea de "reconciliado",
// que va por stdout, el canal que este script reserva para lo que ha pasado.
//
// Segunda oleada de la review final de rama: esa línea usaba "lo que DIVERGE"
// (título/milestone/enlace/labels/deps/ac/contexto del epic, sin mirar ninguna
// rendición), así que anunciaba por stdout la reescritura de una sección que
// el código acababa de negarse a tocar y que stderr reportaba como no
// reescrita en la misma corrida. El preview de --dry-run ya usaba
// `bodyDriftCategories`; ahora las dos rutas responden la misma pregunta.
//
// El contexto del epic SÍ puede aparecer (--reconcile lo reescribe) aunque NO
// cuente para el exit code: son dos preguntas distintas, y confundirlas es lo
// que dejaba esta línea terminando en un dos-puntos pelado cuando esa era la
// única categoría.
//
// Sólo para mensajes dirigidos a un humano — nunca para decidir qué llamar de
// verdad; eso lo deciden buildReconcileEditArgs/buildReconcileBody.
function appliedCategories(diff, bodyResult) {
  return [...fieldDriftCategories(diff), ...bodyDriftCategories(diff, bodyResult)]
}

// bodyDriftCategories: de las categorías que viajan por `--body` (las que
// buildReconcileBody splicea: enlace al spec, AC, dependencias y contexto del
// epic), cuáles se han APLICADO de verdad en este body — no cuáles divergen.
// La diferencia importa porque el preview de --dry-run nombra esta lista: una
// categoría que diverge pero cuya sección no se pudo localizar (unresolvedAc/
// unresolvedDeps/unresolvedEpicContext) no está en el body nuevo, y nombrarla
// sería anunciar una escritura que no ocurre. Antes, el preview escribía una
// lista FIJA ("dependencias/criterios de aceptación") que era falsa en cuanto
// lo que cambiaba era otra cosa.
//
// El enlace al spec no tiene rama de rendición: si la línea no existe,
// buildReconcileBody la antepone al principio del body.
function bodyDriftCategories(diff, bodyResult) {
  const cats = []
  if (diff.specLink) cats.push('enlace al spec')
  if ((diff.deps.missing.length || diff.deps.extra.length) && !bodyResult.unresolvedDeps) cats.push('dependencias')
  if ((diff.ac.missing.length || diff.ac.extra.length) && !bodyResult.unresolvedAc) cats.push('criterios de aceptación')
  if (diff.epicContextDiffers && !bodyResult.unresolvedEpicContext) cats.push('contexto del epic')
  return cats
}

// EPIC_CONTEXT_SURRENDERS: por qué buildReconcileBody no pudo reescribir
// "## Contexto del epic", en las palabras que le sirven a quien lee el
// informe. Se reporta como `nota:` y NUNCA mueve el exit code (§4.4 del
// diseño): esta sección no puede producir un 3 ni divergiendo, ni duplicada,
// ni rindiéndose. Que se rindiera en SILENCIO era lo único indefendible —
// AC y Dependencias se rinden en voz alta desde la review round 4.
const EPIC_CONTEXT_SURRENDERS = {
  'sin-ancla': 'no existe la sección en el issue, y tampoco ninguna de las dos cabeceras que sirven de ancla para ponerla en su sitio ("## Contexto heredado" o, en su defecto, "## Acceptance criteria"); añade a mano una de ellas y vuelve a correr',
  'ancla-duplicada': 'no existe la sección en el issue y su ancla ("## Acceptance criteria") aparece más de una vez, así que insertarla ahí podría escribir dentro de texto ajeno; deja una sola copia del ancla y vuelve a correr',
  duplicada: 'aparece más de una vez en el body y no hay forma de saber cuál copia es la del plugin — una puede ser texto pegado dentro de "## Contexto heredado", que no se toca nunca; deja una sola copia y vuelve a correr',
  'seccion-sin-cerrar': 'la sección del issue tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, así que no se sabe dónde termina: reescribirla se llevaría por delante todo lo que venga detrás en el cuerpo (contexto heredado, criterios, gates, protegido y el marcador ct-order). Cierra el delimitador en el issue y vuelve a correr',
  'texto-sin-cerrar': 'el texto que trae el spec tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, y escribirlo en el cuerpo dejaría el issue en ese mismo estado. Ciérralo en el spec y vuelve a correr',
  'en-heredado': 'el spec ya no trae contexto del epic, y la única copia de esta sección en el body queda por detrás de la cabecera "## Contexto heredado", dentro de la zona que pertenece a la sesión coordinadora y que no se toca nunca. No se retira nada; si esa copia sobra, quítala tú',
  // Aquí NO se afirma de quién es el texto, a diferencia de 'en-heredado':
  // sin "## Acceptance criteria" localizable no hay forma de saber dónde acaba
  // la zona de la sesión coordinadora, así que tampoco de saber si esa copia
  // cae dentro. Lo único que se sabe es que no se puede tocar con seguridad.
  'zona-sin-fin': 'no se puede saber dónde termina "## Contexto heredado" en este body: su cabecera está, pero "## Acceptance criteria" —la cabecera que la sigue siempre, y que marca el final de esa zona— no aparece exactamente una vez. Sin ese límite no se distingue qué hay por detrás que sea del issue y qué escribió la sesión coordinadora, así que esta sección no se reescribe ni se retira. Restaura (o desduplica) "## Acceptance criteria" y vuelve a correr',
}

// describeGaps (review round 3, Critical 2): nombra qué categorías, DE LAS
// QUE REALMENTE DIVERGEN, --reconcile no pudo (o no podrá) aplicar —
// nunca "solo prosa" cuando en realidad es AC/deps sin sección localizable:
// ese era exactamente el bug que hacía salir 0 sobre una divergencia de
// máquina real. `gaps.duplicates` (review round 5, Importante 3): una
// sección "machine" duplicada — --reconcile no decide cuál copia es la
// correcta, así que tampoco puede aplicar nada ahí; sin nombrarlo aquí,
// esta misma divergencia salía 0 en silencio bajo --reconcile.
//
// GAP_REASONS (review final de rama, C2): el motivo exacto lo decide
// buildReconcileBody (`unresolvedReasons`), no este fichero. Antes había una
// sola frase por categoría —"no se encontró la sección"— que era cierta para
// el caso original y dejó de serlo en cuanto aparecieron los otros dos: una
// sección DUPLICADA sí se encuentra (el problema es que hay dos y ninguna se
// puede señalar como la del plugin), y una inserción sin ancla no habla de la
// sección que falta sino de la que tendría que servir de referencia.
const GAP_REASONS = {
  ac: {
    'sin-seccion': 'no se encontró la sección "## Acceptance criteria" en el body',
    duplicada: 'la sección "## Acceptance criteria" aparece más de una vez y no hay forma de saber cuál copia es la del plugin — puede ser texto pegado dentro de "## Contexto heredado"',
  },
  deps: {
    'sin-seccion': 'no se encontró la sección "## Dependencias" en el body',
    duplicada: 'la sección "## Dependencias" aparece más de una vez y no hay forma de saber cuál copia es la del plugin — puede ser texto pegado dentro de "## Contexto heredado"',
    'sin-ancla': 'no existe la sección "## Dependencias" y tampoco "## Out of scope / Protected", que es el único ancla seguro para insertarla',
    'ancla-duplicada': 'no existe la sección "## Dependencias" y su ancla ("## Out of scope / Protected") aparece más de una vez, así que insertarla ahí podría escribir dentro de texto ajeno',
    'en-heredado': 'la única "## Dependencias" del body está DENTRO de "## Contexto heredado" — es texto pegado por la sesión coordinadora, que no se toca nunca, así que no es la sección del issue. Tampoco se añade una segunda copia más abajo: el dispatcher lee la PRIMERA, o sea la de ella. Saca ese bloque de la sección heredada (o quítale la cabecera) y vuelve a correr',
    'ancla-en-heredado': 'no existe la sección "## Dependencias" y la única "## Out of scope / Protected" del body está DENTRO de "## Contexto heredado", así que anclar la inserción ahí escribiría dentro del texto de la sesión coordinadora',
    'zona-sin-fin': 'no se puede saber dónde termina "## Contexto heredado" en este body: su cabecera está, pero "## Acceptance criteria" —la cabecera que la sigue siempre, y que marca el final de esa zona— no aparece exactamente una vez. Sin ese límite no se distingue qué hay por detrás que sea del issue y qué escribió la sesión coordinadora, así que no se escribe nada ahí. Restaura (o desduplica) "## Acceptance criteria" y vuelve a correr',
  },
}
function describeGaps(gaps, bodyResult) {
  const reasons = bodyResult.unresolvedReasons || {}
  const parts = []
  if (gaps.ac) parts.push(`criterios de aceptación (${GAP_REASONS.ac[reasons.ac] ?? GAP_REASONS.ac['sin-seccion']})`)
  if (gaps.deps) parts.push(`dependencias (${GAP_REASONS.deps[reasons.deps] ?? GAP_REASONS.deps['sin-seccion']})`)
  if (gaps.duplicates) parts.push('secciones duplicadas (## Dependencias/## Acceptance criteria — --reconcile no decide cuál copia es la correcta: une o borra la sobrante a mano)')
  return parts.join(' y ')
}

let existingIssues = null
// inEpic (F23): los issues del epic de ESTA corrida — los del milestone cuyo
// título es el argumento `--milestone`. Es la lista contra la que se emparejan
// los marcadores `ct-order` y se detectan huérfanos. Vive como variable de
// módulo (y no dentro del bloque de lectura donde se calcula) por UNA sola
// razón, y conviene decirla con honestidad: el bucle de creación, mucho más
// abajo y fuera de ese bloque, sigue registrando ahí cada issue recién
// creado. Ese registro no protege hoy de nada — ver el comentario junto al
// `push` más abajo, que explica por qué no tiene lectores.
//
// Por qué el emparejado se acota (§2 del feedback de campo, medido en
// producción): /ct-groom numera los slices 1..N POR EPIC y escribe ese número
// en `<!-- ct-order:N -->`, así que el marcador NO es único en el repo — el
// contrato §9 lo promete explícitamente ("únicos dentro de su milestone, no
// del repo"). Buscarlo por todo el repo hacía dos cosas, las dos falsas:
// emparejaba una tabla §9 nueva empezando en 1,2,3 con los issues de un epic
// anterior y CERRADO (reportando su milestone distinto como "divergencia", y
// con --reconcile los habría arrastrado al milestone nuevo), y declaraba
// huérfanos a los issues de cualquier otro epic del repo.
let inEpic = null
let reconcileEntries = [] // [{ iss, found, diff, bodyResult, gaps }] — found/diff/bodyResult/gaps son null si el issue todavía no existe
let anyUnresolvedDrift = false
// anyReconcileGapRemains (review round 3, Critical 2): true si CUALQUIER
// entrada tiene una divergencia real de AC/Dependencias que --reconcile no
// pudo aplicar (sección no localizable — ver reconcile.js#reconcileGaps).
// title/milestone/labels/enlace-al-spec NUNCA producen un gap: siempre se
// resuelven vía flags o un splice de una sola línea, sin depender de
// localizar ninguna sección. Se usa para el código de salida de la corrida
// real CON --reconcile (más abajo) — sin --reconcile, `anyUnresolvedDrift`
// ya basta.
let anyReconcileGapRemains = false
// anyOrphans (F5, importante 4): un issue con marcador ct-order:N cuyo
// slice N ya no está en la tabla §9 actual — antes no se mencionaba jamás
// (reconcileEntries se construye recorriendo plan.issues, que solo conoce
// los slices ACTUALES), exit 0, silencio total. Se detecta por separado,
// recorriendo TODOS los issues existentes (no solo los que matchean algún
// slice de hoy) y comparando su orden contra los órdenes que la tabla §9
// todavía declara.
let anyOrphans = false
// existingLabelNames (F6, menor 5): las labels que el repo YA tiene. Dos
// motivos, ninguno cosmético:
//   1. El contrato pide "reutiliza el vocabulario de labels que ya exista en
//      este repo, no inventes uno nuevo por spec" — y hasta ahora nadie podía
//      comprobar cuál era ese vocabulario ni ver, después, qué se había
//      acabado inventando: `gh label create --force` no distingue crear de
//      actualizar, y no imprimía nada.
//   2. `--force` sobre una label que YA existe la REESCRIBE (color y
//      descripción incluidos, con los que gh asigna por defecto). Creando
//      solo las que faltan, una label que el repo ya tenía cuidada deja de
//      cambiar de color en cada groom.
let existingLabelNames = null
if (typeof repo === 'string') {
  try {
    const raw = JSON.parse(gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=all', '--paginate', '--slurp']))
    existingIssues = realIssuesOnly(flattenIssuePages(raw))
  } catch (e) {
    console.error(`no se pudo listar issues de ${repo}: ${e.message}`)
    process.exit(1)
  }
  try {
    const rawLabels = JSON.parse(gh(['api', `repos/${repo}/labels`, '--method', 'GET', '--paginate', '--slurp']))
    existingLabelNames = new Set(flattenPages(rawLabels).map((l) => l && l.name).filter(Boolean))
  } catch (e) {
    // Mismo criterio que el listado de issues/milestones: un fallo de lectura
    // NO se degrada a "el repo no tiene ninguna label" — eso llevaría a
    // reescribir con --force labels existentes y a informar de labels
    // "nuevas" que sí existían. Se aborta con mensaje claro.
    console.error(`no se pudieron listar las labels de ${repo}: ${e.message}`)
    process.exit(1)
  }
  const knownOrders = new Set(plan.issues.map((i) => i.order))
  const partition = partitionByEpic(existingIssues, milestone)
  inEpic = partition.inEpic

  // F23 — las puertas del alcance por epic. Van AQUÍ, entre el listado de
  // issues y todo lo demás, porque este punto está por delante de la primera
  // mutación del script (la creación del milestone, mucho más abajo): una
  // comprobación que no puede detener la acción siguiente es decoración, y
  // una que aborta después de crear el milestone deja basura en GitHub — el
  // mismo motivo por el que el listado se colocó donde está.
  //
  // Las dos puertas se calculan ENTERAS y se reportan JUNTAS antes de un
  // único exit: nombrar sólo el primer bloqueante dice "quita ése y sale", y
  // es falso cuando hay más de uno.
  //
  // Código de salida 1, por precedente de este mismo fichero: 1 es "leí un
  // estado inconsistente, NO continúo" (ver el abort del listado de items del
  // project); 2 es error de validación de argv/spec; 3 es "hubo divergencia
  // pero el trabajo se hizo", y aquí no se hace nada.
  const bloqueos = []
  const repoRefBloqueo = typeof repo === 'string' ? repo : '<owner/repo>'

  // Puerta A — issues SIN milestone. No se les puede atribuir un epic, así
  // que las dos lecturas posibles hacen daño: emparejarlo reescribiría un
  // issue ajeno; ignorarlo crearía un duplicado del slice que sí es nuestro.
  // Sólo bloquea si su orden COLISIONA con la tabla §9 de hoy — un marcador
  // que no compite con nada no impide nada, pero tampoco se calla (mismo
  // criterio que NO_MILESTONE_KEY en gh-issue-map.js: cubo compartido con
  // aviso, nunca invisible).
  const sinMilestoneBloqueantes = []
  for (const i of partition.sinMilestone) {
    const order = extractOrder(i.body)
    if (order == null) continue
    if (knownOrders.has(order)) {
      sinMilestoneBloqueantes.push(`  #${i.number}  ct-order:${order}`)
    } else {
      console.error(`aviso: issue #${i.number} lleva el marcador ct-order:${order} y no tiene milestone — no puedo decidir a qué epic pertenece, así que queda fuera de este groom. No colisiona con la tabla §9 de este spec, por eso no bloquea; asígnale su milestone para que deje de aparecer: gh issue edit ${i.number} --repo ${repoRefBloqueo} --milestone "<el suyo>"`)
    }
  }
  if (sinMilestoneBloqueantes.length) {
    bloqueos.push({
      titular: 'estos issues llevan un marcador ct-order que colisiona con la tabla §9 de este spec, pero NO tienen milestone — no puedo decidir si son de este epic o de otro:',
      lineas: sinMilestoneBloqueantes,
      remedio: `asígnales su milestone y vuelve a correr: gh issue edit <n> --repo ${repoRefBloqueo} --milestone "<el suyo>"`,
    })
  }

  // Puerta B — el MISMO epic bajo OTRO título. Riesgo que introduce el propio
  // acotado por epic, no uno que ya existiera: mientras el emparejado era
  // global, un `--milestone` con una errata (o un epic renombrado en GitHub)
  // seguía encontrando sus issues por marcador y a lo sumo reportaba
  // divergencia. Acotado, esa misma corrida ve CERO issues en su epic y
  // recrea el epic entero duplicado en un milestone nuevo, con exit 0 — un
  // comando que no da error y no hace lo que parece.
  //
  // La señal que lo distingue de un epic distinto reusando números es el
  // enlace al spec, que todo issue groomeado lleva en el body
  // (groom.js#renderSpecLink). Mismo orden + MISMO documento = el mismo epic
  // con otro nombre. Documento distinto = dos epics legítimos compartiendo el
  // número de orden, que es EXACTAMENTE lo que F23 viene a habilitar: no
  // dispara.
  //
  // Se compara el DESTINO del enlace (specTarget), no la línea entera: la
  // línea empieza por "> Slice `#N` del epic. " y ese prefijo cambió de
  // formato en F6, así que comparar entero fallaría contra cualquier issue
  // anterior.
  //
  // Cuando el destino falta en cualquiera de los dos lados, o difiere, la
  // puerta NO dispara — falla en ABIERTO. El precio hay que decirlo entero,
  // porque no es el statu quo: si el epic estaba renombrado y sus issues
  // llevan el enlace en otra forma (groomeados antes de F10, o con la forma
  // degradada "— sin enlace: <motivo>"), `inEpic` sale vacío y esta corrida
  // recrea el epic ENTERO duplicado con exit 0. Antes de F23, el emparejado
  // global los encontraba por marcador y reportaba divergencia con exit 3,
  // sin crear nada: el falso negativo no devuelve nada, abre un agujero que
  // antes no existía. Se acepta a cambio de no ladrillar el caso normal —
  // un falso positivo pararía en seco dos epics distintos reusando números
  // de orden, que es justo lo que F23 viene a habilitar. Lo que sí se hace
  // es no callarlo: todo descarte de este cubo que pueda acabar en un epic
  // duplicado —o sea, el de un slice que todavía no tiene issue en este
  // epic— emite un aviso por stderr (más abajo, en el propio `continue`),
  // no bloqueante.
  const specTargetPorOrden = new Map(plan.issues.map((i) => [i.order, specTarget(i.specLink)]))
  const otroEpicBloqueantes = []
  const otroEpicAvisos = []
  for (const i of partition.otrosEpics) {
    const order = extractOrder(i.body)
    if (order == null || !knownOrders.has(order)) continue
    const suyo = specTarget(extractSpecLink(i.body))
    const nuestro = specTargetPorOrden.get(order)
    if (suyo === null || nuestro === null || suyo !== nuestro) {
      // El aviso del fallo en abierto. Cierra la asimetría con la puerta A,
      // que sí nombra por stderr los issues sin milestone que NO bloquean:
      // este cubo es exactamente del que sale un epic duplicado con exit 0
      // (ver el comentario de arriba), así que descartarlo en silencio es lo
      // único que no se puede hacer. No bloquea, no cambia el código de
      // salida, y no altera cuándo dispara la puerta.
      //
      // Acotado a los slices que NO tienen ya issue en ESTE epic, con el
      // mismo predicado que usa el emparejado de más abajo
      // (`findByMarker(inEpic, marker)`): la duplicación sólo puede ocurrir
      // si el slice se va a crear, y si ya tiene issue aquí el emparejado lo
      // encuentra y la creación se salta — no hay nada que duplicar, así que
      // el aviso saldría en cada corrida sin describir ninguna pérdida y sin
      // nada que el humano pueda hacer para callarlo. Mismo criterio, en este
      // mismo fichero, que el filtro de issues cerrados de
      // `backlogPendingCount`: un aviso que no se puede satisfacer es un
      // aviso que enseña a ignorar los demás. El acotado no pierde ningún
      // caso peligroso — cubre exactamente el conjunto en el que la
      // duplicación es posible.
      if (findByMarker(inEpic, `<!-- ct-order:${order} -->`)) continue
      const motivo = suyo === null
        ? 'pero su body no lleva ninguna línea de enlace al spec con la que compararlo'
        : (nuestro === null
          ? 'pero este spec no ha producido ningún enlace con el que compararlo'
          : 'pero su enlace al spec no coincide con el de este spec')
      // Se acumula en vez de imprimirse aquí: los avisos se emiten DESPUÉS
      // del exit de los bloqueos (más abajo), porque cada uno afirma que este
      // groom va a crear ese slice — y en una corrida que se para en seco no
      // se crea nada. Nada se pierde: la corrida siguiente, ya sin bloqueo,
      // los vuelve a calcular igual.
      otroEpicAvisos.push(`aviso: el slice #${order} de este spec tiene un issue en otro milestone con el mismo ct-order (#${i.number}, "${epicTitleOf(i)}"), ${motivo} — así que lo trato como otro epic y ${dryRun ? 'crearía' : 'crearé'} un issue nuevo para el slice #${order} en "${milestone}". Si en realidad es el mismo epic renombrado, esto va a duplicarlo: compruébalo antes de seguir.`)
      continue
    }
    otroEpicBloqueantes.push(`  #${i.number}  ct-order:${order}  milestone: "${epicTitleOf(i)}"`)
  }
  if (otroEpicBloqueantes.length) {
    bloqueos.push({
      titular: 'estos slices ya tienen un issue en OTRO milestone que apunta al MISMO spec — parece este mismo epic bajo otro título, no un epic distinto:',
      lineas: otroEpicBloqueantes,
      remedio: `este spec pide --milestone "${milestone}". Si renombraste el epic, usa su título real; si es un epic nuevo de verdad, su tabla §9 no debería apuntar al mismo spec que el anterior.`,
    })
  }

  if (bloqueos.length) {
    for (const { titular, lineas, remedio } of bloqueos) {
      console.error(titular)
      for (const linea of lineas) console.error(linea)
      console.error(remedio)
    }
    console.error('/ct-groom NO continúa: no se ha creado ni modificado nada.')
    process.exit(1)
  }
  for (const aviso of otroEpicAvisos) console.error(aviso)

  for (const i of inEpic) {
    const order = extractOrder(i.body)
    if (order != null && !knownOrders.has(order)) {
      console.error(`aviso: issue #${i.number} lleva el marcador ct-order:${order}, pero el slice #${order} ya no está en la tabla §9 del spec — issue huérfano del epic "${milestone}" (¿se eliminó el slice sin cerrar/renumerar su issue?); revísalo a mano`)
      anyOrphans = true
    }
  }
  reconcileEntries = plan.issues.map((iss) => {
    const marker = `<!-- ct-order:${iss.order} -->`
    const found = findByMarker(inEpic, marker)
    if (!found) return { iss, found: null, diff: null, bodyResult: null, gaps: null }
    // F23: `diff.milestone` es INALCANZABLE desde aquí desde que el
    // emparejado está acotado por epic — `found` sale de `inEpic`, y a
    // `inEpic` sólo entran issues cuyo milestone es exactamente el que se le
    // pasa a diffIssue como `wantedMilestone` (`partitionByEpic` los reparte
    // por título EXACTO contra `milestone`, y `plan.milestone` es ese mismo
    // valor — ver groomPlan en groom.js). Con ello desaparece POR
    // CONSTRUCCIÓN el peligro que el §2 del feedback señalaba en mayúsculas:
    // un --reconcile que, además de reescribir el body, arrastrase un issue
    // cerrado de otro epic al milestone nuevo. La comparación NO se borra de
    // reconcile.js: ese módulo es puro, compartido y testeado, y sigue siendo
    // la reparación correcta para cualquier caller que le pase un issue de
    // otro alcance. Lo que ya no puede ocurrir es que ESTE call-site lo haga.
    const diff = diffIssue(found, iss, plan.milestone, ownedLabelPrefixes)
    // bodyResult es puro (no toca `gh`, no muta nada) — seguro de calcular
    // siempre, con o sin --reconcile, con o sin --dry-run: es la única forma
    // de saber, ANTES de que nadie pida aplicar nada, si una divergencia de
    // AC/Dependencias sería siquiera aplicable (Critical 2) — y, desde la
    // review final de rama, si hay algo que escribir en el body aunque nada
    // de lo divergente cuente para el exit code (C1: el contexto del epic).
    const bodyResult = buildReconcileBody(found.body, iss)
    const gaps = reconcileGaps(diff, bodyResult)
    return { iss, found, diff, bodyResult, gaps }
  })
  // El reporte de divergencia se imprime SIEMPRE por stderr (mismo canal que
  // el resto de "aviso:" de este script) en cuanto se conoce — antes de la
  // rama de --dry-run, para que sea IDÉNTICO en preview y en corrida real.
  // Silencio aquí significa "spec e issues están de acuerdo": formatDrift
  // devuelve [] cuando no hay nada que reportar (ver scripts/reconcile.js).
  for (const { found, diff, bodyResult, gaps } of reconcileEntries) {
    if (!found) continue
    for (const line of formatDrift(diff)) console.error(line)
    if (hasReconcileGap(gaps)) {
      console.error(`aviso: slice #${diff.order} (issue #${found.number}) — --reconcile no puede aplicar del todo esta divergencia: ${describeGaps(gaps, bodyResult)}; revísala a mano en GitHub`)
    }
    // La rendición del contexto del epic va por separado y como `nota:`: no
    // entra en `reconcileGaps` porque esta sección nunca cuenta para el exit
    // code (§4.4), pero callar que no se aplicó sería afirmar por omisión que
    // sí. Solo se dice cuando de verdad había algo que escribir.
    if (bodyResult.unresolvedEpicContext && diff.epicContextDiffers) {
      console.error(`nota: slice #${diff.order} (issue #${found.number}) — --reconcile NO ha reescrito la sección "${EPIC_CONTEXT_HEADING}": ${EPIC_CONTEXT_SURRENDERS[bodyResult.unresolvedEpicContext]} (no cuenta para el exit code)`)
    }
    if (hasDrift(diff)) anyUnresolvedDrift = true
    if (hasReconcileGap(gaps)) anyReconcileGapRemains = true
  }
  // --reconcile bajo --dry-run: NUNCA muta (ni aquí ni en la rama real de más
  // abajo) — solo hace explícito qué aplicaría una corrida real con
  // --reconcile, para que el preview no calle información que sí actuaría.
  // El --body reconciliado (si diverge algo que viaje por él) NO se imprime entero — sería
  // un bloque de texto largo — se nombra por categoría, igual que el resto
  // de mensajes dirigidos a un humano de este bloque. El aviso de "gap" (si
  // lo hay) ya se imprimió arriba — no se repite aquí.
  if (reconcileFlag && dryRun) {
    for (const { found, diff, bodyResult } of reconcileEntries) {
      // "¿hay algo que escribir?" NO es "¿esto cuenta para el exit code?".
      // `hasDrift` responde la segunda (excluye a propósito el contexto del
      // epic, §4.4 del diseño), y gatear la escritura con ella hacía que el
      // escenario primario de F26 —el autor edita la sección del spec y
      // vuelve a correr— calculase el body nuevo y lo tirase. La primera
      // pregunta la responde `bodyResult.body !== null`.
      if (!found || !(hasDrift(diff) || bodyResult.body !== null)) continue
      const fieldArgs = buildReconcileEditArgs(diff)
      if (fieldArgs.length || bodyResult.body !== null) {
        const bodyCats = bodyDriftCategories(diff, bodyResult)
        const bodyNote = bodyResult.body !== null ? ` --body <actualizado: ${bodyCats.join(', ')}>` : ''
        console.error(`--reconcile aplicaría: gh issue edit ${found.number} --repo ${repo} ${fieldArgs.join(' ')}${bodyNote}`.trim())
      }
    }
  }
}

// F6, menor 5 — labels: qué se reutiliza y qué se inventa. Se calcula ANTES
// de la rama de --dry-run (misma información en preview y en corrida real,
// igual que el reporte de divergencia). `newLabels` cae a "todas" cuando no
// hay --repo con el que consultar: sin repo no se puede afirmar que ninguna
// exista.
const wantedLabels = [...new Set(plan.issues.flatMap((i) => i.labels))]
const reusedLabels = existingLabelNames ? wantedLabels.filter((l) => existingLabelNames.has(l)) : []
const newLabels = existingLabelNames ? wantedLabels.filter((l) => !existingLabelNames.has(l)) : wantedLabels
const LABEL_VOCAB_HINT = `revisa si alguna es un sinónimo de una que ya existe (\`gh label list --repo ${typeof repo === 'string' ? repo : '<owner/repo>'}\`): la detección de colisión (area:/touches:) solo funciona si todos los specs del repo usan el MISMO vocabulario`
// Se habla SOLO cuando hay algo que revisar — inventar vocabulario nuevo. Si
// el plan no crea ninguna label, no hay nada que distinguir y el silencio
// sigue significando lo que significaba (mismo criterio que el reporte de
// divergencia de F5: silencio = nada que decidir). Sin --repo no se puede
// afirmar nada sobre qué existe, así que tampoco se dice nada.
function labelReportLine(verb) {
  if (!existingLabelNames || !newLabels.length) return null
  const reusedPart = reusedLabels.length ? ` (las demás ya existían y se reutilizan tal cual, sin tocarlas: ${reusedLabels.join(', ')})` : ''
  return `labels ${verb} nuevas en ${repo}: ${newLabels.join(', ')}${reusedPart} — ${LABEL_VOCAB_HINT}`
}
// F6, grave 2 — el groom crea issues en `status:backlog` (groom.js#buildLabels)
// y el dispatcher solo mira `status:ready`: correr /ct-groom y acto seguido
// /ct-next producía "no hay slices despachables" sobre issues recién creados,
// sin que nada explicara por qué. El recordatorio se ancla al ESTADO REAL de
// los issues (resolveStatus, el mismo criterio del dispatcher), no a "acabo
// de crear algo": un epic ya promovido entero no genera ningún ruido, y un
// epic cuyos issues siguen en backlog lo dice aunque esta corrida no haya
// creado nada.
function backlogPendingCount() {
  if (!reconcileEntries.length) return plan.issues.length // sin --repo no hay issues que consultar: todos se crearían en backlog
  return reconcileEntries.filter(({ found }) => {
    if (!found) return true // se creará en esta corrida, y buildLabels le pone status:backlog
    // Un issue CERRADO no está pendiente de promoción: está hecho. Sin este
    // filtro, un epic terminado (issues cerrados a los que nadie devolvió el
    // label de estado) arrastraría el recordatorio para siempre en cada
    // re-groom — un aviso que no se puede satisfacer es un aviso que enseña
    // a ignorar los demás.
    if (found.state === 'closed') return false
    const names = (found.labels || []).map((l) => (typeof l === 'string' ? l : l.name))
    return resolveStatus(names).status === 'backlog'
  }).length
}
function printBacklogReminder() {
  const pending = backlogPendingCount()
  if (!pending) return
  const repoRef = typeof repo === 'string' ? repo : '<owner/repo>'
  console.error(`recordatorio: ${pending} issue(s) de este epic ${dryRun ? 'quedarían' : 'quedan'} en status:backlog — /ct-next NO despacha nada que no lleve status:ready. Promoverlos es un paso humano deliberado (es el gate del loop: decides tú qué entra en vuelo): gh issue edit <n> --repo ${repoRef} --add-label status:ready --remove-label status:backlog`)
}

if (dryRun) {
  // Los dos mensajes de F6 van por stderr, ANTES del plan: stdout tiene que
  // seguir siendo JSON puro y parseable (varios tests, y cualquier tubería
  // real, dependen de eso).
  const labelLine = labelReportLine('que se crearían')
  if (labelLine) console.error(labelLine)
  printBacklogReminder()
  console.log(JSON.stringify({ ...plan, repo: typeof repo === 'string' ? repo : null, project: projectNum }, null, 2))
  // Código de salida (F5): 3 para "divergencia detectada, no reconciliada" —
  // deliberadamente DISTINTO de 0 (spec e issues de acuerdo: silencio real,
  // nada que decidir) y de 2 (error de validación: la tabla §9 en sí es
  // inusable, nada que reportar tiene sentido). Un exit no-cero aquí sería
  // tan malo como el silencio que esta feature corrige, pero en la dirección
  // opuesta: entrenaría a cualquier script que solo mire "¿salió 2, aborta
  // todo?" a tratar una divergencia meramente informativa como si la tabla
  // §9 estuviera rota. 3 deja claro, para quien lea el código de salida en
  // vez del texto, que "no hay error, pero hay algo que revisar" es un
  // tercer estado, no una variante de "todo bien" ni de "todo roto".
  //
  // Bajo --dry-run esto vale SIEMPRE (con o sin --reconcile): dry-run nunca
  // resuelve nada de verdad, así que cualquier divergencia detectada sigue
  // sin resolver al terminar — 3 es la lectura honesta, no una consecuencia
  // accidental. --dry-run y la corrida real SIN --reconcile comparten el
  // mismo 3 ante la misma divergencia POR PARIDAD (misma condición, misma
  // señal) — NO porque encadenar `groom --dry-run && groom` deba seguir
  // funcionando: con `&&`, un 3 corta la cadena justo cuando hay divergencia
  // que --reconcile podría aplicar, así que ese encadenamiento nunca
  // llegaría a ejecutar la corrida real. Quien quiera "revisa, y si hay algo
  // que arreglar, aplícalo" tiene que comprobar el código de salida
  // explícitamente (`; if [ $? -eq 3 ]; then …`), no depender de `&&`.
  process.exit((anyUnresolvedDrift || anyOrphans) ? 3 : 0)
}

if (!repo) { console.error('--repo requerido fuera de --dry-run'); process.exit(2) }

// Project v2 + Sprint (T9): introspección en runtime, no se hardcodean IDs.
// Cada llamada de abajo se probó a mano contra un Project v2 real (sandbox)
// antes de cablearla aquí; ver task-9-report.md para las queries/mutaciones
// verificadas y sus respuestas reales.
const PROJECT_FIELDS_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on ProjectV2 {
      fields(first: 50) {
        totalCount
        nodes {
          ... on ProjectV2IterationField {
            id
            name
            configuration {
              iterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
}`

const SET_ITEM_ITERATION_MUTATION = `
mutation($project: ID!, $item: ID!, $field: ID!, $iteration: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project
    itemId: $item
    fieldId: $field
    value: { iterationId: $iteration }
  }) {
    projectV2Item { id }
  }
}`

// Se resuelve una sola vez por ejecución (no por issue): el owner/projectId/
// fieldId/iterationId vigente son los mismos para todos los slices de esta
// tanda. Si el fetch falla, o el project no tiene un campo de iteración
// llamado "Sprint", o ninguna iteración cubre la fecha de hoy, abortamos —
// mismo criterio que milestones/issues más arriba: no hay caso benigno que
// tratar como "seguir sin Sprint".
let projectMeta = null
function ensureProjectMeta() {
  if (projectMeta) return projectMeta
  // TODO: asume que el Project v2 vive bajo el mismo owner que --repo. Un
  // project de organización sobre un repo de otro owner (o viceversa)
  // necesitaría un --project-owner explícito; no cubierto todavía.
  const owner = repo.split('/')[0]
  let view
  try {
    view = JSON.parse(gh(['project', 'view', String(projectNum), '--owner', owner, '--format', 'json']))
  } catch (e) {
    console.error(`no se pudo leer el project ${project} (owner ${owner}): ${e.message}`)
    process.exit(1)
  }
  const projectId = view.id

  let fieldsRaw
  try {
    fieldsRaw = JSON.parse(gh(['api', 'graphql', '-f', `query=${PROJECT_FIELDS_QUERY}`, '-f', `id=${projectId}`]))
  } catch (e) {
    console.error(`no se pudieron leer los campos del project ${project}: ${e.message}`)
    process.exit(1)
  }
  const nodes = fieldsRaw?.data?.node?.fields?.nodes || []
  const sprintField = nodes.find((n) => n && n.name === 'Sprint')
  if (!sprintField) {
    // F18/H6 — "no vino en la respuesta" NO es "no existe". `fields(first: 50)`
    // es una lectura ACOTADA: un project con más de 50 campos puede tener su
    // campo Sprint fuera de la primera página, y el mensaje de siempre
    // afirmaría, con total aplomo, que el project no lo tiene. `totalCount`
    // (pedido en la misma query, coste cero) distingue las dos cosas.
    const totalFields = fieldsRaw?.data?.node?.fields?.totalCount
    if (Number.isInteger(totalFields) && totalFields > nodes.length) {
      console.error(`no se ha podido comprobar si el project ${project} tiene un campo de iteración "Sprint": la consulta solo trajo ${nodes.length} de sus ${totalFields} campos (lectura acotada a 50 por página). NO se afirma que no exista — no se ha visto entero. Reduce el número de campos del project, o repórtalo para que la consulta pagine.`)
      process.exit(1)
    }
    console.error(`el project ${project} no tiene un campo de iteración llamado "Sprint" — créalo antes de usar --project`)
    process.exit(1)
  }
  const today = new Date().toISOString()
  const current = pickCurrentIteration(sprintField.configuration?.iterations, today)
  if (!current) {
    console.error(`el campo Sprint del project ${project} no tiene una iteración vigente para hoy (${today.slice(0, 10)})`)
    process.exit(1)
  }
  projectMeta = { owner, projectId, fieldId: sprintField.id, iterationId: current.id, iterationTitle: current.title }
  return projectMeta
}

// añade un issue (nuevo o preexistente, identificado por su URL) al Project
// v2 y fija su Sprint a la iteración vigente. Se llama tanto para issues
// creados en esta corrida como, más abajo, para issues preexistentes a los
// que les falte el item de project (ver hasProjectItem): el alta del issue y
// el alta en el project son dos llamadas de red desacopladas (a diferencia
// de las labels, que van dentro de `gh issue create` y no pueden quedar a
// medias), así que una interrupción entre ambas dejaría el issue fuera del
// project para siempre si no se re-comprobara en cada corrida.
function addToProjectWithSprint(issueUrl, order) {
  const meta = ensureProjectMeta()
  let item
  try {
    item = JSON.parse(gh(['project', 'item-add', String(projectNum), '--owner', meta.owner, '--url', issueUrl, '--format', 'json']))
  } catch (e) {
    console.error(`no se pudo añadir el issue orden #${order} al project ${project}: ${e.message}`)
    process.exit(1)
  }
  try {
    gh(['api', 'graphql', '-f', `query=${SET_ITEM_ITERATION_MUTATION}`,
      '-f', `project=${meta.projectId}`, '-f', `item=${item.id}`,
      '-f', `field=${meta.fieldId}`, '-f', `iteration=${meta.iterationId}`])
  } catch (e) {
    console.error(`no se pudo fijar el Sprint del issue orden #${order} en el project ${project}: ${e.message}`)
    process.exit(1)
  }
  console.log(`issue orden #${order} añadido al project ${project}, sprint=${meta.iterationTitle}`)
}

// ============================================================================
// F15/H2 — TODA LA VALIDACIÓN DEL PROJECT, ANTES DE LA PRIMERA MUTACIÓN.
//
// `ensureProjectMeta()` es perezosa: se resolvía en la PRIMERA llamada a
// `addToProjectWithSprint`, o en el listado de items de más abajo. Con el
// listado colocado después del milestone y de las labels, un abort por "el
// project no tiene un campo Sprint" o "ninguna iteración cubre hoy" ocurría
// con el milestone YA CREADO y las labels YA CREADAS. Verificado por
// construcción contra el código sin arreglar, con un stub de `gh` que registra
// el argv de cada llamada: el log salía
//   api .../milestones --method GET …   (listado)
//   api .../milestones -f title=Epic    (CREACIÓN)
//   label create type:backend …         (CREACIÓN ×4)
//   project view 5 --owner o …          (aquí falla y aborta)
// y el stdout ya decía "milestone creado: Epic (#1)". O sea: la basura a
// medias que la documentación ni prometía ni desmentía era REAL.
//
// Se adelanta ENTERO el bloque de project (validación + listado de items) por
// delante del milestone. Los dos son lecturas, y las dos abortan con exit 1:
// dejarlas donde estaban significaba que cualquier fallo de project —incluido
// un rate limit al listar items— pagaba el mismo precio.
//
// LA GARANTÍA QUE ESTO CREA, y que ahora sí se puede escribir en el contrato:
// todo lo que /ct-groom LEE ocurre antes de todo lo que /ct-groom ESCRIBE. Si
// aborta por validación (tabla §9, spec, repo, milestone ilegible, project sin
// Sprint, iteración vencida), no ha creado nada. Lo que NO se promete: una vez
// empieza a escribir no hay transacción — un fallo a mitad deja lo ya creado,
// y de eso se sale volviendo a correr, que es idempotente por construcción
// (milestone por título, labels solo las que faltan, issues por marcador
// `ct-order`).
// ============================================================================
// Items ya presentes en el Project v2 — se listan una sola vez por corrida
// (igual que milestones/existingIssues abajo) para poder detectar issues
// preexistentes a los que, por una interrupción previa, les falte el item
// de project (ver hasProjectItem en project-fields.js).
//
// F18/H6 — ESTE ERA EL ÚLTIMO TOPE FIJO SIN DETECCIÓN DE TRUNCADO DEL PLUGIN,
// Y LA LECCIÓN YA ESTABA ESCRITA AL LADO. `ct-next.mjs#loadIssues` explica que
// no se usa `gh issue list --limit N` porque "un `--limit` fijo deja fuera
// justo los issues VIEJOS", y unas líneas más abajo, en este mismo fichero, la
// enumeración de issues dice que un tope fijo "reintroduciría el mismo fallo
// por truncado". Aquí, en cambio, el tope se había SUBIDO de 30 a 200 —
// alejando la trampa en vez de quitarla— y `existingProjectItems` se trataba
// como completo pasara lo que pasara.
//
// La consecuencia no es un mensaje pobre: `hasProjectItem` (project-fields.js)
// devuelve `false` para items que SÍ existen, así que /ct-groom vuelve a
// añadirlos y el Project acaba con DUPLICADOS, en silencio.
//
// Se arregla sin paginar y sin llamadas de más en el caso normal: `gh project
// item-list --format json` devuelve `{items, totalCount}` (verificado contra
// gh 2.86 sobre un project real: `--limit 2` sobre 3 items devolvió
// `items.length = 2, totalCount = 3`). Si el tope recortó, se repite la
// consulta pidiendo exactamente lo que el propio GitHub dice que hay. Si aun
// así viene corta, se ABORTA: seguir significaría duplicar items, y ése es
// justo el daño que este bloque existe para evitar. Y si `totalCount` no
// viene (una versión de gh que no lo exponga), se avisa de que el truncado no
// se ha podido descartar — nunca se da por bueno en silencio.
const PROJECT_ITEMS_PAGE = 200
let existingProjectItems = []
if (projectNum) {
  ensureProjectMeta()
  const listItems = (limit) => JSON.parse(gh(['project', 'item-list', String(projectNum), '--owner', projectMeta.owner, '--limit', String(limit), '--format', 'json']))
  try {
    let itemsRaw = listItems(PROJECT_ITEMS_PAGE)
    let total = itemsRaw.totalCount
    if (Number.isInteger(total) && (itemsRaw.items || []).length < total) {
      itemsRaw = listItems(total)
      total = Number.isInteger(itemsRaw.totalCount) ? itemsRaw.totalCount : total
      if ((itemsRaw.items || []).length < total) {
        console.error(`el project ${project} tiene ${total} items y solo se han podido leer ${(itemsRaw.items || []).length}: /ct-groom NO continúa. Con una lista incompleta, los items que no vinieron se tratarían como inexistentes y se volverían a añadir — duplicados en el Project, en silencio.`)
        process.exit(1)
      }
    } else if (!Number.isInteger(total)) {
      console.error(`aviso: esta versión de \`gh project item-list\` no devuelve \`totalCount\`, así que NO se ha podido descartar que la lista de items del project ${project} venga truncada en ${PROJECT_ITEMS_PAGE}. Si el project tiene más items que eso, los que falten se tratarán como inexistentes y se añadirán otra vez (duplicados).`)
    }
    existingProjectItems = itemsRaw.items || []
  } catch (e) {
    console.error(`no se pudieron listar los items del project ${project}: ${e.message}`)
    process.exit(1)
  }
}

// milestone idempotente — el filtrado por título se hace en JS, no dentro de un
// filtro jq: un título con `"` o `\` rompería el programa jq si se interpolara
// ahí. Traemos la lista completa (paginada, todos los estados: el endpoint
// filtra a "open" por defecto y un milestone cerrado con el mismo título
// causaría un duplicado) y comparamos en memoria. Si el fetch falla (auth,
// red, rate limit) abortamos — NO lo tratamos como "no existe", o
// terminaríamos creando un milestone duplicado.
let allMilestones
try {
  allMilestones = JSON.parse(gh(['api', `repos/${repo}/milestones`, '--method', 'GET', '-f', 'state=all', '--paginate']))
} catch (e) {
  console.error(`no se pudo listar milestones de ${repo}: ${e.message}`)
  process.exit(1)
}
let msNumber = allMilestones.find((m) => m.title === milestone)?.number
if (!msNumber) {
  const created = JSON.parse(gh(['api', `repos/${repo}/milestones`, '-f', `title=${milestone}`]))
  msNumber = created.number
  console.log(`milestone creado: ${milestone} (#${msNumber})`)
} else console.log(`milestone ya existe: ${milestone} (#${msNumber})`)

// labels que falten. Cualquier fallo de gh aquí es real (auth, red, rate
// limit) y debe abortar el script en vez de dejar issues sin sus labels.
//
// F6 (menor 5): solo se crean las que el repo NO tiene ya (`newLabels`,
// calculado arriba contra el listado real de labels). Antes se llamaba a `gh
// label create --force` para TODAS en cada corrida — y `--force` sobre una
// label existente la reescribe con el color/descripción por defecto de gh, así
// que un groom podía cambiarle el color a labels del repo que nadie le pidió
// tocar. Se conserva `--force` en la creación por si otra corrida la creó
// entre el listado y esta llamada (carrera benigna): con --force eso no es un
// error, sin él abortaría la corrida entera.
for (const l of newLabels) {
  gh(['label', 'create', l, '--repo', repo, '--force'])
}
{
  // El reporte va DESPUÉS de crearlas: decir "creadas" antes de que `gh` las
  // haya creado de verdad sería afirmar algo que un fallo posterior
  // desmentiría.
  const line = labelReportLine('creadas')
  if (line) console.error(line)
}

// issues idempotentes por marcador ct-order. NO usamos `gh issue list --search`:
// la búsqueda de GitHub tokeniza por espacios y trata un `-` inicial como
// cualificador de exclusión, así que el marcador `<!-- ct-order:N -->` no hace
// matching de substring fiable, y el índice de búsqueda tiene latencia para
// issues recién creados (falso negativo → duplicado; falso positivo → un
// slice que debía crearse se salta en silencio). En su lugar, enumeramos TODOS
// los issues, con paginación real (`--paginate`, sin tope de `--limit`) sobre
// el endpoint REST — un `--limit` fijo dejaría fuera issues antiguos con
// marcador en un repo grande, reintroduciendo el mismo fallo por truncado en
// vez de por latencia. Ese endpoint también devuelve pull requests y, sin
// `--slurp`, `--paginate` concatenaría varios documentos JSON sueltos que
// romperían el `JSON.parse`; ver scripts/gh-issues.js para el detalle y los
// tests puros de ese filtrado/aplanado. Comparamos el marcador como substring
// literal del body en JS — mismo patrón que el fix de milestones. Un fallo
// del fetch aborta. F5: este fetch (y el cómputo de `reconcileEntries`) ya se
// hizo MÁS ARRIBA, antes de la rama de --dry-run — no se repite aquí, solo se
// reutiliza `existingIssues`/`reconcileEntries`.

for (const { iss, found, diff, bodyResult } of reconcileEntries) {
  if (found) {
    console.log(`issue orden #${iss.order} ya existe (#${found.number}), no se duplica`)
    // F5: la detección de divergencia (y su reporte por stderr, incluido el
    // aviso de "gap" si --reconcile no puede aplicar algo) ya ocurrió ANTES
    // de la rama de --dry-run, así que es idéntica en preview y en corrida
    // real — aquí solo queda, opcionalmente, APLICAR lo que sí se puede.
    // Mismo criterio que el preview de --dry-run, y por el mismo motivo: la
    // pregunta "¿hay algo que escribir?" (`bodyResult.body !== null`) es
    // distinta de "¿esto cuenta para el exit code?" (`hasDrift`, que excluye
    // el contexto del epic a propósito — §4.4). Con una sola de las dos, una
    // corrida cuya única divergencia era esa sección calculaba el body nuevo,
    // lo tiraba, salía 0 y aun así informaba de que se había reescrito.
    if (reconcileFlag && (hasDrift(diff) || bodyResult.body !== null)) {
      const fieldArgs = buildReconcileEditArgs(diff) // título/milestone/labels, vía flags (el enlace al spec vive en bodyResult.body, ver abajo — es un splice de una línea, no un flag)
      const allArgs = bodyResult.body !== null ? [...fieldArgs, '--body', bodyResult.body] : fieldArgs
      // allArgs solo puede quedar vacío aquí si no hay body nuevo que escribir
      // y NADA de lo divergente se pudo traducir a una mutación real — hoy,
      // únicamente cuando la ÚNICA divergencia es de AC/Dependencias y su
      // sección no se pudo localizar (gaps.ac/gaps.deps, ver el aviso ya
      // impreso arriba). No hay ninguna llamada a `gh` que hacer en ese caso.
      if (allArgs.length > 0) {
        // Mismo criterio que el resto de mutaciones de este fichero (labels,
        // milestone, project): un fallo de `gh` aquí NUNCA es benigno — auth,
        // red, rate limit, o el issue cerrado rechazando el edit por alguna
        // razón que no podemos anticipar. Abortamos con mensaje claro en vez
        // de seguir a ciegas con el resto de slices, que podría dejar
        // reconciliados solo ALGUNOS issues sin que quede constancia clara de
        // cuáles.
        try {
          gh(['issue', 'edit', String(found.number), '--repo', repo, ...allArgs])
        } catch (e) {
          console.error(`no se pudo reconciliar el issue #${found.number} (orden #${iss.order}): ${e.message}`)
          process.exit(1)
        }
        // El --body reconciliado no se imprime entero (puede ser un bloque de
        // texto largo) — se nombra por categoría, igual que el preview de
        // --dry-run, y con la MISMA lista: lo que se ha escrito, no lo que
        // diverge. Una categoría cuya sección no se pudo localizar ya se
        // reporta como `nota:` por stderr; nombrarla aquí sería contradecirse.
        console.log(`issue #${found.number} reconciliado (orden #${iss.order}): ${appliedCategories(diff, bodyResult).join(', ')}`)
      }
    }
    if (projectNum && !hasProjectItem(existingProjectItems, repo, found.number)) {
      console.log(`issue #${found.number} no estaba en el project ${project} (hueco de una corrida anterior interrumpida) — añadiéndolo ahora`)
      addToProjectWithSprint(`https://github.com/${repo}/issues/${found.number}`, iss.order)
    }
    continue
  }
  const num = gh(['issue', 'create', '--repo', repo, '--title', iss.title, '--body', iss.body,
    '--milestone', milestone, ...iss.labels.flatMap((l) => ['--label', l])])
  console.log(`issue creado orden #${iss.order}: ${num}`)
  // F23: se empuja a `inEpic` porque es la lista contra la que empareja el
  // marcador. Hoy este registro NO tiene lectores: `findByMarker` se invoca
  // una sola vez (arriba), dentro del `plan.issues.map` que construye
  // `reconcileEntries` de una vez, mucho antes de este bucle. Se conserva por
  // coherencia con esa lista, no porque proteja de nada: un orden duplicado en
  // la tabla §9 ya lo corta groom.js#findDuplicateOrders antes de llegar aquí.
  inEpic.push({ number: null, body: iss.body })
  if (projectNum) addToProjectWithSprint(num, iss.order)
}

// F6, grave 2: lo último que se lee tras una corrida real es qué falta para
// que esto sea despachable — ver printBacklogReminder más arriba.
printBacklogReminder()

// F5: código de salida de la corrida real — mismo criterio de 3 estados que
// bajo --dry-run (ver el comentario junto al `process.exit` de esa rama):
// - sin --reconcile: 3 si `anyUnresolvedDrift` (cualquier categoría) o
//   `anyOrphans` seguía en pie, 0 si no.
// - con --reconcile: cualquier fallo de `gh issue edit` ya abortó con
//   exit(1) más arriba (nunca se sigue a ciegas), así que llegar hasta aquí
//   significa que título/milestone/enlace-al-spec/labels/deps/ac se
//   aplicaron con éxito donde divergían Y donde se pudieron localizar. Lo
//   único que puede seguir sin resolver es: (a) un gap real de AC/deps
//   (`anyReconcileGapRemains` — Critical 2, el aviso de arriba ya explicó
//   por qué) o (b) un issue huérfano (`anyOrphans` — --reconcile no los
//   toca, no hay "spec" con el que reconciliarlos). Descripción/Protegido
//   NUNCA aparecen aquí (ver hasDrift/reconcileGaps): anclar el exit code a
//   prosa que se edita de forma rutinaria dejaría el proceso en 3 para
//   siempre sin ningún --reconcile capaz de resolverlo (review round 3,
//   punto 6).
process.exit(((reconcileFlag ? anyReconcileGapRemains : anyUnresolvedDrift) || anyOrphans) ? 3 : 0)
