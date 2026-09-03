export class ReviewPlanParams {
  constructor({ agent, issue, repository, changes }) {
    this.agent = agent
    this.issue = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class ReviewPlan {
  constructor({ planAgents }) {
    this.planAgents = planAgents
  }

  async execute(params) {
    await this.planAgents.review({
      agent: params.agent,
      issue: params.issue,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
