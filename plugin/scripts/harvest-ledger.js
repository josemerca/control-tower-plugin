import { userInfo } from 'node:os'
import { randomUUID } from 'node:crypto'
import { HarvestIdentity, HarvestTable } from './harvest-table.js'
import { BigQueryLoad, LoadOutcome } from './bigquery-load.js'
import { PluginManifest } from './plugin-manifest.js'

export class LedgerIdentity {
  constructor({ pluginVersion, actor, now, nextId }) {
    this.pluginVersion = pluginVersion
    this.actor = actor
    this.now = now
    this.nextId = nextId
    Object.freeze(this)
  }

  static fromEnvironment() {
    return new LedgerIdentity({
      pluginVersion: PluginManifest.installed().version,
      actor: userInfo().username,
      now: () => new Date().toISOString(),
      nextId: () => randomUUID(),
    })
  }
}

export class LedgerReport {
  constructor({ outcome, table, rowCount, harvestId, directory, code, detail, retryCommand }) {
    if (!Object.values(LoadOutcome).includes(outcome)) {
      throw new Error(`outcome must be a LoadOutcome member, got ${JSON.stringify(outcome)}`)
    }
    const rejected = outcome === LoadOutcome.REJECTED
    if (rejected !== (code !== null)) {
      throw new Error(`outcome ${outcome} disagrees with the code given, got ${JSON.stringify(code)}`)
    }
    if (rejected !== (typeof detail === 'string' && detail.length > 0)) {
      throw new Error(`outcome ${outcome} disagrees with the detail given, got ${JSON.stringify(detail)}`)
    }
    if (rejected !== (typeof retryCommand === 'string' && retryCommand.length > 0)) {
      throw new Error(`outcome ${outcome} disagrees with the retry command given, got ${JSON.stringify(retryCommand)}`)
    }
    this.outcome = outcome
    this.table = table
    this.rowCount = rowCount
    this.harvestId = harvestId
    this.directory = directory
    this.code = code
    this.detail = detail
    this.retryCommand = retryCommand
    Object.freeze(this)
  }

  static from({ identity, load }) {
    const rejected = load.outcome === LoadOutcome.REJECTED
    return new LedgerReport({
      outcome: load.outcome,
      table: load.table,
      rowCount: load.rowCount,
      harvestId: identity.harvestId,
      directory: load.directory,
      code: load.code,
      detail: load.detail,
      retryCommand: rejected ? load.retryCommand : null,
    })
  }
}

export class HarvestLedger {
  constructor({ table, bq, workspace, identity }) {
    this.table = table
    this.bq = bq
    this.workspace = workspace
    this.identity = identity
    Object.freeze(this)
  }

  record({ repo, milestone, rows }) {
    const directory = this.workspace.create()
    const harvestIdentity = new HarvestIdentity({
      harvestId: this.identity.nextId(),
      harvestedAt: this.identity.now(),
      repo,
      milestone,
      pluginVersion: this.identity.pluginVersion,
      actor: this.identity.actor,
    })
    const projectedRows = rows.map((row) => HarvestTable.rowFor({ row, identity: harvestIdentity }))
    const load = new BigQueryLoad({ bq: this.bq, directory }).load({ table: this.table, rows: projectedRows, schemaJson: HarvestTable.schemaJson() })
    if (load.outcome === LoadOutcome.LOADED) this.workspace.remove(directory)
    return LedgerReport.from({ identity: harvestIdentity, load })
  }
}
