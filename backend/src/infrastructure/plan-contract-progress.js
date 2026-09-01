import { PlanProgress } from '../domain/plan-progress.js'
import { PlanState } from '../domain/plan-state.js'

export class PlanContractProgress extends PlanProgress {
  static PLANS = 'docs/superpowers/plans'

  constructor({ node, git, dispatchCheck, repository }) {
    super()
    this.node = node
    this.git = git
    this.dispatchCheck = dispatchCheck
    this.repository = repository
  }

  static contractArgvFor({ dispatchCheck, issue, repository }) {
    return [dispatchCheck, String(issue.number), '--repo', repository, '--check-plan']
  }

  static pendingArgvFor(located) {
    return ['-C', located.path, 'status', '--porcelain', '--', PlanContractProgress.PLANS]
  }

  async of({ located, issue }) {
    const validated = await this.node(
      PlanContractProgress.contractArgvFor({
        dispatchCheck: this.dispatchCheck,
        issue,
        repository: this.repository,
      }),
      { cwd: located.path }
    )
    if (validated.failed) {
      PlanContractProgress.#trace('dispatch-check', validated.stderr)
      return PlanState.WRITING
    }
    const pending = await this.git(PlanContractProgress.pendingArgvFor(located))
    if (pending.failed) {
      PlanContractProgress.#trace('git', pending.stderr)
      return PlanState.WRITING
    }
    if (pending.stdout.trim().length > 0) return PlanState.WRITING

    return PlanState.READY
  }

  static #trace(bin, stderr) {
    process.stderr.write(`plan progress: ${bin} failed: ${stderr.trim()}\n`)
  }
}
