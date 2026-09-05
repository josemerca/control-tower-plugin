import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReportFile } from '../src/report-file.js'

class ReportsOnDisk {
  static json(content) {
    const path = join(mkdtempSync(join(tmpdir(), 'report-file-')), 'report.json')
    writeFileSync(path, content)
    return path
  }
}

describe('ReportFile', () => {
  it('a JSON report file is returned parsed', () => {
    const path = ReportsOnDisk.json('{"paths":["a.js"],"summary":"done"}')
    assert.deepEqual(ReportFile.read(path), { report: { paths: ['a.js'], summary: 'done' } })
  })

  it('an unreadable report file is a discard, not a crash', () => {
    assert.deepEqual(ReportFile.read('/nope/report.json'), { why: 'report file not readable: /nope/report.json' })
  })
})
