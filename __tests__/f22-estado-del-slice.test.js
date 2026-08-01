// ============================================================================
// F22 — EL ESTADO DEL SLICE DEJA DE SER PRODUCTO.
//
// El dispatcher sembraba el estado del slice SOBRE `.agent/STATE.md`, que está
// TRACKEADO y es el fichero de la sesión coordinadora. Tres veces en un
// periodo de 9 slices ese fichero entró en un PR; una llegó a `main`, que se
// quedó con `task: <nombre del slice>` y un gate pendiente de un PR ya
// mergeado — cualquier sesión nueva del repo se hidrataba creyendo que era el
// agente de ese slice.
//
// Y el mismo fichero era una foto falsa mientras tanto: 21 horas y 7 commits
// con la semilla intacta (`status: not_started`). La causa NO era que el
// kickoff pidiera actualizarlo al final: el hook `Stop` YA obligaba a
// refrescarlo en cada turno, y estaba desarmado porque la semilla escribía
// `last_commit: ''` — con el campo vacío, `describeStopRelation` devuelve
// `unset` y `classifyStopState` sale en silencio.
//
// Los dos van juntos porque arreglar el segundo empeora el primero: un agente
// obligado a refrescar su estado en cada turno es un agente con más papeletas
// de commitearlo.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_REL_PATH, SLICE_REL_PATH, NEVER_IN_A_SLICE_PR, resolveStatePath, excludeContentWith } from '../scripts/state-paths.js'
// F22, Step 4: montaje reusado de __tests__/ct-next-launch-verification.test.js
// — dirs de cuenta + stubs de cmux/claude, e higiene de limpieza de directorios
// temporales que puede colgar de un SIGKILL a un nieto huérfano.
import { ACCOUNT_ENV } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const here = dirname(fileURLToPath(import.meta.url))
const stopHook = join(here, '..', 'dist', 'stop.js')
const sessionStartHook = join(here, '..', 'dist', 'session-start.js')

// Un repo git de verdad con un commit: los hooks corren `git rev-parse HEAD` y
// `git log`, así que un directorio pelado no ejercita el camino real.
const mkGitRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-git-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  // Fix round 1, finding 2: `-b main` explícito — sin él, `git init` usa
  // `init.defaultBranch` de la máquina que corre el test (git de fábrica:
  // "master"), y el test de merge de más abajo asume "main" a secas.
  git('init', '-q', '-b', 'main', '.')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, 'f.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  return dir
}

const runHook = (hookPath, cwd, extra = {}) => {
  const r = spawnSync('node', [hookPath], {
    input: JSON.stringify({ cwd, stop_hook_active: false, ...extra }),
    encoding: 'utf8',
  })
  return r.stdout ? JSON.parse(r.stdout) : null
}

const mkRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-'))
  mkdirSync(join(dir, '.agent'), { recursive: true })
  return dir
}

