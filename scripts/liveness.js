// Señales de vida de un slice.
//
// `assessLocalLiveness` responde si queda RASTRO de un slice en esta máquina
// —worktree, rama, ventana de cmux—, que no es lo mismo que si alguien está
// TRABAJANDO en él. La diferencia es justamente la razón de que un slice
// muerto pudiera pasar desapercibido para siempre: al morir deja el worktree y
// la rama en su sitio, así que "queda rastro" responde que sí.
//
// `liveSliceProcesses` responde la otra pregunta: ¿hay un proceso `claude`
// trabajando AHORA MISMO dentro del worktree de cada slice? Es la señal que
// falta en `assessLocalLiveness`, y por eso vive en el mismo módulo.

import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// `getCmuxTitles` es un THUNK, no el valor ya calculado (F13): la consulta a
// cmux (list-windows + un workspace list por ventana, hasta
// CMUX_QUERY_TIMEOUT_MS) solo se dispara si las DOS señales baratas y locales
// —worktree en disco, rama en este checkout— han fallado ya. Antes el valor
// llegaba precalculado, así que preguntar por la vida de un issue costaba
// siempre la consulta completa aunque su worktree estuviera ahí delante.
//
// Importa desde F13/H3, que amplía la comprobación al caso "cap lleno" — el
// resultado MÁS COMÚN de un /ct-next con algo corriendo. Sin esta inversión,
// cada invocación rutinaria pagaría la consulta a cmux para no decir nada.
// La semántica no cambia en absoluto: basta UNA señal de vida para no emitir
// nota, y el orden en que se comprueban no altera esa conjunción.
export function assessLocalLiveness(n, getCmuxTitles, { repoRoot, timeoutMs }) {
  const wt = `${repoRoot}/.worktrees/${n}`
  const hasWorktree = existsSync(wt)
  let hasBranch = false
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/feat/${n}`], {
      cwd: repoRoot, stdio: 'ignore', timeout: timeoutMs, killSignal: 'SIGKILL',
    })
    hasBranch = true
  } catch {
    hasBranch = false
  }
  // Corto aquí: con worktree o rama ya sabemos que NO hay nota que emitir, y
  // `cmuxChecked` es irrelevante en ese camino (stalenessNote sale por el
  // primer `return null`). Afirmar `cmuxChecked: false` sin haber preguntado
  // sería correcto pero engañoso si alguien leyera el struct fuera de aquí,
  // así que se marca explícitamente como no consultado.
  if (hasWorktree || hasBranch) return { hasWorktree, hasBranch, hasCmuxWorkspace: false, cmuxChecked: false }
  const cmuxTitles = getCmuxTitles()
  const cmuxChecked = cmuxTitles !== null
  const hasCmuxWorkspace = cmuxChecked && cmuxTitles.some((t) => new RegExp(`#${n}(\\D|$)`).test(t))
  return { hasWorktree, hasBranch, hasCmuxWorkspace, cmuxChecked }
}

const ejecutar = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// liveSliceProcesses: ¿qué slices tienen AHORA MISMO un proceso `claude`
// trabajando dentro de su worktree? Es la pregunta que ninguna otra señal del
// loop responde: al morir, un agente deja worktree, rama y ventana de cmux en
// su sitio, así que todo lo demás sigue diciendo "vivo".
//
// `pgrep -x`, nunca `-f`: `-x` casa el nombre exacto del proceso, mientras que
// `-f` casa cualquier línea de comando que contenga "claude" — incluida la del
// propio comando que hace esta comprobación.
//
// Una sola llamada a `lsof` para todos los PID (medido: 52 ms). Un PID que
// muera entre el `pgrep` y el `lsof` no rompe nada: lsof sale con 0 y
// simplemente lo omite.
export function liveSliceProcesses(repoRoot, { run = ejecutar } = {}) {
  let pids
  try {
    pids = run('pgrep', ['-x', 'claude']).split('\n').map((s) => s.trim()).filter(Boolean)
  } catch (e) {
    // rc=1 en pgrep significa "ninguna coincidencia", que es una respuesta
    // NORMAL y válida: el loop en reposo no tiene agentes. Tratarla como
    // fallo daría falsa alarma en cada corrida tranquila.
    if (e && e.status === 1) return { porSlice: new Map(), comprobado: true, motivo: null }
    return { porSlice: new Map(), comprobado: false, motivo: `no se pudo listar procesos con pgrep: ${e && e.message}` }
  }
  // Sin PID no se llama a lsof, y no es una optimización: medido, `lsof -a -p ""`
  // devuelve un proceso AJENO en vez de nada, así que la lista vacía produciría
  // un falso positivo.
  if (!pids.length) return { porSlice: new Map(), comprobado: true, motivo: null }

  let salida
  try {
    salida = run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'])
  } catch (e) {
    return { porSlice: new Map(), comprobado: false, motivo: `no se pudo leer el directorio de trabajo de los procesos con lsof: ${e && e.message}` }
  }

  // `-Fpn` emite tripletes: p<pid> / fcwd / n<ruta>.
  const porSlice = new Map()
  const prefijo = `${repoRoot}/.worktrees/`
  let pidActual = null
  for (const linea of salida.split('\n')) {
    if (linea.startsWith('p')) { pidActual = linea.slice(1); continue }
    if (!linea.startsWith('n') || pidActual === null) continue
    const cwd = linea.slice(1)
    const pid = pidActual
    pidActual = null
    if (!cwd.startsWith(prefijo)) continue
    // El agente puede haberse metido MÁS ADENTRO del worktree, así que se toma
    // el primer segmento tras `.worktrees/`, no la ruta entera.
    const slice = cwd.slice(prefijo.length).split('/')[0]
    if (slice && !porSlice.has(slice)) porSlice.set(slice, pid)
  }
  return { porSlice, comprobado: true, motivo: null }
}
