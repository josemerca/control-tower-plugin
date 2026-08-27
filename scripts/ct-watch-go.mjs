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
// y sólo si ese slice lleva el gate `plan` Y contó como lanzado. Desprendido
// porque tiene que sobrevivir a que se cierre la sesión coordinadora: si sólo
// viviera mientras alguien mira, no serviría para el caso que motiva todo esto —
// el gate pedido a la 01:00 esperando a que alguien se despierte, que en la
// medida de F33 fue el 54% del reloj de un epic.
//
// POR QUÉ NO UNA WORKSPACE DE CMUX. Se consideró, porque es el segundo plano que
// este repo ya conoce, y se descartó con un motivo concreto: lanzar por cmux es
// TECLEAR UN COMANDO EN UN PTY, y ése es el camino frágil de este plugin. Existe
// `launch-sentinel.js` entero porque no había forma de saber si el comando llegó
// a ejecutarse, y `ct-next` lleva un bucle de reenvío porque el prompt del shell
// se comía caracteres. Pagar todo eso para un bucle que nadie va a mirar no sale
// a cuenta: un `spawn` no pasa por ningún pty, ni por comillas, ni necesita
// centinela.
//
// LÍMITE HEREDADO, DICHO SIN ADORNOS: para ENTREGAR la línea sí se usa ese
// camino frágil (`cmux send` + `send-key`), y aquí no hay centinela que pruebe
// que la sesión la recibió. Lo único que se sabe es que los dos comandos
// devolvieron 0, y así se dice en el log — no «la sesión ha arrancado». Un
// centinela de verdad exigiría que el agente escribiera algo, o sea depender del
// agente al que se le entrega, que es justo lo que este reparto evita. Ese
// límite se acepta y no se disfraza.
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
// EL LOG LO ABRE ESTE PROCESO, no quien lo lanza, y va fuera del repo
// (`~/.claude/control-tower/log/`). No es una decisión nueva: es donde
// run-metrics.js#metricsPath ya pone lo suyo, y por el motivo que ya está
// escrito allí — «fuera del repo, para que ningún git add de la slice la meta en
// la PR». Un proceso que corre cuando no estás mirando y no deja rastro en
// ningún sitio es indepurable. Lo abre ÉL porque, cuando lo abría `ct-next`, la
// suite acabó creando ficheros en el `$HOME` real de quien la corriera — que es
// exactamente lo que `__tests__/fixtures/hermetic-env.js` existe para evitar— y
// además dejaba un descriptor sin cerrar por slice.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { hasGo, commentIds, GO_TOKEN } from './go-response.js'
import { buildCmuxSendArgv, buildCmuxSendKeyArgv } from './dispatch.js'
import { findWorkspaceByTitle } from './cmux.js'
import { arg, sleep, plazo, abrirLog } from './watch-common.js'

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

const issue = arg(process.argv, '--issue')
const repo = arg(process.argv, '--repo')
const sesion = arg(process.argv, '--session')
const logPath = arg(process.argv, '--log')
// EL COMPROMISO ENTRA POR ARGV, Y EL NONCE NO ENTRA NUNCA (F38). Este proceso
// corre desprendido y su argv lo enseña `ps` a cualquier proceso del mismo uid
// —el agente incluido—, igual que su log es un fichero legible. Así que lo que
// viaja hasta aquí es el sha256 del go, que a quien lo lee no le sirve de nada:
// el nonce sólo existe en la pantalla de quien despachó y en la cabeza de quien
// lo teclea.
//
// SIN COMPROMISO NO SE VIGILA. Se sale con 2 en vez de caer al `-OK` desnudo de
// ayer: un vigilante que reconociera el token fijo sería una puerta que se abre
// OMITIENDO un argumento, y el agente que quisiera saltarse el gate sólo tendría
// que relanzar el vigilante él. Un vigilante que no arranca lo nota la persona
// que espera —va a mirar—; uno que arranca con la puerta vieja no lo nota nadie.
const goHash = (arg(process.argv, '--go-hash') || '').trim().toLowerCase()
if (!issue || !repo || !sesion) {
  process.stderr.write('uso: ct-watch-go.mjs --issue N --repo owner/name --session "<título de la workspace>" --go-hash <sha256 del go> [--log <ruta>]\n')
  process.exit(2)
}
if (!/^[0-9a-f]{64}$/.test(goHash)) {
  process.stderr.write(`--go-hash inválido o ausente${goHash ? `: "${goHash}"` : ''} — debe ser el sha256 hex (64 caracteres) del go de ESTE despacho, el que /ct-next registró al lanzar. Sin él este vigilante no sabría qué reconocer, y NO cae al \`${GO_TOKEN}\` sin nonce a propósito: esa puerta la abriría el propio agente.\n`)
  process.exit(2)
}

