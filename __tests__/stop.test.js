import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'stop.js')

function bareRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}
function commit(dir, name) {
  writeFileSync(join(dir, name), name)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', name], { cwd: dir })
  return head(dir)
}
function initRepo() {
  const dir = bareRepo()
  commit(dir, 'a.txt')
  return dir
}
function head(dir) { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() }
function git(dir, ...args) { return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim() }
function writeState(dir, sha) {
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'STATE.md'), `---\nlast_commit: ${sha}\n---\nx`)
}
function run(dir, stopActive = false) {
  return execFileSync('node', [hook], {
    input: JSON.stringify({ cwd: dir, stop_hook_active: stopActive, hook_event_name: 'Stop' }),
    encoding: 'utf8',
  }).trim()
}

describe('stop hook', () => {
  it('bloquea si HEAD avanzó respecto a STATE.last_commit', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/STATE\.md/)
    rmSync(dir, { recursive: true, force: true })
  })
  it('no bloquea si STATE.last_commit == HEAD', () => {
    const dir = initRepo()
    writeState(dir, head(dir))
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
  it('no bloquea con stop_hook_active (anti-bucle)', () => {
    const dir = initRepo()
    writeState(dir, 'sha_viejo')
    expect(run(dir, true)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
  it('stdin malformado → salida vacía, exit 0 (no crash)', () => {
    const r = spawnSync('node', [hook], { input: 'no-json{', encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('')
  })
  it('no ejecuta comandos inyectados vía last_commit (bloquea, sin efectos)', () => {
    const dir = initRepo()
    writeState(dir, '$(touch pwned)')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
  // F7: el hook recuerda qué campos actualizar antes de cerrar; el sitio donde
  // se registra un bloqueo es ese momento, y `blocked` no estaba en la lista.
  it('el aviso nombra el campo `blocked` como la forma de decir que el trabajo no puede continuar', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.reason).toMatch(/`blocked`/)
    expect(out.reason).toMatch(/no lo escribas en prosa dentro de next_action/i)
    rmSync(dir, { recursive: true, force: true })
  })

  // F7: `parseState` LANZA con un frontmatter roto y aquí se llamaba sin red —
  // el hook reventaba con un stack trace por stderr en CADA cierre de turno de
  // ese repo, sin decir nunca que el problema era el fichero.
  it('STATE.md con el frontmatter roto → no crashea ni escupe stack trace; lo dice y pide arreglarlo', () => {
    const dir = initRepo()
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "sin cerrar\n  ]: [\n---\nx')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    const out = JSON.parse(r.stdout)
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/frontmatter/i)
    expect(out.reason).toMatch(/`blocked`/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('frontmatter roto + stop_hook_active → no bloquea (anti-bucle)', () => {
    const dir = initRepo()
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "sin cerrar\n  ]: [\n---\nx')
    expect(run(dir, true)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin fuga de stderr cuando cwd no es un repo git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, 'sha_viejo')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ===========================================================================
// F12: el guard comparaba `last_commit` con HEAD por IGUALDAD y, al fallar,
// afirmaba «Hay commits más nuevos» — una relación de ancestría que no
// comprobaba nunca. En un repo con dos líneas de trabajo vivas eso era falso
// Y un muro: el bloqueo solo se satisfacía borrando el handoff de la otra.
// ===========================================================================
describe('stop hook — relación entre last_commit y HEAD', () => {
  it('ancestro de HEAD: bloquea, y ahora CUENTA los commits en vez de suponerlos', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    commit(dir, 'c.txt')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/2 commits/)
    expect(out.reason).toMatch(/ancestro de HEAD/)
    expect(out.reason).toMatch(/rama `main`/)
    rmSync(dir, { recursive: true, force: true })
  })

  // EL CASO REAL. Dos ramas divergentes; el STATE.md de la raíz apunta a un
  // commit de la que NO está en el checkout. Ese SHA resuelve (mismo object
  // store) pero jamás será igual a HEAD: antes bloqueaba en CADA turno
  // acusando de commits «más nuevos» que no existían.
  it('ramas divergentes: NO bloquea, no dice "más nuevos", y nombra la rama donde vive el commit', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'polish-v2-geometria')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)

    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/divergentes/)
    expect(out.systemMessage).toMatch(/polish-v2-geometria/)
    expect(out.systemMessage).not.toMatch(/más nuevos/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Un guard que no se puede satisfacer es un muro: el mismo estado, turno
  // tras turno, no puede seguir bloqueando eternamente.
  it('ramas divergentes: el cierre no es un callejón sin salida (dos turnos seguidos, ninguno bloquea)', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'otra')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    for (const _ of [1, 2]) {
      const out = JSON.parse(run(dir))
      expect(out.decision).toBeUndefined()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('el estado va POR DELANTE de HEAD: no bloquea y desaconseja explícitamente reapuntar last_commit', () => {
    const dir = initRepo()
    const base = head(dir)
    git(dir, 'checkout', '-qb', 'adelantada')
    const delante = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    expect(head(dir)).toBe(base)
    writeState(dir, delante)

    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/DESCENDIENTE de HEAD/)
    expect(out.systemMessage).toMatch(/hacia atrás/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('divergente + stop_hook_active: ni bloqueo ni aviso (anti-bucle)', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'otra')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    expect(run(dir, true)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  // El caso real vino de OTRO WORKTREE escribiendo en el STATE.md de la raíz.
  it('worktree: el commit de otro worktree resuelve y se trata como divergente, no como "más nuevo"', () => {
    const dir = initRepo()
    const wt = join(dir, '..', `wt-${Math.random().toString(36).slice(2)}`)
    git(dir, 'worktree', 'add', '-q', '-b', 'rama-worktree', wt)
    const otro = commit(wt, 'w.txt')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/divergentes/)
    expect(out.systemMessage).toMatch(/rama-worktree/)
    git(dir, 'worktree', 'remove', '--force', wt)
    rmSync(dir, { recursive: true, force: true })
  })

  it('SHA que no resuelve: bloquea diciendo que no es un commit de este repo, sin afirmar antigüedad', () => {
    const dir = initRepo()
    writeState(dir, 'sha_viejo')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/no es ningún commit de este repositorio/)
    expect(out.reason).toMatch(/sha_viejo/)
    expect(out.reason).not.toMatch(/más nuevos/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('last_commit vacío o nulo: no bloquea (nada que comparar)', () => {
    for (const linea of ['last_commit:', "last_commit: ''", 'last_commit: "   "']) {
      const dir = initRepo()
      mkdirSync(join(dir, '.agent'), { recursive: true })
      writeFileSync(join(dir, '.agent', 'STATE.md'), `---\n${linea}\n---\nx`)
      expect(run(dir)).toBe('')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('last_commit con pinta de opción de git: se rechaza antes de llegar a git, sin ejecutarla', () => {
    const dir = initRepo()
    writeState(dir, '--output=pwned')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('repo sin ningún commit: sale en silencio, sin stack trace', () => {
    const dir = bareRepo()
    writeState(dir, 'sha_viejo')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect((r.stdout || '').trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('HEAD desprendido: no se inventa una rama, lo dice', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', '--detach', 'HEAD')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/desprendido/)
    expect(out.reason).not.toMatch(/rama `/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('un tag o una rama como last_commit resuelve a su commit (no se trata como ilegible)', () => {
    const dir = initRepo()
    git(dir, 'tag', 'v1')
    writeState(dir, 'v1')
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})
