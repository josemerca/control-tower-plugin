export class SliceBase {
  constructor({ git }) {
    this.git = git
  }

  measurementRef({ baseBranch, fallbackRef }) {
    const mergeBase = this.git(['merge-base', 'HEAD', `origin/${baseBranch}`])
    if (mergeBase) return mergeBase
    return fallbackRef ?? null
  }
}

export class BaseBranch {
  static CANDIDATES = ['HEAD', 'main', 'master']

  constructor({ remoteRefExists }) {
    this.remoteRefExists = remoteRefExists
  }

  resolve({ declared }) {
    const named = typeof declared === 'string' && declared.trim() ? declared.trim() : null
    if (named) return named
    return BaseBranch.CANDIDATES.find((candidate) => this.remoteRefExists(candidate)) ?? null
  }
}
