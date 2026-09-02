import { describe, it, expect } from 'vitest'
import { PlanContractProgress } from '../../src/infrastructure/plan-contract-progress.js'
import { PlanState } from '../../src/domain/value-objects/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanProgressNotRead } from '../../src/domain/exceptions.js'

class ProgressDouble {
  static WORKTREE = '/repo/.worktrees/42'
  static CHECK = '/plugin/scripts/dispatch-check.mjs'
  static REPOSITORY = new RepositoryName('owner/name')

  static CONTRACT_UNMET = 6
  static COULD_NOT_RUN = 1

  constructor({ validated, dirty, gitFailed = false, contractCode = ProgressDouble.CONTRACT_UNMET }) {
    this.validated = validated
    this.dirty = dirty
    this.gitFailed = gitFailed
    this.contractCode = contractCode
    this.node = []
    this.git = []
  }

  progress() {
    return new PlanContractProgress({
      dispatchCheck: ProgressDouble.CHECK,
      node: (argv, options) => {
        this.node.push([argv, options])
        return Promise.resolve(this.validated
          ? { failed: false, code: 0, stdout: 'plan ok', stderr: '' }
          : {
            failed: true,
            code: this.contractCode,
            stdout: '',
            stderr: 'no hay ningún plan prescriptivo',
          })
      },
      git: (argv) => {
        this.git.push(argv)
        return Promise.resolve(this.gitFailed
          ? { failed: true, code: 128, stdout: '', stderr: 'git is not available' }
          : { failed: false, code: 0, stdout: this.dirty, stderr: '' })
      },
    })
  }

  refusal() {
    return this.asked().catch((cause) => cause)
  }

  asked() {
    return this.progress().of({
      located: new WorkspaceLocation({ path: ProgressDouble.WORKTREE, branch: 'feat/42' }),
      issue: { number: 42 },
      repository: ProgressDouble.REPOSITORY,
    })
  }
}

describe('PlanContractProgress', () => {
  it('a_plan_that_is_valid_and_carries_nothing_uncommitted_is_ready', async () => {
    expect(await new ProgressDouble({ validated: true, dirty: '' }).asked()).toBe(PlanState.READY)
  })

  it('a_plan_the_contract_rejects_is_still_being_written', async () => {
    const asked = new ProgressDouble({ validated: false, dirty: '' })

    expect(await asked.asked()).toBe(PlanState.WRITING)
    expect(asked.git).toHaveLength(0)
  })

  it('a_valid_plan_that_is_not_committed_is_not_ready_because_it_would_not_travel_in_the_pull_request', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '?? docs/superpowers/plans/2026-09-01-issue-42-x.md\n' })

    expect(await asked.asked()).toBe(PlanState.WRITING)
  })

  it('a_valid_plan_with_uncommitted_edits_on_top_is_not_ready_either', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: ' M docs/superpowers/plans/2026-09-01-issue-42-x.md\n' })

    expect(await asked.asked()).toBe(PlanState.WRITING)
  })

  it('a_git_that_does_not_answer_is_a_typed_failure_naming_git_and_not_a_clean_tree', async () => {
    const refusal = await new ProgressDouble({ validated: true, dirty: '', gitFailed: true }).refusal()

    expect(refusal).toBeInstanceOf(PlanProgressNotRead)
    expect(refusal.message).toContain('git status')
    expect(refusal.message).toContain('git is not available')
  })

  it('a_dispatch_check_that_could_not_run_at_all_is_not_read_as_a_plan_that_does_not_comply_yet', async () => {
    const refusal = await new ProgressDouble({
      validated: false, dirty: '', contractCode: ProgressDouble.COULD_NOT_RUN,
    }).refusal()

    expect(refusal).toBeInstanceOf(PlanProgressNotRead)
    expect(refusal.message).toContain('no hay ningún plan prescriptivo')
  })

  it('the_contract_is_asked_from_inside_the_worktree_because_it_resolves_its_paths_from_there', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '' })

    await asked.asked()

    expect(asked.node[0][0]).toEqual([ProgressDouble.CHECK, '42', '--repo', 'owner/name', '--check-plan'])
    expect(asked.node[0][1]).toEqual({ cwd: ProgressDouble.WORKTREE })
  })

  it('git_is_asked_only_about_the_directory_the_plan_lives_in_and_not_about_the_whole_tree', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '' })

    await asked.asked()

    expect(asked.git[0]).toEqual([
      '-C', ProgressDouble.WORKTREE, 'status', '--porcelain', '--', 'docs/superpowers/plans',
    ])
  })

  it('the_contract_is_never_asked_twice_for_one_answer', async () => {
    const asked = new ProgressDouble({ validated: true, dirty: '' })

    await asked.asked()

    expect(asked.node).toHaveLength(1)
  })
})

