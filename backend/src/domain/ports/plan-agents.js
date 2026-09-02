export class PlanAgents {
  async launch({ ticket, issue }) {
    throw new Error(
      `${this.constructor.name} must implement launch({ ticket, issue }), asked for ${ticket} on ${issue}`
    )
  }
}
