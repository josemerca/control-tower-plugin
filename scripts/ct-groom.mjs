#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { analyzeSlicesTable, isNoValueCell } from './slices.js'
import { groomPlan } from './groom.js'
import { flattenIssuePages, realIssuesOnly, findByMarker } from './gh-issues.js'
import { pickCurrentIteration, hasProjectItem } from './project-fields.js'
// F5: capa pura de reconciliación — decide QUÉ cuenta como divergencia entre
// un issue existente y lo que el plan produce hoy, CÓMO se reporta, y CÓMO
// se traduce a los flags de `gh issue edit` para aplicarla. Ver
// scripts/reconcile.js para la justificación completa de cada decisión (qué
// se compara, qué se excluye a propósito, y por qué).
import { diffIssue, hasDrift, formatDrift, buildReconcileEditArgs, buildReconcileBody } from './reconcile.js'
// ADDENDA (F3): única fuente de verdad de qué valores de "Tipo" tienen un
// addendum de kickoff — ver el aviso de "Tipo" no reconocido más abajo.
import { ADDENDA } from './kickoff.js'

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
if (!specFile || specFile.startsWith('--')) { console.error('uso: ct-groom.mjs <spec> --repo <o/r> [--milestone t] [--project n] [--section 9] [--dry-run]'); process.exit(2) }
const repo = arg('--repo')
const milestone = arg('--milestone', 'Epic')
const section = arg('--section', '9')
const project = arg('--project')
const dryRun = has('--dry-run')
// F5: opt-in, NUNCA por defecto — un issue existente puede haber sido
// editado a propósito, llevar discusión, o estar cerrado; el comportamiento
// por defecto es detectar y reportar divergencia, nunca tocar nada sin que
// se pida explícitamente (ver el bloque de reconciliación más abajo).
const reconcileFlag = has('--reconcile')

