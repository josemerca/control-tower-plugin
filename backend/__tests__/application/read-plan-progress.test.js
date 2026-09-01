import { describe, it, expect } from 'vitest'
import { ReadPlanProgress, ReadPlanProgressParams } from '../../src/application/queries/read-plan-progress.js'
import { PlanProgress } from '../../src/domain/plan-progress.js'
import { PlanState } from '../../src/domain/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'

class PlanProgressDouble extends PlanProgress {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  async of(subject) {
    this.asked.push(subject)
    return this.answer
  }
}

describe('ReadPlanProgress', () => {
  const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
  const issue = { number: 42 }

  it('what_the_port_answers_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const progress = new PlanProgressDouble(PlanState.READY)

    const read = await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue }))

    expect(read.state).toBe(PlanState.READY)
  })

  it('the_port_is_asked_about_the_workspace_and_the_issue_it_was_given', async () => {
    const progress = new PlanProgressDouble(PlanState.WRITING)

    await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue }))

    expect(progress.asked).toEqual([{ located, issue }])
  })

  it('neither_what_goes_in_nor_what_comes_out_can_be_edited_after_the_use_case_settled_it', async () => {
    const params = new ReadPlanProgressParams({ located, issue })

    const read = await new ReadPlanProgress({ planProgress: new PlanProgressDouble(PlanState.WRITING) })
      .execute(params)

    expect(Object.isFrozen(params)).toBe(true)
    expect(Object.isFrozen(read)).toBe(true)
  })
})
