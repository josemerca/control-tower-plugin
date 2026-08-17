import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
// Stub de `gh` para los tests de manejo de errores (review round 1, Critical
// 2): NUNCA toca la red ni ningún repo real. Se controla por variables de
// entorno — ver __tests__/fixtures/fake-gh-bin/gh.
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')

// stdio explícito en TODAS las invocaciones de abajo (finding 11 de la review
// final): sin esto, execFileSync además de capturar el stderr del hijo en
// `e.stderr` (lo que ya usan las aserciones) también lo reenvía al proceso
// padre — la salida de `npm test`. Todas esas líneas son la salida ESPERADA
// de rutas de fallo deliberadas (error de uso, colisión, carrera perdida...),
// pero un lector no puede distinguir ese ruido esperado de un fallo real sin
// leer el código. `stdio: ['ignore','pipe','pipe']` mantiene stdout/stderr
// disponibles vía `e.stdout`/`e.stderr` sin ecoarlos al padre.
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

// `cwd` es opcional (fix round 2, F22 — ver mkReleaseDryRunRepo más abajo):
// la inmensa mayoría de los llamantes de runReal() no tocan git en absoluto
// (solo `gh`, interceptado por fake-gh-bin vía PATH), así que el cwd por
// defecto (el del proceso de test) nunca importó para ellos. El único que sí
// importa es cualquiera que invoque `--release`, porque la puerta de F22 lee
// git real desde el cwd SIEMPRE, dry-run o no.
function runReal(args, envOverrides = {}, cwd) {
  try {
    const out = execFileSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
      ...(cwd ? { cwd } : {}),
    })
    return { code: 0, out }
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }
  }
}
function run(issue, fixture) {
  try {
    const out = execFileSync('node', [script, String(issue), '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    return { code: 0, out }
  } catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') } }
}

// F22, fix round 1, item 1 (y fix round 2: el mismo defecto encontrado en un
// CUARTO call-site que no estaba en el barrido original — ver el comentario
// junto a "--release cuyo gh edit falla" más abajo) — `--release` corre la
// puerta de F22 (Task 8) tanto en dry-run como en real: la puerta lee git
// real desde el cwd SIEMPRE. Los tests que invocan `--release` sin `cwd`
// corrían, antes de este fixture, contra el propio checkout de este plugin,
// y pasaban solo porque dos hechos AMBIENTALES resultan ciertos hoy: este
// repo no tiene `.agent/` trackeado, y `main`/`origin/HEAD` resuelven.
// Ninguna de las dos es una propiedad del test — el día en que este mismo
// repo se ct-init'ee (que es literalmente lo que este plugin hace a otros
// repos), `.agent/STATE.md` pasa a estar trackeado, y estos tests
// empezarían a fallar con un mensaje de contaminación de slice que no tiene
// nada que ver con lo que están probando. Un repo de propósito específico,
// con una base real (`main`) y una rama (`feat/9`) que diverge de ella sin
// tocar ningún fichero de estado, hace que el resultado dependa del fixture,
// no del checkout en el que corra la suite.
// Plan mínimo que cumple plan-contract.js — desde F-jjponz-1, --release exige
// un plan prescriptivo commiteado en la rama, así que el fixture de release
// lleva uno. Su único bloque va bajo "Final text (work.txt):" (F-jjponz-4:
// todo bloque declara su rol) y ese rol no se comprueba contra el repo, así
// que el fixture sigue sin citar nada.
const FENCE = '```'
const minimalPlanFor = (issue) => [
  `# #${issue} — fixture slice`,
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'Fixture.',
  '### Desired end state',
  'Work done.',
  '### Out of scope',
  'N/A — fixture.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| fixture | yes |',
  '## 3. Reference patterns',
  'N/A — fixture.',
  '## 4. Inventory',
  'work.txt',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy',
  'N/A — fixture.',
  '## 7. Tasks',
  '### Task 1 — do the work',
  '**Objective:** the work is committed.',
  '**Files:** work.txt',
  'Final text (work.txt):',
  FENCE,
  'trabajo',
  FENCE,
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.',
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'None.',
  '',
].join('\n')

function mkReleaseDryRunRepo(issue = 9) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-release-dryrun-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  writeFileSync(join(dir, 'f.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', `2026-08-12-issue-${issue}-work.md`), minimalPlanFor(issue))
  git('add', '-A')
  git('commit', '-qm', 'work')
  return dir
}

describe('dispatch-check --dry-run', () => {
  it('colisión → exit 1', () => {
    const r = run(7, { candLabels: ['touches:db'], openIssues: [{ n: 5, labels: ['status:in-progress', 'touches:db'] }], readback: [] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/COLLISION|colisión/i)
  })
  it('sin colisión y ganamos la carrera → exit 0 (claimed)', () => {
    const r = run(3, { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] })
    expect(r.code).toBe(0)
  })
  it('carrera perdida (otro menor in-progress con token) → exit 1', () => {
    const r = run(7, { candLabels: ['touches:db'], openIssues: [], readback: [
      { n: 7, labels: ['status:in-progress', 'touches:db'] },
      { n: 5, labels: ['status:in-progress', 'touches:db'] },
    ] })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/perdid|lost/i)
  })

  it('--release → exit 0 e imprime la transición in-progress → in-review', () => {
    const dir = mkReleaseDryRunRepo()
    try {
      const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO })
      expect(out).toMatch(/released #9.*in-review/)
    } catch (e) {
      throw new Error(`no debería fallar: ${e.status} ${(e.stdout || '') + (e.stderr || '')}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('error de uso (sin --repo) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '9', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/uso:/)
    }
    expect(threw).toBe(true)
  })

  it('error de uso (issue no numérico) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, 'nope', '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
    }
    expect(threw).toBe(true)
  })

})

// D4, defecto 2 — mismo patrón que `--cap` en ct-next.mjs, pero aquí el
// número identifica el issue que se va a MUTAR contra un repo real. Con
// `parseInt(process.argv[2], 10)`, "42x" reclamaba el issue 42 y "1e3"
// reclamaba el 1: un issue que el usuario no nombró, mutado en silencio.
// Verificado contra el código sin arreglar: los tres casos de abajo salían 0
// (dry-run) tras haber DECIDIDO sobre un issue distinto del pedido.
describe('dispatch-check <issue#> — parseo estricto (D4, defecto 2)', () => {
  const FIXTURE = { issue: 42, labels: ['status:ready'], others: [] }
  for (const bad of ['42x', '1e3', '4.2', ' 42', '0x2A', '']) {
    it(`<issue#> ${JSON.stringify(bad)} → exit 2, nunca un issue distinto del pedido`, () => {
      let threw = false
      try {
        execFileSync('node', [script, bad, '--repo', 'o/r', '--dry-run'],
          { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(FIXTURE) } })
      } catch (e) {
        threw = true
        expect(e.status).toBe(2)
        expect((e.stdout || '') + (e.stderr || '')).toMatch(/<issue#> inválido/)
      }
      expect(threw).toBe(true)
    })
  }

  it('<issue#> 0 o negativo → exit 2 (no existe el issue 0 en GitHub)', () => {
    for (const bad of ['0', '-1']) {
      let threw = false
      try {
        execFileSync('node', [script, bad, '--repo', 'o/r', '--dry-run'],
          { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(FIXTURE) } })
      } catch (e) {
        threw = true
        expect(e.status).toBe(2)
      }
      expect(threw).toBe(true)
    }
  })
})

