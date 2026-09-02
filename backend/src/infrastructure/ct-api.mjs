import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { setTimeout as after } from 'node:timers/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiServer, LOOPBACK } from './api-server.js'
import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { AcliUserStories } from './acli-user-stories.js'
import { GhPlanIssues } from './gh-plan-issues.js'
import { GitWorkspace } from './git-workspace.js'
import { DiskGoRegistry } from './disk-go-registry.js'
import { PlanAgentBrief } from './plan-agent-brief.js'
import { PlanContractProgress } from './plan-contract-progress.js'
import { PlanEvents } from './plan-events-route.js'
import { StartPlan } from '../application/actions/start-plan.js'
import { ImplementPlan } from '../application/actions/implement-plan.js'
import { ReadPlanProgress, ReadPlanProgressParams } from '../application/queries/read-plan-progress.js'
import { ToolRunner } from './tool-runner.js'
import { Gh } from './gh.js'
import { SystemClock } from './system-clock.js'
import { ExternalTool } from './external-tool.js'
import { RetryPolicy, RetryBudget } from '../domain/policies/retry-policy.js'
import { LaunchPolicy, LaunchBudget } from '../domain/policies/launch-policy.js'
import { Invocation, InvocationOutcome } from './invocation.js'

class FrontendBuild {
  static #HERE = dirname(fileURLToPath(import.meta.url))

  static root() {
    return join(FrontendBuild.#HERE, '..', '..', '..', 'frontend', 'dist')
  }
}

class PluginTree {
  static #HERE = dirname(fileURLToPath(import.meta.url))

  static #root() {
    return join(PluginTree.#HERE, '..', '..', '..', 'plugin')
  }

  static dispatchCheck() {
    return join(PluginTree.#root(), 'scripts', 'dispatch-check.mjs')
  }

  static conventions() {
    return join(PluginTree.#root(), 'conventions')
  }

  static ctStep() {
    return join(PluginTree.#root(), 'scripts', 'ct-step.mjs')
  }
}

class Disk {
  static realpathOf(path) {
    try {
      return realpathSync(path)
    } catch {
      return null
    }
  }

  static async write(path, text) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  }

  static async read(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (failure) {
      if (failure.code === 'ENOENT') return null
      throw failure
    }
  }

  static async remove(path) {
    await rm(path, { force: true })
  }
}

class CtApi {
  static #USAGE =
    `usage: ct-api.mjs (no arguments; set ${Invocation.PORT_VARIABLE} to pick a port, 0 for an ephemeral one)`
  static #BAD_USAGE = 2
  static #CANNOT_LISTEN = 1
  static #PROCESS_TIMEOUT_MS = 30_000
  static #RETRIES = 3
  static #SECONDS_BETWEEN_RETRIES = 2
  static #PROBES_PER_SEND = 20
  static #RESENDS = 1
  static #SECONDS_BETWEEN_PROBES = 1
  static #SECONDS_BETWEEN_READS = 2
  static #LAUNCH_DIRECTORY = 'ct-plan'

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
    return (argv, options) => runner.run(argv, options)
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

  static #waiting(seconds) {
    return after(seconds * 1000)
  }

  static #startPlan(git, planAgents, planIssues) {
    return new StartPlan({
      userStories: new AcliUserStories({ acli: CtApi.#talkingTo(AcliUserStories.BIN, ExternalTool) }),
      planIssues,
      workspace: new GitWorkspace({
        run: git,
        write: Disk.write,
        read: Disk.read,
        root: process.cwd(),
        stderr: (line) => process.stderr.write(line),
      }),
      planAgents,
    })
  }

  static #planEvents(git) {
    const readPlanProgress = new ReadPlanProgress({
      planProgress: new PlanContractProgress({
        node: CtApi.#tool(process.execPath),
        git,
        dispatchCheck: PluginTree.dispatchCheck(),
        stderr: (line) => process.stderr.write(line),
      }),
    })

    return new PlanEvents({
      read: (session) => readPlanProgress.execute(new ReadPlanProgressParams(session)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_READS),
    })
  }

  static async run(argv, environment) {
    const asked = Invocation.from(argv, environment, homedir())
    if (asked.outcome !== InvocationOutcome.READY) {
      CtApi.#refuseUsage(asked.reason)
    }
    const git = CtApi.#tool(GitWorkspace.BIN)
    const planAgents = new CmuxPlanAgents({
      run: CtApi.#tool(CmuxPlanAgents.BIN),
      write: Disk.write,
      read: Disk.read,
      remove: Disk.remove,
      realpathOf: Disk.realpathOf,
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_PROBES),
      runsIn: join(tmpdir(), CtApi.#LAUNCH_DIRECTORY),
      policy: new LaunchPolicy({
        budget: new LaunchBudget({ attempts: CtApi.#PROBES_PER_SEND, resends: CtApi.#RESENDS }),
      }),
      brief: new PlanAgentBrief({
        dispatchCheck: PluginTree.dispatchCheck(),
        conventions: PluginTree.conventions(),
        ctStep: PluginTree.ctStep(),
      }),
    })
    const planIssues = new GhPlanIssues({
      gh: CtApi.#talkingTo(Gh.BIN, Gh),
      stderr: (line) => process.stderr.write(line),
    })
    const server = new ApiServer({
      port: asked.port,
      startPlan: CtApi.#startPlan(git, planAgents, planIssues),
      implementPlan: new ImplementPlan({
        goRegistry: new DiskGoRegistry({
          random: randomBytes,
          write: Disk.write,
          root: asked.stateRoot,
        }),
        planIssues,
        planAgents,
      }),
      planEvents: CtApi.#planEvents(git),
      frontendRoot: FrontendBuild.root(),
    })
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
