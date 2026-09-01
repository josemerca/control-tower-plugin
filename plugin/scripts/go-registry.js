// ============================================================================
// GO-REGISTRY — DÓNDE VIVE EL COMPROMISO DEL GO, y por qué no en GitHub.
//
// F38. El go del gate `plan` es `-OK <nonce>` (go-response.js): el nonce lo
// sortea la coordinadora al despachar y lo imprime sólo en su pantalla; quien
// verifica guarda su sha256. Este fichero es el sitio donde se guarda ese
// sha256 y las dos funciones que lo escriben y lo leen.
//
// POR QUÉ NO EN EL ISSUE, NI EN UNA LABEL, NI EN EL CUERPO DEL PR. Porque el
// agente tiene `gh`: todo lo que vive en GitHub es escribible por él. Un
// compromiso en una label lo convierte en un juego de una sola jugada — el
// agente sortea su propio nonce, escribe SU hash en la label, comenta su propio
// `-OK <nonce>` y la puerta 9 lo da por bueno. El compromiso tiene que vivir en
// el único sitio del sistema que el agente no toca por guion: el estado privado
// de la sesión coordinadora, fuera del repo y fuera del worktree.
//
// Y EL LÍMITE, dicho aquí porque es aquí donde se decide: el agente corre con el
// mismo uid en la misma máquina, así que PUEDE escribir este fichero. Lo que
// esta ruta compra no es imposibilidad, es que falsificar el go salga del
// repertorio normal del agente (un comentario en su propio issue, con `gh`, que
// el kickoff ya le manda usar) y pase a ser manipulación del estado de la
// coordinadora — la misma clase de acto que reescribir el plugin que lo juzga,
// que es la línea detrás de la que ya están TODOS los gates de este repo. El
// cierre de verdad exige un verificador que no corra bajo ese uid (CI, u otra
// identidad); está nombrado en el README y sin construir.
//
// UN FICHERO POR ISSUE Y NO UN ÍNDICE. Un índice único lo reescriben dos
// despachos a la vez —/ct-next despacha tandas— y una escritura perdida deja un
// slice sin poder liberar. Un fichero por issue no tiene esa carrera, y de
// propina el borrado de uno no arrastra a los demás.
// ============================================================================

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { controlTowerDir } from './run-metrics.js'

// El nombre del fichero: `<owner>__<repo>-<issue>.json`. El repo entra en el
// nombre porque el mismo número de issue existe en todos los repos del mundo y
// esta carpeta es de la MÁQUINA, no de un repo: sin él, despachar #7 en un
// segundo repo pisaría el go de #7 del primero. Se sanea a `[A-Za-z0-9._-]`
// porque esto acaba siendo una ruta, y un `..` o una `/` en el nombre de un
// repo escribiría fuera de la carpeta.
export function goFileName(repo, issue) {
  const slug = String(repo ?? '').replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_')
  const n = String(issue ?? '').replace(/[^0-9]/g, '')
  return `${slug || 'sin-repo'}-${n || '0'}.json`
}

export function goDir(opts = {}) {
  return join(controlTowerDir(opts), 'go')
}

// LA RUTA TIENE QUE SER ABSOLUTA, y si no lo es esto no escribe NADA.
//
// `controlTowerDir` cae a `homedir()` cuando no hay `CLAUDE_CONFIG_DIR`, y con
// un `HOME` vacío eso resuelve a cadena vacía: la ruta sale RELATIVA y el
// compromiso acabaría en el cwd de quien invoque —dentro del repo del slice, en
// el caso normal—. Verificado por construcción: un test de la suite que corre
// con `HOME=''` dejó un `.claude/control-tower/go/o__r-90.json` en el checkout.
//
// Y el modo de fallo es de los malos: se escribe donde nadie va a leerlo, así
// que el vigilante arranca, la persona da el go… y `--release` se niega porque
// busca el compromiso en el sitio de verdad. Un slice atascado sin que nada
// falle. Mejor no registrar y decirlo: quien llama convierte eso en un aviso con
// el remedio (`ct-go`), y la puerta 9 en un «no se ha podido comprobar».
function exigirRutaAbsoluta(dir) {
  if (!isAbsolute(dir)) {
    throw new Error(`el directorio del registro del go no resuelve a una ruta absoluta ("${dir}") — con CLAUDE_CONFIG_DIR y HOME sin valor no se sabe DÓNDE vive el estado de la coordinadora, y escribirlo en el cwd lo dejaría donde nadie lo lee`)
  }
  return dir
}

export function goPath({ repo, issue, configDir = null, home = null } = {}) {
  return join(goDir({ configDir, home }), goFileName(repo, issue))
}

// LA ESCRITURA. `mode` restrictivo en el fichero y en la carpeta: no protege de
// un proceso del mismo uid (ver el límite de arriba), pero sí de cualquier otro
// —y un permiso ancho en un fichero que existe para autorizar se lee como
// descuido cuando alguien lo audita. `writeFileSync` con `flag: 'w'` a
// propósito: reescribir es el caso NORMAL (redespachar un slice sortea un nonce
// nuevo, y el viejo tiene que dejar de valer en el mismo acto).
export function writeGoCommitment({ repo, issue, commitment, configDir = null, home = null }) {
  const dir = exigirRutaAbsoluta(goDir({ configDir, home }))
  const ruta = goPath({ repo, issue, configDir, home })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const cuerpo = JSON.stringify({ repo: String(repo ?? ''), issue: Number(issue), commitment: String(commitment) }, null, 2)
  writeFileSync(ruta, `${cuerpo}\n`, { encoding: 'utf8', mode: 0o600, flag: 'w' })
  return ruta
}

// LA LECTURA, con TRES respuestas y no dos. `{ commitment }` es «hay go
// registrado»; `{ missing: true }` es «este despacho no registró ninguno»; y
// `{ error }` es «hay algo y no se ha podido leer». La tercera existe por la
// doctrina de este repo: no se afirma limpio lo que no se pudo mirar. Quien
// llama las distingue porque significan cosas distintas para el humano — una se
// arregla con `ct-go`, la otra con `chmod` o con un `cat`.
export function readGoCommitment({ repo, issue, configDir = null, home = null } = {}) {
  const ruta = goPath({ repo, issue, configDir, home })
  try {
    exigirRutaAbsoluta(goDir({ configDir, home }))
  } catch (e) {
    // «No se ha podido comprobar», nunca «no hay go»: una ruta relativa apunta a
    // un sitio distinto según desde dónde se invoque, así que su ausencia no
    // dice nada.
    return { error: e.message, path: ruta }
  }
  let raw
  try {
    raw = readFileSync(ruta, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return { missing: true, path: ruta }
    return { error: e.message, path: ruta }
  }
  let dato
  try {
    dato = JSON.parse(raw)
  } catch (e) {
    return { error: `no es JSON legible (${e.message})`, path: ruta }
  }
  const commitment = typeof dato?.commitment === 'string' ? dato.commitment.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(commitment)) {
    return { error: 'el campo `commitment` no es un sha256 hex de 64 caracteres', path: ruta }
  }
  return { commitment, path: ruta }
}
