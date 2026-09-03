import { describe, it, expect } from 'vitest'
import {
  ReadChangesAsked, ReadChangesAskedParams,
} from '../../src/application/queries/read-changes-asked.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

class PlanIssuesDouble extends PlanIssues {
  constructor(answer = []) {
    super()
    this.answer = answer
    this.asked = []
  }

  async changesAsked(subject) {
    this.asked.push(subject)
    return this.answer
  }
}

describe('ReadChangesAsked', () => {
  const issue = { number: 42 }
  const repository = new RepositoryName('josemerca/ct-loop-sandbox')
  const asking = (planIssues) => new ReadChangesAsked({ planIssues })
    .execute(new ReadChangesAskedParams({ issue, repository }))

  it('what_it_hands_back_is_every_change_asked_for_in_the_order_the_issue_holds_them', async () => {
    const wanted = [
      { id: 'IC_kwDOT9lB5c8AAAABRB_tVQ', text: 'añade el caso de la issue sin descripción' },
      { id: 'IC_kwDOT9lB5c8AAAABRCF0FA', text: 'y parte la tarea 3 en dos' },
    ]

    const read = await asking(new PlanIssuesDouble(wanted))

    expect(read.changes).toEqual(wanted)
  })

  it('the_port_is_asked_about_the_issue_and_the_repository_it_was_given', async () => {
    const issues = new PlanIssuesDouble()

    await asking(issues)

    expect(issues.asked).toEqual([{ issue, repository }])
  })

  it('an_issue_with_nothing_asked_of_it_answers_an_empty_list_and_not_a_null', async () => {
    const read = await asking(new PlanIssuesDouble([]))

    expect(read.changes).toEqual([])
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanIssues().changesAsked({ issue, repository }))
      .rejects.toThrow(/must implement changesAsked/)
  })
})
