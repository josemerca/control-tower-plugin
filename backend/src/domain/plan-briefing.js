export class PlanBriefing {
  constructor({ ticket, issue, located, errand }) {
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
