import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeCmuxDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-cmux-bin')

const gitEn = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// bancada: un checkout git DE VERDAD con su worktree `.worktrees/7` y su rama
// `feat/7`, porque lo que este fichero comprueba es justo lo que un stub de
// git no puede decir — que tras la cosecha el worktree y la rama YA NO
// EXISTEN. `realpathSync` no es cosmético: en macOS `tmpdir()` es un symlink
// (/var → /private/var) y git reporta SIEMPRE la ruta resuelta, así que el
// `current_directory` que se le enseña a cmux tiene que ser la resuelta o
// `findWorkspaceByCwd` no casaría con la que calcula `localSliceArtifacts`.
function bancada({ conWorktree = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ct-collect-')))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: ['ignore', 'ignore', 'pipe'] })
  gitEn(repo, 'commit', '--allow-empty', '-q', '-m', 'base')
  const worktree = join(repo, '.worktrees', '7')
  if (conWorktree) gitEn(repo, 'worktree', 'add', '-q', '-b', 'feat/7', worktree)
  const b = {
    dir,
    repo,
    worktree,
    stateFile: join(dir, 'cmux-state.json'),
    invokedLog: join(dir, 'cmux-invoked.log'),
    ghArgvLog: join(dir, 'gh-argv.log'),
    tip: conWorktree ? gitEn(repo, 'rev-parse', 'feat/7').trim() : null,
  }
  writeFileSync(b.stateFile, JSON.stringify(conWorktree ? [{ title: 'o/r · #7 slice', cwd: worktree }] : []))
  return b
}

const correr = (b, env = {}, args = ['7', '--repo', 'o/r', '--collect']) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  cwd: b.repo,
  env: {
    ...process.env,
    PATH: `${fakeGhDir}:${fakeCmuxDir}:${process.env.PATH}`,
    FAKE_CMUX_STATE_FILE: b.stateFile,
    FAKE_CMUX_INVOKED_LOG_FILE: b.invokedLog,
    FAKE_GH_ARGV_LOG_FILE: b.ghArgvLog,
    ...env,
  },
})

const limpiar = (b) => rmSync(b.dir, { recursive: true, force: true })
const prList = (state, headRefOid) => JSON.stringify([{ headRefOid, number: 71, state }])
const ramas = (b) => gitEn(b.repo, 'branch', '--list', 'feat/7').trim()
const invocaciones = (b) => (existsSync(b.invokedLog) ? readFileSync(b.invokedLog, 'utf8') : '')
const sesiones = (b) => JSON.parse(readFileSync(b.stateFile, 'utf8'))
const OTRA_PUNTA = '1122334455667788990011223344556677889900'

