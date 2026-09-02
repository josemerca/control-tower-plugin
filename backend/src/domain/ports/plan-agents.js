export class PlanAgents {
  async launch(briefing) {
    throw new Error(
      `${this.constructor.name} must implement launch(briefing), asked for ${briefing?.story} on ${briefing?.issue}`
    )
  }

  async resume({ story, issue }) {
    throw new Error(
      `${this.constructor.name} must implement resume({ story, issue }), asked for ${story} on ${issue}`
    )
  }
}
