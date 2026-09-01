// scripts/repo-walk.js extrae el recorrido del árbol que antes vivía SOLO
// dentro de scripts/detect-conventions.mjs. §3.12 del handoff
// (docs/prompt-juez-lo-que-queda.md) añade un SEGUNDO barrido —el de
// candidatos a la vara del repo, scripts/detect-vara.mjs— que necesita
// exactamente el mismo recorrido: mismas cotas (`MAX_DEPTH`, `MAX_ENTRIES`),
// mismas exclusiones (`SKIP_DIRS`), el mismo no-descender-a-`worktrees` y el
// mismo no-seguir-symlinks. Duplicar el walker sería dos juegos de estas
// reglas divergiendo en silencio — justo lo que este repo ata con tests en
// todas partes (`CONVENTIONS_FILE`, `JUDGE_TOOLS`, `buildOptions`). Así que
// hay un solo recorrido, y este fichero es el que lo protege.
//
// Las tres reglas raras (no descender a `worktrees`, no seguir symlinks,
// `.worktrees` en SKIP_DIRS) están medidas contra un caso real de campo
// (ver detect-conventions.mjs / conventions-salida.test.js) y no se
// "simplifican" aquí.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkRepo, SKIP_DIRS, MAX_DEPTH, MAX_ENTRIES } from '../scripts/repo-walk.js'

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})
function tmp(prefix = 'repo-walk-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

describe('walkRepo', () => {
  it('lista ficheros con ruta relativa y separador "/", y marca los directorios con "/" final', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', 'a.md'), 'x')
    writeFileSync(join(dir, 'raiz.txt'), 'x')
    const { entradas } = walkRepo(dir)
    expect(entradas).toContain('docs/')
    expect(entradas).toContain('docs/a.md')
    expect(entradas).toContain('raiz.txt')
    // ninguna entrada usa separador de plataforma distinto de "/"
    expect(entradas.some((e) => e.includes('\\'))).toBe(false)
  })

  it('salta node_modules, .git y dist — nada de dentro aparece', () => {
    const dir = tmp()
    for (const skip of ['node_modules', '.git', 'dist']) {
      mkdirSync(join(dir, skip))
      writeFileSync(join(dir, skip, 'dentro.txt'), 'x')
    }
    writeFileSync(join(dir, 'visible.txt'), 'x')
    const { entradas } = walkRepo(dir)
    expect(entradas).toContain('visible.txt')
    for (const skip of ['node_modules', '.git', 'dist']) {
      expect(entradas.some((e) => e.startsWith(`${skip}/`))).toBe(false)
    }
  })

  it('SKIP_DIRS incluye exactamente los directorios de siempre', () => {
    for (const d of ['.git', '.worktrees', 'node_modules', '.venv', 'venv', '__pycache__',
      'dist', 'build', 'target', 'vendor', 'Pods', '.next', '.ruff_cache',
      '.mypy_cache', '.pytest_cache', '.gradle', 'DerivedData']) {
      expect(SKIP_DIRS.has(d)).toBe(true)
    }
  })

  it('registra un directorio llamado "worktrees" pero no desciende a él', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'worktrees'))
    writeFileSync(join(dir, 'worktrees', 'copia.txt'), 'x')
    const { entradas } = walkRepo(dir)
    expect(entradas).toContain('worktrees/')
    expect(entradas.some((e) => e.startsWith('worktrees/') && e !== 'worktrees/')).toBe(false)
  })

  it('respeta maxDepth: un fichero a profundidad 7 con maxDepth 2 no aparece', () => {
    const dir = tmp()
    let cursor = dir
    for (let i = 0; i < 7; i++) {
      cursor = join(cursor, `n${i}`)
      mkdirSync(cursor)
    }
    writeFileSync(join(cursor, 'hondo.txt'), 'x')
    const { entradas } = walkRepo(dir, { maxDepth: 2 })
    expect(entradas.some((e) => e.includes('hondo.txt'))).toBe(false)
  })

  it('con maxEntries bajo, devuelve truncated: true', () => {
    const dir = tmp()
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.txt`), 'x')
    const { truncated } = walkRepo(dir, { maxEntries: 2 })
    expect(truncated).toBe(true)
  })

  it('sin cotas explícitas, MAX_DEPTH y MAX_ENTRIES son los de siempre', () => {
    expect(MAX_DEPTH).toBe(5)
    expect(MAX_ENTRIES).toBe(20000)
  })

  it('un symlink de directorio no se sigue', () => {
    const dir = tmp()
    const fuera = tmp('repo-walk-fuera-')
    writeFileSync(join(fuera, 'secreto.txt'), 'x')
    symlinkSync(fuera, join(dir, 'enlace'), 'dir')
    const { entradas } = walkRepo(dir)
    expect(entradas.some((e) => e.includes('secreto.txt'))).toBe(false)
    // el propio symlink no queda colgando como fichero fantasma tampoco:
    // no aparece como entrada "dentro" de sí mismo
    expect(entradas.some((e) => e.startsWith('enlace/') && e !== 'enlace/')).toBe(false)
  })

  it('un subdirectorio ilegible no invalida el resto del escaneo', () => {
    if (process.getuid && process.getuid() === 0) return // root ignora los permisos
    const dir = tmp()
    const ilegible = join(dir, 'sin-permiso')
    mkdirSync(ilegible)
    writeFileSync(join(ilegible, 'dentro.txt'), 'x')
    writeFileSync(join(dir, 'ok.txt'), 'x')
    chmodSync(ilegible, 0o000)
    try {
      const { entradas } = walkRepo(dir)
      expect(entradas).toContain('ok.txt')
      expect(entradas).toContain('sin-permiso/')
    } finally {
      chmodSync(ilegible, 0o755)
    }
  })
})
