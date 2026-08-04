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

// SEÑAL_TIMEOUT_MS: ni `ps` ni `lsof` pueden dejar este comando colgado para
// siempre. `lsof` es el caso clásico —un montaje de red muerto lo bloquea
// indefinidamente al estatear el cwd de un proceso— y /ct-status se vende como
// invocable en bucle por un vigilante externo: un cuelgue ahí no devuelve ni
// código de salida. Mismo criterio que sus vecinas (`gh` y `git` en
// ct-status.mjs, y el `execFileSync` de `assessLocalLiveness` aquí arriba):
// `timeout` + `killSignal: 'SIGKILL'`, porque un SIGTERM a un proceso atascado
// en una llamada al sistema no lo mata. El tope es holgado a propósito: medido
// en esta máquina, `ps` tarda 26 ms y un `lsof` agrupado sobre 400 PID tarda
// 180 ms, así que 10 s son ~55x el peor caso medido — no se dispara por carga,
// sólo por un cuelgue de verdad. Un timeout llega aquí con `status: null` (no
// 1), así que cae por la rama de "no se pudo comprobar" con su motivo, nunca
// por la de la lista vacía.
const SEÑAL_TIMEOUT_MS = 10_000
const ejecutar = (cmd, args, opciones) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opciones })

// basename exacto de la RUTA con la que se invocó un proceso. Sin `path.basename`
// a propósito: aquí no se normaliza nada, se corta por la última barra y se
// compara tal cual.
const nombreInvocado = (ruta) => ruta.slice(ruta.lastIndexOf('/') + 1)

