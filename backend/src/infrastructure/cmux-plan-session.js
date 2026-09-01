import { PlanSession } from '../domain/plan-session.js'
import { PlanSessionNotStarted, PlanSessionNotNamed } from '../domain/exceptions.js'

export class CmuxPlanSession extends PlanSession {
  static #REF = /^OK\s+(workspace:\d+)\s*$/m

  constructor({ run, cwd }) {
    super()
    this.run = run
    this.cwd = cwd
  }

  static argvFor({ ticket, issue, cwd }) {
    return [
      'new-workspace',
      '--name', `ct-plan-${ticket}`,
      '--cwd', cwd,
      '--command', `echo "plan session up for ${ticket} on issue ${issue}"`,
    ]
  }

  async start({ ticket, issue }) {
    let printed
    try {
      printed = await this.run(CmuxPlanSession.argvFor({ ticket, issue, cwd: this.cwd }))
    } catch (cause) {
      throw new PlanSessionNotStarted(cause.message)
    }
    const found = printed.match(CmuxPlanSession.#REF)
    if (found === null) {
      throw new PlanSessionNotNamed(
        `cmux did not name the workspace it created, it printed ${JSON.stringify(printed)}`
      )
    }
    return found[1]
  }
}
