export class SurveyWorkspacesParams {
  constructor({ root }) {
    this.root = root
    Object.freeze(this)
  }
}

export class SurveyWorkspacesResult {
  constructor({ survey }) {
    this.survey = survey
    Object.freeze(this)
  }
}

export class SurveyWorkspaces {
  constructor({ workspace }) {
    this.workspace = workspace
  }

  async execute(params) {
    return new SurveyWorkspacesResult({ survey: await this.workspace.survey(params.root) })
  }
}
