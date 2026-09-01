import { PlanSession } from '../domain/plan-session.js'
import { PlanSessionNotStarted } from '../domain/exceptions.js'

export class CmuxPlanSession extends PlanSession {
  static #REF = /^OK\s+(workspace:\d+)\s*$/m

  constructor({ run }) {
    super()
    this.run = run
  }

  static argvFor(ticket, cwd) {
    return [
      'new-workspace',
      '--name', `ct-plan-${ticket}`,
      '--cwd', cwd,
      '--command', `echo "plan session up for ${ticket}"`,
    ]
  }

  async start(ticket) {
    let printed
    try {
      printed = await this.run(CmuxPlanSession.argvFor(ticket, process.cwd()))
    } catch (cause) {
      throw new PlanSessionNotStarted(cause.message)
    }
    const found = printed.match(CmuxPlanSession.#REF)
    if (found === null) {
      throw new PlanSessionNotStarted(
        `cmux did not name the workspace it created, it printed ${JSON.stringify(printed)}`
      )
    }
    return found[1]
  }
}
