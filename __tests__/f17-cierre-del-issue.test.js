// F17 — EL KICKOFF FABRICABA EL DEADLOCK QUE EL PROPIO LOOP DESCRIBE COMO AVERÍA.
//
// La última línea del kickoff que recibe cada agente despachado decía:
//
//   «Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre PR,
//    libera el claim con `node <dispatch-check> <n> --repo <repo> --release`,
//    deja el estado mergeable y PARA.»
//
// No pedía `Closes #N` en el PR. Cadena completa, toda verificable en este
// repo:
//   1. el PR se mergea y el issue se queda ABIERTO (nada lo cierra);
//   2. desde F13 un issue abierto en `status:in-review` RETIENE sus tokens
//      (`area:`/`touches:`) hasta el merge, y el dispatcher no puede saber que
//      ya se mergeó porque mira el estado del ISSUE (claim.js:52-57);
//   3. esos tokens quedan retenidos indefinidamente;
//   4. `merge-after` se satisface EXACTAMENTE cuando el issue está cerrado con
//      `stateReason === 'COMPLETED'` (gh-issue-map.js#filterMergedIssues), así
//      que ningún dependiente ve nunca su dependencia satisfecha.
//
// El propio dispatcher ya describe ese estado como avería y da el remedio
// ("ciérralo como completed si el PR ya se mergeó y nadie lo cerró porque le
// faltaba el Closes #N", ct-next.mjs:726/787/901). Que el remedio exista y la
// causa la produzca el propio kickoff era la contradicción que cierra F17.
//
// Cada test de este fichero se comprobó ROJO contra el código sin arreglar; la
// salida observada está anotada en el propio test.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderKickoff } from '../scripts/kickoff.js'
import { filterMergedIssues } from '../scripts/gh-issue-map.js'
import { hermeticEnv } from './fixtures/hermetic-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ctNext = join(root, 'scripts', 'ct-next.mjs')
const ctInit = join(root, 'scripts', 'ct-init.sh')
const fixturesDir = join(here, 'fixtures')

const fakePath = [join(fixturesDir, 'fake-git-bin'), join(fixturesDir, 'fake-gh-bin')]

function runNext(args, env = {}) {
  const r = spawnSync('node', [ctNext, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...hermeticEnv(fakePath), ...env },
  })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

const SLICE = { n: 42, order: 3, name: 'refresh token', type: 'backend', ac: ['AC-1'], deps: [], issue: '#42' }
const OPTS = { repo: 'o/r', dispatchCheckPath: '/plugin/scripts/dispatch-check.mjs', base: 'main' }

// ============================================================================
// H1 — el kickoff tiene que pedir el `Closes #N`.
// ============================================================================
describe('F17/H1 — el kickoff pide `Closes #N` en el cuerpo del PR', () => {
  // OBSERVADO SIN ARREGLAR (kickoff.js:129): la línea final era
  //   «Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre PR,
  //    libera el claim con `node /plugin/scripts/dispatch-check.mjs 42 --repo
  //    o/r --release`, deja el estado mergeable y PARA.»
  // — la cadena "Closes" no aparecía NI UNA VEZ en el kickoff completo.
  it('el kickoff contiene el literal `Closes #<issue>` con el número ya sustituido', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toContain('Closes #42')
  })

  it('usa el número de ISSUE, no el de orden §9 (son dos espacios de IDs distintos)', () => {
    // slice.n = 42 (issue), slice.order = 3 (tabla §9). Un `Closes #3` cerraría
    // el issue equivocado — o ninguno.
    const k = renderKickoff(SLICE, OPTS)
    expect(k).not.toMatch(/Closes #3\b/)
    expect(k).toContain('Closes #42')
    // Y el mismo número que el comando de --release, que sale de la misma
    // fuente (`slice.n`): si divergieran, uno de los dos estaría mintiendo.
    expect(k).toContain('--repo o/r --release')
    expect(k).toMatch(/dispatch-check\.mjs 42 --repo/)
  })

  it('dice que va en el CUERPO del PR (no en el título ni en un comentario)', () => {
    // GitHub solo interpreta las closing keywords en el cuerpo del PR y en los
    // mensajes de commit de la rama; un `Closes #N` en el TÍTULO no cierra
    // nada. Sin esta precisión, "ponlo en el PR" es ambiguo justo donde no
    // puede serlo.
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/CUERPO del PR/)
  })

  // OBSERVADO SIN ARREGLAR: ninguna de estas palabras aparecía en el kickoff.
  // Sin el porqué, la línea es una más de una lista de seis y es la primera
  // que se cae cuando el agente va justo de contexto.
  it('dice POR QUÉ: sin el cierre, el slice retiene sus tokens y no desbloquea a sus dependientes', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/tokens/)
    expect(k).toMatch(/merge-after/)
    // El estado concreto que se produce, nombrado: es el que el dispatcher
    // describe como avería.
    expect(k).toMatch(/mergeado.{0,80}issue.{0,40}abierto|issue.{0,40}abierto.{0,80}mergeado/is)
  })

  // Control ejecutable contra la fuente de verdad: `merge-after` NO se
  // satisface con un issue abierto ni con uno cerrado de cualquier manera —
  // solo con COMPLETED, que es lo que produce el `Closes #N` al mergear.
  it('control: filterMergedIssues solo cuenta COMPLETED (lo que produce el Closes #N al mergear)', () => {
    expect(filterMergedIssues([{ number: 7, stateReason: 'COMPLETED' }])).toEqual([7])
    expect(filterMergedIssues([{ number: 7, stateReason: 'NOT_PLANNED' }])).toEqual([])
    expect(filterMergedIssues([{ number: 7, stateReason: null }])).toEqual([])
  })
})

