export class PullRequests {
  async openOf({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement openOf({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }

  async fixesAsked({ pullRequest, repository }) {
    throw new Error(
      `${this.constructor.name} must implement fixesAsked({ pullRequest, repository }), asked for ${pullRequest?.number} in ${repository}`
    )
  }
}
