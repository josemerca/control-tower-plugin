// ============================================================================
// Las cuatro condiciones de abort de la columna E2E. Las cuatro son la misma
// familia: el spec dice dos cosas incompatibles sobre la MISMA fila, y no se
// elige un ganador en silencio.
//
// Por qué ABORTA y no avisa: un aviso dejaría viva la ambigüedad que el token
// `no` existe para quitar (los avisos se ignoran, y F14 documenta lo que pasa
// con los que se ignoran), y entonces el token no habría servido para nada.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GROOM = new URL('../scripts/ct-groom.mjs', import.meta.url).pathname

// --dry-run enumera issues existentes de `--repo` (F5, lectura pura para
// detectar divergencia) ANTES de imprimir el plan — sin un `gh` de mentira en
// el PATH, eso invocaría el `gh` real contra un repo "o/r" que no existe.
// Mismo stub y mismo criterio que ct-groom-dryrun.test.js.
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = () => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` })

const specWith = (gateCell, e2eCell) => `# Spec

Estado: CONGELADA

## Hipótesis del experimento
Que esto funcione.

## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | E2E |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-----|
| 1 | uno | backend | algo | – | un criterio | – | core | – | ${gateCell} | ${e2eCell} |
`

function groom(gateCell, e2eCell) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-e2e-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  const spec = join(dir, 'docs', 'spec.md')
  writeFileSync(spec, specWith(gateCell, e2eCell))
  const r = spawnSync(process.execPath, [GROOM, spec, '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
  rmSync(dir, { recursive: true, force: true })
  return r
}

describe('aborts de la columna E2E', () => {
  it('celda sin declarar (guion) aborta y nombra la fila', () => {
    const r = groom('–', '–')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/E2E/)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/\bno\b/)
  })

  it('el token junto a un recorrido aborta', () => {
    const r = groom('–', 'no, curl -i :9115/metrics')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
  })

  it('Gate: e2e con la celda diciendo `no` aborta', () => {
    const r = groom('e2e', 'no')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
  })

  it('Gate: e2e con la celda sin declarar aborta', () => {
    const r = groom('e2e', '–')
    expect(r.status).not.toBe(0)
  })

  it('celda `no` sin nada más NO aborta', () => {
    const r = groom('–', 'no')
    expect(r.status).toBe(0)
  })

  it('celda con un recorrido NO aborta', () => {
    const r = groom('–', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(0)
  })
})
