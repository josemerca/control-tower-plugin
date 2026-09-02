import { describe, it, expect } from 'vitest'
import { GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.js'
import { Gh } from '../../src/infrastructure/gh.js'
import { PlanIssueBody } from '../../src/infrastructure/plan-issue-body.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.js'
import { Clock } from '../../src/domain/ports/clock.js'
import { Ticket } from '../../src/domain/value-objects/ticket.js'
import { TicketKey } from '../../src/domain/value-objects/ticket-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanIssueNotCreated, PlanIssueNotNamed, PlanIssueFailure } from '../../src/domain/exceptions.js'

class ClockDouble extends Clock {
  constructor() {
    super()
    this.slept = []
  }

  async sleep(seconds) {
    this.slept.push(seconds)
  }
}

class GhDouble {
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static CREATED = 'https://github.com/josemerca/ct-loop-sandbox/issues/7\n'

  constructor(answers) {
    this.answers = answers
    this.calls = []
    this.clock = new ClockDouble()
  }

  static created(printed = GhDouble.CREATED) {
    return new GhDouble([new ProcessOutput({ code: 0, stdout: printed, stderr: '' })])
  }

  static refusing(said, times = 1) {
    return new GhDouble(Array(times).fill(new ProcessOutput({ code: 1, stdout: '', stderr: said })))
  }

  static ticket({ summary = 'El buscador acepta acentos', description = 'como comprador quiero' } = {}) {
    return new Ticket({ key: new TicketKey('MO_SHOP-42'), summary, description })
  }

  issues({ attempts = 3 } = {}) {
    return new GhPlanIssues({
      gh: new Gh({
        launch: (argv) => {
          this.calls.push(argv)
          const answer = this.answers[this.calls.length - 1]
          if (answer === undefined) {
            throw new Error(`nobody wrote an answer for call ${this.calls.length}: ${argv.join(' ')}`)
          }

          return Promise.resolve(answer)
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts, waitSeconds: 2 }) }),
        clock: this.clock,
      }),
    })
  }

  async openFor(ticket = GhDouble.ticket()) {
    return this.issues().open({ ticket, repository: GhDouble.REPOSITORY })
  }

  async refusalFor(ticket = GhDouble.ticket()) {
    return this.openFor(ticket).catch((cause) => cause)
  }

  get commands() {
    return this.calls.map((argv) => argv.slice(0, 3).join(' '))
  }
}

