import { GhFailure } from './gh-failure.js'

export class GhCall {
  static BIN = 'gh'

  constructor({ run, policy, clock }) {
    this.run = run
    this.policy = policy
    this.clock = clock
  }

  async make(argv, { safeToRepeat }) {
    let output = await this.run(argv)
    let attempted = 0
    while (output.failed) {
      const decision = this.policy.afterAFailure({
        transient: GhFailure.isTransient(output.stderr),
        safeToRepeat,
        attempted,
      })
      if (!decision.retry) break

      await this.clock.sleep(decision.waitSeconds)
      output = await this.run(argv)
      attempted += 1
    }

    return output
  }
}
