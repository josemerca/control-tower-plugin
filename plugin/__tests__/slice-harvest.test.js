import { describe, it, expect } from 'vitest'
import { harvestSlice } from '../scripts/harvest.js'
import { TelemetryStatus } from '../scripts/harvest-table.js'
import { METRICS_REPO_DIR, aggregateBriefMeasures, aggregateVerdictMeasures, metricsRepoRelPath } from '../scripts/run-metrics.js'
import {
  IndexOutcome,
  SliceHarvest,
  SliceHarvestOutcome,
  SliceHarvestReport,
  SliceRead,
  SliceReadFailure,
  TelemetryIndex,
} from '../scripts/slice-harvest.js'

class RunnerAnswer {
  static ok(stdout) {
    return { code: 0, stdout, stderr: '' }
  }

  static failed(code, stderr) {
    return { code, stdout: '', stderr }
  }
}

class ScriptedRunner {
  constructor({ program, answers, spoken }) {
    this.program = program
    this.answers = answers
    this.spoken = spoken
  }

  answerTo(asked) {
    this.spoken.push(`${this.program} ${asked}`)
    if (!Object.hasOwn(this.answers, asked)) {
      throw new Error(`nobody wrote an answer for: ${this.program} ${asked}`)
    }
    return this.answers[asked]
  }

  get forArgv() {
    return (argv) => this.answerTo(argv.join(' '))
  }
}

class TelemetryTranscript {
  static REPO = 'o/r'
  static LISTING_ARGV = `api repos/o/r/contents/${METRICS_REPO_DIR}`

  static twoFiles() {
    return JSON.stringify([
      { name: 'issue-12.jsonl', type: 'file' },
      { name: 'issue-99.jsonl', type: 'file' },
    ])
  }

  static aSingleFileObjectInsteadOfAListing() {
    return JSON.stringify({ name: 'issue-12.jsonl', type: 'file' })
  }
}

class IndexCase {
  static gh(answers) {
    return new ScriptedRunner({ program: 'gh', answers, spoken: [] })
  }

  static readWith(runner) {
    return TelemetryIndex.read({ gh: runner.forArgv, repo: TelemetryTranscript.REPO })
  }
}

describe('the telemetry index is listed once per run and never guessed', () => {
  it('an_index_listed_with_files_knows_which_slices_left_telemetry_and_asked_gh_exactly_once', () => {
    const runner = IndexCase.gh({ [TelemetryTranscript.LISTING_ARGV]: RunnerAnswer.ok(TelemetryTranscript.twoFiles()) })

    const index = IndexCase.readWith(runner)

    expect(index.outcome).toBe(IndexOutcome.LISTED)
    expect(index.has('issue-12.jsonl')).toBe(true)
    expect(index.has('issue-13.jsonl')).toBe(false)
    expect(runner.spoken).toEqual([`gh ${TelemetryTranscript.LISTING_ARGV}`])
  })

  it('a_listing_that_fails_is_not_read_and_carries_the_diagnosis_of_gh', () => {
    const runner = IndexCase.gh({ [TelemetryTranscript.LISTING_ARGV]: RunnerAnswer.failed(1, 'gh: HTTP 502\n') })

    const index = IndexCase.readWith(runner)

    expect(index.outcome).toBe(IndexOutcome.NOT_READ)
    expect(index.detail).toBe('gh: HTTP 502')
  })

  it('a_listing_that_is_not_an_array_is_not_read_instead_of_an_empty_index', () => {
    const runner = IndexCase.gh({ [TelemetryTranscript.LISTING_ARGV]: RunnerAnswer.ok(TelemetryTranscript.aSingleFileObjectInsteadOfAListing()) })

    const index = IndexCase.readWith(runner)

    expect(index.outcome).toBe(IndexOutcome.NOT_READ)
    expect(index.has('issue-12.jsonl')).toBe(false)
  })
})