const { log, terminar } = abrirLog(logPath)
const pollMs = plazo('CT_WATCH_GO_POLL_MS', DEFAULT_POLL_MS)
const timeoutMs = plazo('CT_WATCH_GO_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)

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

// Devuelve `{ consultado, ref }`. La distinción entre "cmux contestó y la sesión
// NO está" (`consultado: true, ref: null`) y "no se pudo preguntar"
// (`consultado: false`) es la misma que ct-next.mjs sostiene con tanto cuidado
// en `queryAllCmuxWorkspaces`, y por el mismo motivo: de las dos se sigue algo
// distinto. Que no esté significa que no hay a quién entregarle nada; no poder
// preguntar no significa nada y sólo se puede reintentar.
//
// LAS DOS SE USAN, y en los dos sitios. La primera versión de este fichero
// distinguía las dos aquí y luego tiraba `consultado` en el camino de ENTREGA:
// un timeout de cmux justo en el tick en que llegaba el `-OK` mataba la
// vigilancia de ocho horas en el único instante que importaba, y encima
// diagnosticaba "no se encontró la sesión" cuando la sesión estaba ahí. Lo cazó
// una revisión adversarial.
//
// LA BÚSQUEDA VIVE EN scripts/cmux.js desde esta ronda, y con ella llega una
// guarda que este fichero no tenía: si cmux renombrara `custom_title`, la
// lectura cruda de antes no casaba con nada, devolvía `consultado: true, ref:
// null` — «cmux contestó y la sesión no está»— y este vigilante se apagaba con
// exit 4 declarando muerta una sesión que estaba ahí delante, tirando el go de
// esa persona. `ct-next.mjs` ya se había peleado con esto (D5, hallazgo B) y su
// conclusión es la que ahora aplica también aquí: un campo cuyo esquema no
// reconocemos degrada a NO CONCLUYENTE, jamás a "verificado que no está".
function consultarSesion() {
  const r = findWorkspaceByTitle(sesion, { timeoutMs: CMUX_TIMEOUT_MS })
  if (!r.consultado) log('aviso: no se pudo consultar cmux (o su respuesta no trae el campo del título que este plugin sabe leer)')
  return r
}

// La línea que se teclea en la sesión del slice. `send` no añade Enter: hay que
// mandarlo aparte, medido en F20/H1.
const LINEA = `El humano ha respondido ${GO_TOKEN} en el issue #${issue}: el gate \`plan\` queda cerrado. Continúa con ct-step next.`

log(`vigilando el ${GO_TOKEN} de ${repo}#${issue} para la sesión "${sesion}" — tick ${pollMs} ms, plazo ${timeoutMs} ms, go ${goHash.slice(0, 12)}…`)

// ---------------------------------------------------------------------------
// LA FOTO INICIAL. La ventana son los comentarios que YA ESTABAN (ver
// go-response.js), así que hay que sacarla antes de buscar nada — y hay que
// SACARLA DE VERDAD: si la primera lectura falla y se diera por vacía, un `-OK`
// heredado de un despacho anterior contaría como nuevo y saltaría el gate en
// silencio, que es justo lo que la ventana existe para impedir. Así que se
// reintenta hasta conseguirla, dentro del mismo plazo.
// ---------------------------------------------------------------------------
const arrancadoEn = Date.now()
const limite = arrancadoEn + timeoutMs
let previos = null
while (previos === null) {
  const iniciales = leerComentarios()
  if (iniciales !== null) { previos = commentIds(iniciales); break }
  if (Date.now() >= limite) {
    log(`plazo agotado sin poder leer ni una vez los comentarios de ${repo}#${issue}: no se puede distinguir un go nuevo de uno heredado, así que no se entrega nada. Empuja la sesión a mano tras dar el go.`)
    terminar(3)
  }
  await sleep(Math.min(pollMs, Math.max(0, limite - Date.now())))
}
log(`foto inicial: ${previos.size} comentario(s) ya presentes, que no cuentan como respuesta`)

for (;;) {
  const comentarios = leerComentarios()
  if (comentarios && hasGo(comentarios, previos, goHash)) {
    log(`${GO_TOKEN} visto en ${repo}#${issue}`)
    const { consultado, ref } = consultarSesion()
    if (ref) {
      try {
        execFileSync('cmux', buildCmuxSendArgv({ workspace: ref, text: LINEA }), {
          stdio: ['ignore', 'ignore', 'pipe'], timeout: CMUX_TIMEOUT_MS, killSignal: 'SIGKILL',
        })
      } catch (e) {
        log(`ERROR: el go se vio y el texto no se pudo escribir en "${sesion}" (${ref}): ${String(e.message).trim()}. Empuja la sesión a mano.`)
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
        log(`ERROR: el texto quedó escrito en la línea de edición de "${sesion}" (${ref}) pero el Enter falló: ${String(e.message).trim()}. Ve a esa ventana y pulsa Enter, o empuja la sesión a mano.`)
        terminar(1)
      }
      // Lo que se sabe es esto y no más: los dos comandos devolvieron 0. No hay
      // centinela que pruebe que la sesión lo recibió y actuó (ver la cabecera),
      // así que el mensaje no afirma que haya arrancado.
      log(`línea enviada a "${sesion}" (${ref}): \`cmux send\` y \`send-key Enter\` devolvieron 0. No hay forma de comprobar desde aquí que la sesión la haya procesado. Vigilancia terminada.`)
      terminar(0)
    }
    if (consultado) {
      log(`ERROR: el go se vio, pero cmux dice que no existe ninguna sesión "${sesion}", así que no hay a quién entregárselo. Empuja la sesión a mano.`)
      terminar(1)
    }
    // No se pudo PREGUNTAR por la sesión. De eso no se sigue nada, y menos con
    // el go ya en la mano: se reintenta en el próximo tick.
    log(`el go está visto pero no se pudo consultar cmux para localizar la sesión — se reintenta la entrega en el próximo tick`)
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
  // Sólo se muere si cmux CONTESTÓ que no está.
  // ---------------------------------------------------------------------------
  const sesionAhora = consultarSesion()
  if (sesionAhora.consultado && !sesionAhora.ref) {
    log(`la sesión "${sesion}" ya no existe, así que no hay a quién entregarle el go. Vigilancia terminada.`)
    terminar(4)
  }
  if (Date.now() >= limite) {
    log(`plazo agotado sin ver ningún ${GO_TOKEN} válido en ${repo}#${issue}. La sesión sigue parada en el gate: dale el go en el issue y empújala a mano, o vuelve a lanzar este vigilante.`)
    terminar(3)
  }
  await sleep(Math.min(pollMs, Math.max(0, limite - Date.now())))
}
