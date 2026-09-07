import { Workbench } from '../domain/ports/workbench.js'
import { SliceNotReopened, ReopenNotUnderstood } from '../domain/exceptions.js'

export class DispatchCheckWorkbench extends Workbench {
  static COMMAND = 'dispatch-check --reopen'
  static REOPENED = 0
  static LABEL_NOT_WRITTEN = 1
  static PRECONDITION_UNMET = 2
  static STATE_NOT_READ = 3

  static #BY_CODE = Object.freeze({
    [DispatchCheckWorkbench.REOPENED]: () => undefined,
    [DispatchCheckWorkbench.LABEL_NOT_WRITTEN]: (said, issue) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} could not move the label of #${issue.number}, which stays in review: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckWorkbench.PRECONDITION_UNMET]: (said, issue) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} refused to reopen #${issue.number} and touched no label: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckWorkbench.STATE_NOT_READ]: (said, issue) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} could not read the state of #${issue.number} and touched no label, so the next tick can try again: ${said.stderr.trim()}`
      )
    },
  })

  constructor({ node, dispatchCheck }) {
    super()
    this.node = node
    this.dispatchCheck = dispatchCheck
  }

  static argvFor({ dispatchCheck, issue, repository }) {
    return [dispatchCheck, String(issue.number), '--repo', repository.text, '--reopen']
  }

  static declaredCodes() {
    return Object.keys(DispatchCheckWorkbench.#BY_CODE).map(Number)
  }

  async reopen({ issue, repository }) {
    const said = await this.node(
      DispatchCheckWorkbench.argvFor({ dispatchCheck: this.dispatchCheck, issue, repository })
    )
    const projected = DispatchCheckWorkbench.#BY_CODE[said.code]
    if (projected === undefined) {
      throw new ReopenNotUnderstood(
        `${DispatchCheckWorkbench.COMMAND} exited ${said.code} for #${issue.number} and the reopen contract declares only ${DispatchCheckWorkbench.declaredCodes().join(', ')}: stdout ${JSON.stringify(said.stdout.trim())}, stderr ${JSON.stringify(said.stderr.trim())}`
      )
    }

    return projected(said, issue)
  }
}
