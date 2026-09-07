export class RequestFixesParams {
  constructor({ agent, issue, repository, changes }) {
    this.agent = agent
    this.issueNumber = issue
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
    await this.workbench.reopen({ issueNumber: params.issueNumber, repository: params.repository })
    await this.planAgents.fix({
      agent: params.agent,
      issue: params.issueNumber,
      repository: params.repository,
      changes: params.changes,
    })
  }
}
