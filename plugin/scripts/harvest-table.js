export const TelemetryStatus = Object.freeze({
  OK: 'ok',
  NO_FILE: 'sin-fichero',
  NOT_READ: 'no-leido',
})

export class HarvestIdentity {
  constructor({ harvestId, harvestedAt, repo, milestone, pluginVersion, actor }) {
    this.harvestId = harvestId
    this.harvestedAt = harvestedAt
    this.repo = repo
    this.milestone = milestone
    this.pluginVersion = pluginVersion
    this.actor = actor
    Object.freeze(this)
  }
}

export class HarvestColumn {
  static REQUIRED = 'REQUIRED'
  static NULLABLE = 'NULLABLE'
  static REPEATED = 'REPEATED'

  static STRING = 'STRING'
  static TIMESTAMP = 'TIMESTAMP'
  static INTEGER = 'INTEGER'
  static RECORD = 'RECORD'

  constructor({ name, type, mode, fields = null, valueOf }) {
    if (!HarvestColumn.#TYPES.includes(type)) {
      throw new Error(`unknown column type "${type}"`)
    }
    if (!HarvestColumn.#MODES.includes(mode)) {
      throw new Error(`unknown column mode "${mode}"`)
    }
    this.name = name
    this.type = type
    this.mode = mode
    this.fields = fields
    this.valueOf = valueOf
    Object.freeze(this)
  }

  declaration() {
    const projection = { name: this.name, type: this.type, mode: this.mode }
    if (this.type === HarvestColumn.RECORD) projection.fields = this.fields.map((field) => field.declaration())
    return projection
  }

  static #TYPES = Object.freeze([HarvestColumn.STRING, HarvestColumn.TIMESTAMP, HarvestColumn.INTEGER, HarvestColumn.RECORD])
  static #MODES = Object.freeze([HarvestColumn.REQUIRED, HarvestColumn.NULLABLE, HarvestColumn.REPEATED])
}

