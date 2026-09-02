export class PlanSession {
  async start({ ticket, issue }) {
    throw new Error(
      `${this.constructor.name} must implement start({ ticket, issue }), asked for ${ticket} on ${issue}`
    )
  }
}