// T11 fix round 3 (re-review): --settle-ms/CT_CLAIM_SETTLE_MS se eliminaron
// del código (ver el comentario de cabecera de dispatch-check.mjs). Si se
// ignoraran en silencio, alguien que invoque el script con --settle-ms por
// costumbre obtendría un exit 0 limpio y se quedaría creyendo que hay una
// espera de asentamiento activa — exactamente la falsa confianza que motivó
// eliminarla. Deben rechazarse explícitamente con exit 2.
describe('dispatch-check — T11 fix round 3 (--settle-ms/CT_CLAIM_SETTLE_MS rechazados explícitamente)', () => {
  it('--settle-ms en argv → exit 2, mensaje apunta a la cabecera del fichero', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', 'o/r', '--dry-run', '--settle-ms', '2000'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/--settle-ms.*ya no existen?/i)
    }
    expect(threw).toBe(true)
  })

  it('CT_CLAIM_SETTLE_MS en el entorno → exit 2, aunque no se pase el flag', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', 'o/r', '--dry-run'],
        { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_SETTLE_MS: '2000' } })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/--settle-ms.*ya no existen?/i)
    }
    expect(threw).toBe(true)
  })

  it('sin --settle-ms ni CT_CLAIM_SETTLE_MS → no le afecta (camino normal)', () => {
    const dir = mkReleaseDryRunRepo()
    const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO })
    expect(out).toMatch(/released #9.*in-review/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('dispatch-check — fix review round 1 (Critical 1: fixture atado a --dry-run)', () => {
  it('CT_CLAIM_FIXTURE puesto SIN --dry-run → exit 2, no decide con el fixture ni toca gh', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    let threw = false
    try {
      // Sin PATH a fake-gh: si el script intentara invocar `gh` de verdad aquí,
      // fallaría igualmente (no hay red/auth), pero la aserción real es que
      // NUNCA llega a intentarlo — ver el mensaje de error esperado.
      execFileSync('node', [script, '3', '--repo', 'o/r'], { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/CT_CLAIM_FIXTURE.*--dry-run/i)
    }
    expect(threw).toBe(true)
  })
})

