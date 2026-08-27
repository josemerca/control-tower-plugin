// ============================================================================
// RUN-METRICS — una fila por INTENTO DE UN PASO DE UNA TAREA.
//
// La granularidad más fina que el programa ya conoce sin esfuerzo. Agregar
// hacia arriba —por tarea, por plan, por epic— es una suma; deshacer una
// agregación no es nada, así que se guarda lo fino y se suma al leer.
//
// Módulo PURO: compone la fila y decide dónde va. No escribe. Quien escribe es
// `ct-step.mjs`, y lo hace tragándose la excepción a propósito (ver más abajo).
//
// ---------------------------------------------------------------------------
// LOS CAMPOS DE IDENTIDAD QUE NO SON OBVIOS
//
// `plan_sha256`. El plan se llama `…/YYYY-MM-DD-issue-<n>-<slug>.md` y ese
// `issue-<n>-` es exactamente cómo lo encuentra el gate de `--release`: el
// número del issue ES la identidad del plan padre y no hay que inventar
// ninguna. Lo que no cubre es que un plan SE REESCRIBE —tras el gate, o tras un
// rechazo en revisión—, y entonces dos runs contra dos versiones del mismo
// fichero son indistinguibles justo donde más se van a mirar: el antes y el
// después de cambiar un plan. El hash del contenido es además el idioma que el
// repo ya usa para esta misma clase de problema (`SLICES_PRISTINE_HASHES`).
//
// `attempt`. Es una DIMENSIÓN de la fila, no un contador agregado. Sin él no se
// puede medir cuántas veces vetó el juez ni cuántas vueltas costó cada tarea, y
// ése es justamente el dato que decide si este experimento merece la pena.
// `agentic-skills` lo resuelve con contadores por slice cerrada porque allí la
// unidad es la slice; aquí la unidad es la tarea, así que la fila por intento
// sale gratis del contador que la máquina ya lleva.
//
// `plugin_version`. El mismo argumento de `plan_sha256`, aplicado al LOOP en vez
// de al plan: un `ct-step` reescrito hace incomparables dos runs. Y se reescribe
// más que ningún plan —cada vuelta de este experimento lo toca—, así que sin la
// versión del plugin dos filas de dos loops distintos se agregan como si
// midieran el mismo mecanismo, y la mejora (o el empeoramiento) que las separa
// se lee como ruido. La corrida de campo que motiva este campo se hizo con la
// 0.36.1; sin el campo, esa cifra sólo vive en la memoria de quien estaba
// delante.
//
// `actor`. Hoy da igual y VA A DEJAR DE DAR IGUAL. Cada fila vive en el disco de
// quien la escribió, así que el actor es implícito y redundante; en cuanto las
// filas viajen dentro de la pull request, en un mismo fichero se mezclarán filas
// de dos máquinas distintas y sin actor no se sabe de quién es el coste — que es
// el dato por el que se abre este fichero.
//
// ---------------------------------------------------------------------------
// UN CAMPO QUE SE FUE: `session`. Estuvo en la lista valiendo `null` en TODAS
// las filas, porque con `ct-step` las llamadas al modelo son subagentes de la
// sesión y no hay identificador de conversación que recoger — su único escritor
// se lo pasaba `null` a pelo. Una columna que siempre es nula no es un dato
// pendiente: es un entrenamiento para que quien lee el fichero aprenda a
// saltarse columnas, y la de al lado se salta detrás. Vuelve el día que las
// llamadas headless devuelvan un identificador que meter dentro; añadir un campo
// a esta lista cuesta una línea, y prometer una dimensión que el mecanismo no
// puede dar cuesta la confianza en el resto de la fila.
//
// ---------------------------------------------------------------------------
// Y LA AUSENCIA SE DECLARA, NO SE RELLENA: un issue sin milestone se anota
// `(sin milestone)` con la constante que ya existe, nunca vacío. Es la misma
// regla que impidió que `ct-next` asumiera `main` en silencio cuando no conocía
// la base — un hueco en una métrica se lee como un cero, y un cero es una
// afirmación.
//
// Los dos campos nuevos siguen esa regla con centinela propio y no con `null`, y
// el motivo es que por ellos se AGRUPA: preguntar «cuánto costó con la 0.36.1» o
// «cuánto lleva gastado este actor» sobre una columna con nulos funde en un
// mismo grupo las filas que no traían el dato con las que lo traían vacío. El
// centinela mantiene el tipo de la columna y dice en voz alta que ahí no hubo
// dato.
// ============================================================================

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NO_MILESTONE_KEY } from './gh-issue-map.js'

