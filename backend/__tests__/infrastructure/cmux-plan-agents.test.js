import { describe, it, expect } from 'vitest'
import {
  buildLauncherScript, buildTypedCommand, LAUNCHER_FILENAME, SENTINEL_FILENAME,
} from '../../../plugin/scripts/launch-sentinel.js'
import { shQuote } from '../../../plugin/scripts/shquote.js'
import { CmuxPlanAgents } from '../../src/infrastructure/cmux-plan-agents.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { LaunchPolicy, LaunchBudget, LaunchStep } from '../../src/domain/policies/launch-policy.js'
import { PlanBriefing } from '../../src/domain/value-objects/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import {
  PlanAgentNotLaunched, PlanAgentNotNamed, PlanAgentNotResumed, PlanAgentFailure,
} from '../../src/domain/exceptions.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'

class BriefDouble {
  constructor() {
    this.asked = []
  }

  errandFor({ issue, repository }) {
    this.asked.push({ issue, repository })

    return `escribe el plan de #${issue.number} en ${repository.text}`
  }
}

class CmuxDouble {
  static RUNS_IN = '/tmp/ct-plan'
  static WORKTREE = '/repo/.worktrees/42'
  static WORKTREE_THROUGH_A_SYMLINK = '/private/repo/.worktrees/42'
  static ISSUE = new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static ERRAND = 'escribe el plan de #42 en josemerca/ct-loop-sandbox'
  static TAB = 'ct-plan-ABC-42'
  static PROBES_PER_SEND = 2
  static RESENDS = 1
  static LAUNCHER = `${CmuxDouble.RUNS_IN}/42/${LAUNCHER_FILENAME}`
  static SENTINEL = `${CmuxDouble.RUNS_IN}/42/${SENTINEL_FILENAME}`
  static TYPED = buildTypedCommand(CmuxDouble.LAUNCHER, shQuote)

  constructor({ printed, sentinels, realpaths = new Map(), step = null }) {
    this.printed = printed
    this.sentinels = [...sentinels]
    this.realpaths = realpaths
    this.step = step
    this.brief = new BriefDouble()
    this.calls = []
    this.written = []
    this.removed = []
    this.doings = []
    this.slept = 0
  }

  static named() {
    return new ProcessOutput({ code: 0, stdout: 'OK workspace:4\n', stderr: '' })
  }

  static ran(cwd = CmuxDouble.WORKTREE) {
    return `ct-next-launch\t1\tok\t${cwd}\n`
  }

  static missingBinary() {
    return `ct-next-launch\t1\tmissing\t${CmuxDouble.WORKTREE}\n`
  }

  static #budgetedProbes() {
    return CmuxDouble.PROBES_PER_SEND * (CmuxDouble.RESENDS + 1)
  }

  static launched() {
    return new CmuxDouble({ printed: CmuxDouble.named(), sentinels: [CmuxDouble.ran()] })
  }

  onlyEverAnswering(step) {
    this.step = step

    return this
  }

  static silent() {
    return new CmuxDouble({
      printed: CmuxDouble.named(),
      sentinels: Array(CmuxDouble.#budgetedProbes()).fill(null),
    })
  }

  static answeringLate() {
    return new CmuxDouble({ printed: CmuxDouble.named(), sentinels: [null, null, CmuxDouble.ran()] })
  }

  static withoutItsBinary() {
    return new CmuxDouble({ printed: CmuxDouble.named(), sentinels: [CmuxDouble.missingBinary()] })
  }

  static somewhereElse() {
    return new CmuxDouble({
      printed: CmuxDouble.named(),
      sentinels: [CmuxDouble.ran('/somewhere/else')],
    })
  }

  static reachedThroughASymlink() {
    return new CmuxDouble({
      printed: CmuxDouble.named(),
      sentinels: [CmuxDouble.ran(CmuxDouble.WORKTREE_THROUGH_A_SYMLINK)],
      realpaths: new Map([
        [CmuxDouble.WORKTREE, CmuxDouble.WORKTREE_THROUGH_A_SYMLINK],
        [CmuxDouble.WORKTREE_THROUGH_A_SYMLINK, CmuxDouble.WORKTREE_THROUGH_A_SYMLINK],
      ]),
    })
  }

  static refusing(said) {
    return new CmuxDouble({
      printed: new ProcessOutput({ code: 1, stdout: '', stderr: said }),
      sentinels: [],
    })
  }

  static printing(said) {
    return new CmuxDouble({
      printed: new ProcessOutput({ code: 0, stdout: said, stderr: '' }),
      sentinels: [CmuxDouble.ran()],
    })
  }

  static briefing() {
    return new PlanBriefing({
      story: new UserStoryKey('ABC-42'),
      issue: CmuxDouble.ISSUE,
      located: new WorkspaceLocation({ path: CmuxDouble.WORKTREE, branch: 'feat/42' }),
      repository: CmuxDouble.REPOSITORY,
    })
  }

  agents() {
    return new CmuxPlanAgents({
      runsIn: CmuxDouble.RUNS_IN,
      realpathOf: (path) => this.realpaths.get(path) ?? null,
      brief: this.brief,
      policy: this.step === null
        ? new LaunchPolicy({
          budget: new LaunchBudget({
            attempts: CmuxDouble.PROBES_PER_SEND,
            resends: CmuxDouble.RESENDS,
          }),
        })
        : { afterProbing: () => this.step },
      remove: (path) => {
        this.removed.push(path)
        this.doings.push(['remove', path])
        return Promise.resolve()
      },
      write: (path, text) => {
        this.written.push([path, text])
        this.doings.push(['write', path])
        return Promise.resolve()
      },
      read: () => {
        if (this.sentinels.length === 0) {
          throw new Error('the sentinel was read more times than this test scripted an answer for')
        }
        return Promise.resolve(this.sentinels.shift())
      },
      sleep: () => {
        this.slept += 1
        return Promise.resolve()
      },
      run: (argv) => {
        this.calls.push(argv)
        if (argv[0] === 'new-workspace') return Promise.resolve(this.printed)
        if (argv[0] === 'send' || argv[0] === 'send-key') return Promise.resolve(CmuxDouble.named())
        throw new Error(`nobody wrote an answer for cmux ${argv[0]}`)
      },
    })
  }

  launch() {
    return this.agents().launch(CmuxDouble.briefing())
  }

  refusal() {
    return this.launch().catch((cause) => cause)
  }
}

