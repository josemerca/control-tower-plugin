import { describe, it, expect } from 'vitest'
import { conflictTokens, detectCollisions, claimLost } from '../scripts/claim.js'

describe('conflictTokens', () => {
  it('comparte area:/touches:', () => {
    expect(conflictTokens(['area:api', 'touches:db'], ['area:api', 'touches:ui'])).toEqual(['area:api'])
  })
  it('ignora labels no area/touches', () => {
    expect(conflictTokens(['status:ready', 'type:backend'], ['status:in-progress', 'type:backend'])).toEqual([])
  })
  it('comparte múltiples tokens area: y touches:', () => {
    expect(conflictTokens(['area:api', 'touches:db'], ['area:api', 'touches:db'])).toEqual(['area:api', 'touches:db'])
  })
})

describe('detectCollisions', () => {
  it('solo choca con in-progress que comparten token', () => {
    const open = [
      { n: 10, labels: ['status:in-progress', 'touches:db'] },
      { n: 11, labels: ['status:ready', 'touches:db'] },
    ]
    const c = detectCollisions(['touches:db'], open)
    expect(c).toEqual([{ n: 10, tokens: ['touches:db'] }])
  })
  it('ignora in-progress que no comparten token', () => {
    const open = [
      { n: 10, labels: ['status:in-progress', 'touches:ui'] },
      { n: 11, labels: ['status:in-progress', 'touches:db'] },
    ]
    const c = detectCollisions(['touches:db'], open)
    expect(c).toEqual([{ n: 11, tokens: ['touches:db'] }])
  })
})

describe('claimLost (claim-then-verify)', () => {
  const readback = [
    { n: 7, labels: ['status:in-progress', 'touches:db'] },  // nosotros
    { n: 5, labels: ['status:in-progress', 'touches:db'] },  // otro, número menor
  ]
  it('perdemos si otro in-progress con token compartido tiene número menor', () => {
    expect(claimLost(readback, 7)).toBe(true)
  })
  it('ganamos si somos el menor', () => {
    const rb = [
      { n: 3, labels: ['status:in-progress', 'touches:db'] },
      { n: 9, labels: ['status:in-progress', 'touches:db'] },
    ]
    expect(claimLost(rb, 3)).toBe(false)
  })
  it('sin otros in-progress compartiendo token → no perdemos', () => {
    expect(claimLost([{ n: 7, labels: ['status:in-progress', 'touches:db'] }], 7)).toBe(false)
  })
  it('ignoramos in-progress de número menor si no comparten token', () => {
    const rb = [
      { n: 7, labels: ['status:in-progress', 'touches:db'] },  // nosotros
      { n: 5, labels: ['status:in-progress', 'touches:ui'] },  // otro, menor pero sin token compartido
    ]
    expect(claimLost(rb, 7)).toBe(false)
  })
  it('nuestro issue ausente del readback → no perdemos', () => {
    const rb = [
      { n: 5, labels: ['status:in-progress', 'touches:db'] },
    ]
    expect(claimLost(rb, 7)).toBe(false)
  })
})
