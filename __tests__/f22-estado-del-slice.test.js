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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATE_REL_PATH, SLICE_REL_PATH, NEVER_IN_A_SLICE_PR, resolveStatePath, excludeContentWith } from '../scripts/state-paths.js'

const here = dirname(fileURLToPath(import.meta.url))
const stopHook = join(here, '..', 'dist', 'stop.js')
const sessionStartHook = join(here, '..', 'dist', 'session-start.js')

// Un repo git de verdad con un commit: los hooks corren `git rev-parse HEAD` y
// `git log`, así que un directorio pelado no ejercita el camino real.
const mkGitRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-git-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '.')
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
