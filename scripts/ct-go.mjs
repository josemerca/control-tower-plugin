#!/usr/bin/env node
// ============================================================================
// CT-GO — REEMITIR EL GO DE UN DESPACHO QUE YA ESTÁ EN VUELO.
//
// F38. El nonce del go se sortea una vez, al despachar, y sólo existe en la
// pantalla de quien despachó. Eso deja un modo de fallo cotidiano: la pantalla
// se pierde (se cierra la sesión, se hace scroll, se despachó ayer) y entonces
// nadie puede cerrar el gate `plan` — ni el vigilante arranca la sesión, ni
// `dispatch-check --release` libera. Un slice atascado por haber perdido un
// papelito es exactamente el modo de fallo que este repo lleva tres rondas
// quitando, así que la recuperación es una pieza del mecanismo, no un extra.
//
// QUÉ HACE: sortea un nonce NUEVO, reescribe el compromiso de ese issue (el
// anterior deja de valer en el mismo acto — es lo que se quiere: un go viejo que
// siguiera sirviendo sería un go de más) y lo dicta por el canal de siempre
// (go-channel.js, `CT_GO_CHANNEL` incluido).
//
// QUÉ NO HACE, a propósito: NO relanza el vigilante. El vigilante que esté vivo
// está buscando el compromiso ANTERIOR, así que tras contestar el go nuevo habrá
// que empujar la sesión a mano — que es el camino que ya existía cuando el
// vigilante caducaba, y está documentado. Relanzarlo desde aquí exigiría el
// título de la workspace de cmux y duplicar el arranque del hijo desprendido;
// dos piezas que sólo servirían para ahorrar un empujón manual que la persona ya
// sabe dar. Se dice en la salida, no se esconde.
// ============================================================================

import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { newGoNonce, goCommitment } from './go-response.js'
import { writeGoCommitment } from './go-registry.js'
import { emitGoNonce } from './go-channel.js'
import { parseStrictInt } from './argnum.js'

const arg = (nombre) => {
  const i = process.argv.indexOf(nombre)
  return i === -1 ? null : process.argv[i + 1] ?? null
}

const usage = 'uso: ct-go.mjs --issue N --repo owner/name'
const issueRaw = arg('--issue')
const repo = arg('--repo')
const issue = parseStrictInt(String(issueRaw ?? ''))
if (!issueRaw || issue == null || issue <= 0 || !repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  process.stderr.write(`${!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) ? '--repo debe ser owner/name' : `--issue inválido: "${issueRaw}" — un número de issue en dígitos decimales`}\n${usage}\n`)
  process.exit(2)
}

const nonce = newGoNonce(randomBytes(4))
const commitment = goCommitment(nonce)
let ruta
try {
  ruta = writeGoCommitment({
    repo, issue, commitment,
    configDir: process.env.CLAUDE_CONFIG_DIR || null,
    home: homedir(),
  })
} catch (e) {
  process.stderr.write(`no se ha podido registrar el go de ${repo}#${issue}: ${e.message}. Sin registro, \`dispatch-check --release\` seguirá negándose (exit 9): el compromiso vive fuera del repo a propósito, así que comprueba los permisos de esa carpeta.\n`)
  process.exit(1)
}

console.log(`go de ${repo}#${issue} reemitido — el anterior (si había) ya no vale. Registro: ${ruta}`)
emitGoNonce(issue, nonce)
console.log(`  OJO: el vigilante que lanzó /ct-next (si sigue vivo) está buscando el go ANTERIOR, así que tras contestar tendrás que empujar la sesión a mano.`)