describe('dispatch-check --collect — la cosecha', () => {
  it('una PR mergeada con el árbol limpio y la punta que aterrizó: cierra cmux, borra worktree y rama, exit 0', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`collected #7: cerrada la workspace de cmux, borrado el worktree ${b.worktree}, borrada la rama feat/7`)
    // git de verdad lo dice: el worktree y la rama ya no están.
    expect(existsSync(b.worktree)).toBe(false)
    expect(ramas(b)).toBe('')
    expect(invocaciones(b)).toContain('close-workspace --workspace workspace:0')
    expect(sesiones(b)).toEqual([])
    limpiar(b)
  })

  it('el argv de gh lleva el --repo pedido y la rama del slice, con los tres campos que el lector consume', () => {
    const b = bancada()
    correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(readFileSync(b.ghArgvLog, 'utf8').trim())
      .toBe('pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10')
    limpiar(b)
  })

  it('la PR sigue abierta: exit 1, lo dice con su estado y no toca nada', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('OPEN', OTRA_PUNTA) })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe('waiting on #7 (open): la PR #71 sigue abierta — no se ha tocado nada')
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(invocaciones(b)).toBe('')
    limpiar(b)
  })

  it('la PR se cerró sin mergear: exit 1 y tampoco borra nada', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('CLOSED', OTRA_PUNTA) })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe('waiting on #7 (abandoned): la PR #71 se cerró sin mergear — no se ha tocado nada')
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })

  it('no hay ninguna PR para la rama: exit 1 nombrando que no la hay', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: '[]' })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe('waiting on #7 (not-opened): no hay ninguna PR para la rama feat/7 — no se ha tocado nada')
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })

  it('el árbol tiene un fichero sin trackear: exit 10, conserva todo y dice por qué', () => {
    const b = bancada()
    writeFileSync(join(b.worktree, 'sin-commitear.txt'), 'trabajo vivo\n')
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(res.status).toBe(10)
    expect(res.stdout.trim()).toBe(`kept #7: el worktree ${b.worktree} tiene cambios sin commitear — no se ha borrado nada`)
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(invocaciones(b)).toBe('')
    limpiar(b)
  })

  it('la punta local no es la que mergeó la PR: exit 10 y nombra el commit que sí lo era', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', OTRA_PUNTA) })
    expect(res.status).toBe(10)
    expect(res.stdout.trim()).toBe(`kept #7: la punta local de feat/7 no es el commit que mergeó la PR #71 (${OTRA_PUNTA}) — no se ha borrado nada`)
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })

  it('gh no contesta: exit 3, nada mutado y el diagnóstico va a stderr', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST_FAIL: '1' })
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('no se pudo leer el estado de #7: gh pr list falló')
    expect(res.stdout).toBe('')
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    limpiar(b)
  })

  it('cmux no concluyente: exit 3 sin haber borrado nada, aunque la PR esté mergeada', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip), FAKE_CMUX_LIST_WINDOWS_FAIL: '1' })
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('no se pudo leer el estado de #7: cmux workspace list falló')
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(invocaciones(b)).not.toContain('close-workspace')
    limpiar(b)
  })

  it('cmux contesta y no hay ninguna workspace en ese worktree: cosecha git y no inventa un cierre', () => {
    const b = bancada()
    writeFileSync(b.stateFile, JSON.stringify([{ title: 'otra cosa', cwd: join(b.dir, 'otro-sitio') }]))
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`collected #7: borrado el worktree ${b.worktree}, borrada la rama feat/7`)
    expect(existsSync(b.worktree)).toBe(false)
    expect(invocaciones(b)).not.toContain('close-workspace')
    limpiar(b)
  })

  it('el cierre de cmux falla tras nada y los borrados sí ocurren: exit 4 con el comando que queda, sin encadenar', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip), FAKE_CMUX_CLOSE_FAIL: '1' })
    expect(res.status).toBe(4)
    expect(res.stderr).toContain('ATENCIÓN: cosecha a medias de #7')
    expect(res.stderr).toContain('cmux close-workspace --workspace workspace:0')
    expect(res.stderr).not.toContain('&&')
    expect(existsSync(b.worktree)).toBe(false)
    expect(ramas(b)).toBe('')
    limpiar(b)
  })

  it('--dry-run imprime los comandos exactos y deja el worktree, la rama y la sesión en su sitio', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) }, ['7', '--repo', 'o/r', '--collect', '--dry-run'])
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`dry-run: would collect #7: cmux close-workspace --workspace workspace:0 ; git -C ${b.repo} worktree remove --force ${b.worktree} ; git -C ${b.repo} branch -D feat/7`)
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(sesiones(b)).toHaveLength(1)
    expect(invocaciones(b)).not.toContain('close-workspace')
    limpiar(b)
  })

  it('no queda nada en disco: exit 0 diciendo que no había nada que recoger', () => {
    const b = bancada({ conWorktree: false })
    const res = correr(b, { FAKE_GH_PR_LIST: '[]' })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`nothing left for #7: en ${b.repo} ya no queda ni el worktree .worktrees/7 ni la rama feat/7`)
    limpiar(b)
  })

  it('invocado fuera de un checkout git: exit 3, porque no se declara ausente lo que no se ha podido mirar', () => {
    const b = bancada()
    const res = spawnSync('node', [script, '7', '--repo', 'o/r', '--collect'], {
      encoding: 'utf8',
      cwd: b.dir,
      env: { ...process.env, PATH: `${fakeGhDir}:${fakeCmuxDir}:${process.env.PATH}`, GIT_CEILING_DIRECTORIES: b.dir },
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('no se ha podido comprobar qué queda de #7 en esta máquina')
    limpiar(b)
  })

  it('--collect con --requeue: exit 2, son mutuamente excluyentes', () => {
    const b = bancada()
    const res = correr(b, {}, ['7', '--repo', 'o/r', '--collect', '--requeue'])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('--requeue y --collect son mutuamente excluyentes')
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })
})