// ============================================================================
// H1, caso colateral que nadie pidió y que rompe la cadena AUNQUE el agente
// obedezca: el PR abierto contra la rama equivocada.
//
// `gh pr create` sin `--base` apunta a la rama por defecto del repo. Pero
// ct-next.mjs acepta `--base <rama>` y crea el worktree con `git worktree add
// -b feat/<n> <wt> <resolvedBase>`: si esa base NO es la rama por defecto, el
// agente abriría el PR contra la rama por defecto — un diff que no es el suyo.
// El kickoff no le decía la base en ningún sitio.
// ============================================================================
describe('F17/H1 — el kickoff nombra la rama base contra la que se abre el PR', () => {
  // OBSERVADO SIN ARREGLAR: el kickoff no contenía la cadena "main" ni ninguna
  // otra mención de la rama base; `renderKickoff` ni siquiera recibía el dato
  // (ct-next.mjs:1809 llamaba `renderKickoff(slice, { repo, dispatchCheckPath })`
  // mientras `buildStateSeed` sí recibía `base: resolvedBase` en la línea
  // siguiente).
  it('con base conocida, el kickoff la nombra', () => {
    const k = renderKickoff(SLICE, { ...OPTS, base: 'release/2026-08' })
    expect(k).toContain('release/2026-08')
  })

  it('sin base, NO se inventa "main": se remite a la rama de la que salió el worktree', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' })
    expect(k).not.toMatch(/contra `main`/)
    expect(k).toMatch(/rama base de la que sali[óo] este worktree/i)
    // El `Closes` sigue estando: no depende de conocer la base.
    expect(k).toContain('Closes #42')
  })

  it('ct-next le pasa la base resuelta al kickoff (dry-run, el kickoff se imprime entero)', () => {
    const fx = JSON.stringify({
      issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: [] }],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run', '--base', 'develop'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Closes #2')
    expect(r.stdout).toContain('develop')
  })
})

