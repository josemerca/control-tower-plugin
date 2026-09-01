import { describe, it, expect } from 'vitest'
import { LOOP_STATUS_LABELS } from '../scripts/groom.js'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir, specUrl } from './fixtures/spec-repo.js'

// F6 — dos silencios de /ct-groom que la prueba de campo destapó:
//
//   grave 2: TODOS los issues nacen con `status:backlog` (groom.js#buildLabels)
//   y el dispatcher solo mira `status:ready` — así que correr groom y acto
//   seguido `/ct-next` produce "no hay slices despachables" sobre seis issues
//   recién creados. El groom no lo mencionaba en ninguna parte de su salida.
//
//   menor 5: `gh label create --force` no distingue "reutilicé una label que
//   ya existía en el repo" de "me acabo de inventar una". El contrato pide
//   reutilizar el vocabulario de labels del repo, pero nadie podía comprobar
//   cuál era ese vocabulario ni ver, después, qué acabó inventándose.
//
// Además, --force ACTUALIZA la label existente (color/descripción incluidos):
// crear solo las que faltan deja de tocar las que el repo ya tenía.

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

const SPEC = `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | – | api | db |
`
// Labels que este spec produce: type:backend, area:api, touches:db, status:backlog

function writeSpec(content = SPEC) {
  const dir = makeSpecDir('ctg-labels-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, content)
  return { dir, spec }
}

function run(args, envOverrides = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
  })
}

const MILESTONE_ENV = { FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) }

describe('ct-groom — labels: distingue las que ya existían de las que crea (F6, menor 5)', () => {
  it('corrida real: solo llama a `gh label create` para las que NO existen, y nombra por separado reutilizadas y nuevas', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[{ name: 'type:backend' }, { name: 'area:api' }, { name: 'bug' }]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    // Las que ya existían NO se tocan (con --force, `gh label create` las
    // reescribiría — color/descripción incluidos — en cada corrida).
    expect(log).not.toMatch(/label create type:backend/)
    expect(log).not.toMatch(/label create area:api/)
    // Las que faltaban sí se crean.
    expect(log).toMatch(/label create touches:db/)
    expect(log).toMatch(/label create status:backlog/)
    // Y la salida lo dice, en dos grupos distintos.
    expect(res.stderr).toMatch(/ya exist[íi]an.*type:backend/)
    expect(res.stderr).toMatch(/ya exist[íi]an.*area:api/)
    expect(res.stderr).toMatch(/creadas.*touches:db/)
    expect(res.stderr).toMatch(/creadas.*status:backlog/)
    // Una label del repo ajena al plan no se menciona ni se toca.
    expect(res.stderr).not.toMatch(/\bbug\b/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--dry-run --repo: anuncia qué labels se inventarían ANTES de crear nada, y stdout sigue siendo JSON puro', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[{ name: 'type:backend' }]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    expect(() => JSON.parse(res.stdout)).not.toThrow() // el plan sigue saliendo limpio por stdout
    expect(res.stderr).toMatch(/ya exist[íi]an.*type:backend/)
    expect(res.stderr).toMatch(/se crear[íi]an.*area:api/)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/label create/) // un dry-run nunca crea una label
    rmSync(dir, { recursive: true, force: true })
  })

  // Contrapeso: el aviso solo tiene valor si NO aparece cuando no hay nada
  // que inventar. Un mensaje en cada corrida (incluida la que reutiliza el
  // vocabulario entero) entrenaría a ignorarlo, que es exactamente la
  // familia de fallo que esta tanda persigue — mismo criterio que el reporte
  // de divergencia de F5: silencio = nada que revisar.
  it('todas las labels del plan ya existen → no crea ninguna y no dice nada sobre labels', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      // F21: el plan produce además `gate:none` (una label de gate por issue,
      // siempre) — sin ella en el repo, esta corrida SÍ tendría una label nueva
      // que crear y el test dejaría de probar el caso "no hay nada que decir".
      // Mismo criterio que la nota de F21 sobre `gate:none`: el vocabulario
      // `status:` entero (groom.js#LOOP_STATUS_LABELS) forma parte de lo que el
      // repo tiene que TENER, así que sin él aquí esta corrida SÍ tendría labels
      // nuevas que crear y el test dejaría de probar el caso "no hay nada que decir".
      FAKE_GH_LABELS_LIST: JSON.stringify([[{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'gate:plan' }, ...LOOP_STATUS_LABELS.map((name) => ({ name }))]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    expect(log).not.toMatch(/label create/)
    expect(res.stderr).not.toMatch(/labels/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('si no se puede listar las labels del repo, aborta con mensaje claro en vez de crearlas a ciegas', () => {
    const { dir, spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_FAIL: '1',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no se pudieron listar las labels/i)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom — dice que lo que acaba de crear NO es despachable todavía (F6, grave 2)', () => {
  it('corrida real: tras crear los issues, nombra status:backlog, la promoción a status:ready y el comando exacto', () => {
    const { dir, spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/status:backlog/)
    expect(res.stderr).toMatch(/status:ready/)
    expect(res.stderr).toMatch(/ct-next/)
    expect(res.stderr).toMatch(/gh issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--dry-run: el mismo recordatorio (el preview no puede callar lo que la corrida real sí diría)', () => {
    const { dir, spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/status:backlog/)
    expect(res.stderr).toMatch(/status:ready/)
    rmSync(dir, { recursive: true, force: true })
  })

  // El recordatorio no puede ser ruido perpetuo: si el epic ya está promovido
  // entero, no hay nada que recordar. `status:` lo mueven un humano o
  // /ct-next como parte normal del flujo (por eso queda fuera del diff de
  // divergencia, ver reconcile.js), así que el criterio es el estado REAL de
  // los issues, no "acabo de crear algo".
  it('todos los issues del epic ya promovidos (status:ready) → sin recordatorio', () => {
    const { dir, spec } = writeSpec()
    const existing = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:ready' }],
      body: '<!-- ct-order:1 -->',
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.stderr).not.toMatch(/recordatorio/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('un issue preexistente todavía en backlog → el recordatorio lo cuenta aunque esta corrida no cree nada', () => {
    const { dir, spec } = writeSpec()
    const existing = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:backlog' }],
      body: '<!-- ct-order:1 -->',
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existing]]),
      FAKE_GH_LABELS_LIST: JSON.stringify([[]]),
    })
    expect(res.stderr).toMatch(/recordatorio/)
    expect(res.stderr).toMatch(/status:ready/)
    rmSync(dir, { recursive: true, force: true })
  })
})
