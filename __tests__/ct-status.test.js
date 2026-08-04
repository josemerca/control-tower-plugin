import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-status.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (o = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...o })

// FAKE_GH_COUNTER_FILE no es opcional para estos tests: sin él, el stub
// devuelve SIEMPRE el primer elemento de FAKE_GH_LIST_SEQUENCE, así que los
// issues "abiertos" se devolverían otra vez como "cerrados" y todo issue en
// vuelo aparecería además como residuo de labels. Cada test se lleva su
// directorio temporal, con su contador y su registro de argv.
function bancada({ worktrees = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-st-'))
  const b = { dir, counter: join(dir, 'gh-count'), argvLog: join(dir, 'gh-argv'), cwd: undefined }
  if (worktrees) {
    // Un checkout git de verdad, propio del test, para poder controlar qué hay
    // en `.worktrees/` sin tocar el repo en el que corre la suite. Los tests
    // que no lo piden corren desde el cwd de vitest (este mismo repo, que no
    // tiene `.worktrees/` ni ramas `feat/*`) — que es el caso "loop en reposo".
    const repo = join(dir, 'repo')
    mkdirSync(repo)
    execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: ['ignore', 'ignore', 'pipe'] })
    for (const n of worktrees) mkdirSync(join(repo, '.worktrees', String(n)), { recursive: true })
    b.cwd = repo
  }
  return b
}

const correr = (b, env = {}, args = ['--repo', 'o/r']) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  cwd: b.cwd,
  env: fakeEnv({ FAKE_GH_COUNTER_FILE: b.counter, FAKE_GH_ARGV_LOG_FILE: b.argvLog, ...env }),
})

const limpiar = (b) => rmSync(b.dir, { recursive: true, force: true })
const argvDe = (b) => (existsSync(b.argvLog) ? readFileSync(b.argvLog, 'utf8') : '')
const SIN_ISSUES = JSON.stringify([[], []])
const enProgreso7 = (extra = {}) => JSON.stringify([[{ number: 7, title: '#7 refresh', body: '<!-- ct-order:7 -->', labels: [{ name: 'status:in-progress' }], ...extra }], []])
const hace = (ms) => JSON.stringify([{ event: 'labeled', label: { name: 'status:in-progress' }, created_at: new Date(Date.now() - ms).toISOString() }])

