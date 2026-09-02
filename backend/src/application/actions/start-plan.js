export class StartPlanParams {
  constructor({ story, repository }) {
    this.story = story
    this.repository = repository
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ issue, agent }) {
    this.issue = issue
    this.agent = agent
    Object.freeze(this)
  }
}

export class StartPlan {
  constructor({ userStories, planIssues, planAgents }) {
    this.userStories = userStories
    this.planIssues = planIssues
    this.planAgents = planAgents
  }

  async execute(params) {
    const story = await this.userStories.detail(params.story)
    const issue = await this.planIssues.open({ story, repository: params.repository })
    const agent = await this.planAgents.launch({ story: params.story, issue })

    return new StartPlanResult({ issue, agent })
  }
}
