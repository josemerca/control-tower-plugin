import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { Baseline, BaselineOutcome, ShellBaselineRunner } from '../scripts/baseline.js'

class RealWorktree {
  static #made = []
  static GENEROUS_MS = 30_000
  static TIGHT_MS = 300

  static declaring(command) {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ct-baseline-real-')))
    RealWorktree.#made.push(dir)
    writeFileSync(join(dir, 'AGENTS.md'), `## Build, test & lint\n- test: \`${command}\`\n`)
    return dir
  }

  static measured(dir, timeoutMs = RealWorktree.GENEROUS_MS) {
    return new Baseline({ run: new ShellBaselineRunner({ timeoutMs }).run }).measure(dir)
  }

  static sweep() {
    for (const dir of RealWorktree.#made.splice(0)) rmSyncBestEffort(dir)
  }
}

describe('ShellBaselineRunner', () => {
  afterEach(() => {
    RealWorktree.sweep()
  })

  it('the_declared_line_runs_through_a_shell_inside_the_worktree_so_pipes_and_cwd_behave_as_the_owner_wrote_them', async () => {
    const dir = RealWorktree.declaring('pwd | tr -d "\\n"')

    const result = await RealWorktree.measured(dir)

    expect(result.outcome).toBe(BaselineOutcome.GREEN)
    expect(result.summary).toBe(`exit 0 · ${dir}`)
  })

  it('a_suite_that_fails_comes_back_as_rojo_with_its_exit_code_and_what_it_said_on_stderr', async () => {
    const dir = RealWorktree.declaring('echo "1 test failed" >&2; exit 3')

    const result = await RealWorktree.measured(dir)

    expect(result.outcome).toBe(BaselineOutcome.RED)
    expect(result.summary).toBe('exit 3 · 1 test failed')
  })

  it('a_suite_killed_by_the_cap_is_no_verificado_because_a_half_answer_is_not_an_answer', async () => {
    const dir = RealWorktree.declaring('sleep 30')

    const result = await RealWorktree.measured(dir, RealWorktree.TIGHT_MS)

    expect(result.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(result.command).toBe('sleep 30')
    expect(result.summary).toMatch(/^no terminó · .*ETIMEDOUT/)
  })
})
