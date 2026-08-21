#!/usr/bin/env node
// ============================================================================
// CT-WATCH-GO — el vigilante del `-OK` del gate `plan`.
//
// QUÉ ARREGLA. El gate `plan` manda al agente publicar su plan como comentario
// del issue y PARAR. El humano contesta en GitHub, y hasta esta ronda nadie leía
// esa respuesta: el trabajo se reanudaba cuando esa misma persona iba a la
// ventana de cmux y empujaba la sesión a mano. Dos permisos para lo mismo, y el
// que contaba no era el que queda escrito en el issue.
//
// Este proceso cierra el hueco: sondea el issue, y en cuanto ve el `-OK` teclea
// la línea en la sesión del slice. Un solo go, en GitHub, con autor.
//
// LO LANZA LA COORDINADORA, DESPRENDIDO. `ct-next` lo arranca con
// `spawn(..., { detached: true }).unref()` justo después de despachar el slice,
// y sólo si ese slice lleva el gate `plan`. Desprendido porque tiene que
// sobrevivir a que se cierre la sesión coordinadora: si sólo viviera mientras
// alguien mira, no serviría para el caso que motiva todo esto — el gate pedido a
// la 01:00 esperando a que alguien se despierte, que en la medida de F33 fue el
// 54% del reloj de un epic.
//
// POR QUÉ NO UNA WORKSPACE DE CMUX. Se consideró, porque es el segundo plano que
// este repo ya conoce, y se descartó con un motivo concreto: lanzar por cmux es
// TECLEAR UN COMANDO EN UN PTY, y ése es el camino frágil de este plugin. Existe
// `launch-sentinel.js` entero porque no había forma de saber si el comando
// llegó a ejecutarse, y `ct-next` lleva un bucle de reenvío porque el prompt del
// shell se comía caracteres. Pagar todo eso para un bucle que nadie va a mirar
// no sale a cuenta: un `spawn` no pasa por ningún pty, ni por comillas, ni
// necesita centinela.
//
// LO QUE DELIBERADAMENTE NO TIENE, y no es un olvido:
//
//   - NI PIDFILE NI COMPROBACIÓN DE VIDA. Si redespachas un slice nacen dos
//     vigilantes: el segundo empuja igual y el primero caduca. Lo peor que pasa
//     es que la línea se teclee dos veces en la sesión, que es molesto y nada
//     más. Pagar el problema entero de "¿está vivo, huérfano o colgado?" —al que
//     este repo ya dedica tres ficheros— para evitar eso sería caro y no
//     compraría nada.
//   - NI CATEGORÍA DE RESPUESTA MALFORMADA. Ver go-response.js: cualquier cosa
//     que no sea exactamente `-OK` simplemente no arranca, que es el lado
//     prudente. No comenta en el issue para explicar formatos.
//   - NI `-REVIEW`. Mandar una corrección por comentario y que el plan se rehaga
//     es otra función; para pedir cambios sigue estando el terminal.
//
// EL LOG VA FUERA DEL REPO, en ~/.claude/control-tower/log/. No es una decisión
// nueva: es donde run-metrics.js#metricsPath ya pone lo suyo, y por el motivo
// que ya está escrito allí — «fuera del repo, para que ningún git add de la
// slice la meta en la PR». Un proceso que corre cuando no estás mirando y no
// deja rastro en ningún sitio es indepurable.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { hasGo, GO_TOKEN } from './go-response.js'
import { buildCmuxSendArgv, buildCmuxSendKeyArgv } from './dispatch.js'
import { parseStrictInt } from './argnum.js'

// 30 segundos, el mismo tick con el que agentic-skills sondea a una persona. Y
// 8 horas de plazo, que es su `person_wait_seconds`: el número sale de que el
// caso real es un gate pedido de noche, así que el plazo tiene que cubrir dormir.
//
// El coste está medido y es holgado: 8 h a un sondeo cada 30 s son ~960 llamadas
// a `gh` por slice; con tres slices en vuelo, ~360 a la hora contra un límite de
// 5000.
const DEFAULT_POLL_MS = 30_000
const DEFAULT_TIMEOUT_MS = 8 * 60 * 60 * 1000
const GH_TIMEOUT_MS = 30_000
const CMUX_TIMEOUT_MS = 10_000

const arg = (nombre) => {
  const i = process.argv.indexOf(nombre)
  return i === -1 ? null : process.argv[i + 1] ?? null
}

const ahora = () => new Date().toISOString()
const log = (msg) => process.stdout.write(`${ahora()} ${msg}\n`)

const issue = arg('--issue')
const repo = arg('--repo')
const sesion = arg('--session')
if (!issue || !repo || !sesion) {
  process.stderr.write('uso: ct-watch-go.mjs --issue N --repo owner/name --session "<título de la workspace>"\n')
  process.exit(2)
}

// Los dos plazos se pueden ajustar por entorno, con el mismo criterio que
// CT_NEXT_LAUNCH_TIMEOUT_MS: un valor que no se entiende ABORTA en vez de caer
// al defecto en silencio, porque un plazo mal escrito cambia lo que este
// proceso significa y no querrías descubrirlo ocho horas después.
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
const pollMs = plazo('CT_WATCH_GO_POLL_MS', DEFAULT_POLL_MS)
const timeoutMs = plazo('CT_WATCH_GO_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// La ventana. Se fija ANTES del primer sondeo: todo comentario anterior a este
// instante queda fuera, y con él cualquier `-OK` heredado de un despacho previo
// del mismo issue. Ver go-response.js.
const arrancadoEn = Date.now()

function leerComentarios() {
  try {
    const raw = execFileSync('gh', ['issue', 'view', String(issue), '--repo', repo, '--json', 'comments'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, killSignal: 'SIGKILL',
    })
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.comments) ? parsed.comments : []
  } catch (e) {
    // Un fallo de `gh` NO termina la vigilancia: la red se cae, el token
    // caduca y se renueva, GitHub devuelve un 502. Lo que no puede pasar es que
    // un fallo transitorio se lea como "no hay go" de forma permanente, así que
    // se anota y se vuelve a intentar en el siguiente tick.
    log(`aviso: no se pudo leer el issue (${String(e.message).trim()}) — se reintenta en el próximo tick`)
    return null
  }
}

