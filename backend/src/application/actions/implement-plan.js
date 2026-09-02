export class ImplementPlanParams {
  constructor({ story, issue, repository }) {
    this.story = story
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

export class ImplementPlan {
  constructor({ goRegistry, planIssues, planAgents }) {
    this.goRegistry = goRegistry
    this.planIssues = planIssues
    this.planAgents = planAgents
  }

  async execute(params) {
    const nonce = await this.goRegistry.mint({
      issueNumber: params.issue, repository: params.repository,
    })
    await this.planIssues.answerGo({
      issueNumber: params.issue, repository: params.repository, nonce,
    })
    await this.planAgents.resume({
      story: params.story, issue: params.issue, repository: params.repository,
    })
  }
}
