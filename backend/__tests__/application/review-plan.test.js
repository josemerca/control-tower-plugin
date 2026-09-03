import { describe, it, expect } from 'vitest'
import { ReviewPlan, ReviewPlanParams } from '../../src/application/actions/review-plan.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.js'

class PlanAgentsDouble extends PlanAgents {
  constructor(answer = null) {
    super()
    this.answer = answer
    this.asked = []
  }

  static refusing(cause) {
    return new PlanAgentsDouble(cause)
  }

  async review({ agent, issue, repository, changes }) {
    this.asked.push({ agent, issue, repository, changes })
    if (this.answer instanceof Error) throw this.answer
  }
}

class Flow {
  static AGENT = 'workspace:20'
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')
  static CHANGES = 'añade el caso de la issue sin descripción'

  constructor({ planAgents } = {}) {
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run() {
    return new ReviewPlan(this).execute(new ReviewPlanParams({
      agent: Flow.AGENT, issue: Flow.ISSUE, repository: Flow.REPOSITORY, changes: Flow.CHANGES,
    }))
  }
}

describe('ReviewPlan', () => {
  it('the_agent_it_asks_to_review_is_the_handle_it_was_given_and_not_one_it_derived', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([{
      agent: Flow.AGENT,
      issue: Flow.ISSUE,
      repository: Flow.REPOSITORY,
      changes: Flow.CHANGES,
    }])
  })

  it('an_agent_that_cannot_be_reached_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({
      planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')),
    })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.name).toBe('PlanAgentNotResumed')
    expect(refusal.message).toBe('no such workspace')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().review({
      agent: Flow.AGENT, issue: Flow.ISSUE, repository: Flow.REPOSITORY, changes: Flow.CHANGES,
    })).rejects.toThrow(/must implement review/)
  })
})
