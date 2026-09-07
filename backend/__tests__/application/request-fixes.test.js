import { describe, it, expect } from 'vitest'
import { RequestFixes, RequestFixesParams } from '../../src/application/actions/request-fixes.js'
import { Workbench } from '../../src/domain/ports/workbench.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { SliceNotReopened, PlanAgentNotResumed } from '../../src/domain/exceptions.js'

class WorkbenchDouble extends Workbench {
  constructor(failing = null) {
    super()
    this.failing = failing
    this.asked = []
  }

  static refusing(cause) {
    return new WorkbenchDouble(cause)
  }

  async reopen(subject) {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing
  }
}

class PlanAgentsDouble extends PlanAgents {
  constructor(failing = null) {
    super()
    this.failing = failing
    this.asked = []
  }

  static refusing(cause) {
    return new PlanAgentsDouble(cause)
  }

  async fix(subject) {
    this.asked.push(subject)
    if (this.failing !== null) throw this.failing
  }
}

class Flow {
  static AGENT = 'workspace:20'
  static ISSUE_NUMBER = 7
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static CHANGES = 'src/foo.js:42: revienta con []'

  constructor({ workbench, planAgents } = {}) {
    this.workbench = workbench ?? new WorkbenchDouble()
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  static reopened() {
    return new Flow()
  }

  static refusingTheReopen(cause = new SliceNotReopened('sigue en in-review')) {
    return new Flow({ workbench: WorkbenchDouble.refusing(cause) })
  }

  async run() {
    return new RequestFixes(this).execute(new RequestFixesParams({
      agent: Flow.AGENT,
      issue: Flow.ISSUE_NUMBER,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
    }))
  }
}

describe('RequestFixes', () => {
  it('the_issue_goes_back_to_the_workbench_before_the_agent_is_told_anything', async () => {
    const flow = Flow.reopened()

    await flow.run()

    expect(flow.workbench.asked).toEqual([{ issueNumber: Flow.ISSUE_NUMBER, repository: Flow.REPOSITORY }])
    expect(flow.planAgents.asked).toEqual([{
      agent: Flow.AGENT,
      issue: Flow.ISSUE_NUMBER,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
    }])
  })

  it('a_reopen_that_failed_leaves_the_agent_untold_so_the_change_is_not_half_delivered', async () => {
    const flow = Flow.refusingTheReopen()

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(SliceNotReopened)
    expect(flow.planAgents.asked).toEqual([])
  })

  it('an_agent_that_cannot_be_reached_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({
      planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toBe('no such workspace')
  })

  it('the_agent_it_types_into_is_the_handle_it_was_given_and_not_one_it_derived', async () => {
    const flow = Flow.reopened()

    await flow.run()

    expect(flow.planAgents.asked[0].agent).toBe(Flow.AGENT)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().fix({
      agent: Flow.AGENT, issue: Flow.ISSUE_NUMBER, repository: Flow.REPOSITORY, changes: Flow.CHANGES,
    })).rejects.toThrow(/must implement fix/)
  })
})
