import { PlanBriefing } from '../../domain/plan-briefing.js'

export class StartPlanParams {
  constructor({ ticket, repository }) {
    this.ticket = ticket
    this.repository = repository
    Object.freeze(this)
  }
}

export class StartPlanResult {
  constructor({ issue, session, located }) {
    this.issue = issue
    this.session = session
    this.located = located
    Object.freeze(this)
  }
}

export class StartPlan {
  constructor({ tickets, planIssues, workspace, planSession, brief }) {
    this.tickets = tickets
    this.planIssues = planIssues
    this.workspace = workspace
    this.planSession = planSession
    this.brief = brief
  }

  async execute(params) {
    const ticket = await this.tickets.detail(params.ticket)
    const issue = await this.planIssues.open({ ticket, repository: params.repository })
    const located = await this.workspace.prepare(issue)
    const session = await this.#launch(params, issue, located)

    return new StartPlanResult({ issue, session, located })
  }

  async #launch(params, issue, located) {
    try {
      return await this.planSession.start(new PlanBriefing({
        ticket: params.ticket,
        issue,
        located,
        errand: this.brief.errandFor({ issue, repository: params.repository }),
      }))
    } catch (failure) {
      await this.workspace.undo(located).catch(() => {})
      throw failure
    }
  }
}
