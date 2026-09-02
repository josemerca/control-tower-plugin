export class PlanIssues {
  async open({ story, repository }) {
    throw new Error(
      `${this.constructor.name} must implement open({ story, repository }), asked for ${story?.key} in ${repository}`
    )
  }

  async claim({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement claim({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }

  async requeue({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement requeue({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }
}
