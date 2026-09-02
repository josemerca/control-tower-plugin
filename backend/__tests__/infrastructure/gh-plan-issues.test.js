import { describe, it, expect } from 'vitest'
import { GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.js'
import { Gh } from '../../src/infrastructure/gh.js'
import { PlanIssueBody } from '../../src/infrastructure/gh-plan-issues.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.js'
import { Clock } from '../../src/domain/ports/clock.js'
import { UserStory } from '../../src/domain/value-objects/user-story.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import {
  PlanIssueNotCreated, PlanIssueNotNamed, PlanIssueNotClaimed, PlanGoNotAnswered, PlanIssueFailure,
} from '../../src/domain/exceptions.js'

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

  static OPENED = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })

  constructor(answers) {
    this.answers = answers
    this.calls = []
    this.warnings = []
    this.clock = new ClockDouble()
  }

  static created(printed = GhDouble.CREATED) {
    return new GhDouble([new ProcessOutput({ code: 0, stdout: printed, stderr: '' })])
  }

  static refusing(said, times = 1) {
    return new GhDouble(Array(times).fill(new ProcessOutput({ code: 1, stdout: '', stderr: said })))
  }

  static #DONE = new ProcessOutput({ code: 0, stdout: '', stderr: '' })

  static claiming(...answers) {
    return new GhDouble([GhDouble.#DONE, ...(answers.length === 0 ? [GhDouble.#DONE] : answers)])
  }

  static story({ summary = 'El buscador acepta acentos', description = 'como comprador quiero' } = {}) {
    return new UserStory({ key: new UserStoryKey('MO_SHOP-42'), summary, description })
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
      stderr: (line) => this.warnings.push(line),
    })
  }

  async claimFor(issue = GhDouble.OPENED) {
    return this.issues().claim({ issue, repository: GhDouble.REPOSITORY })
  }

  async claimRefusalFor(issue = GhDouble.OPENED) {
    return this.claimFor(issue).catch((cause) => cause)
  }

  async requeueFor(issue = GhDouble.OPENED) {
    return this.issues().requeue({ issue, repository: GhDouble.REPOSITORY })
  }

  async answerGoFor(nonce = '7f3a91c2') {
    return this.issues().answerGo({
      issueNumber: 33, repository: GhDouble.REPOSITORY, nonce,
    })
  }

  async goRefusalFor(nonce = '7f3a91c2') {
    return this.answerGoFor(nonce).catch((cause) => cause)
  }

  async openFor(story = GhDouble.story()) {
    return this.issues().open({ story, repository: GhDouble.REPOSITORY })
  }

  async refusalFor(story = GhDouble.story()) {
    return this.openFor(story).catch((cause) => cause)
  }

  get commands() {
    return this.calls.map((argv) => argv.slice(0, 3).join(' '))
  }
}

