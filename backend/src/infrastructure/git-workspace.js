import { Workspace } from '../domain/workspace.js'
import { WorkspaceLocation } from '../domain/workspace-location.js'
import { WorkspaceNotPrepared } from '../domain/exceptions.js'

export class GitWorkspace extends Workspace {
  static BIN = 'git'
  static DIRECTORY = '.worktrees'

  constructor({ run, root, base }) {
    super()
    this.run = run
    this.root = root
    this.base = base
  }

  static branchFor(issue) {
    return `feat/${issue.number}`
  }

  static pathFor(root, issue) {
    return `${root}/${GitWorkspace.DIRECTORY}/${issue.number}`
  }

  static argvFor({ root, base, issue }) {
    return [
      '-C', root,
      'worktree', 'add',
      '-b', GitWorkspace.branchFor(issue),
      GitWorkspace.pathFor(root, issue),
      `origin/${base}`,
    ]
  }

  async prepare(issue) {
    const argv = GitWorkspace.argvFor({ root: this.root, base: this.base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }

    return new WorkspaceLocation({
      path: GitWorkspace.pathFor(this.root, issue),
      branch: GitWorkspace.branchFor(issue),
    })
  }
}
