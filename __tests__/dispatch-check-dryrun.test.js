import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
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

function runReal(args, envOverrides = {}) {
  try {
    const out = execFileSync('node', [script, ...args], {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...envOverrides },
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
    try {
      const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
      expect(out).toMatch(/released #9.*in-review/)
    } catch (e) {
      throw new Error(`no debería fallar: ${e.status} ${(e.stdout || '') + (e.stderr || '')}`)
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
    const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO })
    expect(out).toMatch(/released #9.*in-review/)
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
  it('el claim inicial falla (gh caído) → exit 1, mensaje claro, sin crash sin capturar', () => {
    const r = runReal(['11', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]),
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-progress',
    })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se pudo escribir el claim/i)
  })

  it('el readback tras el claim falla → revierte, avisa que la carrera no se pudo confirmar, exit 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-fakegh-'))
    const counterFile = join(dir, 'list-count')
    const r = runReal(['13', '--repo', 'o/r'], {
      FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]), // primera llamada (colisión): sin choque
      FAKE_GH_LIST_FAIL_AT: '1', // segunda llamada (readback post-claim): falla
      FAKE_GH_COUNTER_FILE: counterFile,
    })
    rmSync(dir, { recursive: true, force: true })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no se puede confirmar la carrera/i)
    expect(r.out).toMatch(/revertido a status:ready/i)
  })

  it('carrera perdida y el revert también falla → avisa "carrera perdida" Y el lock huérfano con el comando manual', () => {
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
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/carrera perdida/i)
    expect(r.out).toMatch(/ATENCIÓN.*#17.*bloqueado/is)
    expect(r.out).toMatch(/gh issue edit 17 --repo o\/r --add-label status:ready --remove-label status:in-progress/)
  })

  it('--release cuyo gh edit falla → exit 1, mensaje claro (no crash sin capturar)', () => {
    const r = runReal(['19', '--repo', 'o/r', '--release'], {
      FAKE_GH_EDIT_FAIL_SUBSTR: '--add-label status:in-review',
    })
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

  // Comparación relativa, no umbrales absolutos: un umbral absoluto bajo
  // (p.ej. "<500ms") es fràgil frente al coste variable de arrancar un
  // subproceso node + 3 invocaciones del stub de gh en una máquina bajo
  // carga (se observó >500ms de solo overhead en una corrida real). En vez
  // de eso, cada rama se ejecuta dos veces (ausente vs 300ms) y se compara
  // la DIFERENCIA entre medias: eso aísla el efecto del hook del ruido del
  // entorno, y es exactamente lo que el harness de T11 necesita confiar que
  // es cierto.
  it('valor positivo retrasa medible la escritura del claim frente a ausente (mismo resultado final, más lento)', () => {
    const runsOf = (envOverrides) => {
      const samples = []
      for (let i = 0; i < 4; i++) {
        const t0 = Date.now()
        const r = runReal(['3', '--repo', 'o/r'], {
          FAKE_GH_VIEW_LABELS: JSON.stringify(['touches:db']),
          FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 3, labels: [{ name: 'status:in-progress' }, { name: 'touches:db' }] }]]),
          ...envOverrides,
        })
        samples.push({ elapsed: Date.now() - t0, r })
      }
      return samples
    }
    const baseline = runsOf({})
    const delayed = runsOf({ CT_CLAIM_PRECLAIM_DELAY_MS: '600' })
    for (const s of [...baseline, ...delayed]) {
      expect(s.r.code).toBe(0)
      expect(s.r.out).toMatch(/claimed #3/)
    }
    // Mediana en vez de media: aísla el retraso del hook de un outlier puntual
    // por contención de CPU en la máquina (ya observado: un pico aislado de
    // ~150ms en una corrida), sin taparlo con umbrales absolutos frágiles.
    const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
    const medBaseline = median(baseline.map((s) => s.elapsed))
    const medDelayed = median(delayed.map((s) => s.elapsed))
    // el hook debe añadir ~600ms sobre el baseline; se exige al menos 300ms
    // (mitad del valor nominal) de margen de holgura para no ser frágil, pero
    // un valor por debajo de eso significaría que el hook no está durmiendo
    // lo que dice dormir.
    expect(medDelayed - medBaseline).toBeGreaterThanOrEqual(300)
  }, 20000)

  it('con --dry-run/fixture, CT_CLAIM_PRECLAIM_DELAY_MS alto NO retrasa nada (el hook nunca toca la ruta pura)', () => {
    const fixture = { candLabels: ['touches:db'], openIssues: [], readback: [{ n: 3, labels: ['status:in-progress', 'touches:db'] }] }
    const t0 = Date.now()
    const out = execFileSync('node', [script, '3', '--repo', 'o/r', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_PRECLAIM_DELAY_MS: '5000', CT_CLAIM_FIXTURE: JSON.stringify(fixture) } })
    const elapsed = Date.now() - t0
    expect(out).toMatch(/claimed #3/)
    expect(elapsed).toBeLessThan(1000)
  })

  // Fix round 1 (review de T11), Minor 1: la validación de
  // CT_CLAIM_PRECLAIM_DELAY_MS vive DESPUÉS del guard de --release en el
  // script — --release ni siquiera pasa por ese punto del código. Antes del
  // fix, un valor malformado colgado en el entorno abortaba --release con
  // exit 2 sin ejecutar la mutación, dejando el issue atascado en
  // status:in-progress. Este test demuestra que --release ahora es inmune:
  // ni siquiera un valor claramente inválido lo afecta.
  it('--release con CT_CLAIM_PRECLAIM_DELAY_MS malformado en el entorno → --release procede igual, no le afecta', () => {
    const out = execFileSync('node', [script, '9', '--repo', 'o/r', '--release', '--dry-run'],
      { encoding: 'utf8', stdio: QUIET_STDIO, env: { ...process.env, CT_CLAIM_PRECLAIM_DELAY_MS: 'not-a-number' } })
    expect(out).toMatch(/released #9.*in-review/)
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