// Localizar la sesión por su título. NO se reutiliza `queryAllCmuxWorkspaces` de
// ct-next.mjs a propósito: esa función degrada la ausencia en DECISIONES (si no
// encuentra la sesión concluye "abandonado" o "no lanzado", y eso mueve exit
// codes), y por eso necesita distinguir "cmux no contestó" de "cmux contestó que
// no hay nada" y llevar 60 líneas de comentario sobre esquemas que podrían
// cambiar. Este proceso no decide NADA por ausencia: si no la encuentra,
// reintenta; si nunca la encuentra, caduca. La forma sencilla es aquí la
// correcta, y el título viene de cmuxSessionName, así que no hay cadena tecleada
// dos veces.
// Devuelve `{ consultado, ref }`. La distinción entre "cmux contestó y la sesión
// NO está" (`consultado: true, ref: null`) y "no se pudo preguntar"
// (`consultado: false`) es la misma que ct-next.mjs sostiene con tanto cuidado
// en `queryAllCmuxWorkspaces`, y por el mismo motivo: de las dos se sigue algo
// distinto. Que no esté significa que no hay a quién entregarle nada; no poder
// preguntar no significa nada y sólo se puede reintentar.
function consultarSesion() {
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
        if (ws?.custom_title === sesion && typeof ws.ref === 'string') return { consultado: true, ref: ws.ref }
      }
    }
    return { consultado: true, ref: null }
  } catch (e) {
    log(`aviso: no se pudo consultar cmux (${String(e.message).trim()})`)
    return { consultado: false, ref: null }
  }
}

// La línea que se teclea en la sesión del slice. `send` no añade Enter: hay que
// mandarlo aparte, medido en F20/H1.
const LINEA = `El humano ha respondido ${GO_TOKEN} en el issue #${issue}: el gate \`plan\` queda cerrado. Continúa con ct-step next.`

function empujar(ref) {
  execFileSync('cmux', buildCmuxSendArgv({ workspace: ref, text: LINEA }), {
    stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
  })
  execFileSync('cmux', buildCmuxSendKeyArgv({ workspace: ref }), {
    stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
  })
}

log(`vigilando el ${GO_TOKEN} de ${repo}#${issue} para la sesión "${sesion}" — tick ${pollMs} ms, plazo ${timeoutMs} ms`)

const limite = arrancadoEn + timeoutMs
for (;;) {
  const comentarios = leerComentarios()
  if (comentarios && hasGo(comentarios, arrancadoEn)) {
    log(`${GO_TOKEN} visto en ${repo}#${issue}`)
    const { ref } = consultarSesion()
    if (!ref) {
      // Se dice y se muere. Insistir no arregla nada —la sesión no está— y un
      // proceso vivo sondeando una sesión que no existe es peor que su ausencia:
      // parece que el gate sigue vigilado.
      log(`ERROR: no se encontró la sesión de cmux "${sesion}", así que el go no se pudo entregar. Empuja la sesión a mano.`)
      process.exit(1)
    }
    try {
      empujar(ref)
    } catch (e) {
      log(`ERROR: el go se vio pero no se pudo teclear en "${sesion}" (${ref}): ${String(e.message).trim()}. Empuja la sesión a mano.`)
      process.exit(1)
    }
    log(`línea entregada a "${sesion}" (${ref}). Vigilancia terminada.`)
    process.exit(0)
  }
  // ---------------------------------------------------------------------------
  // SIN SESIÓN NO HAY NADA QUE VIGILAR, Y ESO ES UNA COTA DE VERDAD.
  //
  // El plazo de ocho horas cubre que la persona esté durmiendo. Lo que no cubre
  // —y se vio a la primera— es que la sesión del slice desaparezca: entonces el
  // vigilante sigue sondeando GitHub durante horas para entregarle una línea a
  // algo que ya no existe. Medido: la primera corrida de la suite completa dejó
  // 42 procesos así.
  //
  // Vale igual en producción, y es la razón de fondo: cierras la ventana del
  // slice, o el agente muere, y su vigilante se apaga solo. Un proceso vivo
  // vigilando una sesión que no está es peor que su ausencia, porque parece que
  // el gate sigue cubierto.
  //
  // Sólo se muere si cmux CONTESTÓ que no está. Si no se pudo preguntar (daemon
  // caído, timeout), eso no significa nada y se reintenta: es la misma
  // distinción que ct-next.mjs sostiene entre "no hay sesión" y "no
  // concluyente".
  // ---------------------------------------------------------------------------
  const sesionAhora = consultarSesion()
  if (sesionAhora.consultado && !sesionAhora.ref) {
    log(`la sesión "${sesion}" ya no existe, así que no hay a quién entregarle el go. Vigilancia terminada.`)
    process.exit(4)
  }
  if (Date.now() >= limite) {
    log(`plazo agotado sin ver ningún ${GO_TOKEN} en ${repo}#${issue}. La sesión sigue parada en el gate: dale el go en el issue y empújala a mano, o vuelve a lanzar este vigilante.`)
    process.exit(3)
  }
  await sleep(Math.min(pollMs, Math.max(0, limite - Date.now())))
}
