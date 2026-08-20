// La telemetría del conductor (scripts/run-metrics.js y su escritura en
// ct-run.mjs): una fila por intento de un paso de una tarea.
//
// Dos propiedades mandan aquí, y las dos son de las que se rompen en silencio:
// que la identidad esté COMPLETA —un hueco en una métrica se lee como un cero, y
// un cero es una afirmación— y que un fallo al escribirla NO cambie lo que hace
// el run. Un programa que muere porque no pudo escribir su propia métrica ha
// convertido el termómetro en parte del motor.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { metricRow, metricLine, metricsPath, planSha256, verdictMeasures, IDENTITY_FIELDS } from '../scripts/run-metrics.js'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'ct-step.mjs')
const F = '```'
const AHORA = '2026-08-18T10:00:00.000Z'

const IDENT = {
  repo: 'josemerca/control-tower-plugin', epic: '12', issue: 7,
  plan: 'plan.md', plan_sha256: 'abc', task: 2, task_name: 'la segunda',
  tasks_total: 8, step: 'judge', attempt: 3,
  plugin_version: '0.36.1', actor: 'alcaptar',
}

describe('la identidad de la fila', () => {
  it('lleva los doce campos del diseño, ni uno menos', () => {
    const fila = metricRow(IDENT, {}, { now: AHORA })
    expect(IDENTITY_FIELDS).toHaveLength(12)
    for (const campo of IDENTITY_FIELDS) expect(fila).toHaveProperty(campo)
    expect(fila.written_at).toBe(AHORA)
  })

  it('un issue sin milestone se anota "(sin milestone)", nunca vacío', () => {
    for (const vacio of [null, undefined, '']) {
      expect(metricRow({ ...IDENT, epic: vacio }, {}, { now: AHORA }).epic).toBe('(sin milestone)')
    }
  })

  // EL MISMO ARGUMENTO QUE `plan_sha256`, APLICADO AL LOOP EN VEZ DE AL PLAN: un
  // plan se reescribe y entonces dos runs contra dos versiones del mismo fichero
  // son indistinguibles justo donde más se van a mirar. `ct-step` también se
  // reescribe —y se reescribe más que ningún plan—, así que sin la versión del
  // plugin dos runs contra dos loops distintos se comparan como si fueran el
  // mismo mecanismo. La corrida de campo que motiva esto se hizo con 0.36.1: sin
  // el campo, esa cifra sólo existe en la memoria de quien estaba delante.
  it('la versión del plugin viaja en la fila: un ct-step reescrito hace incomparables dos runs', () => {
    expect(metricRow(IDENT, {}, { now: AHORA }).plugin_version).toBe('0.36.1')
    expect(IDENTITY_FIELDS).toContain('plugin_version')
  })

  // HOY DA IGUAL Y VA A DEJAR DE DAR IGUAL. Cada fila vive en el disco de quien
  // la escribió, así que el actor es implícito; en cuanto las filas viajen
  // dentro de la pull request, en un mismo fichero se mezclarán filas de dos
  // máquinas distintas y sin actor no se sabrá de quién es el coste — que es
  // justo el dato por el que se mira este fichero.
  it('el actor viaja en la fila: en cuanto las filas se mezclen, el coste tiene dueño', () => {
    expect(metricRow(IDENT, {}, { now: AHORA }).actor).toBe('alcaptar')
    expect(IDENTITY_FIELDS).toContain('actor')
  })

  // La regla del fichero, aplicada a los dos campos nuevos: la ausencia se
  // DECLARA. Un `null` en una columna por la que se agrupa (¿qué versión?, ¿de
  // quién?) se lee como un valor más y funde en un mismo grupo las filas que no
  // lo traían con las que lo traían vacío. El centinela mantiene el tipo de la
  // columna y dice en voz alta que ahí no había dato, igual que `epic` lleva
  // años diciendo `(sin milestone)`.
  it('sin versión y sin actor se declara la ausencia, no se deja el hueco', () => {
    for (const vacio of [null, undefined, '']) {
      const fila = metricRow({ ...IDENT, plugin_version: vacio, actor: vacio }, {}, { now: AHORA })
      expect(fila.plugin_version).toBe('(sin versión)')
      expect(fila.actor).toBe('(sin actor)')
    }
  })

  // EL MÓDULO SIGUE SIENDO PURO, y estos dos campos son justo los que invitan a
  // romperlo: la versión está en el package.json del plugin y el actor está en
  // el entorno, a una línea de distancia. Si los buscara él, la fila diría quién
  // ESCRIBE la métrica en vez de quién corrió el paso, y el módulo dejaría de
  // ser testeable sin montar un disco.
  it('no va a buscar el actor al entorno: el valor llega DENTRO de la identidad', () => {
    const previo = process.env.USER
    process.env.USER = 'un-actor-del-entorno'
    try {
      const { plugin_version: version, actor } = metricRow({ ...IDENT, plugin_version: null, actor: null }, {}, { now: AHORA })
      expect(actor).toBe('(sin actor)')
      expect(version).toBe('(sin versión)')
    } finally {
      if (previo === undefined) delete process.env.USER
      else process.env.USER = previo
    }
  })

  // `session` SE FUE, y no por limpieza: prometía una dimensión que el mecanismo
  // no puede dar. Con `ct-step` las llamadas al modelo son subagentes de la
  // sesión y no hay identificador de conversación que recoger, así que su único
  // escritor la pasaba `null` a pelo y la columna era nula en TODAS las filas.
  // Una columna siempre nula enseña a saltársela, y la de al lado se salta
  // detrás. Vuelve el día que haya algo que meter dentro.
  it('`session` ya no es un campo: una columna siempre nula enseña a ignorar el fichero', () => {
    expect(IDENTITY_FIELDS).not.toContain('session')
    expect(metricRow({ ...IDENT, session: 'sesion-1' }, {}, { now: AHORA })).not.toHaveProperty('session')
  })

  it('el intento es una dimensión de la fila, no un contador agregado', () => {
    // Es lo que permite medir cuántas veces vetó el juez y cuántas vueltas
    // costó cada tarea, que es el dato que decide si esto merece la pena.
    const vueltas = [1, 2, 3].map((attempt) => metricRow({ ...IDENT, attempt }, {}, { now: AHORA }))
    expect(vueltas.map((f) => f.attempt)).toEqual([1, 2, 3])
  })

  it('las medidas viajan aparte de la identidad y no pueden pisarla', () => {
    const fila = metricRow(IDENT, { cost_usd: 0.03, outcome: 'done' }, { now: AHORA })
    expect(fila.cost_usd).toBe(0.03)
    expect(fila.issue).toBe(7)
  })

  it('cada fila es una línea de JSON, que es lo que hace el fichero append-only', () => {
    const linea = metricLine(metricRow(IDENT, {}, { now: AHORA }))
    expect(linea.endsWith('\n')).toBe(true)
    expect(JSON.parse(linea).step).toBe('judge')
  })
})

