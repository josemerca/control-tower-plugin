// ============================================================================
// governed-repo.js — ¿CORRE ESTE LOOP EN EL REPO DE ESTE cwd?
//
// Es el único sitio de la puerta de closing keywords que toca el disco, y por
// eso vive aparte de closing-keywords.js, que es puro y se testea sin ficheros.
//
// La señal es el marcador que /ct-init siembra en el AGENTS.md del repo: si
// está, este repo tiene el contrato del loop y sus issues los gobierna el loop.
// No se usa `git rev-parse`: subir con `fs` no depende de que `git` esté en el
// PATH ni paga un subproceso.
// ============================================================================
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CONTRACT_MARKER = '<!-- ct-init:slices-contract -->'

const AGENTS = 'AGENTS.md'

// `.git` puede ser un DIRECTORIO (checkout normal) o un FICHERO con un
// `gitdir:` dentro (worktree). Los agentes despachados trabajan SIEMPRE en un
// worktree, así que mirar sólo directorios dejaría fuera la mitad de la
// cobertura de la puerta, y en silencio.
function isRepoRoot(dir) {
  try { statSync(join(dir, '.git')); return true } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false
    throw e
  }
}

/**
 * probeGovernedRepo: `{ governed }` cuando se puede afirmar, `{ error }` cuando
 * no se ha podido mirar.
 *
 * La distinción es la que importa: quien llama tiene que poder tratar «no lo
 * sé» distinto de «no». Un `{ governed: false }` inventado sobre una lectura
 * que falló dejaría pasar exactamente el commit que esta puerta existe para
 * parar.
 */
export function probeGovernedRepo(cwd) {
  let dir
  try { dir = resolve(String(cwd || '')) } catch (e) { return { error: `cwd invalido: ${e.message}` } }
  try {
    statSync(dir)
  } catch (e) {
    return { error: `no se ha podido leer el directorio de trabajo (${e.code || e.message})` }
  }
  try {
    for (;;) {
      if (isRepoRoot(dir)) {
        let texto
        try {
          texto = readFileSync(join(dir, AGENTS), 'utf8')
        } catch (e) {
          // Que no HAYA AGENTS.md es una respuesta: este repo no lleva el
          // contrato. Que no se pueda LEER no lo es.
          if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { governed: false }
          return { error: `no se ha podido leer ${AGENTS} (${e.code || e.message})` }
        }
        return { governed: texto.includes(CONTRACT_MARKER) }
      }
      const padre = dirname(dir)
      if (padre === dir) return { governed: false }
      dir = padre
    }
  } catch (e) {
    return { error: `no se ha podido determinar la raiz del repo (${e.code || e.message})` }
  }
}
