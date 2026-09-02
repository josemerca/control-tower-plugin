import { PlanBriefing } from '../../domain/value-objects/plan-briefing.js'

export class StartPlanParams {
  constructor({ story, repository }) {
    this.story = story
    this.repository = repository
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ issue, agent, located }) {
    this.issue = issue
    this.agent = agent
    this.located = located
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
    const located = await this.workspace.prepare(issue)
    const agent = await this.#launch(params, issue, located)

    return new StartPlanResult({ issue, agent, located })
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
      await this.#abandon(located)
      throw failure
    }
  }

  async #abandon(located) {
    try {
      await this.workspace.undo(located)
    } catch {}
  }
}
