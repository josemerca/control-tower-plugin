import { describe, it, expect } from 'vitest'
import { STEPS, RUN_STATES, newRun } from '../scripts/run-machine.js'
import { Dispatch, DispatchGate, DispatchVerdict, StepSeal } from '../scripts/dispatch-gate.js'

const CT_STEP_PATH = '/plugins/control-tower-loop/scripts/ct-step.mjs'

class Gate {
  static verdictOn(run) {
    return DispatchGate.verdictFor(run, CT_STEP_PATH)
  }

  static letsThrough(run) {
    return Gate.verdictOn(run).dispatch
  }
}

class RunMother {
  static PLAN = 'docs/superpowers/plans/2026-09-03-issue-35-la-puerta-del-despacho.md'
  static ISSUE = 35

  static #born(changes) {
    const run = newRun({
      plan: RunMother.PLAN,
      issue: RunMother.ISSUE,
      baseSha: '97584d2f182a1b57c160dd3902ee01d2d80aa8ea',
      tasksTotal: 3,
      e2eRuns: [],
    })
    return { ...run, ...changes }
  }

  static onTheFirstTask() {
    return RunMother.#born({})
  }

  static onStep(step) {
    return RunMother.#born({ step })
  }

  static onSecondTask() {
    return RunMother.#born({ task: 2 })
  }

  static afterOneJudgeRetry() {
    return RunMother.#born({ judgeRetries: 1 })
  }

  static afterThreeDiscards() {
    return RunMother.#born({ discards: 3 })
  }

  static havingAskedForStep(step) {
    return RunMother.#sealed(RunMother.onStep(step))
  }

  static havingAskedAndThenDiscarded(step) {
    const asked = RunMother.havingAskedForStep(step)
    return { ...asked, discards: asked.discards + 1 }
  }

  static redispatchingAfterAVetoWithTheSealOfTheAttemptBefore() {
    const beforeTheVeto = RunMother.#sealed(RunMother.onStep(STEPS.IMPLEMENT))
    return { ...beforeTheVeto, judgeRetries: beforeTheVeto.judgeRetries + 1 }
  }

  static onTheSecondTaskWithTheSealOfTheFirst() {
    const first = RunMother.#sealed(RunMother.onStep(STEPS.IMPLEMENT))
    return { ...first, task: first.task + 1 }
  }

  static deliveredWithoutEndToEndRunsSoItStayedOnSliceJudge() {
    return RunMother.#born({ step: STEPS.SLICE_JUDGE, closed: RUN_STATES.DELIVERED })
  }

  static #sealed(run) {
    return { ...run, nextSeal: StepSeal.of(run) }
  }
}

describe('StepSeal, the note next leaves saying the step was asked for', () => {
  it('the_seal_of_the_first_attempt_of_the_first_task_is_its_three_coordinates', () => {
    expect(StepSeal.of(RunMother.onTheFirstTask())).toBe('1:implement:1')
  })

  it('the_seal_changes_with_the_task_so_the_seal_of_an_earlier_task_cannot_stand_in_for_this_one', () => {
    expect(StepSeal.of(RunMother.onSecondTask())).not.toBe(StepSeal.of(RunMother.onTheFirstTask()))
  })

  it('the_seal_changes_with_the_step_so_asking_for_one_step_does_not_authorise_the_next', () => {
    expect(StepSeal.of(RunMother.onStep(STEPS.JUDGE))).not.toBe(StepSeal.of(RunMother.onStep(STEPS.IMPLEMENT)))
  })

  it('the_seal_changes_with_a_spent_judge_retry_so_a_redispatch_after_a_veto_has_to_ask_again', () => {
    expect(StepSeal.of(RunMother.afterOneJudgeRetry())).not.toBe(StepSeal.of(RunMother.onTheFirstTask()))
  })

  it('the_seal_survives_a_discard_because_ct_step_keeps_the_artefact_of_that_attempt_on_disk', () => {
    expect(StepSeal.of(RunMother.afterThreeDiscards())).toBe(StepSeal.of(RunMother.onTheFirstTask()))
  })

  it('the_sealed_steps_are_steps_the_machine_knows_so_no_seal_guards_a_step_that_cannot_happen', () => {
    for (const step of StepSeal.SEALED_STEPS) expect(Object.values(STEPS)).toContain(step)
  })

  it('a_verdict_is_frozen_so_the_hook_it_travels_to_cannot_turn_a_denial_into_a_let_through', () => {
    const denial = DispatchVerdict.denied('porque no pediste el paso')

    expect(() => { denial.dispatch = Dispatch.LET_THROUGH }).toThrow()
    expect(denial.dispatch).toBe(Dispatch.DENIED)
  })

  it('no_step_is_both_sealed_and_left_to_its_own_verb', () => {
    const sealed = StepSeal.SEALED_STEPS
    const rest = Object.values(STEPS).filter((step) => !sealed.includes(step))
    expect(rest.some((step) => sealed.includes(step))).toBe(false)
    expect(sealed.length + rest.length).toBe(Object.values(STEPS).length)
  })
})

