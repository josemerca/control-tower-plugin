// F38 — EL GO DEL GATE `plan`: EL AGENTE NO PUEDE ESCRIBIRLO, Y SIN ÉL NO SE
// LIBERA.
//
// El agujero que cierra esta ronda lo tenía escrito el propio repo desde la #32
// (commands/ct-next.md): «no impide que el propio agente escriba `-OK` en su
// propio issue — tiene `gh`, así que puede». Y el gate `plan` está implicado por
// defecto en TODO slice (gates.js#gatesForType), así que no era un agujero
// pendiente: era el de hoy, con el agravante de dejar el REGISTRO de una
// revisión humana que no ocurrió.
//
// Dos mitades, y las dos se prueban aquí: el go lleva un nonce por despacho que
// el agente no puede adivinar (el módulo puro lo cubre go-response.test.js; el
// canal, ct-next-watch-go.test.js), y `--release` EXIGE ese go — antes no exigía
// nada, así que un agente podía ignorar el gate entero y entregar igual.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GO_TOKEN, goBody, goCommitment, newGoNonce } from '../scripts/go-response.js'
import { goPath, readGoCommitment, writeGoCommitment } from '../scripts/go-registry.js'
import { GO, GO_HASH, NONCE, comentarioDelGo, envDelGo } from './fixtures/go-gate.js'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RELEASE = join(AQUI, '..', 'scripts', 'dispatch-check.mjs')
const CT_GO = join(AQUI, '..', 'scripts', 'ct-go.mjs')
const WATCH_GO = join(AQUI, '..', 'scripts', 'ct-watch-go.mjs')
const FAKE_GH = join(AQUI, 'fixtures', 'fake-gh-bin')