// Los campos de identidad del §10.1 del spec, en orden: dónde y contra qué
// (repo, epic, issue, plan y su hash), qué paso (tarea, paso, intento) y con qué
// maquinaria y de quién (versión del plugin, actor). `session` no está: ver la
// cabecera.
export const IDENTITY_FIELDS = Object.freeze([
  'repo', 'epic', 'issue', 'plan', 'plan_sha256',
  'task', 'task_name', 'tasks_total', 'step', 'attempt',
  'plugin_version', 'actor',
])

// Los centinelas de ausencia de los dos campos por los que se agrupa. Se
// exportan para que quien escriba filas o las lea no vuelva a teclear la cadena:
// un centinela mal copiado parte la columna en dos grupos que nadie sabe que son
// el mismo.
export const NO_VERSION_KEY = '(sin versión)'
export const NO_ACTOR_KEY = '(sin actor)'

export const planSha256 = (texto) => createHash('sha256').update(String(texto ?? ''), 'utf8').digest('hex')

// EL DESTINO DE MÁQUINA, que ya no es el único. Aquí va el acumulado de esta
// cuenta —todos los repos, todos los epics—, bajo CLAUDE_CONFIG_DIR cuando lo
// hay, que es donde vive el resto de su estado.
//
// El motivo de que fuera el único era "que ningún `git add` de la slice se lleve
// la telemetría dentro de la pull request". El motivo sigue siendo bueno; la
// conclusión, no: la primera corrida en un repo ajeno dejó las filas en el disco
// de quien despachó y en ningún otro sitio, mientras el veredicto del mismo run
// sí viajaba. Así que `ct-step` escribe además una copia DENTRO del repo y la
// stagea él, después de los controles. Lo que el motivo prohibía era que la
// arrastrase un `git add` del implementador, no que viajara.
// La carpeta, aparte de la fila: desde esta ronda hay un segundo inquilino que
// no es telemetría —el log del vigilante del `-OK`, que corre desprendido y sin
// él sería indepurable— y las dos cosas van al mismo sitio por el mismo motivo.
// Se extrae en vez de duplicar el `join`, y `metricsPath` sigue siendo quien
// decide la extensión de LO SUYO.
export function controlTowerDir({ configDir = null, home = null } = {}) {
  return join(configDir || join(home || homedir(), '.claude'), 'control-tower')
}

// `log/` es UN inquilino de la carpeta, no la carpeta. Desde F38 hay un segundo
// que no es un rastro sino ESTADO —el compromiso del go (go-registry.js)—, y
// mezclarlo con los logs haría que «borra el log, que ocupa» dejara sin liberar
// un slice en vuelo. Se separa en el nivel de arriba, y por eso el `join` de la
// raíz se extrae en vez de duplicarse.
export function controlTowerLogDir(opts = {}) {
  return join(controlTowerDir(opts), 'log')
}

export function metricsPath(concepto, { configDir = null, home = null } = {}) {
  return join(controlTowerLogDir({ configDir, home }), `${concepto}.jsonl`)
}

// LA RUTA DENTRO DEL REPO, en una sola constante y no en dos: la escribe
// `ct-step commit` y la lee `/ct-harvest`. Copiada a mano en los dos sitios,
// un renombrado deja al lector mirando un directorio que ya no existe y el
// informe dice «sin telemetría» de un epic que sí la tiene — el mismo hueco
// leído como un cero contra el que existe el resto de este fichero. En POSIX
// a propósito (no `join`): es a la vez pathspec de `git add` y ruta de la API
// de contenidos de GitHub, y las dos hablan con barras hacia delante.
export const METRICS_REPO_DIR = 'docs/superpowers/metrics'
export const metricsRepoRelPath = (issue) => `${METRICS_REPO_DIR}/issue-${issue}.jsonl`

// La fila. `measures` son las medidas del paso —el estado de los controles con
// la ruta de su log, el veredicto con su conteo por severidad, coste, turnos y
// duración de la llamada, el tamaño del diff juzgado— y viajan aparte de la
// identidad para que añadir una medida nueva no pueda romper una clave.
export function metricRow(identity, measures = {}, { now }) {
  const fila = {}
  for (const campo of IDENTITY_FIELDS) fila[campo] = normalizar(campo, identity[campo])
  fila.written_at = now
  return { ...fila, ...measures }
}

