// IMPORTANTE (revisión externa): un Ctrl-C de terminal NORMAL (que sí llega
// también al hijo — a diferencia del escenario adversarial de finding 1,
// donde el hijo lo ignora) durante attemptClaim mata a dispatch-check.mjs
// por señal: Node deja `status` a `null` y `signal` con el nombre. Antes de
// este fix, ct-next.mjs culpaba esto, sin distinción, de "probablemente un
// bug o una mala configuración (p.ej. --repo mal formado)" — activamente
// engañoso justo cuando el usuario sabe perfectamente qué pasó (él mismo
// interrumpió), y sin mencionar lo más importante: dispatch-check.mjs pudo
// haber escrito el claim ANTES de morir, y no hay forma de saberlo desde
// aquí.
//
// CT_CLAIM_TEST_SELF_KILL_SIGNAL (hook exclusivo de test en
// dispatch-check.mjs) hace que el propio subproceso se envíe la señal a sí
// mismo justo tras validar su uso — misma syscall subyacente que una señal
// externa, pero determinista: evita tener que coordinar el PID de un
// subproceso lanzado dentro de otro subproceso (frágil, con las mismas
// carreras de temporización de finding 1).
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: entorno hermético (dirs de cuenta + stubs de cmux/claude) — ver fixtures/hermetic-env.js
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-sigkilled-'))
  dirs.push(d)
  return d
}

const openIssue77 = { number: 77, title: '#77 algo', labels: [{ name: 'status:ready' }], body: '' }

describe('ct-next — dispatch-check muerto por señal durante el claim (IMPORTANTE, revisión externa)', () => {
  it('SIGTERM: el mensaje nombra la señal, avisa de que el claim puede haberse escrito, y da el comando manual — nunca culpa a una "mala configuración"', () => {
    const repoRoot = makeRepoRoot()
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env, ...ACCOUNT_ENV, PATH: fakePath, FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
        CT_CLAIM_TEST_SELF_KILL_SIGNAL: 'SIGTERM',
      },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(1)
    expect(r.signal).toBeNull() // ct-next.mjs mismo termina limpio (process.exit), no matado en seco
    expect(out).toMatch(/dispatch-check para #77 terminó por la señal SIGTERM/)
    expect(out).toMatch(/no se puede saber si el claim llegó a escribirse antes de morir/)
    expect(out).toMatch(/gh issue edit 77 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(out).not.toMatch(/probablemente es un bug o una mala configuración/)
    expect(out).toMatch(/Abortando toda la tanda/)
  })

  it('SIGINT: mismo tratamiento — nombra la señal correcta', () => {
    const repoRoot = makeRepoRoot()
    const r = spawnSync('node', [script, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env, ...ACCOUNT_ENV, PATH: fakePath, FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue77], []]),
        CT_CLAIM_TEST_SELF_KILL_SIGNAL: 'SIGINT',
      },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(1)
    expect(out).toMatch(/dispatch-check para #77 terminó por la señal SIGINT/)
    expect(out).not.toMatch(/probablemente es un bug o una mala configuración/)
  })
})
