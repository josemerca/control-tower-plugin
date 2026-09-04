export class ReadChangesAskedParams {
  constructor({ issue, repository }) {
    this.issue = issue
    this.repository = repository
    Object.freeze(this)
  }
}

class ReadChangesAskedResult {
  constructor({ changes }) {
    this.changes = changes
    Object.freeze(this)
  }
}

export class ReadChangesAsked {
  constructor({ planIssues }) {
    this.planIssues = planIssues
  }

  async execute(params) {
    return new ReadChangesAskedResult({
      changes: await this.planIssues.changesAsked({
        issue: params.issue,
        repository: params.repository,
      }),
    })
  }
}
