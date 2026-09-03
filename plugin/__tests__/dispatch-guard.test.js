import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { STEPS, newRun } from '../scripts/run-machine.js'
import { StepSeal } from '../scripts/dispatch-gate.js'
import { DispatchGuard } from '../hooks/dispatch-guard.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = join(PLUGIN_ROOT, 'hooks', 'dispatch-guard.js')
const CT_STEP_PATH = '/plugins/control-tower-loop/scripts/ct-step.mjs'

class PayloadMother {
  static aTaskDispatchIn(cwd) {
    return { hook_event_name: 'PreToolUse', tool_name: 'Task', cwd, tool_input: { subagent_type: 'general-purpose', prompt: 'implementa la tarea' } }
  }

  static aBashCommandIn(cwd) {
    return { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command: 'git status' } }
  }
}

class RunFileMother {
  static ISSUE = 7

  static waitingForItsStep() {
    return RunFileMother.#born({ step: STEPS.JUDGE })
  }

  static havingAskedForItsStep() {
    const run = RunFileMother.#born({ step: STEPS.JUDGE })
    return { ...run, nextSeal: StepSeal.of(run) }
  }

  static #born(changes) {
    const run = newRun({
      plan: 'docs/superpowers/plans/plan.md',
      issue: RunFileMother.ISSUE,
      baseSha: '97584d2f182a1b57c160dd3902ee01d2d80aa8ea',
      tasksTotal: 2,
      e2eRuns: [],
    })
    return { ...run, ...changes }
  }
}

class WorktreeMother {
  static #made = []

  static withoutAnyRun() {
    return WorktreeMother.#agentDir().root
  }

  static withARun(run) {
    const { root, agent } = WorktreeMother.#agentDir()
    writeFileSync(join(agent, `run-${run.issue}.json`), JSON.stringify(run, null, 2))
    return root
  }

  static withTwoRuns() {
    const { root, agent } = WorktreeMother.#agentDir()
    writeFileSync(join(agent, 'run-7.json'), JSON.stringify(RunFileMother.waitingForItsStep()))
    writeFileSync(join(agent, 'run-9.json'), JSON.stringify(RunFileMother.waitingForItsStep()))
    return root
  }

  static withARunThatDoesNotParse() {
    const { root, agent } = WorktreeMother.#agentDir()
    writeFileSync(join(agent, 'run-7.json'), '{ esto no es json')
    return root
  }

  static forget() {
    for (const root of WorktreeMother.#made) rmSyncBestEffort(root)
    WorktreeMother.#made = []
  }

  static #agentDir() {
    const root = mkdtempSync(join(tmpdir(), 'dispatch-guard-'))
    WorktreeMother.#made.push(root)
    const agent = join(root, '.agent')
    mkdirSync(agent, { recursive: true })
    return { root, agent }
  }
}

class HookRun {
  static on(payload) {
    return HookRun.#of(HOOK, payload)
  }

  static onTheBundleThatShips(payload) {
    return HookRun.#of(join(PLUGIN_ROOT, 'dist', 'dispatch-guard.js'), payload)
  }

  static #of(bin, payload) {
    const finished = spawnSync('node', [bin], { input: JSON.stringify(payload), encoding: 'utf8' })
    const printed = (finished.stdout || '').trim()
    return { status: finished.status, printed, decision: printed ? JSON.parse(printed) : null }
  }
}

afterAll(() => WorktreeMother.forget())

