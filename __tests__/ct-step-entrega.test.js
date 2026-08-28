// Un trozo de la máquina de estados de scripts/ct-step.mjs. El preámbulo —y
// por qué son nueve ficheros y no uno— está en fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { deliveredRun } from '../scripts/run-machine.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo, PLAN } from './fixtures/ct-step-harness.js'

let repo
const { ct, informe, veredicto, crudo, log, commits, estado, juzgar, tareaOk, sliceOk } = crearHelpers(() => repo)

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('el camino feliz', () => {
  it('dos tareas, dos commits, y los comitea el PROGRAMA', () => {
    tareaOk('uno.txt')
    const r = tareaOk('dos.txt')
    expect(r.status).toBe(0)
    // §3.7: el último commit ya NO entrega — abre la fase global.
    expect(r.stdout).toMatch(/paso global/)
    expect(commits()).toBe(3)
    expect(log()).toMatch(/la primera \(#7, tarea 1\/2\)/)
    expect(log()).toMatch(/la segunda \(#7, tarea 2\/2\)/)
  })

  it('el slice entero: tareas + global + juicio del slice, y entrega', () => {
    const r = sliceOk()
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/run delivered/)
    expect(r.stdout).toMatch(/lista para la pull request/)
    // 1 base + 2 tareas + 1 del veredicto de slice, que estrena commit propio.
    expect(commits()).toBe(4)
    expect(log()).toMatch(/Veredicto del slice entero \(#7\)/)
  })

  it('sólo entra en el commit lo que el implementador declaró', () => {
    // dos.txt existe desde el principio y la tarea 1 no lo declara.
    tareaOk('uno.txt')
    const primero = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(primero).not.toMatch(/dos\.txt/)
  })

  it('el mensaje no lleva closing keywords aunque el plan las traiga', () => {
    writeFileSync(join(repo, 'plan.md'), PLAN.replace('### Task 1 — la primera', '### Task 1 — fixes #451 la primera'))
    tareaOk('uno.txt')
    expect(log()).not.toMatch(/fixes\s*#451/i)
    expect(log()).toMatch(/issue 451/)
  })

  it('rechaza rutas de fuera del worktree: la lista la escribe un modelo', () => {
    const r = ct('report', crudo(JSON.stringify({ paths: ['/etc/passwd'], summary: 'ups' })))
    expect(r.stdout).toMatch(/informe descartado.*fuera del worktree/)
    expect(estado().discards).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// LA COLA ENTERA CON RECORRIDOS. Ningún fichero la recorría: éste nunca ponía
// `e2e` en el SLICE.md (así que el commit de la última tarea cerraba en la rama
// sin travesía) y __tests__/e2e-ct-step.test.js siembra el run ya parado en
// `e2e` con exactamente `tasksTotal` commits, sin pasar por `slice-verdict`.
// En el hueco entre los dos cabía el defecto: el veredicto de slice estrena
// commit propio, el proceso siguiente relee el fichero y la cuenta de commits
// no cuadraba — TODO slice con recorridos moría en PRECONDITION (exit 8) sin
// llegar nunca a DELIVERED, y `dispatch-check --release` lo rechazaba con el 7
// para siempre.
// ---------------------------------------------------------------------------
describe('la cola completa: commit → global → slice-verdict → e2e → DELIVERED', () => {
  const RECORRIDO = 'levantado con el example, curl -i :9115/metrics responde 200'
  const informeE2e = (nombre = 'e2e.json') => {
    const p = join(repo, nombre)
    writeFileSync(p, JSON.stringify({
      runs: [{
        run: RECORRIDO, verdict: 'verde', brought_up: 'cargo run --example serve',
        evidence: [{ command: 'curl -sS -o /dev/null -w \'%{http_code}\' localhost:9115/metrics', output: '200' }],
      }],
    }))
    return p
  }

  beforeEach(() => {
    rmSyncBestEffort(repo)
    repo = montarRepo({ e2e: [RECORRIDO] })
  })

  it('un slice con recorridos atraviesa el e2e y ENTREGA', () => {
    expect(sliceOk().status).toBe(0)
    // El veredicto de slice no entrega aquí: abre el paso e2e.
    expect(estado().step).toBe('e2e')
    expect(estado().closed).toBeUndefined()
    // Preguntar ya no muere en PRECONDITION: es el síntoma exacto del defecto.
    const n = ct('next')
    expect(n.status).toBe(0)
    expect(n.stdout).toContain(RECORRIDO)

    const r = ct('e2e', informeE2e())
    expect(r.status).toBe(0)
    expect(estado().closed).toBe('delivered')
    expect(deliveredRun(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8'), 7)).toEqual({ ok: true })
    // 1 base + 2 tareas + veredicto de slice + informe de e2e.
    expect(commits()).toBe(5)
    expect(log()).toMatch(/informe de e2e del issue #7/)
    // Y el commit del veredicto de slice quedó CONTADO: es lo que permite que
    // el proceso siguiente cruce los commits sin descuadrarse.
    expect(estado().sliceCommits).toBe(1)
  })

  it('un `git add` antes del e2e no entra en el commit del informe (slice 12)', () => {
    sliceOk()
    writeFileSync(join(repo, 'colado.txt'), 'nadie ha visto esto\n')
    execFileSync('git', ['add', 'colado.txt'], { cwd: repo })
    const r = ct('e2e', informeE2e())
    expect(r.status).toBe(0)                      // el informe es válido: entrega
    expect(estado().closed).toBe('delivered')
    expect(r.stderr).toMatch(/ajenas a la maquinaria \(colado\.txt\)/)
    expect(execFileSync('git', ['log', '--oneline', '--', 'colado.txt'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('')
    expect(log()).not.toMatch(/informe de e2e del issue #7/)
    // El informe queda STAGEADO, como en el camino rojo: espera a quien lo comitee.
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }))
      .toMatch(/docs\/superpowers\/e2e\/7\.md/)
  })
})

// Review de capde (2026-08-19), punto 3 / criterio de cierre de F37: el PR de
// un slice trae un VEREDICTO, no una frase del mensaje de commit afirmándolo.
describe('el veredicto viaja en la pull request', () => {
  it('el PASS de cada tarea acaba trackeado y dentro del commit de su tarea', () => {
    tareaOk('uno.txt')
    const ruta = join('docs', 'superpowers', 'verdicts', 'issue-7-task-1.json')
    expect(existsSync(join(repo, ruta))).toBe(true)
    const files = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(files).toMatch(/issue-7-task-1\.json/)
    const guardado = JSON.parse(readFileSync(join(repo, ruta), 'utf8'))
    expect(guardado.verdict.ruling).toBe('PASS')
    expect(guardado.task).toBe(1)
  })

  it('un FAIL no deja veredicto trackeado: solo viaja el que aprueba', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }]))
    expect(existsSync(join(repo, 'docs', 'superpowers', 'verdicts', 'issue-7-task-1.json'))).toBe(false)
  })
})
