import { describe, it, expect } from 'vitest'
import { CmuxPlanSession } from '../src/cmux-plan-session.js'

class CmuxDouble {
  constructor(printed) {
    this.printed = printed
    this.calls = []
  }

  session() {
    return new CmuxPlanSession({
      run: (argv) => {
        this.calls.push(argv)
        if (this.printed instanceof Error) return Promise.reject(this.printed)
        return Promise.resolve(this.printed)
      },
    })
  }
}

describe('CmuxPlanSession', () => {
  it('the_workspace_it_asks_for_is_named_after_the_ticket_so_a_human_can_find_it_among_tabs', () => {
    const argv = CmuxPlanSession.argvFor('ABC-123', '/repo')

    expect(argv).toEqual([
      'new-workspace',
      '--name', 'ct-plan-ABC-123',
      '--cwd', '/repo',
      '--command', 'echo "plan session up for ABC-123"',
    ])
  })

  it('the_handle_cmux_prints_is_what_comes_back_so_the_caller_can_reach_the_session_later', async () => {
    const cmux = new CmuxDouble('OK workspace:4\n')

    expect(await cmux.session().start('ABC-123')).toBe('workspace:4')
  })

  it('the_notice_cmux_prints_before_the_handle_does_not_get_mistaken_for_one', async () => {
    const cmux = new CmuxDouble("cmux: 'new-workspace' is now an alias\nOK workspace:12\n")

    expect(await cmux.session().start('ABC-123')).toBe('workspace:12')
  })

  it('output_with_no_handle_in_it_raises_instead_of_handing_back_something_unusable', async () => {
    const cmux = new CmuxDouble('OK\n')

    await expect(cmux.session().start('ABC-123')).rejects.toThrow(/did not name the workspace/)
  })

  it('a_cmux_that_refuses_the_call_lets_its_own_reason_through', async () => {
    const cmux = new CmuxDouble(new Error('Access denied'))

    await expect(cmux.session().start('ABC-123')).rejects.toThrow(/Access denied/)
  })
})