describe('CmuxPlanAgents', () => {
  it('a_sentinel_a_previous_attempt_left_on_disk_is_removed_before_the_new_launcher_is_written', async () => {
    const cmux = CmuxDouble.launched()

    await cmux.launch()

    expect(cmux.removed).toEqual([CmuxDouble.SENTINEL])
    expect(cmux.doings).toEqual([['remove', CmuxDouble.SENTINEL], ['write', CmuxDouble.LAUNCHER]])
  })

  it('the_window_it_opens_is_cut_in_the_worktree_and_not_where_the_api_happens_to_run', async () => {
    const cmux = CmuxDouble.launched()

    await cmux.launch()

    expect(cmux.calls).toEqual([[
      'new-workspace',
      '--name', CmuxDouble.TAB,
      '--cwd', CmuxDouble.WORKTREE,
      '--command', CmuxDouble.TYPED,
    ]])
  })

  it('the_launcher_it_writes_is_the_one_the_plugin_renders_so_the_two_halves_cannot_drift_apart', async () => {
    const cmux = CmuxDouble.launched()

    await cmux.launch()

    expect(cmux.written).toEqual([[CmuxDouble.LAUNCHER, buildLauncherScript({
      sentinelPath: CmuxDouble.SENTINEL,
      agentCommand: `${CmuxPlanAgents.AGENT} ${shQuote(CmuxDouble.ERRAND)}`,
      agentBin: CmuxPlanAgents.AGENT,
      issue: 42,
      worktree: CmuxDouble.WORKTREE,
    }, shQuote)]])
  })

  it('the_errand_travels_by_disk_and_never_as_keystrokes', async () => {
    const cmux = CmuxDouble.launched()

    await cmux.launch()

    expect(cmux.written[0][1]).toContain(CmuxDouble.ERRAND)
    expect(JSON.stringify(cmux.calls)).not.toContain(CmuxDouble.ERRAND)
  })

  it('the_errand_it_writes_is_the_one_the_brief_composed_for_that_issue_and_that_repository', async () => {
    const cmux = CmuxDouble.launched()

    await cmux.launch()

    expect(cmux.brief.asked).toEqual([
      { issue: CmuxDouble.ISSUE, repository: CmuxDouble.REPOSITORY },
    ])
    expect(cmux.written[0][1]).toContain(`claude ${shQuote(CmuxDouble.ERRAND)}`)
  })

  it('the_handle_cmux_prints_is_what_comes_back_so_the_caller_can_reach_the_agent_later', async () => {
    expect(await CmuxDouble.launched().launch()).toBe('workspace:4')
  })

  it('the_notice_cmux_prints_before_the_handle_does_not_get_mistaken_for_one', async () => {
    const cmux = CmuxDouble.printing("cmux: 'new-workspace' is now an alias\nOK workspace:12\n")

    expect(await cmux.launch()).toBe('workspace:12')
  })

  it('a_cmux_that_refuses_the_call_arrives_typed_so_the_caller_can_tell_it_from_a_crash', async () => {
    const refusal = await CmuxDouble.refusing('no daemon').refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain('no daemon')
  })

  it('cmux_answering_something_unreadable_is_told_apart_from_cmux_refusing_the_call', async () => {
    const unreadable = await CmuxDouble.printing('starting...\n').refusal()
    const refused = await CmuxDouble.refusing('no daemon').refusal()

    expect(unreadable).toBeInstanceOf(PlanAgentNotNamed)
    expect(refused).toBeInstanceOf(PlanAgentNotLaunched)
    expect(unreadable).not.toBeInstanceOf(PlanAgentNotLaunched)
    expect(refused).not.toBeInstanceOf(PlanAgentNotNamed)
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await CmuxDouble.printing('starting...\n').refusal()
    const refused = await CmuxDouble.refusing('no daemon').refusal()

    expect(unreadable).toBeInstanceOf(PlanAgentFailure)
    expect(refused).toBeInstanceOf(PlanAgentFailure)
  })

  it('when_the_sentinel_does_not_show_up_the_line_is_resent_because_the_pty_can_eat_it', async () => {
    const cmux = CmuxDouble.answeringLate()

    await cmux.launch()

    expect(cmux.calls).toContainEqual(['send', '--workspace', CmuxDouble.TAB, CmuxDouble.TYPED])
    expect(cmux.calls).toContainEqual(['send-key', '--workspace', CmuxDouble.TAB, 'Enter'])
  })

  it('a_line_that_lands_after_the_resend_is_still_a_launch_and_not_a_refusal', async () => {
    expect(await CmuxDouble.answeringLate().launch()).toBe('workspace:4')
  })

  it('the_budget_the_policy_carries_is_the_one_that_is_spent_and_not_one_the_adapter_picked', async () => {
    const cmux = CmuxDouble.silent()

    await cmux.refusal()

    expect(cmux.slept).toBe(CmuxDouble.PROBES_PER_SEND * (CmuxDouble.RESENDS + 1))
    expect(cmux.sentinels).toEqual([])
  })

  it('a_sentinel_that_never_shows_up_is_reported_instead_of_being_called_a_launch', async () => {
    const refusal = await CmuxDouble.silent().refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain(CmuxDouble.SENTINEL)
  })

  it('a_sentinel_that_says_the_binary_was_missing_names_the_binary_and_not_the_window', async () => {
    const refusal = await CmuxDouble.withoutItsBinary().refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain(CmuxPlanAgents.AGENT)
  })

  it('a_shell_that_landed_somewhere_else_is_reported_because_the_window_title_would_not_show_it', async () => {
    const refusal = await CmuxDouble.somewhereElse().refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toContain('/somewhere/else')
  })

  it('a_shell_that_reached_the_very_same_directory_through_a_symlink_is_not_reported_as_the_wrong_one', async () => {
    const cmux = CmuxDouble.reachedThroughASymlink()

    await expect(cmux.launch()).resolves.toBe('workspace:4')
  })

  it('every_launch_step_the_policy_can_answer_has_a_move_so_a_fourth_one_cannot_pass_for_keep_probing', async () => {
    for (const step of LaunchStep.declared()) {
      const refusal = await CmuxDouble.silent().onlyEverAnswering(step).refusal()

      expect(refusal.message).not.toContain(CmuxPlanAgents.NO_MOVE)
    }
  })

  it('a_launch_step_nobody_declared_a_move_for_raises_instead_of_being_taken_for_keep_probing', async () => {
    const refusal = await CmuxDouble.silent().onlyEverAnswering('invented').refusal()

    expect(refusal.message).toContain(CmuxPlanAgents.NO_MOVE)
  })

  it('a_second_sourcing_starts_nothing_because_the_line_gets_resent_when_the_pty_eats_it', () => {
    const script = CmuxPlanAgents.scriptFor({
      sentinelPath: CmuxDouble.SENTINEL,
      errand: CmuxDouble.ERRAND,
      bin: CmuxPlanAgents.AGENT,
      issue: 42,
      worktree: CmuxDouble.WORKTREE,
    })

    expect(script).toContain(`if [ -e ${shQuote(CmuxDouble.SENTINEL)} ]; then`)
  })
})

