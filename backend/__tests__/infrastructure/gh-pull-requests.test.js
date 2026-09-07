import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { GhPullRequests, OpenPullRequest } from '../../src/infrastructure/gh-pull-requests.js'
import { Gh } from '../../src/infrastructure/gh.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.js'
import { SleepDouble } from '../sleep-double.js'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PullRequestNotRead, PullRequestNotUnderstood } from '../../src/domain/exceptions.js'

const DECLARED = JSON.parse(
  readFileSync(new URL('../fixtures/declared-gh-pull-request-reviews.json', import.meta.url), 'utf8')
)

class GhDouble {
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static PULL_REQUEST = new OpenPullRequest({
    number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42',
  })
  static LISTED = `[{"number":42,"url":"https://github.com/josemerca/ct-loop-sandbox/pull/42"}]\n`

  constructor(answers) {
    this.answers = answers
    this.calls = []
    this.sleeping = new SleepDouble()
  }

  static answering(...printed) {
    return new GhDouble(printed.map((stdout) => new ProcessOutput({ code: 0, stdout, stderr: '' })))
  }

  static refusing(said) {
    return new GhDouble([new ProcessOutput({ code: 1, stdout: '', stderr: said })])
  }

  static declaring() {
    return GhDouble.answering(JSON.stringify([DECLARED.reviews]), JSON.stringify([DECLARED.comments]))
  }

  pullRequests() {
    return new GhPullRequests({
      gh: new Gh({
        launch: (argv) => {
          this.calls.push(argv)
          const answer = this.answers[this.calls.length - 1]
          if (answer === undefined) {
            throw new Error(`nobody wrote an answer for call ${this.calls.length}: ${argv.join(' ')}`)
          }

          return Promise.resolve(answer)
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 3, waitSeconds: 2 }) }),
        sleep: (seconds) => this.sleeping.sleep(seconds),
      }),
    })
  }

  async openOf() {
    return this.pullRequests().openOf({ issue: GhDouble.ISSUE, repository: GhDouble.REPOSITORY })
  }

  async fixesAsked() {
    return this.pullRequests()
      .fixesAsked({ pullRequest: GhDouble.PULL_REQUEST, repository: GhDouble.REPOSITORY })
  }
}

