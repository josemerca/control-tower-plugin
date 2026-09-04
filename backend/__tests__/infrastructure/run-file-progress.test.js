import { describe, it, expect } from 'vitest'
import { RunFileProgress } from '../../src/infrastructure/run-file-progress.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.js'
import { ImplementationProgressNotRead } from '../../src/domain/exceptions.js'

class RunFileDouble {
  static ROOT = new CheckoutRoot('/checkout')
  static ISSUE = 99
  static WORKTREE = '/checkout/.worktrees/99'
  static RUN_FILE = '/checkout/.worktrees/99/.agent/run-99.json'

  static BANCO_DE_LA_PUERTA = {
    plan: 'docs/superpowers/plans/2026-09-03-issue-99-el-banco.md',
    issue: 99,
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    task: 1,
    tasksTotal: 3,
    e2eRuns: [],
    step: 'implement',
    controlRetries: 0,
    judgeRetries: 0,
    correctionRetries: 0,
    reconcileRetries: 0,
    discards: 0,
    spendUsd: 0,
  }

  static REPO_PULSE_DELIVERED = {
    plan: 'docs/superpowers/plans/2026-09-01-issue-7-repo-pulse.md',
    issue: 7,
    baseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    task: 7,
    tasksTotal: 7,
    e2eRuns: [],
    step: 'slice-judge',
    controlRetries: 0,
    judgeRetries: 0,
    correctionRetries: 0,
    reconcileRetries: 0,
    sliceCommits: 1,
    discards: 0,
    spendUsd: 0,
    closed: 'delivered',
    lastVerdict: { ruling: 'PASS' },
  }

  constructor({ exists = true, text = null } = {}) {
    this.exists = exists
    this.text = text
    this.existsAsked = []
    this.readAsked = []
  }

  static answering(run) {
    return new RunFileDouble({ text: JSON.stringify(run) })
  }

  static missingWorktree() {
    return new RunFileDouble({ exists: false })
  }

  static withoutRunFile() {
    return new RunFileDouble({ text: null })
  }

  static withText(text) {
    return new RunFileDouble({ text })
  }

  progress() {
    return new RunFileProgress({
      exists: async (path) => {
        this.existsAsked.push(path)
        return this.exists
      },
      read: async (path) => {
        this.readAsked.push(path)
        return this.text
      },
    })
  }

  asked() {
    return this.progress().of({ root: RunFileDouble.ROOT, issue: RunFileDouble.ISSUE })
  }

  refusal() {
    return this.asked().catch((cause) => cause)
  }
}

describe('RunFileProgress', () => {
  it('the_state_of_a_task_comes_from_the_run_file_of_that_worktree', async () => {
    const asked = RunFileDouble.answering(RunFileDouble.BANCO_DE_LA_PUERTA)

    const state = await asked.asked()

    expect(state).toEqual(ImplementationState.of({
      step: 'implement', task: 1, totalTasks: 3, name: null, attempt: 1, discards: 0,
    }))
    expect(asked.readAsked).toEqual([RunFileDouble.RUN_FILE])
  })

  it('a_run_the_step_program_has_not_created_yet_is_a_slice_that_is_starting', async () => {
    const asked = RunFileDouble.withoutRunFile()

    expect(await asked.asked()).toEqual(ImplementationState.starting())
  })

  it('a_worktree_that_is_not_there_is_not_a_run_that_has_not_started', async () => {
    const asked = RunFileDouble.missingWorktree()

    const refusal = await asked.refusal()

    expect(refusal).toBeInstanceOf(ImplementationProgressNotRead)
    expect(refusal.message).toContain(RunFileDouble.WORKTREE)
    expect(asked.readAsked).toHaveLength(0)
  })

  it('a_run_that_closed_delivered_says_so_and_forgets_the_task_it_stopped_on', async () => {
    const asked = RunFileDouble.answering(RunFileDouble.REPO_PULSE_DELIVERED)

    const state = await asked.asked()

    expect(state).toEqual(ImplementationState.of({
      step: ImplementationStep.DELIVERED, task: null, totalTasks: 7, name: null, attempt: null, discards: 0,
    }))
  })

  it('a_step_of_the_slice_answers_the_total_but_no_task_and_no_attempt', async () => {
    const asked = RunFileDouble.answering({
      ...RunFileDouble.BANCO_DE_LA_PUERTA, step: 'global', task: 7, tasksTotal: 7, discards: 1,
    })

    const state = await asked.asked()

    expect(state).toEqual(ImplementationState.of({
      step: 'global', task: null, totalTasks: 7, name: null, attempt: null, discards: 1,
    }))
  })

  it('the_attempt_counts_the_three_retries_that_reset_with_every_task', async () => {
    const asked = RunFileDouble.answering({
      ...RunFileDouble.BANCO_DE_LA_PUERTA,
      step: 'judge', controlRetries: 1, judgeRetries: 2, correctionRetries: 0,
    })

    const state = await asked.asked()

    expect(state.attempt).toBe(4)
  })

  it('half_a_json_is_a_file_that_could_not_be_read_and_not_a_run_without_tasks', async () => {
    const asked = RunFileDouble.withText('{"task": 3, "tasksTot')

    const refusal = await asked.refusal()

    expect(refusal).toBeInstanceOf(ImplementationProgressNotRead)
    expect(refusal.message).toContain(RunFileDouble.RUN_FILE)
  })
})
