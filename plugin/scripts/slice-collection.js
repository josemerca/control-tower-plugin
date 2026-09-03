export const PullRequestState = Object.freeze({
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  MERGED: 'MERGED',
})

export const DeliveryState = Object.freeze({
  NOT_OPENED: 'not-opened',
  OPEN: 'open',
  MERGED: 'merged',
  ABANDONED: 'abandoned',
})

export const CollectionStep = Object.freeze({
  COLLECT: 'collect',
  WAIT: 'wait',
  KEEP_DIRTY_TREE: 'keep-dirty-tree',
  KEEP_TIP_NOT_MERGED: 'keep-tip-not-merged',
  NOTHING_LEFT: 'nothing-left',
})

export class CommitId {
  static #SHAPE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

  static isWellFormed(text) {
    return typeof text === 'string' && CommitId.#SHAPE.test(text)
  }
}

export class Delivery {
  static #STATE_OF = Object.freeze({
    [PullRequestState.OPEN]: DeliveryState.OPEN,
    [PullRequestState.CLOSED]: DeliveryState.ABANDONED,
    [PullRequestState.MERGED]: DeliveryState.MERGED,
  })

  static #PRECEDENCE = Object.freeze([DeliveryState.MERGED, DeliveryState.OPEN, DeliveryState.ABANDONED])

  constructor({ state, number, headRefOid }) {
    if (!Object.values(DeliveryState).includes(state)) {
      throw new Error(`state must be a DeliveryState member, got ${JSON.stringify(state)}`)
    }
    const opened = state !== DeliveryState.NOT_OPENED
    if (opened !== (number !== null)) {
      throw new Error(`state ${state} disagrees with its number, got ${JSON.stringify(number)}`)
    }
    if (opened !== (headRefOid !== null)) {
      throw new Error(`state ${state} disagrees with its headRefOid, got ${JSON.stringify(headRefOid)}`)
    }
    this.state = state
    this.number = number
    this.headRefOid = headRefOid
    Object.freeze(this)
  }

  static notOpened() {
    return new Delivery({ state: DeliveryState.NOT_OPENED, number: null, headRefOid: null })
  }

  static fromPullRequestList(text) {
    const opened = Delivery.#listedIn(text).map((entry) => Delivery.#opened(entry, text))
    for (const state of Delivery.#PRECEDENCE) {
      const matching = opened.filter((delivery) => delivery.state === state)
      if (matching.length > 0) {
        return matching.reduce((chosen, candidate) => (candidate.number > chosen.number ? candidate : chosen))
      }
    }
    return Delivery.notOpened()
  }

  static #listedIn(text) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`gh pr list printed unreadable JSON: ${text}`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`gh pr list printed something that is not a list of pull requests: ${text}`)
    }
    return parsed
  }

  static #opened(entry, text) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`gh pr list printed a pull request that is not an object: ${text}`)
    }
    if (!Number.isInteger(entry.number) || entry.number <= 0) {
      throw new Error(`gh pr list printed a pull request whose number is not a whole number: ${text}`)
    }
    if (!CommitId.isWellFormed(entry.headRefOid)) {
      throw new Error(`gh pr list printed a pull request whose headRefOid is not a commit: ${text}`)
    }
    if (!Object.values(PullRequestState).includes(entry.state)) {
      throw new Error(`gh pr list printed a pull request state this reader does not know: ${text}`)
    }
    return new Delivery({
      state: Delivery.#STATE_OF[entry.state],
      number: entry.number,
      headRefOid: entry.headRefOid,
    })
  }
}

export class CollectionPolicy {
  static stepFor({ delivery, hasWorktree, hasBranch, status, localTip }) {
    CollectionPolicy.#refuseTreeDisagreement(hasWorktree, status)
    CollectionPolicy.#refuseTipDisagreement(hasBranch, localTip)
    if (!hasWorktree && !hasBranch) return CollectionStep.NOTHING_LEFT
    if (delivery.state === DeliveryState.NOT_OPENED) return CollectionStep.WAIT
    if (delivery.state === DeliveryState.OPEN) return CollectionStep.WAIT
    if (delivery.state === DeliveryState.ABANDONED) return CollectionStep.WAIT
    if (delivery.state === DeliveryState.MERGED) return CollectionPolicy.#stepForMerged(delivery, status, localTip)
    throw new Error(`CollectionPolicy does not describe the delivery state ${JSON.stringify(delivery.state)}`)
  }

  static #stepForMerged(delivery, status, localTip) {
    if (status !== null && status.trim().length > 0) return CollectionStep.KEEP_DIRTY_TREE
    if (localTip !== null && localTip !== delivery.headRefOid) return CollectionStep.KEEP_TIP_NOT_MERGED
    return CollectionStep.COLLECT
  }

  static #refuseTreeDisagreement(hasWorktree, status) {
    if (hasWorktree ? typeof status === 'string' : status === null) return
    throw new Error(`hasWorktree ${hasWorktree} disagrees with the git status given, got ${JSON.stringify(status)}`)
  }

  static #refuseTipDisagreement(hasBranch, localTip) {
    if (hasBranch ? CommitId.isWellFormed(localTip) : localTip === null) return
    throw new Error(`hasBranch ${hasBranch} disagrees with the local tip given, got ${JSON.stringify(localTip)}`)
  }
}

export class CollectionCommands {
  static PULL_REQUEST_FIELDS = 'number,state,headRefOid'
  static PULL_REQUEST_LIMIT = '10'

  static prListArgv({ repo, branch }) {
    return [
      'pr', 'list',
      '--repo', repo,
      '--head', branch,
      '--state', 'all',
      '--json', CollectionCommands.PULL_REQUEST_FIELDS,
      '--limit', CollectionCommands.PULL_REQUEST_LIMIT,
    ]
  }

  static statusArgv({ worktree }) {
    return ['-C', worktree, 'status', '--porcelain', '--untracked-files=all']
  }

  static tipArgv({ mainRoot, branch }) {
    return ['-C', mainRoot, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]
  }

  static removeWorktreeArgv({ mainRoot, worktree }) {
    return ['-C', mainRoot, 'worktree', 'remove', '--force', worktree]
  }

  static deleteBranchArgv({ mainRoot, branch }) {
    return ['-C', mainRoot, 'branch', '-D', branch]
  }

  static closeWorkspaceArgv(ref) {
    return ['close-workspace', '--workspace', ref]
  }
}
