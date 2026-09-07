export class PlanTarget {
  constructor({ repository, root }) {
    this.repository = repository
    this.root = root
    Object.freeze(this)
  }
}
