import { describe, it, expect } from 'vitest'
import { RunFileProgress } from '../../src/infrastructure/run-file-progress.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.js'
import { ImplementationProgressNotRead } from '../../src/domain/exceptions.js'

const FENCE = '`'.repeat(3)
const PLAN = [
  '# Un plan',
  '',
  '### Task 1 — el primero',
  '### Task 2 — el lector del plan',
  '',
  FENCE,
  '### Task 3 — el de dentro de un bloque',
  FENCE,
  '',
].join('\n')

class RunFileDouble {
  static ROOT = new CheckoutRoot('/checkout')
  static ISSUE = 99
  static WORKTREE = '/checkout/.worktrees/99'
  static RUN_FILE = '/checkout/.worktrees/99/.agent/run-99.json'
  static PLAN_FILE = '/checkout/.worktrees/99/docs/superpowers/plans/2026-09-03-issue-99-el-banco.md'

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

  constructor({ exists = true, texts = [] } = {}) {
    this.exists = exists
    this.texts = [...texts]
    this.existsAsked = []
    this.readAsked = []
  }

  static answering(run, planText = null) {
    return new RunFileDouble({ texts: [JSON.stringify(run), planText] })
  }

  static missingWorktree() {
    return new RunFileDouble({ exists: false })
  }

  static withoutRunFile() {
    return new RunFileDouble({ texts: [null] })
  }

  static withText(text) {
    return new RunFileDouble({ texts: [text] })
  }

  progress() {
    return new RunFileProgress({
      exists: async (path) => {
        this.existsAsked.push(path)
        return this.exists
      },
      read: async (path) => {
        this.readAsked.push(path)
        if (this.texts.length === 0) {
          throw new Error(`read was asked for ${path} with no scripted answer left`)
        }
        return this.texts.shift()
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
    expect(asked.readAsked).toEqual([RunFileDouble.RUN_FILE, RunFileDouble.PLAN_FILE])
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

  it('the_name_of_the_task_comes_from_the_heading_of_that_number_in_the_plan', async () => {
    const asked = RunFileDouble.answering({ ...RunFileDouble.BANCO_DE_LA_PUERTA, task: 2 }, PLAN)

    const state = await asked.asked()

    expect(state.name).toBe('el lector del plan')
    expect(asked.readAsked).toEqual([RunFileDouble.RUN_FILE, RunFileDouble.PLAN_FILE])
  })

  it('a_heading_inside_a_fenced_block_is_not_a_task', async () => {
    const asked = RunFileDouble.answering({ ...RunFileDouble.BANCO_DE_LA_PUERTA, task: 3 }, PLAN)

    const state = await asked.asked()

    expect(state.name).toBe(null)
  })

  it('a_plan_that_is_not_on_disk_costs_the_name_and_not_the_state', async () => {
    const asked = RunFileDouble.answering({ ...RunFileDouble.BANCO_DE_LA_PUERTA, task: 1 })

    const state = await asked.asked()

    expect(state).toEqual(ImplementationState.of({
      step: 'implement', task: 1, totalTasks: 3, name: null, attempt: 1, discards: 0,
    }))
  })

  it('a_step_of_the_slice_does_not_go_looking_for_a_plan', async () => {
    const asked = RunFileDouble.answering(RunFileDouble.REPO_PULSE_DELIVERED)

    await asked.asked()

    expect(asked.readAsked).toHaveLength(1)
  })
})
