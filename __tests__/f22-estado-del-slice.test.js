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
import { buildStateSeed, renderKickoff } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'
// F22, Step 4: montaje reusado de __tests__/ct-next-launch-verification.test.js
// — dirs de cuenta + stubs de cmux/claude, e higiene de limpieza de directorios
// temporales que puede colgar de un SIGKILL a un nieto huérfano.
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { envDelGo } from './fixtures/go-gate.js'

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
// verification.test.js — mismos stubs de gh/cmux/claude,
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
  if (trackAgentState) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: el epic\n---\n# coordinadora\n')
  }
  writeFileSync(join(dir, '.gitignore'), `${SLICE_REL_PATH}\n!${SLICE_REL_PATH}\n`)
  git('add', '-A')
  git('commit', '-qm', 'base')
  // UN ORIGIN DE VERDAD, FETCHEABLE Y OFFLINE (Paso 1 del spec de la primera
  // corrida en un repo ajeno). Estos dos tests corren git DE VERDAD, y desde
  // el Paso 1 ct-next.mjs hace `git fetch origin <base>` y corta el worktree
  // de `origin/<base>`: con el `https://github.com/o/r.git` que había aquí, el
  // fetch salía a la red, fallaba, y la corrida moría ANTES de llegar a la
  // puerta de efecto que estos tests existen para probar.
  //
  // El truco es la RUTA: un repo bare local colgado de `.../github.com/o/r.git`
  // satisface las dos cosas a la vez sin tocar nada de producción — `git fetch`
  // lo alcanza porque es una ruta del disco, y la guarda de identidad de
  // ct-next.mjs lo lee como `o/r` porque su regex busca `github.com[:/]owner/repo`
  // en la URL del remote, y una ruta con ese tramo dentro casa igual que una URL.
  // Se clona DESPUÉS del commit para que `origin/main` exista, y vive DENTRO
  // de `.git/` para que no aparezca en `git status --porcelain` (la puerta de
  // efecto de F22 lee esa salida) y se lo lleve la limpieza del propio repo.
  const origin = join(dir, '.git', 'test-origin', 'github.com', 'o', 'r.git')
  mkdirSync(dirname(origin), { recursive: true })
  execFileSync('git', ['clone', '-q', '--bare', dir, origin], { stdio: 'ignore' })
  git('remote', 'add', 'origin', origin)
  git('fetch', '-q', 'origin', 'main')
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

