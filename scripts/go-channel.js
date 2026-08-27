// ============================================================================
// GO-CHANNEL — POR DÓNDE LE LLEGA EL NONCE A LA PERSONA, y el límite que eso
// tiene que decir en voz alta.
//
// F38. El go del gate `plan` es `-OK <nonce>`: el nonce se sortea al despachar y
// tiene que llegar a UNA persona y a nadie más. Este fichero es ese último
// tramo, y existe aparte porque lo usan dos programas —/ct-next al despachar y
// ct-go.mjs al reemitir— y el texto que le dicta el go al humano no puede
// divergir entre los dos: el síntoma de que divergiera es una persona tecleando
// un permiso correcto que no abre nada.
//
// EL DEFECTO POR DEFECTO, dicho: stdout es donde está mirando quien despachó… y
// cuando /ct-next lo corre una sesión de Claude, stdout es TAMBIÉN el contexto de
// esa sesión. Así que la barandilla, en su forma por defecto, protege del agente
// IMPLEMENTADOR —el que trabaja en el worktree, el que se juega el veredicto, el
// que tiene el incentivo y el `gh`— y no de la coordinadora, que ya es parte de
// confianza en todo lo demás: despacha, guarda `.agent/STATE.md` y mergea. Es el
// reparto correcto para el modo de fallo que se ha visto en campo (un agente que
// se concede su propio permiso), y no es el reparto completo.
//
// CT_GO_CHANNEL=notify, para quien no quiera conceder ni eso: el nonce sale por
// una notificación del sistema (osascript) y por stdout no va más que el aviso de
// que se ha enviado. Así el nonce no entra en el contexto de NINGÚN agente. No es
// el defecto porque es un canal que puede no existir —sin GUI, por ssh, sin
// permisos de notificación— y un go que no llega deja el slice parado en el gate.
// ============================================================================

import { execFileSync } from 'node:child_process'
import { goBody } from './go-response.js'

export const GO_CHANNEL_ENV = 'CT_GO_CHANNEL'

// La línea, en una sola función: la teclea una persona leyéndola, así que dice
// el cuerpo EXACTO (goBody) en vez de describirlo.
export function goDictationLine(issue, nonce) {
  return `  GO de #${issue}: contesta exactamente \`${goBody(nonce)}\` en un comentario del issue.`
}

export function emitGoNonce(issue, nonce, { log = console.log, env = process.env, run = execFileSync } = {}) {
  const canal = String(env[GO_CHANNEL_ENV] || '').trim().toLowerCase()
  if (canal !== 'notify') return log(goDictationLine(issue, nonce))
  try {
    // El texto va en un ARGUMENTO, no interpolado dentro del AppleScript: así no
    // hay nada que escapar y ningún valor puede acabar ejecutándose. `on run
    // argv` es el enganche estándar para eso.
    run('osascript', [
      '-e', 'on run argv\ndisplay notification (item 1 of argv) with title "Control Tower" subtitle "go del gate plan"\nend run',
      goBody(nonce),
    ], { stdio: 'ignore', timeout: 10_000 })
    log(`  GO de #${issue}: enviado por notificación del sistema (${GO_CHANNEL_ENV}=notify) — no se imprime aquí a propósito.`)
  } catch (e) {
    // Cae a stdout DICIÉNDOLO. Callarse aquí dejaría el gate sin go; caer sin
    // avisar sería peor todavía: la persona creería que el nonce no ha pasado
    // por el contexto de ningún agente cuando sí lo ha hecho.
    log(`  aviso: la notificación del go de #${issue} falló (${e.message}) — va por aquí, o sea que el nonce SÍ entra en el contexto de esta sesión.`)
    log(goDictationLine(issue, nonce))
  }
}
