export class PlanIssues {
  async open({ ticket, repository }) {
    throw new Error(
      `${this.constructor.name} must implement open({ ticket, repository }), asked for ${ticket?.key} in ${repository}`
    )
  }
}
