import { describe, it, expect } from 'vitest'
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
  it('what_the_tool_prints_is_what_the_caller_gets_back', async () => {
    expect(await Node.running(30_000).run(['-e', 'process.stdout.write("printed")'])).toBe('printed')
  })

  it('a_tool_that_outlives_its_budget_is_killed_instead_of_holding_the_request_open', async () => {
    const started = Date.now()

    const refusal = await Node.running(250).run(Node.sleeping()).catch((cause) => cause)

    expect(refusal.message).toContain('failed')
    expect(Date.now() - started).toBeLessThan(Node.SLOW_MS)
  })

  it('what_the_tool_said_on_the_error_channel_survives_into_the_reason', async () => {
    const refusal = await Node.running(30_000)
      .run(['-e', 'process.stderr.write("no such work item"); process.exit(1)'])
      .catch((cause) => cause)

    expect(refusal.message).toBe(`${process.execPath} -e failed: no such work item`)
  })

  it('a_tool_that_is_not_installed_names_itself_so_the_reason_is_not_a_bare_enoent', async () => {
    const refusal = await new ToolRunner({ bin: 'ct-no-such-tool', budgetMs: 30_000 })
      .run(['whatever'])
      .catch((cause) => cause)

    expect(refusal.message).toContain('ct-no-such-tool whatever failed')
  })

  it('a_runner_without_a_budget_cannot_be_built_because_no_call_goes_out_uncapped', () => {
    expect(() => new ToolRunner({ bin: 'gh' })).toThrow(/needs a budget in milliseconds/)
    expect(() => new ToolRunner({ bin: 'gh', budgetMs: 0 })).toThrow(/needs a budget in milliseconds/)
  })
})