describe('el plan se reescribe, y por eso el issue no basta como identidad', () => {
  it('dos versiones del mismo fichero dan hashes distintos', () => {
    expect(planSha256('### Task 1 — a')).not.toBe(planSha256('### Task 1 — b'))
  })

  it('el mismo contenido da el mismo hash, que es lo que permite comparar runs', () => {
    expect(planSha256('igual')).toBe(planSha256('igual'))
  })
})

describe('dónde se escribe', () => {
  it('fuera del repo, para que ningún git add de la slice la meta en la PR', () => {
    const p = metricsPath('ct-step', { home: '/casa' })
    expect(p).toBe('/casa/.claude/control-tower/log/ct-step.jsonl')
  })

  it('bajo CLAUDE_CONFIG_DIR cuando lo hay, que es donde vive el estado de esa cuenta', () => {
    expect(metricsPath('ct-step', { configDir: '/casa/.claude-work' }))
      .toBe('/casa/.claude-work/control-tower/log/ct-step.jsonl')
  })
})

describe('el conteo por severidad', () => {
  it('permite leer cuántos vetos hubo sin volver a cargar los hallazgos', () => {
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'contrato', severity: 'high', what: 'a', where: 'x' },
        { rule: 'alcance', severity: 'low', what: 'b', where: 'y' },
        { rule: 'alcance', severity: 'low', what: 'c', where: 'z' },
      ],
    })).toEqual({
      ruling: 'FAIL', findings_total: 3, findings_high: 1, findings_medium: 0, findings_low: 2,
      findings_by_rule: { contrato: 1, alcance: 2 },
    })
  })

  it('un PASA limpio cuenta cero de todo, y lo dice', () => {
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).findings_total).toBe(0)
  })

  it('la telemetría del veredicto cuenta por regla', () => {
    // Un contador por regla PRESENTE en el veredicto, no las ocho a cero: una
    // regla que no aparece no aporta nada a la cuenta.
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'manipulacion-tests', severity: 'high', what: 'a', where: 'x' },
        { rule: 'manipulacion-tests', severity: 'low', what: 'b', where: 'y' },
        { rule: 'alcance', severity: 'low', what: 'c', where: 'z' },
      ],
    }).findings_by_rule).toEqual({ 'manipulacion-tests': 2, alcance: 1 })
  })
})