describe('a report of one slice is complete only when nothing failed to read', () => {
  it('a_report_with_failures_is_incomplete_and_one_without_them_is_complete', () => {
    const failure = new SliceReadFailure({ read: SliceRead.PULL_REQUEST, subject: 'PR #71', detail: 'gh: HTTP 502' })

    const incomplete = SliceHarvestReport.of({ row: { issue: 12 }, failures: [failure], closers: [] })
    const complete = SliceHarvestReport.of({ row: { issue: 12 }, failures: [], closers: [] })

    expect(incomplete.outcome).toBe(SliceHarvestOutcome.INCOMPLETE)
    expect(complete.outcome).toBe(SliceHarvestOutcome.COMPLETE)
  })

  it('a_report_not_read_carries_its_failure_and_no_row', () => {
    const failure = new SliceReadFailure({ read: SliceRead.TIMELINE, subject: 'issue #12', detail: 'gh: HTTP 502' })

    const report = SliceHarvestReport.notRead(failure)

    expect(report.outcome).toBe(SliceHarvestOutcome.NOT_READ)
    expect(report.row).toBeNull()
    expect(report.failures).toEqual([failure])
  })
})

class GitHubAnswers {
  static REPO = 'o/r'
  static ISSUE_NUMBER = 12
  static FIRST_PR = 71
  static SECOND_PR = 90
  static ISSUE_FIELDS = 'number,title,state,closedAt,labels,milestone,closedByPullRequestsReferences'
  static PULL_REQUEST_FIELDS = 'number,mergedAt,additions,deletions,changedFiles,reviews,comments'
  static RAW_ACCEPT = 'Accept: application/vnd.github.raw'

  static get ISSUE_VIEW_ARGV() {
    return `issue view ${GitHubAnswers.ISSUE_NUMBER} --repo ${GitHubAnswers.REPO} --json ${GitHubAnswers.ISSUE_FIELDS}`
  }

  static get TIMELINE_ARGV() {
    return `api repos/${GitHubAnswers.REPO}/issues/${GitHubAnswers.ISSUE_NUMBER}/timeline --paginate --slurp`
  }

  static pullRequestArgv(number) {
    return `pr view ${number} --repo ${GitHubAnswers.REPO} --json ${GitHubAnswers.PULL_REQUEST_FIELDS}`
  }

  static get TELEMETRY_FILE_ARGV() {
    return `api repos/${GitHubAnswers.REPO}/contents/${metricsRepoRelPath(GitHubAnswers.ISSUE_NUMBER)} -H ${GitHubAnswers.RAW_ACCEPT}`
  }

  static issue(closers) {
    return {
      number: GitHubAnswers.ISSUE_NUMBER,
      title: 'a slice',
      state: 'CLOSED',
      closedAt: '2026-01-02T10:00:00Z',
      labels: [{ name: 'type:feature' }],
      milestone: { title: 'M1' },
      closedByPullRequestsReferences: closers.map((number) => ({ number })),
    }
  }

  static events() {
    return [{ event: 'labeled', label: { name: 'status:ready' }, created_at: '2026-01-01T09:00:00Z' }]
  }

  static pullRequestPayload(number) {
    return {
      number,
      mergedAt: '2026-01-02T09:00:00Z',
      additions: 10,
      deletions: 4,
      changedFiles: 3,
      reviews: [{ id: 1 }],
      comments: [{ id: 1 }, { id: 2 }],
    }
  }

  static prProjection(number = GitHubAnswers.FIRST_PR) {
    const payload = GitHubAnswers.pullRequestPayload(number)
    return {
      number: payload.number,
      mergedAt: payload.mergedAt,
      additions: payload.additions,
      deletions: payload.deletions,
      changedFiles: payload.changedFiles,
      reviews: payload.reviews.length,
      reviewComments: payload.comments.length,
    }
  }

  static telemetryText() {
    return `${JSON.stringify({ ruling: 'pass', rubric_sin_vara: 0, rubric_vara_ct_docs: 2, findings_vara_ct: 0, findings_by_rule: {} })}\n`
  }

  static indexWithFile() {
    return new TelemetryIndex({ outcome: IndexOutcome.LISTED, files: [`issue-${GitHubAnswers.ISSUE_NUMBER}.jsonl`], detail: null })
  }

  static indexWithoutFile() {
    return new TelemetryIndex({ outcome: IndexOutcome.LISTED, files: [], detail: null })
  }

