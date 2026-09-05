import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaimsDirectory } from '../src/claims-directory.js'
import { Claim, ClaimOutcome, IssueClaim } from '../src/issue-claim.js'

class Dispatchers {
  static overAFreshDirectory() {
    const root = join(mkdtempSync(join(tmpdir(), 'issue-claim-')), 'claims')
    return { claim: new IssueClaim({ claims: new ClaimsDirectory({ root }) }), root }
  }
}

describe('IssueClaim', () => {
  it('the first claim of an issue is taken and leaves the pid in the lock', () => {
    const { claim, root } = Dispatchers.overAFreshDirectory()
    assert.deepEqual(claim.take({ issue: 7, pid: 100 }), new Claim({ outcome: ClaimOutcome.TAKEN, by: 100 }))
    assert.equal(readFileSync(join(root, '7.lock'), 'utf8'), '100')
  })

  it('the second claim of the same issue is refused and names who holds it', () => {
    const { claim, root } = Dispatchers.overAFreshDirectory()
    claim.take({ issue: 7, pid: 100 })
    assert.deepEqual(claim.take({ issue: 7, pid: 200 }), new Claim({ outcome: ClaimOutcome.ALREADY_TAKEN, by: 100 }))
    assert.equal(readFileSync(join(root, '7.lock'), 'utf8'), '100')
  })
})
