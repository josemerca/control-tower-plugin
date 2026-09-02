export class StartPlanParams {
  constructor({ ticket, repository }) {
    this.ticket = ticket
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
  constructor({ tickets, planIssues, planAgents }) {
    this.tickets = tickets
    this.planIssues = planIssues
    this.planAgents = planAgents
  }

  async execute(params) {
    const ticket = await this.tickets.detail(params.ticket)
    const issue = await this.planIssues.open({ ticket, repository: params.repository })
    const agent = await this.planAgents.launch({ ticket: params.ticket, issue })

    return new StartPlanResult({ issue, agent })
  }
}
