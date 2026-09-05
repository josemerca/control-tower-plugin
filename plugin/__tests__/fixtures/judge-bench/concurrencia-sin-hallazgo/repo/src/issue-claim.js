import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

export const ClaimOutcome = Object.freeze({
  TAKEN: 'taken',
  ALREADY_TAKEN: 'already-taken',
})

export class Claim {
  constructor({ outcome, by }) {
    this.outcome = outcome
    this.by = by
    Object.freeze(this)
  }
}

export class IssueClaim {
  constructor({ claims }) {
    this.claims = claims
    Object.freeze(this)
  }

  take({ issue, pid }) {
    mkdirSync(this.claims.root, { recursive: true })
    const lock = this.claims.lockOf(issue)
    if (existsSync(lock)) {
      return new Claim({ outcome: ClaimOutcome.ALREADY_TAKEN, by: Number(readFileSync(lock, 'utf8')) })
    }
    writeFileSync(lock, String(pid))
    return new Claim({ outcome: ClaimOutcome.TAKEN, by: pid })
  }
}
