import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
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
    expect(out.systemMessage).toMatch(/descendiente de HEAD/)
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

  // El aviso sale en CADA turno mientras dure la anomalía (a propósito: es la
  // presión visible sobre un problema estructural que alguien tiene que
  // resolver). Ese precio se paga siendo corto.
  it('el aviso de divergencia es breve: solo lo que cambia una decisión', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'polish-v2-geometria')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    const msg = JSON.parse(run(dir)).systemMessage
    expect(msg.length).toBeLessThan(340)
    // Lo que tiene que seguir estando: dónde vive, que divergen, y el precio
    // de la acción obvia.
    expect(msg).toMatch(/polish-v2-geometria/)
    expect(msg).toMatch(/divergentes/)
    expect(msg).toMatch(/sustituyes el de la otra/)
    // Lo que sobra: explicar por qué el guard no bloquea, en cada turno.
    expect(msg).not.toMatch(/pisándose por turnos/)
    expect(msg).not.toMatch(/NO se bloquea el cierre/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el aviso de "va por delante" también es breve', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'adelantada')
    const delante = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    writeState(dir, delante)
    const msg = JSON.parse(run(dir)).systemMessage
    expect(msg.length).toBeLessThan(280)
    expect(msg).toMatch(/hacia atrás/)
    expect(msg).not.toMatch(/No se bloquea el cierre/)
    rmSync(dir, { recursive: true, force: true })
  })

  // `reset --hard` que se lleva por delante el commit que el STATE.md
  // describe: el estado apunta a trabajo que ya no existe en ningún ref.
  it('commit huérfano tras reset --hard: aviso propio, distinto del de "va por delante", y NO bloquea', () => {
    const dir = initRepo()
    const huerfano = commit(dir, 'b.txt')
    git(dir, 'reset', '-q', '--hard', 'HEAD~1')
    writeState(dir, huerfano)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/huérfano/)
    expect(out.systemMessage).toMatch(/ni local ni remota/)
    expect(out.systemMessage).toMatch(/git gc/)
    // No es el mensaje de `ahead`: aquí no hay ningún handoff que proteger.
    expect(out.systemMessage).not.toMatch(/va por delante/)
    expect(out.systemMessage).not.toMatch(/hacia atrás/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rama divergente borrada: el commit queda huérfano y cae en ese aviso, no en el de divergencia', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'efimera')
    const huerfano = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    git(dir, 'branch', '-qD', 'efimera')
    writeState(dir, huerfano)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/huérfano/)
    expect(out.systemMessage).not.toMatch(/divergentes/)
    rmSync(dir, { recursive: true, force: true })
  })

  // «Vive en `origin/polish-v2`» es mucho más útil que «no sé dónde está».
  it('sin rama local que lo contenga, se mira en las remotas y se nombra origin/…', () => {
    const origen = initRepo()
    git(origen, 'checkout', '-qb', 'polish-v2')
    const otro = commit(origen, 'b.txt')
    git(origen, 'checkout', '-q', 'main')

    const clon = mkdtempSync(join(tmpdir(), 'ct-clon-'))
    execFileSync('git', ['clone', '-q', origen, clon], { encoding: 'utf8' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: clon })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: clon })
    commit(clon, 'c.txt')
    // En el clon no hay ninguna rama LOCAL que contenga ese commit.
    expect(git(clon, 'branch', '--contains', otro, '--format=%(refname:short)')).toBe('')
    writeState(clon, otro)

    const out = JSON.parse(run(clon))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/`origin\/polish-v2`/)
    expect(out.systemMessage).toMatch(/divergentes/)
    expect(out.systemMessage).not.toMatch(/huérfano/)
    rmSync(clon, { recursive: true, force: true })
    rmSync(origen, { recursive: true, force: true })
  })

  it('con rama local que lo contenga, no se cuela el ruido de origin/*', () => {
    const origen = initRepo()
    const clon = mkdtempSync(join(tmpdir(), 'ct-clon-'))
    execFileSync('git', ['clone', '-q', origen, clon], { encoding: 'utf8' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: clon })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: clon })
    git(clon, 'checkout', '-qb', 'local-viva')
    const otro = commit(clon, 'b.txt')
    git(clon, 'checkout', '-q', 'main')
    commit(clon, 'c.txt')
    writeState(clon, otro)

    const msg = JSON.parse(run(clon)).systemMessage
    expect(msg).toMatch(/`local-viva`/)
    expect(msg).not.toMatch(/origin\//)
    rmSync(clon, { recursive: true, force: true })
    rmSync(origen, { recursive: true, force: true })
  })

  it('un tag o una rama como last_commit resuelve a su commit (no se trata como ilegible)', () => {
    const dir = initRepo()
    git(dir, 'tag', 'v1')
    writeState(dir, 'v1')
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F15/H4 — EL CHEQUEO DE FRESCURA ERA INSATISFACIBLE POR CONSTRUCCIÓN.
//
// El commit que actualiza STATE.md incluye a STATE.md, así que obedecer el
// guard crea el commit que lo vuelve a invalidar. Reproducido contra el
// dist/stop.js de dac5326, dos vueltas seguidas:
//   HEAD=2926a17 last_commit=192baa2 → block "hay 1 commit … por encima"
//   HEAD=3346b8e last_commit=2926a17 → block "hay 1 commit … por encima"
// ============================================================================

// commitState: escribe last_commit y COMMITEA ese cambio — es decir, hace
// exactamente lo que el guard pide, incluido el commit que lo reintroducía.
function commitState(dir, sha) {
  writeState(dir, sha)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'chore(state): apunte'], { cwd: dir })
  return head(dir)
}

