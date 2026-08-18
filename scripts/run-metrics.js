// ============================================================================
// RUN-METRICS — una fila por INTENTO DE UN PASO DE UNA TAREA.
//
// La granularidad más fina que el programa ya conoce sin esfuerzo. Agregar
// hacia arriba —por tarea, por plan, por epic— es una suma; deshacer una
// agregación no es nada, así que se guarda lo fino y se suma al leer.
//
// Módulo PURO: compone la fila y decide dónde va. No escribe. Quien escribe es
// `ct-run.mjs`, y lo hace tragándose la excepción a propósito (ver más abajo).
//
// ---------------------------------------------------------------------------
// DOS CAMPOS DE IDENTIDAD QUE NO SON OBVIOS
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
// ---------------------------------------------------------------------------
// Y LA AUSENCIA SE DECLARA, NO SE RELLENA: un issue sin milestone se anota
// `(sin milestone)` con la constante que ya existe, nunca vacío. Es la misma
// regla que impidió que `ct-next` asumiera `main` en silencio cuando no conocía
// la base — un hueco en una métrica se lee como un cero, y un cero es una
// afirmación.
// ============================================================================

import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { NO_MILESTONE_KEY } from './gh-issue-map.js'

// Los once campos de identidad del §10.1 del spec, en orden.
export const IDENTITY_FIELDS = Object.freeze([
  'repo', 'epic', 'issue', 'plan', 'plan_sha256',
  'task', 'task_name', 'tasks_total', 'step', 'attempt', 'session',
])

export const planSha256 = (texto) => createHash('sha256').update(String(texto ?? ''), 'utf8').digest('hex')

// Fuera del repo, y por un motivo explícito: para que ningún `git add` de la
// slice se lleve la telemetría dentro de la pull request. Bajo
// CLAUDE_CONFIG_DIR cuando lo hay, que es donde vive el resto del estado de esa
// cuenta.
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

function normalizar(campo, valor) {
  if (campo === 'epic') return valor || NO_MILESTONE_KEY
  if (campo === 'session') return valor ?? null
  if (valor === undefined) return null
  return valor
}

export const metricLine = (fila) => JSON.stringify(fila) + '\n'

// El conteo por severidad del veredicto, que es lo que permite leer "cuántos
// vetos" sin volver a cargar los hallazgos.
export function verdictMeasures(verdict) {
  const findings = verdict?.findings || []
  return {
    ruling: verdict?.ruling ?? null,
    findings_total: findings.length,
    findings_high: findings.filter((f) => f.severity === 'high').length,
    findings_medium: findings.filter((f) => f.severity === 'medium').length,
    findings_low: findings.filter((f) => f.severity === 'low').length,
  }
}
