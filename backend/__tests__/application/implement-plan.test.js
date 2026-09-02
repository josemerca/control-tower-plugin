import { describe, it, expect } from 'vitest'
import { ImplementPlan, ImplementPlanParams } from '../../src/application/actions/implement-plan.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
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

  async resume({ story, issue, repository }) {
    this.asked.push({ story, issue, repository })
    if (this.answer instanceof Error) throw this.answer
  }
}

class Flow {
  static STORY = new UserStoryKey('XOP-4909')
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')

  constructor({ planAgents } = {}) {
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run() {
    return new ImplementPlan(this).execute(new ImplementPlanParams({
      story: Flow.STORY, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    }))
  }
}

describe('ImplementPlan', () => {
  it('the_agent_it_resumes_is_the_one_of_the_story_and_issue_it_was_given', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([
      { story: Flow.STORY, issue: Flow.ISSUE, repository: Flow.REPOSITORY },
    ])
  })

  it('an_agent_that_cannot_be_resumed_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing(new PlanAgentNotResumed('no such workspace')) })

    const refusal = await flow.run().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.name).toBe('PlanAgentNotResumed')
    expect(refusal.message).toBe('no such workspace')
  })

  it('what_goes_in_cannot_be_edited_after_the_use_case_settled_it', async () => {
    const params = new ImplementPlanParams({
      story: Flow.STORY, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    })

    await new ImplementPlan(new Flow()).execute(params)

    expect(Object.isFrozen(params)).toBe(true)
  })
})
