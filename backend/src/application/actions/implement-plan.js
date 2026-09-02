export class ImplementPlanParams {
  constructor({ story, issue, repository }) {
    this.story = story
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

export class ImplementPlan {
  constructor({ planAgents }) {
    this.planAgents = planAgents
  }

  async execute(params) {
    await this.planAgents.resume({
      story: params.story, issue: params.issue, repository: params.repository,
    })
  }
}
