import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hermeticEnv } from './fixtures/hermetic-env.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { parseStateSafe } from '../scripts/state.js'
import { BaselineOutcome } from '../scripts/baseline.js'

class Dispatch {
  static #SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-next.mjs')
  static #FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
  static #STUBS = ['fake-git-bin', 'fake-gh-bin', 'fake-cmux-bin', 'fake-claude-bin']
  static #OPEN_ISSUE_42 = { number: 42, title: '#42 algo', labels: [{ name: 'status:ready' }], body: '' }
  static #DRY_RUN_FIXTURE = JSON.stringify({
    issues: [{ n: 2, order: 2, status: 'ready', deps: [1], touches: ['api'], name: 'refresh', type: 'backend' }],
    mergedIssues: [1],
  })
  static #roots = []

  static #root() {
    const root = mkdtempSync(join(tmpdir(), 'ct-next-baseline-'))
    Dispatch.#roots.push(root)
    return root
  }

  static #run(args, environment) {
    const path = [...Dispatch.#STUBS.map((stub) => join(Dispatch.#FIXTURES, stub)), process.env.PATH].join(':')
    const ran = spawnSync('node', [Dispatch.#SCRIPT, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...hermeticEnv(), PATH: path, ...environment },
    })
    return { code: ran.status, stdout: ran.stdout || '', stderr: ran.stderr || '' }
  }

  static ofIssue42({ agentsMd = null } = {}) {
    const root = Dispatch.#root()
    const ran = Dispatch.#run(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: root,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[Dispatch.#OPEN_ISSUE_42], []]),
      FAKE_GH_COUNTER_FILE: join(root, 'gh-list-count'),
      ...(agentsMd === null ? {} : { FAKE_GIT_WORKTREE_ADD_AGENTS_MD: agentsMd }),
    })
    return { ...ran, seed: () => parseStateSafe(readFileSync(join(root, '.worktrees', '42', '.agent', 'SLICE.md'), 'utf8')) }
  }

  static dryRun() {
    return Dispatch.#run(['--repo', 'menoplus-app/menoplus', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: Dispatch.#DRY_RUN_FIXTURE })
  }

  static declaring(command) {
    return `# AGENTS.md\n## Build, test & lint\n- test: \`${command}\`\n`
  }

  static sweep() {
    for (const root of Dispatch.#roots.splice(0)) rmSyncBestEffort(root)
  }
}

describe('ct-next — el baseline lo mide el dispatcher en el worktree y lo siembra en SLICE.md (#96)', () => {
  afterEach(() => {
    Dispatch.sweep()
  })

  it('a_repo_whose_test_command_exits_zero_is_seeded_verde_with_the_command_it_ran', () => {
    const ran = Dispatch.ofIssue42({ agentsMd: Dispatch.declaring('true') })

    expect(ran.code).toBe(0)
    const baseline = ran.seed().meta.baseline
    expect(baseline.outcome).toBe(BaselineOutcome.GREEN)
    expect(baseline.command).toBe('true')
    expect(baseline.summary).toBe('exit 0')
  })

  it('a_red_baseline_warns_on_stderr_and_still_dispatches_because_that_decision_is_the_humans', () => {
    const ran = Dispatch.ofIssue42({ agentsMd: Dispatch.declaring('echo "2 failed" >&2; exit 7') })

    expect(ran.code).toBe(0)
    expect(ran.stdout).toMatch(/lanzado #42/)
    expect(ran.stderr).toMatch(/baseline de #42: rojo/)
    expect(ran.stderr).toMatch(/exit 7 · 2 failed/)
    expect(ran.seed().meta.baseline).toEqual({ outcome: 'rojo', command: 'echo "2 failed" >&2; exit 7', summary: 'exit 7 · 2 failed' })
  })

  it('a_repo_declaring_no_test_command_is_seeded_no_verificado_and_the_warning_says_how_to_declare_one', () => {
    const ran = Dispatch.ofIssue42()

    expect(ran.code).toBe(0)
    expect(ran.stderr).toMatch(/baseline de #42: no-verificado/)
    expect(ran.stderr).toMatch(/test: `<comando>`/)
    const baseline = ran.seed().meta.baseline
    expect(baseline.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(baseline.command).toBe(null)
  })

  it('a_green_baseline_is_not_announced_on_stderr_because_a_warning_that_always_shows_is_never_read', () => {
    const ran = Dispatch.ofIssue42({ agentsMd: Dispatch.declaring('true') })

    expect(ran.stderr).not.toMatch(/baseline de #42/)
  })

  it('the_dry_run_seed_declares_the_baseline_unmeasured_instead_of_pretending_a_worktree_it_never_cut', () => {
    const ran = Dispatch.dryRun()

    expect(ran.code).toBe(0)
    expect(ran.stdout).toMatch(/^baseline:$/m)
    expect(ran.stdout).toMatch(/outcome: no-verificado/)
    expect(ran.stdout).toMatch(/dry-run/)
  })
})
