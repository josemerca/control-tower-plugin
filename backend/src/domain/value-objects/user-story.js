import { UserStoryNotUnderstood } from '../exceptions.js'

export class UserStory {
  constructor({ key, summary, description }) {
    if (typeof summary !== 'string' || summary.trim().length === 0) {
      throw new UserStoryNotUnderstood(`${key} carries no summary, so there is nothing to plan`)
    }
    this.key = key
    this.summary = summary.trim()
    this.description = description
    Object.freeze(this)
  }

  hasDescription() {
    return this.description.trim().length > 0
  }
}
