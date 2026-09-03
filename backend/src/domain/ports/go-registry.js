export class GoRegistry {
  async mint({ issueNumber, repository }) {
    throw new Error(
      `${this.constructor.name} must implement mint({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
}
