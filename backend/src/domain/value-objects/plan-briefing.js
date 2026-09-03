export class PlanBriefing {
  constructor({ story, issue, located, repository }) {
    this.story = story
    this.issue = issue
    this.located = located
    this.repository = repository
    Object.freeze(this)
  }
}