// El vacío se trata como la ausencia en los tres campos con centinela (`valor ||`
// y no `??`): un `epic: ''`, una versión que salió vacía de leer el manifiesto o
// un actor que el entorno no supo dar son el mismo hueco que no traerlos, y
// distinguirlos crearía un grupo fantasma con nombre de cadena vacía.
function normalizar(campo, valor) {
  if (campo === 'epic') return valor || NO_MILESTONE_KEY
  if (campo === 'plugin_version') return valor || NO_VERSION_KEY
  if (campo === 'actor') return valor || NO_ACTOR_KEY
  if (valor === undefined) return null
  return valor
}

export const metricLine = (fila) => JSON.stringify(fila) + '\n'

// ¿Cita este `evidence` la vara de ct? Se mide con la FORMA de la ruta —
// `conventions/<algo>.md`— y no con la lista de `CONVENTIONS_FILES` de hoy: el
// mismo argumento por el que `findings_by_rule` no se cruza con el enum de
// reglas de hoy. Un documento renombrado o uno quinto que se añada mañana
// tiene que seguir contando en las filas viejas y en las nuevas.
//
// LA TRAMPA: `docs/conventions/code.md` también contiene la subcadena
// `conventions/code.md`, y ES la vara DEL REPO, no la de ct — `docs/conventions/`
// es justo el sitio típico donde vive `.agent/conventions.md` (ver
// `conventions/decisions.md`). Un `includes('conventions/')` a secas contaría
// esa cita como ct y mediría lo contrario de lo que promete. Por eso la ruta no
// puede venir precedida de una barra (`/`) — que delata un directorio padre
// como `docs/`— ni de un carácter de palabra (`code_conventions/x.md` tampoco es
// la vara de ct). Un lookbehind negativo es la única forma de exigir "nada de
// eso justo delante" sin capturar y descartar a mano.
const CITA_VARA_DE_CT = /(?<![\w/])conventions\/[\w.-]+\.md/

export function citaVaraDeCt(evidence) {
  return typeof evidence === 'string' && CITA_VARA_DE_CT.test(evidence)
}

// El conteo por severidad del veredicto, que es lo que permite leer "cuántos
// vetos" sin volver a cargar los hallazgos.
//
// `findings_by_rule` se añade al lado, no sustituye nada: un contador por cada
// regla de VERDICT_RULES que aparece en ESTE veredicto (no todas a cero,
// porque una regla ausente no aporta nada a la cuenta). Es el dato que dice si
// la rúbrica del juez está bien calibrada —qué regla veta más, cuál no veta
// nunca— y sólo es fiable porque el enum de `rule` es cerrado: sin eso, cada
// juez inventaría su propio vocabulario y la cuenta sería ruido.
export function verdictMeasures(verdict) {
  const findings = verdict?.findings || []
  const findingsByRule = {}
  for (const f of findings) findingsByRule[f.rule] = (findingsByRule[f.rule] || 0) + 1
  return {
    ruling: verdict?.ruling ?? null,
    findings_total: findings.length,
    findings_high: findings.filter((f) => f.severity === 'high').length,
    findings_medium: findings.filter((f) => f.severity === 'medium').length,
    findings_low: findings.filter((f) => f.severity === 'low').length,
    findings_by_rule: findingsByRule,
    // Cuántos ítems de la rúbrica se recorrieron SIN el insumo con el que
    // medirlos. Es la única clase de `outcome` que se cuenta: `conforme` y
    // `no-aplica` son la rúbrica funcionando, y ya se deducen del total. Un
    // run con esta columna alta es un juez que dijo PASS a ciegas, que es
    // exactamente lo que no se podía ver leyendo los veredictos de
    // rust-monitoring a mano.
    rubric_sin_vara: (verdict?.rubric || []).filter((paso) => paso.outcome === 'sin-vara').length,
    // De qué vara salió un hallazgo de `patrones` — el ÚNICO ítem que mide
    // contra las varas. Un hallazgo de `contrato` o `alcance` no es "de la vara
    // del repo" por no citar nada: es de otro ítem y no tiene nada que ver aquí,
    // así que contar sobre TODOS los hallazgos mediría una cosa distinta de la
    // que este campo promete. Un solo campo, no dos: el complemento —los de
    // `patrones` que NO citan a ct— se deriva restando de
    // `findings_by_rule.patrones`, que ya existe; dos columnas que tienen que
    // sumar lo mismo son dos sitios que pueden divergir.
    findings_patrones_vara_ct: findings.filter((f) => f.rule === 'patrones' && citaVaraDeCt(f.evidence)).length,
  }
}

