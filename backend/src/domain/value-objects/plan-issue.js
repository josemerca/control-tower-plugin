export class PlanIssue {
  constructor({ number, url }) {
    this.number = number
    this.url = url
    Object.freeze(this)
  }

  toString() {
    return `#${this.number}`
  }
}
