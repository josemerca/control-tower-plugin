import { isAbsolute } from 'node:path'
import { SLICE_REL_PATH, excludeContentWith } from '../../../plugin/scripts/state-paths.js'
import { renderState } from '../../../plugin/scripts/state.js'
import { GhPlanIssues } from './gh-plan-issues.js'
import { Workspace } from '../domain/ports/workspace.js'
import { PreparedWorkspace } from '../domain/value-objects/prepared-workspace.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.js'
import { WorkspaceSurvey } from '../domain/value-objects/workspace-survey.js'
import {
  WorkspaceNotPrepared, WorkspaceNotRead, WorkspaceNotUnderstood,
} from '../domain/exceptions.js'

export class SliceSeed {
  static RELATIVE_PATH = SLICE_REL_PATH
  static PLAN_GATE = 'plan'
  static GATES =
    `${SliceSeed.PLAN_GATE} — GATE HUMANO pendiente: lo cierra una persona desde la app cuando pide ` +
    'implementar el plan, NO tú. Y hasta entonces puede pedirte cambios comentando ' +
    `\`${GhPlanIssues.CHANGES_TOKEN}\` en el issue. ` +
    'Ojo: la sección "## Gates" del issue describe el carril de /ct-next y aquí no aplica.'
  static EXCLUDE_PATH = 'info/exclude'
  static EXCLUDE_RULE = SliceSeed.RELATIVE_PATH

  static textFor({ issue, branch, base, cut }) {
    return renderState({
      meta: {
        task: `escribir el plan del issue #${issue.number}`,
        role: 'slice-agent: escribes el plan de este slice contra el código real y PARAS. No implementas nada.',
        status: 'in_progress',
        branch,
        base,
        base_sha: cut,
        last_commit: cut,
        gates: SliceSeed.GATES,
        github_issue: issue.number,
        you_are_here: 'worktree recién cortado, sin trabajo encima',
        next_action: 'escribe el plan prescriptivo, valídalo con --check-plan, commitéalo y para',
        blocked: null,
      },
      body: [
        `Estado del slice del issue #${issue.number}. Lo sembró el backend de Control Tower al abrir esta sesión.`,
        '',
        'Este fichero está fuera de la vista de git a propósito: no puede entrar en el pull request.',
      ].join('\n'),
    })
  }
}

export class WorktreeListing {
  static HEADING = 'worktree '
  static BRANCH = 'branch refs/heads/'
  static #NUMBERED = /^[1-9]\d*$/

  static surveyOf({ printed, root, repository }) {
    const blocks = printed.split('\n\n').map((block) => block.trim()).filter((block) => block.length > 0)
    if (blocks.length === 0) {
      throw new WorkspaceNotUnderstood(
        `git worktree list --porcelain printed nothing for ${root}, and a checkout always lists at least itself`
      )
    }

    return new WorkspaceSurvey({
      repository,
      prepared: blocks
        .map((block) => WorktreeListing.#preparedIn(block, root))
        .filter((found) => found !== null),
    })
  }

  static #preparedIn(block, root) {
    const lines = block.split('\n')
    if (!lines[0].startsWith(WorktreeListing.HEADING)) {
      throw new WorkspaceNotUnderstood(
        `every block of git worktree list --porcelain names a worktree first, and ${root} answered ${JSON.stringify(lines[0])}`
      )
    }
    const path = lines[0].slice(WorktreeListing.HEADING.length)
    const numbered = path.split('/').at(-1)
    if (!WorktreeListing.#NUMBERED.test(numbered)) return null
    const issue = { number: Number(numbered) }
    if (path !== GitWorkspace.pathFor(root, issue)) return null
    const branch = GitWorkspace.branchFor(issue)
    if (!lines.includes(`${WorktreeListing.BRANCH}${branch}`)) return null

    return new PreparedWorkspace({ issueNumber: issue.number, located: new WorkspaceLocation({ root, path, branch }) })
  }
}

export class GitWorkspace extends Workspace {
  static BIN = 'git'
  static DIRECTORY = '.worktrees'
  static REMOTE_HEAD = 'refs/remotes/origin/HEAD'
  static REMOTE = 'origin'
  static #DECLARED = /^refs\/remotes\/origin\/(.+)$/
  static #NAMED = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/

