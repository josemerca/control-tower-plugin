import { METRICS_REPO_DIR } from './run-metrics.js'

export const SliceRead = Object.freeze({
  ISSUE: 'gh issue view',
  TIMELINE: 'gh api timeline',
  PULL_REQUEST: 'gh pr view',
  TELEMETRY_INDEX: 'gh api contents (dir)',
  TELEMETRY_FILE: 'gh api contents',
})

export const SliceHarvestOutcome = Object.freeze({
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  NOT_READ: 'not-read',
})

export const IndexOutcome = Object.freeze({
  LISTED: 'listed',
  NOT_READ: 'not-read',
})

export class SliceReadFailure {
  constructor({ read, subject, detail }) {
    if (!Object.values(SliceRead).includes(read)) {
      throw new Error(`read must be a SliceRead member, got ${JSON.stringify(read)}`)
    }
    if (!(typeof subject === 'string' && subject.length > 0)) {
      throw new Error(`subject must be a non-empty string, got ${JSON.stringify(subject)}`)
    }
    if (!(typeof detail === 'string' && detail.length > 0)) {
      throw new Error(`detail must be a non-empty string, got ${JSON.stringify(detail)}`)
    }
    this.read = read
    this.subject = subject
    this.detail = detail
    Object.freeze(this)
  }
}

export class TelemetryIndex {
  constructor({ outcome, files, detail }) {
    if (!Object.values(IndexOutcome).includes(outcome)) {
      throw new Error(`outcome must be an IndexOutcome member, got ${JSON.stringify(outcome)}`)
    }
    const notRead = outcome === IndexOutcome.NOT_READ
    if (notRead !== (typeof detail === 'string' && detail.length > 0)) {
      throw new Error(`outcome ${outcome} disagrees with the detail given, got ${JSON.stringify(detail)}`)
    }
    this.outcome = outcome
    this.files = Object.freeze([...files])
    this.detail = detail
    Object.freeze(this)
  }

  has(fileName) {
    return this.files.includes(fileName)
  }

  static read({ gh, repo }) {
    const answer = gh(['api', `repos/${repo}/contents/${METRICS_REPO_DIR}`])
    if (answer.code !== 0) {
      return new TelemetryIndex({ outcome: IndexOutcome.NOT_READ, files: [], detail: TelemetryIndex.#diagnosisOf(answer) })
    }
    let parsed
    try {
      parsed = JSON.parse(answer.stdout)
    } catch (malformed) {
      return new TelemetryIndex({ outcome: IndexOutcome.NOT_READ, files: [], detail: malformed.message })
    }
    if (!Array.isArray(parsed)) {
      return new TelemetryIndex({ outcome: IndexOutcome.NOT_READ, files: [], detail: TelemetryIndex.#diagnosisOf(answer) })
    }
    const files = parsed.filter((entry) => entry.type === 'file').map((entry) => entry.name)
    return new TelemetryIndex({ outcome: IndexOutcome.LISTED, files, detail: null })
  }

  static #diagnosisOf(answer) {
    return answer.stderr.trim() || answer.stdout.trim() || '(gh printed nothing)'
  }
}

export class SliceHarvestReport {
  constructor({ outcome, row, failures, closers }) {
    if (!Object.values(SliceHarvestOutcome).includes(outcome)) {
      throw new Error(`outcome must be a SliceHarvestOutcome member, got ${JSON.stringify(outcome)}`)
    }
    const notRead = outcome === SliceHarvestOutcome.NOT_READ
    if (notRead !== (row === null)) {
      throw new Error(`outcome ${outcome} disagrees with the row given, got ${JSON.stringify(row)}`)
    }
    const hasFailures = failures.length > 0
    if (outcome === SliceHarvestOutcome.COMPLETE && hasFailures) {
      throw new Error(`outcome ${outcome} carries failures, got ${JSON.stringify(failures)}`)
    }
    if (outcome === SliceHarvestOutcome.INCOMPLETE && !hasFailures) {
      throw new Error(`outcome ${outcome} carries no failure, got ${JSON.stringify(failures)}`)
    }
    if (notRead && failures.length !== 1) {
      throw new Error(`outcome ${outcome} carries exactly one failure, got ${JSON.stringify(failures)}`)
    }
    if (notRead && closers.length !== 0) {
      throw new Error(`outcome ${outcome} carries no closers, got ${JSON.stringify(closers)}`)
    }
    this.outcome = outcome
    this.row = row
    this.failures = Object.freeze([...failures])
    this.closers = Object.freeze([...closers])
    Object.freeze(this)
  }

  static notRead(failure) {
    return new SliceHarvestReport({ outcome: SliceHarvestOutcome.NOT_READ, row: null, failures: [failure], closers: [] })
  }

  static of({ row, failures, closers }) {
    const outcome = failures.length > 0 ? SliceHarvestOutcome.INCOMPLETE : SliceHarvestOutcome.COMPLETE
    return new SliceHarvestReport({ outcome, row, failures, closers })
  }
}
