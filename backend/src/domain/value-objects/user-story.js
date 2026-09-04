export class UserStory {
  constructor({ key, summary, description }) {
    if (typeof summary !== 'string' || summary.length === 0) {
      throw new Error(`a user story is titled by its summary, got ${JSON.stringify(summary)}`)
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
