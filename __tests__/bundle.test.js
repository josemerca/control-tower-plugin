import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundles = ['dist/session-start.js', 'dist/stop.js']

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
