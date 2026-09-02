export class PlanAgents {
  async launch(briefing) {
    throw new Error(
      `${this.constructor.name} must implement launch(briefing), asked for ${briefing?.story} on ${briefing?.issue}`
    )
  }
}
