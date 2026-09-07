export class PlanWatch {
  constructor({ story, issue, located, repository, agent }) {
    this.story = story
    this.issue = issue
    this.located = located
    this.repository = repository
    this.agent = agent
    Object.freeze(this)
  }

  storyText() {
    return this.story === null ? null : this.story.text
  }
}
