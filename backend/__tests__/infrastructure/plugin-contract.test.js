import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BigQueryTable } from '../../../plugin/scripts/bigquery-load.js'
import { readGoCommitment, goPath } from '../../../plugin/scripts/go-registry.js'
import { matchesGo } from '../../../plugin/scripts/go-response.js'
import { controlTowerDir } from '../../../plugin/scripts/run-metrics.js'
import { LOOP_STATUS_LABELS } from '../../../plugin/scripts/groom.js'
import { STEPS, RUN_STATES, OUTCOMES, DEFAULT_BUDGETS, newRun, after } from '../../../plugin/scripts/run-machine.js'
import { StepSeal } from '../../../plugin/scripts/dispatch-gate.js'
import { extractTasks } from '../../../plugin/scripts/plan-tasks.js'
import { DiskGoRegistry } from '../../src/infrastructure/disk-go-registry.js'
import { GhPlanIssues, PlanIssueBody } from '../../src/infrastructure/gh-plan-issues.js'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.js'
import { RunFileProgress } from '../../src/infrastructure/run-file-progress.js'
import { UserStory } from '../../src/domain/value-objects/user-story.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { Invocation, InvocationOutcome } from '../../src/infrastructure/invocation.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { ImplementationStep } from '../../src/domain/value-objects/implementation-state.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

class Both {
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')
  static FILL = 127

  constructor(configDir) {
    this.configDir = configDir
  }

  static async inATemporaryHome() {
    return new Both(await mkdtemp(join(tmpdir(), 'ct-go-contract-')))
  }

  async remove() {
    await rm(this.configDir, { recursive: true, force: true })
  }

  async mint() {
    const registry = new DiskGoRegistry({
      random: (bytes) => Buffer.alloc(bytes, Both.FILL),
      write: async (path, text) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text)
      },
      root: join(this.configDir, 'control-tower'),
    })

    return registry.mint({ issueNumber: Both.ISSUE, repository: Both.REPOSITORY })
  }

  readBack() {
    return readGoCommitment({
      repo: Both.REPOSITORY.text, issue: Both.ISSUE, configDir: this.configDir,
    })
  }
}

describe('the two halves of the go the plugin reads', () => {
  let both = null

  afterEach(async () => {
    if (both !== null) await both.remove()
    both = null
  })

  it('the_release_gate_of_the_plugin_reads_the_commitment_this_backend_wrote', async () => {
    both = await Both.inATemporaryHome()

    const nonce = await both.mint()
    const read = both.readBack()

    expect(read.missing).toBeUndefined()
    expect(read.error).toBeUndefined()
    expect(read.commitment).toBe(DiskGoRegistry.commitmentOf(nonce))
  })

  it('the_release_gate_of_the_plugin_matches_the_comment_this_backend_sends', async () => {
    both = await Both.inATemporaryHome()

    const nonce = await both.mint()
    const commented = GhPlanIssues.goBodyFor(nonce)

    expect(matchesGo(commented, both.readBack().commitment)).toBe(true)
  })
})

describe('the directory both halves write the go into', () => {
  const HOME = '/home/someone'

  it('the_state_root_this_backend_resolves_is_the_one_the_plugin_computes_for_the_same_environment', () => {
    const asked = [{}, { [Invocation.CONFIG_VARIABLE]: '/elsewhere/cfg' }]

    const ours = asked.map((environment) => Invocation.stateRootIn(environment, HOME))
    const theirs = asked.map((environment) => controlTowerDir({
      configDir: environment[Invocation.CONFIG_VARIABLE] || null, home: HOME,
    }))

    expect(ours).toEqual(theirs)
  })

  it('the_whole_path_of_the_registry_is_the_one_the_release_gate_opens', () => {
    const environment = { [Invocation.CONFIG_VARIABLE]: '/elsewhere/cfg' }

    const ours = DiskGoRegistry.pathFor({
      issueNumber: Both.ISSUE,
      repository: Both.REPOSITORY,
      root: Invocation.stateRootIn(environment, HOME),
    })

    expect(ours).toBe(goPath({
      repo: Both.REPOSITORY.text, issue: Both.ISSUE, configDir: '/elsewhere/cfg', home: HOME,
    }))
  })
})

describe('the status labels this backend writes and the plugin reads', () => {
  it('both_ends_of_the_claim_are_labels_the_loop_declares_instead_of_names_invented_here', () => {
    expect(LOOP_STATUS_LABELS).toContain(GhPlanIssues.IN_PROGRESS_LABEL)
    expect(LOOP_STATUS_LABELS).toContain(PlanIssueBody.READY_LABEL)
  })
})

