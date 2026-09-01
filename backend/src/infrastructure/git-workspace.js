import { Workspace } from '../domain/workspace.js'
import { WorkspaceLocation } from '../domain/workspace-location.js'
import { WorkspaceNotPrepared } from '../domain/exceptions.js'
import { SliceSeed } from './slice-seed.js'

export class GitWorkspace extends Workspace {
  static BIN = 'git'
  static DIRECTORY = '.worktrees'

  constructor({ run, write, root, base }) {
    super()
    this.run = run
    this.write = write
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

  static cutArgvFor(path) {
    return ['-C', path, 'rev-parse', 'HEAD']
  }

  static gitDirArgvFor(path) {
    return ['-C', path, 'rev-parse', '--absolute-git-dir']
  }

  async prepare(issue) {
    const path = GitWorkspace.pathFor(this.root, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(issue)
    const located = new WorkspaceLocation({ path, branch })
    await this.#seed(located, issue)

    return located
  }

  async #cut(issue) {
    const argv = GitWorkspace.argvFor({ root: this.root, base: this.base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }
  }

  async #seed(located, issue) {
    await this.write(`${await this.#gitDirOf(located)}/${SliceSeed.EXCLUDE_PATH}`, `${SliceSeed.EXCLUDE_RULE}\n`)
    const cut = await this.#cutOf(located)
    await this.write(
      `${located.path}/${SliceSeed.RELATIVE_PATH}`,
      SliceSeed.textFor({ issue, branch: located.branch, base: this.base, cut })
    )
  }

  async #gitDirOf(located) {
    const asked = await this.run(GitWorkspace.gitDirArgvFor(located.path))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `no se pudo resolver el git dir de ${located.path}, así que ${SliceSeed.RELATIVE_PATH} quedaría visible para git: ${asked.stderr.trim()}`
      )
    }

    return asked.stdout.trim()
  }

  async #cutOf(located) {
    const measured = await this.run(GitWorkspace.cutArgvFor(located.path))
    if (measured.failed) {
      throw new WorkspaceNotPrepared(
        `no se pudo medir el commit de ${located.path}, así que ${SliceSeed.RELATIVE_PATH} no se siembra sin corte: ${measured.stderr.trim()}`
      )
    }

    return measured.stdout.trim()
  }
}