describe('GhPlanIssues', () => {
  it('the_call_it_makes_names_the_repository_the_title_and_the_labels_the_loop_reads', async () => {
    const gh = GhDouble.created()
    const ticket = GhDouble.ticket()

    await gh.openFor(ticket)

    expect(gh.calls).toEqual([[
      'issue', 'create',
      '--repo', 'josemerca/ct-loop-sandbox',
      '--title', 'MO_SHOP-42 El buscador acepta acentos',
      '--body', PlanIssueBody.of(ticket),
      '--label', 'gate:plan',
      '--label', 'status:ready',
    ]])
  })

  it('the_issue_gh_printed_comes_back_numbered_so_the_next_step_can_be_told_which_one_it_is', async () => {
    const gh = GhDouble.created('https://github.com/josemerca/ct-loop-sandbox/issues/213\n')

    const issue = await gh.openFor()

    expect(issue.number).toBe(213)
    expect(issue.url).toBe('https://github.com/josemerca/ct-loop-sandbox/issues/213')
    expect(String(issue)).toBe('#213')
  })

  it('a_repository_whose_name_carries_digits_does_not_lend_them_to_the_issue_number', async () => {
    const gh = GhDouble.created('https://github.com/mercadona/mo.shop2/issues/41\n')

    expect((await gh.openFor()).number).toBe(41)
  })

  it('the_notice_gh_prints_before_the_url_does_not_get_mistaken_for_the_issue', async () => {
    const gh = GhDouble.created(
      'Creating issue in josemerca/ct-loop-sandbox\n\nhttps://github.com/josemerca/ct-loop-sandbox/issues/9\n'
    )

    expect((await gh.openFor()).number).toBe(9)
  })

  it('a_label_the_repository_does_not_have_yet_is_created_and_the_issue_opened_on_the_retry', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'gate:plan' not found" }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 0, stdout: GhDouble.CREATED, stderr: '' }),
    ])

    const issue = await gh.openFor()

    expect(gh.commands).toEqual(['issue create --repo', 'label create gate:plan', 'issue create --repo'])
    expect(gh.calls[1]).toEqual([
      'label', 'create', 'gate:plan', '--repo', 'josemerca/ct-loop-sandbox', '--force',
    ])
    expect(issue.number).toBe(7)
  })

  it('two_labels_missing_are_both_sown_instead_of_giving_up_after_the_first', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'gate:plan' not found" }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'status:ready' not found" }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 0, stdout: GhDouble.CREATED, stderr: '' }),
    ])

    await gh.openFor()

    expect(gh.commands).toEqual([
      'issue create --repo', 'label create gate:plan',
      'issue create --repo', 'label create status:ready',
      'issue create --repo',
    ])
  })

  it('a_label_that_is_none_of_ours_is_not_created_in_someone_elses_repository', async () => {
    const gh = GhDouble.refusing("could not add label: 'area:whatever' not found", 1)

    const refusal = await gh.refusalFor()

    expect(gh.commands).toEqual(['issue create --repo'])
    expect(refusal).toBeInstanceOf(PlanIssueNotCreated)
  })

  it('the_same_label_reported_missing_twice_stops_instead_of_sowing_it_forever', async () => {
    const gh = GhDouble.refusing("could not add label: 'gate:plan' not found", 9)

    const refusal = await gh.refusalFor()

    expect(gh.commands).toEqual(['issue create --repo', 'label create gate:plan', 'issue create --repo'])
    expect(refusal).toBeInstanceOf(PlanIssueNotCreated)
  })

  it('a_blip_while_opening_the_issue_is_not_retried_because_the_answer_may_have_been_the_one_lost', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: 'error connecting to api.github.com' }),
      new ProcessOutput({ code: 0, stdout: GhDouble.CREATED, stderr: '' }),
    ])

    const refusal = await gh.refusalFor()

    expect(gh.calls).toHaveLength(1)
    expect(gh.clock.slept).toEqual([])
    expect(refusal).toBeInstanceOf(PlanIssueNotCreated)
  })

  it('a_blip_while_sowing_a_label_is_retried_because_writing_it_twice_leaves_the_same_label', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'gate:plan' not found" }),
      new ProcessOutput({ code: 1, stdout: '', stderr: 'error connecting to api.github.com' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 0, stdout: GhDouble.CREATED, stderr: '' }),
    ])

    const issue = await gh.openFor()

    expect(gh.commands).toEqual([
      'issue create --repo', 'label create gate:plan', 'label create gate:plan', 'issue create --repo',
    ])
    expect(gh.clock.slept).toEqual([2])
    expect(issue.number).toBe(7)
  })

  it('a_five_hundred_is_a_blip_even_when_gh_words_it_as_a_status_and_not_as_a_sentence', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'gate:plan' not found" }),
      new ProcessOutput({ code: 1, stdout: '', stderr: 'HTTP 503 (https://api.github.com/repos/o/n/labels)' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 0, stdout: GhDouble.CREATED, stderr: '' }),
    ])

    await gh.openFor()

    expect(gh.clock.slept).toEqual([2])
  })

  it('a_refusal_that_is_not_a_blip_is_not_retried_because_repeating_it_changes_nothing', async () => {
    const gh = GhDouble.refusing('could not resolve to a Repository', 9)

    await gh.refusalFor()

    expect(gh.calls).toHaveLength(1)
    expect(gh.clock.slept).toEqual([])
  })

  it('a_blip_that_never_clears_stops_at_the_budget_instead_of_calling_forever', async () => {
    const blip = new ProcessOutput({ code: 1, stdout: '', stderr: '502 Bad Gateway' })
    const missing = new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'gate:plan' not found" })
    const gh = new GhDouble([missing, blip, blip, blip, blip, missing])

    await gh.refusalFor()

    expect(gh.commands.filter((command) => command.startsWith('label'))).toHaveLength(4)
    expect(gh.clock.slept).toEqual([2, 2, 2])
  })

  it('a_rate_limit_is_not_a_blip_because_asking_again_two_seconds_later_makes_it_worse', async () => {
    const missing = new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'gate:plan' not found" })
    const gh = new GhDouble([
      missing,
      new ProcessOutput({ code: 1, stdout: '', stderr: 'You have exceeded a secondary rate limit' }),
      missing,
    ])

    await gh.refusalFor()

    expect(gh.clock.slept).toEqual([])
  })

  it('the_double_of_this_conversation_refuses_to_answer_a_call_nobody_wrote_an_answer_for', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'gate:plan' not found" }),
    ])

    await expect(gh.openFor()).rejects.toThrow(/nobody wrote an answer for call 2/)
  })

  it('output_with_no_issue_url_in_it_raises_instead_of_handing_back_something_unusable', async () => {
    const refusal = await GhDouble.created('done\n').refusalFor()

    expect(refusal).toBeInstanceOf(PlanIssueNotNamed)
    expect(refusal.message).toContain('did not name the issue')
  })

  it('gh_answering_something_unreadable_is_told_apart_from_gh_refusing_the_call', async () => {
    const unreadable = await GhDouble.created('done\n').refusalFor()
    const refused = await GhDouble.refusing('boom', 9).refusalFor()

    expect(unreadable).toBeInstanceOf(PlanIssueNotNamed)
    expect(refused).toBeInstanceOf(PlanIssueNotCreated)
    expect(unreadable).not.toBeInstanceOf(PlanIssueNotCreated)
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await GhDouble.created('done\n').refusalFor()
    const refused = await GhDouble.refusing('boom', 9).refusalFor()

    expect(unreadable).toBeInstanceOf(PlanIssueFailure)
    expect(refused).toBeInstanceOf(PlanIssueFailure)
  })
})