describe('DispatchGuard, deciding without touching disk', () => {
  it('a_bash_command_is_not_this_gates_business_and_does_not_even_look_for_a_run', () => {
    let lookups = 0
    const readRun = () => { lookups++; return RunFileMother.waitingForItsStep() }

    const decision = DispatchGuard.decide(PayloadMother.aBashCommandIn('/x'), readRun, CT_STEP_PATH)

    expect(decision).toBeNull()
    expect(lookups).toBe(0)
  })

  it('a_task_where_no_single_run_can_be_read_is_left_alone', () => {
    const decision = DispatchGuard.decide(PayloadMother.aTaskDispatchIn('/x'), () => null, CT_STEP_PATH)

    expect(decision).toBeNull()
  })

  it('a_task_on_a_step_already_asked_for_is_left_alone', () => {
    const readRun = () => RunFileMother.havingAskedForItsStep()

    const decision = DispatchGuard.decide(PayloadMother.aTaskDispatchIn('/x'), readRun, CT_STEP_PATH)

    expect(decision).toBeNull()
  })

  it('a_task_on_a_step_that_was_never_asked_for_is_denied_in_the_shape_a_pre_tool_use_hook_answers_in', () => {
    const readRun = () => RunFileMother.waitingForItsStep()

    const decision = DispatchGuard.decide(PayloadMother.aTaskDispatchIn('/x'), readRun, CT_STEP_PATH)

    expect(decision.hookSpecificOutput.hookEventName).toBe('PreToolUse')
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain(`node ${CT_STEP_PATH} next`)
  })
})

describe('DispatchGuard, run as the process the harness launches', () => {
  it('a_worktree_with_a_run_waiting_for_its_step_denies_the_dispatch_and_says_what_prepares_it', () => {
    const cwd = WorktreeMother.withARun(RunFileMother.waitingForItsStep())

    const { status, decision } = HookRun.on(PayloadMother.aTaskDispatchIn(cwd))

    expect(status).toBe(0)
    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain('el paquete de revisión de la tarea')
  })

  it('the_command_it_prints_is_the_ct_step_of_the_plugin_it_runs_from', () => {
    const cwd = WorktreeMother.withARun(RunFileMother.waitingForItsStep())

    const { decision } = HookRun.on(PayloadMother.aTaskDispatchIn(cwd))

    expect(decision.hookSpecificOutput.permissionDecisionReason)
      .toContain(`node ${join(PLUGIN_ROOT, 'scripts', 'ct-step.mjs')} next --plan docs/superpowers/plans/plan.md --issue 7`)
  })

  it('a_worktree_whose_run_already_asked_for_its_step_prints_nothing', () => {
    const cwd = WorktreeMother.withARun(RunFileMother.havingAskedForItsStep())

    const { status, printed } = HookRun.on(PayloadMother.aTaskDispatchIn(cwd))

    expect(status).toBe(0)
    expect(printed).toBe('')
  })

  it('a_place_with_no_run_at_all_prints_nothing_so_the_gate_is_silent_outside_a_slice', () => {
    const cwd = WorktreeMother.withoutAnyRun()

    const { status, printed } = HookRun.on(PayloadMother.aTaskDispatchIn(cwd))

    expect(status).toBe(0)
    expect(printed).toBe('')
  })

  it('two_runs_in_one_worktree_print_nothing_because_which_one_leads_cannot_be_invented', () => {
    const cwd = WorktreeMother.withTwoRuns()

    const { printed } = HookRun.on(PayloadMother.aTaskDispatchIn(cwd))

    expect(printed).toBe('')
  })

  it('a_run_that_does_not_parse_prints_nothing_instead_of_hanging_the_loop_on_a_question_nobody_reads', () => {
    const cwd = WorktreeMother.withARunThatDoesNotParse()

    const { status, printed } = HookRun.on(PayloadMother.aTaskDispatchIn(cwd))

    expect(status).toBe(0)
    expect(printed).toBe('')
  })

  it('the_bundle_that_ships_denies_the_same_and_points_at_the_ct_step_beside_it_and_not_beside_the_sources', () => {
    const cwd = WorktreeMother.withARun(RunFileMother.waitingForItsStep())

    const { decision } = HookRun.onTheBundleThatShips(PayloadMother.aTaskDispatchIn(cwd))

    expect(decision.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(decision.hookSpecificOutput.permissionDecisionReason)
      .toContain(`node ${join(PLUGIN_ROOT, 'scripts', 'ct-step.mjs')} next`)
  })

  it('a_stdin_that_is_not_json_prints_nothing_because_no_dispatch_can_be_told_apart_in_it', () => {
    const finished = spawnSync('node', [HOOK], { input: 'no soy json', encoding: 'utf8' })

    expect(finished.status).toBe(0)
    expect((finished.stdout || '').trim()).toBe('')
  })
})
