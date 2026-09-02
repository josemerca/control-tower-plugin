import { UserStoryKey } from './user-story-key.js'

export class UserStory {
  constructor({ key, summary, description }) {
    if (!(key instanceof UserStoryKey)) {
      throw new Error(`a story is keyed by a UserStoryKey, got ${JSON.stringify(key)}`)
    }
    if (typeof summary !== 'string' || typeof description !== 'string') {
      throw new Error(`a user story carries text, got summary ${JSON.stringify(summary)} and description ${JSON.stringify(description)}`)
    }
    this.key = key
    this.summary = summary
    this.description = description
    Object.freeze(this)
  }

  hasDescription() {
    return this.description.trim().length > 0
  }
}
