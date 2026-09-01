export class PlanBriefing {
  constructor({ ticket, issue, located, errand }) {
    if (located === undefined || located === null) {
      throw new Error(`a briefing carries where the session is located, got ${JSON.stringify(located)}`)
    }
    if (issue === undefined || issue === null) {
      throw new Error(`a briefing carries the issue it hydrates from, got ${JSON.stringify(issue)}`)
    }
    if (typeof errand !== 'string' || errand.trim().length === 0) {
      throw new Error(`a briefing carries an errand, got ${JSON.stringify(errand)}`)
    }
    this.ticket = ticket
    this.issue = issue
    this.located = located
    this.errand = errand
    Object.freeze(this)
  }
}
