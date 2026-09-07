import { PlanBriefing } from '../../domain/value-objects/plan-briefing.js'
import { PlanWatch } from '../../domain/value-objects/plan-watch.js'
import { PlanTarget } from '../../domain/value-objects/plan-target.js'
import { PlanFailure } from '../../domain/exceptions.js'

export class StartPlanParams {
  constructor({ story, comment, targets }) {
    this.story = story
    this.comment = comment
    this.targets = targets
    Object.freeze(this)
  }
}

export class PlanStarted {
  constructor({ agent, watch }) {
    this.agent = agent
    this.watch = watch
    Object.freeze(this)
  }
}

export class PlanNotStarted {
  constructor({ repository, cause }) {
    this.repository = repository
    this.cause = cause
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ started, failed }) {
    this.started = started
    this.failed = failed
    Object.freeze(this)
  }
}

export class StartPlan {
  constructor({ userStories, planIssues, workspace, planAgents, checkouts }) {
    this.userStories = userStories
    this.planIssues = planIssues
    this.workspace = workspace
    this.planAgents = planAgents
    this.checkouts = checkouts
  }

  async execute(params) {
    const confirmed = []
    for (const target of params.targets) {
      const root = await this.workspace.confirm({ root: target.root, repository: target.repository })
      confirmed.push(new PlanTarget({ repository: target.repository, root }))
    }
    const detail = params.story === null ? null : await this.userStories.detail(params.story)

    const started = []
    const failed = []
    for (const target of confirmed) {
      try {
        started.push(await this.#start(target, params.story, params.comment, detail))
      } catch (failure) {
        if (!(failure instanceof PlanFailure)) throw failure
        failed.push(new PlanNotStarted({ repository: target.repository, cause: failure }))
      }
    }

    return new StartPlanResult({ started, failed })
  }

  async #start(target, story, comment, detail) {
    const issue = await this.planIssues.open({ story: detail, comment, repository: target.repository })
    await this.planIssues.claim({ issue, repository: target.repository })
    const located = await this.#prepare(target, issue)
    const agent = await this.#launch(target, story, issue, located)
    this.checkouts.remember(target.root)

    return new PlanStarted({
      agent,
      watch: new PlanWatch({ story, issue, located, repository: target.repository, agent }),
    })
  }

  async #prepare(target, issue) {
    try {
      return await this.workspace.prepare({ issue, repository: target.repository, root: target.root })
    } catch (failure) {
      await this.#release(target, issue)
      throw failure
    }
  }

  async #launch(target, story, issue, located) {
    try {
      return await this.planAgents.launch(new PlanBriefing({
        story,
        issue,
        located,
        repository: target.repository,
      }))
    } catch (failure) {
      await this.workspace.undo(located)
      await this.#release(target, issue)
      throw failure
    }
  }

  async #release(target, issue) {
    await this.planIssues.requeue({ issue, repository: target.repository })
  }
}
