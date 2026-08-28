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
