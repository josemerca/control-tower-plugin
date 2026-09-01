// El go del gate `plan` (F38), para los tests que ejercen `--release`.
//
// Desde esta ronda `dispatch-check --release` tiene una puerta más (exit 9): el
// gate `plan` no se cierra solo, y lo cierra un comentario `-OK <nonce>` con el
// nonce de ESE despacho. Eso le da a cualquier test de release dos requisitos
// nuevos que no son el objeto de su prueba: un compromiso registrado (fuera del
// repo, en el directorio de la coordinadora) y un comentario que lo satisfaga.
//
// Vive en `fixtures/` y no copiado en cada test por el motivo de siempre en este
// repo: el día que el formato del registro cambie, un fixture compartido rompe
// una vez y en un sitio, y cuatro copias rompen cuatro veces mintiendo sobre la
// causa.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { goBody, goCommitment, newGoNonce } from '../../scripts/go-response.js'
import { writeGoCommitment } from '../../scripts/go-registry.js'

// Nonce FIJO: el azar lo pone quien llama (`newGoNonce` recibe los bytes), justo
// para que un test pueda decir qué go es el bueno.
export const NONCE = newGoNonce(Buffer.from([0x3f, 0x9a, 0x1c, 0x04]))
export const GO_HASH = goCommitment(NONCE)
export const GO = goBody(NONCE)

// El comentario tal como lo devuelve `gh issue view --json comments`.
export const comentarioDelGo = (login = 'josemerca') => ({
  id: 'IC_go', body: GO, createdAt: '2026-08-25T10:00:00Z', author: { login },
})

// Registra el compromiso de un despacho y devuelve las variables de entorno que
// hay que sumarle a la invocación: el directorio de la coordinadora donde vive el
// registro, y los comentarios que el stub de `gh` va a devolver.
//
// `dado: false` registra el compromiso pero NO pone el comentario: es el caso de
// «nadie ha dado el go todavía», que es lo que la puerta 9 tiene que retener.
export function envDelGo({ repo = 'o/r', issue = 9, dado = true, configDir = null } = {}) {
  const dir = configDir || mkdtempSync(join(tmpdir(), 'ct-go-cfg-'))
  writeGoCommitment({ repo, issue, commitment: GO_HASH, configDir: dir })
  return {
    CLAUDE_CONFIG_DIR: dir,
    FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: dado ? [comentarioDelGo()] : [] }),
  }
}