export class HarvestTable {
  static #missing(key) {
    throw new Error(`the harvest row carries no "${key}"`)
  }

  static #valueAt(source, key) {
    const value = source[key]
    if (value === undefined) HarvestTable.#missing(key)
    return value
  }

  static #fromRow(key) {
    return (row) => HarvestTable.#valueAt(row, key)
  }

  static #fromIdentity(key) {
    return (row, identity) => HarvestTable.#valueAt(identity, key)
  }

  static #fromEpisode(key) {
    return (episode) => HarvestTable.#valueAt(episode, key)
  }

  static #BLOCKED_FIELDS = [
    new HarvestColumn({ name: 'started_at', type: HarvestColumn.TIMESTAMP, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#episodeStart }),
    new HarvestColumn({ name: 'ended_at', type: HarvestColumn.TIMESTAMP, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromEpisode('to') }),
    new HarvestColumn({ name: 'seconds', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromEpisode('seconds') }),
  ]

  static #episodeStart(episode) {
    const { from: startedAt } = episode
    if (startedAt === undefined) HarvestTable.#missing('blocked.started_at')
    return startedAt
  }

  static #blockedRows(row) {
    return HarvestTable.#valueAt(row, 'blocked').map((episode) => Object.fromEntries(
      HarvestTable.#BLOCKED_FIELDS.map((field) => [field.name, field.valueOf(episode)])
    ))
  }

  static #fromTelemetryField(key) {
    return (row) => HarvestTable.#valueAt(HarvestTable.#valueAt(row, 'telemetry'), key)
  }

  static #telemetryStatus(row) {
    const status = HarvestTable.#fromTelemetryField('status')(row)
    if (!Object.values(TelemetryStatus).includes(status)) {
      throw new Error(`unknown telemetry status "${status}"`)
    }
    return status
  }

  static #whenTelemetryIsOk(key) {
    return (row) => {
      const telemetry = HarvestTable.#valueAt(row, 'telemetry')
      return telemetry.status === TelemetryStatus.OK ? HarvestTable.#valueAt(telemetry, key) : null
    }
  }

  static #whenTelemetryMeasured(measuredKey, valueKey) {
    return (row) => {
      const telemetry = HarvestTable.#valueAt(row, 'telemetry')
      if (telemetry.status !== TelemetryStatus.OK) return null
      return HarvestTable.#valueAt(telemetry, measuredKey) > 0 ? HarvestTable.#valueAt(telemetry, valueKey) : null
    }
  }

  static #ruleCountEntryField(index) {
    return (entry) => entry[index]
  }

  static #RULE_COUNT_FIELDS = [
    new HarvestColumn({ name: 'rule', type: HarvestColumn.STRING, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#ruleCountEntryField(0) }),
    new HarvestColumn({ name: 'findings', type: HarvestColumn.INTEGER, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#ruleCountEntryField(1) }),
  ]

  static #findingsByRuleRows(row) {
    const telemetry = HarvestTable.#valueAt(row, 'telemetry')
    if (telemetry.status !== TelemetryStatus.OK) return []
    return Object.entries(HarvestTable.#valueAt(telemetry, 'findingsByRule'))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map((entry) => Object.fromEntries(HarvestTable.#RULE_COUNT_FIELDS.map((field) => [field.name, field.valueOf(entry)])))
  }

  static SCHEMA = [
    new HarvestColumn({ name: 'harvest_id', type: HarvestColumn.STRING, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#fromIdentity('harvestId') }),
    new HarvestColumn({ name: 'harvested_at', type: HarvestColumn.TIMESTAMP, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#fromIdentity('harvestedAt') }),
    new HarvestColumn({ name: 'repo', type: HarvestColumn.STRING, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#fromIdentity('repo') }),
    new HarvestColumn({ name: 'milestone', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromIdentity('milestone') }),
    new HarvestColumn({ name: 'plugin_version', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromIdentity('pluginVersion') }),
    new HarvestColumn({ name: 'actor', type: HarvestColumn.STRING, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#fromIdentity('actor') }),
    new HarvestColumn({ name: 'issue', type: HarvestColumn.INTEGER, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#fromRow('issue') }),
    new HarvestColumn({ name: 'title', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('title') }),
    new HarvestColumn({ name: 'type', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('type') }),
    new HarvestColumn({ name: 'gate', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('gate') }),
    new HarvestColumn({ name: 'area', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('area') }),
    new HarvestColumn({ name: 'ready_to_claim_seconds', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('readyToClaim') }),
    new HarvestColumn({ name: 'claim_to_release_seconds', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('claimToRelease') }),
    new HarvestColumn({ name: 'release_to_merge_seconds', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('releaseToMerge') }),
    new HarvestColumn({ name: 'merge_source', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('mergeSource') }),
    new HarvestColumn({ name: 'reopens', type: HarvestColumn.INTEGER, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#fromRow('reopens') }),
    new HarvestColumn({ name: 'requeues', type: HarvestColumn.INTEGER, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#fromRow('requeues') }),
    new HarvestColumn({ name: 'blocked', type: HarvestColumn.RECORD, mode: HarvestColumn.REPEATED, fields: HarvestTable.#BLOCKED_FIELDS, valueOf: HarvestTable.#blockedRows }),
    new HarvestColumn({ name: 'pr', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('pr') }),
    new HarvestColumn({ name: 'additions', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('additions') }),
    new HarvestColumn({ name: 'deletions', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('deletions') }),
    new HarvestColumn({ name: 'changed_files', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('changedFiles') }),
    new HarvestColumn({ name: 'reviews', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('reviews') }),
    new HarvestColumn({ name: 'review_comments', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromRow('reviewComments') }),
    new HarvestColumn({ name: 'telemetry_status', type: HarvestColumn.STRING, mode: HarvestColumn.REQUIRED, valueOf: HarvestTable.#telemetryStatus }),
    new HarvestColumn({ name: 'telemetry_path', type: HarvestColumn.STRING, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#fromTelemetryField('path') }),
    new HarvestColumn({ name: 'verdicts', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('verdicts') }),
    new HarvestColumn({ name: 'verdicts_fail', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('fails') }),
    new HarvestColumn({ name: 'malformed_lines', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('malformed') }),
    new HarvestColumn({ name: 'findings_high', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('measuredSeverities', 'findingsHigh') }),
    new HarvestColumn({ name: 'findings_medium', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('measuredSeverities', 'findingsMedium') }),
    new HarvestColumn({ name: 'findings_low', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('measuredSeverities', 'findingsLow') }),
    new HarvestColumn({ name: 'findings_severity_legacy', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('legacySeverities') }),
    new HarvestColumn({ name: 'rubric_sin_vara', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('measured', 'rubricSinVara') }),
    new HarvestColumn({ name: 'rubric_sin_vara_legacy', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('legacy') }),
    new HarvestColumn({ name: 'rubric_vara_ct_docs', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('measuredVaraCtDocs', 'varaCtDocs') }),
    new HarvestColumn({ name: 'rubric_vara_ct_docs_legacy', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('legacyVaraCtDocs') }),
    new HarvestColumn({ name: 'findings_vara_ct', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('measuredFindingsVaraCt', 'findingsVaraCt') }),
    new HarvestColumn({ name: 'findings_vara_ct_legacy', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('legacyFindingsVaraCt') }),
    new HarvestColumn({ name: 'findings_by_rule', type: HarvestColumn.RECORD, mode: HarvestColumn.REPEATED, fields: HarvestTable.#RULE_COUNT_FIELDS, valueOf: HarvestTable.#findingsByRuleRows }),
    new HarvestColumn({ name: 'brief_attempts', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('briefAttempts') }),
    new HarvestColumn({ name: 'brief_legacy', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryIsOk('briefLegacy') }),
    new HarvestColumn({ name: 'brief_vara_ct_docs', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('briefMeasured', 'briefVaraCtDocs') }),
    new HarvestColumn({ name: 'brief_bytes', type: HarvestColumn.INTEGER, mode: HarvestColumn.NULLABLE, valueOf: HarvestTable.#whenTelemetryMeasured('briefMeasured', 'briefBytes') }),
  ]

  static schemaJson() {
    return JSON.stringify(HarvestTable.SCHEMA.map((column) => column.declaration()))
  }

  static rowFor({ row, identity }) {
    return Object.fromEntries(HarvestTable.SCHEMA.map((column) => [column.name, column.valueOf(row, identity)]))
  }
}
