// Finding 4 (auditoría de interrupción/staleness), segunda mitad: antes,
// ct-next.mjs#classifyClaimOutcome distinguía las causas de un exit 1 de
// dispatch-check.mjs PARSEANDO SU TEXTO libre — frágil ante cualquier
// cambio de wording futuro en ese fichero. Con el contrato de exit code
// ensanchado (1='skip', 3='infra', 4='stuck'; ver la cabecera de
// dispatch-check.mjs y de classifyClaimOutcome en ct-next.mjs), la decisión
// de ct-next.mjs ya no depende de reconocer ninguna frase concreta.
//
// Estos tests verifican el comportamiento de EXTREMO A EXTREMO (ct-next.mjs
// invocando el dispatch-check.mjs real) para los dos casos que antes SOLO
// se podían distinguir parseando texto: 'infra' (sigue con el resto de la
// tanda) y 'stuck' (aborta la tanda entera).
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  process.env.PATH,
].join(':')

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-exitcode-'))
  dirs.push(d)
  return d
}

describe('ct-next — clasifica el claim por el CÓDIGO de dispatch-check, no por su texto (finding 4)', () => {
  it('exit 3 (infra: fallo al leer labels del candidato) → salta #42 y SIGUE con #43, exit 0 final', () => {
    const repoRoot = makeRepoRoot()
    const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    const counterFile = join(repoRoot, 'gh-list-count')
    const viewCounterFile = join(repoRoot, 'gh-view-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // colisión-check (lectura de labels del candidato) FALLA ; idx3/4:
      // dispatch-check(#43) colisión-check + readback, limpios.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_VIEW_FAIL_AT: '0', // la PRIMERA llamada a `issue view` (labelsOf del candidato #42) falla
      FAKE_GH_VIEW_COUNTER_FILE: viewCounterFile,
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz']),
      FAKE_GIT_LOG_FILE: gitLog,
    })
    expect(r.out).toMatch(/no se pudo reclamar — fallo de infraestructura/)
    expect(r.out).toMatch(/sigo con el resto de esta tanda/)
    expect(r.out).toMatch(/lanzado #43/)
    expect(r.out).toMatch(/lanzad[oa]s? 1.*2/i)
    expect(r.code).toBe(0)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).not.toMatch(/worktree add -b feat\/42/)
    expect(gitLogTxt).toMatch(/worktree add -b feat\/43/)
  })

  it('exit 4 (huérfano: carrera perdida y el revert también falla) → aborta TODA la tanda con exit 1, aunque quedara otro candidato', () => {
    const repoRoot = makeRepoRoot()
    const openIssue42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }
    const openIssue43 = { number: 43, title: '#43 otro', labels: [{ name: 'status:ready' }], body: '' }
    // El readback (idx3) tiene que incluir NUESTRO PROPIO #42 (ya con el
    // claim recién escrito) además del rival de número menor — claimLost()
    // busca `mine` en el propio readback; si #42 no apareciera ahí, el
    // resultado sería "ambiguo, no bloqueamos" en vez de la pérdida real de
    // carrera que este test necesita reproducir.
    const readbackConPerdida = [
      { number: 42, labels: [{ name: 'status:in-progress' }, { name: 'touches:zzz' }] },
      { number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:zzz' }] }, // menor número → gana, nosotros perdemos
    ]
    const counterFile = join(repoRoot, 'gh-list-count')
    const gitLog = join(repoRoot, 'git-log')
    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#42)
      // colisión-check (limpio) ; idx3: readback CON pérdida (#5 < #42).
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue42, openIssue43], [], [], readbackConPerdida]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz']),
      FAKE_GIT_LOG_FILE: gitLog,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress', // el revert de #42 falla
    })
    expect(r.out).toMatch(/dispatch-check devolvió exit 4 para #42/)
    expect(r.out).toMatch(/bloqueado en status:in-progress sin nadie trabajándolo/)
    expect(r.out).toMatch(/Abortando toda la tanda/)
    expect(r.out).not.toMatch(/lanzado #43/) // NUNCA llega a intentar el siguiente candidato
    expect(r.code).toBe(1)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})
