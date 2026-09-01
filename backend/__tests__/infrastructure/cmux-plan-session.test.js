import { describe, it, expect } from 'vitest'
import { CmuxPlanSession } from '../../src/infrastructure/cmux-plan-session.js'
import { PlanSessionNotStarted, PlanSessionNotNamed, PlanSessionFailure } from '../../src/domain/exceptions.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { PlanIssue } from '../../src/domain/plan-issue.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'

class CmuxDouble {
  static CWD = '/repo/checkout'

  static refusing(said) {
    return new CmuxDouble(new ProcessOutput({ code: 1, stdout: '', stderr: said }))
  }

  static ISSUE = new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' })

  constructor(printed) {
    this.printed = printed
    this.calls = []
  }

  session() {
    return new CmuxPlanSession({
      cwd: CmuxDouble.CWD,
      run: (argv) => {
        this.calls.push(argv)
        if (this.printed instanceof ProcessOutput) return Promise.resolve(this.printed)
        return Promise.resolve(new ProcessOutput({ code: 0, stdout: this.printed, stderr: '' }))
      },
    })
  }

  async startFor(text, issue = CmuxDouble.ISSUE) {
    return this.session().start({ ticket: new TicketKey(text), issue })
  }
}

describe('CmuxPlanSession', () => {
  it('the_call_it_makes_names_the_ticket_and_cuts_it_in_the_directory_it_was_given', async () => {
    const cmux = new CmuxDouble('OK workspace:4\n')

    await cmux.startFor('MO_SHOP-42')

    expect(cmux.calls).toEqual([[
      'new-workspace',
      '--name', 'ct-plan-MO_SHOP-42',
      '--cwd', CmuxDouble.CWD,
      '--command', 'echo "plan session up for MO_SHOP-42 on issue #7"',
    ]])
  })

  it('the_handle_cmux_prints_is_what_comes_back_so_the_caller_can_reach_the_session_later', async () => {
    const cmux = new CmuxDouble('OK workspace:4\n')

    expect(await cmux.startFor('ABC-123')).toBe('workspace:4')
  })

  it('the_notice_cmux_prints_before_the_handle_does_not_get_mistaken_for_one', async () => {
    const cmux = new CmuxDouble("cmux: 'new-workspace' is now an alias\nOK workspace:12\n")

    expect(await cmux.startFor('ABC-123')).toBe('workspace:12')
  })

  it('output_with_no_handle_in_it_raises_instead_of_handing_back_something_unusable', async () => {
    const cmux = new CmuxDouble('OK\n')

    await expect(cmux.startFor('ABC-123')).rejects.toThrow(/did not name the workspace/)
  })

  it('a_cmux_that_refuses_the_call_arrives_typed_so_the_caller_can_tell_it_from_a_crash', async () => {
    const cmux = CmuxDouble.refusing('Access denied')

    const refusal = await cmux.startFor('ABC-123').catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionNotStarted)
    expect(refusal.message).toContain('Access denied')
  })

  it('cmux_answering_something_unreadable_is_told_apart_from_cmux_refusing_the_call', async () => {
    const unreadable = await new CmuxDouble('OK\n').startFor('ABC-123').catch((cause) => cause)
    const refused = await CmuxDouble.refusing('Access denied').startFor('ABC-123').catch((c) => c)

    expect(unreadable).toBeInstanceOf(PlanSessionNotNamed)
    expect(refused).toBeInstanceOf(PlanSessionNotStarted)
    expect(unreadable).not.toBeInstanceOf(PlanSessionNotStarted)
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await new CmuxDouble('OK\n').startFor('ABC-123').catch((cause) => cause)
    const refused = await CmuxDouble.refusing('Access denied').startFor('ABC-123').catch((c) => c)

    expect(unreadable).toBeInstanceOf(PlanSessionFailure)
    expect(refused).toBeInstanceOf(PlanSessionFailure)
  })
})
