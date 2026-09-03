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

  async execute() {
    return new SurveyWorkspacesResult({ survey: await this.workspace.survey() })
  }
}
