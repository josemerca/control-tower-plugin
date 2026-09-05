import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { Baseline, BaselineOutcome, BaselineResult } from '../scripts/baseline.js'

class Worktree {
  static #made = []

  static empty() {
    const dir = mkdtempSync(join(tmpdir(), 'ct-baseline-'))
    Worktree.#made.push(dir)
    return dir
  }

  static declaringInAgents(line) {
    const dir = Worktree.empty()
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n## Build, test & lint\n${line}\n- lint: \`npm run lint\`\n`)
    return dir
  }

  static declaringInConventions(command) {
    const dir = Worktree.empty()
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'conventions.md'), `# La vara\n\ntest: \`${command}\`\n`)
    return dir
  }

  static declaringInBoth({ agents, conventions }) {
    const dir = Worktree.declaringInAgents(`- test: \`${agents}\``)
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'conventions.md'), `test: \`${conventions}\`\n`)
    return dir
  }

  static sweep() {
    for (const dir of Worktree.#made.splice(0)) rmSyncBestEffort(dir)
  }
}

class RunnerDouble {
  constructor(answer) {
    this.answer = answer
    this.asked = []
  }

  get run() {
    return (command, cwd) => {
      this.asked.push({ command, cwd })
      return Promise.resolve(this.answer)
    }
  }

  static green(stdout = ' Tests  12 passed (12)\n Duration  1.2s\n') {
    return new RunnerDouble({ code: 0, stdout, stderr: '' })
  }

  static red(code, stderr) {
    return new RunnerDouble({ code, stdout: '', stderr })
  }

  static notFinished(stderr) {
    return new RunnerDouble({ code: null, stdout: '', stderr })
  }
}

class Measured {
  static of(runner, worktree) {
    return new Baseline({ run: runner.run }).measure(worktree)
  }
}

describe('Baseline', () => {
  afterEach(() => {
    Worktree.sweep()
  })

  it('a_declared_command_that_exits_zero_is_verde_and_the_result_names_the_command_it_ran', async () => {
    const runner = RunnerDouble.green()

    const result = await Measured.of(runner, Worktree.declaringInAgents('- test: `npm test`'))

    expect(result).toBeInstanceOf(BaselineResult)
    expect(result.outcome).toBe(BaselineOutcome.GREEN)
    expect(result.command).toBe('npm test')
  })

  it('the_command_runs_inside_the_worktree_it_was_asked_about_and_nowhere_else', async () => {
    const runner = RunnerDouble.green()
    const worktree = Worktree.declaringInAgents('- test: `npm test`')

    await Measured.of(runner, worktree)

    expect(runner.asked).toEqual([{ command: 'npm test', cwd: worktree }])
  })

  it('a_green_summary_carries_the_exit_code_and_the_last_lines_the_suite_printed', async () => {
    const result = await Measured.of(RunnerDouble.green(), Worktree.declaringInAgents('test: `make test`'))

    expect(result.summary).toBe('exit 0 · Tests  12 passed (12) | Duration  1.2s')
  })

  it('a_non_zero_exit_is_rojo_and_the_summary_quotes_what_the_suite_said', async () => {
    const result = await Measured.of(
      RunnerDouble.red(1, 'FAIL src/a.test.js\n  expected 2 to be 3\n'),
      Worktree.declaringInAgents('- test: `npm test`')
    )

    expect(result.outcome).toBe(BaselineOutcome.RED)
    expect(result.command).toBe('npm test')
    expect(result.summary).toBe('exit 1 · FAIL src/a.test.js | expected 2 to be 3')
  })

  it('a_worktree_that_declares_no_test_command_is_no_verificado_and_nothing_gets_run', async () => {
    const runner = RunnerDouble.green()

    const result = await Measured.of(runner, Worktree.empty())

    expect(result.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(result.command).toBe(null)
    expect(result.summary).toContain('AGENTS.md')
    expect(result.summary).toContain('.agent/conventions.md')
    expect(result.summary).toContain('test: `<comando>`')
    expect(runner.asked).toEqual([])
  })

  it('an_agents_md_whose_test_section_names_no_command_is_no_verificado_too', async () => {
    const runner = RunnerDouble.green()

    const result = await Measured.of(runner, Worktree.declaringInAgents('run the suite before pushing'))

    expect(result.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(runner.asked).toEqual([])
  })

  it('the_declaration_is_read_from_conventions_md_when_agents_md_does_not_carry_one', async () => {
    const runner = RunnerDouble.green()

    const result = await Measured.of(runner, Worktree.declaringInConventions('cargo test'))

    expect(result.outcome).toBe(BaselineOutcome.GREEN)
    expect(result.command).toBe('cargo test')
  })

  it('agents_md_wins_over_conventions_md_when_both_declare_a_command', async () => {
    const result = await Measured.of(
      RunnerDouble.green(),
      Worktree.declaringInBoth({ agents: 'npm test', conventions: 'cargo test' })
    )

    expect(result.command).toBe('npm test')
  })

  it('the_label_is_read_whatever_its_case_and_with_or_without_a_bullet', async () => {
    for (const line of ['Test: `pytest -q`', '* tests: `pytest -q`', '**test**: `pytest -q`']) {
      const result = await Measured.of(RunnerDouble.green(), Worktree.declaringInAgents(line))

      expect(result.command).toBe('pytest -q')
    }
  })

  it('a_run_that_never_finished_is_no_verificado_and_not_rojo_because_nothing_was_measured', async () => {
    const result = await Measured.of(
      RunnerDouble.notFinished('spawnSync sh ETIMEDOUT'),
      Worktree.declaringInAgents('- test: `npm test`')
    )

    expect(result.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(result.command).toBe('npm test')
    expect(result.summary).toContain('ETIMEDOUT')
  })

  it('the_summary_is_capped_so_a_chatty_suite_does_not_flood_the_seed', async () => {
    const chatty = RunnerDouble.green(`${'x'.repeat(1000)}\n`)

    const result = await Measured.of(chatty, Worktree.declaringInAgents('- test: `npm test`'))

    expect(result.summary.length).toBeLessThanOrEqual(Baseline.SUMMARY_MAX_CHARS)
    expect(result.summary.endsWith('…')).toBe(true)
  })

  it('the_seed_field_carries_the_three_facts_as_a_map_the_plugin_reader_parses', async () => {
    const result = await Measured.of(RunnerDouble.green(), Worktree.declaringInAgents('- test: `npm test`'))

    expect(result.seedField).toEqual({
      outcome: 'verde',
      command: 'npm test',
      summary: 'exit 0 · Tests  12 passed (12) | Duration  1.2s',
    })
  })

  it('a_result_nobody_measured_declares_the_absence_instead_of_leaving_the_field_out', () => {
    const result = BaselineResult.notMeasured('dry-run')

    expect(result.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(result.command).toBe(null)
    expect(result.summary).toBe('dry-run')
  })
})
