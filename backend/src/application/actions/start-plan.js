export class StartPlanParams {
  constructor({ ticket }) {
    this.ticket = ticket
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ session }) {
    this.session = session
    Object.freeze(this)
  }
}

export class StartPlan {
  constructor({ planSession }) {
    this.planSession = planSession
  }

  async execute(params) {
    return new StartPlanResult({ session: await this.planSession.start(params.ticket) })
  }
}
