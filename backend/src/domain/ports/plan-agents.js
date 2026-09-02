export class PlanAgents {
  async launch({ story, issue }) {
    throw new Error(
      `${this.constructor.name} must implement launch({ story, issue }), asked for ${story} on ${issue}`
    )
  }
}
