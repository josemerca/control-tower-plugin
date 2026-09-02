import { ApiServer, LOOPBACK } from './api-server.js'
import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { AcliTickets } from './acli-tickets.js'
import { GhPlanIssues } from './gh-plan-issues.js'
import { StartPlan } from '../application/actions/start-plan.js'
import { ToolRunner } from './tool-runner.js'
import { Gh } from './gh.js'
import { SystemClock } from './system-clock.js'
import { ExternalTool } from './external-tool.js'
import { RetryPolicy } from '../domain/policies/retry-policy.js'
import { RetryBudget } from '../domain/value-objects/retry-budget.js'
import { Invocation, InvocationOutcome } from './invocation.js'

class CtApi {
  static #USAGE =
    `usage: ct-api.mjs (no arguments; set ${Invocation.PORT_VARIABLE} to pick a port, 0 for an ephemeral one)`
  static #BAD_USAGE = 2
  static #CANNOT_LISTEN = 1
  static #PROCESS_TIMEOUT_MS = 30_000
  static #RETRIES = 3
  static #SECONDS_BETWEEN_RETRIES = 2

  static #refuseUsage(reason) {
    process.stderr.write(`${reason}\n${CtApi.#USAGE}\n`)
    process.exit(CtApi.#BAD_USAGE)
  }

  static #refuseListen(reason) {
    process.stderr.write(`${reason}\n`)
    process.exit(CtApi.#CANNOT_LISTEN)
  }

  static #tool(bin) {
    const runner = new ToolRunner({ bin, budgetMs: CtApi.#PROCESS_TIMEOUT_MS })
    return (argv) => runner.run(argv)
  }

  static #talkingTo(bin, Tool) {
    return new Tool({
      launch: CtApi.#tool(bin),
      policy: new RetryPolicy({
        budget: new RetryBudget({
          attempts: CtApi.#RETRIES,
          waitSeconds: CtApi.#SECONDS_BETWEEN_RETRIES,
        }),
      }),
      clock: new SystemClock(),
    })
  }

  static async run(argv, environment) {
    const asked = Invocation.from(argv, environment)
    if (asked.outcome !== InvocationOutcome.READY) {
      CtApi.#refuseUsage(asked.reason)
    }
    const startPlan = new StartPlan({
      tickets: new AcliTickets({ acli: CtApi.#talkingTo(AcliTickets.BIN, ExternalTool) }),
      planIssues: new GhPlanIssues({ gh: CtApi.#talkingTo(Gh.BIN, Gh) }),
      planAgents: new CmuxPlanAgents({ run: CtApi.#tool(CmuxPlanAgents.BIN), cwd: process.cwd() }),
    })
    const server = new ApiServer({ port: asked.port, startPlan })
    let port
    try {
      port = await server.start()
    } catch (error) {
      CtApi.#refuseListen(`could not listen on ${LOOPBACK}: ${error.message}`)
    }
    process.stdout.write(`${JSON.stringify({ port })}\n`)
  }
}

await CtApi.run(process.argv.slice(2), process.env)
