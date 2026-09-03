import { describe, it, expect } from 'vitest'
import { HarvestColumn, HarvestIdentity, HarvestTable } from '../scripts/harvest-table.js'

class Identities {
  static today() {
    return new HarvestIdentity({
      harvestId: '11111111-1111-4111-8111-111111111111',
      harvestedAt: '2026-09-03T10:00:00.000Z',
      repo: 'o/r',
      milestone: 'E',
      pluginVersion: '0.53.0',
      actor: 'jponzvan',
    })
  }
}

class HarvestRows {
  static merged() {
    return {
      issue: 7,
      title: 'HarvestTable carries the schema',
      type: 'feature',
      gate: 'green',
      area: 'backend',
      readyToClaim: 120,
      claimToRelease: 3600,
      releaseToMerge: 900,
      mergeSource: 'pr-merged',
      reopens: 0,
      requeues: 1,
      blocked: [{ from: '2026-09-01T00:00:00.000Z', to: '2026-09-01T01:00:00.000Z', seconds: 3600 }],
      pr: 42,
      additions: 10,
      deletions: 2,
      changedFiles: 3,
      reviews: 1,
      reviewComments: 4,
      telemetry: HarvestRows.#telemetryOk(),
    }
  }

  static #telemetryOk() {
    return {
      status: 'ok',
      path: 'docs/superpowers/metrics/issue-7.jsonl',
      rows: 5,
      malformed: 1,
      verdicts: 4,
      measured: 4,
      legacy: 0,
      rubricSinVara: 2,
      findingsByRule: { patrones: 2, alcance: 1 },
      measuredVaraCtDocs: 4,
      legacyVaraCtDocs: 0,
      varaCtDocs: 12,
      measuredFindingsVaraCt: 4,
      legacyFindingsVaraCt: 0,
      findingsVaraCt: 6,
      briefAttempts: 2,
      briefMeasured: 2,
      briefLegacy: 0,
      briefVaraCtDocs: 8,
      briefBytes: 5000,
    }
  }

  static withTelemetry(overrides = {}) {
    return {
      ...HarvestRows.merged(),
      telemetry: { ...HarvestRows.#telemetryOk(), ...overrides },
    }
  }

  static withoutTelemetryFile() {
    return {
      ...HarvestRows.merged(),
      telemetry: {
        status: 'sin-fichero',
        path: null,
        rows: 9,
        malformed: 9,
        verdicts: 9,
        measured: 9,
        legacy: 9,
        rubricSinVara: 9,
        findingsByRule: { patrones: 9 },
        measuredVaraCtDocs: 9,
        legacyVaraCtDocs: 9,
        varaCtDocs: 9,
        measuredFindingsVaraCt: 9,
        legacyFindingsVaraCt: 9,
        findingsVaraCt: 9,
        briefAttempts: 9,
        briefMeasured: 9,
        briefLegacy: 9,
        briefVaraCtDocs: 9,
        briefBytes: 9,
      },
    }
  }

  static unmeasured() {
    return {
      ...HarvestRows.merged(),
      title: null,
      type: null,
      gate: null,
      area: null,
      readyToClaim: null,
      claimToRelease: null,
      releaseToMerge: null,
      mergeSource: null,
      blocked: [],
      pr: null,
      additions: null,
      deletions: null,
      changedFiles: null,
      reviews: null,
      reviewComments: null,
    }
  }

  static stillBlocked() {
    return {
      ...HarvestRows.merged(),
      blocked: [{ from: '2026-09-01T00:00:00.000Z', to: null, seconds: null }],
    }
  }
}

