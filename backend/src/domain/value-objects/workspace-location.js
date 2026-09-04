export class WorkspaceLocation {
  constructor({ root, path, branch }) {
    this.root = root
    this.path = path
    this.branch = branch
    Object.freeze(this)
  }
}
