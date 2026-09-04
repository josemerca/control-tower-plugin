export class PlanIssue {
  constructor({ number, url }) {
    if (!Number.isInteger(number) || number < 1) {
      throw new Error(`an issue is numbered from one, got ${JSON.stringify(number)}`)
    }
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error(`an issue is reachable at a url, got ${JSON.stringify(url)}`)
    }
    this.number = number
    this.url = url
    Object.freeze(this)
  }

  toString() {
    return `#${this.number}`
  }
}
