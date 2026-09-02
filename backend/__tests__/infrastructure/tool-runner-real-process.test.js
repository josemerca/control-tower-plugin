import { describe, it, expect } from 'vitest'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ToolRunner } from '../../src/infrastructure/tool-runner.js'

class Node {
  static SLOW_MS = 5_000

  static running(budgetMs) {
    return new ToolRunner({ bin: process.execPath, budgetMs })
  }

  static sleeping() {
    return ['-e', `setTimeout(() => {}, ${Node.SLOW_MS})`]
  }
}

describe('ToolRunner', () => {
  it('what_the_tool_prints_comes_back_with_the_code_that_says_it_went_well', async () => {
    const output = await Node.running(30_000).run(['-e', 'process.stdout.write("printed")'])

    expect(output.stdout).toBe('printed')
    expect(output.code).toBe(0)
    expect(output.failed).toBe(false)
  })

  it('a_tool_that_outlives_its_budget_is_killed_instead_of_holding_the_request_open', async () => {
    const started = Date.now()

    const output = await Node.running(250).run(Node.sleeping())

    expect(output.failed).toBe(true)
    expect(Date.now() - started).toBeLessThan(Node.SLOW_MS)
  })

  it('a_tool_that_refuses_is_a_code_and_a_reason_and_not_something_thrown_at_the_caller', async () => {
    const output = await Node.running(30_000)
      .run(['-e', 'process.stderr.write("no such work item"); process.exit(3)'])

    expect(output.code).toBe(3)
    expect(output.stderr).toBe('no such work item')
  })

  it('what_the_tool_printed_before_refusing_is_kept_because_the_adapter_may_have_to_read_it', async () => {
    const output = await Node.running(30_000)
      .run(['-e', 'process.stdout.write("half an answer"); process.exit(1)'])

    expect(output.stdout).toBe('half an answer')
    expect(output.failed).toBe(true)
  })

  it('a_tool_that_is_not_installed_is_a_refusal_with_a_reason_and_not_an_empty_channel', async () => {
    const output = await new ToolRunner({ bin: 'ct-no-such-tool', budgetMs: 30_000 }).run(['whatever'])

    expect(output.failed).toBe(true)
    expect(output.stderr).toContain('ct-no-such-tool')
  })

  it('the_directory_the_caller_names_is_where_the_tool_runs_and_not_where_the_api_was_started', async () => {
    const elsewhere = realpathSync(tmpdir())

    const output = await Node.running(30_000)
      .run(['-e', 'process.stdout.write(process.cwd())'], { cwd: elsewhere })

    expect(output.stdout).toBe(elsewhere)
    expect(output.stdout).not.toBe(process.cwd())
  })

  it('a_call_that_names_no_directory_still_runs_where_the_api_was_started', async () => {
    const output = await Node.running(30_000).run(['-e', 'process.stdout.write(process.cwd())'])

    expect(output.stdout).toBe(process.cwd())
  })

  it('a_runner_without_a_budget_cannot_be_built_because_no_call_goes_out_uncapped', () => {
    expect(() => new ToolRunner({ bin: 'gh' })).toThrow(/needs a budget in milliseconds/)
    expect(() => new ToolRunner({ bin: 'gh', budgetMs: 0 })).toThrow(/needs a budget in milliseconds/)
  })
})
