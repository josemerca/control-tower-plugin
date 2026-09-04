import { PlanBriefing } from '../../domain/value-objects/plan-briefing.js'
import { PlanWatch } from '../../domain/value-objects/plan-watch.js'

export class StartPlanParams {
  constructor({ story, repository }) {
    this.story = story
    this.repository = repository
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ agent, watch }) {
    this.agent = agent
    this.watch = watch
    Object.freeze(this)
  }
}

export class StartPlan {
  constructor({ userStories, planIssues, workspace, planAgents }) {
    this.userStories = userStories
    this.planIssues = planIssues
    this.workspace = workspace
    this.planAgents = planAgents
  }

  async execute(params) {
    const story = await this.userStories.detail(params.story)
    const issue = await this.planIssues.open({ story, repository: params.repository })
    await this.planIssues.claim({ issue, repository: params.repository })
    const located = await this.#prepare(params, issue)
    const agent = await this.#launch(params, issue, located)

    return new StartPlanResult({
      agent,
      watch: new PlanWatch({ issue, located, repository: params.repository, agent }),
    })
  }

  async #prepare(params, issue) {
    try {
      return await this.workspace.prepare({ issue, repository: params.repository })
    } catch (failure) {
      await this.#release(params, issue)
      throw failure
    }
  }

  async #launch(params, issue, located) {
    try {
      return await this.planAgents.launch(new PlanBriefing({
        story: params.story,
        issue,
        located,
        repository: params.repository,
      }))
    } catch (failure) {
      await this.workspace.undo(located)
      await this.#release(params, issue)
      throw failure
    }
  }

  async #release(params, issue) {
    await this.planIssues.requeue({ issue, repository: params.repository })
  }
}
