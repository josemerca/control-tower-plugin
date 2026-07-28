// F18/H6 — LECTURAS ACOTADAS QUE SE TRATABAN COMO COMPLETAS.
//
// El patrón: una llamada a `gh` con tope (`--limit N`, o un `first: N` de
// GraphQL) cuyo resultado se usa para decidir que algo NO EXISTE. El plugin ya
// tenía la lección escrita en dos sitios —`ct-next.mjs#loadIssues` ("un
// `--limit` fijo deja fuera justo los issues VIEJOS") y la enumeración de
// issues de `ct-groom.mjs` ("reintroduciría el mismo fallo por truncado")— y
// sin aplicar en los dos que quedaban, ambos en el camino de `--project`:
//
//   1. `gh project item-list --limit 200`: con más de 200 items,
//      `hasProjectItem` devuelve `false` de items que SÍ existen y /ct-groom
//      los vuelve a añadir. DUPLICADOS en el Project, en silencio.
//   2. `fields(first: 50)`: con más de 50 campos, un project que SÍ tiene su
//      campo Sprint recibe un "este project no tiene un campo de iteración
//      llamado Sprint" — una afirmación falsa sobre algo que no se ha visto.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

const SPEC = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | – | api | db |
`

function writeSpec() {
  const dir = makeSpecDir('ctg-f18-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, SPEC)
  return { dir, spec }
}

function run(args, envOverrides = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
  })
}

const MILESTONE_ENV = { FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]) }

// Un issue YA existente (orden 1, marcador ct-order:1) para que /ct-groom no
// cree nada y solo tenga que decidir si le falta el item de project.
const existente = { number: 501, title: '#1 login', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:backlog' }] }

// 200 items de relleno + el del issue 501 en la posición 201: dentro del
// project, pero FUERA de la primera página de `--limit 200`.
function itemsConElNuestroAlFinal() {
  const relleno = Array.from({ length: 200 }, (_, i) => ({ id: `PVTI_${i}`, content: { repository: 'o/r', number: 9000 + i, type: 'Issue' } }))
  return [...relleno, { id: 'PVTI_ours', content: { repository: 'o/r', number: 501, type: 'Issue' } }]
}

describe('H6 — `gh project item-list` truncado ya no produce duplicados en silencio', () => {
  it('con 201 items, el item que vive más allá del tope SE ENCUENTRA (segunda consulta por totalCount) y no se re-añade', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existente]]),
      FAKE_GH_PROJECT_ITEMS: JSON.stringify(itemsConElNuestroAlFinal()),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    // exit 3 = divergencias detectadas contra el spec (el issue de fixture es
    // mínimo a propósito); lo que importa aquí es que la corrida NO abortó
    // (exit 1) y que la lectura del project fue completa.
    expect([0, 3]).toContain(res.status)
    const log = readFileSync(argvLog, 'utf8')
    // Se pidió una segunda vez, con el total exacto que dijo GitHub.
    expect(log).toMatch(/project item-list 3 --owner o --limit 201 --format json/)
    // Y NO se volvió a añadir al project: el item ya estaba.
    expect(log).not.toMatch(/project item-add/)
  })

  it('sin `totalCount` (gh que no lo expone) NO se da la lista por completa en silencio', () => {
    const { dir, spec } = writeSpec()
    // El stub honra `--limit` como el gh real, así que "la segunda consulta
    // sigue viniendo corta" no es simulable sin un stub deshonesto — ese
    // camino queda cubierto por lectura de código (aborta con exit 1) y no se
    // afirma aquí. Lo que sí se comprueba es el otro extremo del contrato.
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existente]]),
      FAKE_GH_PROJECT_ITEMS: JSON.stringify(itemsConElNuestroAlFinal()),
      FAKE_GH_PROJECT_ITEMS_NO_TOTALCOUNT: '1',
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.stderr).toMatch(/no devuelve `totalCount`/)
    expect(res.stderr).toMatch(/NO se ha podido descartar que la lista de items/)
  })

  it('control negativo: con pocos items no hay segunda consulta', () => {
    const { dir, spec } = writeSpec()
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existente]]),
      FAKE_GH_PROJECT_ITEMS: JSON.stringify([{ id: 'PVTI_ours', content: { repository: 'o/r', number: 501, type: 'Issue' } }]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect([0, 3]).toContain(res.status)
    const listCalls = readFileSync(argvLog, 'utf8').split('\n').filter((l) => l.startsWith('project item-list'))
    expect(listCalls.length).toBe(1)
    expect(listCalls[0]).toMatch(/--limit 200/)
  })
})

describe('H6 — `fields(first: 50)`: "no lo he visto" deja de decirse como "no existe"', () => {
  it('con más campos de los que trajo la consulta, NO se afirma que falte el campo Sprint', () => {
    const { spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existente]]),
      FAKE_GH_PROJECT_FIELDS: JSON.stringify([{ id: 'F1', name: 'Estado' }]),
      FAKE_GH_PROJECT_FIELDS_TOTALCOUNT: '87',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no se ha podido comprobar si el project/i)
    expect(res.stderr).toMatch(/1 de sus 87 campos/)
    expect(res.stderr).not.toMatch(/no tiene un campo de iteración llamado "Sprint" —/)
  })

  it('control negativo: si de verdad se vieron todos los campos y no hay Sprint, se sigue diciendo tal cual', () => {
    const { spec } = writeSpec()
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--project', '3'], {
      ...MILESTONE_ENV,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existente]]),
      FAKE_GH_PROJECT_FIELDS: JSON.stringify([{ id: 'F1', name: 'Estado' }]),
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no tiene un campo de iteración llamado "Sprint"/)
  })
})

// Barrido explícito del resto de lecturas de `gh` de los tres ejecutables,
// para que el criterio quede fijado y no haya que redescubrirlo: toda
// enumeración que decida "no existe" usa paginación REAL (`--paginate`), sin
// ningún tope fijo.
describe('H6 — barrido: ninguna enumeración del plugin usa un tope fijo', () => {
  const scripts = ['ct-next.mjs', 'ct-groom.mjs', 'dispatch-check.mjs']
  it('las enumeraciones de issues (los tres ejecutables) van con --paginate y sin --limit', () => {
    for (const s of scripts) {
      const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', s), 'utf8')
      const lineas = src.split('\n').filter((l) => l.includes("'issues'") && l.includes('gh(['))
      for (const l of lineas) {
        expect(l, `${s}: ${l.trim()}`).toMatch(/--paginate/)
        expect(l, `${s}: ${l.trim()}`).not.toMatch(/--limit/)
      }
    }
  })
  it('el único `--limit` que queda (items del project) comprueba su propio truncado', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs'), 'utf8')
    expect(src).toMatch(/item-list/)
    expect(src).toMatch(/totalCount/)
  })
})
