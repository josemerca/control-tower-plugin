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

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
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
    // detección de staleness).
    //
    // D5, hallazgo A — el exit code de ESTE caso pasa de 3 a 1. Aquel
    // arreglo lo dejó cayendo en el exit 3, cuyo mensaje afirmaba "Nada
    // quedó a medias ni bloqueado — reintenta más tarde": mentira en este
    // camino (claim escrito, rama y worktree creados, `cmux new-workspace`
    // con exit 0) e imposible de seguir (el issue ya no está en
    // status:ready y el destino está ocupado). 1 = "para y que lo mire un
    // humano" es la semántica correcta, y el mensaje ahora enumera qué hay
    // que limpiar.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN: cmux aceptó el lanzamiento de #90 \(exit 0\), pero la sesión NO está en/)
    expect(r.out).toMatch(/está en "\/Users\/fake\/\.config\/ghostty-default-shell-dir" en su lugar/)
    expect(r.out).toMatch(/NO se cuenta como lanzado con éxito/)
    // El resumen final NO puede decir "nada quedó a medias" ni "reintenta
    // más tarde": es exactamente la afirmación falsa que D5 elimina.
    expect(r.out).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    expect(r.out).toMatch(/la rama feat\/90 y el worktree .*\.worktrees\/90/)
    expect(r.out).toMatch(/gh issue edit 90 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
    expect(r.out).not.toMatch(/Nada quedó a medias/)
    expect(r.out).not.toMatch(/no hay nada que limpiar a mano/)
    // El texto sí puede NOMBRAR "reintenta más tarde" para negarlo, pero
    // nunca puede recomendarlo como salida.
    expect(r.out).toMatch(/no es "reintenta más tarde"/)
    expect(r.out).not.toMatch(/reintenta más tarde, o en la próxima vuelta del \/loop/)
    // Nunca debe leerse como un lanzamiento confirmado sin matices.
    expect(r.out).not.toMatch(/lanzado #90 en .*verificado/)
  })

  it('cmux acepta el lanzamiento pero la sesión no aparece al consultar en absoluto → ATENCIÓN de "no se encontró", y NO cuenta como progreso (exit 1)', () => {
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
    // D5, hallazgo A: y por el mismo motivo que 'wrong-cwd', el código pasa
    // de 3 a 1 — aquí también quedan claim, rama y worktree detrás.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/ATENCIÓN: cmux devolvió éxito \(exit 0\) al lanzar #90, pero no se encontró ninguna sesión/)
    expect(r.out).toMatch(/NO se cuenta como lanzado con éxito/)
    expect(r.out).toMatch(/quedaron LANZADOS SIN VERIFICAR/)
    expect(r.out).not.toMatch(/Nada quedó a medias/)
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
    // D5, hallazgo A (el caso MIXTO, que el encargo no nombraba y que era el
    // más difícil de ver): con uno confirmado y otro sin confirmar,
    // `launchedCount` es 1 — así que el exit 3 nunca se alcanzaba y la tanda
    // salía con exit 0, o sea "progreso" para un /loop, mientras #90 quedaba
    // en status:in-progress con rama y worktree y ningún agente confirmado.
    // Verificado contra el código sin arreglar: exit 0.
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/lanzados 1\/2 slice\(s\) seleccionados de esta tanda/)
    expect(r.out).toMatch(/1 de los 2 slice\(s\) seleccionados quedaron LANZADOS SIN VERIFICAR/)
    // Solo #90 debe aparecer en la lista de "hay que mirar esto a mano": el
    // #91 confirmado no se toca ni se menciona como residuo.
    expect(r.out).toMatch(/- #90: la sesión de cmux existe pero está en/)
    expect(r.out).not.toMatch(/- #91: /)
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