describe('F15/H4 — obedecer el guard de frescura tiene que dejarlo verde', () => {
  it('actualizar y commitear STATE.md deja el guard EN SILENCIO (antes: block, infinitamente)', () => {
    const dir = initRepo()
    commit(dir, 'b.txt')
    commitState(dir, head(dir))
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('y la segunda vuelta también: no hay regresión que se reintroduzca sola', () => {
    const dir = initRepo()
    commit(dir, 'b.txt')
    commitState(dir, head(dir))
    commitState(dir, head(dir)) // dos apuntes seguidos, sin trabajo por medio
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  // LO QUE NO SE PUEDE PERDER (1): trabajo real sin registrar sigue bloqueando.
  it('un commit de CÓDIGO sin actualizar STATE.md sigue bloqueando, con su conteo', () => {
    const dir = initRepo()
    commitState(dir, head(dir))
    commit(dir, 'c.txt')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/1 commit de trabajo/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el conteo separa trabajo de apuntes en vez de mezclarlos', () => {
    const dir = initRepo()
    const base = head(dir)
    commitState(dir, base)      // apunte (no cuenta)
    commit(dir, 'c.txt')        // trabajo
    commit(dir, 'd.txt')        // trabajo
    writeState(dir, base)       // el estado se queda en el commit base
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/2 commits de trabajo/)
    expect(out.reason).toMatch(/1 commit que solo toca/)
    rmSync(dir, { recursive: true, force: true })
  })

  // LO QUE NO SE PUEDE PERDER (2): el agujero obvio del arreglo. Si bastara
  // con que el commit TOQUE STATE.md, se colaría trabajo real sin registrar
  // metiéndolo en el mismo commit que el apunte.
  it('un commit que toca STATE.md Y ADEMÁS código SÍ cuenta como trabajo', () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), `---\nlast_commit: ${base}\n---\nx`)
    writeFileSync(join(dir, 'code.txt'), 'trabajo de verdad')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'apunte + código'], { cwd: dir })
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/1 commit de trabajo/)
    rmSync(dir, { recursive: true, force: true })
  })

  // FAIL CLOSED: un merge no lista ficheros en `git log --name-only`, y puede
  // traer trabajo de verdad. Cuenta como trabajo, no como apunte.
  it('un merge (sin ficheros listados) cuenta como trabajo, no como apunte', () => {
    const dir = initRepo()
    const base = head(dir)
    git(dir, 'checkout', '-q', '-b', 'side')
    commit(dir, 'side.txt')
    git(dir, 'checkout', '-q', 'main')
    writeState(dir, base)
    git(dir, 'merge', '-q', '--no-ff', 'side', '-m', 'merge')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    rmSync(dir, { recursive: true, force: true })
  })

  // El hermano que arrastraba el mismo defecto: `unresolvable` bloquea y su
  // remedio ("pon el SHA real") terminaba, antes de F15, en el mismo bucle en
  // cuanto commiteabas el arreglo.
  it('el remedio de `unresolvable` (poner el SHA real y commitearlo) ahora TERMINA', () => {
    const dir = initRepo()
    writeState(dir, 'relleno-que-no-es-un-sha')
    const bloqueado = JSON.parse(run(dir))
    expect(bloqueado.decision).toBe('block')
    expect(bloqueado.reason).toMatch(/no es ningún commit de este repositorio/)
    commitState(dir, head(dir))
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ===========================================================================
// #95/H5 — EL AGENTE NO COMITEÓ, PERO HEAD AVANZÓ: EL PROGRAMA SABE EL SHA.
//
// En el camino `ct-step`, quien comitea es el PROGRAMA. El agente no tocó
// `last_commit` porque no hizo ningún commit, y el guard le bloqueaba el turno
// pidiéndole que copiase un valor que el propio hook ya tiene en la mano
// (`headSha`). Cuando los commits por encima llevan el trailer que `ct-step`
// escribe, el hook los reconoce como suyos, actualiza el fichero de estado él
// mismo y deja cerrar. Lo que no puede atribuir sigue bloqueando.
// ===========================================================================
function ctStepCommit(dir, name) {
  writeFileSync(join(dir, name), name)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', `${name} (#42, tarea 1/3)\n\nTarea 1 de 3 del plan del slice.\n\nCommitted-By: ct-step`], { cwd: dir })
  return head(dir)
}
function lastCommitOf(dir, rel = '.agent/STATE.md') {
  return /^last_commit:\s*(.*)$/m.exec(readFileSync(join(dir, rel), 'utf8'))[1].trim()
}

describe('#95 — los commits que hizo ct-step no bloquean el cierre del turno', () => {
  it('tras un ct-step commit el cierre NO bloquea y el fichero de estado queda con el sha de HEAD', () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    const nuevo = ctStepCommit(dir, 'b.txt')
    const out = run(dir)
    expect(out).toBe('')
    expect(lastCommitOf(dir)).toBe(nuevo)
    rmSync(dir, { recursive: true, force: true })
  })

  it('varios commits seguidos de ct-step se atribuyen todos y el estado salta al último', () => {
    const dir = initRepo()
    writeState(dir, head(dir))
    ctStepCommit(dir, 'b.txt')
    const ultimo = ctStepCommit(dir, 'c.txt')
    expect(run(dir)).toBe('')
    expect(lastCommitOf(dir)).toBe(ultimo)
    rmSync(dir, { recursive: true, force: true })
  })

  // LO QUE NO SE PUEDE PERDER: un commit que ct-step NO hizo sigue bloqueando,
  // aunque venga acompañado de otros que sí.
  it('un commit sin el trailer entre los de ct-step devuelve el bloqueo y NO toca el fichero', () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    ctStepCommit(dir, 'b.txt')
    commit(dir, 'a-mano.txt')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(lastCommitOf(dir)).toBe(base)
    rmSync(dir, { recursive: true, force: true })
  })

  it('un commit hecho a mano, sin ningún trailer, sigue bloqueando igual que antes', () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    commit(dir, 'a-mano.txt')
    expect(JSON.parse(run(dir)).decision).toBe('block')
    expect(lastCommitOf(dir)).toBe(base)
    rmSync(dir, { recursive: true, force: true })
  })

  // La precedencia de state-paths: en un worktree de slice el fichero que se
  // escribe es SLICE.md, que es el que el hook leyó — nunca el STATE.md
  // trackeado de la coordinadora.
  it('en un worktree de slice se escribe SLICE.md, y el STATE.md de la coordinadora no se toca', () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\nlast_commit: intacto\n---\nc')
    writeFileSync(join(dir, '.agent', 'SLICE.md'), `---\nlast_commit: ${base}\n---\ns`)
    const nuevo = ctStepCommit(dir, 'b.txt')
    expect(run(dir)).toBe('')
    expect(lastCommitOf(dir, '.agent/SLICE.md')).toBe(nuevo)
    expect(lastCommitOf(dir, '.agent/STATE.md')).toBe('intacto')
    rmSync(dir, { recursive: true, force: true })
  })

  // El resto del fichero es del agente: comentarios, campos que este hook no
  // conoce y el cuerpo en prosa. Se reescribe UNA línea, no se re-serializa.
  it('solo cambia la línea de last_commit: los comentarios, los campos ajenos y el cuerpo quedan intactos', () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    const antes = [
      '---',
      '# un comentario que explica el campo',
      'task: "algo"',
      `last_commit: ${base}`,
      'baseline: "un campo que este hook no conoce"',
      '---',
      '## Current State',
      'prosa del agente',
      '',
    ].join('\n')
    writeFileSync(join(dir, '.agent', 'STATE.md'), antes)
    const nuevo = ctStepCommit(dir, 'b.txt')
    expect(run(dir)).toBe('')
    const despues = readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')
    expect(despues).toBe(antes.replace(base, nuevo))
    rmSync(dir, { recursive: true, force: true })
  })

  // El valor entrecomillado es la forma que escribe `buildStateSeed`: se
  // reescribe el VALOR, no la línea entera, y las comillas siguen ahí.
  it('un last_commit entrecomillado conserva sus comillas al actualizarse', () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), `---\nlast_commit: "${base}"\n---\nx`)
    const nuevo = ctStepCommit(dir, 'b.txt')
    expect(run(dir)).toBe('')
    expect(readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')).toContain(`last_commit: "${nuevo}"`)
    rmSync(dir, { recursive: true, force: true })
  })

  it('con stop_hook_active no se escribe nada (anti-bucle)', () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    ctStepCommit(dir, 'b.txt')
    expect(run(dir, true)).toBe('')
    expect(lastCommitOf(dir)).toBe(base)
    rmSync(dir, { recursive: true, force: true })
  })
})