describe('GhPullRequests', () => {
  it('the_branch_it_asks_about_is_the_one_the_loop_derives_from_the_issue', async () => {
    const gh = GhDouble.answering(GhDouble.LISTED)

    await gh.openOf()

    expect(gh.calls).toEqual([[
      'pr', 'list', '--repo', 'josemerca/ct-loop-sandbox',
      '--head', 'feat/7', '--state', 'open', '--json', 'number,url', '--limit', '1',
    ]])
  })

  it('a_branch_with_no_pull_request_answers_null_and_not_an_empty_object', async () => {
    const found = await GhDouble.answering('[]\n').openOf()

    expect(found).toBeNull()
  })

  it('the_pull_request_it_found_carries_the_number_and_the_url_gh_reported', async () => {
    const found = await GhDouble.answering(GhDouble.LISTED).openOf()

    expect(found).toEqual(GhDouble.PULL_REQUEST)
  })

  it('gh_refusing_to_list_travels_out_as_not_read_and_not_as_an_absent_pull_request', async () => {
    const refusal = await GhDouble.refusing('HTTP 404').openOf().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotRead)
    expect(refusal).not.toBeInstanceOf(PullRequestNotUnderstood)
  })

  it('a_listing_that_is_not_json_travels_out_as_not_understood', async () => {
    const refusal = await GhDouble.answering('no soy json\n').openOf().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotUnderstood)
    expect(refusal).not.toBeInstanceOf(PullRequestNotRead)
  })

  it('it_reads_the_reviews_and_the_line_comments_of_that_pull_request_one_full_page_at_a_time', async () => {
    const gh = GhDouble.declaring()

    await gh.fixesAsked()

    expect(gh.calls).toEqual([
      ['api', 'repos/josemerca/ct-loop-sandbox/pulls/42/reviews', '-f', 'per_page=100', '--paginate', '--slurp'],
      ['api', 'repos/josemerca/ct-loop-sandbox/pulls/42/comments', '-f', 'per_page=100', '--paginate', '--slurp'],
    ])
  })

  it('a_review_with_a_body_and_its_line_comments_is_flattened_into_one_change', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[{ id: 101, state: 'CHANGES_REQUESTED', body: 'varias cosas' }]]),
        stderr: '',
      }),
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[
          { body: 'revienta con []', path: 'src/foo.js', line: 42, pull_request_review_id: 101 },
          { body: 'esto sobra', path: 'src/bar.js', line: 17, pull_request_review_id: 101 },
        ]]),
        stderr: '',
      }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked).toEqual([new ChangeAsked({
      id: '101',
      text: 'varias cosas\nsrc/foo.js:42: revienta con []\nsrc/bar.js:17: esto sobra',
    })])
  })

  it('a_lone_line_comment_with_no_review_body_is_a_change_too_because_that_is_how_github_wraps_it', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[{ id: 102, state: 'COMMENTED', body: '' }]]),
        stderr: '',
      }),
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[
          { body: 'esta linea sobra', path: 'src/foo.js', line: 9, pull_request_review_id: 102 },
        ]]),
        stderr: '',
      }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked).toEqual([new ChangeAsked({ id: '102', text: 'src/foo.js:9: esta linea sobra' })])
  })

  it('a_comment_with_no_line_is_anchored_to_its_file_alone', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[{ id: 103, state: 'COMMENTED', body: '' }]]),
        stderr: '',
      }),
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[
          { body: 'este fichero entero', path: 'src/foo.js', line: null, pull_request_review_id: 103 },
        ]]),
        stderr: '',
      }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked).toEqual([new ChangeAsked({ id: '103', text: 'src/foo.js: este fichero entero' })])
  })

  it('an_approval_a_draft_and_a_dismissal_ask_for_nothing', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[
          { id: 1, state: 'APPROVED', body: 'se ve bien' },
          { id: 2, state: 'PENDING', body: 'todavia lo escribo' },
          { id: 3, state: 'DISMISSED', body: 'descartada' },
        ]]),
        stderr: '',
      }),
      new ProcessOutput({ code: 0, stdout: '[[]]', stderr: '' }),
    ])

    expect(await gh.fixesAsked()).toEqual([])
  })

  it('a_review_with_neither_body_nor_comments_asks_for_nothing', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[{ id: 4, state: 'COMMENTED', body: '   ' }]]),
        stderr: '',
      }),
      new ProcessOutput({ code: 0, stdout: '[[]]', stderr: '' }),
    ])

    expect(await gh.fixesAsked()).toEqual([])
  })

  it('the_changes_come_back_in_the_order_of_the_review_ids_so_the_oldest_is_attended_first', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([[
          { id: 150, state: 'CHANGES_REQUESTED', body: 'la segunda vuelta' },
          { id: 101, state: 'CHANGES_REQUESTED', body: 'la primera' },
        ]]),
        stderr: '',
      }),
      new ProcessOutput({ code: 0, stdout: '[[]]', stderr: '' }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked.map((change) => change.text)).toEqual(['la primera', 'la segunda vuelta'])
  })

  it('the_changes_split_across_two_pages_are_read_whole_instead_of_being_cut_at_the_first_thirty', async () => {
    const gh = new GhDouble([
      new ProcessOutput({
        code: 0,
        stdout: JSON.stringify([
          [{ id: 101, state: 'CHANGES_REQUESTED', body: 'la primera pagina' }],
          [{ id: 202, state: 'CHANGES_REQUESTED', body: 'la segunda pagina' }],
        ]),
        stderr: '',
      }),
      new ProcessOutput({ code: 0, stdout: '[[],[]]', stderr: '' }),
    ])

    const asked = await gh.fixesAsked()

    expect(asked.map((change) => change.text)).toEqual(['la primera pagina', 'la segunda pagina'])
  })

  it('a_review_gh_sent_without_the_fields_this_reads_travels_out_as_not_understood', async () => {
    const gh = new GhDouble([
      new ProcessOutput({ code: 0, stdout: JSON.stringify([[{ id: 101 }]]), stderr: '' }),
      new ProcessOutput({ code: 0, stdout: '[[]]', stderr: '' }),
    ])

    const refusal = await gh.fixesAsked().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PullRequestNotUnderstood)
  })

  it('the_shape_declared_by_this_fixture_flattens_the_body_and_the_two_reviews_it_carries_comments_for', async () => {
    const asked = await GhDouble.declaring().fixesAsked()

    expect(asked).toEqual([
      new ChangeAsked({
        id: '101',
        text: 'varias cosas que arreglar\nsrc/foo.js:42: revienta con []\nsrc/bar.js:17: esto sobra',
      }),
      new ChangeAsked({ id: '102', text: 'src/baz.js:9: esta linea sobra' }),
    ])
  })
})
