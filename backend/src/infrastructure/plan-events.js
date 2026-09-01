import { PlanState } from '../domain/plan-state.js'

export class PlanEvents {
  static TICK_MS = 3_000

  constructor({ read, sleep }) {
    this.read = read
    this.sleep = sleep
  }

  static frameFor(state) {
    return `data: ${JSON.stringify({ state })}\n\n`
  }

  async *stream(subject, cancelled = () => false) {
    let last = null
    for (;;) {
      const read = await this.read(subject)
      if (read.state !== last) {
        last = read.state
        yield PlanEvents.frameFor(read.state)
      }
      if (read.state === PlanState.READY) return
      await this.sleep()
      if (cancelled()) return
    }
  }
}
