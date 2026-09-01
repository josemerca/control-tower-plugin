// ============================================================================
// Las CINCO condiciones de abort de la columna E2E. Las cinco son la misma
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

const GROOM = fileURLToPath(new URL('../scripts/ct-groom.mjs', import.meta.url))

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

  // El quinto abort (review final de rama). Antes de ella esto era un AVISO,
  // sobre la premisa —falsa, verificada ejecutando la cadena— de que la
  // renuncia se llevaba por delante el trabajo. No se lleva nada: la sección
  // "## E2E" se emite igual, /ct-next siembra igual, ct-step exige igual el
  // paso y --release exige igual la correspondencia. Lo único que la renuncia
  // quita es la label, o sea la señal para el humano — y una renuncia que no
  // renuncia a nada es la misma contradicción entre dos celdas que los otros
  // cuatro aborts se niegan a resolver en silencio.
  it('Gate: !e2e sobre una fila con recorridos aborta, y manda a la celda "E2E"', () => {
    const r = groom('!e2e', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/celda "E2E" declara recorridos/)
    // El remedio es la celda, no la columna "Gate": el gate se DERIVA de ahí.
    expect(r.stderr).toMatch(/escribe "no" en su celda "E2E"/)
    // Y aborta ANTES de imprimir el plan, como los otros cuatro.
    expect(r.stdout.trim()).toBe('')
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

// ============================================================================
// El gate "e2e", dicho en voz alta (task "e2e al cierre del slice", adición
// 2). `resolveGates` nunca clasifica este caso como `g.added` — `e2e` no
// viene de ningún `Tipo` (no vive en TYPE_GATES), así que con una fila que
// sólo trae recorridos (sin nada escrito a mano en "Gate") lo mete en
// `implied`. El aviso tiene que salir igual: si no sale, la label
// "gate:e2e" llega al issue y el reporte de groom se queda callado, que es
// la MISMA fuga que F21 cerró para la columna "Gate".
//
// Y tiene que nombrar la columna correcta: el mensaje genérico de "added"
// dice "es deliberado (para eso está la columna Gate)", que aquí es FALSO —
// declarar "e2e" a mano en "Gate" es uno de los cinco aborts de arriba. Un
// aviso que manda al autor a la columna equivocada es peor que ninguno.
// ============================================================================
describe('el gate "e2e" se anuncia por stderr, y nombra la columna correcta', () => {
  it('una fila con recorridos produce el aviso y nombra "E2E", nunca "Gate"', () => {
    const r = groom('–', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/gate/i)
    expect(r.stderr).toContain('"e2e"')
    expect(r.stderr).toMatch(/columna "E2E"/)
    expect(r.stderr).not.toMatch(/columna "Gate"/)
    const plan = JSON.parse(r.stdout)
    expect(plan.issues[0].labels).toContain('gate:e2e')
  })

  it('una fila sin recorridos (`no`) no lleva ningún aviso de "e2e"', () => {
    const r = groom('–', 'no')
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('"e2e"')
  })
})

// ============================================================================
// Review de la adición 2: `redundant`/`inertWaivers` también
// atribuían el gate "e2e" al `Tipo` ("que su Tipo ... implica/ya implica/no
// implica ese gate"), que es FALSO exactamente por el mismo motivo que
// "added" — `e2e` no vive en TYPE_GATES, nunca lo implica ningún Tipo: lo
// implica la fila, vía la columna "E2E". El caso más grave (finding 1): con
// `Gate: e2e` MÁS recorridos reales (fila legítima, no aborta — los aborts de
// la columna E2E exigen CERO recorridos), un `--dry-run` real imprimía a la
// vez el aviso correcto de "added"/"implied" y el genérico de "redundant",
// que decía "su Tipo ya implica" el gate: dos afirmaciones sobre el MISMO
// gate que se contradecían tres líneas aparte.
// ============================================================================
// (`waived` ya no tiene caso: con recorridos declarados, `!e2e` aborta — ver
// el quinto abort de arriba —, y sin ellos la renuncia cae en `inertWaivers`.)
describe('review adición 2 — redundant/inertWaivers también nombran "E2E", no "Tipo"', () => {
  it('Gate: e2e + recorridos reales: no aborta, y "redundante" ya no contradice al aviso de arriba', () => {
    const r = groom('e2e', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(0)
    // El aviso "el gate ya viene de la fila" (el mismo que dispara con sólo
    // recorridos) sigue presente...
    expect(r.stderr).toMatch(/columna "E2E"/)
    // ...y "redundante" ya no dice que lo implica el Tipo: las dos líneas que
    // mencionan "e2e" están de acuerdo en que la fuente es la fila/columna
    // E2E, ninguna nombra "Tipo" como causa.
    expect(r.stderr).toMatch(/redundante/)
    expect(r.stderr).not.toMatch(/Tipo\s*"?backend"?\s*ya implica/)
    const e2eLines = r.stderr.split('\n').filter((l) => l.includes('"e2e"'))
    expect(e2eLines.length).toBeGreaterThanOrEqual(2)
    for (const line of e2eLines) expect(line).toMatch(/columna "E2E"/)
    const plan = JSON.parse(r.stdout)
    expect(plan.issues[0].labels).toContain('gate:e2e')
  })

  it('Gate: !e2e + sin recorridos: la renuncia inerte nombra "E2E", no "Tipo"', () => {
    const r = groom('!e2e', 'no')
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/no había nada que quitar/)
    expect(r.stderr).toMatch(/columna "E2E"/)
    expect(r.stderr).not.toMatch(/su Tipo .* no implica ese gate/)
  })
})
