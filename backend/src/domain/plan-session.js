export class PlanSession {
  async start(briefing) {
    throw new Error(`${this.constructor.name} must implement start(briefing), asked for ${briefing?.ticket}`)
  }
}
