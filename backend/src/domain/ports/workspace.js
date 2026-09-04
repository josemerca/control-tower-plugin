export class Workspace {
  async confirm({ root, repository }) {
    throw new Error(
      `${this.constructor.name} must implement confirm({ root, repository }), asked whether ${root} holds ${repository}`
    )
  }

  async prepare({ issue, repository, root }) {
    throw new Error(
      `${this.constructor.name} must implement prepare({ issue, repository, root }), asked for ${issue?.number} in ${repository} at ${root}`
    )
  }

  async survey(root) {
    throw new Error(`${this.constructor.name} must implement survey(root), asked about ${root}`)
  }

  async undo(located) {
    throw new Error(`${this.constructor.name} must implement undo(located), asked for ${located?.path}`)
  }
}
