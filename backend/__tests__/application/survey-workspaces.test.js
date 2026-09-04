import { describe, it, expect } from 'vitest'
import { SurveyWorkspaces, SurveyWorkspacesParams } from '../../src/application/queries/survey-workspaces.js'
import { Workspace } from '../../src/domain/ports/workspace.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.js'
import { WorkspaceNotRead } from '../../src/domain/exceptions.js'

class WorkspaceDouble extends Workspace {
  static ROOT = '/repo/checkout'
  static CHECKOUT = new CheckoutRoot(WorkspaceDouble.ROOT)
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor(answer) {
    super()
    this.answer = answer
    this.surveys = []
  }

  static preparedFor(issueNumber) {
    return new PreparedWorkspace({
      issueNumber,
      located: new WorkspaceLocation({
        root: WorkspaceDouble.ROOT,
        path: `${WorkspaceDouble.ROOT}/.worktrees/${issueNumber}`,
        branch: `feat/${issueNumber}`,
      }),
    })
  }

  static holding(...issueNumbers) {
    return new WorkspaceDouble(new WorkspaceSurvey({
      repository: WorkspaceDouble.REPOSITORY,
      prepared: issueNumbers.map((issueNumber) => WorkspaceDouble.preparedFor(issueNumber)),
    }))
  }

  static unable(said) {
    return new WorkspaceDouble(new WorkspaceNotRead(said))
  }

  async survey(root) {
    this.surveys.push(root)
    if (this.answer instanceof Error) throw this.answer

    return this.answer
  }

  asked(root = WorkspaceDouble.CHECKOUT) {
    return new SurveyWorkspaces({ workspace: this }).execute(new SurveyWorkspacesParams(root))
  }

  refusal() {
    return this.asked().catch((cause) => cause)
  }
}

describe('SurveyWorkspaces', () => {
  it('what_the_checkout_holds_is_what_the_caller_gets_without_being_reinterpreted', async () => {
    const workspace = WorkspaceDouble.holding(42, 7)

    const surveyed = await workspace.asked()

    expect(surveyed.survey).toBe(workspace.answer)
    expect(surveyed.survey.prepared.map((prepared) => prepared.issueNumber)).toEqual([42, 7])
    expect(surveyed.survey.repository).toBe(WorkspaceDouble.REPOSITORY)
  })

  it('the_clone_named_in_the_params_is_the_one_surveyed_and_it_is_asked_once', async () => {
    const workspace = WorkspaceDouble.holding(42)
    const elsewhere = new CheckoutRoot('/elsewhere/clone')

    await workspace.asked(elsewhere)

    expect(workspace.surveys).toEqual([elsewhere])
  })

  it('a_checkout_with_nothing_prepared_is_an_empty_survey_and_never_a_failure', async () => {
    const surveyed = await WorkspaceDouble.holding().asked()

    expect(surveyed.survey.prepared).toEqual([])
  })

  it('a_checkout_that_could_not_be_read_travels_out_typed_instead_of_being_turned_into_an_empty_survey', async () => {
    const refusal = await WorkspaceDouble.unable('git worktree list refused').refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotRead)
    expect(refusal.message).toBe('git worktree list refused')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new Workspace().survey(WorkspaceDouble.CHECKOUT)).rejects.toThrow(/must implement survey/)
  })
})
