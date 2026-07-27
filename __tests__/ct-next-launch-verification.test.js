// Finding 3 (auditoría de interrupción/staleness): la forma real de comando
// de cmux es `/bin/zsh -lc '{ cd -- '\''<cwd>'\'' 2>/dev/null || [ ! -d
// '\''<cwd>'\'' ]; } && ...'` — TOLERA un cwd inexistente (la comprobación
// `[ ! -d ... ]` hace que el `{...}` entero tenga éxito de todas formas) y
// arranca el agente en el shell de login por defecto en su lugar, saliendo
// con exit 0. ct-next.mjs imprimía "lanzado #N en <wt>" basándose solo en
// que `new-workspace` devolviera exit 0 — infiriendo "está en el sitio
// correcto" de "el comando no falló", justo lo que este hallazgo prohíbe.
//
// Estos tests verifican que ct-next.mjs ahora consulta cmux de solo lectura
// (`list-windows` + `workspace list --json`, NUNCA `new-workspace` fuera del
// lanzamiento real) para distinguir los tres casos: confirmado, cwd
// equivocado, y "no se encuentra la sesión" — y que el mensaje final
// refleja exactamente cuál de los tres se observó.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// D4: entorno hermético (dirs de cuenta + stubs de cmux/claude) — ver fixtures/hermetic-env.js
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-launch-'))
  dirs.push(d)
  return d
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }

describe('ct-next — verificación de lanzamiento cmux (finding 3)', () => {
  it('caso feliz: cmux confirma la sesión en el cwd exacto → mensaje "verificado"', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90 en .*\.worktrees\/90.*verificado: la sesión cmux está corriendo en ese directorio/)
  })

  it('cmux acepta el lanzamiento pero la sesión queda en OTRO directorio (cwd inexistente tolerado) → ATENCIÓN, nunca "lanzado" sin más', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_WRONG_CWD_SUBSTR: '#90',
    })
    // IMPORTANTE (revisión externa): 'wrong-cwd' ya NO cuenta como lanzado
    // con éxito (antes incrementaba launchedCount igual, y la tanda salía
    // con exit 0 — progreso normal para un /loop — aunque el issue quedara
    // in-progress sin agente confirmado, invisible también para la
    // detección de staleness). Con el único candidato de la tanda sin
    // confirmar, el exit code cae en el 3 ya existente ("seleccionado pero
    // cero lanzamientos confirmados, reintenta más tarde") — nunca 0.
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/ATENCIÓN: cmux aceptó el lanzamiento de #90 \(exit 0\), pero la sesión NO está en/)
    expect(r.out).toMatch(/está en "\/Users\/fake\/\.config\/ghostty-default-shell-dir" en su lugar/)
    expect(r.out).toMatch(/NO se cuenta como lanzado con éxito/)
    // Nunca debe leerse como un lanzamiento confirmado sin matices.
    expect(r.out).not.toMatch(/lanzado #90 en .*verificado/)
  })

  it('cmux acepta el lanzamiento pero la sesión no aparece al consultar en absoluto → ATENCIÓN de "no se encontró", y NO cuenta como progreso (exit 3)', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_SKIP_STATE_SUBSTR: '#90',
    })
    // IMPORTANTE (revisión externa): mismo motivo que 'wrong-cwd' arriba —
    // 'not-found' es evidencia POSITIVA de un problema, no cuenta como
    // lanzado, y el exit code deja de mentir sobre "progreso".
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/ATENCIÓN: cmux devolvió éxito \(exit 0\) al lanzar #90, pero no se encontró ninguna sesión/)
    expect(r.out).toMatch(/NO se cuenta como lanzado con éxito/)
    expect(r.out).not.toMatch(/lanzado #90 en .*verificado/)
  })

  it('no se puede consultar cmux tras el lanzamiento (daemon caído) → mensaje "no se pudo verificar", nunca afirma confianza que no tiene', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_LIST_WINDOWS_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/lanzado #90 en .*\.worktrees\/90/)
    expect(r.out).toMatch(/no se pudo verificar la sesión/)
    expect(r.out).not.toMatch(/verificado: la sesión cmux está corriendo/)
  })

  it('ataque adversarial: dos slices en la misma tanda con nombres distintos no se confunden entre sí', () => {
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const openIssue91 = { number: 91, title: '#91 otra cosa', labels: [{ name: 'status:ready' }], body: '' }
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90, openIssue91], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      // #90 queda en el cwd equivocado; #91 se lanza limpio.
      FAKE_CMUX_WRONG_CWD_SUBSTR: '#90',
    })
    expect(r.out).toMatch(/ATENCIÓN: cmux aceptó el lanzamiento de #90 \(exit 0\), pero la sesión NO está en/)
    expect(r.out).toMatch(/lanzado #91 en .*\.worktrees\/91.*verificado: la sesión cmux está corriendo en ese directorio/)
  })

  it('IMPORTANTE (revisión externa): un cambio de esquema en la respuesta de cmux (campo renombrado) se trata como no concluyente, NUNCA como "cero sesiones confirmado"', () => {
    // Simula una versión de cmux que devuelve `title` en vez de
    // `custom_title` — HAY entradas de verdad (la que este mismo dispatch
    // acaba de lanzar), pero ninguna con el campo que ct-next.mjs reconoce.
    // Sin la guarda de esquema, esto se filtraría en silencio a un array
    // vacío, indistinguible de "cmux respondió y de verdad no hay
    // sesiones" — una falsa alarma en TODO dispatch con éxito.
    const repoRoot = makeRepoRoot()
    const counterFile = join(repoRoot, 'gh-list-count')
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_CMUX_SCHEMA_MISMATCH: '1',
    })
    expect(r.code).toBe(0) // se cuenta como lanzado: "no concluyente" usa el mismo beneficio de la duda que "no se pudo consultar"
    expect(r.out).toMatch(/lanzado #90 en .*\.worktrees\/90/)
    expect(r.out).toMatch(/no se pudo verificar la sesión/)
    expect(r.out).not.toMatch(/no se encontró ninguna sesión con el nombre/) // nunca el "not-found" confiado
    expect(r.out).not.toMatch(/verificado: la sesión cmux está corriendo/)
  })
})
