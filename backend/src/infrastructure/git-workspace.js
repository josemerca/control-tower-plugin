import { isAbsolute } from 'node:path'
import { SLICE_REL_PATH, excludeContentWith } from '../../../plugin/scripts/state-paths.js'
import { Workspace } from '../domain/ports/workspace.js'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.js'
import { WorkspaceNotPrepared } from '../domain/exceptions.js'

export class SliceSeed {
  static RELATIVE_PATH = SLICE_REL_PATH
  static EXCLUDE_PATH = 'info/exclude'
  static EXCLUDE_RULE = SliceSeed.RELATIVE_PATH

  static textFor({ issue, branch, base, cut }) {
    return [
      '---',
      `task: "escribir el plan del issue #${issue.number}"`,
      'role: "slice-agent: escribes el plan de este slice contra el código real y PARAS. No implementas nada."',
      'status: in_progress',
      `branch: "${branch}"`,
      `base: "${base}"`,
      `base_sha: "${cut}"`,
      `last_commit: "${cut}"`,
      `github_issue: ${issue.number}`,
      'you_are_here: "worktree recién cortado, sin trabajo encima"',
      'next_action: "escribe el plan prescriptivo, valídalo con --check-plan, commitéalo y para"',
      'blocked: null',
      '---',
      '',
      `Estado del slice del issue #${issue.number}. Lo sembró el backend de Control Tower al abrir esta sesión.`,
      '',
      'Este fichero está fuera de la vista de git a propósito: no puede entrar en el pull request.',
      '',
    ].join('\n')
  }
}

export class GitWorkspace extends Workspace {
  static BIN = 'git'
  static DIRECTORY = '.worktrees'
  static REMOTE_HEAD = 'refs/remotes/origin/HEAD'
  static #DECLARED = /^refs\/remotes\/origin\/(.+)$/

  constructor({ run, write, read, root, stderr = (line) => process.stderr.write(line) }) {
    super()
    this.run = run
    this.write = write
    this.read = read
    this.root = root
    this.stderr = stderr
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

  static defaultBranchArgvFor(root) {
    return ['-C', root, 'symbolic-ref', GitWorkspace.REMOTE_HEAD]
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

  async prepare(issue) {
    const base = await this.#declaredBase()
    const path = GitWorkspace.pathFor(this.root, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(issue, base)
    const located = new WorkspaceLocation({ path, branch })
    try {
      await this.#seed(located, issue, base)
    } catch (failure) {
      await this.#compensate(located)
      throw failure
    }

    return located
  }

  async #declaredBase() {
    const asked = await this.run(GitWorkspace.defaultBranchArgvFor(this.root))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `the remote of ${this.root} does not declare a default branch, so there is no base to cut from: ${asked.stderr.trim()}`
      )
    }
    const declared = asked.stdout.trim().match(GitWorkspace.#DECLARED)
    if (declared === null) {
      throw new WorkspaceNotPrepared(
        `the remote does not declare a default branch under ${GitWorkspace.REMOTE_HEAD}, git printed ${JSON.stringify(asked.stdout)}`
      )
    }

    return declared[1]
  }

  async undo(located) {
    try {
      await this.run(GitWorkspace.removeArgvFor(this.root, located.path))
      await this.run(GitWorkspace.deleteBranchArgvFor(this.root, located.branch))
    } catch (failure) {
      this.#warn(located, failure)
      throw failure
    }
  }

  #warn(located, failure) {
    this.stderr(
      `git workspace: could not undo the worktree ${located.path} nor the branch ${located.branch}: ${failure.message}\n`
    )
  }

  async #compensate(located) {
    try {
      await this.undo(located)
    } catch {}
  }

  async #cut(issue, base) {
    const argv = GitWorkspace.argvFor({ root: this.root, base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }
  }

  async #seed(located, issue, base) {
    await this.#exclude(located)
    const cut = await this.#cutOf(located)
    await this.write(
      `${located.path}/${SliceSeed.RELATIVE_PATH}`,
      SliceSeed.textFor({ issue, branch: located.branch, base, cut })
    )
    await this.#verifyHidden(located)
  }

  async #exclude(located) {
    const commonDir = await this.#commonDirOf(located)
    const path = `${commonDir}/${SliceSeed.EXCLUDE_PATH}`
    const current = await this.read(path)
    const next = excludeContentWith(current ?? '', SliceSeed.EXCLUDE_RULE)
    if (next.added) await this.write(path, next.content)
  }

  async #commonDirOf(located) {
    const asked = await this.run(GitWorkspace.commonDirArgvFor(located.path))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `could not resolve the common git directory of ${located.path}, so ${SliceSeed.RELATIVE_PATH} would stay visible to git: ${asked.stderr.trim()}`
      )
    }
    const answered = asked.stdout.trim()

    return isAbsolute(answered) ? answered : `${this.root}/${answered}`
  }

  async #cutOf(located) {
    const measured = await this.run(GitWorkspace.cutArgvFor(located.path))
    if (measured.failed) {
      throw new WorkspaceNotPrepared(
        `could not measure the commit of ${located.path}, so ${SliceSeed.RELATIVE_PATH} is not seeded without a cut: ${measured.stderr.trim()}`
      )
    }

    return measured.stdout.trim()
  }

  async #verifyHidden(located) {
    const status = await this.run(GitWorkspace.statusArgvFor(located.path))
    if (status.failed) {
      throw new WorkspaceNotPrepared(
        `could not check that ${SliceSeed.RELATIVE_PATH} stays out of git's sight in ${located.path}: ${status.stderr.trim()}`
      )
    }
    const visible = status.stdout.split('\n').some((line) => line.includes(SliceSeed.RELATIVE_PATH))
    if (visible) {
      throw new WorkspaceNotPrepared(
        `${SliceSeed.RELATIVE_PATH} is still visible to git in ${located.path} after seeding the exclusion rule`
      )
    }
  }
}
