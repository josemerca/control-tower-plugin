export class Harvest {
  async collect({ issueNumber, repository }) {
    throw new Error(
      `${this.constructor.name} must implement collect({ issueNumber, repository }), asked for ${issueNumber} in ${repository}`
    )
  }
}
