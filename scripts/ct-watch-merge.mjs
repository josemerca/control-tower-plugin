#!/usr/bin/env node
// ============================================================================
// CT-WATCH-MERGE — el vigilante del merge, para que la cosecha no espere a que
// alguien se acuerde de contarla.
//
// QUÉ ARREGLA. La Puerta 3 del loop es humana: cerrar los gates y mergear. Y
// mergear no producía NINGUNA señal mecánica. El PR se mergeaba, el issue se
// cerraba, y `.worktrees/<n>` + `feat/<n>` se quedaban en disco con su `claude`
// vivo —trece horas, en el caso que dio origen a F20— hasta que la misma persona
// que había mergeado iba a la ventana de la coordinadora a decírselo. O sea que
// el evento existía en GitHub y el que disparaba la cosecha era un recado.
//
// Este proceso cierra el hueco: sondea el PR de la rama del slice y, en cuanto
// lo ve mergeado, teclea la línea en la sesión coordinadora.
//
// LO LANZA EL PROPIO SLICE, AL ENTREGAR. `dispatch-check.mjs --release` lo
// arranca con `spawn(..., { detached: true }).unref()` justo después de mover el
// issue a `status:in-review`, que es el instante EXACTO en que existe un PR
// abierto esperando un merge humano. Lanzarlo antes (en el despacho, junto al
// vigilante del `-OK`) sería poner un proceso a preguntar por un PR que todavía
// no existe durante todo lo que dure la implementación.
//
// CÓMO LOCALIZA A LA COORDINADORA: POR SU DIRECTORIO, NO POR SU NOMBRE. El
// vigilante del `-OK` busca la sesión del slice por su TÍTULO, y puede porque
// ese título lo CALCULA el propio loop: `dispatch.js#cmuxSessionName` es una
// función pura que `/ct-next` llama para crear la workspace y que el vigilante
// llama para encontrarla. Una derivación, dos consumidores. Y encima `/ct-next`
// verifica con su centinela que esa sesión arrancó de verdad antes de lanzar
// nada.
//
// Aquí no hay nada de eso, y no por haber elegido peor: PORQUE NO HAY NADA QUE
// ELEGIR. A la sesión coordinadora no la crea el loop — la abre una persona en
// la ventana que le apetezca. No hay título que derivar, ni creación que
// verificar, ni garantía sobre la que apoyarse. La única propiedad observable
// que queda es DÓNDE corre —el checkout principal, el mismo del que
// `git worktree list --porcelain` devuelve la primera entrada— así que se
// compara contra `current_directory`.
//
// LA PRECONDICIÓN QUE ESO IMPONE, Y QUE ES UNA REGLA DE USO, NO UN DETALLE: la
// sesión coordinadora tiene que ser una workspace de cmux abierta EN EL CHECKOUT
// PRINCIPAL del repo que coordina. Si la tienes abierta en otro sitio, este
// proceso no la encuentra y el aviso se pierde.
//
// Medido en campo el 2026-08-26 con el PR #16 de jjponz/rust-monitoring: el
// merge se vio 34 segundos después de ocurrir, y no hubo a quién decírselo
// porque la ventana de quien coordinaba estaba abierta en OTRO repo. El
// vigilante hizo lo correcto y lo dijo; la regla no estaba escrita en ninguna
// parte, que es el defecto de verdad de aquel episodio.
//
// POR QUÉ SE ACEPTA LA REGLA EN VEZ DE HACER LA DIRECCIÓN ROBUSTA. La
// alternativa es que la coordinadora se REGISTRE —que al hidratarse apunte en
// algún sitio cuál es su workspace de cmux— y que esto lea ese registro en vez
// de inferir. Es la mitad simétrica de lo que el loop ya hace con los slices, y
// se descartó a propósito: sería una pieza nueva de estado, con su caducidad y
// su «¿sigue vivo eso?», construida para UN solo consumidor. Decisión tomada:
// se mantiene la inferencia y se escribe la regla. Si algún día hay un segundo
// consumidor que necesite alcanzar a la coordinadora, el registro es lo que hay
// que construir, y entonces este bloque es el que sobra.
//
// LÍMITE HEREDADO, DICHO SIN ADORNOS: para ENTREGAR la línea se usa el camino
// frágil de este plugin (`cmux send` + `send-key`), y no hay centinela que
// pruebe que la sesión la recibió. Lo único que se sabe es que los dos comandos
// devolvieron 0, y así se dice en el log — no «la cosecha ha arrancado». Es
// exactamente el mismo límite que acepta ct-watch-go.mjs, por el mismo motivo:
// un centinela de verdad exigiría que la coordinadora escribiera algo, o sea
// depender del agente al que se le entrega.
//
// LA DIVERGENCIA DELIBERADA RESPECTO A ct-watch-go.mjs, que es la única, y no es
// un descuido: AQUÍ NO SE MUERE PORQUE LA SESIÓN DESTINO NO ESTÉ.
//
// Aquél se apaga en cuanto cmux contesta que la sesión del slice no existe, y
// hace bien: sin esa sesión no hay nada que vigilar, y un proceso vivo
// vigilándola parecería que el gate sigue cubierto. Aquí la ausencia de la
// coordinadora no significa lo mismo, porque no es evidencia de que el trabajo
// haya terminado: el merge puede seguir llegando.
//
// LO QUE ESA DIVERGENCIA COMPRA, Y LO QUE NO — y la distinción es la corrección
// de una frase que este bloque decía antes y que el episodio del 2026-08-26
// desmintió. Compra sobrevivir a una ausencia MIENTRAS ESPERA: cierras la
// ventana, la vuelves a abrir, y la vigilancia sigue en pie. NO compra una
// ausencia EN EL INSTANTE DE ENTREGAR: si en ese tick no hay coordinadora, el
// aviso se pierde y punto. Este bloque afirmaba cubrir «te vas a dormir y el
// merge llega después», y eso sólo es cierto si la ventana está donde toca
// cuando el merge llega — o sea, no era una cobertura, era la misma
// precondición dicha como si fuera una garantía.
//
// EL AVISO PERDIDO NO ES UN AGUJERO, y ésta es la razón de fondo por la que la
// regla se acepta: `/ct-next` ya cruza en CADA corrida los issues mergeados
// contra `.worktrees/` y `git branch --list 'feat/*'` y emite `cosecha
// pendiente:` con los comandos exactos (F20, dispatch.js#collectFinishedResidue).
// Así que este vigilante no aporta conocimiento que no exista: aporta el
// MOMENTO. Cuando falla, se degrada exactamente al modo de antes —te enteras en
// el siguiente `/ct-next`—, no a que nadie se entere nunca.
//
// Lo que sí se hace es no fingir: si el merge se ve y no hay a quién
// entregárselo, se dice, se nombra la regla que no se cumplió, y se sale con 1.
// Se pierde el aviso; no se disfraza de entregado.
//
// LO QUE DELIBERADAMENTE NO TIENE, heredado de ct-watch-go y por sus motivos:
//
//   - NI PIDFILE NI COMPROBACIÓN DE VIDA. Un `--reopen` seguido de un segundo
//     `--release` nace un segundo vigilante; el primero caduca. Lo peor que pasa
//     es que la línea se teclee dos veces, que es molesto y nada más.
//   - NI BORRAR NADA. El vigilante avisa; la cosecha la recoge la coordinadora.
//     Es la decisión de F20 intacta: «mergeado» no es «nadie está tocando eso»
//     —puede haber cambios sin pushear— y borrar un worktree es irreversible.
//     Ningún camino de éxito de este plugin borra nada, y este tampoco.
//   - NI VIGILAR EL CIERRE DEL ISSUE. Lo que libera los tokens es el merge, y lo
//     que deja residuo en disco es el merge. El cierre del issue es su
//     consecuencia, no un segundo evento que valga la pena esperar aparte.
//
// EL LOG LO ABRE ESTE PROCESO, no quien lo lanza, y va fuera del repo
// (`~/.claude/control-tower/log/`), junto a la telemetría y al log del vigilante
// del `-OK`. Los tres por el mismo motivo escrito en run-metrics.js: para que
// ningún `git add` de la slice lo meta en la PR. Lo abre ÉL porque, cuando
// ct-next lo abría por su vigilante, la suite acabó creando ficheros en el $HOME
// real de quien la corriera.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildCmuxSendArgv, buildCmuxSendKeyArgv } from './dispatch.js'
import { parseStrictInt } from './argnum.js'

