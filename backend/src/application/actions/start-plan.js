export class StartPlanParams {
  constructor({ ticket, repository }) {
    this.ticket = ticket
    this.repository = repository
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ issue, session }) {
    this.issue = issue
    this.session = session
    Object.freeze(this)
  }
}

export class StartPlan {
  constructor({ tickets, planIssues, planSession }) {
    this.tickets = tickets
    this.planIssues = planIssues
    this.planSession = planSession
  }

  async execute(params) {
    const ticket = await this.tickets.detail(params.ticket)
    const issue = await this.planIssues.open({ ticket, repository: params.repository })
    const session = await this.planSession.start({ ticket: params.ticket, issue })
    return new StartPlanResult({ issue, session })
  }
}
