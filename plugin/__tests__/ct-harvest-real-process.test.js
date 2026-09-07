// /ct-harvest lee además la telemetría del juez (§3.4 del handoff:
// docs/prompt-juez-lo-que-queda.md). `rubric_sin_vara` y `findings_by_rule`
// viajaban en la pull request desde `1422c67` y NO LOS LEÍA NADIE — la
// columna existía en disco y la pregunta «¿está llegando la vara?» se
// contestaba abriendo ficheros `jsonl` a mano.
//
// Bancada CALCADA de ct-status.test.js pero SIN checkout git: ct-harvest.mjs
// no mira el cwd — lee de GitHub, como todo lo demás de este comando — así
// que no hace falta ningún repo local, sólo el stub de `gh` con PATH.
//
// Los issues del fixture NO traen `closedByPullRequestsReferences` (van
// vacíos): el stub de `gh` no soporta `gh pr view`, así que ningún test de
// este fichero puede depender de que ct-harvest intente leer un PR.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-harvest.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (o = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...o })

const ISSUES = [
  { number: 12, title: 'Slice 1', state: 'closed', closedAt: '2026-08-20T10:00:00Z', labels: [{ name: 'type:infra' }], milestone: { title: 'E' }, closedByPullRequestsReferences: [] },
  { number: 13, title: 'Slice 2', state: 'closed', closedAt: '2026-08-20T11:00:00Z', labels: [{ name: 'type:infra' }], milestone: { title: 'E' }, closedByPullRequestsReferences: [] },
]

const TIMELINE = JSON.stringify([
  { event: 'labeled', label: { name: 'status:ready' }, created_at: '2026-08-20T09:00:00Z' },
  { event: 'labeled', label: { name: 'status:in-progress' }, created_at: '2026-08-20T09:05:00Z' },
  { event: 'labeled', label: { name: 'status:in-review' }, created_at: '2026-08-20T09:50:00Z' },
])

// El directorio de telemetría: issue-12.jsonl (de este milestone) e
// issue-99.jsonl (de OTRO epic — nunca debe pedirse ni aparecer). #13 queda
// deliberadamente fuera del listado: es el slice "sin telemetría".
const DIR_JSON = JSON.stringify([
  { name: 'issue-12.jsonl', type: 'file' },
  { name: 'issue-99.jsonl', type: 'file' },
])

const veredicto = (m) => JSON.stringify({ step: 'judge', ...m }) + '\n'
const intentoImplement = (m) => JSON.stringify({ step: 'implement', ...m }) + '\n'

function bancada() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-hv-'))
  return { dir, counter: join(dir, 'gh-count'), argvLog: join(dir, 'gh-argv') }
}
const limpiar = (b) => rmSync(b.dir, { recursive: true, force: true })
const argvDe = (b) => (existsSync(b.argvLog) ? readFileSync(b.argvLog, 'utf8') : '')

const correr = (b, env = {}, args = ['--repo', 'o/r', '--milestone', 'E']) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  env: fakeEnv({
    FAKE_GH_COUNTER_FILE: b.counter,
    FAKE_GH_ARGV_LOG_FILE: b.argvLog,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([ISSUES]),
    FAKE_GH_TIMELINE_JSON: TIMELINE,
    ...env,
  }),
})

