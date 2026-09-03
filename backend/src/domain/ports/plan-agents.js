export class PlanAgents {
  async launch(briefing) {
    throw new Error(
      `${this.constructor.name} must implement launch(briefing), asked for ${briefing?.story} on ${briefing?.issue}`
    )
  }

  async resume({ agent, issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement resume({ agent, issue, repository }), asked for ${agent} on ${issue} in ${repository}`
    )
  }

  async review({ agent, issue, repository, changes }) {
    throw new Error(
      `${this.constructor.name} must implement review({ agent, issue, repository, changes }), asked for ${agent} on ${issue} in ${repository}`
    )
  }
}