describe('dispatch-check — fix review round 1 (Minor 1: validación de flags)', () => {
  it('--repo colgante (último token, sin valor) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--dry-run', '--repo'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
      expect((e.stdout || '') + (e.stderr || '')).toMatch(/uso:/)
    }
    expect(threw).toBe(true)
  })

  it('--repo seguido de otro flag (sin valor real) → exit 2', () => {
    let threw = false
    try {
      execFileSync('node', [script, '5', '--repo', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    } catch (e) {
      threw = true
      expect(e.status).toBe(2)
    }
    expect(threw).toBe(true)
  })
})

describe('dispatch-check — fix review round 1 (Critical 2: fallos de gh() no dejan locks huérfanos silenciosos)', () => {
  it('el claim inicial falla (gh caído) → exit 3 (infra, sin mutación persistente), mensaje claro, sin crash sin capturar', () => {
    // Finding 4: exit code ensanchado — este caso ya NO comparte el exit 1
    // de una COLLISION real (ver la cabecera de dispatch-check.mjs). Sin
    // mutación persistente (el claim ni llegó a escribirse), pero es un
    // fallo de infraestructura, no una colisión — el caller (ct-next.mjs)
    // ya no necesita parsear el texto para distinguirlo.
    const r = runReal(['11', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-progress',
    })
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/no se pudo escribir el claim/i)
  })

  it('el readback tras el claim falla → revierte, avisa que la carrera no se pudo confirmar, exit 3 (infra, revert exitoso)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-fakegh-'))
    const counterFile = join(dir, 'list-count')
    const r = runReal(['13', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]), // primera llamada (colisión): sin choque
      FAKE_GH_LIST_FAIL_AT: '1', // segunda llamada (readback post-claim): falla
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(3)
    expect(r.out).toMatch(/no se puede confirmar la carrera/i)
    expect(r.out).toMatch(/revertido a status:ready/i)
  })

  it('carrera perdida y el revert también falla → avisa "carrera perdida" Y el lock huérfano con el comando manual, exit 4 (huérfano)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-fakegh-'))
    const counterFile = join(dir, 'list-count')
    // Formato crudo de `gh issue list --json number,labels` (number/labels[].name),
    // no el {n,labels} interno — allOpen() hace ese mapeo, y el stub debe imitar
    // exactamente lo que devolvería gh de verdad.
    const readbackConLoss = [
      { number: 17, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }, // nosotros
      { number: 5, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] },  // otro, número menor → perdemos
    ]
    const r = runReal(['17', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], readbackConLoss]), // 1ª: sin choque; 2ª: readback con pérdida
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:ready', // el revert (no el claim inicial) falla
    })
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(4)
    expect(r.out).toMatch(/carrera perdida/i)
    expect(r.out).toMatch(/ATENCIÓN.*#17.*bloqueado/is)
    expect(r.out).toMatch(/gh issue edit 17 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  // F22, fix round 2 — mismo defecto que los tres de mkReleaseDryRunRepo más
  // arriba, encontrado por el mismo barrido: SIN `--dry-run`, así que no es
  // uno de esos tres por texto literal, pero la puerta de F22 corre igual
  // (lee git real desde el cwd en TODO `--release`, dry-run o no) — pasaba
  // solo porque este checkout no tiene `.agent/` trackeado y `main` resuelve.
  it('--release cuyo gh edit falla → exit 1, mensaje claro (no crash sin capturar)', () => {
    const dir = mkReleaseDryRunRepo(19)
    const r = runReal(['19', '--repo', 'o/r', '--release'], {
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-review',
    }, dir)
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo liberar #19/i)
  })
})