// 60 segundos de tick y 48 horas de plazo. Los dos números son distintos de los
// del vigilante del `-OK` (30 s / 8 h) porque el evento es distinto: aquél cubre
// que una persona esté durmiendo, y éste cubre que un PR espere revisión — que
// en la medida de F33 es lo que más reloj de epic consume, y se cuenta en días,
// no en horas. Un tick más lento no cuesta nada: la cosecha no es urgente al
// segundo, y 48 h a un sondeo por minuto son ~2880 llamadas a `gh` por slice,
// 60 a la hora, contra un límite de 5000.
const DEFAULT_POLL_MS = 60_000
const DEFAULT_TIMEOUT_MS = 48 * 60 * 60 * 1000
const GH_TIMEOUT_MS = 30_000
const CMUX_TIMEOUT_MS = 10_000

const arg = (nombre) => {
  const i = process.argv.indexOf(nombre)
  return i === -1 ? null : process.argv[i + 1] ?? null
}

const issue = arg('--issue')
const repo = arg('--repo')
const coordinatorCwd = arg('--coordinator-cwd')
const logPath = arg('--log')
if (!issue || !repo || !coordinatorCwd) {
  process.stderr.write('uso: ct-watch-merge.mjs --issue N --repo owner/name --coordinator-cwd <ruta del checkout principal> [--log <ruta>]\n')
  process.exit(2)
}

