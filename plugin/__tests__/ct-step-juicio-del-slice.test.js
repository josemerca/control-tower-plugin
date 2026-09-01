// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { renderState } from '../scripts/state.js'
import { SENAL_AUSENTE } from '../scripts/kickoff.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo, recorridoDeSlice } from './fixtures/ct-step-harness.js'

let repo
const { ct, veredictoDeSlice, commits, estado, juzgarSlice, tareaOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// §3.7-B del handoff: el slice entero tiene juez. Los dos ítems que ningún
// juez de tarea mira — si las tareas juntas entregan el fin del slice, y si
// son coherentes entre sí.
describe('el juicio del slice entero (§3.7-B)', () => {
  const enJuezDeSlice = () => { tareaOk('uno.txt'); tareaOk('dos.txt'); ct('reconcile'); ct('global') }

  it('next despacha ct-slice-judge con el paquete del RANGO de commits', () => {
    enJuezDeSlice()
    const r = ct('next')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/ct-slice-judge/)
    expect(r.stdout).toMatch(/SIN Bash/)
    const paquete = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    // La secuencia de commits es la pieza que el paquete por tarea no tiene:
    // `coherencia` sólo se ve en el orden.
    expect(paquete).toMatch(/## Commits/)
    expect(paquete.indexOf('la primera (#7, tarea 1/2)')).toBeLessThan(paquete.indexOf('la segunda (#7, tarea 2/2)'))
    expect(paquete).toMatch(/## Files changed/)
    expect(paquete).toMatch(/## Diff/)
  })

  it('un PASS entrega el run y el veredicto viaja en su PROPIO commit', () => {
    enJuezDeSlice()
    const r = juzgarSlice(veredictoDeSlice('PASS'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/run delivered/)
    expect(estado().closed).toBe('delivered')
    expect(commits()).toBe(4)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/issue-7-slice\.json/)
    const guardado = JSON.parse(readFileSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'), 'utf8'))
    expect(guardado.verdict.ruling).toBe('PASS')
    expect(guardado.tasks_total).toBe(2)
  })

  it('un PASS con hallazgos medium entrega igual: no queda implementador al que devolver', () => {
    enJuezDeSlice()
    const r = juzgarSlice(veredictoDeSlice('PASS', [{ severity: 'medium', what: 'andamiaje sin retirar', path: 'uno.txt', line: 1 }]))
    expect(r.status).toBe(0)
    expect(estado().closed).toBe('delivered')
    // El hallazgo viaja DENTRO del veredicto commiteado, para quien revise la PR.
    const guardado = JSON.parse(execFileSync('git', ['show', 'HEAD:docs/superpowers/verdicts/issue-7-slice.json'], { cwd: repo, encoding: 'utf8' }))
    expect(guardado.verdict.findings).toHaveLength(1)
  })

  it('un FAIL cierra el run por 1 y NO deja veredicto trackeado: solo viaja el que aprueba', () => {
    enJuezDeSlice()
    const r = juzgarSlice(veredictoDeSlice('FAIL', [{ severity: 'high', what: 'la tarea 2 deshace la 1', path: 'uno.txt', line: 1 }]))
    expect(r.status).toBe(1)
    expect(commits()).toBe(3)
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-slice.json'))).toBe(false)
  })

  it('un veredicto con regla de TAREA se descarta y se vuelve a preguntar', () => {
    enJuezDeSlice()
    const p = join(repo, 'sv.json')
    writeFileSync(p, JSON.stringify({ ruling: 'PASS', rubric: recorridoDeSlice(), findings: [{ rule: 'alcance', severity: 'low', what: 'x', path: 'y', evidence: 'z' }] }))
    const r = juzgarSlice(p)
    expect(r.stdout).toMatch(/descartado/)
    expect(estado().step).toBe('slice-judge')
    expect(estado().discards).toBe(1)
  })

  it('las filas de global y slice-judge no son de ninguna tarea, y viajan en el commit del veredicto', () => {
    enJuezDeSlice()
    juzgarSlice(veredictoDeSlice('PASS'))
    const commiteado = execFileSync('git', ['show', 'HEAD:docs/superpowers/metrics/issue-7.jsonl'], { cwd: repo, encoding: 'utf8' })
    const filas = commiteado.trim().split('\n').map((l) => JSON.parse(l))
    const global = filas.find((f) => f.step === 'global')
    expect(global.task).toBeNull()
    expect(global.task_name).toBeNull()
    const juez = filas.find((f) => f.step === 'slice-judge')
    expect(juez.task).toBeNull()
    expect(juez.ruling).toBe('PASS')
  })

  // Slice 10 — la señal cruza el embudo en el paquete: ct-step la lee del
  // campo `senal:` del SLICE.md (disco, sin agente en medio — la doctrina del
  // §3.3) y la pega como PRIMERA sección `## Señal`, delante del diff -U10
  // donde quedaría enterrada. El fallback SENAL_AUSENTE cubre un SLICE.md
  // sembrado por un plugin anterior a la columna.
  const sembrarSenalEnSliceMd = (senal) => {
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    // Por el MISMO camino que buildStateSeed (renderState): es lo que hace
    // que un valor largo llegue plegado/entrecomillado por YAML, como en un
    // despacho real.
    writeFileSync(join(repo, '.agent', 'SLICE.md'), renderState({ meta: { issue: 7, epic: 12, senal }, body: '# slice de mentira' }))
    g('add', '.agent/SLICE.md')
    g('commit', '-q', '-m', 'siembra la senal del slice')
  }

  it('el paquete de slice trae "## Señal" como PRIMERA sección, con el texto del campo senal: del SLICE.md', () => {
    sembrarSenalEnSliceMd('métrica `backfill_progress` con label `estado`')
    enJuezDeSlice()
    ct('next')
    const paquete = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    expect(paquete).toMatch(/## Señal/)
    expect(paquete).toContain('métrica `backfill_progress` con label `estado`')
    // Primera: antes de Commits/Files changed/Diff.
    expect(paquete.indexOf('## Señal')).toBeLessThan(paquete.indexOf('## Commits'))
  })

  it('sin campo senal: en el SLICE.md, la sección declara la ausencia con SENAL_AUSENTE', () => {
    // El fixture de montarRepo siembra un SLICE.md SIN campo senal — el caso
    // de un plugin anterior a la columna.
    enJuezDeSlice()
    ct('next')
    const paquete = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    expect(paquete).toMatch(/## Señal/)
    expect(paquete).toContain(SENAL_AUSENTE)
    expect(paquete.indexOf('## Señal')).toBeLessThan(paquete.indexOf('## Commits'))
  })

  it('una señal larga (plegada por YAML) llega entera al paquete', () => {
    // > 100 caracteres en una sola pieza: renderState (yaml.stringify) la
    // pliega en varias líneas del frontmatter — una regex de línea única (la
    // de `epic:`) la truncaría y la vara del ítem llegaría a medias sin que
    // nadie lo viera. Esta es la razón de parseStateSafe.
    const larga = 'métrica `harvest_rows_total` con label `estado` acotado a los valores enumerados del contrato, emitida por el worker de cosecha en cada lote confirmado'
    expect(larga.length).toBeGreaterThan(100)
    sembrarSenalEnSliceMd(larga)
    enJuezDeSlice()
    ct('next')
    const paquete = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    expect(paquete).toContain(larga)
  })
})
