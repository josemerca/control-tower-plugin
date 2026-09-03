import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BigQueryTable, LoadOutcome } from '../scripts/bigquery-load.js'
import { HarvestLedger, LedgerIdentity } from '../scripts/harvest-ledger.js'
import { RunnerAnswer, ScriptedRunner } from './fixtures/scripted-runner.js'

class RecordingWorkspace {
  constructor(directory) {
    this.directory = directory
    this.creates = 0
    this.removedWith = null
  }

  create() {
    this.creates += 1
    return this.directory
  }

  remove(directory) {
    this.removedWith = directory
  }
}

class LedgerRows {
  static merged(overrides = {}) {
    return {
      issue: 12,
      title: 'a title',
      type: 'feature',
      gate: 'green',
      area: 'backend',
      readyToClaim: 100,
      claimToRelease: 200,
      releaseToMerge: 300,
      mergeSource: 'pr-merged',
      reopens: 0,
      requeues: 0,
      blocked: [],
      pr: 42,
      additions: 1,
      deletions: 1,
      changedFiles: 1,
      reviews: 1,
      reviewComments: 1,
      telemetry: { status: 'sin-fichero', path: null },
      ...overrides,
    }
  }

  static two() {
    return [LedgerRows.merged(), LedgerRows.merged({ issue: 13 })]
  }
}

class LedgerCase {
  static TABLE_ID = 'p:d.t'

  static table() {
    return BigQueryTable.parse(LedgerCase.TABLE_ID)
  }

  static identity({ nextId = () => 'uuid-1', now = () => '2026-09-03T10:00:00.000Z' } = {}) {
    return new LedgerIdentity({ pluginVersion: '1.2.3', actor: 'jponzvan', now, nextId })
  }

  static argvFor(directory) {
    return [
      '--project_id=p',
      '--headless',
      'load',
      '--source_format=NEWLINE_DELIMITED_JSON',
      '--schema_update_option=ALLOW_FIELD_ADDITION',
      `--schema=${join(directory, 'schema.json')}`,
      'p:d.t',
      join(directory, 'rows.ndjson'),
    ]
  }

  static ledgerWith({ bq, workspace, identity = LedgerCase.identity() }) {
    return new HarvestLedger({ table: LedgerCase.table(), bq, workspace, identity })
  }
}

describe('HarvestLedger mints an identity, projects the rows, loads them and decides the directory by outcome', () => {
  let directory

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'harvest-ledger-test-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('a_loaded_record_carries_the_harvest_id_it_minted_and_removes_the_directory_it_created', () => {
    const argv = LedgerCase.argvFor(directory)
    const bq = new ScriptedRunner({ program: 'bq', answers: { [argv.join(' ')]: RunnerAnswer.ok() }, spoken: [] })
    const workspace = new RecordingWorkspace(directory)
    const ledger = LedgerCase.ledgerWith({ bq: bq.forArgv, workspace })

    const report = ledger.record({ repo: 'o/r', milestone: 'M1', rows: LedgerRows.two() })

    expect(report.outcome).toBe(LoadOutcome.LOADED)
    expect(report.harvestId).toBe('uuid-1')
    expect(report.rowCount).toBe(2)
    expect(workspace.creates).toBe(1)
    expect(workspace.removedWith).toBe(directory)
    const lines = readFileSync(join(directory, 'rows.ndjson'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(JSON.parse(line).harvest_id).toBe('uuid-1')
  })

  it('a_rejected_record_leaves_the_directory_in_place_and_carries_code_detail_and_retry_command', () => {
    const argv = LedgerCase.argvFor(directory)
    const bq = new ScriptedRunner({ program: 'bq', answers: { [argv.join(' ')]: RunnerAnswer.failed(1, 'bq: permission denied\n') }, spoken: [] })
    const workspace = new RecordingWorkspace(directory)
    const ledger = LedgerCase.ledgerWith({ bq: bq.forArgv, workspace })

    const report = ledger.record({ repo: 'o/r', milestone: 'M1', rows: LedgerRows.two() })

    expect(report.outcome).toBe(LoadOutcome.REJECTED)
    expect(report.code).toBe(1)
    expect(report.detail).toBe('bq: permission denied')
    expect(report.retryCommand).toBe(`bq ${argv.join(' ')}`)
    expect(workspace.removedWith).toBeNull()
  })

  it('the_identity_from_the_environment_reads_the_plugin_version_from_its_own_manifest', () => {
    const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version

    const identity = LedgerIdentity.fromEnvironment()

    expect(identity.pluginVersion).toBe(version)
  })

  it('a_null_milestone_travels_as_null_in_every_row', () => {
    const argv = LedgerCase.argvFor(directory)
    const bq = new ScriptedRunner({ program: 'bq', answers: { [argv.join(' ')]: RunnerAnswer.ok() }, spoken: [] })
    const workspace = new RecordingWorkspace(directory)
    const ledger = LedgerCase.ledgerWith({ bq: bq.forArgv, workspace })

    ledger.record({ repo: 'o/r', milestone: null, rows: LedgerRows.two() })

    const lines = readFileSync(join(directory, 'rows.ndjson'), 'utf8').trim().split('\n')
    for (const line of lines) expect(JSON.parse(line).milestone).toBeNull()
  })
})