describe('LaunchPolicy', () => {
  const policy = () => new LaunchPolicy({ budget: new LaunchBudget({ attempts: 2, resends: 1 }) })

  it('a_count_of_probes_it_does_not_describe_raises_instead_of_falling_into_a_default_move', () => {
    expect(() => policy().afterProbing(0)).toThrow(/probed from one up to 4/)
    expect(() => policy().afterProbing(5)).toThrow(/probed from one up to 4/)
    expect(() => policy().afterProbing(1.5)).toThrow(/probed from one up to 4/)
  })

  it('a_budget_that_would_never_probe_or_would_resend_a_negative_count_cannot_be_built', () => {
    expect(() => new LaunchBudget({ attempts: 0, resends: 1 })).toThrow(/count of at least one/)
    expect(() => new LaunchBudget({ attempts: 2, resends: -1 })).toThrow(/resends of a launch/)
  })

  it('a_budget_with_no_resends_gives_up_where_the_first_send_runs_out', () => {
    const strict = new LaunchPolicy({ budget: new LaunchBudget({ attempts: 2, resends: 0 }) })

    expect(strict.afterProbing(1)).toBe(LaunchStep.KEEP_PROBING)
    expect(strict.afterProbing(2)).toBe(LaunchStep.GIVE_UP)
  })
})

