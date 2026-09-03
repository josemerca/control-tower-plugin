import { PreparedWorkspace } from './prepared-workspace.js'
import { RepositoryName } from './repository-name.js'

export class WorkspaceSurvey {
  constructor({ repository, prepared }) {
    if (!(repository instanceof RepositoryName)) {
      throw new Error(`a survey names the repository the checkout holds, got ${JSON.stringify(repository)}`)
    }
    if (!Array.isArray(prepared) || prepared.some((found) => !(found instanceof PreparedWorkspace))) {
      throw new Error(`a survey lists the prepared workspaces it found, got ${JSON.stringify(prepared)}`)
    }
    this.repository = repository
    this.prepared = Object.freeze([...prepared])
    Object.freeze(this)
  }
}
