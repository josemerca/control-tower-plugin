import { describe, it, expect } from 'vitest'
import { ReadPlanProgress, ReadPlanProgressParams } from '../../src/application/queries/read-plan-progress.js'
import { PlanProgress } from '../../src/domain/ports/plan-progress.js'
import { PlanState } from '../../src/domain/value-objects/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

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
  const repository = new RepositoryName('josemerca/ct-loop-sandbox')

  it('what_the_port_answers_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const progress = new PlanProgressDouble(PlanState.READY)

    const read = await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue, repository }))

    expect(read.state).toBe(PlanState.READY)
  })

  it('the_port_is_asked_about_the_workspace_and_the_issue_and_the_repository_it_was_given', async () => {
    const progress = new PlanProgressDouble(PlanState.WRITING)

    await new ReadPlanProgress({ planProgress: progress })
      .execute(new ReadPlanProgressParams({ located, issue, repository }))

    expect(progress.asked).toEqual([{ located, issue, repository }])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanProgress().of({ located, issue, repository })).rejects.toThrow(/must implement of/)
  })
})
