import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ClaimsDirectory } from '../src/claims-directory.js'

describe('ClaimsDirectory', () => {
  it('the lock of an issue lives under the root, named by its number', () => {
    const claims = new ClaimsDirectory({ root: '/repo/.agent/claims' })
    assert.equal(claims.lockOf(7), '/repo/.agent/claims/7.lock')
  })

  it('an issue that is not a positive integer has no lock and says so', () => {
    const claims = new ClaimsDirectory({ root: '/repo/.agent/claims' })
    assert.throws(() => claims.lockOf('7'), RangeError)
  })
})