describe('F22 — precedencia de lectura del estado', () => {
  it('con los DOS ficheros, gana SLICE.md: es el estado del slice, no el de la coordinadora', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    writeFileSync(join(dir, SLICE_REL_PATH), 'slice')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('slice')
    expect(r.path).toBe(join(dir, SLICE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin SLICE.md cae a STATE.md — el checkout de la coordinadora, y los worktrees del esquema anterior', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('coordinator')
    expect(r.path).toBe(join(dir, STATE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguno de los dos devuelve path null, y no inventa una ruta que no existe', () => {
    const dir = mkRepo()
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('none')
    expect(r.path).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('los paths que un PR de slice no puede introducir son EXACTAMENTE esos dos, no `.agent/` entero', () => {
    expect(NEVER_IN_A_SLICE_PR).toEqual([STATE_REL_PATH, SLICE_REL_PATH])
    expect(NEVER_IN_A_SLICE_PR).not.toContain('.agent/conventions-ack.md')
  })
})

describe('F22 — los hooks leen por precedencia', () => {
  it('SessionStart se hidrata del SLICE.md cuando existe, no del STATE.md de la coordinadora', () => {
    const dir = mkGitRepo()
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic de la coordinadora\nstatus: in_progress\n---\n# c\n')
    writeFileSync(join(dir, SLICE_REL_PATH), '---\ntask: el slice despachado\nstatus: not_started\n---\n# s\n')
    const out = runHook(sessionStartHook, dir)
    const ctx = out.hookSpecificOutput.additionalContext
    expect(ctx).toContain('el slice despachado')
    expect(ctx).not.toContain('el epic de la coordinadora')
    rmSync(dir, { recursive: true, force: true })
  })

  it('SessionStart cae al STATE.md sin SLICE.md — el checkout de la coordinadora sigue igual que antes', () => {
    const dir = mkGitRepo()
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic de la coordinadora\nstatus: in_progress\n---\n# c\n')
    const out = runHook(sessionStartHook, dir)
    expect(out.hookSpecificOutput.additionalContext).toContain('el epic de la coordinadora')
    rmSync(dir, { recursive: true, force: true })
  })

  it('Stop mide la frescura del SLICE.md, no la del STATE.md de la coordinadora', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const base = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, SLICE_REL_PATH), `---\ntask: slice\nlast_commit: ${base}\n---\n# s\n`)
    // Hacer trabajo y capturar el nuevo HEAD
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    const newHead = git('rev-parse', 'HEAD').trim()
    // El STATE.md de la coordinadora apunta al nuevo HEAD: si el hook lo leyera,
    // la relación sería `same` y no bloquearía. Pero SLICE.md apunta a base, así
    // que si el hook lee SLICE.md, ve `behind` y bloquea.
    writeFileSync(join(dir, STATE_REL_PATH), `---\ntask: coordinadora\nlast_commit: ${newHead}\n---\n# c\n`)
    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('se ha quedado atrás')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('F22 — la regla de exclude es idempotente y no corrompe lo que ya hay', () => {
  it('la añade cuando no está', () => {
    const r = excludeContentWith('# comentario\n', '.agent/SLICE.md')
    expect(r.added).toBe(true)
    expect(r.content).toBe('# comentario\n.agent/SLICE.md\n')
  })

  it('NO la duplica en la segunda pasada — dos dispatches dejan una sola línea', () => {
    const once = excludeContentWith('', '.agent/SLICE.md')
    const twice = excludeContentWith(once.content, '.agent/SLICE.md')
    expect(twice.added).toBe(false)
    expect(twice.content).toBe(once.content)
    expect(twice.content.split('\n').filter((l) => l === '.agent/SLICE.md')).toHaveLength(1)
  })

  it('normaliza el salto final: sin él, el append pegaría la regla a la última línea del usuario y corrompería LAS DOS', () => {
    const r = excludeContentWith('*.tmp', '.agent/SLICE.md')
    expect(r.content).toBe('*.tmp\n.agent/SLICE.md\n')
    expect(r.content).not.toContain('*.tmp.agent')
  })

  it('reconoce la regla aunque venga con espacios alrededor', () => {
    expect(excludeContentWith('  .agent/SLICE.md  \n', '.agent/SLICE.md').added).toBe(false)
  })
})

describe('F22 — la regla de ignore va al directorio COMÚN de git', () => {
  it('el info/exclude que ve un worktree es el del checkout principal, no uno propio', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: join(dir, '.worktrees', '1'), encoding: 'utf8',
    }).trim()
    // Devuelve el .git del checkout principal: UNA escritura cubre a la
    // coordinadora y a todos los worktrees, presentes y futuros.
    expect(common).toContain(dir)
    expect(common).not.toContain('.worktrees')
    rmSync(dir, { recursive: true, force: true })
  })

  it('una regla en info/exclude SÍ oculta el fichero nuevo, y sobrevive a git add -A', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    mkdirSync(join(wt, '.agent'), { recursive: true })
    writeFileSync(join(wt, SLICE_REL_PATH), 'estado del slice')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    execFileSync('git', ['add', '-A'], { cwd: wt })
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('F22 — el seed no toca el fichero de la coordinadora', () => {
  it('tras sembrar, el STATE.md del worktree queda a CERO DIFF contra la base', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# coordinadora\n')
    git('add', '-A')
    git('commit', '-qm', 'estado de la coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')

    // Lo que hace el dispatcher tras este cambio: regla de ignore, y siembra
    // en SLICE.md sin tocar STATE.md.
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), '---\ntask: el slice\n---\n# slice\n')

    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    expect(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('el merge de main que conflictuaba en STATE.md ahora entra limpio', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# v1\n')
    git('add', '-A')
    git('commit', '-qm', 'estado v1')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), '---\ntask: el slice\n---\n# slice\n')

    // La coordinadora avanza su estado en main — 44 de cada 1074 commits de
    // main lo hacían en el repo real.
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# v2\n')
    git('add', '-A')
    git('commit', '-qm', 'estado v2')

    const merge = spawnSync('git', ['merge', 'main', '-m', 'merge main'], { cwd: wt, encoding: 'utf8' })
    expect(merge.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F22, Step 4 — LA PUERTA DEL EFECTO ABORTA UNA CORRIDA REAL, Y REVIERTE EL
// CLAIM.
//
// Este es el test que impide que la verificación de efecto se degrade a
// decoración: hace falta una corrida REAL de ct-next.mjs (--dry-run no crea
// worktree ni siembra nada), montada sobre __tests__/ct-next-launch-
// verification.test.js — mismos stubs de gh/cmux/claude, mismo ACCOUNT_ENV,
// misma limpieza best-effort.
//
// La diferencia con ese montaje es deliberada: aquí NO se usa fake-git-bin.
// El escenario depende de una propiedad real de git (una negación en
// `.gitignore` gana a una regla en `info/exclude`), y un git enteramente
// simulado no tiene esa precedencia que reproducir — hace falta el binario
// de verdad, contra un repo de verdad en disco.
// ============================================================================
const ctNextScript = join(here, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

// PATH sin fake-git-bin (a propósito, ver el comentario de arriba): git real,
// delante de gh/cmux/claude simulados.
const realGitFakeRestPath = [
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

// Repo git DE VERDAD con la trampa puesta: `.gitignore` con la regla y su
// propia negación justo debajo — verificado a mano (ver Step 4 del brief)
// que con estas dos líneas `git status --porcelain --untracked-files=all`
// SIGUE viendo el fichero pese a la regla que ensureSliceIgnored() escribe
// en info/exclude, porque una negación en el .gitignore del repo tiene
// precedencia sobre info/exclude.
//
// `trackAgentState` (fix round 1, finding Important 1): controla si
// `.agent/STATE.md` va COMMITEADO en la base, para poder cubrir los DOS
// casos por los que puede pasar `.agent/` en un checkout real:
//   - true  (el caso por defecto, el checkout normal): `.agent/` YA tiene
//     algo trackeado, así que git lista SLICE.md individualmente en el
//     porcelain sin ayuda de ninguna bandera.
//   - false: NADA bajo `.agent/` está trackeado — ni siquiera el
//     directorio existe en la base. Es el caso que `--untracked-files=all`
//     existe para cubrir: con el modo por defecto de `git status
//     --porcelain`, un directorio ENTERAMENTE sin trackear colapsa en una
//     sola línea (`?? .agent/`) que el `includes(SLICE_REL_PATH)` de
//     ct-next.mjs no reconoce — la puerta se queda ciega justo en el caso
//     que existe para cerrar. Verificado a mano contra git de verdad antes
//     de escribir el test de abajo.
function mkRealDispatchRepo({ trackAgentState = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'f22-real-dispatch-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  git('remote', 'add', 'origin', 'https://github.com/o/r.git')
  if (trackAgentState) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: el epic\n---\n# coordinadora\n')
  }
  writeFileSync(join(dir, '.gitignore'), `${SLICE_REL_PATH}\n!${SLICE_REL_PATH}\n`)
  git('add', '-A')
  git('commit', '-qm', 'base')
  return dir
}

const openIssue1 = { number: 1, title: '#1 algo', labels: [{ name: 'status:ready' }], body: '' }

// runGateTest: el montaje de despacho real (idéntico entre los dos casos de
// abajo), parametrizado solo por el repo de entrada — para que los dos casos
// (`.agent/` con algo trackeado / `.agent/` enteramente sin trackear) corran
// exactamente la misma secuencia de aserciones y no puedan divergir en algo
// que no sea la causa que cada uno quiere probar.
function runGateTest(repoRoot) {
  const argvLog = join(repoRoot, 'gh-argv-log')
  const counterFile = join(repoRoot, 'gh-list-count')
  const r = spawnSync('node', [ctNextScript, '--repo', 'o/r', '--cap', '1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...ACCOUNT_ENV,
      PATH: realGitFakeRestPath,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue1], []]),
      FAKE_GH_COUNTER_FILE: counterFile,
      FAKE_GH_ARGV_LOG_FILE: argvLog,
    },
  })
  const out = (r.stdout || '') + (r.stderr || '')

  // 1. No se despacha.
  expect(r.status).not.toBe(0)
  // 2. El motivo es el que la puerta de efecto imprime — no un fallo genérico.
  expect(out).toContain('SIGUE siendo visible para git')
  // 3. El worktree quedó limpiado, no huérfano.
  expect(existsSync(join(repoRoot, '.worktrees', '1'))).toBe(false)
  // 4. Y el claim revertido: el fake-gh registró la llamada real de vuelta
  // a status:ready (mismo patrón de aserción que ct-next-claim.test.js usa
  // para el mismo tipo de revert automático tras un fallo post-claim).
  const argv = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
  expect(argv).toMatch(/issue edit 1 --repo o\/r --add-label status:ready --remove-label status:in-progress/)

  rmSyncBestEffort(repoRoot)
}

describe('F22 — la verificación de efecto ABORTA una corrida real y revierte el claim', () => {
  it('.gitignore con negación gana a info/exclude, con .agent/STATE.md ya trackeado → no se despacha, worktree limpiado, claim devuelto a status:ready', () => {
    runGateTest(mkRealDispatchRepo({ trackAgentState: true }))
  })

  // Fix round 1, finding Important 1: caso separado con NADA trackeado bajo
  // `.agent/` — el que `git status --porcelain` sin `--untracked-files=all`
  // dejaba pasar (colapsaba a `?? .agent/`, invisible para el
  // `includes(SLICE_REL_PATH)` de la puerta). Sin este caso, el que
  // `.agent/STATE.md` vaya commiteado en el otro test es una propiedad del
  // FIXTURE que por accidente hace pasar la comprobación real — ct-next.mjs
  // no exige en ningún sitio que `.agent/` tenga algo trackeado.
  it('.gitignore con negación gana a info/exclude, con NADA trackeado bajo .agent/ → sigue abortando (protege contra el colapso de directorio sin trackear)', () => {
    runGateTest(mkRealDispatchRepo({ trackAgentState: false }))
  })
})
