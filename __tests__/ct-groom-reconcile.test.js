import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIssueBody } from '../scripts/groom.js'

// F5 — el groom detecta divergencia, no solo existencia. Este fichero cubre
// la CORRIDA REAL (mutadora, sin --dry-run) contra un `gh` de mentira: el
// comportamiento por defecto (detecta y reporta, no toca nada) y el opt-in
// --reconcile (aplica lo detectado vía `gh issue edit`, con la misma
// convención de abort-fuerte-ante-fallo-de-gh que ya usa el resto de este
// fichero para milestones/labels/project). Los tests de --dry-run (mismo
// reporte, cero mutación) viven en ct-groom-dryrun.test.js.

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

const ONE_SLICE_SPEC = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema | api | db |
`

// El plan que ONE_SLICE_SPEC produce hoy (verificado contra groom.js):
// title "#1 login", labels ['type:backend','area:api','touches:db','status:backlog'],
// milestone "Epic" (--milestone por defecto).

// matchingBody(specPath): el body EXACTO que ONE_SLICE_SPEC produce hoy —
// generado con el buildIssueBody real (no a mano), para que los fixtures
// "coincide en todo" de este fichero coincidan de verdad en TODO lo que F5
// compara (AC, Dependencias, Descripción, Protegido, y — review round 3 —
// el enlace al spec). Es una FUNCIÓN, no una constante: el enlace al spec
// incluye la ruta real del fichero de spec, que en cada test es un
// directorio temporal distinto (`writeSpec` crea uno nuevo cada vez) — hay
// que generarlo con la MISMA ruta que se le pasa al script en cada
// invocación, o la línea de enlace divergiría por construcción.
function matchingBody(specPath) {
  return buildIssueBody(
    { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
    { specPath, specSection: '9' },
  )
}

function writeSpec(content) {
  const dir = mkdtempSync(join(tmpdir(), 'ctg-reconcile-'))
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

// Issue existente que diverge en título, milestone Y labels a la vez (missing
// area:/touches:, milestone distinto, título distinto) — un solo fixture que
// ejercita las tres clases de campo en la misma corrida, más status:in-progress
// (nunca debe reportarse ni tocarse). Es una función de `specPath` por el
// mismo motivo que matchingBody: el body (correcto salvo por lo que cada
// test quiere probar) incluye el enlace al spec real.
function existingIssueDrift(specPath) {
  return {
    number: 501,
    title: '#1 iniciar sesión',
    state: 'open',
    milestone: { title: 'Sprint 1' },
    labels: [{ name: 'type:backend' }, { name: 'status:in-progress' }],
    // body correcto (AC/deps/Descripción/Protegido/enlace-al-spec ya
    // coinciden con el spec) — así este fixture ejercita SOLO la
    // divergencia de título/milestone/labels que es su propósito, sin
    // arrastrar drift de body sin querer.
    body: matchingBody(specPath),
  }
}

function baseEnv(specPath) {
  return {
    FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[existingIssueDrift(specPath)]]),
  }
}

describe('ct-groom (corrida real) — detecta divergencia por defecto, no la aplica (F5)', () => {
  it('reporta título/milestone/labels divergentes por stderr, NUNCA llama a `gh issue edit`, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], { ...baseEnv(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/divergencia.*slice #1.*issue #501/)
    expect(res.stderr).toMatch(/t.tulo difiere/i)
    expect(res.stderr).toMatch(/"#1 iniciar sesión"/)
    expect(res.stderr).toMatch(/"#1 login"/)
    expect(res.stderr).toMatch(/milestone difiere/)
    expect(res.stderr).toMatch(/"Sprint 1"/)
    expect(res.stderr).toMatch(/falta la label "area:api"/)
    expect(res.stderr).toMatch(/falta la label "touches:db"/)
    expect(res.stderr).not.toMatch(/status:in-progress/) // label ajena al namespace que el spec compara
    expect(res.stdout).toMatch(/ya existe \(#501\), no se duplica/) // el mensaje de idempotencia de siempre sigue ahí
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // sin --reconcile, jamás se muta el issue
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguna divergencia (issue existente ya coincide) → exit 0, sin líneas de "divergencia"', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:in-progress' }],
      body: matchingBody(spec),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING_ISSUE]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/divergencia/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado sin ninguna otra divergencia → silencio total sobre el cierre, exit 0', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const CLOSED_MATCHING = {
      number: 501,
      title: '#1 login',
      state: 'closed',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: matchingBody(spec),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_MATCHING]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/cerrad/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado CON divergencia → añade la nota de "cerrado" avisando antes de --reconcile, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const CLOSED_DRIFT = { ...existingIssueDrift(spec), state: 'closed', milestone: { title: 'Epic' }, labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }] }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/t.tulo difiere/i)
    expect(res.stderr).toMatch(/cerrad.*reconcile/is)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom (corrida real) --reconcile — aplica lo detectado vía `gh issue edit` (F5)', () => {
  it('aplica título + milestone + labels en una sola llamada a `gh issue edit`, exit 0', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...baseEnv(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/reconciliado/)
    const log = readFileSync(argvLog, 'utf8')
    const editLine = log.split('\n').find((l) => l.startsWith('issue edit 501'))
    expect(editLine).toBeTruthy()
    expect(editLine).toMatch(/--repo o\/r/)
    expect(editLine).toMatch(/--title #1 login/)
    expect(editLine).toMatch(/--milestone Epic/)
    expect(editLine).toMatch(/--add-label area:api/)
    expect(editLine).toMatch(/--add-label touches:db/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile sobre un slice SIN divergencia no llama a `gh issue edit` para ese slice (nada que aplicar)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const MATCHING_ISSUE = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: matchingBody(spec),
    }
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[MATCHING_ISSUE]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('issue cerrado + --reconcile: igual se aplica el edit (gh issue edit no reabre el issue)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const CLOSED_DRIFT = { ...existingIssueDrift(spec), state: 'closed' }
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[CLOSED_DRIFT]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    expect(log).toMatch(/issue edit 501/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Convención ya establecida en este fichero (milestones/labels/project): un
  // fallo de `gh` nunca es benigno — abortamos con mensaje claro en vez de
  // seguir a ciegas. FAKE_GH_EDIT_FAIL_SUBSTR simula que el `gh issue edit`
  // de este issue concreto falla (auth, red, rate limit...).
  it('--reconcile: si `gh issue edit` falla, aborta con exit 1 y mensaje claro — nunca sigue a ciegas', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...baseEnv(spec), FAKE_GH_EDIT_FAIL_SUBSTR: 'issue edit 501' })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/no se pudo reconciliar el issue #501/)
    expect(res.stdout).not.toMatch(/reconciliado/) // nunca se reporta éxito tras el fallo
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review round 2 del coordinador — tres puntos:
// 1) CRÍTICO: excluir el body entero tiraba justo lo que el dispatcher SÍ
//    obedece (deps → dispatch.js, ac → kickoff.js). Ahora se comparan y se
//    aplican vía --reconcile (splice quirúrgico del body).
// 2) La regla de labels debe estar gateada por columna: sin "Área" en la
//    tabla §9, el spec no tiene autoridad sobre `area:` en absoluto.
// 3) El exit 3 bajo --dry-run debe ser una decisión, no una consecuencia —
//    cubierto explícitamente en ct-groom-dryrun.test.js.
//
// Review round 3 del coordinador — tres Critical más, atendidos aquí donde
// aplica a nivel CLI (los tests de la capa pura viven en reconcile.test.js
// y gh-issue-map.test.js):
//   2. --reconcile podía salir 0 sobre una divergencia real no aplicada.
//   4. Issues huérfanos nunca se mencionaban.
//   6. Descripción/Protegido anclaban el exit code para siempre.
// ============================================================================

describe('ct-groom (corrida real) — AC/Dependencias divergentes: se detectan y --reconcile las aplica (review crítica)', () => {
  // Dos slices para que la dependencia (#2) sea una referencia real: la
  // tabla §9 exige que "Dep" apunte a un "#" que exista. El slice #1 pide
  // dos AC (AC-1.1, AC-1.2) y depende de #2; el issue existente de la orden
  // 1 solo tiene AC-1.1 y ninguna sección "## Dependencias" — exactamente el
  // escenario que preocupaba al coordinador: un autor corrige la tabla §9
  // (añade una dependencia, añade un AC) y antes de este fix no pasaba
  // nada. El slice #2 ya coincide del todo, para aislar la señal.
  const SPEC_2 = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | #2 | AC-1.1, AC-1.2 | schema |
| 2 | signup | backend | registro | – | AC-2.1 | – |
`
  function issue1Drift(specPath) {
    return {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }],
      // AC-1.2 falta, y no hay ninguna sección "## Dependencias" en absoluto.
      body: buildIssueBody({ n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' }, { specPath, specSection: '9' }),
    }
  }
  function issue2Matching(specPath) {
    return {
      number: 502,
      title: '#2 signup',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }],
      body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, { specPath, specSection: '9' }),
    }
  }
  function env2(specPath) {
    return {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue1Drift(specPath), issue2Matching(specPath)]]),
    }
  }

  it('por defecto: reporta el AC y la dependencia faltantes por stderr, NUNCA llama a `gh issue edit`, exit 3', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], { ...env2(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/falta el criterio de aceptación "AC-1.2"/)
    expect(res.stderr).toMatch(/falta la dependencia "merge-after #2"/)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--reconcile: aplica el AC y la dependencia faltantes vía `--body` (splice), preserva Descripción/Protegido/marcador, NO toca el issue #2 (ya coincidía), exit 0', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...env2(spec), FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(res.status).toBe(0)
    const log = readFileSync(argvLog, 'utf8')
    expect(log).toMatch(/issue edit 501/)
    expect(log).not.toMatch(/issue edit 502/) // el #2 ya coincidía del todo — ninguna llamada para él
    // El --body reconciliado trae el AC añadido y la dependencia añadida...
    expect(log).toContain('AC-1.2')
    expect(log).toContain('merge-after #2')
    // ...y preserva Descripción/Protegido/marcador tal cual estaban (splice
    // quirúrgico, no regeneración del body entero).
    expect(log).toContain('modelo')
    expect(log).toContain('schema')
    expect(log).toContain('<!-- ct-order:1 -->')
    rmSync(dir, { recursive: true, force: true })
  })

  // Critical 2 (review round 3): si la cabecera de AC se renombra a mano,
  // --reconcile NO puede reescribirla — debe reportarlo con precisión (no
  // "solo prosa"), NO llamar a `gh` para nada de ese issue (título/
  // milestone/labels sí coinciden en este fixture; lo único divergente es
  // el AC inaplicable), y el exit code debe seguir en 3 aunque se haya
  // pedido --reconcile.
  it('cabecera "## Acceptance criteria" renombrada a mano → --reconcile NO la aplica, avisa con precisión (nunca "solo prosa"), exit sigue en 3', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const renamedIssue1 = {
      ...issue1Drift(spec),
      body: issue1Drift(spec).body.replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios'),
    }
    const argvLog = join(dir, 'argv.log')
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[renamedIssue1, issue2Matching(spec)]]),
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    })
    expect(res.status).toBe(3) // NO 0 — quedó un gap real sin aplicar
    expect(res.stderr).toMatch(/no puede aplicar del todo esta divergencia/)
    expect(res.stderr).toMatch(/criterios de aceptación/)
    expect(res.stderr).not.toMatch(/solo en prosa/i) // NUNCA esta mentira (Critical 2)
    // deps SÍ se pudo aplicar (dominio independiente del de AC) — el --body
    // enviado (embebe saltos de línea propios, por eso se comprueba sobre
    // el log entero en vez de aislar la línea) debe incluir la dependencia:
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).toMatch(/issue edit 501/)
    expect(log).toContain('merge-after #2')
    rmSync(dir, { recursive: true, force: true })
  })
})