  constructor({ run, write, read, stderr = (line) => process.stderr.write(line) }) {
    super()
    this.run = run
    this.write = write
    this.read = read
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

  static remoteArgvFor(root) {
    return ['-C', root, 'remote', 'get-url', GitWorkspace.REMOTE]
  }

  static surveyArgvFor(root) {
    return ['-C', root, 'worktree', 'list', '--porcelain']
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

  async confirm({ root, repository }) {
    const held = await this.#repositoryOfRoot(root.text)
    if (held.text !== repository.text) {
      throw new WorkspaceNotPrepared(
        `${root.text} holds ${held.text} and the issue lives in ${repository.text}: cutting a worktree here would plan one repository inside another`
      )
    }
  }

  async prepare({ issue, repository, root }) {
    const base = await this.#declaredBase(root.text)
    const path = GitWorkspace.pathFor(root.text, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(root.text, issue, base)
    const located = new WorkspaceLocation({ root: root.text, path, branch })
    try {
      await this.#seed(located, issue, base)
    } catch (failure) {
      await this.#compensate(located)
      throw failure
    }

    return located
  }

  async survey(root) {
    const repository = await this.#repositoryOfRoot(root.text)
    const listed = await this.run(GitWorkspace.surveyArgvFor(root.text))
    if (listed.failed) {
      throw new WorkspaceNotRead(
        `git worktree list could not say what ${root.text} holds, so the checkout was not surveyed: ${listed.stderr.trim()}`
      )
    }

    return WorktreeListing.surveyOf({ printed: listed.stdout, root: root.text, repository })
  }

  async #repositoryOfRoot(root) {
    const asked = await this.run(GitWorkspace.remoteArgvFor(root))
    if (asked.failed) {
      throw new WorkspaceNotRead(
        `${root} does not name a ${GitWorkspace.REMOTE} remote, so the repository it holds cannot be confirmed: ${asked.stderr.trim()}`
      )
    }
    const url = asked.stdout.trim()
    const named = url.match(GitWorkspace.#NAMED)
    if (named === null || !RepositoryName.isWellFormed(named[1])) {
      throw new WorkspaceNotUnderstood(
        `the ${GitWorkspace.REMOTE} of ${root} is ${JSON.stringify(url)}, and no owner/name can be read out of it`
      )
    }

    return new RepositoryName(named[1])
  }

  async #declaredBase(root) {
    const asked = await this.run(GitWorkspace.defaultBranchArgvFor(root))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `the remote of ${root} does not declare a default branch, so there is no base to cut from: ${asked.stderr.trim()}`
      )
    }
    const declared = asked.stdout.trim().match(GitWorkspace.#DECLARED)
    if (declared === null) {
      throw new WorkspaceNotUnderstood(
        `the remote does not declare a default branch under ${GitWorkspace.REMOTE_HEAD}, git printed ${JSON.stringify(asked.stdout)}`
      )
    }

    return declared[1]
  }

  async undo(located) {
    try {
      await this.run(GitWorkspace.removeArgvFor(located.root, located.path))
      await this.run(GitWorkspace.deleteBranchArgvFor(located.root, located.branch))
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

  async #cut(root, issue, base) {
    const argv = GitWorkspace.argvFor({ root, base, issue })
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
    if (answered.length === 0) {
      throw new WorkspaceNotUnderstood(
        `git --git-common-dir printed nothing for ${located.path}, so there is no directory to write ${SliceSeed.EXCLUDE_PATH} into`
      )
    }

    return isAbsolute(answered) ? answered : `${located.root}/${answered}`
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
      throw new WorkspaceNotUnderstood(
        `${SliceSeed.RELATIVE_PATH} is still visible to git in ${located.path} after seeding the exclusion rule`
      )
    }
  }
}
