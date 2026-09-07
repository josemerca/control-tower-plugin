export class PullRequests {
  async openOf({ issueNumber, repository }) {
    throw new Error(
      `${this.constructor.name} must implement openOf({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }

  async fixesAsked({ pullRequest, repository }) {
    throw new Error(
      `${this.constructor.name} must implement fixesAsked({ pullRequest, repository }), asked for ${pullRequest?.number} in ${repository}`
    )
  }
}
