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
export function metricsPath(concepto, { configDir = null, home = null } = {}) {
  const raiz = configDir || join(home || homedir(), '.claude')
  return join(raiz, 'control-tower', 'log', `${concepto}.jsonl`)
}

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
  }
}
