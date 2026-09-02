export class PlanIssues {
  async open({ story, repository }) {
    throw new Error(
      `${this.constructor.name} must implement open({ story, repository }), asked for ${story?.key} in ${repository}`
    )
  }
}