describe('F22 — la semilla deja de desarmar el hook de frescura', () => {
  it('siembra last_commit con el sha de la base, no vacío', () => {
    const slice = { n: 7, name: 'un slice', ac: ['AC1'], issue: 42 }
    const seed = buildStateSeed(slice, { branch: 'feat/42', base: 'main', baseSha: 'a'.repeat(40) })
    expect(parseState(seed).meta.last_commit).toBe('a'.repeat(40))
  })

  it('sin baseSha cae a vacío — un sha inventado sería peor que ninguno', () => {
    const slice = { n: 7, name: 'un slice', ac: ['AC1'], issue: 42 }
    const seed = buildStateSeed(slice, { branch: 'feat/42', base: 'main' })
    expect(parseState(seed).meta.last_commit).toBe('')
  })

  it('con la semilla nueva, el hook Stop BLOQUEA el cierre tras un commit de trabajo', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const baseSha = git('rev-parse', 'HEAD').trim()
    const seed = buildStateSeed(
      { n: 1, name: 'slice', ac: ['AC1'], issue: 1 },
      { branch: 'feat/1', base: 'main', baseSha },
    )
    writeFileSync(join(dir, SLICE_REL_PATH), seed)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('1 commit')
    rmSync(dir, { recursive: true, force: true })
  })

  it('y con la semilla de HOY (last_commit vacío) NO bloquea — el defecto que esto arregla', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const seed = buildStateSeed({ n: 1, name: 'slice', ac: ['AC1'], issue: 1 }, { branch: 'feat/1', base: 'main' })
    writeFileSync(join(dir, SLICE_REL_PATH), seed)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    expect(runHook(stopHook, dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F22, Task 6b — LOS MENSAJES NOMBRAN EL FICHERO QUE SE LEYÓ DE VERDAD.
//
// Los lectores ya aplican la precedencia, pero los mensajes que hablan del
// fichero seguían nombrando `.agent/STATE.md` a pelo. En el worktree de un
// slice eso le dice al agente que edite el fichero TRACKEADO de la
// coordinadora — justo la contaminación que F22 elimina. Y desde la Task 5
// (que rearmó el hook `Stop` sembrando `last_commit` con el sha de la base)
// ese motivo de bloqueo sale en CADA turno de CADA slice, así que la
// instrucción equivocada pasó de inofensiva a ser lo que el agente lee
// turno tras turno.
//
// Los dos primeros tests corren el hook REAL de `dist/` contra un repo de
// verdad: es la única forma de comprobar que la ruta resuelta llega desde
// `resolveStatePath` hasta el texto, atravesando el hook y `state.js`.
// ============================================================================
describe('F22 — los mensajes nombran el fichero que se leyó', () => {
  it('en un worktree de slice, el bloqueo del hook Stop nombra SLICE.md y NO STATE.md', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const base = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, SLICE_REL_PATH), `---\ntask: slice\nlast_commit: ${base}\n---\n# s\n`)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')

    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain(SLICE_REL_PATH)
    // Lo que de verdad importa: ni una sola mención al fichero de la
    // coordinadora. Un `Actualiza STATE.md` aquí es una orden de contaminar.
    expect(out.reason).not.toContain(STATE_REL_PATH)
    rmSync(dir, { recursive: true, force: true })
  })

  it('en el checkout de la coordinadora, el mismo bloqueo sigue nombrando STATE.md', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const base = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(dir, STATE_REL_PATH), `---\ntask: el epic\nlast_commit: ${base}\n---\n# c\n`)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')

    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain(STATE_REL_PATH)
    expect(out.reason).not.toContain(SLICE_REL_PATH)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el kickoff le dice al agente que use SLICE.md, en TODAS sus líneas', () => {
    const k = renderKickoff(
      { n: 7, name: 'un slice', type: 'backend', ac: ['AC-7.1'], issue: '#7' },
      { repo: 'o/r', dispatchCheckPath: '/p/dispatch-check.mjs', base: 'main', conventionsDir: '/plugin/conventions' },
    )
    // Ninguna línea nombra el fichero de la coordinadora: el kickoff SOLO lo
    // recibe un agente de slice, así que ahí no hay ambigüedad posible.
    expect(k).not.toContain(STATE_REL_PATH)
    const linea = (aguja) => k.split('\n').find((l) => l.includes(aguja))
    expect(linea('blocked:')).toContain(SLICE_REL_PATH)
    expect(linea('Al acabar:')).toContain(SLICE_REL_PATH)
  })
})

// ============================================================================
// F22, Task 6 — el `blocked` que formatBlockedClaimWarnings (ct-next.mjs)
// reporta se lee de `.agent/SLICE.md`, SIN fallback a `.agent/STATE.md`. En
// un worktree sembrado por esta versión, `.agent/STATE.md` es el fichero de
// la COORDINADORA, congelado en la base: su `blocked` habla del epic, no del
// slice, y leerlo reportaría como bloqueado un slice que no lo está. Un
// worktree sin SLICE.md es uno del esquema anterior a F22 — se avisa, no se
// adivina.
//
// Montaje calcado de __tests__/ct-next-staleness.test.js (runReal vía
// spawnSync, fakePath con fake-git-bin/fake-gh-bin/fake-cmux-bin,
// rmSyncBestEffort) — con una diferencia deliberada: aquí se
// capturan stdout y stderr POR SEPARADO, porque la aserción central es que el
// motivo de la coordinadora no se filtre a NINGUNO de los dos canales, no
// solo a la mezcla de ambos.
// ============================================================================
const blockedFakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  process.env.PATH,
].join(':')

function runBlockedCheck(args, envOverrides = {}) {
  const r = spawnSync('node', [ctNextScript, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: blockedFakePath, ...envOverrides },
  })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

