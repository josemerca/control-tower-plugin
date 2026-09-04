import { ImplementationProgress } from '../domain/ports/implementation-progress.js'
import { ImplementationState, ImplementationStep } from '../domain/value-objects/implementation-state.js'
import { ImplementationProgressNotRead } from '../domain/exceptions.js'
import { GitWorkspace } from './git-workspace.js'

class PlanTaskNames {
  static HEADING = /^### Task (\d+) — (.*)$/
  static FENCE = '```'

  static of(markdown) {
    const names = new Map()
    let inFence = false
    for (const line of String(markdown).split('\n')) {
      if (line.startsWith(PlanTaskNames.FENCE)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const matched = line.match(PlanTaskNames.HEADING)
      if (matched !== null) names.set(Number(matched[1]), matched[2].trim())
    }
    return names
  }
}

export class RunFileProgress extends ImplementationProgress {
  static AGENT_DIRECTORY = '.agent'

  constructor({ read, exists }) {
    super()
    this.read = read
    this.exists = exists
  }

  static worktreeFor(root, issue) {
    return GitWorkspace.pathFor(root, { number: issue })
  }

  static runFileFor(root, issue) {
    return `${RunFileProgress.worktreeFor(root, issue)}/${RunFileProgress.AGENT_DIRECTORY}/run-${issue}.json`
  }

  static attemptOf(run) {
    return run.controlRetries + run.judgeRetries + run.correctionRetries + 1
  }

  async of({ root, issue }) {
    const worktree = RunFileProgress.worktreeFor(root.text, issue)
    if (!(await this.exists(worktree))) {
      throw new ImplementationProgressNotRead(`the worktree ${worktree} is not there, so its run cannot be read`)
    }
    const path = RunFileProgress.runFileFor(root.text, issue)
    const text = await this.read(path)
    if (text === null) return ImplementationState.starting()

    let run
    try {
      run = JSON.parse(text)
    } catch (cause) {
      throw new ImplementationProgressNotRead(`${path} could not be parsed as JSON: ${cause.message}`)
    }
    if (typeof run !== 'object' || run === null || Array.isArray(run)) {
      throw new ImplementationProgressNotRead(`${path} did not hold a JSON object`)
    }

    if (run.closed === 'delivered') {
      return ImplementationState.of({
        step: ImplementationStep.DELIVERED, totalTasks: run.tasksTotal, discards: run.discards,
      })
    }

    const name = ImplementationState.TASKLESS.includes(run.step)
      ? null
      : await this.#taskName(worktree, run)

    return ImplementationState.of({
      step: run.step, task: run.task, totalTasks: run.tasksTotal, name,
      attempt: RunFileProgress.attemptOf(run), discards: run.discards,
    })
  }

  async #taskName(worktree, run) {
    const planText = await this.read(`${worktree}/${run.plan}`)
    if (planText === null) return null
    return PlanTaskNames.of(planText).get(run.task) ?? null
  }
}