// ============================================================================
// H1, el caso que convierte un agente OBEDIENTE en el mismo deadlock.
//
// VERIFICADO EN CAMPO contra josemerca/ct-loop-sandbox (28-jul-2026), no
// deducido de la documentación:
//   - PR #33, `Closes #31` en el cuerpo, mergeado con base `f17-base` (rama
//     NO por defecto) → issue #31 quedó {"state":"OPEN","stateReason":""}.
//   - PR #34, `Closes #32` en el cuerpo, mergeado con base `main` (rama por
//     defecto) → issue #32 quedó {"state":"CLOSED","stateReason":"COMPLETED"}.
// Es decir: las closing keywords SOLO cierran el issue cuando el PR se mergea
// en la rama POR DEFECTO del repo. Con `--base <otra-rama>`, un agente que
// obedezca el kickoff al pie de la letra deja igualmente el issue abierto y el
// carril tapado — y quien lea el remedio del dispatcher ("al PR le faltaba el
// Closes #N") mirará el PR, verá el `Closes #N`, y descartará el diagnóstico.
// ============================================================================
describe('F17 — `--base` no-por-defecto: el aviso de que el `Closes #N` no cerrará el issue', () => {
  const fx = JSON.stringify({
    issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: [] }],
    mergedIssues: [],
  })

  // OBSERVADO SIN ARREGLAR: una corrida con `--base develop` no decía nada al
  // respecto (stderr solo traía el aviso de ACCOUNT_MAP si el repo no casaba).
  it('con --base, avisa por STDERR de la regla de la rama por defecto', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run', '--base', 'develop'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).toMatch(/aviso:.*--base develop/)
    expect(r.stderr).toMatch(/rama por defecto/)
    expect(r.stderr).toMatch(/Closes #/)
    // Es diagnóstico, no producto: no se cuela en el plan.
    expect(r.stdout).not.toMatch(/^aviso:/m)
  })

  // Control negativo: sin --base, la base resuelta ES la rama por defecto (la
  // resuelve `detectDefaultBranch` contra GitHub), así que el aviso sería
  // ruido puro.
  it('sin --base NO se avisa de nada (la base resuelta es, por construcción, la rama por defecto)', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).not.toMatch(/rama por defecto/)
  })
})

// ============================================================================
// H2 — DECISIÓN, no cambio: el motivo del bloqueo se QUEDA en stdout.
//
// F16 fijó "stdout = producto, stderr = diagnóstico" y, al escribirlo, ya
// enumeró el motivo de bloqueo del lado del PRODUCTO (ct-next.mjs:1040-1046:
// «STDOUT = el PRODUCTO. […] el plan de despacho, la selección, EL MOTIVO DE
// BLOQUEO, el registro de lo lanzado»). No es un cabo suelto de F16: es una
// clasificación explícita, y sigue siendo la correcta.
//
// El argumento, y por qué la "doble naturaleza" no lo es:
//   - la pregunta que responde /ct-next es «¿qué se despacha ahora?». «Nada, y
//     esto es exactamente lo que lo impide, con su remedio» es una respuesta
//     COMPLETA y terminal a esa pregunta, no una observación sobre la corrida.
//     Un `aviso:` sí es lo segundo: la corrida hizo su trabajo y ADEMÁS anota
//     algo. Esa es la línea divisoria, y el motivo de bloqueo cae del lado del
//     producto en los DOS modos;
//   - `--dry-run` no cambia QUÉ es el producto, solo si el plan se ejecuta.
//     Enrutar la misma frase a un canal distinto según un flag sería la
//     incoherencia de verdad: `/ct-next > out.txt` y `/ct-next --dry-run >
//     out.txt` dejarían cosas distintas en `out.txt` sin que el usuario haya
//     pedido nada distinto;
//   - la evidencia decisiva está en el código: tras imprimirlo se hace
//     `process.exit(0)`. Si el motivo se fuera a stderr, una corrida real
//     bloqueada dejaría STDOUT VACÍO con exit 0 — que se lee como «todo bien,
//     nada que reportar», exactamente el malentendido que F16 combatió con el
//     recap de avisos.
// Este test fija la decisión para que un futuro "barrido de coherencia de
// canales" tenga que argumentar contra ella en vez de aplicarla en silencio.
// ============================================================================
describe('F17/H2 — el motivo del bloqueo es PRODUCTO: stdout, en dry-run y en real', () => {
  const bloqueado = JSON.stringify({
    issues: [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'b' },
    ],
    mergedIssues: [],
  })

  it('el motivo del bloqueo sale por stdout y NO se duplica en stderr', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: bloqueado })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/colisiona con trabajo en vuelo/)
    expect(r.stderr).not.toMatch(/colisiona con trabajo en vuelo/)
  })

  it('el criterio escrito en el propio fichero clasifica el motivo de bloqueo como stdout', () => {
    // Si alguien mueve la línea a stderr sin tocar el criterio, este test lo
    // pilla: el código y su criterio no pueden divergir en silencio.
    const src = readFileSync(join(root, 'scripts', 'ct-next.mjs'), 'utf8')
    expect(src).toMatch(/STDOUT = el PRODUCTO[\s\S]{0,400}motivo de bloqueo/)
    expect(src).toMatch(/console\.log\(formatBlockReason\(/)
  })
})

