import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VerdictFile } from '../src/verdict-file.js'

class VerdictsOnDisk {
  static json(content) {
    const path = join(mkdtempSync(join(tmpdir(), 'verdict-file-')), 'verdict.json')
    writeFileSync(path, content)
    return path
  }
}

describe('VerdictFile', () => {
  it('a JSON verdict file is returned parsed', () => {
    const path = VerdictsOnDisk.json('{"ruling":"PASS","findings":[]}')
    assert.deepEqual(VerdictFile.read(path), { verdict: { ruling: 'PASS', findings: [] } })
  })

  it.todo('an unreadable verdict file is a discard, not a crash')
})