// liveSliceProcesses: ¿qué slices tienen AHORA MISMO un proceso `claude`
// trabajando dentro de su worktree? Es la pregunta que ninguna otra señal del
// loop responde: al morir, un agente deja worktree, rama y ventana de cmux en
// su sitio, así que todo lo demás sigue diciendo "vivo".
//
// SE IDENTIFICA POR LA RUTA INVOCADA, NO POR `pgrep -x`, y no es una cuestión
// de gusto: `pgrep -x claude` NO ve al Claude Code que te está ejecutando.
//
// ANTES DE LOS DOS HECHOS, EL QUE LOS DESAMBIGUA, porque sin él es fácil sacar
// de aquí una conclusión falsa: en macOS `pgrep -x` NO casa contra el nombre
// del proceso, casa contra el basename de `argv[0]`. Comprobado en aislado con
// un symlink `falsoclaude` → `/bin/sleep` ejecutado como `./falsoclaude`:
//   $ pgrep -x falsoclaude  → lo lista     (basename de argv[0])
//   $ pgrep -x sleep        → NO lo lista  (y "sleep" es su ucomm)
// O sea que `pgrep -x claude` sí encuentra procesos de Claude Code — todos
// menos sus propios ancestros, que es justo la excepción que lo rompía aquí.
// No es que no encuentre ninguno; es que no encuentra EL que importa. Y el
// hecho 1 de abajo es lo que hace que la alternativa obvia —matchear por
// nombre de proceso— tampoco sirva.
//
// Dos hechos medidos en esta máquina, los dos hoy:
//
//   1. El nombre de proceso no es "claude". El instalador nativo deja
//      `~/.local/bin/claude` como symlink a
//      `~/.local/share/claude/versions/<versión>`, y el kernel toma el nombre
//      del proceso del ejecutable YA RESUELTO:
//        $ ps -u <uid> -o pid=,ucomm=  →  18539  2.1.220
//      El nombre del proceso ES el número de versión, y cambia con cada
//      actualización. Cualquier matcheo por NOMBRE persigue un blanco móvil.
//   2. LA CAUSA DOMINANTE: `pgrep` excluye a sus propios ancestros. `man
//      pgrep`, flag `-a`: «By default, the current pgrep or pkill process and
//      all of its ancestors are excluded». Como /ct-status se invoca DESDE una
//      sesión de Claude Code, el `claude` de esa sesión es ancestro del
//      `pgrep` y queda fuera:
//        $ pgrep -x claude   → no lista el pid 18539, que sí está en `ps`
//      Con una sola sesión abierta la salida es vacía y rc=1 — que este código
//      interpretaba como «ninguna coincidencia, respuesta normal» y por tanto
//      `comprobado: true`. Resultado: TODO slice sano en vuelo salía «← SIN
//      SEÑAL DE VIDA» con exit 3 y sin un solo `aviso:`, y el bloque de
//      residuo afirmaba «no hay ningún proceso trabajando dentro» sobre un
//      worktree con un agente dentro. La degradación segura no se activaba
//      porque, desde dentro, la lectura «había sido un éxito». Es el peor
//      fallo posible de esta feature. No vuelvas a `pgrep`.
//
// Lo que sí identifica es la RUTA con la que se invocó el proceso, que `ps`
// da en la columna `comm` y que sobrevive a los cambios de versión:
//   $ ps -o comm= -p 18539  →  /Users/jpereag/.local/bin/claude
// Se acepta sólo si su basename es EXACTAMENTE `claude`, comparando string
// contra string. El matcheo exacto no es celo: deja fuera la app de escritorio
// sin ninguna regla extra —`/Applications/Claude.app/Contents/MacOS/Claude`
// tiene basename `Claude` con mayúscula, y sus helpers `Claude Helper`,
// `Claude Helper (Renderer)`, `Claude Helper (Plugin)`—, y una ventana abierta
// del escritorio no es un agente trabajando en ningún worktree.
//
// `ps -u <uid>` acota al usuario actual, igual que hacía el `-U` de `pgrep` y
// por el mismo motivo: es lo que hace segura la lectura del `stdout` parcial
// de `lsof` de más abajo. Y `ps`, a diferencia de `pgrep`, NO excluye
// ancestros: por eso este camino sí ve la sesión desde la que se le llama.
// Comprobado en aislado: un proceso invocado como `<dir>/claude` que ejecuta
// `pgrep -x claude` NO se ve a sí mismo en la salida; el filtro de aquí abajo
// sí lo lista.
//
// LÍMITE CONOCIDO, y se deja escrito porque nadie lo ha podido comprobar: todo
// lo de arriba está medido en macOS. Que la columna `comm` de `ps` traiga la
// RUTA invocada es lo que hace funcionar esto, y en otro sistema operativo esa
// columna puede significar otra cosa. Si alguien lleva el loop a Linux, lo
// primero que hay que verificar es qué devuelve ahí `ps -o comm=`; hasta
// entonces, esta señal está comprobada sólo donde se ha medido.
//
// Una sola llamada a `lsof` para todos los PID (medido: 180 ms sobre 400 PID).
// Un PID que muera entre el `ps` y el `lsof` no rompe nada, pero no porque
// `lsof` "salga con 0 y lo omita" —eso es falso, medido—: `lsof` sale con **1**
// en cuanto falta UNO de los PID pedidos, aunque el resto se resuelva bien y
// venga en `stdout`. Leer ese `stdout` parcial sólo es seguro PORQUE la lista
// está acotada al usuario actual: todo PID de la lista es propio y legible,
// así que la única razón de que falte en la salida de `lsof` es que haya
// muerto —y un proceso muerto no trabaja en ningún worktree. Sin el acotado
// por usuario, un PID ajeno (no legible por permisos) produciría el mismo rc=1
// y aquí se leería como "muerto" pudiendo seguir vivo: sería la única vía de
// acusar en falso a un slice sano. No lo quites.
export function liveSliceProcesses(repoRoot, { run = ejecutar } = {}) {
  // `process.getuid` no existe en Windows. Sin uid no hay acotado posible, y
  // un listado sin acotar rompe la premisa que hace segura la lectura parcial
  // de `lsof` de más abajo, así que se degrada aquí en vez de arriesgarse.
  if (typeof process.getuid !== 'function') {
    return { porSlice: new Map(), comprobado: false, motivo: 'no se pudo determinar el usuario actual: process.getuid no está disponible en esta plataforma' }
  }
  const uid = process.getuid()

  let listado
  try {
    listado = run('ps', ['-u', String(uid), '-o', 'pid=,comm='], { timeout: SEÑAL_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    // Un `ps` que falla es una lectura que NO se pudo hacer. Nunca una lista
    // vacía presentada como hecho: ese es exactamente el fallo que este módulo
    // acaba de arreglar.
    return { porSlice: new Map(), comprobado: false, motivo: `no se pudo listar procesos con ps: ${e && e.message}` }
  }
  const pids = []
  for (const linea of listado.split('\n')) {
    // El PID es el primer campo y TODO el resto de la línea es la ruta. No se
    // parte por espacios: las rutas de la app de escritorio los llevan dentro
    // (`.../Claude Helper.app/Contents/MacOS/Claude Helper`), y partir por
    // espacios convertiría esa línea en el token suelto `Helper`.
    const m = /^\s*(\d+)\s+(.*)$/.exec(linea)
    if (!m) continue
    if (nombreInvocado(m[2]) !== 'claude') continue
    pids.push(m[1])
  }
  // Sin PID no se llama a lsof, y no es una optimización: medido, `lsof -a -p ""
  // -d cwd -Fpn` no devuelve nada vacío — devuelve el cwd de TODOS los procesos
  // legibles de la máquina con rc=0 (cientos de entradas: 399 en la corrida
  // medida), porque una lista de PID vacía no restringe nada. La lista vacía
  // produciría entonces un falso positivo por cada worktree.
  if (!pids.length) return { porSlice: new Map(), comprobado: true, motivo: null }

  let salida
  try {
    salida = run('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn'], { timeout: SEÑAL_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e) {
    // rc=1 con `stdout` legible es la carrera ps→lsof, no un fallo: ver el
    // comentario de cabecera de esta función sobre por qué acotar por usuario
    // es lo que hace segura esta lectura parcial.
    //
    // `status === 1` es la mitad que NO se puede quitar, y no está ahí de
    // adorno: rc=1 es el único código que significa "faltaba algún PID". Un
    // `lsof` que no existe sale con 127, y un `lsof` matado por el `timeout`
    // de arriba llega con `status: null` — los dos pueden traer un `stdout`
    // string (vacío, o cortado a la mitad). Sin esta mitad de la condición,
    // esos dos casos se leerían como una lectura BUENA y parcial: el informe
    // afirmaría "no hay nadie vivo" sobre un `stdout` que se quedó a medias.
    if (e && e.status === 1 && typeof e.stdout === 'string') {
      salida = e.stdout
    } else {
      return { porSlice: new Map(), comprobado: false, motivo: `no se pudo leer el directorio de trabajo de los procesos con lsof: ${e && e.message}` }
    }
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
