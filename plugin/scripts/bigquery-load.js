import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LoadOutcome = Object.freeze({ LOADED: 'loaded', REJECTED: 'rejected' })

export class BigQueryTable {
  static ID = /^([A-Za-z0-9-]+):([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/

  #project
  #id

  constructor({ project, id }) {
    this.#project = project
    this.#id = id
    Object.freeze(this)
  }

  static parse(text) {
    const matched = BigQueryTable.ID.exec(text)
    return matched === null ? null : new BigQueryTable({ project: matched[1], id: text })
  }

  get project() {
    return this.#project
  }

  get id() {
    return this.#id
  }
}

export class LoadReport {
  constructor({ outcome, table, rowCount, directory, argv, code, detail }) {
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
    this.outcome = outcome
    this.table = table
    this.rowCount = rowCount
    this.directory = directory
    this.argv = Object.freeze([...argv])
    this.code = code
    this.detail = detail
    Object.freeze(this)
  }

  static loaded({ table, rowCount, directory, argv }) {
    return new LoadReport({ outcome: LoadOutcome.LOADED, table, rowCount, directory, argv, code: null, detail: null })
  }

  static rejected({ table, rowCount, directory, argv, code, detail }) {
    return new LoadReport({ outcome: LoadOutcome.REJECTED, table, rowCount, directory, argv, code, detail })
  }

  get retryCommand() {
    return [BigQueryLoad.PROGRAM, ...this.argv].join(' ')
  }
}

export class BigQueryLoad {
  static PROGRAM = 'bq'
  static ROWS_FILE = 'rows.ndjson'
  static SCHEMA_FILE = 'schema.json'
  static SOURCE_FORMAT = '--source_format=NEWLINE_DELIMITED_JSON'
  static SCHEMA_UPDATE = '--schema_update_option=ALLOW_FIELD_ADDITION'
  static SILENT_FAILURE = '(bq printed nothing on either channel)'

  constructor({ bq, directory }) {
    this.bq = bq
    this.directory = directory
    Object.freeze(this)
  }

  static argvFor({ table, directory }) {
    return [
      `--project_id=${table.project}`,
      '--headless',
      'load',
      BigQueryLoad.SOURCE_FORMAT,
      BigQueryLoad.SCHEMA_UPDATE,
      `--schema=${join(directory, BigQueryLoad.SCHEMA_FILE)}`,
      table.id,
      join(directory, BigQueryLoad.ROWS_FILE),
    ]
  }

  load({ table, rows, schemaJson }) {
    writeFileSync(join(this.directory, BigQueryLoad.ROWS_FILE), rows.map((row) => `${JSON.stringify(row)}\n`).join(''))
    writeFileSync(join(this.directory, BigQueryLoad.SCHEMA_FILE), schemaJson)
    const argv = BigQueryLoad.argvFor({ table, directory: this.directory })
    const answer = this.bq(argv)
    if (answer.code === 0) {
      return LoadReport.loaded({ table, rowCount: rows.length, directory: this.directory, argv })
    }
    const detail = answer.stderr.trim() || answer.stdout.trim() || BigQueryLoad.SILENT_FAILURE
    return LoadReport.rejected({ table, rowCount: rows.length, directory: this.directory, argv, code: answer.code, detail })
  }
}
