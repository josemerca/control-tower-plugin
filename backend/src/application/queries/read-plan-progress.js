export class ReadPlanProgressParams {
  constructor({ located, issue }) {
    this.located = located
    this.issue = issue
    Object.freeze(this)
  }
}

export class ReadPlanProgressResult {
  constructor({ state }) {
    this.state = state
    Object.freeze(this)
  }
}

export class ReadPlanProgress {
  constructor({ planProgress }) {
    this.planProgress = planProgress
  }

  async execute(params) {
    return new ReadPlanProgressResult({
      state: await this.planProgress.of({ located: params.located, issue: params.issue }),
    })
  }
}
