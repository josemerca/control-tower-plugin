export class PlanWatch {
  constructor({ story, issue, located, repository, agent, delivering = false }) {
    this.story = story
    this.issue = issue
    this.located = located
    this.repository = repository
    this.agent = agent
    this.delivering = delivering
    Object.freeze(this)
  }

  storyText() {
    return this.story === null ? null : this.story.text
  }
}
