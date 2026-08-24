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

// specSinColumnaE2e: la MISMA tabla, pero sin la columna "E2E" en absoluto
// (ni cabecera ni celda). Existe para el abort 4 en solitario: con la
// columna presente, cualquier celda "E2E" sin declarar dispara YA el abort 1
// (celda sin declarar), así que un test con la columna puesta no puede
// distinguir "abort 4 funciona" de "abort 1 lo está enmascarando" — pasaría
// igual aunque abort 4 no existiera. La condición del abort 4
// (`parseGateCell(s.gate).add.includes('e2e') && r.runs.length === 0`)
// deliberadamente NO mira `e2eColumnPresent`, así que la única forma de
// probarlo de verdad es un spec donde el abort 1 no pueda dispararse nunca.
const specSinColumnaE2e = (gateCell) => `# Spec

Estado: CONGELADA

## Hipótesis del experimento
Que esto funcione.

## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |
|---|-------|------|---------|-----|--------|-----------|------|------|------|
| 1 | uno | backend | algo | – | un criterio | – | core | – | ${gateCell} |
`

function run(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-e2e-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  const specFile = join(dir, 'docs', 'spec.md')
  writeFileSync(specFile, spec)
  const r = spawnSync(process.execPath, [GROOM, specFile, '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
  rmSync(dir, { recursive: true, force: true })
  return r
}

const groom = (gateCell, e2eCell) => run(specWith(gateCell, e2eCell))
const groomSinE2e = (gateCell) => run(specSinColumnaE2e(gateCell))

describe('aborts de la columna E2E', () => {
  it('celda sin declarar (guion) aborta y nombra la fila', () => {
    const r = groom('–', '–')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/E2E/)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/"no"/)
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

  it('Gate: e2e sin columna "E2E" en la tabla aborta (abort 4 en solitario, sin que abort 1 lo enmascare)', () => {
    const r = groomSinE2e('e2e')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/e2e/)
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