describe('/ct-status', () => {
  it('un loop limpio: exit 0, sin bloques vacíos', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/EN VUELO/)
    expect(res.stdout).not.toMatch(/ENTREGADO/)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).not.toMatch(/\(ninguno\)/)
    limpiar(b)
  })

  it('un slice en vuelo sin proceso y con claim viejo: exit 3 y lo nombra', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/EN VUELO/)
    expect(res.stdout).toMatch(/#7/)
    expect(res.stdout).toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stdout).toMatch(/claim puesto hace 3 h/)
    limpiar(b)
  })

  it('un slice en vuelo con el claim recién puesto sale arrancando, no muerto: exit 0', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/arrancando/i)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    limpiar(b)
  })

  it('el timeline ilegible no acusa a nadie, y sale 1', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_FAIL: '1' })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stderr).toMatch(/timeline/)
    // El motivo se dice UNA vez: el compositor sabe que la edad falta, pero
    // sólo el CLI sabe por qué, así que su mensaje genérico se sustituye en
    // vez de acumularse — dos líneas sobre el mismo issue por una sola causa
    // se leerían como dos problemas distintos.
    expect(res.stderr.match(/#7/g)).toHaveLength(1)
    limpiar(b)
  })

  it('una lectura que falla NUNCA sale 0, aunque el resto esté limpio', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout + res.stderr).not.toMatch(/limpio/i)
    expect(res.stdout + res.stderr).not.toMatch(/reposo/i)
    limpiar(b)
  })

  it('si la lectura de issues falla, ningún worktree se acusa de huérfano', () => {
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_FAIL_AT: '0' })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stderr).toMatch(/\.worktrees/)
    limpiar(b)
  })

  it('un worktree de un issue ABIERTO que no está en vuelo se nombra sin afirmar que nadie lo reclama', () => {
    const b = bancada({ worktrees: [9] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[{ number: 9, title: '#9 plan', body: '', labels: [{ name: 'status:in-review' }] }], []]) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/RESIDUO/)
    expect(res.stdout).toMatch(/\.worktrees\/9/)
    expect(res.stdout).toMatch(/#9 sigue abierto/)
    expect(res.stdout).toMatch(/status:in-review/)
    // La frase que el §6 del spec proponía sería FALSA aquí: el issue #9 está
    // abierto, o sea vivo.
    expect(res.stdout).not.toMatch(/sin issue vivo que lo reclame/)
    limpiar(b)
  })

  it('un worktree que ningún issue explica sí sale como no reclamado', () => {
    const b = bancada({ worktrees: [11] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: SIN_ISSUES })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/\.worktrees\/11/)
    expect(res.stdout).toMatch(/ning.n issue lo reclama/)
    limpiar(b)
  })

  it('el worktree de un slice EN VUELO no es residuo', () => {
    const b = bancada({ worktrees: [7] })
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(1000) })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/RESIDUO/)
    expect(res.stdout).toMatch(/worktree ✓/)
    limpiar(b)
  })

  it('un issue cerrado que conserva su label status: sale como residuo, con exit 3', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, body: '', labels: [{ name: 'status:in-review' }], state_reason: 'completed' }]]) })
    expect(res.status).toBe(3)
    expect(res.stdout).toMatch(/RESIDUO \(1\)/)
    expect(res.stdout).toMatch(/#3\s+cerrado, pero conserva status:in-review/)
    // Sin worktrees huérfanos, la nota sobre worktrees no pinta nada aquí.
    expect(res.stdout).not.toMatch(/\.worktrees/)
    limpiar(b)
  })

  it('sin pgrep en el PATH nadie sale muerto: exit 1 y «no se pudo comprobar»', () => {
    const b = bancada()
    // Un PATH sin `pgrep` ni `lsof`, pero con `git` (hace falta para resolver
    // la raíz del repo) y con `node` (el stub de `gh` es un script de node y
    // sin él fallaría TAMBIÉN la lectura de issues, que no es lo que se está
    // probando aquí): así el único fallo es el de la señal de procesos, y se
    // ve qué hace el comando cuando falta la herramienta — acusar de abandono
    // a un slice sano por eso sería su peor fallo posible.
    const bin = join(b.dir, 'bin')
    mkdirSync(bin)
    symlinkSync(execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim(), join(bin, 'git'))
    symlinkSync(process.execPath, join(bin, 'node'))
    const res = spawnSync(process.execPath, [script, '--repo', 'o/r'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeGhDir}:${bin}`,
        FAKE_GH_COUNTER_FILE: b.counter,
        FAKE_GH_LIST_SEQUENCE: enProgreso7(),
        FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000),
      },
    })
    expect(res.status).toBe(1)
    expect(res.stdout).toMatch(/proceso \?/)
    expect(res.stdout).not.toMatch(/SIN SE.AL DE VIDA/)
    expect(res.stderr).toMatch(/pgrep/)
    limpiar(b)
  })

  it('no muta nada: jamás llama a `gh issue edit` ni a `gh label`', () => {
    const b = bancada({ worktrees: [7] })
    correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: hace(3 * 3600_000) })
    const log = argvDe(b)
    // La prueba mira el argv REAL con el que se invocó a `gh`, no la ausencia
    // de errores: un comando puede mutar y salir con 0 tan campante.
    expect(log).not.toMatch(/issue edit/)
    expect(log).not.toMatch(/label/)
    expect(log).not.toMatch(/--method (POST|PATCH|PUT|DELETE)/)
    for (const l of log.split('\n').filter(Boolean)) expect(l).toMatch(/^api /)
    limpiar(b)
  })

  it('ninguna lectura lleva --limit, y todas paginan', () => {
    const b = bancada()
    correr(b, { FAKE_GH_LIST_SEQUENCE: enProgreso7(), FAKE_GH_TIMELINE_JSON: '[]' })
    const lineas = argvDe(b).split('\n').filter(Boolean)
    expect(lineas.length).toBe(3) // abiertos, cerrados, timeline de #7
    for (const l of lineas) {
      expect(l).not.toMatch(/--limit/)
      expect(l).toMatch(/--paginate/)
    }
    limpiar(b)
  })

  it('--repo colgante (último token de argv) no llega a gh: exit 2', () => {
    const b = bancada()
    const res = correr(b, {}, ['--repo'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/sin valor/)
    expect(argvDe(b)).toBe('')
    limpiar(b)
  })

  it('--repo con forma inválida: exit 2, sin tocar gh', () => {
    const b = bancada()
    const res = correr(b, {}, ['--repo', 'menoplus'])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/owner\/repo/)
    expect(argvDe(b)).toBe('')
    limpiar(b)
  })

  it('sin --repo: exit 2 con el uso', () => {
    const b = bancada()
    const res = correr(b, {}, [])
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/uso: ct-status\.mjs/)
    limpiar(b)
  })
})
