// F18 — LO QUE DESAPARECE EN SILENCIO.
//
// Cuatro agujeros distintos con la misma forma: el dispatcher (o el groom)
// deja de ver algo y no lo dice, así que el operador lee una explicación
// cuidadosa de otra cosa y se queda sin ninguna pista de lo que de verdad
// pasó.
//
//   H1  una dep cerrada por un COMMIT suelto (no por un PR mergeado) se da
//       por satisfecha. Ocurrió en campo con un commit de DOCUMENTACIÓN que
//       solo MENCIONABA la cadena `Closes #451` — las comillas no protegen.
//   H2  un issue CERRADO que conserva su label `status:` desaparece del
//       dispatcher (solo barre abiertos) sin una palabra.
//   H3  un agente que se declara BLOQUEADO en su STATE.md deja el claim
//       puesto para siempre: ninguna transición del loop lo saca de ahí y
//       `stalenessNote` no lo ve (el worktree y la rama SÍ existen).
//   H4  "PR mergeado, issue abierto" era una disyuntiva que el humano tenía
//       que resolver mirando GitHub; la rama es determinista (`feat/<n>`).
//   H6  `gh project item-list --limit 200` sin comprobar el truncado: con más
//       de 200 items, `hasProjectItem` dice `false` de items que SÍ existen y
//       el groom los duplica.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { mkdtempSync as mkdtemp2, readFileSync, rmSync } from 'node:fs'
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { closedWithLiveStatus, buildDispatchInput } from '../scripts/gh-issue-map.js'
import {
  planClosureProbe, buildClosureQuery, parseClosureProbe,
  formatSuspectClosureWarnings, formatMergedButOpenWarnings, formatClosureCoverageNote,
  CLOSURE_PROBE_MAX,
} from '../scripts/gh-closure.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

// FAKE_GH_COUNTER_FILE es OBLIGATORIO aquí: sin él, `nextCallIndex` del stub
// devuelve 0 siempre y las DOS enumeraciones (abiertos y cerrados) reciben el
// MISMO elemento de FAKE_GH_LIST_SEQUENCE — es decir, la lista de "cerrados"
// sería en realidad la de abiertos. Verificado por construcción al escribir
// estos tests: el primer intento reportó el issue ABIERTO #42 como "cerrado
// con status:ready viva".
function runReal(args, envOverrides = {}) {
  const counter = join(mkdtempSync(join(tmpdir(), 'ct-f18-c-')), 'n')
  dirs.push(dirname(counter))
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...ACCOUNT_ENV, PATH: fakePath, FAKE_GH_COUNTER_FILE: counter, ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.stderr || '', stdout: r.stdout || '' }
}

const dirs = []
afterEach(() => { for (const d of dirs.splice(0)) rmSyncBestEffort(d) })
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-f18-'))
  dirs.push(d)
  return d
}

function rawIssue({ number, order, status = 'status:ready', touches = [], deps = [], stateReason }) {
  const labels = [...(status ? [{ name: status }] : []), ...touches.map((t) => ({ name: `touches:${t}` }))]
  const depsBlock = deps.length ? `\n## Dependencias\n${deps.map((d) => `merge-after #${d}`).join('\n')}\n` : ''
  const o = { number, title: `#${number} slice`, labels, body: `<!-- ct-order:${order} -->${depsBlock}` }
  if (stateReason !== undefined) o.state_reason = stateReason
  return o
}

// ===========================================================================
// H2 — el issue cerrado que conserva su `status:`
// ===========================================================================

