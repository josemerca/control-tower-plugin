export class Harvest {
  async collect({ issueNumber, repository, root }) {
    throw new Error(
      `${this.constructor.name} must implement collect({ issueNumber, repository, root }), asked for ${issueNumber} in ${repository} at ${root}`
    )
  }
}
