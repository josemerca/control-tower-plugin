import { CollectionCommands, CollectionPolicy, CollectionStep, CommitId, Delivery } from './slice-collection.js'

export const CollectionOutcome = Object.freeze({
  COLLECTED: 'collected',
  WOULD_COLLECT: 'would-collect',
  PARTIAL: 'partial',
  NOTHING_LEFT: 'nothing-left',
  WAITING: 'waiting',
  KEPT_DIRTY_TREE: 'kept-dirty-tree',
  KEPT_TIP_NOT_MERGED: 'kept-tip-not-merged',
  NOT_READ: 'not-read',
})

export const CollectionRead = Object.freeze({
  PULL_REQUEST_LIST: 'gh pr list',
  WORKING_TREE_STATUS: 'git status',
  LOCAL_TIP: 'git rev-parse',
  CMUX_WORKSPACE: 'cmux workspace list',
})

export const CollectionAction = Object.freeze({
  CLOSE_WORKSPACE: 'close-workspace',
  REMOVE_WORKTREE: 'remove-worktree',
  DELETE_BRANCH: 'delete-branch',
})

export const CollectionProgram = Object.freeze({
  GIT: 'git',
  CMUX: 'cmux',
})

class CouldNotRead extends Error {
  constructor({ read, detail }) {
    super(`${read}: ${detail}`)
    this.read = read
    this.detail = detail
  }
}

export class CollectionCommand {
  constructor({ action, program, argv }) {
    if (!Object.values(CollectionAction).includes(action)) {
      throw new Error(`action must be a CollectionAction member, got ${JSON.stringify(action)}`)
    }
    if (!Object.values(CollectionProgram).includes(program)) {
      throw new Error(`program must be a CollectionProgram member, got ${JSON.stringify(program)}`)
    }
    this.action = action
    this.program = program
    this.argv = Object.freeze([...argv])
    Object.freeze(this)
  }

  static closeWorkspace(ref) {
    return new CollectionCommand({
      action: CollectionAction.CLOSE_WORKSPACE,
      program: CollectionProgram.CMUX,
      argv: CollectionCommands.closeWorkspaceArgv(ref),
    })
  }

  static removeWorktree({ mainRoot, worktree }) {
    return new CollectionCommand({
      action: CollectionAction.REMOVE_WORKTREE,
      program: CollectionProgram.GIT,
      argv: CollectionCommands.removeWorktreeArgv({ mainRoot, worktree }),
    })
  }

  static deleteBranch({ mainRoot, branch }) {
    return new CollectionCommand({
      action: CollectionAction.DELETE_BRANCH,
      program: CollectionProgram.GIT,
      argv: CollectionCommands.deleteBranchArgv({ mainRoot, branch }),
    })
  }

  get line() {
    return [this.program, ...this.argv].join(' ')
  }
}

export class WorkspaceLookup {
  constructor({ answered, ref }) {
    if (typeof answered !== 'boolean') {
      throw new Error(`answered must be a boolean, got ${JSON.stringify(answered)}`)
    }
    if (ref !== null && !(typeof ref === 'string' && ref.length > 0)) {
      throw new Error(`ref must be a non-empty string or null, got ${JSON.stringify(ref)}`)
    }
    if (!answered && ref !== null) {
      throw new Error(`a lookup that could not be answered carries no ref, got ${JSON.stringify(ref)}`)
    }
    this.answered = answered
    this.ref = ref
    Object.freeze(this)
  }

  static fromCmuxAnswer(answer) {
    if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
      throw new Error(`the cmux lookup answered something that is not an object: ${JSON.stringify(answer)}`)
    }
    if (typeof answer.consultado !== 'boolean') {
      throw new Error(`the cmux lookup answered without saying whether cmux could be asked: ${JSON.stringify(answer)}`)
    }
    return new WorkspaceLookup({ answered: answer.consultado, ref: answer.ref })
  }
}