describe('H2 (unidad) — closedWithLiveStatus: el residuo de labels sobre issues cerrados', () => {
  it('reconoce las labels `status:` vivas de un issue cerrado, con su número y su motivo de cierre', () => {
    const res = closedWithLiveStatus([
      { number: 451, stateReason: 'COMPLETED', labels: [{ name: 'status:ready' }, { name: 'touches:pbxproj' }, { name: 'type:ui' }] },
      { number: 400, stateReason: 'COMPLETED', labels: [{ name: 'type:ui' }] },
    ])
    expect(res).toEqual([{ n: 451, statusLabels: ['ready'], stateReason: 'COMPLETED' }])
  })

  it('el conjunto medido en el repo de campo: 10 de 99 cerrados conservan label, repartidos en cuatro estados', () => {
    // Números y estados reales, medidos con una consulta paginada COMPLETA
    // (no una lista escrita a mano: la primera medición de campo contó 6 de
    // 10 porque se dejó fuera los cuatro `in-review`).
    const campo = [
      [53, 'in-review'], [54, 'in-review'], [58, 'in-review'], [63, 'in-review'],
      [155, 'in-progress'], [245, 'in-progress'],
      [156, 'ready'], [157, 'ready'], [161, 'ready'],
      [158, 'blocked'],
    ]
    const closed = campo.map(([n, s]) => ({ number: n, stateReason: 'COMPLETED', labels: [{ name: `status:${s}` }] }))
    // …más 89 cerrados sin ninguna label `status:` (el resto del repo).
    for (let i = 0; i < 89; i++) closed.push({ number: 1000 + i, stateReason: 'COMPLETED', labels: [] })
    const res = closedWithLiveStatus(closed)
    expect(res.length).toBe(10)
    expect(res.map((r) => r.n)).toEqual([53, 54, 58, 63, 155, 245, 156, 157, 161, 158])
  })

  it('una label `status:` SIN valor no cuenta (mismo criterio que area:/touches: vacíos)', () => {
    expect(closedWithLiveStatus([{ number: 7, labels: [{ name: 'status:' }, { name: 'status: ' }] }])).toEqual([])
  })

  it('buildDispatchInput lo expone junto a mergedIssues, sin ninguna llamada extra', () => {
    const open = [rawIssue({ number: 1, order: 1 })]
    const closed = [{ number: 451, state_reason: 'COMPLETED', stateReason: 'COMPLETED', body: '<!-- ct-order:9 -->', labels: [{ name: 'status:ready' }] }]
    const di = buildDispatchInput(open, closed)
    expect(di.closedStatusResidue).toEqual([{ n: 451, statusLabels: ['ready'], stateReason: 'COMPLETED' }])
  })
})

describe('H2 (CLI) — el slice que se cayó de la cola deja de desaparecer en silencio', () => {
  it('un cerrado con status:ready se nombra, y se dice que para /ct-next NO EXISTE', () => {
    const repoRoot = makeRepoRoot()
    const abierto = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'] })
    const cerrado = { number: 451, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:ready' }] }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto], [cerrado]]),
    })
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/#451/)
    expect(r.err).toMatch(/CERRADOS conservan una label/)
    expect(r.err).toMatch(/NO EXISTEN/)
    expect(r.err).toMatch(/status:ready/)
    // Es diagnóstico, no producto: nunca por stdout (criterio de canal F16).
    expect(r.stdout).not.toMatch(/CERRADOS conservan una label/)
  })

  it('un cerrado con status:in-review NO se reporta como anomalía: es el final normal de un slice', () => {
    const repoRoot = makeRepoRoot()
    const abierto = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'] })
    const cerrado = { number: 300, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [{ name: 'status:in-review' }] }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto], [cerrado]]),
    })
    expect(r.code).toBe(0)
    expect(r.out).not.toMatch(/#300 .*status:ready/)
    expect(r.out).not.toMatch(/CERRADOS conservan una label `status:` viva, y para/)
    // Pero el número no se esconde: se cuenta y se dice por qué no es anomalía.
    expect(r.err).toMatch(/final NORMAL de un slice/)
  })

  it('un solo aviso agregado, no uno por issue: diez residuos NO son diez líneas', () => {
    const repoRoot = makeRepoRoot()
    const abierto = rawIssue({ number: 42, order: 20, status: 'status:ready', touches: ['ui'] })
    const cerrados = []
    const estados = ['ready', 'ready', 'ready', 'in-progress', 'in-progress', 'blocked', 'in-review', 'in-review', 'in-review', 'in-review']
    estados.forEach((s, i) => cerrados.push({ number: 100 + i, state_reason: 'completed', body: `<!-- ct-order:${i + 1} -->`, labels: [{ name: `status:${s}` }] }))
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto], cerrados]),
    })
    expect(r.code).toBe(0)
    // Se cuentan solo las emisiones EN EL MOMENTO (`aviso: …`), no el recap
    // del final, que por diseño repite todos los avisos acumulados.
    const lineas = r.err.split('\n').filter((l) => /^aviso: \d+ issue\(s\) CERRADOS/.test(l))
    expect(lineas.length).toBe(1)
    // F19/H2 CAMBIA ESTE NÚMERO A PROPÓSITO: eran 6 cuando `blocked` contaba
    // como anomalía junto a `ready` e `in-progress`. Un cerrado con
    // `status:blocked` es INERTE — no retiene tokens, no bloquea ninguna cola,
    // no le pasa nada a nadie por dejarlo — y meterlo en el mismo titular que
    // el que se cayó de la cola de despacho es lo que enseña a descontar el
    // titular entero. Ahora el titular cuenta 5 (3 ready + 2 in-progress) y el
    // `blocked` sale en su propio recuento, igual que los `in-review`.
    expect(lineas[0]).toMatch(/^aviso: 5 issue\(s\) CERRADOS/)
    expect(lineas[0]).toMatch(/Otros 4 cerrados conservan status:in-review/)
    expect(lineas[0]).toMatch(/Otros 1 cerrados conservan status:blocked/)
  })
})

