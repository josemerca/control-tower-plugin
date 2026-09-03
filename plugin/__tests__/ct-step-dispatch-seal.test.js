import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { crearHelpers, montarRepo } from './fixtures/ct-step-harness.js'
import { Dispatch, DispatchGate } from '../scripts/dispatch-gate.js'

let repo
const { ct, informe, veredicto, crudo, commits, estado, juzgar } = crearHelpers(() => repo)

const CT_STEP_PATH = '/plugins/control-tower-loop/scripts/ct-step.mjs'
const aVeto = () => veredicto('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }])
const dispatchNow = () => DispatchGate.verdictFor(estado(), CT_STEP_PATH).dispatch

beforeEach(() => { repo = montarRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('what next writes down when it prepares a step', () => {
  it('next_on_implement_seals_the_task_the_step_and_the_attempt_it_wrote_the_brief_for', () => {
    ct('next')

    expect(estado().nextSeal).toBe('1:implement:1')
  })

  it('next_on_judge_seals_its_own_step_so_the_seal_of_implement_does_not_authorise_the_judge', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')

    ct('next')

    expect(estado().nextSeal).toBe('1:judge:1')
  })

  it('next_on_controls_seals_nothing_because_no_subagent_is_dispatched_on_that_step', () => {
    ct('next')
    ct('report', informe(['uno.txt']))

    ct('next')

    expect(estado().nextSeal).toBe('1:implement:1')
  })

  it('next_on_the_second_task_seals_that_task_so_the_brief_of_the_first_does_not_pass_for_it', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(veredicto('PASS'))
    ct('commit')

    ct('next')

    expect(estado().nextSeal).toBe('2:implement:1')
  })
})

describe('what the gate decides on the state ct-step actually wrote', () => {
  it('a_run_on_judge_that_never_asked_for_that_step_is_denied_its_dispatch', () => {
    ct('next')
    ct('report', informe(['uno.txt']))
    ct('controls')

    expect(estado().step).toBe('judge')
    expect(dispatchNow()).toBe(Dispatch.DENIED)
  })

  it('a_run_that_just_asked_for_its_step_is_let_through', () => {
    ct('next')

    expect(dispatchNow()).toBe(Dispatch.LET_THROUGH)
  })

  it('a_discarded_report_is_let_through_again_because_the_brief_it_was_given_is_still_on_disk', () => {
    ct('next')

    ct('report', crudo('esto no es json'))

    expect(estado().discards).toBe(1)
    expect(dispatchNow()).toBe(Dispatch.LET_THROUGH)
  })

  it('a_vetoed_task_is_denied_until_it_asks_again_so_the_findings_of_the_veto_reach_the_implementer', () => {
    ct('next')
    ct('report', informe(['uno.txt']))
    ct('controls')

    juzgar(aVeto())

    expect(estado().judgeRetries).toBe(1)
    expect(commits()).toBe(1)
    expect(dispatchNow()).toBe(Dispatch.DENIED)
  })

  it('asking_again_after_a_veto_carries_the_findings_and_lifts_the_denial_in_one_move', () => {
    ct('report', informe(['uno.txt']))
    ct('controls')
    juzgar(aVeto())

    const asked = ct('next')

    expect(asked.stdout).toContain('El juez devolvió esta tarea')
    expect(dispatchNow()).toBe(Dispatch.LET_THROUGH)
  })
})