  static #runner(answers) {
    return new ScriptedRunner({ program: 'gh', answers, spoken: [] })
  }

  static merged() {
    const runner = GitHubAnswers.#runner({
      [GitHubAnswers.TIMELINE_ARGV]: RunnerAnswer.ok(JSON.stringify([GitHubAnswers.events()])),
      [GitHubAnswers.pullRequestArgv(GitHubAnswers.FIRST_PR)]: RunnerAnswer.ok(JSON.stringify(GitHubAnswers.pullRequestPayload(GitHubAnswers.FIRST_PR))),
      [GitHubAnswers.TELEMETRY_FILE_ARGV]: RunnerAnswer.ok(GitHubAnswers.telemetryText()),
    })
    return { runner, repo: GitHubAnswers.REPO, issue: GitHubAnswers.issue([GitHubAnswers.FIRST_PR]), index: GitHubAnswers.indexWithFile() }
  }

  static timelineDown() {
    const runner = GitHubAnswers.#runner({
      [GitHubAnswers.TIMELINE_ARGV]: RunnerAnswer.failed(1, 'gh: HTTP 502\n'),
    })
    return { runner, repo: GitHubAnswers.REPO, issue: GitHubAnswers.issue([GitHubAnswers.FIRST_PR]), index: GitHubAnswers.indexWithFile() }
  }

  static pullRequestDown() {
    const runner = GitHubAnswers.#runner({
      [GitHubAnswers.TIMELINE_ARGV]: RunnerAnswer.ok(JSON.stringify([GitHubAnswers.events()])),
      [GitHubAnswers.pullRequestArgv(GitHubAnswers.FIRST_PR)]: RunnerAnswer.failed(1, 'gh: HTTP 502\n'),
    })
    return { runner, repo: GitHubAnswers.REPO, issue: GitHubAnswers.issue([GitHubAnswers.FIRST_PR]), index: GitHubAnswers.indexWithoutFile() }
  }

  static telemetryFileDown() {
    const runner = GitHubAnswers.#runner({
      [GitHubAnswers.TIMELINE_ARGV]: RunnerAnswer.ok(JSON.stringify([GitHubAnswers.events()])),
      [GitHubAnswers.pullRequestArgv(GitHubAnswers.FIRST_PR)]: RunnerAnswer.ok(JSON.stringify(GitHubAnswers.pullRequestPayload(GitHubAnswers.FIRST_PR))),
      [GitHubAnswers.TELEMETRY_FILE_ARGV]: RunnerAnswer.failed(1, 'gh: HTTP 502\n'),
    })
    return { runner, repo: GitHubAnswers.REPO, issue: GitHubAnswers.issue([GitHubAnswers.FIRST_PR]), index: GitHubAnswers.indexWithFile() }
  }

  static twoClosers() {
    const runner = GitHubAnswers.#runner({
      [GitHubAnswers.TIMELINE_ARGV]: RunnerAnswer.ok(JSON.stringify([GitHubAnswers.events()])),
      [GitHubAnswers.pullRequestArgv(GitHubAnswers.FIRST_PR)]: RunnerAnswer.ok(JSON.stringify(GitHubAnswers.pullRequestPayload(GitHubAnswers.FIRST_PR))),
    })
    return {
      runner,
      repo: GitHubAnswers.REPO,
      issue: GitHubAnswers.issue([GitHubAnswers.FIRST_PR, GitHubAnswers.SECOND_PR]),
      index: GitHubAnswers.indexWithoutFile(),
    }
  }
}

