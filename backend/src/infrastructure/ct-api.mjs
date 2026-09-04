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
import { MemoryCheckoutRegistry } from './memory-checkout-registry.js'
import { DiskGoRegistry } from './disk-go-registry.js'
import { DispatchCheckHarvest } from './dispatch-check-harvest.js'
import { HarvestClock } from './harvest-clock.js'
import { PlanAgentBrief } from './plan-agent-brief.js'
import { PlanContractProgress } from './plan-contract-progress.js'
import { PlanEvents, PlanSessions } from './plan-events-route.js'
import { PlanReviewWatch } from './plan-review-watch.js'
import { StartPlan } from '../application/actions/start-plan.js'
import { ImplementPlan } from '../application/actions/implement-plan.js'
import { ReadPlanProgress, ReadPlanProgressParams } from '../application/queries/read-plan-progress.js'
import { ReadChangesAsked, ReadChangesAskedParams } from '../application/queries/read-changes-asked.js'
import { ReviewPlan, ReviewPlanParams } from '../application/actions/review-plan.js'
import { SurveyWorkspaces, SurveyWorkspacesParams } from '../application/queries/survey-workspaces.js'
import { HarvestDelivery, HarvestDeliveryParams } from '../application/actions/harvest-delivery.js'
import { ToolRunner } from './tool-runner.js'
import { Gh } from './gh.js'
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
    `usage: ct-api.mjs (no arguments; set ${Invocation.PORT_VARIABLE} to pick a port, 0 for an ephemeral one; set ${Invocation.HARVEST_TABLE_VARIABLE} to ${Invocation.HARVEST_TABLE_SHAPE} so every harvest loads its row into BigQuery)`
  static #BAD_USAGE = 2
  static #CANNOT_LISTEN = 1
  static #PROCESS_TIMEOUT_MS = 30_000
  static #HARVEST_TIMEOUT_MS = 6 * 60 * 1000
  static #SECONDS_FOR_GH_IN_A_HARVEST = 60
  static #SECONDS_BETWEEN_SWEEPS = 60
  static #CLOCK_STOPPED = 1
  static #RETRIES = 3
  static #SECONDS_BETWEEN_RETRIES = 2
  static #PROBES_PER_SEND = 20
  static #RESENDS = 1
  static #SECONDS_BETWEEN_PROBES = 1
  static #SECONDS_BETWEEN_READS = 2
  static #SECONDS_BETWEEN_ASKS = 30
  static #LAUNCH_DIRECTORY = 'ct-plan'

  static #refuseUsage(reason) {
    process.stderr.write(`${reason}\n${CtApi.#USAGE}\n`)
    process.exit(CtApi.#BAD_USAGE)
  }

  static #refuseListen(reason) {
    process.stderr.write(`${reason}\n`)
    process.exit(CtApi.#CANNOT_LISTEN)
  }

  static #tool(bin, { budgetMs = CtApi.#PROCESS_TIMEOUT_MS, env } = {}) {
    const runner = new ToolRunner({ bin, budgetMs, env })
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
      sleep: (seconds) => CtApi.#waiting(seconds),
    })
  }

  static #waiting(seconds) {
    return after(seconds * 1000)
  }

  static #startPlan(workspace, planAgents, planIssues, checkouts) {
    return new StartPlan({
      userStories: new AcliUserStories({ acli: CtApi.#talkingTo(AcliUserStories.BIN, ExternalTool) }),
      planIssues,
      workspace,
      planAgents,
      checkouts,
    })
  }

  static #harvestClock({ workspace, checkouts, environment, harvestTable }) {
    const surveyWorkspaces = new SurveyWorkspaces({ workspace })
    const harvestDelivery = new HarvestDelivery({
      harvest: new DispatchCheckHarvest({
        node: CtApi.#tool(process.execPath, {
          budgetMs: CtApi.#HARVEST_TIMEOUT_MS,
          env: Invocation.harvestEnvironment(environment, {
            ghTimeoutMs: CtApi.#SECONDS_FOR_GH_IN_A_HARVEST * 1000,
          }),
        }),
        dispatchCheck: PluginTree.dispatchCheck(),
        harvestTable,
      }),
    })

    return new HarvestClock({
      checkouts: () => checkouts.known(),
      survey: (root) => surveyWorkspaces.execute(new SurveyWorkspacesParams({ root })),
      harvest: (prepared, repository) =>
        harvestDelivery.execute(new HarvestDeliveryParams({ prepared, repository })),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_SWEEPS),
      stderr: (line) => process.stderr.write(line),
    })
  }

  static #sweepUntilItBreaks(clock) {
    clock.start().catch((failure) => {
      process.stderr.write(`harvest sweep: the clock stopped sweeping and nothing else will: ${failure.stack}\n`)
      process.exit(CtApi.#CLOCK_STOPPED)
    })
  }

  static #planEvents(git) {
    const readPlanProgress = new ReadPlanProgress({
      planProgress: new PlanContractProgress({
        node: CtApi.#tool(process.execPath),
        git,
        dispatchCheck: PluginTree.dispatchCheck(),
      }),
    })

    return new PlanEvents({
      read: (session) => readPlanProgress.execute(new ReadPlanProgressParams(session)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_READS),
    })
  }

  static #planReviews(planIssues, planAgents) {
    const readChangesAsked = new ReadChangesAsked({ planIssues })
    const reviewPlan = new ReviewPlan({ planAgents })

    return new PlanReviewWatch({
      asked: (watch) => readChangesAsked.execute(new ReadChangesAskedParams(watch)),
      review: (params) => reviewPlan.execute(new ReviewPlanParams(params)),
      sleep: () => CtApi.#waiting(CtApi.#SECONDS_BETWEEN_ASKS),
      stderr: (line) => process.stderr.write(line),
    })
  }

  static async run(argv, environment) {
    const asked = Invocation.from(argv, environment, homedir())
    if (asked.outcome !== InvocationOutcome.READY) {
      CtApi.#refuseUsage(asked.reason)
    }
    const git = CtApi.#tool(GitWorkspace.BIN)
    const workspace = new GitWorkspace({
      run: git,
      write: Disk.write,
      read: Disk.read,
      stderr: (line) => process.stderr.write(line),
    })
    const checkouts = new MemoryCheckoutRegistry()
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
      startPlan: CtApi.#startPlan(workspace, planAgents, planIssues, checkouts),
      reviews: CtApi.#planReviews(planIssues, planAgents),
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
      sessions: new PlanSessions(),
      frontendRoot: FrontendBuild.root(),
    })
    let port
    try {
      port = await server.start()
    } catch (error) {
      CtApi.#refuseListen(`could not listen on ${LOOPBACK}: ${error.message}`)
    }
    process.stdout.write(`${JSON.stringify({ port })}\n`)
    CtApi.#sweepUntilItBreaks(CtApi.#harvestClock({
      workspace, checkouts, environment, harvestTable: asked.harvestTable,
    }))
  }
}

await CtApi.run(process.argv.slice(2), process.env)