describe('GhPlanIssues', () => {
  it('the_call_it_makes_names_the_repository_the_title_and_the_labels_the_loop_reads', async () => {
    const gh = GhDouble.created()
    const story = GhDouble.story()

    await gh.openFor(story)

    expect(gh.calls).toEqual([[
      'issue', 'create',
      '--repo', 'josemerca/ct-loop-sandbox',
      '--title', 'MO_SHOP-42 El buscador acepta acentos',
      '--body', PlanIssueBody.of(story),
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

describe('GhPlanIssues moving the status label of a claim', () => {
  it('claiming_an_issue_sends_the_label_swap_gh_understands', async () => {
    const gh = GhDouble.claiming()

    await gh.claimFor()

    expect(gh.calls[1]).toEqual([
      'issue', 'edit', '7',
      '--repo', 'josemerca/ct-loop-sandbox',
      '--add-label', 'status:in-progress',
      '--remove-label', 'status:ready',
    ])
  })

  it('a_status_label_the_repo_does_not_have_is_sown_and_the_claim_retried', async () => {
    const gh = GhDouble.claiming(
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'status:in-progress' not found" }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
    )

    await gh.claimFor()

    expect(gh.commands).toEqual([
      'label create status:in-review', 'issue edit 7', 'label create status:in-progress', 'issue edit 7',
    ])
    expect(gh.calls[2]).toEqual([
      'label', 'create', 'status:in-progress', '--repo', 'josemerca/ct-loop-sandbox', '--force',
    ])
  })

  it('a_label_that_is_not_ours_is_not_sown_and_the_claim_fails_with_what_gh_said', async () => {
    const gh = GhDouble.claiming(
      new ProcessOutput({ code: 1, stdout: '', stderr: "could not add label: 'team:shop' not found" }),
    )

    const refusal = await gh.claimRefusalFor()

    expect(refusal).toBeInstanceOf(PlanIssueNotClaimed)
    expect(refusal.message).toBe("gh issue edit failed: could not add label: 'team:shop' not found")
    expect(gh.commands).toEqual(['label create status:in-review', 'issue edit 7'])
  })

  it('requeueing_an_issue_sends_the_swap_the_other_way_round', async () => {
    const gh = GhDouble.created('')

    await gh.requeueFor()

    expect(gh.calls).toEqual([[
      'issue', 'edit', '7',
      '--repo', 'josemerca/ct-loop-sandbox',
      '--add-label', 'status:ready',
      '--remove-label', 'status:in-progress',
    ]])
  })

  it('claiming_first_sows_the_label_the_release_will_write_because_no_call_of_ours_can_sow_it_on_demand', async () => {
    const gh = GhDouble.claiming()

    await gh.claimFor()

    expect(gh.calls[0]).toEqual([
      'label', 'create', 'status:in-review', '--repo', 'josemerca/ct-loop-sandbox', '--force',
    ])
    expect(gh.commands).toEqual(['label create status:in-review', 'issue edit 7'])
  })

  it('a_release_label_that_could_not_be_sown_stops_the_claim_instead_of_dying_at_the_last_gate', async () => {
    const gh = GhDouble.refusing('gh: not authenticated')

    const refusal = await gh.claimRefusalFor()

    expect(refusal).toBeInstanceOf(PlanIssueNotClaimed)
    expect(refusal.message).toContain('status:in-review')
    expect(gh.commands).toEqual(['label create status:in-review'])
  })

  it('a_blip_while_claiming_is_retried_because_moving_a_label_twice_leaves_the_same_label', async () => {
    const gh = GhDouble.claiming(
      new ProcessOutput({ code: 1, stdout: '', stderr: 'error connecting to api.github.com' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
    )

    await gh.claimFor()

    expect(gh.commands).toEqual(['label create status:in-review', 'issue edit 7', 'issue edit 7'])
    expect(gh.clock.slept).toEqual([2])
  })

  it('a_blip_while_requeueing_is_retried_because_the_compensation_is_the_last_chance_to_free_the_issue', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: 'error connecting to api.github.com' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
    ])

    await gh.requeueFor()

    expect(gh.calls).toHaveLength(2)
    expect(gh.warnings).toEqual([])
  })

  it('a_requeue_gh_refused_names_the_command_a_human_can_run_instead_of_throwing', async () => {
    const gh = GhDouble.refusing('gh: not authenticated')

    await gh.requeueFor()

    expect(gh.warnings).toHaveLength(1)
    expect(gh.warnings[0]).toContain(
      'gh issue edit 7 --repo josemerca/ct-loop-sandbox --add-label status:ready --remove-label status:in-progress'
    )
    expect(gh.warnings[0]).toContain('gh: not authenticated')
  })
})

describe('GhPlanIssues answering the go on the issue', () => {
  it('answering_the_go_sends_the_comment_gh_understands', async () => {
    const gh = GhDouble.created('')

    await gh.answerGoFor('7f3a91c2')

    expect(gh.calls).toEqual([[
      'issue', 'comment', '33',
      '--repo', 'josemerca/ct-loop-sandbox',
      '--body', '-OK 7f3a91c2',
    ]])
  })

  it('a_blip_while_answering_the_go_is_not_retried_because_the_answer_may_have_been_the_one_lost', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 1, stdout: '', stderr: 'error connecting to api.github.com' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
    ])

    const refusal = await gh.goRefusalFor()

    expect(gh.calls).toHaveLength(1)
    expect(gh.clock.slept).toEqual([])
    expect(refusal).toBeInstanceOf(PlanGoNotAnswered)
  })

  it('a_comment_gh_refused_is_a_go_the_issue_never_took', async () => {
    const gh = GhDouble.refusing('gh: not authenticated')

    const refusal = await gh.goRefusalFor()

    expect(refusal).toBeInstanceOf(PlanGoNotAnswered)
    expect(refusal.message).toBe('gh issue comment failed: gh: not authenticated')
  })
})
