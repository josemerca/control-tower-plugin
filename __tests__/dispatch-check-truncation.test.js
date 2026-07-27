// Finding 4 (auditoría de interrupción/staleness): `console.error(grande)`
// seguido INMEDIATAMENTE de `process.exit()` puede perder texto —
// `process.stdout`/`process.stderr` son ASÍNCRONOS hacia una tubería en
// POSIX, y `process.exit()` no espera a que un `write()` en vuelo termine de
// vaciarse (documentado en los propios docs de Node; el mismo razonamiento
// que ya motivó el `writeSync` de `attemptClaim` en ct-next.mjs, y que un
// sibling task usó para diagnosticar el mismo patrón en otro fichero). Los
// diagnósticos "ATENCIÓN … libéralo a mano" de dispatch-check.mjs son
// EXACTAMENTE los que un humano necesita íntegros cuando algo salió mal — y
// el mensaje `COLLISION: ...` puede crecer arbitrariamente con el número de
// issues en vuelo que comparten un token.
//
// Este test reproduce el escenario adversarial directamente: miles de
// issues en vuelo compartiendo el token del candidato, de forma que el
// mensaje COLLISION supere ampliamente el tamaño típico de buffer de pipe
// en POSIX (~64 KiB en macOS) — y comprueba que el ÚLTIMO issue de la lista
// (el que se perdería primero si algo se trunca) sigue apareciendo íntegro.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

function runReal(args, envOverrides = {}) {
  try {
    const out = execFileSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      maxBuffer: 64 * 1024 * 1024, // el LADO QUE LEE no es el problema — solo nos aseguramos de no truncar nosotros mismos al capturar.
      env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}

describe('dispatch-check.mjs — el diagnóstico COLLISION no se trunca aunque sea enorme (finding 4)', () => {
  it('miles de issues en vuelo colisionando: el ÚLTIMO de la lista (el primero en perderse si algo trunca) llega íntegro', () => {
    const N = 10000
    const inFlight = []
    for (let i = 1; i <= N; i++) {
      inFlight.push({ number: 1000 + i, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] })
    }
    const r = runReal(['5', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([inFlight]),
    })
    expect(r.code).toBe(1)
    expect(r.out.length).toBeGreaterThan(100 * 1024) // confirma que el escenario SÍ es lo bastante grande para superar un buffer de pipe típico (~64 KiB)
    expect(r.out).toMatch(/^COLLISION: #5 choca con/)
    // El último issue de la lista es el candidato más probable a perderse
    // si algo se trunca — debe seguir estando presente, íntegro.
    expect(r.out).toMatch(new RegExp(`#${1000 + N}\\[touches:db\\]`))
  })
})
