import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'dispatch-check.mjs')
const fakeGhDir = join(here, 'fixtures', 'fake-gh-bin')
const fakeCmuxDir = join(here, 'fixtures', 'fake-cmux-bin')
const fakeBqDir = join(here, 'fixtures', 'fake-bq-bin')

class Bench {
  static ISSUE = 7
  static REPO = 'o/r'
  static PULL_REQUEST_NUMBER = 71
  static MALFORMED_TABLE = 'nope'
  static TABLE_ID = 'p:d.t'

  static gitRun(repo, args) {
    return execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  }

  static mergedPullRequestList(headRefOid) {
    return JSON.stringify([{ headRefOid, number: Bench.PULL_REQUEST_NUMBER, state: 'MERGED' }])
  }

  constructor() {
    this.dir = realpathSync(mkdtempSync(join(tmpdir(), 'ct-collect-bq-')))
    this.repo = join(this.dir, 'repo')
    mkdirSync(this.repo)
    execFileSync('git', ['-C', this.repo, 'init', '-q'], { stdio: ['ignore', 'ignore', 'pipe'] })
    Bench.gitRun(this.repo, ['commit', '--allow-empty', '-q', '-m', 'base'])
    this.worktree = join(this.repo, '.worktrees', String(Bench.ISSUE))
    Bench.gitRun(this.repo, ['worktree', 'add', '-q', '-b', `feat/${Bench.ISSUE}`, this.worktree])
    this.tip = Bench.gitRun(this.repo, ['rev-parse', `feat/${Bench.ISSUE}`]).trim()
    this.stateFile = join(this.dir, 'cmux-state.json')
    this.invokedLog = join(this.dir, 'cmux-invoked.log')
    this.ghArgvLog = join(this.dir, 'gh-argv.log')
    this.bqArgvLog = join(this.dir, 'bq-argv.log')
    writeFileSync(this.stateFile, JSON.stringify([{ title: `o/r · #${Bench.ISSUE} slice`, cwd: this.worktree }]))
  }

  branchStillExists() {
    return Bench.gitRun(this.repo, ['branch', '--list', `feat/${Bench.ISSUE}`]).trim().length > 0
  }

  ghArgvLines() {
    return existsSync(this.ghArgvLog) ? readFileSync(this.ghArgvLog, 'utf8').trim().split('\n').filter(Boolean) : []
  }

  bqWasInvoked() {
    return existsSync(this.bqArgvLog)
  }

  run(args, overrides = {}) {
    return spawnSync('node', [script, ...args], {
      encoding: 'utf8',
      cwd: this.repo,
      env: {
        ...process.env,
        PATH: `${fakeGhDir}:${fakeCmuxDir}:${fakeBqDir}:${process.env.PATH}`,
        FAKE_CMUX_STATE_FILE: this.stateFile,
        FAKE_CMUX_INVOKED_LOG_FILE: this.invokedLog,
        FAKE_GH_ARGV_LOG_FILE: this.ghArgvLog,
        FAKE_BQ_ARGV_LOG_FILE: this.bqArgvLog,
        ...overrides,
      },
    })
  }

  cleanup() {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

describe('dispatch-check --collect accepts, validates and announces --bq', () => {
  it('a_malformed_table_exits_2_before_any_gh_call', () => {
    const bench = new Bench()
    const result = bench.run(['7', '--repo', Bench.REPO, '--collect', '--bq', Bench.MALFORMED_TABLE])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/--bq inválido/)
    expect(existsSync(bench.ghArgvLog)).toBe(false)
    bench.cleanup()
  })

  it('without_the_flag_the_gh_argv_is_exactly_the_one_pull_request_list_of_today', () => {
    const bench = new Bench()
    const result = bench.run(['7', '--repo', Bench.REPO, '--collect'], { FAKE_GH_PR_LIST: Bench.mergedPullRequestList(bench.tip) })
    expect(result.status).toBe(0)
    expect(bench.ghArgvLines()).toEqual([`pr list --repo ${Bench.REPO} --head feat/${Bench.ISSUE} --state all --json number,state,headRefOid --limit 10`])
    expect(bench.bqWasInvoked()).toBe(false)
    bench.cleanup()
  })

  it('a_dry_run_with_the_flag_calls_neither_gh_beyond_today_nor_bq_and_says_it_would_load', () => {
    const bench = new Bench()
    const result = bench.run(['7', '--repo', Bench.REPO, '--collect', '--dry-run', '--bq', Bench.TABLE_ID], { FAKE_GH_PR_LIST: Bench.mergedPullRequestList(bench.tip) })
    expect(result.status).toBe(0)
    expect(result.stdout.trim().endsWith(`; y cargaría 1 fila en ${Bench.TABLE_ID}`)).toBe(true)
    expect(bench.ghArgvLines()).toEqual([`pr list --repo ${Bench.REPO} --head feat/${Bench.ISSUE} --state all --json number,state,headRefOid --limit 10`])
    expect(bench.bqWasInvoked()).toBe(false)
    expect(existsSync(bench.worktree)).toBe(true)
    expect(bench.branchStillExists()).toBe(true)
    bench.cleanup()
  })
})
