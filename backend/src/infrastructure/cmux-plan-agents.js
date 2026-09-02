import {
  buildLauncherScript,
  buildTypedCommand,
  parseSentinel,
  sameDir,
  LAUNCHER_FILENAME,
  SENTINEL_FILENAME,
} from '../../../plugin/scripts/launch-sentinel.js'
import { shQuote } from '../../../plugin/scripts/shquote.js'
import { PlanAgents } from '../domain/ports/plan-agents.js'
import { LaunchStep } from '../domain/policies/launch-policy.js'
import { PlanAgentNotLaunched, PlanAgentNotNamed } from '../domain/exceptions.js'

export class CmuxPlanAgents extends PlanAgents {
  static BIN = 'cmux'
  static AGENT = 'claude'
  static #REF = /^OK\s+(workspace:\d+)\s*$/m
  static NO_MOVE = 'no move declared for launch step'

  constructor({ run, write, read, remove, sleep, runsIn, policy, brief, realpathOf }) {
    super()
    this.realpathOf = realpathOf
    this.run = run
    this.write = write
    this.read = read
    this.remove = remove
    this.sleep = sleep
    this.runsIn = runsIn
    this.policy = policy
    this.brief = brief
  }

  static nameFor(story) {
    return `ct-plan-${story}`
  }

  static argvFor(briefing, typed) {
    return [
      'new-workspace',
      '--name', CmuxPlanAgents.nameFor(briefing.story),
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

  static scriptFor({ sentinelPath, errand, bin, issue, worktree }) {
    return buildLauncherScript({
      sentinelPath,
      agentCommand: `${bin} ${shQuote(errand)}`,
      agentBin: bin,
      issue,
      worktree,
    }, shQuote)
  }

  async launch(briefing) {
    const errand = this.brief.errandFor({ issue: briefing.issue, repository: briefing.repository })
    const directory = `${this.runsIn}/${briefing.issue.number}`
    const launcherPath = `${directory}/${LAUNCHER_FILENAME}`
    const sentinelPath = `${directory}/${SENTINEL_FILENAME}`
    const typed = buildTypedCommand(launcherPath, shQuote)
    await this.remove(sentinelPath)
    await this.write(launcherPath, CmuxPlanAgents.scriptFor({
      sentinelPath,
      errand,
      bin: CmuxPlanAgents.AGENT,
      issue: briefing.issue.number,
      worktree: briefing.located.path,
    }))
    const handle = await this.#open(briefing, typed)
    await this.#confirm({ briefing, sentinelPath, typed })

    return handle
  }

  async #open(briefing, typed) {
    const argv = CmuxPlanAgents.argvFor(briefing, typed)
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

  async #confirm({ briefing, sentinelPath, typed }) {
    for (let probes = 1; ; probes += 1) {
      const seen = await this.#peek(sentinelPath)
      if (seen !== null) return this.#judge(seen, briefing)
      await this.sleep()
      const step = this.policy.afterProbing(probes)
      if (step === LaunchStep.KEEP_PROBING) continue
      if (step === LaunchStep.RESEND_THE_LINE) {
        await this.#resend(briefing, typed)
        continue
      }
      if (step === LaunchStep.GIVE_UP) {
        throw new PlanAgentNotLaunched(
          `the cmux window opened but no sentinel ever appeared at ${sentinelPath}: the line never ran`
        )
      }
      throw new Error(`${CmuxPlanAgents.NO_MOVE} ${step}`)
    }
  }

  #judge(seen, briefing) {
    if (!seen.claudeResolved) {
      throw new PlanAgentNotLaunched(
        `the shell of the session cannot find ${CmuxPlanAgents.AGENT} on its PATH, so no agent is writing anything`
      )
    }
    if (!sameDir(seen.cwd, briefing.located.path, this.realpathOf)) {
      throw new PlanAgentNotLaunched(
        `the session started in ${seen.cwd} and not in ${briefing.located.path}: whatever it writes misses this branch`
      )
    }
  }

  async #peek(sentinelPath) {
    const text = await this.read(sentinelPath)

    return text === null ? null : parseSentinel(text)
  }

  async #resend(briefing, typed) {
    const name = CmuxPlanAgents.nameFor(briefing.story)
    await this.run(CmuxPlanAgents.sendArgvFor(name, typed))
    await this.run(CmuxPlanAgents.enterArgvFor(name))
  }
}
