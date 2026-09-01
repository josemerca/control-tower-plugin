// Entorno HERMÉTICO para los tests que invocan ct-next.mjs.
//
// El preflight de ct-next comprueba cosas del ENTORNO REAL de la máquina: que
// `cmux` y el binario del agente estén en el PATH. Sin estos stubs la suite
// dependería de lo que tenga instalado quien la corre — y, peor, un test podría
// lanzar un workspace de cmux DE VERDAD (ya pasó una vez en este proyecto).
//
// Los tests que quieren ejercer la AUSENCIA de un binario fijan su propio PATH
// (ver ct-next-preconditions.test.js) — nunca omitiendo el stub y confiando en
// que el binario real no esté.
//
// F35: aquí vivían además dos directorios de cuenta (TEST_PERSONAL_DIR /
// TEST_WORK_DIR) y el ACCOUNT_ENV que los inyectaba, porque el preflight
// exigía que el CLAUDE_CONFIG_DIR resuelto existiera en disco. Al irse la
// resolución de cuenta se fueron con ella: no queda nada que apuntar.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = dirname(fileURLToPath(import.meta.url))

// Stubs de binarios que el preflight solo BUSCA en el PATH (statSync +
// accessSync), nunca ejecuta.
export const FAKE_BIN_DIRS = [
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
]

// hermeticEnv: base de entorno para cualquier invocación de ct-next.mjs en los
// tests. `pathPrefix` son los directorios de stubs que ese test ya quisiera
// poner delante (git/gh/cmux).
export function hermeticEnv(pathPrefix = []) {
  return { PATH: [...pathPrefix, ...FAKE_BIN_DIRS, process.env.PATH].join(':') }
}
