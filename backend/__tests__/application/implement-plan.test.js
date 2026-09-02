import { describe, it, expect } from 'vitest'
import { ImplementPlan, ImplementPlanParams } from '../../src/application/actions/implement-plan.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
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

  async resume({ agent, issue }) {
    this.asked.push({ agent, issue })
    if (this.answer instanceof Error) throw this.answer
  }
}

class Flow {
  static AGENT = 'workspace:20'
  static ISSUE = 33

  constructor({ planAgents } = {}) {
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run() {
    return new ImplementPlan(this).execute(new ImplementPlanParams({
      agent: Flow.AGENT, issue: Flow.ISSUE,
    }))
  }
}

describe('ImplementPlan', () => {
  it('the_agent_it_resumes_is_the_handle_it_was_given_and_not_one_it_derived', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([
      { agent: Flow.AGENT, issue: Flow.ISSUE },
    ])
  })

  it('an_agent_that_cannot_be_resumed_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.name).toBe('PlanAgentNotResumed')
    expect(refusal.message).toBe('no such workspace')
  })
})