export class CollectionReport {
  constructor({ outcome, delivery, read, detail, done, pending }) {
    if (!Object.values(CollectionOutcome).includes(outcome)) {
      throw new Error(`outcome must be a CollectionOutcome member, got ${JSON.stringify(outcome)}`)
    }
    if (outcome === CollectionOutcome.NOT_READ) {
      if (delivery !== null) {
        throw new Error(`a report that could not read carries no delivery, got ${JSON.stringify(delivery)}`)
      }
      if (!Object.values(CollectionRead).includes(read)) {
        throw new Error(`a report that could not read names the read that failed, got ${JSON.stringify(read)}`)
      }
    } else {
      if (!(delivery instanceof Delivery)) {
        throw new Error(`outcome ${outcome} needs the delivery it was decided from, got ${JSON.stringify(delivery)}`)
      }
      if (read !== null) {
        throw new Error(`outcome ${outcome} names no failed read, got ${JSON.stringify(read)}`)
      }
    }
    const explained = outcome === CollectionOutcome.NOT_READ || outcome === CollectionOutcome.PARTIAL
    if (explained !== (typeof detail === 'string' && detail.length > 0)) {
      throw new Error(`outcome ${outcome} disagrees with the detail given, got ${JSON.stringify(detail)}`)
    }
    this.outcome = outcome
    this.delivery = delivery
    this.read = read
    this.detail = detail
    this.done = Object.freeze([...done])
    this.pending = Object.freeze([...pending])
    Object.freeze(this)
  }

  static notRead({ read, detail }) {
    return new CollectionReport({ outcome: CollectionOutcome.NOT_READ, delivery: null, read, detail, done: [], pending: [] })
  }

  static waiting(delivery) {
    return CollectionReport.#decided(CollectionOutcome.WAITING, delivery)
  }

  static nothingLeft(delivery) {
    return CollectionReport.#decided(CollectionOutcome.NOTHING_LEFT, delivery)
  }

  static keptDirtyTree(delivery) {
    return CollectionReport.#decided(CollectionOutcome.KEPT_DIRTY_TREE, delivery)
  }

  static keptTipNotMerged(delivery) {
    return CollectionReport.#decided(CollectionOutcome.KEPT_TIP_NOT_MERGED, delivery)
  }

  static wouldCollect({ delivery, commands }) {
    if (commands.length === 0) {
      throw new Error('a collection that would run no command is nothing left, not a collection')
    }
    return new CollectionReport({ outcome: CollectionOutcome.WOULD_COLLECT, delivery, read: null, detail: null, done: [], pending: commands })
  }

  static collected({ delivery, done }) {
    if (done.length === 0) {
      throw new Error('a collection that ran no command is nothing left, not a collection')
    }
    return new CollectionReport({ outcome: CollectionOutcome.COLLECTED, delivery, read: null, detail: null, done, pending: [] })
  }

  static partial({ delivery, done, pending, detail }) {
    if (pending.length === 0) {
      throw new Error('a partial collection leaves at least one command pending')
    }
    return new CollectionReport({ outcome: CollectionOutcome.PARTIAL, delivery, read: null, detail, done, pending })
  }

  static #decided(outcome, delivery) {
    return new CollectionReport({ outcome, delivery, read: null, detail: null, done: [], pending: [] })
  }
}

export class SliceCollector {
  constructor({ gh, git, cmux, findWorkspace }) {
    this.gh = gh
    this.git = git
    this.cmux = cmux
    this.findWorkspace = findWorkspace
  }

  collect({ artifacts, repo }) {
    const rehearsed = this.rehearse({ artifacts, repo })
    if (rehearsed.outcome !== CollectionOutcome.WOULD_COLLECT) return rehearsed
    return this.#ran(rehearsed)
  }

  rehearse({ artifacts, repo }) {
    SliceCollector.#refuseArtifactsThatWereNotRead(artifacts)
    try {
      return this.#decided({ artifacts, repo })
    } catch (failure) {
      if (failure instanceof CouldNotRead) return CollectionReport.notRead({ read: failure.read, detail: failure.detail })
      throw failure
    }
  }

