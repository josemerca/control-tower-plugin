export class Workspace {
  async prepare(issue) {
    throw new Error(`${this.constructor.name} must implement prepare(issue), asked for ${issue?.number}`)
  }
}