describe('SliceHarvest reproduces, by an injected gh, the reads ct-harvest.mjs does today for one slice', () => {
  it('a_slice_with_timeline_pull_request_and_telemetry_comes_back_complete_with_the_row_ct_harvest_prints_today', () => {
    const { runner, repo, issue, index } = GitHubAnswers.merged()
    const harvester = new SliceHarvest({ gh: runner.forArgv })

    const report = harvester.harvest({ repo, issue, index })

    const events = GitHubAnswers.events()
    const pr = GitHubAnswers.prProjection()
    const telemetry = {
      status: TelemetryStatus.OK,
      path: metricsRepoRelPath(GitHubAnswers.ISSUE_NUMBER),
      ...aggregateVerdictMeasures(GitHubAnswers.telemetryText()),
      ...aggregateBriefMeasures(GitHubAnswers.telemetryText()),
    }

    expect(report.outcome).toBe(SliceHarvestOutcome.COMPLETE)
    expect(report.row).toEqual({ ...harvestSlice({ events, issue, pr }), telemetry })
    expect(runner.spoken).toEqual([
      `gh ${GitHubAnswers.TIMELINE_ARGV}`,
      `gh ${GitHubAnswers.pullRequestArgv(GitHubAnswers.FIRST_PR)}`,
      `gh ${GitHubAnswers.TELEMETRY_FILE_ARGV}`,
    ])
  })

  it('a_timeline_that_cannot_be_read_is_not_read_and_carries_no_row', () => {
    const { runner, repo, issue, index } = GitHubAnswers.timelineDown()
    const harvester = new SliceHarvest({ gh: runner.forArgv })

    const report = harvester.harvest({ repo, issue, index })

    expect(report.outcome).toBe(SliceHarvestOutcome.NOT_READ)
    expect(report.row).toBeNull()
    expect(report.failures).toEqual([
      new SliceReadFailure({ read: SliceRead.TIMELINE, subject: `issue #${GitHubAnswers.ISSUE_NUMBER}`, detail: 'gh: HTTP 502' }),
    ])
    expect(runner.spoken).toEqual([`gh ${GitHubAnswers.TIMELINE_ARGV}`])
  })

  it('a_pull_request_that_cannot_be_read_leaves_the_row_incomplete_with_pr_null_and_names_the_read', () => {
    const { runner, repo, issue, index } = GitHubAnswers.pullRequestDown()
    const harvester = new SliceHarvest({ gh: runner.forArgv })

    const report = harvester.harvest({ repo, issue, index })

    expect(report.outcome).toBe(SliceHarvestOutcome.INCOMPLETE)
    expect(report.row.pr).toBeNull()
    expect(report.failures).toEqual([
      new SliceReadFailure({ read: SliceRead.PULL_REQUEST, subject: `PR #${GitHubAnswers.FIRST_PR}`, detail: 'gh: HTTP 502' }),
    ])
  })

  it('a_telemetry_file_that_cannot_be_read_lands_as_no_leido_and_names_its_path', () => {
    const { runner, repo, issue, index } = GitHubAnswers.telemetryFileDown()
    const harvester = new SliceHarvest({ gh: runner.forArgv })

    const report = harvester.harvest({ repo, issue, index })

    expect(report.outcome).toBe(SliceHarvestOutcome.INCOMPLETE)
    expect(report.row.telemetry.status).toBe(TelemetryStatus.NOT_READ)
    expect(report.row.telemetry.path).toBe(metricsRepoRelPath(GitHubAnswers.ISSUE_NUMBER))
    expect(report.failures).toEqual([
      new SliceReadFailure({
        read: SliceRead.TELEMETRY_FILE,
        subject: metricsRepoRelPath(GitHubAnswers.ISSUE_NUMBER),
        detail: 'gh: HTTP 502',
      }),
    ])
  })

  it('two_closing_pull_requests_are_reported_and_only_the_first_is_read', () => {
    const { runner, repo, issue, index } = GitHubAnswers.twoClosers()
    const harvester = new SliceHarvest({ gh: runner.forArgv })

    const report = harvester.harvest({ repo, issue, index })

    expect(report.closers).toEqual([GitHubAnswers.FIRST_PR, GitHubAnswers.SECOND_PR])
    expect(runner.spoken).toEqual([
      `gh ${GitHubAnswers.TIMELINE_ARGV}`,
      `gh ${GitHubAnswers.pullRequestArgv(GitHubAnswers.FIRST_PR)}`,
    ])
  })

  it('harvest_issue_asks_for_the_issue_with_the_exact_fields_and_a_failure_there_is_not_read', () => {
    const runner = new ScriptedRunner({
      program: 'gh',
      answers: { [GitHubAnswers.ISSUE_VIEW_ARGV]: RunnerAnswer.failed(1, 'gh: HTTP 502\n') },
      spoken: [],
    })
    const harvester = new SliceHarvest({ gh: runner.forArgv })

    const report = harvester.harvestIssue({
      repo: GitHubAnswers.REPO,
      number: GitHubAnswers.ISSUE_NUMBER,
      index: GitHubAnswers.indexWithoutFile(),
    })

    expect(report.outcome).toBe(SliceHarvestOutcome.NOT_READ)
    expect(report.failures).toEqual([
      new SliceReadFailure({ read: SliceRead.ISSUE, subject: `issue #${GitHubAnswers.ISSUE_NUMBER}`, detail: 'gh: HTTP 502' }),
    ])
    expect(runner.spoken).toEqual([`gh ${GitHubAnswers.ISSUE_VIEW_ARGV}`])
  })
})
