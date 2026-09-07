import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'judge-bench.mjs')
const AGENT = join(here, '..', 'agents', 'ct-judge.md')
const FAKE_CLAUDE = join(here, 'fixtures', 'fake-claude-bin')

class BenchProcess {
  static run(...args) {
    return spawnSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${FAKE_CLAUDE}:${process.env.PATH}` },
    })
  }

  static commandsIn(stdout) {
    return stdout
      .split(/^# /m)
      .slice(1)
      .map((block) => `# ${block}`.trimEnd())
  }
}

describe('judge-bench.mjs --dry-run', () => {
  it('prints one runnable claude command per case and run, and launches nothing', () => {
    const r = BenchProcess.run('--agent', AGENT, '--dry-run', '--runs', '2', '--case', 'tarea-correcta')
    expect(r.status).toBe(0)
    const commands = BenchProcess.commandsIn(r.stdout)
    expect(commands).toHaveLength(2)
    expect(commands.map((command) => command.split('\n')[0])).toEqual(['# tarea-correcta #1', '# tarea-correcta #2'])
    for (const command of commands) {
      expect(command).toMatch(/\ncd '[^']+\/tarea-correcta\/[12]' && claude '-p' /)
      expect(command).toContain("'--output-format' 'json'")
      expect(command).toContain("'--strict-mcp-config'")
      expect(command).toContain("'--agent' 'ct-judge'")
    }
    expect(r.stderr).toContain('dry-run: 1 caso(s) × 2 run(s) preparados en')
    expect(r.stderr).not.toContain('fake-claude')
  })

  it('without --agent it is a usage error', () => {
    const r = BenchProcess.run('--dry-run')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('falta --agent')
  })

  it('a case that does not exist is a precondition failure that names the cases there are', () => {
    const r = BenchProcess.run('--agent', AGENT, '--dry-run', '--case', 'nope')
    expect(r.status).toBe(3)
    expect(r.stderr).toContain('no bench case is named "nope"')
  })

  it('an agent file that cannot be read is a precondition failure', () => {
    const r = BenchProcess.run('--agent', join(here, 'nope.md'), '--dry-run')
    expect(r.status).toBe(3)
    expect(r.stderr).toContain('no se puede montar el banco')
  })
})