const branch = `feat/${issue}`

// El log, si se pide. Que no se pueda abrir NO impide vigilar: perder el rastro
// es peor que no tenerlo, pero mucho menos malo que perder el aviso.
let logFd = null
if (logPath) {
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    logFd = openSync(logPath, 'a')
  } catch (e) {
    process.stderr.write(`aviso: no se pudo abrir el log ${logPath} (${e.message}) — se vigila igual, sin rastro en disco\n`)
  }
}
const log = (msg) => {
  const linea = `${new Date().toISOString()} ${msg}\n`
  if (logFd !== null) { try { writeSync(logFd, linea) } catch { /* el rastro se pierde, la vigilancia no */ } }
  process.stdout.write(linea)
}
const terminar = (codigo) => {
  if (logFd !== null) { try { closeSync(logFd) } catch { /* ya está */ } }
  process.exit(codigo)
}

// Los dos plazos se pueden ajustar por entorno, con el mismo criterio que
// CT_WATCH_GO_POLL_MS: un valor que no se entiende ABORTA en vez de caer al
// defecto en silencio, porque un plazo mal escrito cambia lo que este proceso
// significa y no querrías descubrirlo dos días después.
function plazo(nombre, defecto) {
  const raw = process.env[nombre]
  if (raw == null || raw === '') return defecto
  const v = parseStrictInt(raw)
  if (v == null || v <= 0) {
    process.stderr.write(`${nombre} inválido: "${raw}" — debe ser un número de milisegundos mayor que 0.\n`)
    process.exit(2)
  }
  return v
}
const pollMs = plazo('CT_WATCH_MERGE_POLL_MS', DEFAULT_POLL_MS)
const timeoutMs = plazo('CT_WATCH_MERGE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ¿Hay un PR MERGEADO cuya rama sea la del slice? Devuelve el PR, `null` si no
// hay ninguno, o `undefined` si no se pudo preguntar — las tres son cosas
// distintas y de la tercera no se sigue nada.
//
// No hay heurística que valga aquí y por eso no la hay: la rama de un slice es
// determinista, así que se pregunta por ella y punto. `--state merged` lo filtra
// GitHub, no este fichero. Es deliberadamente lo contrario de lo que hacía la
// primera versión de la cosecha de métricas, que deducía el PR escaneando
// `cross-referenced` y ataba slices a PRs equivocados (ver commands/ct-harvest.md).
function leerPrMergeado() {
  try {
    const raw = execFileSync('gh', [
      'pr', 'list', '--repo', repo, '--head', branch, '--state', 'merged',
      '--json', 'number,mergedAt', '--limit', '1',
    ], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL',
    })
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const pr = parsed[0]
    return Number.isInteger(pr?.number) ? pr : null
  } catch (e) {
    // Un fallo de `gh` NO termina la vigilancia: la red se cae, el token caduca
    // y se renueva, GitHub devuelve un 502. Lo que no puede pasar es que un
    // fallo transitorio se lea como «no está mergeado» de forma permanente — el
    // vigilante se apagaría con el trabajo entregado y la cosecha sin recoger.
    log(`aviso: no se pudo consultar el PR de ${branch} (${String(e.message).trim()}) — se reintenta en el próximo tick`)
    return undefined
  }
}