// NO_AREA_SPEC: a diferencia de ONE_SLICE_SPEC (arriba), esta tabla §9 NO
// trae columnas "Área" ni "Toca" — el body que produce es idéntico al de
// matchingBody (esas columnas no alimentan el body, solo labels), así que
// se reutiliza.
const NO_AREA_SPEC = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

describe('ct-groom (corrida real) — labels: el spec solo es autoridad de un prefijo si la tabla trae su columna (review, punto 2)', () => {
  // Sin columna "Área" en absoluto: el spec no tiene NINGUNA opinión sobre
  // `area:`. Un area:ops puesto a mano en el issue (por el motivo que sea)
  // nunca debe reportarse como "sobra" — sería un falso positivo que enseña
  // a ignorar el resto del reporte.
  it('tabla §9 SIN columna "Área": un area: puesto a mano en el issue no se reporta como "sobra", exit 0', () => {
    const { dir, spec } = writeSpec(NO_AREA_SPEC)
    const ISSUE_WITH_AREA = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:ops' }], // puesto a mano, el spec nunca habló de área
      body: matchingBody(spec),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[ISSUE_WITH_AREA]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/area:ops/)
    rmSync(dir, { recursive: true, force: true })
  })
})

// Review round 3, punto 6: una divergencia que --reconcile NUNCA puede
// resolver (Descripción/Protegido, prosa) no debe anclar el exit code para
// siempre — se reporta (nota:), pero el proceso sale en 0. El
// comportamiento ANTERIOR (exit 3 perpetuo) era el mismo problema de ruido
// que ya se cerró para las labels, en la dirección opuesta.
describe('ct-groom (corrida real) — divergencia SOLO de prosa (Descripción/Protegido): se reporta, pero YA NO ancla el exit code (review round 3, punto 6)', () => {
  it('Descripción divergente, todo lo demás coincide: se reporta como "nota:", exit 0 (con o sin --reconcile)', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const PROSE_DRIFT = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      // area:api/touches:db incluidas — ONE_SLICE_SPEC de este fichero SÍ
      // trae esas columnas, así que hacen falta para que labels/AC/deps NO
      // diverjan y la única divergencia real sea la Descripción.
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      // Descripción distinta ("otro texto" en vez de "modelo") — todo lo
      // demás (AC, deps, Protegido, enlace al spec) coincide con el spec.
      body: buildIssueBody({ n: 1, name: 'login', type: 'backend', entrega: 'otro texto', deps: [], ac: ['AC-1.1'], protected: 'schema' }, { specPath: spec, specSection: '9' }),
    }
    const argvLog = join(dir, 'argv.log')
    const envBase = {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[PROSE_DRIFT]]),
    }
    const resDefault = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], envBase)
    expect(resDefault.status).toBe(0) // punto 6: ya NO se queda anclado en 3
    expect(resDefault.stderr).toMatch(/^nota:.*Descripción/m)
    expect(resDefault.stderr).not.toMatch(/^divergencia:/m) // nada cuenta como divergencia real

    const resReconcile = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...envBase, FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(resReconcile.status).toBe(0) // tampoco con --reconcile
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // nada que aplicar de verdad — ninguna llamada
    rmSync(dir, { recursive: true, force: true })
  })
})