// ---------------------------------------------------------------------------
// EL LECTOR DE LO QUE `verdictMeasures` ESCRIBIÓ. Vive pegado a él a propósito:
// mientras el escritor y el lector de la fila estén en el mismo fichero, un
// campo renombrado no puede quedar escrito por un sitio y leído por otro.
//
// De qué agujero sale: `rubric_sin_vara` viajaba en la pull request desde
// `1422c67` y NO LO LEÍA NADIE (§3.4 del handoff). La columna existía en disco
// y el §2 —«¿está llegando la vara?»— se contestaba abriendo ficheros `jsonl`
// a mano.
//
// SE SUMA AL LEER, que es lo que la cabecera de este módulo promete: la fila es
// por INTENTO, y dos intentos de juez sobre la misma tarea son dos filas que se
// suman. Por eso se devuelve también `verdicts`: un 3 sobre 12 veredictos y un
// 3 sobre 3 no son el mismo repo, y quien lee la cifra tiene que ver la N sin
// preguntar.
//
// LAS TRES TOLERANCIAS, y ninguna es cosmética:
//
//  1. `legacy` — una fila de veredicto SIN `rubric_sin_vara` es telemetría
//     anterior a la columna (el PR #11 de jjponz/rust-monitoring dejó 15 filas
//     así). NO cuenta como cero: un cero afirmaría que el juez tuvo su vara, y
//     lo que pasó es que nadie lo midió. Si ningún veredicto la trae,
//     `rubricSinVara` sale `null` y quien pinte la tabla tiene prohibido
//     imprimir `0`.
//  2. `malformed` — una línea que no es JSON, o que es JSON y no es un objeto,
//     se cuenta y se sigue. Tirar el fichero entero por una línea rota perdería
//     las buenas, y hacerla bajar el exit sería pedir que se «arregle y repita»
//     algo que se escribió hace tres semanas y no se puede rehacer.
//  3. Un veredicto es una fila con `ruling`, NO una fila de paso `judge`:
//     `ct-step` escribe filas de juez descartado (`outcome: 'discarded'`) sin
//     ninguna medida, y contarlas inflaría el denominador de la cifra que este
//     agregado existe para hacer legible.
//
// Y `findings_by_rule` se suma TAL CUAL VIENE, sin cruzarlo con VERDICT_RULES:
// una regla retirada de la rúbrica tiene que seguir viéndose en la telemetría
// vieja. Filtrar contra el enum de hoy borraría historia en silencio.
export function aggregateVerdictMeasures(texto) {
  let rows = 0
  let malformed = 0
  let verdicts = 0
  let measured = 0
  let legacy = 0
  let sinVara = 0
  // Contadores GEMELOS a `measured`/`legacy`, pero de `findings_patrones_vara_ct`
  // y no de `rubric_sin_vara`: son medidas distintas, cada una con su propia
  // fecha de nacimiento en la telemetría, así que una fila puede traer la una y
  // no la otra. Fundirlos en los mismos contadores confundiría "esta fila es
  // vieja para la medida A" con "lo es para la medida B".
  let measuredPatronesVaraCt = 0
  let legacyPatronesVaraCt = 0
  let patronesVaraCt = 0
  const findingsByRule = {}
  for (const linea of String(texto ?? '').split('\n')) {
    if (linea.trim() === '') continue
    let fila
    try {
      fila = JSON.parse(linea)
    } catch {
      malformed += 1
      continue
    }
    if (fila === null || typeof fila !== 'object' || Array.isArray(fila)) { malformed += 1; continue }
    rows += 1
    if (!Object.hasOwn(fila, 'ruling')) continue
    verdicts += 1
    const n = fila.rubric_sin_vara
    if (Number.isInteger(n) && n >= 0) { measured += 1; sinVara += n } else { legacy += 1 }
    const p = fila.findings_patrones_vara_ct
    if (Number.isInteger(p) && p >= 0) { measuredPatronesVaraCt += 1; patronesVaraCt += p } else { legacyPatronesVaraCt += 1 }
    const porRegla = fila.findings_by_rule
    if (porRegla && typeof porRegla === 'object' && !Array.isArray(porRegla)) {
      for (const [regla, cuantos] of Object.entries(porRegla)) {
        if (Number.isInteger(cuantos) && cuantos > 0) findingsByRule[regla] = (findingsByRule[regla] || 0) + cuantos
      }
    }
  }
  return {
    rows, malformed, verdicts, measured, legacy, rubricSinVara: measured ? sinVara : null, findingsByRule,
    measuredPatronesVaraCt, legacyPatronesVaraCt,
    patronesVaraCt: measuredPatronesVaraCt ? patronesVaraCt : null,
  }
}

