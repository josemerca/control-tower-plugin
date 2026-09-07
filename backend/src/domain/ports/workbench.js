export class Workbench {
  async reopen({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement reopen({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }
}
