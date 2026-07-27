// Entorno HERMÉTICO para los tests que invocan ct-next.mjs (D4).
//
// El bloque de precondiciones de D4 (ver ct-next.mjs) comprueba cosas del
// ENTORNO REAL de la máquina: que `cmux` y `claude` estén en el PATH y que el
// CLAUDE_CONFIG_DIR resuelto exista en disco. Sin esto, la suite entera
// pasaría a depender del $HOME y del PATH de quien la corra: verificado por
// construcción — con `HOME=<vacío>`, 19 tests PREEXISTENTES de
// ct-next-dryrun.test.js (que no tienen nada que ver con D4) fallaban con
// `expected 1 to be +0` porque el preflight abortaba al no encontrar
// ~/.claude-personal.
//
// La solución NO es relajar la comprobación (ese es justo el arreglo), sino
// darle a los tests un entorno propio y determinista:
//   - dos directorios de cuenta de verdad, bajo tmpdir, creados aquí;
//   - stubs de `cmux` y `claude` en el PATH, por delante de los binarios
//     reales de la máquina.
// Los tests que quieren ejercer la AUSENCIA de un binario siguen fijando su
// propio PATH (ver ct-next-preconditions.test.js) — nunca omitiendo el stub
// y confiando en que el binario real no esté, que es como un agente anterior
// de este proyecto acabó lanzando un workspace de cmux de verdad.
//
// Los nombres de los directorios terminan en `.claude-personal`/
// `.claude-work` a propósito: varias aserciones preexistentes comprueban que
// el mapa de cuentas resuelve a una ruta que "parece" la cuenta correcta
// (`/\.claude-personal/`), y esas aserciones tienen que seguir significando
// lo mismo.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(tmpdir(), 'ct-loop-test-accounts')
export const TEST_PERSONAL_DIR = join(root, '.claude-personal')
export const TEST_WORK_DIR = join(root, '.claude-work')
mkdirSync(TEST_PERSONAL_DIR, { recursive: true })
mkdirSync(TEST_WORK_DIR, { recursive: true })

const fixturesDir = dirname(fileURLToPath(import.meta.url))

// Stubs de binarios que el preflight solo BUSCA en el PATH (statSync +
// accessSync), nunca ejecuta. Van también aquí para que los tests que no
// fijan PATH no dependan de que la máquina tenga `cmux`/`claude` instalados.
export const FAKE_BIN_DIRS = [
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
]

export const ACCOUNT_ENV = {
  CT_ACCOUNT_PERSONAL_DIR: TEST_PERSONAL_DIR,
  CT_ACCOUNT_WORK_DIR: TEST_WORK_DIR,
}

// hermeticEnv: base de entorno para cualquier invocación de ct-next.mjs en
// los tests. `pathPrefix` son los directorios de stubs que ese test ya
// quisiera poner delante (git/gh/cmux).
export function hermeticEnv(pathPrefix = []) {
  return {
    ...ACCOUNT_ENV,
    PATH: [...pathPrefix, ...FAKE_BIN_DIRS, process.env.PATH].join(':'),
  }
}
