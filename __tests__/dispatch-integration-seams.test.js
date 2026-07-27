// Integración D1 (fix/dispatch-graph-hardening) + D2 (fix/dispatch-silent-failures):
// cada rama por separado prueba su propia mitad — D1 el alcance por epic del
// grafo de dependencias (colisión de orden, deps por sección, avisos), D2 el
// contrato de exit codes del bucle de claim (skip/infra/stuck, exit 0/1/2/3).
// Ninguna de las dos suites originales ejercita las DOS mitades A LA VEZ en
// una sola corrida real de ct-next.mjs — exactamente donde una integración
// puede romperse en las costuras sin que ningún test heredado lo note. Estos
// tests construyen esos escenarios de costura explícitamente:
//
//   Costura A — un epic queda EXCLUIDO por colisión de orden (D1) Y el único
//   candidato que queda de otro epic pierde la carrera de claim en vivo (D2)
//   → exit 3 (nunca 0 ni 1): la exclusión no debe, por sí sola, cambiar el
//   código de "reintenta más tarde".
//   Costura B — un epic con colisión de orden es la ÚNICA fuente de trabajo
//   del repo → tras excluirlo no queda NADA que seleccionar → exit 0 (no
//   exit 1: la colisión nunca aborta el batch, solo lo estrecha).
//   Costura C — un issue con "merge-after" fuera de "## Dependencias" (D1,
//   avisa pero despacha) termina huérfano en status:in-progress al reclamar
//   (D2, 'stuck') → exit 1 con el aviso Y el ATENCIÓN presentes a la vez, sin
//   que ninguno contradiga al otro.
//   Costura D — en una misma tanda: un epic excluido por colisión (D1), un
//   issue con deps mal formadas en OTRO epic (D1, bloquea SOLO ese issue) y
//   un issue con stray deps en un TERCER epic (D1, avisa pero despacha) que
//   sí se reclama y lanza con éxito (D2, exit 0) — verifica que los avisos
//   de datos rotos no interfieren entre sí ni con el progreso real de la
//   tanda.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
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

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], { encoding: 'utf8', env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, ...envOverrides } })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-next-seam-'))
  dirs.push(d)
  return d
}

// Issue "crudo" tal y como lo devuelve `gh api repos/<o>/<r>/issues` — con
// milestone (D1, epicKeyOf) y body (marcador ct-order + secciones opcionales
// de Dependencias/Descripción, D1 dep-por-sección).
function rawIssue({ number, milestone, order, status = 'status:ready', touches = [], body = '' }) {
  const labels = [{ name: status }, ...touches.map((t) => ({ name: `touches:${t}` }))]
  const fullBody = `${body}\n<!-- ct-order:${order} -->\n`
  return {
    number,
    title: `#${number} slice ${number}`,
    labels,
    body: fullBody,
    milestone: milestone == null ? null : { number: milestone },
  }
}

