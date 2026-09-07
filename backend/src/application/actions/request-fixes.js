export class RequestFixesParams {
  constructor({ agent, issue, repository, changes }) {
    this.agent = agent
    this.issue = issue
    this.repository = repository
    this.changes = changes
    Object.freeze(this)
  }
}

export class RequestFixes {
  constructor({ workbench, planAgents }) {
    this.workbench = workbench
    this.planAgents = planAgents
  }

  async execute(params) {
    await this.workbench.reopen({ issue: params.issue, repository: params.repository })
    await this.planAgents.fix({
      agent: params.agent,
      issue: params.issue.number,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