  #decided({ artifacts, repo }) {
    const delivery = this.#delivery({ repo, branch: artifacts.branch })
    const status = artifacts.hasWorktree ? this.#status(artifacts) : null
    const localTip = artifacts.hasBranch ? this.#localTip(artifacts) : null
    const step = CollectionPolicy.stepFor({
      delivery,
      hasWorktree: artifacts.hasWorktree,
      hasBranch: artifacts.hasBranch,
      status,
      localTip,
    })
    if (step === CollectionStep.COLLECT) return CollectionReport.wouldCollect({ delivery, commands: this.#commandsFor(artifacts) })
    if (step === CollectionStep.WAIT) return CollectionReport.waiting(delivery)
    if (step === CollectionStep.NOTHING_LEFT) return CollectionReport.nothingLeft(delivery)
    if (step === CollectionStep.KEEP_DIRTY_TREE) return CollectionReport.keptDirtyTree(delivery)
    if (step === CollectionStep.KEEP_TIP_NOT_MERGED) return CollectionReport.keptTipNotMerged(delivery)
    throw new Error(`SliceCollector does not describe the collection step ${JSON.stringify(step)}`)
  }

  #delivery({ repo, branch }) {
    const printed = this.#printedBy(CollectionRead.PULL_REQUEST_LIST, this.gh(CollectionCommands.prListArgv({ repo, branch })))
    try {
      return Delivery.fromPullRequestList(printed)
    } catch (unreadable) {
      throw new CouldNotRead({ read: CollectionRead.PULL_REQUEST_LIST, detail: unreadable.message })
    }
  }

  #status(artifacts) {
    return this.#printedBy(CollectionRead.WORKING_TREE_STATUS, this.git(CollectionCommands.statusArgv(artifacts)))
  }

  #localTip(artifacts) {
    const printed = this.#printedBy(CollectionRead.LOCAL_TIP, this.git(CollectionCommands.tipArgv(artifacts))).trim()
    if (!CommitId.isWellFormed(printed)) {
      throw new CouldNotRead({ read: CollectionRead.LOCAL_TIP, detail: `printed something that is not a commit: ${JSON.stringify(printed)}` })
    }
    return printed
  }

  #commandsFor(artifacts) {
    const lookup = WorkspaceLookup.fromCmuxAnswer(this.findWorkspace(artifacts.worktree))
    if (!lookup.answered) {
      throw new CouldNotRead({
        read: CollectionRead.CMUX_WORKSPACE,
        detail: `cmux could not be asked which workspace sits in ${artifacts.worktree}`,
      })
    }
    return [
      lookup.ref === null ? null : CollectionCommand.closeWorkspace(lookup.ref),
      artifacts.hasWorktree ? CollectionCommand.removeWorktree(artifacts) : null,
      artifacts.hasBranch ? CollectionCommand.deleteBranch(artifacts) : null,
    ].filter((command) => command !== null)
  }

  #ran(rehearsed) {
    const done = []
    const pending = []
    const details = []
    for (const command of rehearsed.pending) {
      const answer = SliceCollector.#answerOf(command.line, this.#execute(command))
      if (answer.code === 0) {
        done.push(command)
        continue
      }
      pending.push(command)
      details.push(`${command.line} failed with exit code ${answer.code}: ${SliceCollector.#diagnosisOf(answer)}`)
    }
    if (pending.length === 0) return CollectionReport.collected({ delivery: rehearsed.delivery, done })
    return CollectionReport.partial({ delivery: rehearsed.delivery, done, pending, detail: details.join('; ') })
  }

  #execute(command) {
    if (command.program === CollectionProgram.GIT) return this.git(command.argv)
    if (command.program === CollectionProgram.CMUX) return this.cmux(command.argv)
    throw new Error(`SliceCollector cannot run a command for the program ${JSON.stringify(command.program)}`)
  }

  #printedBy(read, answer) {
    const checked = SliceCollector.#answerOf(read, answer)
    if (checked.code !== 0) {
      throw new CouldNotRead({ read, detail: `exit code ${checked.code}: ${SliceCollector.#diagnosisOf(checked)}` })
    }
    return checked.stdout
  }

  static #answerOf(what, answer) {
    if (answer === null || typeof answer !== 'object' || typeof answer.code !== 'number'
      || typeof answer.stdout !== 'string' || typeof answer.stderr !== 'string') {
      throw new Error(`the runner of ${what} must answer { code, stdout, stderr }, got ${JSON.stringify(answer)}`)
    }
    return answer
  }

  static #diagnosisOf(answer) {
    return answer.stderr.trim().length > 0 ? answer.stderr.trim() : '(it printed nothing on its error channel)'
  }

  static #refuseArtifactsThatWereNotRead(artifacts) {
    if (artifacts !== null && typeof artifacts === 'object' && artifacts.known === true) return
    throw new Error(`SliceCollector needs the artifacts of a disk that could be read, got ${JSON.stringify(artifacts)}`)
  }
}
