export class WorkspaceLocation {
  constructor({ path, branch }) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error(`a workspace lives in a directory, got ${JSON.stringify(path)}`)
    }
    if (typeof branch !== 'string' || branch.length === 0) {
      throw new Error(`a workspace commits to a branch, got ${JSON.stringify(branch)}`)
    }
    this.path = path
    this.branch = branch
    Object.freeze(this)
  }
}
