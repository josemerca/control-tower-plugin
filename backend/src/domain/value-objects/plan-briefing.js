import { RepositoryName } from './repository-name.js'

export class PlanBriefing {
  constructor({ story, issue, located, repository }) {
    if (located === undefined || located === null) {
      throw new Error(`a briefing carries where the agent is located, got ${JSON.stringify(located)}`)
    }
    if (issue === undefined || issue === null) {
      throw new Error(`a briefing carries the issue it hydrates from, got ${JSON.stringify(issue)}`)
    }
    if (!(repository instanceof RepositoryName)) {
      throw new Error(`a briefing carries the repository that issue lives in, got ${JSON.stringify(repository)}`)
    }
    this.story = story
    this.issue = issue
    this.located = located
    this.repository = repository
    Object.freeze(this)
  }
}