describe('DispatchGate, on the three steps whose inputs next writes', () => {
  it('implement_without_its_seal_is_denied_naming_the_brief_the_implementer_would_not_find', () => {
    const denial = Gate.verdictOn(RunMother.onStep(STEPS.IMPLEMENT))

    expect(denial.dispatch).toBe(Dispatch.DENIED)
    expect(denial.reason).toContain('el brief de la tarea')
  })

  it('judge_without_its_seal_is_denied_naming_the_review_package_the_judge_would_not_find', () => {
    const denial = Gate.verdictOn(RunMother.onStep(STEPS.JUDGE))

    expect(denial.dispatch).toBe(Dispatch.DENIED)
    expect(denial.reason).toContain('el paquete de revisión de la tarea')
  })

  it('slice_judge_without_its_seal_is_denied_naming_the_package_of_the_whole_slice', () => {
    const denial = Gate.verdictOn(RunMother.onStep(STEPS.SLICE_JUDGE))

    expect(denial.dispatch).toBe(Dispatch.DENIED)
    expect(denial.reason).toContain('el paquete de revisión del slice')
  })

  it('the_denial_carries_a_command_that_can_be_pasted_because_ct_step_on_its_own_is_not_one', () => {
    const run = RunMother.onStep(STEPS.IMPLEMENT)

    const denial = Gate.verdictOn(run)

    expect(denial.reason).toContain(`node ${CT_STEP_PATH} next --plan ${run.plan} --issue ${run.issue}`)
  })

  it.for(StepSeal.SEALED_STEPS)('%s_asked_for_in_this_very_moment_is_let_through', (step) => {
    expect(Gate.letsThrough(RunMother.havingAskedForStep(step))).toBe(Dispatch.LET_THROUGH)
  })

  it('the_seal_of_the_attempt_before_is_denied_so_the_findings_of_the_veto_are_not_dispatched_away', () => {
    const run = RunMother.redispatchingAfterAVetoWithTheSealOfTheAttemptBefore()

    expect(Gate.letsThrough(run)).toBe(Dispatch.DENIED)
  })

  it('the_seal_of_another_task_is_denied_so_the_brief_left_by_the_task_before_does_not_pass_for_this_one', () => {
    const run = RunMother.onTheSecondTaskWithTheSealOfTheFirst()

    expect(Gate.letsThrough(run)).toBe(Dispatch.DENIED)
  })

  it.for(StepSeal.SEALED_STEPS)('a_discard_on_%s_does_not_force_asking_for_the_step_again', (step) => {
    expect(Gate.letsThrough(RunMother.havingAskedAndThenDiscarded(step))).toBe(Dispatch.LET_THROUGH)
  })
})

describe('DispatchGate, where it has nothing to say', () => {
  const STEPS_NEXT_DOES_NOT_PREPARE = Object.values(STEPS).filter((step) => !StepSeal.SEALED_STEPS.includes(step))

  it.for(STEPS_NEXT_DOES_NOT_PREPARE)('%s_is_let_through_unsealed_because_its_inputs_come_from_its_own_verb', (step) => {
    expect(Gate.letsThrough(RunMother.onStep(step))).toBe(Dispatch.LET_THROUGH)
  })

  it('a_delivered_run_that_stayed_on_a_sealed_step_is_let_through_because_next_can_no_longer_seal_it', () => {
    const run = RunMother.deliveredWithoutEndToEndRunsSoItStayedOnSliceJudge()

    expect(Gate.letsThrough(run)).toBe(Dispatch.LET_THROUGH)
  })
})
