import { describe, it, expect } from 'vitest'
import { ReadImplementationProgress, ReadImplementationProgressParams } from '../../src/application/queries/read-implementation-progress.js'
import { ImplementationProgress } from '../../src/domain/ports/implementation-progress.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

class ImplementationProgressDouble extends ImplementationProgress {
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

describe('ReadImplementationProgress', () => {
  const root = new CheckoutRoot('/repo/.worktrees/42')
  const issue = 42

  it('the_query_hands_the_port_the_root_and_the_issue_it_was_asked_about', async () => {
    const progress = new ImplementationProgressDouble('irrelevant')

    await new ReadImplementationProgress({ implementationProgress: progress })
      .execute(new ReadImplementationProgressParams({ root, issue }))

    expect(progress.asked).toEqual([{ root, issue }])
  })

  it('what_the_port_answers_travels_back_whole_inside_the_result', async () => {
    const answer = { some: 'state' }
    const progress = new ImplementationProgressDouble(answer)

    const read = await new ReadImplementationProgress({ implementationProgress: progress })
      .execute(new ReadImplementationProgressParams({ root, issue }))

    expect(read.state).toBe(answer)
  })
})
