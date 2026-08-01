// ============================================================================
// F22 — DÓNDE VIVE EL ESTADO DE UNA SESIÓN, Y POR QUÉ SON DOS FICHEROS.
//
// El worktree de un slice tiene DOS ficheros de estado:
//
//   .agent/STATE.md  TRACKEADO. El de la sesión coordinadora, tal como venía
//                    en la base desde la que se cortó el worktree. A CERO
//                    DIFF: el dispatcher ya no lo toca.
//   .agent/SLICE.md  IGNORADO. El estado del slice, sembrado por /ct-next.
//
// La precedencia de abajo es carga estructural, no comodidad. Sin ella, un
// agente que se re-hidrata tras un /clear leería el STATE.md trackeado del
// worktree —que no es su semilla sino el estado de la COORDINADORA congelado
// en la base: el epic, no el slice— y se hidrataría creyendo que es la
// coordinadora. Es el mismo defecto que esta ronda arregla, con el vector
// invertido.
//
// Y la presencia del fichero ES la señal de "estoy en un worktree de slice":
// no hace falta una variable de entorno, ni mirar si el cwd cuelga de
// .worktrees/, ni preguntarle a git si esto es un worktree enlazado. Un
// worktree de slice siempre tiene SLICE.md porque lo siembra el dispatcher; el
// checkout de la coordinadora no lo tiene nunca.
//
// MÓDULO PROPIO Y SIN DEPENDENCIAS, a propósito: lo consumen los dos hooks
// (que se bundlean a dist/), ct-next.mjs y dispatch-check.mjs. Este último NO
// importa state.js, y hacerlo sólo por una constante de path le metería `yaml`
// en el grafo de dependencias a cambio de nada.
// ============================================================================
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const STATE_REL_PATH = '.agent/STATE.md'
export const SLICE_REL_PATH = '.agent/SLICE.md'

// Los dos paths que el PR de un slice no puede introducir NUNCA. NO es
// `.agent/` entero: `conventions-ack.md` vive ahí y es un registro de
// decisiones que sí puede cambiar legítimamente dentro de un slice.
export const NEVER_IN_A_SLICE_PR = [STATE_REL_PATH, SLICE_REL_PATH]

/**
 * @param {string} cwd
 * @returns {{ path: string|null, kind: 'slice'|'coordinator'|'none' }}
 */
export function resolveStatePath(cwd) {
  const slice = join(cwd, SLICE_REL_PATH)
  if (existsSync(slice)) return { path: slice, kind: 'slice' }
  const state = join(cwd, STATE_REL_PATH)
  if (existsSync(state)) return { path: state, kind: 'coordinator' }
  return { path: null, kind: 'none' }
}
