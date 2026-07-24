import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'stop.js')

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), '1')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'c1'], { cwd: dir })
  return dir
}
function head(dir) { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() }
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
    writeState(dir, 'sha_viejo')
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
  it('sin fuga de stderr cuando cwd no es un repo git', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, 'sha_viejo')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})