describe('F22 — el dispatcher no confunde el blocked de la coordinadora con el del slice', () => {
  it('un worktree del esquema anterior AVISA en vez de leer el STATE.md de la coordinadora', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'f22-blocked-'))
    mkdirSync(join(repoRoot, '.worktrees', '5', '.agent'), { recursive: true })
    writeFileSync(
      join(repoRoot, '.worktrees', '5', STATE_REL_PATH),
      '---\ntask: el epic de la coordinadora\nblocked:\n  reason: esperando una decisión de producto\n---\n# c\n',
    )
    const issue5 = { number: 5, title: '#5 slice viejo', labels: [{ name: 'status:in-progress' }], body: '<!-- ct-order:1 -->\n' }
    const r = runBlockedCheck(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      // Dos llamadas secuenciadas (abiertos, luego cerrados): sin
      // FAKE_GH_COUNTER_FILE las dos devolverían seq[0] por igual y el
      // fixture de "cerrados" (vacío, a propósito) se ignoraría.
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue5], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })

    // Dice que NO lo ha comprobado, y nombra el fichero que falta…
    expect(r.stderr).toContain('.agent/SLICE.md')
    expect(r.stderr).toContain('NO se ha comprobado')
    // …y NUNCA afirma que el slice esté bloqueado citando el motivo del epic,
    // en NINGUNO de los dos canales.
    expect(r.stderr).not.toContain('esperando una decisión de producto')
    expect(r.stdout).not.toContain('esperando una decisión de producto')

    rmSyncBestEffort(repoRoot)
  })

  // Task 6b, fix round 1 — EL LLAMANTE QUE SE ESCAPÓ DEL BARRIDO.
  //
  // `formatBlockedClaimWarnings` lee `.worktrees/<n>/.agent/SLICE.md` y se lo
  // pasa a `readBlocked`, que compone sus notas con el fichero que le digan —
  // y sin `stateRel` le dice `.agent/STATE.md` por defecto. La nota de
  // contradicción salta con `status: blocked` + campo `blocked` vacío (el
  // error de escritura que el propio state.js documenta como el más probable)
  // y se concatena TAL CUAL al aviso del dispatcher: la coordinadora leería
  // «su propio .worktrees/7/.agent/SLICE.md se declara BLOQUEADO …
  // contradicción en .agent/STATE.md», que la manda a editar el fichero
  // TRACKEADO que tiene en su propio cwd. Es la contaminación que F22 existe
  // para impedir, servida por el propio dispatcher.
  //
  // Un default es un fallo silencioso por construcción: no revienta, produce
  // una respuesta PLAUSIBLE y equivocada. Por eso el guard es un test y no una
  // convención.
  it('la nota de contradicción de un SLICE.md nombra SLICE.md, no el STATE.md que la coordinadora tiene en su cwd', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'f22-blocked-nota-'))
    mkdirSync(join(repoRoot, '.worktrees', '7', '.agent'), { recursive: true })
    // `status: blocked` con el campo `blocked` vacío: dispara la nota.
    writeFileSync(
      join(repoRoot, '.worktrees', '7', SLICE_REL_PATH),
      '---\ntask: el slice\nstatus: blocked\nblocked:\n---\n# s\n',
    )
    const issue7 = { number: 7, title: '#7 un slice', labels: [{ name: 'status:in-progress' }], body: '<!-- ct-order:1 -->\n' }
    const r = runBlockedCheck(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue7], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })

    // La nota sale (si no, el test no estaría probando nada)…
    expect(r.stderr).toContain('contradicción en')
    // …y nombra el fichero que el dispatcher leyó de verdad.
    expect(r.stderr).toContain(`contradicción en ${SLICE_REL_PATH}`)
    // Ni una sola mención al fichero de la coordinadora en TODO el aviso.
    expect(r.stderr).not.toContain(STATE_REL_PATH)
    expect(r.stdout).not.toContain(STATE_REL_PATH)

    rmSyncBestEffort(repoRoot)
  })
})

