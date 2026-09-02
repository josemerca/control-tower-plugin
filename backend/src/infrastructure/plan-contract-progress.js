import { PlanProgress } from '../domain/ports/plan-progress.js'
import { PlanState } from '../domain/value-objects/plan-state.js'

export class PlanContractProgress extends PlanProgress {
  static PLANS = 'docs/superpowers/plans'

  constructor({ node, git, dispatchCheck, stderr = (line) => process.stderr.write(line) }) {
    super()
    this.node = node
    this.git = git
    this.dispatchCheck = dispatchCheck
    this.stderr = stderr
  }

  static contractArgvFor({ dispatchCheck, issue, repository }) {
    return [dispatchCheck, String(issue.number), '--repo', repository.text, '--check-plan']
  }

  static pendingArgvFor(located) {
    return ['-C', located.path, 'status', '--porcelain', '--', PlanContractProgress.PLANS]
  }

  async of({ located, issue, repository }) {
    const validated = await this.node(
      PlanContractProgress.contractArgvFor({ dispatchCheck: this.dispatchCheck, issue, repository }),
      { cwd: located.path }
    )
    if (validated.failed) {
      this.#trace('dispatch-check', validated.stderr)
      return PlanState.WRITING
    }
    const pending = await this.git(PlanContractProgress.pendingArgvFor(located))
    if (pending.failed) {
      this.#trace('git', pending.stderr)
      return PlanState.WRITING
    }
    if (pending.stdout.trim().length > 0) return PlanState.WRITING

    return PlanState.READY
  }

  #trace(bin, detail) {
    this.stderr(`plan progress: ${bin} failed: ${detail.trim()}\n`)
  }
}
