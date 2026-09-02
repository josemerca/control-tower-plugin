import { PlanAgents } from '../domain/ports/plan-agents.js'
import { PlanAgentNotLaunched, PlanAgentNotNamed } from '../domain/exceptions.js'

export class CmuxPlanAgents extends PlanAgents {
  static BIN = 'cmux'
  static #REF = /^OK\s+(workspace:\d+)\s*$/m

  constructor({ run, cwd }) {
    super()
    this.run = run
    this.cwd = cwd
  }

  static argvFor({ story, issue, cwd }) {
    return [
      'new-workspace',
      '--name', `ct-plan-${story}`,
      '--cwd', cwd,
      '--command', `echo "plan agent up for ${story} on issue ${issue}"`,
    ]
  }

  async launch({ story, issue }) {
    const argv = CmuxPlanAgents.argvFor({ story, issue, cwd: this.cwd })
    const output = await this.run(argv)
    if (output.failed) {
      throw new PlanAgentNotLaunched(`${CmuxPlanAgents.BIN} ${argv[0]} failed: ${output.stderr.trim()}`)
    }
    const printed = output.stdout
    const found = printed.match(CmuxPlanAgents.#REF)
    if (found === null) {
      throw new PlanAgentNotNamed(
        `cmux did not name the workspace it created, it printed ${JSON.stringify(printed)}`
      )
    }
    return found[1]
  }
}
