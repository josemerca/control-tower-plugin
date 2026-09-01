import { PlanSession } from '../domain/plan-session.js'
import { PlanSessionNotStarted, PlanSessionNotNamed, PlanSessionDidNotRun } from '../domain/exceptions.js'
import { CmuxLauncher } from './cmux-launcher.js'

export class CmuxPlanSession extends PlanSession {
  static BIN = 'cmux'
  static AGENT = 'claude'
  static ATTEMPTS = 20
  static #REF = /^OK\s+(workspace:\d+)\s*$/m

  constructor({ run, write, read, remove, sleep, runsIn }) {
    super()
    this.run = run
    this.write = write
    this.read = read
    this.remove = remove
    this.sleep = sleep
    this.runsIn = runsIn
  }

  static nameFor(ticket) {
    return `ct-plan-${ticket}`
  }

  static argvFor(briefing, typed) {
    return [
      'new-workspace',
      '--name', CmuxPlanSession.nameFor(briefing.ticket),
      '--cwd', briefing.located.path,
      '--command', typed,
    ]
  }

  static sendArgvFor(name, typed) {
    return ['send', '--workspace', name, typed]
  }

  static enterArgvFor(name) {
    return ['send-key', '--workspace', name, 'Enter']
  }

  async start(briefing) {
    const directory = `${this.runsIn}/${briefing.issue.number}`
    const script = `${directory}/${CmuxLauncher.SCRIPT_NAME}`
    const sentinel = `${directory}/${CmuxLauncher.SENTINEL_NAME}`
    const typed = CmuxLauncher.typedFor(script)
    await this.remove(sentinel)
    await this.write(script, CmuxLauncher.scriptFor({
      sentinel,
      errand: briefing.errand,
      bin: CmuxPlanSession.AGENT,
    }))
    const handle = await this.#open(briefing, typed)
    await this.#confirm({ briefing, sentinel, typed })

    return handle
  }

  async #open(briefing, typed) {
    const output = await this.run(CmuxPlanSession.argvFor(briefing, typed))
    if (output.failed) {
      throw new PlanSessionNotStarted(`${CmuxPlanSession.BIN} new-workspace failed: ${output.stderr.trim()}`)
    }
    const found = output.stdout.match(CmuxPlanSession.#REF)
    if (found === null) {
      throw new PlanSessionNotNamed(
        `cmux did not name the workspace it created, it printed ${JSON.stringify(output.stdout)}`
      )
    }

    return found[1]
  }

  async #confirm({ briefing, sentinel, typed }) {
    const seen = await this.#await(sentinel, CmuxPlanSession.ATTEMPTS)
    if (seen === null) {
      await this.#resend(briefing, typed)
      const retried = await this.#await(sentinel, CmuxPlanSession.ATTEMPTS)
      if (retried === null) {
        throw new PlanSessionDidNotRun(
          `la ventana de cmux se abrió pero el centinela nunca apareció en ${sentinel}: la orden no llegó a ejecutarse`
        )
      }

      return CmuxPlanSession.#judge(retried, briefing)
    }

    return CmuxPlanSession.#judge(seen, briefing)
  }

  static #judge(seen, briefing) {
    if (!seen.resolved) {
      throw new PlanSessionDidNotRun(
        `el shell de la sesión no encuentra ${CmuxPlanSession.AGENT} en su PATH, así que no hay agente escribiendo nada`
      )
    }
    if (seen.cwd !== briefing.located.path) {
      throw new PlanSessionDidNotRun(
        `la sesión arrancó en ${seen.cwd} y no en ${briefing.located.path}: lo que escriba no va a la rama de este slice`
      )
    }
  }

  async #await(sentinel, attempts) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const text = await this.read(sentinel)
      const seen = text === null ? null : CmuxLauncher.read(text)
      if (seen !== null) return seen
      await this.sleep()
    }

    return null
  }

  async #resend(briefing, typed) {
    const name = CmuxPlanSession.nameFor(briefing.ticket)
    await this.run(CmuxPlanSession.sendArgvFor(name, typed))
    await this.run(CmuxPlanSession.enterArgvFor(name))
  }
}