describe('the harvest table this backend hands the plugin', () => {
  const HOME = '/home/someone'
  const WELL_FORMED = ['p:d.t', 'my-project:control_tower.harvest', 'proj123:ds_1.tbl_1']

  const started = (given) => Invocation.from([], { [Invocation.HARVEST_TABLE_VARIABLE]: given }, HOME)

  it('every_table_this_backend_starts_with_is_one_the_plugin_parses_back_into_the_very_same_table', () => {
    const ours = WELL_FORMED.map((given) => started(given).harvestTable)
    const theirs = ours.map((table) => BigQueryTable.parse(table))

    expect(ours).toEqual(WELL_FORMED)
    expect(theirs.map((table) => table === null ? null : table.id)).toEqual(WELL_FORMED)
  })

  it('a_table_this_backend_refuses_never_becomes_an_argument_of_the_plugin_at_all', () => {
    const refused = started('not-a-table')

    expect(refused.outcome).toBe(InvocationOutcome.MALFORMED_HARVEST_TABLE)
    expect(refused.harvestTable).toBe(null)
  })
})

describe('the sections the errand sends the agent to read', () => {
  const body = () => PlanIssueBody.of(new UserStory({
    key: new UserStoryKey('XOP-4909'), summary: 'la métrica de los campeones', description: 'como analista quiero',
  }))

  it('the_two_it_names_are_headings_the_plugin_really_renders_in_the_body_we_write', () => {
    const headings = body().split('\n').filter((line) => line.startsWith('## '))

    expect(headings).toContain(`## ${PlanAgentBrief.EPIC_CONTEXT}`)
    expect(headings).toContain(`## ${PlanAgentBrief.INHERITED_CONTEXT}`)
  })
})

class RunDouble {
  static ISSUE = 7
  static ROOT = new CheckoutRoot('/repo')
  static PLAN = 'docs/superpowers/plans/p.md'

  static worktree() {
    return RunFileProgress.worktreeFor(RunDouble.ROOT.text, RunDouble.ISSUE)
  }

  static path() {
    return RunFileProgress.runFileFor(RunDouble.ROOT.text, RunDouble.ISSUE)
  }

  static freshRun(overrides = {}) {
    return newRun({
      plan: RunDouble.PLAN, issue: RunDouble.ISSUE, baseSha: 'a'.repeat(40), tasksTotal: 3, e2eRuns: [],
      ...overrides,
    })
  }

  static async read(run, extraFiles = {}) {
    const serialized = JSON.stringify(run, null, 2) + '\n'
    const files = { [RunDouble.path()]: serialized, ...extraFiles }
    const progress = new RunFileProgress({
      exists: async (candidate) => candidate === RunDouble.worktree(),
      read: async (candidate) => (candidate in files ? files[candidate] : null),
    })

    return progress.of({ root: RunDouble.ROOT, issue: RunDouble.ISSUE })
  }
}

describe('the run machine and the run file this backend reads back', () => {
  it('every_step_the_machine_can_reach_is_a_step_our_vocabulary_declares', () => {
    expect(Object.values(STEPS).every((step) => Object.values(ImplementationStep).includes(step))).toBe(true)
    expect(Object.values(ImplementationStep).length).toBe(Object.values(STEPS).length + 2)
  })

  it('a_run_the_machine_just_created_is_read_as_the_first_task_about_to_be_implemented', async () => {
    const state = await RunDouble.read(RunDouble.freshRun())

    expect(state.step).toBe('implement')
    expect(state.task).toBe(1)
    expect(state.totalTasks).toBe(3)
    expect(state.attempt).toBe(1)
  })

  it('our_attempt_is_the_one_the_dispatch_gate_counts', () => {
    let run = after(RunDouble.freshRun(), OUTCOMES.DONE, DEFAULT_BUDGETS).run
    while (run.controlRetries + run.judgeRetries + run.correctionRetries === 0) {
      run = after(run, OUTCOMES.FAILED, DEFAULT_BUDGETS).run
    }

    expect(RunFileProgress.attemptOf(run)).toBe(StepSeal.attemptOf(run))
  })

  it('the_delivered_run_the_machine_closes_is_the_delivered_run_we_answer', async () => {
    const run = { ...RunDouble.freshRun(), closed: RUN_STATES.DELIVERED }

    const state = await RunDouble.read(run)

    expect(state.step).toBe('delivered')
  })

  it('the_task_names_we_read_are_the_ones_the_plugin_extracts', async () => {
    const planPath = join(
      dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
      'plugin', '__tests__', 'fixtures', 'plan-real-issue-5.md'
    )
    const planText = await readFile(planPath, 'utf8')
    const relativePlan = 'plugin/__tests__/fixtures/plan-real-issue-5.md'
    const extracted = extractTasks(planText)

    expect(extracted.tasks.length).toBeGreaterThan(0)

    for (const task of extracted.tasks) {
      const run = { ...RunDouble.freshRun({ plan: relativePlan, tasksTotal: extracted.tasks.length }), task: task.n }

      const state = await RunDouble.read(run, {
        [`${RunDouble.worktree()}/${relativePlan}`]: planText,
      })

      expect(state.name).toBe(task.name)
    }
  })
})
