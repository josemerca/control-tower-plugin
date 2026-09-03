import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-harvest.mjs')
const fakeGhDir = join(here, 'fixtures', 'fake-gh-bin')
const fakeBqDir = join(here, 'fixtures', 'fake-bq-bin')

class Bench {
  static ISSUES = [
    { number: 12, title: 'Slice 1', state: 'closed', closedAt: '2026-08-20T10:00:00Z', labels: [{ name: 'type:infra' }], milestone: { title: 'E' }, closedByPullRequestsReferences: [] },
  ]

  static TIMELINE = JSON.stringify([
    { event: 'labeled', label: { name: 'status:ready' }, created_at: '2026-08-20T09:00:00Z' },
    { event: 'labeled', label: { name: 'status:in-progress' }, created_at: '2026-08-20T09:05:00Z' },
    { event: 'labeled', label: { name: 'status:in-review' }, created_at: '2026-08-20T09:50:00Z' },
  ])

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'ct-hv-bq-'))
    this.ghCounterFile = join(this.dir, 'gh-count')
    this.ghArgvLogFile = join(this.dir, 'gh-argv')
    this.bqArgvLogFile = join(this.dir, 'bq-argv')
  }

  env(overrides) {
    return {
      ...process.env,
      PATH: `${fakeGhDir}:${fakeBqDir}:${process.env.PATH}`,
      FAKE_GH_COUNTER_FILE: this.ghCounterFile,
      FAKE_GH_ARGV_LOG_FILE: this.ghArgvLogFile,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([Bench.ISSUES]),
      FAKE_GH_TIMELINE_JSON: Bench.TIMELINE,
      FAKE_BQ_ARGV_LOG_FILE: this.bqArgvLogFile,
      ...overrides,
    }
  }

  run(args, overrides = {}) {
    return spawnSync('node', [script, ...args], { encoding: 'utf8', env: this.env(overrides) })
  }

  githubWasRead() {
    return existsSync(this.ghArgvLogFile)
  }

  bqWasInvoked() {
    return existsSync(this.bqArgvLogFile)
  }

  cleanup() {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

describe('ct-harvest.mjs accepts and validates --bq', () => {
  it('a_malformed_table_id_exits_2_before_reading_github', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'nope'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/--bq inválido/)
    expect(bench.githubWasRead()).toBe(false)
    bench.cleanup()
  })

  it('a_dangling_bq_flag_exits_2_naming_the_missing_value', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/--bq inválido: "\(sin valor\)"/)
    expect(bench.githubWasRead()).toBe(false)
    bench.cleanup()
  })

  it('without_the_flag_bq_is_never_invoked_and_the_harvest_exits_0', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E'])
    expect(result.status).toBe(0)
    expect(bench.bqWasInvoked()).toBe(false)
    bench.cleanup()
  })
})