// Importante 4 (review round 3): un issue con marcador ct-order:N cuyo
// slice N ya no está en la tabla §9 actual (se eliminó la fila) no debe
// desaparecer en silencio.
describe('ct-groom (corrida real) — issues huérfanos: un slice eliminado de la tabla §9 no deja su issue en silencio (review round 3, importante 4)', () => {
  it('issue con ct-order:9 cuando la tabla ya no tiene slice #9 → aviso explícito, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC) // solo tiene slice #1
    const orphan = {
      number: 999,
      title: '#9 algo que ya no existe',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [],
      body: '<!-- ct-order:9 -->',
    }
    const matchingSlice1 = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: matchingBody(spec),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[orphan, matchingSlice1]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/issue #999/)
    expect(res.stderr).toMatch(/ct-order:9/)
    expect(res.stderr).toMatch(/huérfano/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ningún issue huérfano → sin aviso de huérfanos', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const matchingSlice1 = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: matchingBody(spec),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[matchingSlice1]]),
    })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/huérfano/)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// Review round 4 — el reviewer atacó su PROPIA implementación de la ronda
// 3, no solo los tres casos que se le habían dado. Estos dos tests cubren,
// a nivel CLI end-to-end, los dos hallazgos "importante" más visibles para
// un humano (el resto — el rastreador de vallas, la igualdad exacta de
// cabecera, la rendición en vez del crecimiento sin límite, y el aviso de
// merge-after fuera de sección — ya están cubiertos exhaustivamente en la
// capa pura, reconcile.test.js/gh-issue-map.test.js).
// ============================================================================

describe('ct-groom (corrida real) — el enlace al spec ignora la notación de ruta, solo compara el ancla (review round 4, importante 4)', () => {
  it('mismo ancla "#9", ruta distinta (relativa en el issue, absoluta en esta invocación) → NO diverge, exit 0, --reconcile no llama a `gh issue edit`', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const argvLog = join(dir, 'argv.log')
    // `spec` es una ruta ABSOLUTA (mkdtempSync + join ya lo son) — el issue
    // existente usa una notación RELATIVA para el MISMO fichero (simula
    // invocar el comando una vez con ruta relativa y otra con absoluta:
    // un slash command frente a un cron, p.ej.).
    const matchingButDifferentPathNotation = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: buildIssueBody(
        { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
        { specPath: 'spec.md', specSection: '9' }, // ruta relativa, distinta de `spec` — mismo ancla "#9"
      ),
    }
    const envBase = {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[matchingButDifferentPathNotation]]),
    }
    const resDefault = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], envBase)
    expect(resDefault.status).toBe(0)
    expect(resDefault.stderr).not.toMatch(/enlace al spec/)

    const resReconcile = run([spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], { ...envBase, FAKE_GH_ARGV_LOG_FILE: argvLog })
    expect(resReconcile.status).toBe(0)
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    expect(log).not.toMatch(/issue edit/) // nada que reconciliar — jamás se llama a gh por esto
    rmSync(dir, { recursive: true, force: true })
  })

  it('ancla DISTINTA ("#10" en vez de "#9") → SÍ diverge, exit 3', () => {
    const { dir, spec } = writeSpec(ONE_SLICE_SPEC)
    const movedSection = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }],
      body: buildIssueBody(
        { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' },
        { specPath: spec, specSection: '10' }, // misma ruta, ancla distinta
      ),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[movedSection]]),
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/enlace al spec difiere/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ct-groom (corrida real) — un "## Dependencias"/"## Acceptance criteria" duplicado cuenta para el exit code (review round 4, importante 5)', () => {
  const SPEC_2 = `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | #2 | AC-1.1 | schema |
| 2 | signup | backend | registro | – | AC-2.1 | – |
`
  it('issue #1 con "## Dependencias" duplicado (misma dependencia en las dos copias) → exit 3, aunque el spec y el issue coincidan en todo lo demás', () => {
    const { dir, spec } = writeSpec(SPEC_2)
    const issue1WithDuplicateDeps = {
      number: 501,
      title: '#1 login',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }],
      body: [
        `> Slice #1 del epic. Spec: [${spec}#9](${spec}#9)`, '',
        '## Descripción', 'modelo', '',
        '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1.1', '',
        '## Dependencias', '- merge-after #2', '',
        '## Dependencias', '- merge-after #2', '', // copia duplicada — el dispatcher no distingue "la primera"
        '## Out of scope / Protected', '- 🚫 schema', '',
        '<!-- ct-order:1 -->',
      ].join('\n'),
    }
    const issue2Matching = {
      number: 502,
      title: '#2 signup',
      state: 'open',
      milestone: { title: 'Epic' },
      labels: [{ name: 'type:backend' }],
      body: buildIssueBody({ n: 2, name: 'signup', type: 'backend', entrega: 'registro', deps: [], ac: ['AC-2.1'], protected: '–' }, { specPath: spec, specSection: '9' }),
    }
    const res = run([spec, '--repo', 'o/r', '--milestone', 'Epic'], {
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue1WithDuplicateDeps, issue2Matching]]),
    })
    expect(res.status).toBe(3) // antes de esta ronda, esto salía 0 (era solo una nota)
    expect(res.stderr).toMatch(/divergencia.*Dependencias.*aparece más de una vez/is)
    rmSync(dir, { recursive: true, force: true })
  })
})