// Validación explícita: con el `arg()` endurecido de arriba, un `--milestone`
// colgante (último token, o seguido de otro flag) devuelve `true` en vez de
// colar el flag siguiente como valor — pero sigue siendo responsabilidad del
// call-site rechazarlo en vez de dejarlo fluir hacia `gh` como si fuera un
// título de milestone real.
if (milestone === true || typeof milestone !== 'string' || milestone.length === 0) {
  console.error(`--milestone requiere un valor: recibido "${milestone === true ? '(sin valor)' : milestone}"`)
  process.exit(2)
}
// Mismo criterio para --project: si se pasó el flag pero sin valor numérico
// real, abortamos en vez de dejar que `Number(true) === 1` decida en
// silencio contra qué Project v2 operar.
if (project !== undefined && (project === true || !Number.isFinite(Number(project)) || Number(project) <= 0)) {
  console.error(`--project inválido: "${project === true ? '(sin valor)' : project}" — debe ser un entero positivo`)
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
    console.error(`aviso: valor "${s.type}" en columna Tipo (slice #${s.n}) no es ninguno de los tipos reconocidos por el dispatcher (${KNOWN_TYPES.join(', ')}) — el agente despachado para este slice no recibirá ningún addendum de tipo (ver scripts/kickoff.js#ADDENDA); revisa si es un error tipográfico o si falta añadir su addendum`)
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

const slices = report.slices
// groomPlan lanza si hay órdenes de slice duplicados en la tabla §9 (T14/W-A):
// se captura aquí y se reporta con la misma convención que el resto de errores
// de validación de este wrapper (spec inexistente, --milestone/--project/
// --repo inválidos) — mensaje limpio por console.error + exit(2), nunca el
// stack trace crudo de una excepción sin capturar.
let plan
try {
  plan = groomPlan(slices, { milestone, specPath: specFile, specSection: section })
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
// driftCategories: lista qué categorías APLICABLES divergen (título/
// milestone/labels/deps/ac) — Descripción/Protegido a propósito NO
// aparecen aquí: --reconcile nunca las toca (ver buildReconcileBody en
// scripts/reconcile.js), así que no pertenecen a "lo que se aplicaría". Se
// usa solo para mensajes dirigidos a un humano (dry-run preview, log de
// "reconciliado") — nunca para decidir qué llamar de verdad; eso lo deciden
// buildReconcileEditArgs/buildReconcileBody directamente.
function driftCategories(diff) {
  const cats = []
  if (diff.title) cats.push('título')
  if (diff.milestone) cats.push('milestone')
  if (diff.labels.missing.length || diff.labels.extra.length) cats.push('labels')
  if (diff.deps.missing.length || diff.deps.extra.length) cats.push('dependencias')
  if (diff.ac.missing.length || diff.ac.extra.length) cats.push('criterios de aceptación')
  return cats
}

let existingIssues = null
let reconcileEntries = [] // [{ iss, found, diff }] — found/diff son null si el issue todavía no existe
let anyUnresolvedDrift = false
// anyProseOnlyDrift: descripcionDiffers/protectedDiffers de CUALQUIER
// entrada — --reconcile nunca las resuelve (son prosa, ver
// scripts/reconcile.js#diffIssue), así que son la ÚNICA divergencia que
// puede seguir en pie después de una corrida con --reconcile con éxito.
// Se usa para el código de salida de la corrida real (más abajo).
let anyProseOnlyDrift = false
if (typeof repo === 'string') {
  try {
    const raw = JSON.parse(gh(['api', `repos/${repo}/issues`, '--method', 'GET', '-f', 'state=all', '--paginate', '--slurp']))
    existingIssues = realIssuesOnly(flattenIssuePages(raw))
  } catch (e) {
    console.error(`no se pudo listar issues de ${repo}: ${e.message}`)
    process.exit(1)
  }
  reconcileEntries = plan.issues.map((iss) => {
    const marker = `<!-- ct-order:${iss.order} -->`
    const found = findByMarker(existingIssues, marker)
    if (!found) return { iss, found: null, diff: null }
    return { iss, found, diff: diffIssue(found, iss, plan.milestone, ownedLabelPrefixes) }
  })
  // El reporte de divergencia se imprime SIEMPRE por stderr (mismo canal que
  // el resto de "aviso:" de este script) en cuanto se conoce — antes de la
  // rama de --dry-run, para que sea IDÉNTICO en preview y en corrida real.
  // Silencio aquí significa "spec e issues están de acuerdo": formatDrift
  // devuelve [] cuando no hay nada que reportar (ver scripts/reconcile.js).
  for (const { found, diff } of reconcileEntries) {
    if (!found) continue
    for (const line of formatDrift(diff)) console.error(line)
    if (hasDrift(diff)) anyUnresolvedDrift = true
    if (diff.descripcionDiffers || diff.protectedDiffers) anyProseOnlyDrift = true
  }
  // --reconcile bajo --dry-run: NUNCA muta (ni aquí ni en la rama real de más
  // abajo) — solo hace explícito qué aplicaría una corrida real con
  // --reconcile, para que el preview no calle información que sí actuaría.
  // El --body reconciliado (si deps/ac divergen) NO se imprime entero — sería
  // un bloque de texto largo — se nombra por categoría, igual que el resto
  // de mensajes dirigidos a un humano de este bloque.
  if (reconcileFlag && dryRun) {
    for (const { found, diff } of reconcileEntries) {
      if (!found || !hasDrift(diff)) continue
      const fieldArgs = buildReconcileEditArgs(diff)
      const bodyChanges = diff.deps.missing.length || diff.deps.extra.length || diff.ac.missing.length || diff.ac.extra.length
      if (fieldArgs.length || bodyChanges) {
        const bodyNote = bodyChanges ? ' --body <actualizado: dependencias/criterios de aceptación>' : ''
        console.error(`--reconcile aplicaría: gh issue edit ${found.number} --repo ${repo} ${fieldArgs.join(' ')}${bodyNote}`.trim())
      }
      if (diff.descripcionDiffers || diff.protectedDiffers) {
        console.error(`--reconcile NO aplicaría la divergencia de prosa del issue #${found.number} (slice #${diff.order}) — Descripción/Protegido se editan a mano, nunca vía --reconcile`)
      }
    }
  }
}

if (dryRun) {
  console.log(JSON.stringify({ ...plan, repo: typeof repo === 'string' ? repo : null, project: project ? Number(project) : null }, null, 2))
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
  // accidental. Es DELIBERADO que --dry-run y la corrida real sin
  // --reconcile compartan el mismo 3 ante la misma divergencia: si
  // difirieran, un script que encadenara `groom --dry-run && groom` para
  // "revisar antes de aplicar" recibiría una señal distinta en cada paso
  // ante la MISMA condición, lo que sería más confuso que útil.
  process.exit(anyUnresolvedDrift ? 3 : 0)
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
    view = JSON.parse(gh(['project', 'view', String(project), '--owner', owner, '--format', 'json']))
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
    item = JSON.parse(gh(['project', 'item-add', String(project), '--owner', meta.owner, '--url', issueUrl, '--format', 'json']))
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

// labels que falten. Con --force, "ya existe" no es un error para gh (lo
// actualiza), así que no hay caso benigno que capturar aquí: cualquier fallo
// es real (auth, red, rate limit) y debe abortar el script en vez de dejar
// issues sin sus labels.
const wantedLabels = [...new Set(plan.issues.flatMap((i) => i.labels))]
for (const l of wantedLabels) {
  gh(['label', 'create', l, '--repo', repo, '--force'])
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

// Items ya presentes en el Project v2 — se listan una sola vez por corrida
// (igual que milestones/existingIssues arriba) para poder detectar issues
// preexistentes a los que, por una interrupción previa, les falte el item
// de project (ver hasProjectItem en project-fields.js). --limit alto: el
// default de `gh project item-list` es 30, insuficiente en un sandbox/epic
// con más slices que eso.
let existingProjectItems = []
if (project) {
  ensureProjectMeta()
  try {
    const itemsRaw = JSON.parse(gh(['project', 'item-list', String(project), '--owner', projectMeta.owner, '--limit', '200', '--format', 'json']))
    existingProjectItems = itemsRaw.items || []
  } catch (e) {
    console.error(`no se pudieron listar los items del project ${project}: ${e.message}`)
    process.exit(1)
  }
}

for (const { iss, found, diff } of reconcileEntries) {
  if (found) {
    console.log(`issue orden #${iss.order} ya existe (#${found.number}), no se duplica`)
    // F5: la detección de divergencia (y su reporte por stderr) ya ocurrió
    // ANTES de la rama de --dry-run, así que es idéntica en preview y en
    // corrida real — aquí solo queda, opcionalmente, APLICARLA.
    if (reconcileFlag && hasDrift(diff)) {
      const fieldArgs = buildReconcileEditArgs(diff) // título/milestone/labels, vía flags
      const newBody = buildReconcileBody(found.body, iss) // AC/Dependencias, vía splice del body — null si no cambia nada
      const allArgs = newBody !== null ? [...fieldArgs, '--body', newBody] : fieldArgs
      if (allArgs.length === 0) {
        // La ÚNICA divergencia de este issue es de prosa (Descripción/
        // Protegido) — --reconcile deliberadamente no la toca (ver
        // scripts/reconcile.js#diffIssue): un splice de texto libre no puede
        // garantizar que no se pierda una elaboración legítima que un humano
        // haya añadido dentro de esa misma sección. No hay ninguna llamada a
        // `gh` que hacer aquí; esta divergencia queda sin resolver a
        // propósito (ver el código de salida al final del fichero).
        console.error(`aviso: slice #${iss.order} (issue #${found.number}) diverge solo en prosa (Descripción/Protegido) — --reconcile no la aplica, edítala a mano en GitHub`)
      } else {
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
        // --dry-run.
        console.log(`issue #${found.number} reconciliado (orden #${iss.order}): ${driftCategories(diff).join(', ')}`)
      }
    }
    if (project && !hasProjectItem(existingProjectItems, repo, found.number)) {
      console.log(`issue #${found.number} no estaba en el project ${project} (hueco de una corrida anterior interrumpida) — añadiéndolo ahora`)
      addToProjectWithSprint(`https://github.com/${repo}/issues/${found.number}`, iss.order)
    }
    continue
  }
  const num = gh(['issue', 'create', '--repo', repo, '--title', iss.title, '--body', iss.body,
    '--milestone', milestone, ...iss.labels.flatMap((l) => ['--label', l])])
  console.log(`issue creado orden #${iss.order}: ${num}`)
  // registra el issue recién creado en la lista en memoria: si dos slices de
  // esta misma ejecución compartieran marcador (no debería pasar, pero así la
  // comprobación de arriba sigue siendo correcta dentro de la misma corrida)
  existingIssues.push({ number: null, body: iss.body })
  if (project) addToProjectWithSprint(num, iss.order)
}

// F5: código de salida de la corrida real — mismo criterio de 3 estados que
// bajo --dry-run (ver el comentario junto al `process.exit` de esa rama):
// - sin --reconcile: 3 si `anyUnresolvedDrift` (cualquier categoría) seguía
//   en pie, 0 si no.
// - con --reconcile: cualquier fallo de `gh issue edit` ya abortó con
//   exit(1) más arriba (nunca se sigue a ciegas), así que llegar hasta aquí
//   significa que título/milestone/labels/deps/ac se aplicaron con éxito
//   donde divergían. Lo ÚNICO que puede seguir sin resolver es la prosa
//   (Descripción/Protegido) — --reconcile nunca la toca a propósito (ver
//   scripts/reconcile.js#diffIssue) — así que `anyProseOnlyDrift` decide el
//   código de salida en este caso: 3 si queda prosa divergente sin aplicar
//   (el aviso de arriba ya explicó por qué), 0 si no queda nada.
process.exit((reconcileFlag ? anyProseOnlyDrift : anyUnresolvedDrift) ? 3 : 0)