// Devuelve `{ consultado, ref }`. La distinción entre "cmux contestó y la
// coordinadora NO está" (`consultado: true, ref: null`) y "no se pudo preguntar"
// (`consultado: false`) es la que ct-next.mjs sostiene con tanto cuidado en
// `queryAllCmuxWorkspaces`, y la que una revisión adversarial pilló tirada en el
// camino de entrega de ct-watch-go: un timeout de cmux en el tick en que llega
// el evento mataba la vigilancia en el único instante que importaba, y encima
// diagnosticaba "no se encontró la sesión" cuando la sesión estaba ahí.
//
// Se compara `current_directory`, no `custom_title`: ver la cabecera.
function consultarCoordinadora() {
  try {
    const windows = JSON.parse(execFileSync('cmux', ['list-windows', '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
    }))
    for (const w of Array.isArray(windows) ? windows : []) {
      if (!w?.id) continue
      const parsed = JSON.parse(execFileSync('cmux', ['workspace', 'list', '--window', w.id, '--json'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
      }))
      for (const ws of Array.isArray(parsed?.workspaces) ? parsed.workspaces : []) {
        if (ws?.current_directory === coordinatorCwd && typeof ws.ref === 'string') return { consultado: true, ref: ws.ref }
      }
    }
    return { consultado: true, ref: null }
  } catch (e) {
    log(`aviso: no se pudo consultar cmux (${String(e.message).trim()})`)
    return { consultado: false, ref: null }
  }
}

// La línea que se teclea en la coordinadora. Nombra el PR, el slice y LOS DOS
// ARTEFACTOS que quedan en disco, porque el aviso tiene que bastar para actuar:
// un "ya está mergeado" a secas dejaría a la persona siendo otra vez el bus de
// mensajes, que es el problema entero.
//
// Y dice «comprueba que no queda trabajo sin pushear» a propósito: el que borra
// es un agente, y lo que le falta saber al recibir esta línea es exactamente lo
// que F20 se negó a asumir.
const linea = (pr) => `El PR #${pr} del slice #${issue} está mergeado: la cosecha del #${issue} está pendiente. \`.worktrees/${issue}\` y la rama \`${branch}\` siguen en disco. Comprueba que no queda trabajo sin pushear y recógelos.`

log(`vigilando el merge de ${repo} ${branch} (slice #${issue}) para la coordinadora en ${coordinatorCwd} — tick ${pollMs} ms, plazo ${timeoutMs} ms`)