const basura = []
afterEach(() => { for (const d of basura.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = (pref) => { const d = mkdtempSync(join(tmpdir(), pref)); basura.push(d); return d }

// ---------------------------------------------------------------------------
// El worktree del slice: rama con el plan y la tarea comiteados, y el run
// ENTREGADO. Es el estado en el que un slice pide liberar — o sea, el único
// estado en el que la puerta del go tiene algo que decir. Copiado del fixture de
// e2e-release-correspondencia.test.js: los tests de este repo no se importan
// entre sí, sólo comparten `fixtures/`.
// ---------------------------------------------------------------------------
const FENCE = '```'
const plan = (issue) => [
  `# #${issue} — fixture slice`, '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**', '',
  '## 1. Context and goal', 'Fixture.',
  '### Desired end state', 'Work done.',
  '### Out of scope', 'N/A — fixture.',
  '## 2. Closed decisions', '| Decision | Value |', '|---|---|', '| fixture | yes |',
  '## 3. Reference patterns', 'N/A — fixture.',
  '## 4. Inventory', 'work.txt',
  '## 5. Interfaces', 'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy', 'N/A — fixture.',
  '## 7. Tasks', '### Task 1 — do the work',
  '**Objective:** the work is committed.', '**Files:** work.txt', 'Final text (work.txt):',
  FENCE, 'trabajo', FENCE,
  '**TDD:** No TDD — fixture.', '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.', FENCE + 'bash', 'git log --oneline -1', FENCE,
  '## 8. Global verification', 'N/A — fixture.',
  '## 9. Assumptions', 'None.', '',
].join('\n')

function worktree(issue = 9) {
  const dir = tmp('ct-f38-')
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', `feat/${issue}`)
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', `2026-08-25-issue-${issue}-work.md`), plan(issue))
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), `---\nissue: ${issue}\nbase: main\n---\n`)
  writeFileSync(join(dir, '.agent', `run-${issue}.json`), JSON.stringify({
    plan: `docs/superpowers/plans/2026-08-25-issue-${issue}-work.md`,
    issue, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e', e2eRuns: [], closed: 'delivered',
  }, null, 2))
  return dir
}

// `--release` de verdad (sin --dry-run: lo que se prueba incluye que NO mute).
// `labels` por defecto trae `gate:plan`, que es el caso normal de todo slice.
function release(dir, { issue = 9, comentarios, labels, configDir, viewFail = false, commentsFail = false } = {}) {
  const log = join(dir, 'gh-argv.log')
  const r = spawnSync(process.execPath, [RELEASE, String(issue), '--repo', 'o/r', '--release'], {
    cwd: dir, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${FAKE_GH}:${process.env.PATH}`,
      FAKE_GH_ARGV_LOG_FILE: log,
      FAKE_GH_VIEW_LABELS: JSON.stringify(labels ?? ['status:in-progress', 'gate:plan']),
      ...(comentarios !== undefined ? { FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments: comentarios }) } : {}),
      ...(viewFail ? { FAKE_GH_VIEW_FAIL: '1' } : {}),
      ...(commentsFail ? { FAKE_GH_VIEW_COMMENTS_FAIL: '1' } : {}),
      ...(configDir !== undefined ? { CLAUDE_CONFIG_DIR: configDir } : {}),
    },
  })
  return { ...r, salida: (r.stdout || '') + (r.stderr || ''), argv: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

// El compromiso de un despacho, registrado donde vive de verdad.
const registrar = (issue = 9, commitment = GO_HASH) => {
  const cfg = tmp('ct-f38-cfg-')
  writeGoCommitment({ repo: 'o/r', issue, commitment, configDir: cfg })
  return cfg
}

describe('la puerta 9: el gate `plan` no se cierra solo', () => {
  it('con el go de ESTE despacho contestado → libera, y dice quién lo dio', () => {
    const r = release(worktree(), { configDir: registrar(), comentarios: [comentarioDelGo('josemerca')] })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/released #9/)
    // Quién autorizó, por stderr: es el único sitio donde se vería un go dado
    // por la misma identidad con la que corre el agente.
    expect(r.stderr).toMatch(/gate `plan` cerrado: go de este despacho dado por @josemerca/)
  })

  it('sin ningún go contestado → exit 9, y NO muta nada', () => {
    const r = release(worktree(), { configDir: registrar(), comentarios: [] })
    expect(r.status).toBe(9)
    expect(r.salida).toMatch(/el gate `plan` no está cerrado/)
    expect(r.salida).toMatch(/sigue en status:in-progress/)
    // La prueba de que no ha mutado no es el mensaje: es el argv real de `gh`.
    expect(r.argv).not.toMatch(/issue edit/)
  })

  // -------------------------------------------------------------------------
  // EL CASO QUE JUSTIFICA LA RONDA. `-OK` desnudo es exactamente lo que un
  // agente sabe escribir: `gh issue comment` en su propio issue, dentro de su
  // repertorio normal, con una traza indistinguible de la legítima.
  // -------------------------------------------------------------------------
  it('un `-OK` DESNUDO no libera: es el go que el agente sí sabría fabricar', () => {
    const r = release(worktree(), {
      configDir: registrar(),
      comentarios: [{ id: 'IC_1', body: GO_TOKEN, createdAt: '2026-08-25T10:00:00Z', author: { login: 'un-agente' } }],
    })
    expect(r.status).toBe(9)
    expect(r.argv).not.toMatch(/issue edit/)
  })

  it('el go de OTRO despacho tampoco: el nonce es por despacho', () => {
    const otro = goBody(newGoNonce(Buffer.from([1, 2, 3, 4])))
    const r = release(worktree(), {
      configDir: registrar(),
      comentarios: [{ id: 'IC_1', body: otro, createdAt: '2026-08-25T10:00:00Z', author: { login: 'josemerca' } }],
    })
    expect(r.status).toBe(9)
    // Y por eso esta puerta puede mirar el issue ENTERO sin ventana de ids: un
    // go heredado no encaja por construcción.
    expect(r.salida).toMatch(/ningún comentario de este issue trae el go de este despacho/)
  })

  it('el go correcto en un comentario viejo del issue SÍ vale: aquí no hay ventana, la hace el nonce', () => {
    const r = release(worktree(), {
      configDir: registrar(),
      comentarios: [
        { id: 'IC_0', body: 'prosa', createdAt: '2026-08-01T00:00:00Z', author: { login: 'x' } },
        comentarioDelGo('josemerca'),
      ],
    })
    expect(r.status).toBe(0)
  })

  it('sin compromiso registrado y con gate `plan` → exit 9, y nombra el remedio', () => {
    const r = release(worktree(), { configDir: tmp('ct-f38-vacio-'), comentarios: [comentarioDelGo()] })
    expect(r.status).toBe(9)
    expect(r.salida).toMatch(/NO ESTÁ REGISTRADO/)
    expect(r.salida).toMatch(/ct-go\.mjs --issue 9 --repo o\/r/)
  })

  it('sin compromiso y con un issue que no declara NINGÚN gate → exit 9: silencio no es renuncia', () => {
    // Es además el camino que abriría un agente borrándose las labels.
    const r = release(worktree(), { configDir: tmp('ct-f38-vacio-'), labels: ['status:in-progress'], comentarios: [] })
    expect(r.status).toBe(9)
    expect(r.salida).toMatch(/no declaran NINGÚN gate/)
  })

  it('la renuncia EXPLÍCITA (`gate:none`) libera sin mirar ningún go', () => {
    const r = release(worktree(), { configDir: tmp('ct-f38-vacio-'), labels: ['status:in-progress', 'gate:none'], comentarios: [] })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/released #9/)
  })

  it('un registro ilegible NO libera, y no afirma que falte el go', () => {
    // La doctrina de los exit 5/6/8: este fichero no afirma limpio lo que no ha
    // podido mirar.
    const cfg = registrar()
    writeFileSync(goPath({ repo: 'o/r', issue: 9, configDir: cfg }), '{ esto no es json\n')
    const r = release(worktree(), { configDir: cfg, comentarios: [comentarioDelGo()] })
    expect(r.status).toBe(9)
    expect(r.salida).toMatch(/NO se ha podido leer/)
    expect(r.salida).not.toMatch(/no está cerrado/)
  })

  it('si no se pueden leer los comentarios tampoco libera, y NO dice que falte el go', () => {
    // Un issue con un go real cuyos comentarios no se pudieron leer no es
    // indistinguible de uno sin ninguno — y este fichero no confunde las dos
    // cosas en ninguna de sus puertas.
    const r = release(worktree(), { configDir: registrar(), commentsFail: true })
    expect(r.status).toBe(9)
    expect(r.salida).toMatch(/no se han podido leer los comentarios/)
    expect(r.salida).toMatch(/no se afirma que falte/)
    expect(r.argv).not.toMatch(/issue edit/)
  })

  // -------------------------------------------------------------------------
  // EL ORDEN DE LA ESCALERA. La puerta del go va la ÚLTIMA a propósito: con el
  // run a medias, preguntar por el go es ruido sobre un slice que aún no ha
  // terminado. Con todo en verde, un go que falta ya no es un «todavía no».
  // -------------------------------------------------------------------------
  it('va DESPUÉS de la puerta del run: sin run entregado gana el 7, no el 9', () => {
    const dir = worktree()
    const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-9.json'), 'utf8'))
    delete run.closed
    writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify(run))
    const r = release(dir, { configDir: tmp('ct-f38-vacio-'), comentarios: [] })
    expect(r.status).toBe(7)
  })
})

describe('el registro del compromiso', () => {
  it('un fichero por issue y por repo: el mismo número existe en todos los repos del mundo', () => {
    const cfg = tmp('ct-f38-reg-')
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: cfg })
    writeGoCommitment({ repo: 'otro/repo', issue: 7, commitment: 'b'.repeat(64), configDir: cfg })
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).commitment).toBe(GO_HASH)
    expect(readGoCommitment({ repo: 'otro/repo', issue: 7, configDir: cfg }).commitment).toBe('b'.repeat(64))
  })

  it('reescribir es el caso normal: redespachar sortea un nonce nuevo y el viejo deja de valer', () => {
    const cfg = tmp('ct-f38-reg-')
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: cfg })
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: 'c'.repeat(64), configDir: cfg })
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).commitment).toBe('c'.repeat(64))
  })

  it('el fichero no es legible por el resto de la máquina', () => {
    const cfg = tmp('ct-f38-reg-')
    const ruta = writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: cfg })
    expect(statSync(ruta).mode & 0o077).toBe(0)
  })

  it('un nombre de repo con barras o `..` no escribe fuera de la carpeta', () => {
    const cfg = tmp('ct-f38-reg-')
    const ruta = goPath({ repo: '../../etc/passwd', issue: 7, configDir: cfg })
    expect(dirname(ruta)).toBe(join(cfg, 'control-tower', 'go'))
  })

  it('sin HOME ni CLAUDE_CONFIG_DIR no escribe NADA: una ruta relativa acabaría en el cwd', () => {
    // El modo de fallo que esto evita es de los peores: el compromiso se escribe
    // donde nadie lo lee, el vigilante arranca, la persona da el go y
    // `--release` se niega. Un slice atascado sin que nada falle. Verificado por
    // construcción: un test de esta suite que corre con HOME='' dejó un
    // `.claude/control-tower/go/o__r-90.json` dentro del checkout.
    expect(() => writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: 'relativo/mal' }))
      .toThrow(/ruta absoluta/)
    // Y la lectura no dice «no hay go», dice «no se ha podido comprobar».
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: 'relativo/mal' }).error).toMatch(/ruta absoluta/)
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: 'relativo/mal' }).missing).toBe(undefined)
  })

  it('distingue las TRES respuestas: hay, no hay, y no se ha podido leer', () => {
    const cfg = tmp('ct-f38-reg-')
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).missing).toBe(true)
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: 'no-es-un-sha', configDir: cfg })
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).error).toMatch(/sha256/)
  })
})

describe('ct-go: reemitir el go de un despacho en vuelo', () => {
  it('registra un compromiso nuevo y dicta el go, sin escribir el nonce en el fichero', () => {
    const cfg = tmp('ct-f38-ctgo-')
    const r = spawnSync(process.execPath, [CT_GO, '--issue', '7', '--repo', 'o/r'], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    })
    expect(r.status).toBe(0)
    const nonce = (r.stdout.match(/-OK ([0-9a-f]{8})/) || [])[1]
    expect(nonce).toMatch(/^[0-9a-f]{8}$/)
    const ruta = goPath({ repo: 'o/r', issue: 7, configDir: cfg })
    expect(readFileSync(ruta, 'utf8')).not.toContain(nonce)
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).commitment).toBe(goCommitment(nonce))
  })

  it('dice que el vigilante en vuelo sigue buscando el go anterior: no lo esconde', () => {
    const cfg = tmp('ct-f38-ctgo-')
    const r = spawnSync(process.execPath, [CT_GO, '--issue', '7', '--repo', 'o/r'], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    })
    expect(r.stdout).toMatch(/está buscando el go ANTERIOR/)
    expect(r.stdout).toMatch(/a mano/)
  })

  it('el go que reemite libera de verdad: es el camino de recuperación completo', () => {
    const cfg = tmp('ct-f38-ctgo-')
    const emitido = spawnSync(process.execPath, [CT_GO, '--issue', '9', '--repo', 'o/r'], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    })
    const nonce = (emitido.stdout.match(/-OK ([0-9a-f]{8})/) || [])[1]
    const r = release(worktree(), {
      configDir: cfg,
      comentarios: [{ id: 'IC_1', body: goBody(nonce), createdAt: '2026-08-25T11:00:00Z', author: { login: 'josemerca' } }],
    })
    expect(r.status).toBe(0)
  })

  it('argumentos inválidos → exit 2, sin registrar nada', () => {
    const cfg = tmp('ct-f38-ctgo-')
    for (const args of [['--issue', 'siete', '--repo', 'o/r'], ['--issue', '7', '--repo', 'sin-barra'], ['--issue', '7']]) {
      const r = spawnSync(process.execPath, [CT_GO, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } })
      expect(r.status).toBe(2)
    }
    expect(existsSync(join(cfg, 'control-tower', 'go'))).toBe(false)
  })
})

describe('el vigilante exige el compromiso', () => {
  // Sin esto, la puerta se abriría OMITIENDO un argumento: el agente que
  // quisiera saltarse el gate sólo tendría que relanzar el vigilante él.
  it('sin --go-hash no vigila: exit 2, y NO cae al `-OK` sin nonce', () => {
    const r = spawnSync(process.execPath, [WATCH_GO, '--issue', '5', '--repo', 'o/r', '--session', 'x'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--go-hash inválido o ausente/)
    expect(r.stderr).toMatch(/esa puerta la abriría el propio agente/)
  })

  it('con un --go-hash que no es un sha256 tampoco', () => {
    const r = spawnSync(process.execPath, [WATCH_GO, '--issue', '5', '--repo', 'o/r', '--session', 'x', '--go-hash', 'abc'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
  })
})

describe('los textos del gate', () => {
  it('el del AGENTE le dice que no puede fabricar el go y que sin él no entrega', async () => {
    const { GATES } = await import('../scripts/gates.js')
    // Un agente que crea que puede saltarse el gate hace el trabajo dos veces.
    expect(GATES.plan.kickoff).toMatch(/no puedes fabricarlo/)
    expect(GATES.plan.kickoff).toMatch(/exit 9/)
    expect(GATES.plan.kickoff).toMatch(/NO está en este kickoff/)
  })

  it('el del HUMANO dice qué teclear y de dónde sale, sin escribir el nonce en el issue', async () => {
    const { GATES } = await import('../scripts/gates.js')
    expect(GATES.plan.issue).toContain(`${GO_TOKEN} <nonce>`)
    expect(GATES.plan.issue).toMatch(/ct-go\.mjs/)
    // El issue lo lee el agente: el nonce no puede estar ahí, ni un ejemplo que
    // lo parezca.
    expect(GATES.plan.issue).not.toMatch(/-OK [0-9a-f]{8}/)
  })

  it('el fixture y el módulo no divergen: NONCE, GO y GO_HASH son la misma cosa', () => {
    expect(GO).toBe(goBody(NONCE))
    expect(GO_HASH).toBe(goCommitment(NONCE))
    expect(envDelGo({ repo: 'o/r', issue: 1 }).CLAUDE_CONFIG_DIR).toMatch(/ct-go-cfg-/)
  })
})
