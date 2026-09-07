export class ReadImplementationProgressParams {
  constructor({ root, issue }) {
    this.root = root
    this.issue = issue
    Object.freeze(this)
  }
}

class ReadImplementationProgressResult {
  constructor({ state }) {
    this.state = state
    Object.freeze(this)
  }
}

export class ReadImplementationProgress {
  constructor({ implementationProgress }) {
    this.implementationProgress = implementationProgress
  }

  async execute(params) {
    return new ReadImplementationProgressResult({
      state: await this.implementationProgress.of({
        root: params.root,
        issue: params.issue,
      }),
    })
  }
}
