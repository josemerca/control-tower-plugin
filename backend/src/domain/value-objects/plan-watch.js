import { WorkspaceLocation } from './workspace-location.js'
import { RepositoryName } from './repository-name.js'

export class PlanWatch {
  constructor({ issue, located, repository, agent }) {
    if (issue === undefined || issue === null) {
      throw new Error(`a watch carries the issue whose plan it follows, got ${JSON.stringify(issue)}`)
    }
    if (!(located instanceof WorkspaceLocation)) {
      throw new Error(`a watch carries where that plan is being written, got ${JSON.stringify(located)}`)
    }
    if (!(repository instanceof RepositoryName)) {
      throw new Error(`a watch carries the repository the plan is measured against, got ${JSON.stringify(repository)}`)
    }
    this.issue = issue
    this.located = located
    this.repository = repository
    this.agent = agent
    Object.freeze(this)
  }
}