// Finding 2 de la review final: `allOpen()` usaba `gh issue list --limit 200`
// — como devuelve más nuevo primero, un tope fijo puede dejar fuera un
// `in-progress` colisionante VIEJO, y entonces `detectCollisions`/
// `claimLost` fallan ABIERTOS (el lock deja de bloquear). fake-gh-bin no
// simula HTTP-pagination de verdad, pero SÍ registra el argv exacto que
// dispatch-check.mjs le pasa — la forma correcta de comprobar, sin red, que
// el comando ya no lleva el tope fijo.
// T11 — AC6 robusto: hook de prueba CT_CLAIM_PRECLAIM_DELAY_MS. El hook solo
// puede añadir una espera síncrona entre "colisión limpia" y "escribir el
// claim" en la ruta REAL (nunca --dry-run/fixture, que son puramente
// síncronos y sin red). Estos tests comprueban: (a) validación de la propia
// variable, (b) que ausente == 0 espera == camino idéntico al de antes del
// hook, y (c) que presente sí retrasa medible y verificablemente la
// escritura — sin lo cual el harness adversarial no podría confiar en que el
// hook realmente construye la ventana que dice construir.
describe('dispatch-check — T11 hook CT_CLAIM_PRECLAIM_DELAY_MS', () => {
  it('CT_CLAIM_PRECLAIM_DELAY_MS malformado ("300ms") → exit 2, mensaje claro', () => {
    const r = runReal(['5', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '300ms',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_CLAIM_PRECLAIM_DELAY_MS inválido/)
  })

  it('CT_CLAIM_PRECLAIM_DELAY_MS negativo → exit 2', () => {
    const r = runReal(['5', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '-50',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_CLAIM_PRECLAIM_DELAY_MS inválido/)
  })

  it('"0" explícito por entorno → válido (no es un error), mismo resultado que ausente', () => {
    const r = runReal(['3', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '0',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }]]),
    })
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/claimed #3/)
  })

  // ==========================================================================
  // F8 — LOS DOS ÚNICOS TESTS DE LA SUITE QUE DE VERDAD MIDEN TIEMPO.
  //
  // `CT_CLAIM_PRECLAIM_DELAY_MS` ES un retraso: no hay forma honesta de
  // comprobar que duerme lo que dice sin mirar un reloj. Lo que sí se puede
  // quitar es la dependencia del reloj DE LA MÁQUINA — el ruido — sin quitar
  // la medición.
  //
  // Lo que había antes: cuatro corridas de la rama A seguidas de cuatro de la
  // rama B, y comparación de MEDIANAS entre bloques. Eso da por hecho que la
  // carga de la máquina es la misma en los dos bloques, que es justo lo que no
  // se cumple: los bloques están separados por segundos, y en esos segundos el
  // resto de la suite (y cualquier otra cosa del portátil) va y viene. Medido
  // contra main sin tocar, con otra suite de vitest a la vez: 2 de 6 corridas
  // fallaban aquí, con diferencias de 22ms y 249ms frente al mínimo exigido de
  // 300 — el retraso de 600ms seguía estando ahí, pero el ruido entre bloques
  // se lo comía entero.
  //
  // Lo que hay ahora: medición PAREADA e INTERCALADA. Cada iteración corre las
  // dos ramas una detrás de otra y se queda con SU diferencia; el estadístico
  // es la mediana de las diferencias pareadas, no la diferencia de medianas.
  // Dos corridas consecutivas ven prácticamente la misma máquina, así que el
  // ruido común se cancela en la resta en vez de sumarse. El umbral (la mitad
  // del valor nominal) sigue siendo el mismo, y sigue detectando exactamente
  // lo que tiene que detectar: un hook que no duerme lo que dice.
  //
  // POR QUÉ EL VALOR NOMINAL ES DE SEGUNDOS Y NO DE DÉCIMAS. El pareado quita
  // el ruido COMÚN a las dos ramas, pero no el que las separa, y aquí ése
  // manda: cada rama arranca su propio proceso `node`, y ese arranque cuesta
  // del orden de medio segundo con una dispersión del mismo orden. Con un
  // nominal de décimas, la señal y el ruido son del mismo tamaño, y la mediana
  // de unas pocas muestras se cae por debajo del umbral sin que el hook haya
  // hecho nada malo — que es exactamente lo que pasaba: medido en reposo, 1 de
  // 15 diferencias pareadas caía por debajo del umbral, y bajo carga esa
  // proporción bastaba para tumbar la mediana de cinco muestras.
  //
  // La cura no es más muestras (multiplica el coste sin separar señal de
  // ruido): es que la señal domine. Con un nominal de segundos, el arranque
  // pasa de valer tanto como la señal a valer una fracción pequeña de ella, y
  // la muestra PEOR queda muy por encima del umbral en vez de rozarlo. Se
  // bajan las iteraciones de cinco a tres para no pagar el nominal más alto
  // cinco veces; aun así este fichero tarda unos segundos MÁS que antes, y ése
  // es el precio deliberado de que deje de caerse solo. Tres es el mínimo con
  // el que una mediana sigue significando algo.
  // ==========================================================================
  const preclaimEnv = {
    FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }]]),
  }
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  function timed(fn) {
    const t0 = Date.now()
    const r = fn()
    return { elapsed: Date.now() - t0, r }
  }

  it('valor positivo retrasa medible la escritura del claim frente a ausente (mismo resultado final, más lento)', () => {
    const NOMINAL_MS = 2000
    const diffs = []
    for (let i = 0; i < 3; i++) {
      // Las dos ramas, una inmediatamente después de la otra, en la misma
      // iteración: ven la misma máquina.
      const a = timed(() => runReal(['3', '--repo', 'o/r'], { ...preclaimEnv }))
      const b = timed(() => runReal(['3', '--repo', 'o/r'], { ...preclaimEnv, CT_CLAIM_PRECLAIM_DELAY_MS: String(NOMINAL_MS) }))
      for (const s of [a, b]) {
        expect(s.r.code).toBe(0)
        expect(s.r.out).toMatch(/claimed #3/)
      }
      diffs.push(b.elapsed - a.elapsed)
    }
    // La mediana de las diferencias PAREADAS. Se exige la mitad del valor
    // nominal: por debajo de eso el hook no estaría durmiendo lo que dice.
    expect(median(diffs)).toBeGreaterThanOrEqual(NOMINAL_MS / 2)
  })

  it('con --dry-run/fixture, CT_CLAIM_PRECLAIM_DELAY_MS alto NO retrasa nada (el hook nunca toca la ruta pura)', () => {
    // Misma corrección: antes esto era `elapsed < 1000ms`, un umbral ABSOLUTO
    // de reloj de pared sobre un arranque de node — bajo carga, arrancar node
    // solo ya puede pasar de 1s, y el test habría fallado sin que el hook
    // hubiera dormido ni un milisegundo. Lo que de verdad se quiere afirmar es
    // "el sleep de 5000ms NO ocurrió", y eso se comprueba comparando contra un
    // control corrido junto al caso, no contra una constante.
    const NOMINAL_MS = 5000
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    const dryRun = (env) => execFileSync('node', [script, '3', '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_FIXTURE: JSON.stringify(fixture), ...env } })

    const control = timed(() => dryRun({}))
    const conHook = timed(() => dryRun({ CT_CLAIM_PRECLAIM_DELAY_MS: String(NOMINAL_MS) }))

    expect(control.r).toMatch(/claimed #3/)
    expect(conHook.r).toMatch(/claimed #3/)
    // Si el hook hubiera tocado la ruta pura, la diferencia sería de ~5000ms.
    // Se exige que esté por debajo de la MITAD: margen de sobra para el ruido
    // de dos arranques de node consecutivos, y ni de lejos suficiente para
    // esconder el sleep.
    expect(conHook.elapsed - control.elapsed).toBeLessThan(NOMINAL_MS / 2)
  })

  // Fix round 1 (review de T11), Minor 1: la validación de
  // CT_CLAIM_PRECLAIM_DELAY_MS vive DESPUÉS del guard de --release en el
  // script — --release ni siquiera pasa por ese punto del código. Antes del
  // fix, un valor malformado colgado en el entorno abortaba --release con
  // exit 2 sin ejecutar la mutación, dejando el issue atascado en
  // status:in-progress. Este test demuestra que --release ahora es inmune:
  // ni siquiera un valor claramente inválido lo afecta.
  it('--release con CT_CLAIM_PRECLAIM_DELAY_MS malformado en el entorno → --release procede igual, no le afecta', () => {
    const dir = mkReleaseDryRunRepo()
    const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'],
      { cwd: dir, encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_PRECLAIM_DELAY_MS: 'not-a-number' } })
    expect(out).toMatch(/released #9.*in-review/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Fix round 1, Minor 2: tope superior de 60000ms. Sin tope, "1e12" (~31
  // años en ms) se acepta como "número >= 0" válido y es indistinguible en
  // la práctica de un cuelgue.
  it('CT_CLAIM_PRECLAIM_DELAY_MS por encima del tope (60000ms) → exit 2, mensaje claro', () => {
    const r = runReal(['5', '--repo', 'o/r'], {
      CT_CLAIM_PRECLAIM_DELAY_MS: '1e12',
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
    })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/CT_CLAIM_PRECLAIM_DELAY_MS inválido/)
  })

  // El límite exacto (60000ms) debe seguir siendo válido — se comprueba por
  // la ruta --dry-run/fixture (la validación es incondicional, pero
  // sleepSync() solo se invoca en la ruta real) para no pagar 60s reales de
  // espera en la suite.
  it('CT_CLAIM_PRECLAIM_DELAY_MS exactamente en el tope (60000ms) → sigue siendo válido', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    const out = execFileSync('node', [script, '3', '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_PRECLAIM_DELAY_MS: '60000', CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    expect(out).toMatch(/claimed #3/)
  })
})

describe('dispatch-check — enumeración de issues abiertos sin --limit fijo (review final, finding 2)', () => {
  it('allOpen() usa --paginate y nunca --limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-dc-nolimit-'))
    const logFile = join(dir, 'gh-argv-log')
    const r = runReal(['3', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }]]),
      FAKE_GH_ARGV_LOG_FILE: logFile,
    })
    expect(r.code).toBe(0)
    const log = readFileSync(logFile, 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(log).toMatch(/--paginate/)
    expect(log).not.toMatch(/--limit/)
    expect(log).toMatch(/state=open/)
  })
})