describe('F22 — ct-init deja la regla commiteada en el .gitignore', () => {
  it('añade .agent/SLICE.md, y no la duplica al re-correrlo', () => {
    const dir = mkGitRepo()
    const initScript = join(here, '..', 'scripts', 'ct-init.sh')
    execFileSync('bash', [initScript, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const first = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(first.split('\n').filter((l) => l.trim() === SLICE_REL_PATH)).toHaveLength(1)
    execFileSync('bash', [initScript, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const second = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(second.split('\n').filter((l) => l.trim() === SLICE_REL_PATH)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('F22 — --release se niega si la rama lleva un fichero de estado', () => {
  const dispatchCheck = join(here, '..', 'scripts', 'dispatch-check.mjs')

  const mkSliceWorktree = ({ baseFiles = {} } = {}) => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# c\n')
    // F-jjponz-3: ficheros que ya existen EN LA BASE de la rama. Son los que
    // un plan cita como "Current state (fichero)" y que una tarea del slice
    // reescribe después — el caso que ningún fixture cubría, porque todos
    // creaban ficheros nuevos ("does not exist") y no ejercitaban nunca la
    // comprobación de literalidad en el gate de --release.
    for (const [rel, content] of Object.entries(baseFiles)) {
      writeFileSync(join(dir, rel), content)
    }
    git('add', '-A')
    git('commit', '-qm', 'estado coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const baseSha = git('rev-parse', 'HEAD').trim()
    // Mismo patrón que "F22 — el seed no toca el fichero de la
    // coordinadora": sin esta regla en info/exclude, `.agent/SLICE.md` no
    // está ignorado en este repo de prueba y un `git add -A` posterior lo
    // arrastraría al commit de "work" — contaminando precisamente el caso
    // que el segundo test de abajo quiere dejar limpio. En el dispatcher
    // real esta regla la escribe ensureSliceIgnored() (Task 3) antes de
    // sembrar SLICE.md; aquí hay que replicarla a mano.
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), `---\ntask: slice\nbase: ${baseSha}\n---\n# s\n`)
    return { dir, wt, git: (...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8' }) }
  }

  it('exit 5 cuando la rama introduce .agent/STATE.md, y el mensaje da el remedio', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, STATE_REL_PATH), '---\ntask: el slice\n---\n# contaminado\n')
    git('add', '-A')
    git('commit', '-qm', 'work + estado')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('.agent/STATE.md')
    expect(r.stderr).toContain('git checkout')
    rmSync(dir, { recursive: true, force: true })
  })

  // Plan mínimo que cumple plan-contract.js — desde F-jjponz-1, --release
  // exige un plan prescriptivo commiteado en la rama. Su único bloque va bajo
  // "Final text (f.txt):" (F-jjponz-4: todo bloque declara su rol), un rol que
  // no se comprueba contra el repo: el fixture sigue sin citar nada.
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
    'f.txt',
    '## 5. Interfaces',
    'Consumes: N/A. Produces: N/A.',
    '## 6. Test strategy',
    'N/A — fixture.',
    '## 7. Tasks',
    '### Task 1 — do the work',
    '**Objective:** the work is committed.',
    '**Files:** f.txt',
    'Final text (f.txt):',
    FENCE,
    'trabajo',
    FENCE,
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** git log shows the commit.',
    FENCE + 'bash',
    'git log --oneline -1',
    FENCE,
    '## 8. Global verification',
    'N/A — fixture.',
    '## 9. Assumptions',
    'None.',
    '',
  ].join('\n')

  const seedPlan = (wt, issue) => {
    mkdirSync(join(wt, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(wt, 'docs', 'superpowers', 'plans', `2026-08-12-issue-${issue}-fixture.md`), minimalPlanFor(issue))
  }

  // El gate del run de --release (exit 7): estos tests prueban OTRAS puertas,
  // así que se les da un run entregado para que la del run no interfiera.
  // Sin commitear, que es como lo deja ct-step (ct-init lo gitignorea).
  const seedRun = (wt, issue) => {
    mkdirSync(join(wt, '.agent'), { recursive: true })
    writeFileSync(join(wt, '.agent', `run-${issue}.json`), JSON.stringify({ issue, task: 1, tasksTotal: 1, step: 'commit', closed: 'delivered' }))
  }

  // Igual que seedPlan, pero su Task 1 CITA un fichero en vez de crearlo:
  // `Current state (<path>):` con `<body>` dentro de la valla.
  const seedPlanCitando = (wt, issue, path, body) => {
    const plan = minimalPlanFor(issue)
      .replace('Final text (f.txt):', `Current state (${path}):`)
      .replace(`${FENCE}\ntrabajo\n${FENCE}`, `${FENCE}\n${body}\n${FENCE}`)
    mkdirSync(join(wt, 'docs', 'superpowers', 'plans'), { recursive: true })
    writeFileSync(join(wt, 'docs', 'superpowers', 'plans', `2026-08-12-issue-${issue}-fixture.md`), plan)
  }

  it('exit 0 con una rama limpia — el caso normal no paga nada', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, 'f.txt'), 'trabajo\n')
    seedPlan(wt, 1)
    git('add', '-A')
    git('commit', '-qm', 'work')
    seedRun(wt, 1)
    // Task 10 (F-e2e): --release lee el body del issue por `gh` incluso tras
    // pasar las puertas de arriba — sin el stub en PATH, este `gh` real
    // fallaría contra un repo 'o/r' que no existe. Sin FAKE_GH_VIEW_BODY, el
    // stub responde vacío: sin sección "## E2E" que cruzar, camino feliz.
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
      env: { ...process.env, PATH: `${join(fixturesDir, 'fake-gh-bin')}:${process.env.PATH}`, ...envDelGo({ repo: 'o/r', issue: 1 }) },
    })
    expect(r.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('exit 6 con la rama limpia pero SIN plan prescriptivo — el remedio nombra la skill (F-jjponz-1)', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, 'f.txt'), 'trabajo\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('writing-plans-prescriptive')
    expect(r.stderr).toContain('status:in-progress')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--check-plan en verde con el plan en el árbol de trabajo, aún sin commitear (F-jjponz-1)', () => {
    const { dir, wt } = mkSliceWorktree()
    seedPlan(wt, 1)
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('plan ok')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--check-plan con una cita de memoria → exit 6 y nombra el fichero citado (F-jjponz-1)', () => {
    const { dir, wt } = mkSliceWorktree()
    seedPlan(wt, 1)
    const roto = readFileSync(join(wt, 'docs', 'superpowers', 'plans', '2026-08-12-issue-1-fixture.md'), 'utf8')
      .replace('Final text (f.txt):', 'Current state (f.txt):')
    writeFileSync(join(wt, 'docs', 'superpowers', 'plans', '2026-08-12-issue-1-fixture.md'), roto)
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('f.txt')
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F-jjponz-3 — el gate del plan en --release era INSATISFACIBLE para
  // cualquier plan que modifique un fichero existente.
  //
  // Los dos modos compartían lector (`readFileSync` del árbol de trabajo). En
  // --check-plan eso es correcto: el plan se escribe ANTES de implementar y
  // cita el árbol tal y como está. En --release las tareas YA se ejecutaron,
  // así que toda cita de un fichero que el slice reescribe ha dejado de
  // existir verbatim y el gate salía con exit 6 — o sea, solo lo pasaban los
  // planes que se limitan a crear ficheros nuevos.
  //
  // Descubierto en el e2e del slice #1 de repo-pulse (un plan que actualiza
  // AGENTS.md): el agente solo pudo liberar reetiquetando sus tres citas como
  // prosa, lo que las saca del gate en silencio. Es decir, el bug no
  // bloqueaba: empujaba a esquivar la comprobación que da nombre a la
  // feature.
  //
  // La corrección es asimétrica y se apoya en lo que ya hace --check-plan: el
  // release verifica las citas contra la MISMA foto contra la que se validó
  // el plan cuando se escribió, que es la base de la rama.
  // ==========================================================================

  it('exit 0 cuando el plan cita un fichero que este slice MODIFICA: la cita se comprueba en la BASE, no en HEAD (F-jjponz-3)', () => {
    const { dir, wt, git } = mkSliceWorktree({ baseFiles: { 'AGENTS.md': 'texto de antes del slice\n' } })
    seedPlanCitando(wt, 1, 'AGENTS.md', 'texto de antes del slice')
    // La tarea hace lo que el plan ordena: reescribe el fichero citado.
    writeFileSync(join(wt, 'AGENTS.md'), 'texto nuevo que trae el slice\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    seedRun(wt, 1)
    // Task 10 (F-e2e): idem al test de arriba — el stub hace falta para la
    // lectura del body, no solo para el escenario de mutación.
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
      env: { ...process.env, PATH: `${join(fixturesDir, 'fake-gh-bin')}:${process.env.PATH}`, ...envDelGo({ repo: 'o/r', issue: 1 }) },
    })
    expect(r.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('exit 6 si la cita no existe TAMPOCO en la base, aunque la rama la escriba en HEAD — el fix endurece el gate, no lo desarma (F-jjponz-3)', () => {
    const { dir, wt, git } = mkSliceWorktree({ baseFiles: { 'AGENTS.md': 'texto de antes del slice\n' } })
    // Cita inventada... y el trabajo del slice la deja escrita en el árbol:
    // con el lector viejo (HEAD) esto pasaba en verde. Es exactamente la
    // forma de colar una cita de memoria por la puerta del release.
    seedPlanCitando(wt, 1, 'AGENTS.md', 'esto no estuvo nunca en el fichero')
    writeFileSync(join(wt, 'AGENTS.md'), 'esto no estuvo nunca en el fichero\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('AGENTS.md')
    rmSync(dir, { recursive: true, force: true })
  })

  it('exit 6 con mensaje honesto si el fichero citado NO existía en la base: un fichero que crea el slice se cita con "does not exist" (F-jjponz-3)', () => {
    const { dir, wt, git } = mkSliceWorktree()
    seedPlanCitando(wt, 1, 'nuevo.txt', 'contenido nuevo')
    writeFileSync(join(wt, 'nuevo.txt'), 'contenido nuevo\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(6)
    expect(r.stderr).toContain('nuevo.txt')
    // No se afirma "cita de memoria" cuando lo que pasa es que el fichero no
    // estaba en la base: el mensaje tiene que decir DÓNDE se miró.
    expect(r.stderr).toContain('base')
    rmSync(dir, { recursive: true, force: true })
  })

  it('--check-plan sigue leyendo el ÁRBOL DE TRABAJO: es el modo de ANTES de implementar (F-jjponz-3)', () => {
    const { dir, wt } = mkSliceWorktree({ baseFiles: { 'AGENTS.md': 'texto de antes del slice\n' } })
    seedPlanCitando(wt, 1, 'AGENTS.md', 'texto de antes del slice')
    const verde = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(verde.status).toBe(0)
    // Y si el árbol ya no dice eso, --check-plan lo canta: en ese modo el
    // árbol ES el estado que el plan cita, y no se sustituye por la base.
    writeFileSync(join(wt, 'AGENTS.md'), 'otra cosa\n')
    const rojo = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--check-plan'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(rojo.status).toBe(6)
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F22, fix round 1 — tres formas más de que la puerta pase en silencio una
  // rama contaminada. El reviewer las elevó de Minor a bloqueantes: una
  // puerta que se puede desactivar por config, por un rename, o por un
  // `base:` auto-referencial no es una puerta, es una comprobación que a
  // veces comprueba.
  // ==========================================================================

  it('con diff.relative=true en la config de git e invocado desde un subdirectorio, SIGUE viendo .agent/STATE.md fuera del subárbol', () => {
    // Sin `--no-relative`, `git diff --name-only` desde un subdirectorio con
    // `diff.relative=true` en la config OMITE por completo los paths fuera
    // de ese subárbol — ni siquiera los oculta bajo un path relativo raro,
    // los hace desaparecer de la salida. Verificado a mano antes de este
    // test: sin el flag, la única línea que imprime `git diff` desde `sub/`
    // es `work.txt`; `.agent/STATE.md` no aparece en ningún sitio.
    const { dir, wt, git } = mkSliceWorktree()
    mkdirSync(join(wt, 'sub'), { recursive: true })
    // `.agent/STATE.md` ya está trackeado desde la base (mkSliceWorktree lo
    // commitea en `dir` antes de crear el worktree) — hace falta CAMBIAR su
    // contenido para que aparezca en el diff, no solo tenerlo presente.
    writeFileSync(join(wt, STATE_REL_PATH), '---\ntask: el slice\n---\n# contaminado\n')
    writeFileSync(join(wt, 'sub', 'work.txt'), 'trabajo\n')
    git('add', '-A')
    git('commit', '-qm', 'work + estado')
    // La config es del repo (afecta a cualquier invocación de git en él,
    // como haría la config real de quien esté ejecutando el gate) — no algo
    // que el script controle.
    git('config', 'diff.relative', 'true')
    const subDir = join(wt, 'sub')
    // Sin SLICE.md en `sub/` (el `.agent/SLICE.md` real vive en la raíz del
    // worktree, no en el subdirectorio), sliceBaseRef() cae al fallback:
    // aquí SÍ hay SLICE.md en la raíz del worktree, pero `readFileSync` lo
    // busca en `process.cwd()` (=`sub/`), así que tampoco lo encuentra desde
    // ahí y cae igual al fallback, que resuelve `main`.
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: subDir, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('.agent/STATE.md')
    rmSync(dir, { recursive: true, force: true })
  })

  it('un renombrado de .agent/STATE.md no esconde el borrado del path original', () => {
    // Con detección de renombres activada (el default de `git diff`), una
    // rama que hace `git mv .agent/STATE.md otro-nombre.md` imprime SOLO el
    // destino en `--name-only` — el borrado del origen queda oculto dentro
    // del par de rename. Verificado a mano: sin `--no-renames`, la única
    // línea es `otro-nombre.md`; con `--no-renames`, salen las dos, borrado
    // y creación, como paths independientes.
    // `.agent/STATE.md` ya está trackeado desde la base (mkSliceWorktree lo
    // commitea en `dir` antes de crear el worktree): basta con renombrarlo.
    const { dir, wt, git } = mkSliceWorktree()
    git('mv', STATE_REL_PATH, 'otro-nombre.md')
    git('commit', '-qm', 'renombra STATE.md')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('.agent/STATE.md')
    rmSync(dir, { recursive: true, force: true })
  })

  it('un `base:` en la semilla igual a HEAD no se lee como "limpia" — se niega igual que "no se pudo determinar la base"', () => {
    // `SLICE.md` no está trackeado y lo escribe el propio agente del slice:
    // es agent-reachable. Un `base:` que apunte a HEAD (por accidente, o
    // porque algo lo reescribió tras cometer la contaminación) haría que
    // `git diff base...HEAD` saliera SIEMPRE vacío por construcción — no
    // porque la rama esté limpia, sino porque no se comparó nada. La puerta
    // tiene que tratarlo como "no se pudo comprobar", nunca como "limpia".
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# c\n')
    git('add', '-A')
    git('commit', '-qm', 'estado coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/3', '.worktrees/3', 'HEAD')
    const wt = join(dir, '.worktrees', '3')
    const wtGit = (...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8' })
    // Contamina primero...
    writeFileSync(join(wt, STATE_REL_PATH), '---\ntask: el slice\n---\n# contaminado\n')
    wtGit('add', '-A')
    wtGit('commit', '-qm', 'work + estado')
    // ...y LUEGO escribe la semilla con `base:` apuntando al HEAD actual (el
    // commit que YA incluye la contaminación) en vez de al commit real del
    // que se cortó el worktree.
    const selfSha = wtGit('rev-parse', 'HEAD').trim()
    writeFileSync(join(wt, SLICE_REL_PATH), `---\ntask: slice\nbase: ${selfSha}\n---\n# s\n`)
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('EL MISMO commit que HEAD')
    expect(r.stderr).toContain('NO se ha podido comprobar')
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin base resoluble (sin main/master/remoto, sin SLICE.md) → exit 5, y dice explícitamente que NO se pudo comprobar', () => {
    // El invariante central del plan: nunca afirmar que algo se comprobó
    // cuando no se comprobó. Este es el test que atraparía una regresión
    // como añadir 'HEAD' a la cadena de fallback de sliceBaseRef() — con
    // ese cambio, esta misma rama (sin main/master/remoto) resolvería su
    // propio HEAD como base, el diff saldría vacío, y el gate reportaría
    // "limpia" sin haber comparado nada. A propósito, NADA de mkGitRepo()
    // (que crea la rama `main`): la rama de este repo se llama `feat/1`, no
    // hay remoto, y no hay `.agent/SLICE.md`, así que las cuatro vías de
    // sliceBaseRef() están cerradas.
    const dir = mkdtempSync(join(tmpdir(), 'f22-nobase-'))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'feat/1', '.')
    git('config', 'user.email', 'test@test')
    git('config', 'user.name', 'test')
    writeFileSync(join(dir, 'f.txt'), 'base\n')
    git('add', '-A')
    git('commit', '-qm', 'base')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: dir, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('no se pudo determinar la base')
    expect(r.stderr).toContain('NO se ha podido comprobar')
    rmSync(dir, { recursive: true, force: true })
  })
})
