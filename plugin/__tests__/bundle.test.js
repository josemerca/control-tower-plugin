import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import { describe, it, expect } from 'vitest'
import { buildOptions } from '../scripts/build.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Derivada de buildOptions.entryPoints, no repetida a mano: una tercera lista
// de los mismos bundles se habría quedado atrás en silencio en cuanto el
// build ganase un entry point, tal como ya les pasó a otras dos listas de
// este mismo tipo en este repo. esbuild, sin `outbase`, nombra cada salida
// por el basename de su entrada dentro de `outdir` — importar este módulo no
// dispara ningún build (ver la guarda de `process.argv[1]` en build.mjs).
// entryPoints es un MAPA (nombre de salida → fuente) desde que scope-check
// entró desde `scripts/`: con la forma de lista, esbuild calculaba un outbase
// común y anidaba las salidas en `dist/hooks/` y `dist/scripts/`. La derivación
// sigue siendo derivación —las claves SON los nombres de salida—, que es lo que
// esta línea protege: una tercera lista escrita a mano se quedaría atrás en
// silencio en cuanto el build ganase un entry point, como ya les pasó a otras
// dos listas de este mismo repo.
const bundles = Object.keys(buildOptions.entryPoints).map((nombre) => `${buildOptions.outdir}/${nombre}.js`)

// Extrae los especificadores de módulo externos de un bundle ESM.
function externalSpecifiers(code) {
  const out = []
  for (const re of [
    /(?:^|[;\n])\s*import[^;'"]*?from\s*["']([^"']+)["']/g,
    /(?:^|[;\n])\s*import\s*["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ]) {
    for (const m of code.matchAll(re)) out.push(m[1])
  }
  return out
}

describe('dist bundles autocontenidos', () => {
  for (const b of bundles) {
    it(`${b} existe`, () => {
      expect(existsSync(join(root, b))).toBe(true)
    })
    it(`${b} solo importa builtins node: (yaml/state inlineados)`, () => {
      const specs = externalSpecifiers(readFileSync(join(root, b), 'utf8'))
      // Acepta tanto "node:xxx" como el nombre "xxx" sin prefijo: ambos
      // resuelven a builtins de Node (p.ej. esbuild emite require("process")
      // sin prefijo dentro del shim __commonJS al inlinear yaml). isBuiltin
      // cubre ambas formas; lo que NO debe aparecer es un paquete npm real.
      const nonBuiltin = specs.filter((s) => !isBuiltin(s))
      expect(nonBuiltin).toEqual([])
    })
  }
})