describe('Costura A — epic excluido por colisión de orden (D1) + único candidato restante pierde la carrera (D2) → exit 3', () => {
  it('la colisión no cambia el código de "reintenta más tarde"', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    // Epic 100: #10 y #11 comparten <!-- ct-order:1 --> → colisión, epic
    // excluido ENTERO de `issues` (buildDispatchInput).
    const i10 = rawIssue({ number: 10, milestone: 100, order: 1 })
    const i11 = rawIssue({ number: 11, milestone: 100, order: 1 })
    // Epic 200: #20, único superviviente, listo y sin deps.
    const i20 = rawIssue({ number: 20, milestone: 200, order: 1, touches: ['foo'] })
    // Trabajo en vuelo que SOLO dispatch-check ve en su propia lectura en
    // vivo (idx2) — nunca en la foto que toma ct-next (idx0) — reproduciendo
    // la carrera perdida limpia del propio D2.
    const inFlight99 = { number: 99, labels: [{ name: 'status:in-progress' }, { name: 'touches:foo' }] }

    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#20)
      // collision-check en vivo → ve a #99 en vuelo.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i10, i11, i20], [], [inFlight99]]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:foo', 'status:ready']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
    })

    // D1: el aviso de colisión se imprime SIEMPRE, nunca en silencio.
    expect(r.out).toMatch(/aviso: colisión de orden.*#10.*#11|aviso: colisión de orden.*#11.*#10/)
    expect(r.out).toMatch(/EXCLUIDO de esta tanda/)
    // Solo #20 se seleccionó (los de la epic 100 nunca compitieron).
    expect(r.out).toMatch(/seleccionados para esta tanda.*#20/)
    // #20 choca en vivo contra #99 → se salta, cero lanzados.
    expect(r.out).toMatch(/saltando #20/)
    expect(r.out).toMatch(/lanzad[oa]s? 0.*1/i)
    // Exit 3 — el mismo "reintenta más tarde" de D2, NO 0 (habría progreso
    // real que no hubo) ni 1 (nada se rompió: la exclusión no es un fallo).
    expect(r.code).toBe(3)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

describe('Costura B — la colisión de orden es la ÚNICA fuente de trabajo del repo → exit 0, no exit 1', () => {
  it('tras excluir el epic colisionado no queda nada que seleccionar, y eso NO es un fallo', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    const i10 = rawIssue({ number: 10, milestone: 100, order: 1 })
    const i11 = rawIssue({ number: 11, milestone: 100, order: 1 })

    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i10, i11], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })

    expect(r.out).toMatch(/aviso: colisión de orden/)
    // planDispatch no seleccionó nada — nunca se abre un dispatch-check.
    expect(r.out).toMatch(/No hay ningún issue en status:ready/)
    // exit 0: "nada que hacer, y ya se explicó por qué" — la colisión NUNCA
    // aborta el batch (round 2 de D1), ni siquiera cuando deja el repo sin
    // nada que despachar.
    expect(r.code).toBe(0)
    const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(argv).not.toMatch(/issue edit/) // ningún claim intentado
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

describe('Costura C — stray dep fuera de sección (D1, avisa y despacha) que termina huérfana en status:in-progress (D2, stuck) → exit 1 con ambos mensajes', () => {
  it('el aviso de stray dep y el ATENCIÓN de huérfano conviven sin contradecirse', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    // #50: sin sección "## Dependencias" en absoluto (deps=[], malformed:false
    // — nunca bloquea), pero con un "merge-after #7" suelto en la
    // "## Descripción" — D1 lo expone como strayDeps, avisa, despacha igual.
    const i50 = rawIssue({
      number: 50,
      milestone: 500,
      order: 1,
      touches: ['zzz'],
      body: '## Descripción\nAlgo que menciona merge-after #7 pero no cuenta como dependencia real.\n',
    })

    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#50)
      // collision-check (limpio) ; idx3: dispatch-check(#50) readback → FALLA.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i50], [], []]),
      FAKE_GH_LIST_FAIL_AT: '3',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:zzz', 'status:ready']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GIT_LOG_FILE: gitLog,
      // El revert posterior al fallo de readback TAMBIÉN falla → huérfano.
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready --remove-label status:in-progress',
    })

    // D1: el aviso de stray dep se imprime — el estrechamiento del dominio de
    // deps es correcto, pero nunca en silencio.
    expect(r.out).toMatch(/aviso: #50 tiene "merge-after #7" fuera de la sección/)
    // D2: 'stuck' aborta la tanda ENTERA — el issue queda huérfano.
    expect(r.out).toMatch(/ATENCIÓN.*bloqueado en status:in-progress/is)
    expect(r.out).not.toMatch(/lanzado #50/)
    // Ninguno de los dos mensajes se pisa: el aviso de stray dep no dice que
    // el dispatch se completó, y el ATENCIÓN no dice que la dependencia
    // bloqueó nada.
    expect(r.out).not.toMatch(/aviso: #50 tiene "merge-after #7"[^\n]*bloquead/i)
    expect(r.code).toBe(1)
    const gitLogTxt = existsSync(gitLog) ? readFileSync(gitLog, 'utf8') : ''
    expect(gitLogTxt).not.toMatch(/worktree add/)
  })
})

describe('Costura D — colisión de orden + deps mal formadas en otro epic + stray dep en un tercero, en la MISMA tanda → el progreso real no se ve bloqueado por los avisos', () => {
  it('el epic colisionado se excluye, el issue con deps mal formadas se excluye de la selección (sin abortar nada), y el issue con stray dep se despacha con éxito', () => {
    const repoRoot = makeRepoRoot()
    const gitLog = join(repoRoot, 'git-log')
    const argvLog = join(repoRoot, 'gh-argv-log')
    const counterFile = join(repoRoot, 'gh-list-count')

    // Epic 100: colisión de orden — #10/#11 excluidos enteros.
    const i10 = rawIssue({ number: 10, milestone: 100, order: 1 })
    const i11 = rawIssue({ number: 11, milestone: 100, order: 1 })
    // Epic 200: #20 con "## Dependencias" presente pero SIN ningún
    // "merge-after #N" reconocible (reescritura humana) → depsMalformed.
    // Se excluye de readyDepsMet, pero NO de `issues` — no bloquea el resto.
    const i20 = rawIssue({
      number: 20,
      milestone: 200,
      order: 1,
      body: '## Dependencias\n- Depende de #1 (ver más abajo)\n',
    })
    // Epic 300: #30 con stray dep fuera de sección — avisa, despacha igual.
    const i30 = rawIssue({
      number: 30,
      milestone: 300,
      order: 1,
      touches: ['qux'],
      body: '## Descripción\nNota suelta: merge-after #9 no debería contar aquí.\n',
    })

    const r = runReal(['--repo', 'o/r', '--cap', '2'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // idx0: ct-next open ; idx1: ct-next closed ; idx2: dispatch-check(#30)
      // collision-check (limpio, nada en vuelo) ; idx3: readback (limpio).
      // #20 nunca llega a un dispatch-check: no está en readyDepsMet.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[i10, i11, i20, i30], [], [], []]),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:qux', 'status:ready']),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
      FAKE_GIT_LOG_FILE: gitLog,
    })

    // D1: los tres avisos de datos rotos/estrechados conviven.
    expect(r.out).toMatch(/aviso: colisión de orden.*#10.*#11|aviso: colisión de orden.*#11.*#10/)
    expect(r.out).toMatch(/aviso: #30 tiene "merge-after #9" fuera de la sección/)
    // #20 (malformed) NUNCA aparece como seleccionado ni lanzado — pero
    // tampoco aborta ni contamina el resultado de #30: como #30 SÍ se
    // selecciona, planDispatch nunca invoca explainNoSelection (solo se usa
    // cuando selected.length === 0), así que no hay una línea de bloqueo
    // dedicada a #20 en esta corrida — se queda fuera en silencio funcional,
    // sin abortar nada ni impedir el progreso de #30 (comportamiento
    // verificado aquí a propósito, no asumido).
    expect(r.out).not.toMatch(/seleccionados para esta tanda.*#20/)
    expect(r.out).not.toMatch(/lanzado #20/)
    // #30 sí se seleccionó, reclamó y lanzó con éxito.
    expect(r.out).toMatch(/seleccionados para esta tanda.*#30/)
    expect(r.out).toMatch(/lanzado #30/)
    expect(r.out).toMatch(/lanzad[oa]s? 1.*1/i)
    expect(r.code).toBe(0)
    const argv = readFileSync(argvLog, 'utf8')
    expect(argv).toMatch(/issue edit 30 --repo o\/r --add-label status:in-progress --remove-label status:ready/)
    expect(argv).not.toMatch(/issue edit 20/)
    expect(argv).not.toMatch(/issue edit 10/)
    expect(argv).not.toMatch(/issue edit 11/)
    const gitLogTxt = readFileSync(gitLog, 'utf8')
    expect(gitLogTxt).toMatch(/worktree add -b feat\/30/)
  })
})