// ---------------------------------------------------------------------------
// SI LA VARA LLEGÓ, Y CUÁNTO PESÓ. Hoy `ct-step.mjs` aborta si los cuatro
// documentos de `conventions/` faltan del PLUGIN, pero nada comprobaba que el
// brief de una tarea se los hubiera LLEVADO: si alguien toca `escribirBrief` y
// rompe el pegado, todo sigue en verde y el juez mide en silencio sólo contra
// la vara del repo. Este es el mecanismo que cierra esa desviación silenciosa.
//
// PURO A PROPÓSITO, como el resto del fichero: no lee disco. Cuenta sobre el
// CONTENIDO que `ct-step.mjs` ya leyó del brief que hay en disco — la única
// fuente de verdad, y no un dato arrastrado desde `escribirBrief` (que corre en
// una invocación ANTERIOR del proceso, sin nada en memoria que pasar). Quien
// decide `null` cuando el brief no se puede leer es `ct-step.mjs`: un cero aquí
// afirmaría un brief sin vara, y lo que habría pasado es que no se pudo mirar.
//
// Cuenta cabeceras, no bytes de una lista: `## Vara de ct: conventions/` es
// exactamente lo que `seccionDeVaraDeCt` (scripts/vara-ct.js) escribe por cada
// documento, y contarlas —en vez de comparar contra `CONVENTIONS_FILES.length`—
// es lo que deja que un quinto documento de mañana, o uno renombrado, se siga
// contando sin tocar esta función.
export function briefVaraCtMeasures(contenidoBrief) {
  const texto = String(contenidoBrief ?? '')
  const docs = (texto.match(/^## Vara de ct: conventions\//gm) || []).length
  return { brief_vara_ct_docs: docs, brief_bytes: Buffer.byteLength(texto, 'utf8') }
}

// ---------------------------------------------------------------------------
// EL LECTOR DE LO QUE `briefVaraCtMeasures` ESCRIBE en la fila del paso
// `implement`. Es un agregador HERMANO de `aggregateVerdictMeasures`, no el
// mismo: esas filas no llevan `ruling` —`ct-step.mjs` las escribe en
// `verboReport`, antes de que exista ningún veredicto— así que el agregador de
// veredictos las ignora por diseño (la tolerancia nº3 de aquí arriba) y no hay
// que tocarlo. Sin un agregador propio, `brief_vara_ct_docs` y `brief_bytes`
// habrían viajado en la pull request sin nadie que los leyera — el mismo
// agujero que ya pagó `rubric_sin_vara` (§3.4 del handoff).
//
// MISMA REGLA DE `measured`/`legacy` que `rubric_sin_vara`, calcada: una fila
// del paso `implement` sin los dos campos —telemetría anterior a esta medida,
// o un intento en el que el brief no se pudo leer en su momento— NO cuenta como
// cero. Se suma sólo lo medido, y si ningún intento trae la columna el agregado
// es `null`.
export function aggregateBriefMeasures(texto) {
  let briefAttempts = 0
  let briefMeasured = 0
  let briefLegacy = 0
  let docs = 0
  let bytes = 0
  for (const linea of String(texto ?? '').split('\n')) {
    if (linea.trim() === '') continue
    let fila
    try {
      fila = JSON.parse(linea)
    } catch {
      continue
    }
    if (fila === null || typeof fila !== 'object' || Array.isArray(fila)) continue
    if (fila.step !== 'implement') continue
    briefAttempts += 1
    const d = fila.brief_vara_ct_docs
    const b = fila.brief_bytes
    if (Number.isInteger(d) && d >= 0 && Number.isInteger(b) && b >= 0) {
      briefMeasured += 1
      docs += d
      bytes += b
    } else {
      briefLegacy += 1
    }
  }
  return {
    briefAttempts, briefMeasured, briefLegacy,
    briefVaraCtDocs: briefMeasured ? docs : null,
    briefBytes: briefMeasured ? bytes : null,
  }
}
