export class Workspace {
  async prepare({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement prepare({ issue, repository }), asked for ${issue?.number} in ${repository}`
    )
  }

  async undo(located) {
    throw new Error(`${this.constructor.name} must implement undo(located), asked for ${located?.path}`)
  }
}