// ===========================================================================
// H3 — el agente BLOQUEADO que deja el claim puesto
// ===========================================================================

describe('H3 (CLI) — un claim cuyo STATE.md se declara BLOQUEADO', () => {
  function repoConWorktree(n, stateMd) {
    const repoRoot = makeRepoRoot()
    const wt = join(repoRoot, '.worktrees', String(n), '.agent')
    mkdirSync(wt, { recursive: true })
    if (stateMd !== null) writeFileSync(join(wt, 'STATE.md'), stateMd)
    return repoRoot
  }

  const bloqueado = '---\nstatus: wip\nblocked:\n  reason: la API de pagos del sandbox está caída\n  unblock: que Stripe restaure el entorno de test\n---\n\nnotas\n'

  it('lo dice, con el motivo, y nombra las tres transiciones que NO sirven', () => {
    const repoRoot = repoConWorktree(41, bloqueado)
    const enCurso = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
    const listo = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[enCurso, listo], []]),
    })
    expect(r.err).toMatch(/#41/)
    expect(r.err).toMatch(/se declara BLOQUEADO/)
    expect(r.err).toMatch(/la API de pagos del sandbox está caída/)
    expect(r.err).toMatch(/--requeue/)
    expect(r.err).toMatch(/--release/)
    // Y no se afirma que haya alguien avanzándolo.
    expect(r.err).toMatch(/ningún agente avanzándolo/)
  })

  it('sin `blocked` en el STATE.md no dice nada (control negativo: el caso normal)', () => {
    const repoRoot = repoConWorktree(41, '---\nstatus: wip\nnext_action: seguir\n---\n\nnotas\n')
    const enCurso = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
    const listo = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[enCurso, listo], []]),
    })
    expect(r.out).not.toMatch(/se declara BLOQUEADO/)
  })

  it('`status: blocked` (el error de escritura más probable) también cuenta', () => {
    const repoRoot = repoConWorktree(41, '---\nstatus: blocked\nnext_action: seguir\n---\n\nnotas\n')
    const enCurso = rawIssue({ number: 41, order: 1, status: 'status:in-progress', touches: ['api'] })
    const listo = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['api'] })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[enCurso, listo], []]),
    })
    expect(r.err).toMatch(/se declara BLOQUEADO/)
  })
})

