export class PlanWatch {
  constructor({ issue, located, repository, agent }) {
    this.issue = issue
    this.located = located
    this.repository = repository
    this.agent = agent
    Object.freeze(this)
  }
}