// ---------------------------------------------------------------------------
// Y contra el oráculo de verdad: que las filas salen, y —lo que de verdad hay
// que fijar— que NO salir no cambia lo que hace el paso. Un programa que muere
// porque no pudo escribir su propia métrica ha convertido el termómetro en parte
// del motor.
// ---------------------------------------------------------------------------
describe('la telemetría de un paso real', () => {
  const PLAN = [
    '# #7 — una tarea',
    '',
    '## 7. Tasks',
    '',
    '### Task 1 — la única',
    '**Objective:** un fichero.',
    '**Files:** `uno.txt`',
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** el fichero está.',
    '',
    F + 'bash',
    'test -f uno.txt',
    F,
    '',
  ].join('\n')

  let repo, casa

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ct-metrics-'))
    casa = mkdtempSync(join(tmpdir(), 'ct-casa-'))
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    g('init', '-q', '-b', 'main')
    g('config', 'user.email', 't@e.com')
    g('config', 'user.name', 'T')
    g('config', 'commit.gpgsign', 'false')
    g('remote', 'add', 'origin', 'git@github.com:josemerca/control-tower-plugin.git')
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'SLICE.md'), '---\nissue: 7\nepic: 12\n---\n\n# slice\n')
    writeFileSync(join(repo, 'plan.md'), PLAN)
    g('add', '-A')
    g('commit', '-q', '-m', 'base')
    writeFileSync(join(repo, 'uno.txt'), 'uno\n')
    writeFileSync(join(repo, 'report.json'), JSON.stringify({ paths: ['uno.txt'], summary: 'hecho' }))
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(casa, { recursive: true, force: true })
  })

  const ct = (configDir, ...args) => spawnSync('node', [SCRIPT, ...args, '--plan', 'plan.md', '--issue', '7'], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  })

  it('la fila lleva la identidad completa, con el epic sembrado y el hash del plan', () => {
    const r = ct(casa, 'report', 'report.json')
    expect(r.status).toBe(0)
    const filas = readFileSync(join(casa, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas).toHaveLength(1)
    const f = filas[0]
    expect(f.repo).toBe('josemerca/control-tower-plugin')
    expect(f.epic).toBe('12')            // leído del SLICE.md que sembró el despacho
    expect(f.issue).toBe(7)
    expect(f.step).toBe('implement')
    expect(f.attempt).toBe(1)
    expect(f.plan_sha256).toBe(planSha256(PLAN))
    expect(f.written_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('si no se puede escribir, el paso hace lo MISMO y sólo avisa', () => {
    // Un fichero donde debería ir el directorio: mkdir falla con ENOTDIR.
    const bloqueado = join(casa, 'bloqueado')
    writeFileSync(bloqueado, 'no soy un directorio\n')
    const r = ct(bloqueado, 'report', 'report.json')
    expect(r.status).toBe(0)                            // el mismo código que con telemetría
    expect(r.stdout).toMatch(/stageados 1 fichero/)     // y el paso se aplicó igual
    expect(r.stderr).toMatch(/no se pudo escribir la telemetría/)
    // La transición se guardó: la medida no decide nada.
    expect(JSON.parse(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8')).step).toBe('controls')
  })
})
