import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BigQueryLoad, BigQueryTable, LoadOutcome } from '../scripts/bigquery-load.js'

class RunnerAnswer {
  static ok() {
    return { code: 0, stdout: '', stderr: '' }
  }

  static failed(code, stderr) {
    return { code, stdout: '', stderr }
  }

  static failedSilently(code, stdout) {
    return { code, stdout, stderr: '' }
  }

  static failedOnBothChannels(code) {
    return { code, stdout: '', stderr: '' }
  }
}

class ScriptedBq {
  constructor(answers) {
    this.answers = answers
    this.spoken = []
  }

  get runner() {
    return (argv) => {
      this.spoken.push(argv)
      const asked = argv.join(' ')
      if (!Object.hasOwn(this.answers, asked)) {
        throw new Error(`nobody wrote an answer for: bq ${asked}`)
      }
      return this.answers[asked]
    }
  }
}

class LoadCase {
  static TABLE_ID = 'p:d.t'

  static table() {
    return BigQueryTable.parse(LoadCase.TABLE_ID)
  }

  static rows() {
    return [
      { issue: 12, telemetry_status: 'ok' },
      { issue: 13, telemetry_status: 'sin-fichero' },
    ]
  }

  static schemaJson() {
    return '[{"name":"issue","type":"INTEGER","mode":"REQUIRED"}]'
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

  static loadWith(bq, directory) {
    return new BigQueryLoad({ bq, directory }).load({ table: LoadCase.table(), rows: LoadCase.rows(), schemaJson: LoadCase.schemaJson() })
  }
}

describe('BigQueryLoad writes the two files on disk and calls bq with the exact argv', () => {
  let directory

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'bigquery-load-test-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('a_load_writes_one_line_per_row_the_schema_and_calls_bq_with_the_exact_argv', () => {
    const argv = LoadCase.argvFor(directory)
    const bq = new ScriptedBq({ [argv.join(' ')]: RunnerAnswer.ok() })
    const rows = LoadCase.rows()

    const report = LoadCase.loadWith(bq.runner, directory)

    expect(report.outcome).toBe(LoadOutcome.LOADED)
    expect(bq.spoken).toEqual([argv])
    expect(readFileSync(join(directory, 'rows.ndjson'), 'utf8')).toBe(`${JSON.stringify(rows[0])}\n${JSON.stringify(rows[1])}\n`)
    expect(readFileSync(join(directory, 'schema.json'), 'utf8')).toBe(LoadCase.schemaJson())
  })

  it('a_non_zero_exit_of_bq_is_a_rejected_report_that_carries_the_code_the_diagnosis_and_the_retry_command', () => {
    const argv = LoadCase.argvFor(directory)
    const bq = new ScriptedBq({ [argv.join(' ')]: RunnerAnswer.failed(1, 'bq: permission denied\n') })

    const report = LoadCase.loadWith(bq.runner, directory)

    expect(report.outcome).toBe(LoadOutcome.REJECTED)
    expect(report.code).toBe(1)
    expect(report.detail).toBe('bq: permission denied')
    expect(report.retryCommand).toBe(`bq ${argv.join(' ')}`)
  })

  it('a_failure_with_silent_stderr_still_carries_the_exit_code_and_reads_stdout_as_the_diagnosis', () => {
    const argv = LoadCase.argvFor(directory)
    const bq = new ScriptedBq({ [argv.join(' ')]: RunnerAnswer.failedSilently(2, 'fake-bq: load failed\n') })

    const report = LoadCase.loadWith(bq.runner, directory)

    expect(report.outcome).toBe(LoadOutcome.REJECTED)
    expect(report.code).toBe(2)
    expect(report.detail).toBe('fake-bq: load failed')
  })

  it('a_failure_silent_on_both_channels_still_yields_a_rejected_report_with_its_code', () => {
    const argv = LoadCase.argvFor(directory)
    const bq = new ScriptedBq({ [argv.join(' ')]: RunnerAnswer.failedOnBothChannels(127) })

    const report = LoadCase.loadWith(bq.runner, directory)

    expect(report.outcome).toBe(LoadOutcome.REJECTED)
    expect(report.code).toBe(127)
    expect(report.detail).toBe(BigQueryLoad.SILENT_FAILURE)
    expect(report.retryCommand).toBe(`bq ${argv.join(' ')}`)
  })
})

describe('a table id is only well formed with a project, a dataset and a table, and nothing after', () => {
  it('a_table_id_without_project_or_with_a_space_does_not_parse', () => {
    expect(BigQueryTable.parse('p:d.t')).not.toBeNull()
    expect(BigQueryTable.parse('d.t')).toBeNull()
    expect(BigQueryTable.parse('p:d')).toBeNull()
    expect(BigQueryTable.parse('p:d.t x')).toBeNull()
  })
})
