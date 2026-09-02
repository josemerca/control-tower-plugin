export class ImplementPlanParams {
  constructor({ agent, issue }) {
    this.agent = agent
    this.issue = issue
    Object.freeze(this)
  }
}

export class ImplementPlan {
  constructor({ planAgents }) {
    this.planAgents = planAgents
  }

  async execute(params) {
    await this.planAgents.resume({ agent: params.agent, issue: params.issue })
  }
}
