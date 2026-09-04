export class UserStory {
  constructor({ key, summary, description }) {
    this.key = key
    this.summary = summary
    this.description = description
    Object.freeze(this)
  }

  hasDescription() {
    return this.description.trim().length > 0
  }
}