describe('a slice row projects to the wire object under the schema names', () => {
  it('the_row_of_a_slice_carries_the_identity_and_the_phases_in_seconds_under_the_schema_names', () => {
    const row = HarvestTable.rowFor({ row: HarvestRows.merged(), identity: Identities.today() })
    expect(row).toEqual({
      harvest_id: '11111111-1111-4111-8111-111111111111',
      harvested_at: '2026-09-03T10:00:00.000Z',
      repo: 'o/r',
      milestone: 'E',
      plugin_version: '0.53.0',
      actor: 'jponzvan',
      issue: 7,
      title: 'HarvestTable carries the schema',
      type: 'feature',
      gate: 'green',
      area: 'backend',
      ready_to_claim_seconds: 120,
      claim_to_release_seconds: 3600,
      release_to_merge_seconds: 900,
      merge_source: 'pr-merged',
      reopens: 0,
      requeues: 1,
      blocked: [{ started_at: '2026-09-01T00:00:00.000Z', ended_at: '2026-09-01T01:00:00.000Z', seconds: 3600 }],
      pr: 42,
      additions: 10,
      deletions: 2,
      changed_files: 3,
      reviews: 1,
      review_comments: 4,
      telemetry_status: 'ok',
      telemetry_path: 'docs/superpowers/metrics/issue-7.jsonl',
      verdicts: 4,
      malformed_lines: 1,
      rubric_sin_vara: 2,
      rubric_sin_vara_legacy: 0,
      rubric_vara_ct_docs: 12,
      rubric_vara_ct_docs_legacy: 0,
      findings_vara_ct: 6,
      findings_vara_ct_legacy: 0,
      findings_by_rule: [
        { rule: 'alcance', findings: 1 },
        { rule: 'patrones', findings: 2 },
      ],
      brief_attempts: 2,
      brief_legacy: 0,
      brief_vara_ct_docs: 8,
      brief_bytes: 5000,
    })
  })

  it('a_phase_nobody_measured_lands_as_null_and_never_as_zero', () => {
    const row = HarvestTable.rowFor({ row: HarvestRows.unmeasured(), identity: Identities.today() })
    expect(row.ready_to_claim_seconds).toBeNull()
    expect(row.claim_to_release_seconds).toBeNull()
    expect(row.release_to_merge_seconds).toBeNull()
  })

  it('a_blocked_episode_still_open_lands_with_ended_at_and_seconds_null', () => {
    const row = HarvestTable.rowFor({ row: HarvestRows.stillBlocked(), identity: Identities.today() })
    expect(row.blocked).toEqual([{ started_at: '2026-09-01T00:00:00.000Z', ended_at: null, seconds: null }])
  })

  it('a_row_missing_a_key_the_schema_consumes_raises_instead_of_landing_a_hole', () => {
    const row = HarvestRows.merged()
    delete row.reopens
    expect(() => HarvestTable.rowFor({ row, identity: Identities.today() })).toThrow(/reopens/)
  })

  it('a_column_type_outside_the_vocabulary_cannot_be_declared', () => {
    expect(() => new HarvestColumn({ name: 'issue', type: 'TIMESTAM', mode: HarvestColumn.REQUIRED, valueOf: () => null }))
      .toThrow(/unknown column type/)
  })

  it('the_schema_json_declares_blocked_as_a_repeated_record_with_its_three_fields', () => {
    const schema = JSON.parse(HarvestTable.schemaJson())
    const blocked = schema.find((column) => column.name === 'blocked')
    expect(blocked).toEqual({
      name: 'blocked',
      type: 'RECORD',
      mode: 'REPEATED',
      fields: [
        { name: 'started_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
        { name: 'ended_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
        { name: 'seconds', type: 'INTEGER', mode: 'NULLABLE' },
      ],
    })
  })

  it('a_measure_no_verdict_carried_lands_as_null_even_when_the_aggregate_says_zero', () => {
    const noVerdicts = HarvestTable.rowFor({
      row: HarvestRows.withTelemetry({ measured: 0, rubricSinVara: 0 }),
      identity: Identities.today(),
    })
    expect(noVerdicts.rubric_sin_vara).toBeNull()

    const someVerdicts = HarvestTable.rowFor({
      row: HarvestRows.withTelemetry({ measured: 2, rubricSinVara: 0 }),
      identity: Identities.today(),
    })
    expect(someVerdicts.rubric_sin_vara).toBe(0)
  })

  it('a_slice_without_telemetry_file_carries_its_status_and_null_in_every_count', () => {
    const row = HarvestTable.rowFor({ row: HarvestRows.withoutTelemetryFile(), identity: Identities.today() })
    expect(row.telemetry_status).toBe('sin-fichero')
    expect(row.telemetry_path).toBeNull()
    expect(row.verdicts).toBeNull()
    expect(row.malformed_lines).toBeNull()
    expect(row.rubric_sin_vara).toBeNull()
    expect(row.rubric_sin_vara_legacy).toBeNull()
    expect(row.rubric_vara_ct_docs).toBeNull()
    expect(row.rubric_vara_ct_docs_legacy).toBeNull()
    expect(row.findings_vara_ct).toBeNull()
    expect(row.findings_vara_ct_legacy).toBeNull()
    expect(row.findings_by_rule).toEqual([])
    expect(row.brief_attempts).toBeNull()
    expect(row.brief_legacy).toBeNull()
    expect(row.brief_vara_ct_docs).toBeNull()
    expect(row.brief_bytes).toBeNull()
  })

  it('findings_by_rule_land_as_repeated_records_sorted_by_rule', () => {
    const row = HarvestTable.rowFor({
      row: HarvestRows.withTelemetry({ findingsByRule: { patrones: 2, alcance: 1 } }),
      identity: Identities.today(),
    })
    expect(row.findings_by_rule).toEqual([
      { rule: 'alcance', findings: 1 },
      { rule: 'patrones', findings: 2 },
    ])
  })

  it('a_telemetry_status_outside_the_vocabulary_raises_instead_of_landing', () => {
    const row = HarvestRows.withTelemetry({ status: 'unexpected' })
    expect(() => HarvestTable.rowFor({ row, identity: Identities.today() })).toThrow(/unknown telemetry status/)
  })
})
