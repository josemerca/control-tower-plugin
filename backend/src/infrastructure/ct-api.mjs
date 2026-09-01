import { ApiServer, LOOPBACK } from './api-server.js'
import { CmuxPlanSession } from './cmux-plan-session.js'
import { StartPlan } from '../application/actions/start-plan.js'
import { execFile } from 'node:child_process'
import { Invocation, InvocationOutcome } from './invocation.js'

class CtApi {
  static #USAGE =
    `usage: ct-api.mjs (no arguments; set ${Invocation.PORT_VARIABLE} to pick a port, 0 for an ephemeral one)`
  static #BAD_USAGE = 2
  static #CANNOT_LISTEN = 1
  static #CMUX_TIMEOUT_MS = 30_000

  static #refuseUsage(reason) {
    process.stderr.write(`${reason}\n${CtApi.#USAGE}\n`)
    process.exit(CtApi.#BAD_USAGE)
  }

  static #refuseListen(reason) {
    process.stderr.write(`${reason}\n`)
    process.exit(CtApi.#CANNOT_LISTEN)
  }

  static #cmux(cmuxArgv) {
    return new Promise((resolve, reject) => {
      execFile('cmux', cmuxArgv, { timeout: CtApi.#CMUX_TIMEOUT_MS }, (failure, stdout, stderr) => {
        if (failure === null) resolve(stdout)
        else reject(new Error(`cmux ${cmuxArgv[0]} failed: ${(stderr || failure.message).trim()}`))
      })
    })
  }

  static async run(argv, environment) {
    const asked = Invocation.from(argv, environment)
    if (asked.outcome !== InvocationOutcome.READY) {
      CtApi.#refuseUsage(asked.reason)
    }
    const planSession = new CmuxPlanSession({ run: (cmuxArgv) => CtApi.#cmux(cmuxArgv), cwd: process.cwd() })
    const server = new ApiServer({ port: asked.port, startPlan: new StartPlan({ planSession }) })
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
