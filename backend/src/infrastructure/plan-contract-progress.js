import { PlanProgress } from '../domain/ports/plan-progress.js'
import { PlanState } from '../domain/value-objects/plan-state.js'
import { PlanProgressNotRead } from '../domain/exceptions.js'

export class PlanContractProgress extends PlanProgress {
  static PLANS = 'docs/superpowers/plans'
  static CONTRACT_UNMET = 6

  constructor({ node, git, dispatchCheck }) {
    super()
    this.node = node
    this.git = git
    this.dispatchCheck = dispatchCheck
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
    if (validated.code === PlanContractProgress.CONTRACT_UNMET) return PlanState.WRITING
    if (validated.failed) {
      throw new PlanProgressNotRead(
        `dispatch-check --check-plan could not be asked in ${located.path}, it exited ${validated.code}: ${validated.stderr.trim()}`
      )
    }
    const pending = await this.git(PlanContractProgress.pendingArgvFor(located))
    if (pending.failed) {
      throw new PlanProgressNotRead(
        `git status could not say whether the plan of ${located.path} is committed: ${pending.stderr.trim()}`
      )
    }
    if (pending.stdout.trim().length > 0) return PlanState.WRITING

    return PlanState.READY
  }
}