// No hay foto inicial que sacar, y esa asimetría con ct-watch-go es real, no un
// olvido. Allí la ventana existe porque un `-OK` heredado de un despacho
// anterior arrancaría el trabajo sin que nadie diera permiso. Aquí el evento no
// es una respuesta de nadie sino un hecho del repositorio, y ese hecho no
// caduca: si la rama del slice YA tiene un PR mergeado en el primer sondeo, la
// cosecha está pendiente igual y hay que decirlo. Un vigilante que se callara
// por eso sería un vigilante que se calla justo cuando ya hay residuo en disco.
const limite = Date.now() + timeoutMs

for (;;) {
  const pr = leerPrMergeado()
  if (pr) {
    log(`${branch} mergeado en el PR #${pr.number}${pr.mergedAt ? ` (${pr.mergedAt})` : ''}`)
    const { consultado, ref } = consultarCoordinadora()
    if (ref) {
      try {
        execFileSync('cmux', buildCmuxSendArgv({ workspace: ref, text: linea(pr.number) }), {
          stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
      } catch (e) {
        log(`ERROR: el merge se vio y el texto no se pudo escribir en la coordinadora (${ref}): ${String(e.message).trim()}. Recoge la cosecha del #${issue} a mano.`)
        terminar(1)
      }
      try {
        execFileSync('cmux', buildCmuxSendKeyArgv({ workspace: ref }), {
          stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
      } catch (e) {
        // `send` sin `send-key` deja el texto en la línea de edición SIN
        // ejecutar (medido en F20/H1), así que hay que decir eso y no "no se
        // pudo teclear": quien lo lea va a encontrarse la línea escrita en la
        // ventana y tiene que saber que sólo le falta el Enter.
        log(`ERROR: el texto quedó escrito en la línea de edición de la coordinadora (${ref}) pero el Enter falló: ${String(e.message).trim()}. Ve a esa ventana y pulsa Enter.`)
        terminar(1)
      }
      // Lo que se sabe es esto y no más: los dos comandos devolvieron 0. No hay
      // centinela que pruebe que la coordinadora lo recibió y actuó (ver la
      // cabecera), así que el mensaje no afirma que la cosecha haya arrancado.
      log(`línea enviada a la coordinadora (${ref}): \`cmux send\` y \`send-key Enter\` devolvieron 0. No hay forma de comprobar desde aquí que la sesión la haya procesado. Vigilancia terminada.`)
      terminar(0)
    }
    if (consultado) {
      // Se nombra LA REGLA, no sólo el hecho. El mensaje anterior decía «no
      // existe ninguna sesión en <cwd>», que es verdad y no sirve: quien lo lee
      // no puede deducir de ahí qué tenía que haber hecho distinto. Y se dice
      // que la cosecha se sigue detectando sola, para que un aviso perdido no se
      // lea como trabajo perdido.
      log(`ERROR: el merge de ${branch} se vio, pero cmux dice que no existe ninguna workspace cuyo directorio sea ${coordinatorCwd}, así que no hay a quién entregárselo.`)
      log(`La regla que no se cumplió: la sesión coordinadora tiene que ser una workspace de cmux abierta EN ${coordinatorCwd} — este vigilante la localiza por su directorio porque no hay ningún nombre de sesión que el loop pueda derivar (a ella no la crea el loop, la abres tú).`)
      log(`No se ha perdido trabajo: el próximo \`/ct-next\` en ese checkout emitirá \`cosecha pendiente:\` para el #${issue} con los comandos exactos. Lo que se ha perdido es enterarte ahora.`)
      terminar(1)
    }
    // No se pudo PREGUNTAR por la coordinadora. De eso no se sigue nada, y menos
    // con el merge ya en la mano: se reintenta en el próximo tick.
    log(`el merge está visto pero no se pudo consultar cmux para localizar la coordinadora — se reintenta la entrega en el próximo tick`)
  }
  if (Date.now() >= limite) {
    log(`plazo agotado sin ver ningún merge de ${branch} en ${repo}. Si ya lo mergeaste, la cosecha del #${issue} sigue pendiente: recógela a mano, o vuelve a lanzar este vigilante.`)
    terminar(3)
  }
  await sleep(Math.min(pollMs, Math.max(0, limite - Date.now())))
}
