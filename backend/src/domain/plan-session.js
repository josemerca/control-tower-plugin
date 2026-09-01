export class PlanSession {
  async start(ticket) {
    throw new Error(`${this.constructor.name} must implement start(ticket), asked for ${ticket}`)
  }
}
