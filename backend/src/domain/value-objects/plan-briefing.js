import { RepositoryName } from './repository-name.js'
import { UserStoryKey } from './user-story-key.js'

export class PlanBriefing {
  constructor({ story, issue, located, repository }) {
    if (!(story instanceof UserStoryKey)) {
      throw new Error(`a briefing carries the story whose tab is named after it, got ${JSON.stringify(story)}`)
    }
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