describe('/ct-harvest — la telemetría del juez, por slice', () => {
  it('el bloque sale con el sin-vara y los hallazgos por regla de cada slice, y exit 0', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 1, findings_by_rule: { patrones: 1 } })
        + veredicto({ ruling: 'FAIL', rubric_sin_vara: 1, findings_by_rule: { patrones: 1, alcance: 1 } }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(1 veto\) \| 2 \| patrones 2 · alcance 1 \|/)
    limpiar(b)
  })

  // LA SEVERIDAD, en una sola celda y en el orden en que se lee: una alta veta
  // (el contrato del veredicto no admite un PASS con una alta), una media
  // compra una vuelta al implementador, una baja sólo se anota. Tres hallazgos
  // de `alcance` sin esto son indistinguibles de tres vetos.
  it('las tres severidades salen sumadas en una sola celda, en el orden alta/media/baja', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, findings_high: 1, findings_medium: 0, findings_low: 1 })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: { alcance: 1 }, findings_high: 0, findings_medium: 1, findings_low: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(1 veto\) \| 0 \| patrones 2 · alcance 1 \| 1\/1\/1 \|/)
    limpiar(b)
  })

  it('un slice cuya telemetría es toda anterior a las severidades imprime «—», nunca 0/0/0', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: {} }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \|/)
    expect(res.stdout).toMatch(/`—` en `alta\/media\/baja`: ningún veredicto de ese slice traía las severidades/)
    limpiar(b)
  })

  it('un slice que el juez midió limpio imprime tres ceros de verdad y no anota ningún veto', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0, findings_by_rule: {}, findings_high: 0, findings_medium: 0, findings_low: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| 0\/0\/0 \|/)
    limpiar(b)
  })

  it('los vetos y las filas sin columna caben en la misma celda de veredictos, separados por coma', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL' }) + veredicto({ ruling: 'FAIL', rubric_sin_vara: 1 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(2 vetos, 1 sin columna\) \|/)
    limpiar(b)
  })

  // MEDIDA 1: si la vara de ct se usó y si cazó algo, en una sola celda y sus
  // dos mitades. Sustituye a `patrones-ct`, que sólo miraba hallazgos del ítem
  // `patrones` y por eso no veía los que el juez archiva en otro ítem.
  it('vara ct imprime las dos mitades sumadas de todos los veredictos del slice', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, rubric_vara_ct_docs: 5, findings_vara_ct: 1 })
        + veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 1 }, rubric_vara_ct_docs: 4, findings_vara_ct: 1 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 2 \(2 vetos\) \| 0 \| patrones 3 \| — \| 9 docs · 2 hallazgos \|/)
    limpiar(b)
  })

  it('un slice cuya telemetría es toda anterior a estas columnas imprime «—» en vara ct, nunca 0', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 } }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 veto\) \| 0 \| patrones 2 \| — \| — \|/)
    expect(res.stdout).toMatch(/`—` en `vara ct`: ningún veredicto de ese slice traía las columnas/)
    limpiar(b)
  })

  it('media medida no imprime media celda: con una columna sola sale «—», porque el hueco se leería como un cero', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'FAIL', rubric_sin_vara: 0, findings_by_rule: { patrones: 2 }, rubric_vara_ct_docs: 5 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 veto\) \| 0 \| patrones 2 \| — \| — \|/)
    limpiar(b)
  })

  // MEDIDA 2: si la vara llegó al brief del paso `implement`, y cuánto pesó.
  // Sumado sobre TODOS los intentos de `implement` que el slice dejó escritos
  // — el mismo fichero por issue que lee la telemetría del juez.
  it('brief suma los documentos de vara de ct y el peso de todos los intentos de implement del slice', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 })
        + intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 520 })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \| — \| 8 docs · 1020B \|/)
    limpiar(b)
  })

  it('un slice sin ningún intento de implement en su telemetría dice «—» en brief, nunca 0', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \| — \| — \|/)
    limpiar(b)
  })

  it('un slice cuyos intentos de implement son todos anteriores a la medida dice «—» en brief, nunca 0, y lo dice en voz alta', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      // Esquema viejo: fila de `implement` sin brief_vara_ct_docs/brief_bytes.
      'issue-12.jsonl': intentoImplement({ outcome: 'done' }) + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \| 0 \| \(ninguno\) \| — \| — \| — \|/)
    expect(res.stdout).toMatch(/`—` en `brief`: ningún intento de `implement` de ese slice traía `brief_vara_ct_docs`\/`brief_bytes`/)
    limpiar(b)
  })

  it('un intento de implement con el brief no leído (null) no cuenta como cero: se anota "sin columna"', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 })
        + intentoImplement({ outcome: 'discarded', brief_vara_ct_docs: null, brief_bytes: null })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/4 docs · 500B \(1 sin columna\) \|/)
    limpiar(b)
  })

  // MEDIDA 3 (#92): cuánto material fijo leyó cada papel despachado. Sumado
  // sobre los cuatro pasos que llaman a un subagente, no sólo sobre `implement`.
  it('bytes por papel suma el agente, las skills y el paquete de todos los papeles despachados del slice', () => {
    const b = bancada()
    const bytes = { agent_bytes: 5000, skill_bytes: 18000, package_bytes: 1000 }
    const filesJson = JSON.stringify({
      'issue-12.jsonl':
        intentoImplement({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 1000, ...bytes })
        + veredicto({ ruling: 'PASS', rubric_sin_vara: 0, ...bytes }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| agente 10000B · skills 36000B · paquete 2000B \|/)
    limpiar(b)
  })

  it('un slice cuyos papeles son todos anteriores a la medida dice «—» en bytes por papel, nunca 0, y lo dice en voz alta', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': intentoImplement({ outcome: 'done' }) + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/`—` en `bytes por papel`: ningún papel despachado de ese slice traía `agent_bytes`\/`skill_bytes`\/`package_bytes`/)
    limpiar(b)
  })

  it('un slice sin fichero de telemetría dice «(sin telemetría)» y jamás un cero', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\| #13 \| Slice 2 \| — \| — \| \(sin telemetría\) \|/)
    expect(res.stdout).toMatch(/Nadie midió — no es un cero/)
    limpiar(b)
  })

  it('un slice cuya telemetría es toda anterior a la columna imprime «—» en sin-vara, nunca 0, y enseña cuántos veredictos son sin columna', () => {
    const b = bancada()
    // Una sola fila de veredicto SIN `rubric_sin_vara`: esquema anterior a la
    // columna (las 15 filas del PR #11 de jjponz/rust-monitoring son de éstas).
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS' }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/\(1 sin columna\)/)
    expect(res.stdout).toMatch(/\| #12 \| Slice 1 \| 1 \(1 sin columna\) \| — \|/)
    expect(res.stdout).toMatch(/telemetría anterior a `rubric_sin_vara`/)
    limpiar(b)
  })

  it('el listado de telemetría que falla no baja el exit a 1, y el informe no imprime ni un número', () => {
    const b = bancada()
    // Sin FAKE_GH_METRICS_DIR_JSON: el stub hace fallar el listado del
    // directorio (404 simulado), que es la vida real de todo epic anterior a
    // 1422c67.
    const res = correr(b, {})
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/no se pudo listar/)
    expect(res.stdout).not.toMatch(/\| Veredictos \|/)
    limpiar(b)
  })

  it('un fichero que el listado sí nombraba y no se pudo leer es una cosecha INCOMPLETA: motivo y exit 1', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILE_FAIL: 'issue-12' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/telemetr/i)
    expect(res.stderr).toMatch(/#12/)
    limpiar(b)
  })

  it('las líneas ilegibles se dicen en voz alta y no cambian el exit', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': '{no json\n' + veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/l.nea\(s\) ilegibles/)
    limpiar(b)
  })

  it('los ficheros de telemetría de otros epics no aparecen', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/#99/)
    expect(argvDe(b)).not.toMatch(/issue-99/)
    limpiar(b)
  })

  it('--json lleva la telemetría dentro de cada fila, con el estado explícito', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson }, ['--repo', 'o/r', '--milestone', 'E', '--json'])
    expect(res.status).toBe(0)
    const salida = JSON.parse(res.stdout)
    expect(salida.filas[0].telemetry.status).toBe('ok')
    expect(salida.filas[1].telemetry.status).toBe('sin-fichero')
    expect(salida.telemetry.dir).toBe('docs/superpowers/metrics')
    limpiar(b)
  })

  it('lee exactamente donde ct-step escribe', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    expect(argvDe(b)).toMatch(/api repos\/o\/r\/contents\/docs\/superpowers\/metrics\/issue-12\.jsonl/)
    limpiar(b)
  })

  it('la cosecha sigue sin mutar nada: ni una llamada de escritura', () => {
    const b = bancada()
    const filesJson = JSON.stringify({
      'issue-12.jsonl': veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    })
    const res = correr(b, { FAKE_GH_METRICS_DIR_JSON: DIR_JSON, FAKE_GH_METRICS_FILES: filesJson })
    expect(res.status).toBe(0)
    const lineas = argvDe(b).split('\n').filter(Boolean)
    expect(lineas.length).toBeGreaterThan(0)
    for (const linea of lineas) {
      expect(linea).not.toMatch(/issue edit|issue create|label create|--method (POST|PATCH|PUT|DELETE)|-X (POST|PATCH|PUT|DELETE)/)
    }
    limpiar(b)
  })
})
