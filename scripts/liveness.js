// Señales de vida de un slice. Dos preguntas distintas que conviene no
// confundir:
//
//   assessLocalLiveness  ¿queda RASTRO de este slice en esta máquina?
//                        (worktree, rama, ventana de cmux)
//   liveSliceProcesses   ¿hay alguien TRABAJANDO en él ahora mismo?
//
// La primera no sirve para lo segundo, y ésa es justamente la razón de que un
// slice muerto pudiera pasar desapercibido para siempre: al morir deja el
// worktree y la rama en disco, así que "queda rastro" responde que sí.

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