// ===========================================================================
// H1 + H4 — quién cerró el issue, y qué rama se mergeó de verdad
// ===========================================================================

describe('H1/H4 (unidad) — planClosureProbe: qué se pregunta y qué no', () => {
  const issues = [
    { n: 10, status: 'ready', deps: [451] },
    { n: 11, status: 'ready', deps: [451, 99] },
    { n: 12, status: 'in-review', deps: [] },
    { n: 13, status: 'backlog', deps: [777] },
  ]
  it('solo pregunta por las deps que YA cuentan como satisfechas, y por los in-review', () => {
    const plan = planClosureProbe({ issues, mergedIssues: [451, 777] })
    expect(plan.deps).toEqual([451, 777])
    expect(plan.inReview).toEqual([12])
    expect(plan.dependents.get(451)).toEqual([10, 11])
  })
  it('sin deps satisfechas ni in-review, NO hay query (cero llamadas de red)', () => {
    const plan = planClosureProbe({ issues: [{ n: 1, status: 'ready', deps: [] }], mergedIssues: [] })
    expect(buildClosureQuery('o/r', plan)).toBeNull()
  })
  it('la query pide el closer del issue y el PR mergeado de la rama determinista feat/<n>', () => {
    const plan = planClosureProbe({ issues, mergedIssues: [451] })
    const q = buildClosureQuery('o/r', plan)
    expect(q).toMatch(/repository\(owner:"o", name:"r"\)/)
    expect(q).toMatch(/dep451: issue\(number:451\)/)
    expect(q).toMatch(/CLOSED_EVENT/)
    expect(q).toMatch(/rev12: pullRequests\(headRefName:"feat\/12", states:\[MERGED\]/)
  })
  it('el tope se DICE cuando recorta, nunca se recorta en silencio', () => {
    const muchos = Array.from({ length: CLOSURE_PROBE_MAX + 5 }, (_, i) => ({ n: 1000 + i, status: 'ready', deps: [i + 1] }))
    const plan = planClosureProbe({ issues: muchos, mergedIssues: muchos.map((_, i) => i + 1) })
    expect(formatClosureCoverageNote(plan)).toMatch(/SIN mirar/)
    expect(formatClosureCoverageNote(planClosureProbe({ issues, mergedIssues: [451] }))).toBeNull()
  })
})

describe('H1/H4 (unidad) — parseClosureProbe: no se inventa lo que no vino', () => {
  const plan = { deps: [451, 452, 453, 454], inReview: [12], dependents: new Map([[451, [10]]]) }
  const raw = {
    data: {
      repository: {
        dep451: { number: 451, timelineItems: { nodes: [{ closer: { __typename: 'Commit', oid: 'c4b0da66b398b4d1', messageHeadline: 'docs(loop): #37-#46 cerrados como completed…', associatedPullRequests: { nodes: [] } } }] } },
        dep452: { number: 452, timelineItems: { nodes: [{ closer: { __typename: 'PullRequest', number: 62, merged: true } }] } },
        dep453: { number: 453, timelineItems: { nodes: [{ closer: null }] } },
        rev12: { nodes: [{ number: 88, mergedAt: '2026-07-12T10:00:00Z' }] },
      },
    },
  }
  const { closers, mergedPr } = parseClosureProbe(raw, plan)
  it('distingue commit suelto, PR mergeado, cierre a mano y "no se sabe"', () => {
    expect(closers[451].kind).toBe('commit')
    expect(closers[451].mergedPrs).toEqual([])
    expect(closers[452]).toMatchObject({ kind: 'pull-request', merged: true })
    expect(closers[453].kind).toBe('manual')
    expect(closers[454].kind).toBe('unknown') // el alias no vino: NO es 'manual'
  })
  it('solo el commit suelto genera sospecha; el cierre a mano NO (86 de 97 en campo)', () => {
    const w = formatSuspectClosureWarnings(closers, plan.dependents)
    expect(w.length).toBe(1)
    expect(w[0]).toMatch(/#451/)
    expect(w[0]).toMatch(/COMMIT c4b0da66/)
    expect(w[0]).toMatch(/#10/)
    expect(w.join(' ')).not.toMatch(/#453/)
    expect(w.join(' ')).not.toMatch(/#452/)
    expect(w.join(' ')).not.toMatch(/#454/)
  })
  it('un commit que SÍ pertenece a un PR mergeado no es sospechoso', () => {
    const okRaw = { data: { repository: { dep451: { timelineItems: { nodes: [{ closer: { __typename: 'Commit', oid: 'abc', messageHeadline: 'x', associatedPullRequests: { nodes: [{ number: 9, merged: true }] } } }] } } } } }
    const p = { deps: [451], inReview: [], dependents: new Map() }
    expect(formatSuspectClosureWarnings(parseClosureProbe(okRaw, p).closers, p.dependents)).toEqual([])
  })
  it('H4: el PR mergeado de feat/12 convierte la disyuntiva en un hecho', () => {
    expect(mergedPr[12]).toEqual({ number: 88, mergedAt: '2026-07-12T10:00:00Z' })
    const w = formatMergedButOpenWarnings(mergedPr, 'o/r')
    expect(w[0]).toMatch(/feat\/12 YA está mergeada en el PR #88/)
    expect(w[0]).toMatch(/2026-07-12/)
    expect(w[0]).toMatch(/gh issue close 12 --repo o\/r --reason completed/)
  })
})

describe('H1/H4 (CLI) — la comprobación entra en la corrida real', () => {
  it('una dep cerrada por un commit suelto se avisa, nombrando a quien depende de ella', () => {
    const repoRoot = makeRepoRoot()
    const abierto = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'], deps: [1] })
    const cerrado = { number: 451, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [] }
    const closure = {
      data: { repository: { dep451: { timelineItems: { nodes: [{ closer: { __typename: 'Commit', oid: 'c4b0da66b398', messageHeadline: 'docs(loop): kickoff', associatedPullRequests: { nodes: [] } } }] } } } },
    }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto], [cerrado]]),
      FAKE_GH_CLOSURE_JSON: JSON.stringify(closure),
    })
    expect(r.err).toMatch(/#451 consta cerrado como \*completed\* por el COMMIT/)
    expect(r.err).toMatch(/#42 depende de #451/)
  })

  it('si la consulta falla, se dice y NO se bloquea nada (un detector no tiene veto)', () => {
    const repoRoot = makeRepoRoot()
    const abierto = rawIssue({ number: 42, order: 2, status: 'status:ready', touches: ['ui'], deps: [1] })
    const cerrado = { number: 451, state_reason: 'completed', body: '<!-- ct-order:1 -->', labels: [] }
    const r = runReal(['--repo', 'o/r', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[abierto], [cerrado]]),
      FAKE_GH_CLOSURE_FAIL: '1',
    })
    expect(r.code).toBe(0)
    expect(r.err).toMatch(/no se ha podido comprobar/i)
    // El despacho sigue su curso: #42 se selecciona igual.
    expect(r.stdout).toMatch(/#42/)
  })
})

// ===========================================================================
// Contrato §9 (ct-init.sh): v7 → v8
// ===========================================================================

const ctInit = join(here, '..', 'scripts', 'ct-init.sh')
function seedContract() {
  const dir = mkdtemp2(join(tmpdir(), 'ct-f18-init-'))
  execFileSync('bash', [ctInit, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return agents
}
const flat = (s) => s.replace(/\*/g, '').replace(/\s+/g, ' ')
// El fixture v7 no es una transcripción: su sha256 es 8730d7be…, exactamente
// el hash que SLICES_PRISTINE_HASHES ya tenía registrado para el bloque v7, y
// se generó ejecutando el ct-init.sh de b6b9754. Es el bloque de verdad.
const V7 = () => readFileSync(join(here, 'fixtures', 'slices-contract-v7.md'), 'utf8')

describe('contrato §9 (F18): la premisa falsificada y los dos estados que no se decían', () => {
  it('control: el v7 SÍ decía que hacía falta una acción errónea deliberada, y callaba los otros dos', () => {
    const v7 = flat(V7())
    expect(v7).toMatch(/no se detecta/)
    expect(v7).toMatch(/haría falta cruzar el grafo de PRs/)
    expect(v7).not.toMatch(/closing keywords/)
    expect(v7).not.toMatch(/las comillas no protegen/)
    // Nada sobre el residuo de labels en cerrados…
    expect(v7).not.toMatch(/conserva su label `status:`/)
    // …ni sobre el claim bloqueado.
    expect(v7).not.toMatch(/BLOQUEADO retiene su claim/)
  })

  it('el v8 dice que basta con escribir la keyword en cualquier commit, y que las comillas no protegen', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/no requiere que nadie se equivoque a propósito/)
    expect(v8).toMatch(/cualquier mensaje de commit/)
    expect(v8).toMatch(/las comillas no protegen/)
    expect(v8).not.toMatch(/haría falta cruzar el grafo de PRs/)
  })

  it('el v8 no convierte el detector en un gate, y dice por qué (86 de 97 cierres son a mano)', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/86 de 97 cierres/)
    expect(v8).toMatch(/avisa/)
  })

  it('el v8 nombra el residuo `cerrado + status: viva` con su tasa medida', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/CERRADO que conserva su label `status:` no existe/)
    expect(v8).toMatch(/10 cerrados con label viva de cada 99/)
    // Y deja claro que in-review sobre un cerrado NO es anomalía.
    expect(v8).toMatch(/sobre un issue cerrado NO es anomalía/)
  })

  it('el v8 nombra el deadlock del claim bloqueado y las tres transiciones que no lo sueltan', () => {
    const v8 = flat(seedContract())
    expect(v8).toMatch(/BLOQUEADO retiene su claim/)
    expect(v8).toMatch(/--requeue` se niega/)
    expect(v8).toMatch(/--release` mentiría/)
    // No promete un arreglo automático que no existe.
    expect(v8).toMatch(/no lo arregla/)
  })

  it('la versión declarada del bloque es la 8, en el marcador y en la nota de pie', () => {
    const seeded = seedContract()
    expect(seeded).toMatch(/<!-- ct-init:slices-contract-version: 8 -->/)
    expect(seeded).toMatch(/contrato v8/)
  })
})

