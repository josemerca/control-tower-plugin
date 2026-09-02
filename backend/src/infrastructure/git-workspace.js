import { isAbsolute } from 'node:path'
import { Workspace } from '../domain/workspace.js'
import { WorkspaceLocation } from '../domain/workspace-location.js'
import { WorkspaceNotPrepared } from '../domain/exceptions.js'
import { SliceSeed } from './slice-seed.js'

export class GitWorkspace extends Workspace {
  static BIN = 'git'
  static DIRECTORY = '.worktrees'

  constructor({ run, write, read, root, base }) {
    super()
    this.run = run
    this.write = write
    this.read = read
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

  static commonDirArgvFor(path) {
    return ['-C', path, 'rev-parse', '--git-common-dir']
  }

  static statusArgvFor(path) {
    return ['-C', path, 'status', '--porcelain', '--untracked-files=all']
  }

  static removeArgvFor(root, path) {
    return ['-C', root, 'worktree', 'remove', '--force', path]
  }

  static deleteBranchArgvFor(root, branch) {
    return ['-C', root, 'branch', '-D', branch]
  }

  static excludeContentWith(current, rule) {
    const text = current ?? ''
    if (text.split('\n').some((line) => line.trim() === rule)) return { content: text, added: false }
    const separator = text === '' || text.endsWith('\n') ? '' : '\n'

    return { content: `${text}${separator}${rule}\n`, added: true }
  }

  async prepare(issue) {
    const path = GitWorkspace.pathFor(this.root, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(issue)
    const located = new WorkspaceLocation({ path, branch })
    await this.#seed(located, issue)

    return located
  }

  async undo(located) {
    await this.run(GitWorkspace.removeArgvFor(this.root, located.path))
    await this.run(GitWorkspace.deleteBranchArgvFor(this.root, located.branch))
  }

  async #cut(issue) {
    const argv = GitWorkspace.argvFor({ root: this.root, base: this.base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }
  }

  async #seed(located, issue) {
    await this.#exclude(located)
    const cut = await this.#cutOf(located)
    await this.write(
      `${located.path}/${SliceSeed.RELATIVE_PATH}`,
      SliceSeed.textFor({ issue, branch: located.branch, base: this.base, cut })
    )
    await this.#verifyHidden(located)
  }

  async #exclude(located) {
    const commonDir = await this.#commonDirOf(located)
    const path = `${commonDir}/${SliceSeed.EXCLUDE_PATH}`
    const current = await this.read(path)
    const next = GitWorkspace.excludeContentWith(current, SliceSeed.EXCLUDE_RULE)
    if (next.added) await this.write(path, next.content)
  }

  async #commonDirOf(located) {
    const asked = await this.run(GitWorkspace.commonDirArgvFor(located.path))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `no se pudo resolver el directorio común de git de ${located.path}, así que ${SliceSeed.RELATIVE_PATH} quedaría visible para git: ${asked.stderr.trim()}`
      )
    }
    const answered = asked.stdout.trim()

    return isAbsolute(answered) ? answered : `${this.root}/${answered}`
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

  async #verifyHidden(located) {
    const status = await this.run(GitWorkspace.statusArgvFor(located.path))
    if (status.failed) {
      throw new WorkspaceNotPrepared(
        `no se pudo comprobar que ${SliceSeed.RELATIVE_PATH} queda fuera de la vista de git en ${located.path}: ${status.stderr.trim()}`
      )
    }
    const visible = status.stdout.split('\n').some((line) => line.includes(SliceSeed.RELATIVE_PATH))
    if (visible) {
      throw new WorkspaceNotPrepared(
        `${SliceSeed.RELATIVE_PATH} sigue siendo visible para git en ${located.path} después de sembrar la regla de exclusión`
      )
    }
  }
}
