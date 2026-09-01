import { describe, it, expect } from 'vitest'
import { GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.js'
import { Ticket } from '../../src/domain/ticket.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { RepositoryName } from '../../src/domain/repository-name.js'
import { PlanIssueNotCreated, PlanIssueNotNamed, PlanIssueFailure } from '../../src/domain/exceptions.js'

class GhDouble {
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor(printed) {
    this.printed = printed
    this.calls = []
  }

  static ticket({ summary = 'rename the button', description = 'como usuario quiero' } = {}) {
    return new Ticket({ key: new TicketKey('MO_SHOP-42'), summary, description })
  }

  issues() {
    return new GhPlanIssues({
      run: (argv) => {
        this.calls.push(argv)
        if (this.printed instanceof Error) return Promise.reject(this.printed)
        return Promise.resolve(this.printed)
      },
    })
  }

  async openFor(ticket = GhDouble.ticket()) {
    return this.issues().open({ ticket, repository: GhDouble.REPOSITORY })
  }

  async refusalFor(ticket = GhDouble.ticket()) {
    return this.openFor(ticket).catch((cause) => cause)
  }
}

describe('GhPlanIssues', () => {
  it('the_call_it_makes_names_the_repository_the_ticket_and_the_only_label_the_loop_dispatches_on', async () => {
    const gh = new GhDouble('https://github.com/josemerca/ct-loop-sandbox/issues/7\n')

    await gh.openFor()

    expect(gh.calls).toEqual([[
      'issue', 'create',
      '--repo', 'josemerca/ct-loop-sandbox',
      '--title', 'MO_SHOP-42 rename the button',
      '--body', '> Historia de usuario: MO_SHOP-42\n\ncomo usuario quiero\n',
      '--label', 'status:ready',
    ]])
  })

  it('a_ticket_with_no_description_says_so_in_the_body_instead_of_opening_an_empty_issue', async () => {
    const gh = new GhDouble('https://github.com/josemerca/ct-loop-sandbox/issues/7\n')

    await gh.openFor(GhDouble.ticket({ description: '   ' }))

    expect(gh.calls[0][7]).toBe(
      '> Historia de usuario: MO_SHOP-42\n\n_MO_SHOP-42 no trae descripción en Jira._\n'
    )
  })

  it('the_issue_gh_printed_comes_back_numbered_so_the_next_step_can_be_told_which_one_it_is', async () => {
    const gh = new GhDouble('https://github.com/josemerca/ct-loop-sandbox/issues/213\n')

    const issue = await gh.openFor()

    expect(issue.number).toBe(213)
    expect(issue.url).toBe('https://github.com/josemerca/ct-loop-sandbox/issues/213')
    expect(String(issue)).toBe('#213')
  })

  it('a_repository_whose_name_carries_digits_does_not_lend_them_to_the_issue_number', async () => {
    const gh = new GhDouble('https://github.com/mercadona/mo.shop2/issues/41\n')

    expect((await gh.openFor()).number).toBe(41)
  })

  it('the_notice_gh_prints_before_the_url_does_not_get_mistaken_for_the_issue', async () => {
    const gh = new GhDouble(
      'Creating issue in josemerca/ct-loop-sandbox\n\nhttps://github.com/josemerca/ct-loop-sandbox/issues/9\n'
    )

    expect((await gh.openFor()).number).toBe(9)
  })

  it('output_with_no_issue_url_in_it_raises_instead_of_handing_back_something_unusable', async () => {
    const refusal = await new GhDouble('done\n').refusalFor()

    expect(refusal).toBeInstanceOf(PlanIssueNotNamed)
    expect(refusal.message).toContain('did not name the issue')
  })

  it('a_gh_that_refuses_the_call_arrives_typed_with_its_own_reason_in_it', async () => {
    const refusal = await new GhDouble(
      new Error("gh issue failed: could not add label: 'status:ready' not found")
    ).refusalFor()

    expect(refusal).toBeInstanceOf(PlanIssueNotCreated)
    expect(refusal.message).toContain("'status:ready' not found")
  })

  it('gh_answering_something_unreadable_is_told_apart_from_gh_refusing_the_call', async () => {
    const unreadable = await new GhDouble('done\n').refusalFor()
    const refused = await new GhDouble(new Error('boom')).refusalFor()

    expect(unreadable).toBeInstanceOf(PlanIssueNotNamed)
    expect(refused).toBeInstanceOf(PlanIssueNotCreated)
    expect(unreadable).not.toBeInstanceOf(PlanIssueNotCreated)
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await new GhDouble('done\n').refusalFor()
    const refused = await new GhDouble(new Error('boom')).refusalFor()

    expect(unreadable).toBeInstanceOf(PlanIssueFailure)
    expect(refused).toBeInstanceOf(PlanIssueFailure)
  })
})
