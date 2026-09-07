export class PlanWatch {
  constructor({ issue, located, repository, agent, delivering = false }) {
    this.issue = issue
    this.located = located
    this.repository = repository
    this.agent = agent
    this.delivering = delivering
    Object.freeze(this)
  }
}