// La misma lente de H1 aplicada al RESTO del contrato: ¿hay más decisiones
// justificadas con un "esto solo pasa si alguien hace algo mal"? Sí, una — y
// venía de la ronda anterior.
describe('contrato §9 (F18): la causa que el kickoff no puede garantizar', () => {
  it('control: el v7 decía que ese caso "solo aparece" con PRs a mano o cuerpo editado', () => {
    const v7 = flat(V7())
    expect(v7).toMatch(/solo aparece con PRs abiertos a mano/)
    // Y el kickoff era la razón por la que se descartaba la causa obvia.
    expect(v7).toMatch(/le da a cada agente lo pide explícitamente/)
  })

  it('el v8 nombra la causa más probable: que el agente simplemente no lo pusiera', () => {
    const v8 = flat(seedContract())
    expect(v8).not.toMatch(/solo aparece con PRs abiertos a mano/)
    expect(v8).toMatch(/el kickoff es un PROMPT, no un gate/)
    expect(v8).toMatch(/la causa más probable de este caso es simplemente que el agente no lo puso/)
  })

  it('el propio v7 ya se contradecía: admitía que no puede garantizar la obediencia', () => {
    // No es una inferencia: la frase está en el mismo bloque, dos párrafos más
    // abajo. Lo que faltaba era conectarla con la enumeración de causas.
    expect(flat(V7())).toMatch(/Lo que el kickoff no puede garantizar es que el agente obedezca/)
  })
})