// ============================================================================
// El contrato §9 (ct-init.sh) enumera lo que recibe el agente despachado y
// describe el estado "PR mergeado, issue abierto". Las dos cosas cambian aquí,
// y un repo ya bootstrapeado no puede deducirlas: por eso el bump v6 → v7.
// ============================================================================
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('bash', [ctInit, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return agents
}
const flat = (s) => s.replace(/\*/g, '').replace(/\s+/g, ' ')
const V6 = () => readFileSync(join(root, '__tests__', 'fixtures', 'slices-contract-v6.md'), 'utf8')
// El fixture v6 no es una transcripción: su sha256 es 8de58db9…, exactamente
// el hash que SLICES_PRISTINE_HASHES ya tenía registrado para el bloque v6, y
// se generó ejecutando el ct-init.sh de 25caa11. Es el bloque de verdad.

// El párrafo del contrato que enumera qué lleva el kickoff. Se acota a él a
// propósito: `Closes #N` y "rama por defecto" ya aparecían en OTROS puntos del
// bloque v6 (el remedio del PR mergeado, y el enlace al spec «…/blob/<rama por
// defecto>/…»), así que un `toMatch` sobre el bloque entero pasaría en verde
// sin que la enumeración hubiera dejado de callárselo. Comprobado: las dos
// primeras versiones de estos tests pasaban contra el v6 sin arreglar.
const bulletKickoff = (s) => {
  const m = flat(s).match(/Qué recibe el agente despachado[\s\S]*?no llega al agente\./)
  return m ? m[0] : ''
}

describe('contrato §9 (F17): el cierre del issue y la trampa de la rama por defecto', () => {
  it('control: el contrato v6 no decía nada de esto', () => {
    const v6 = flat(V6())
    // Enumeraba lo que lleva el kickoff, y el `Closes #N` NO estaba ahí.
    expect(bulletKickoff(V6())).not.toBe('')
    expect(bulletKickoff(V6())).not.toMatch(/Closes/)
    // Y atribuía el estado "PR mergeado, issue abierto" a UNA sola causa.
    expect(v6).toMatch(/al PR le faltaba `Closes #N`/)
    expect(v6).not.toMatch(/DOS causas/)
    expect(v6).not.toMatch(/solo cierra el issue cuando el PR entra en la rama por defecto/)
  })

  it('dice que el kickoff pide el `Closes #N` (la enumeración de lo que recibe el agente ya no se lo calla)', () => {
    const b = bulletKickoff(seed())
    expect(b).toMatch(/Closes #N/)
    expect(b).toMatch(/cuerpo/)
    // Y la rama base, que es el otro dato que el kickoff no le daba.
    expect(b).toMatch(/rama base/)
  })

  it('nombra la SEGUNDA causa de "PR mergeado, issue abierto": el merge a una rama que no es la por defecto', () => {
    const f = flat(seed())
    expect(f).toMatch(/DOS causas/)
    expect(f).toMatch(/solo cierra el issue cuando el PR entra en la rama por defecto/)
    // La consecuencia accionable, que es lo que cambia una decisión: con
    // --base a otra rama, cerrar el issue al mergear es un paso a mano.
    expect(f).toMatch(/--base <otra-rama>/)
    expect(f).toMatch(/paso a mano/)
  })

  it('la nota de pie y el marcador declaran la MISMA versión, y es la 7', () => {
    const a = seed()
    const marker = a.match(/<!-- ct-init:slices-contract-version: (\d+) -->/)
    const footer = a.match(/Esta sección la mantiene `\/ct-init` \(contrato v(\d+)\)/)
    expect(marker[1]).toBe('7')
    expect(footer[1]).toBe('7')
  })
})
