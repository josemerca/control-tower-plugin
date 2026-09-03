import { describe, it, expect } from 'vitest'
import { METRICS_REPO_DIR } from '../scripts/run-metrics.js'
import {
  IndexOutcome,
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