class ResumeDouble {
  static STORY = new UserStoryKey('ABC-42')
  static ISSUE = 42
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static TAB = 'ct-plan-ABC-42'
  static ERRAND = 'implementa el plan de #42'

  constructor(answers) {
    this.answers = answers
    this.calls = []
    this.brief = {
      asked: [],
      implementationErrandFor: ({ issueNumber, repository }) => {
        this.brief.asked.push({ issueNumber, repository })

        return ResumeDouble.ERRAND
      },
    }
  }

  static accepting() {
    return new ResumeDouble([
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
    ])
  }

  static refusing(said) {
    return new ResumeDouble([new ProcessOutput({ code: 1, stdout: '', stderr: said })])
  }

  static refusingTheEnter(said) {
    return new ResumeDouble([
      new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
      new ProcessOutput({ code: 1, stdout: '', stderr: said }),
    ])
  }

  agents() {
    return new CmuxPlanAgents({
      brief: this.brief,
      run: (argv) => {
        this.calls.push(argv)
        const answer = this.answers[this.calls.length - 1]
        if (answer === undefined) {
          throw new Error(`nobody wrote an answer for call ${this.calls.length}: ${argv.join(' ')}`)
        }

        return Promise.resolve(answer)
      },
    })
  }

  async resume() {
    return this.agents().resume({
      story: ResumeDouble.STORY, issue: ResumeDouble.ISSUE, repository: ResumeDouble.REPOSITORY,
    })
  }

  async refusal() {
    return this.resume().catch((cause) => cause)
  }
}

describe('CmuxPlanAgents resuming a parked agent', () => {
  it('it_types_the_errand_in_the_tab_it_named_when_it_launched_it_and_then_presses_enter', async () => {
    const cmux = ResumeDouble.accepting()

    await cmux.resume()

    expect(cmux.calls).toEqual([
      ['send', '--workspace', ResumeDouble.TAB, ResumeDouble.ERRAND],
      ['send-key', '--workspace', ResumeDouble.TAB, 'Enter'],
    ])
  })

  it('the_errand_it_types_is_the_one_the_brief_composed_for_that_issue_and_repository', async () => {
    const cmux = ResumeDouble.accepting()

    await cmux.resume()

    expect(cmux.brief.asked).toEqual([
      { issueNumber: ResumeDouble.ISSUE, repository: ResumeDouble.REPOSITORY },
    ])
  })

  it('a_cmux_that_refuses_to_write_arrives_typed_so_the_boundary_can_tell_it_from_a_crash', async () => {
    const refusal = await ResumeDouble.refusing('Access denied - only processes started inside cmux').refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal).toBeInstanceOf(PlanAgentFailure)
    expect(refusal.message).toContain('Access denied')
  })

  it('an_enter_that_never_lands_is_reported_because_the_line_is_sitting_there_unrun', async () => {
    const refusal = await ResumeDouble.refusingTheEnter('no such workspace').refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotResumed)
    expect(refusal.message).toContain('no such workspace')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().resume({
      story: ResumeDouble.STORY, issue: ResumeDouble.ISSUE, repository: ResumeDouble.REPOSITORY,
    })).rejects.toThrow(/must implement resume/)
  })
})
