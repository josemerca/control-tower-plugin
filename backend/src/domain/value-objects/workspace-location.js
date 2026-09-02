export class WorkspaceLocation {
  constructor({ path, branch }) {
    this.path = path
    this.branch = branch
    Object.freeze(this)
  }
}
