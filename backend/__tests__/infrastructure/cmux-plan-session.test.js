import { describe, it, expect } from 'vitest'
import { CmuxPlanSession } from '../../src/infrastructure/cmux-plan-session.js'
import { CmuxLauncher } from '../../src/infrastructure/cmux-launcher.js'
import { PlanBriefing } from '../../src/domain/plan-briefing.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { PlanSessionNotStarted, PlanSessionNotNamed, PlanSessionDidNotRun } from '../../src/domain/exceptions.js'

class CmuxDouble {
  static RUNS_IN = '/tmp/ct-plan'
  static WORKTREE = '/repo/.worktrees/42'

  constructor({ printed, sentinel }) {
    this.printed = printed
    this.sentinel = sentinel
    this.calls = []
    this.written = []
    this.slept = 0
  }

  session() {
    return new CmuxPlanSession({
      runsIn: CmuxDouble.RUNS_IN,
      write: (path, text) => {
        this.written.push([path, text])
        return Promise.resolve()
      },
      read: () => Promise.resolve(this.sentinel),
      sleep: () => {
        this.slept += 1
        return Promise.resolve()
      },
      run: (argv) => {
        this.calls.push(argv)
        return Promise.resolve(this.printed)
      },
    })
  }

  static briefing() {
    return new PlanBriefing({
      ticket: new TicketKey('ABC-42'),
      issue: { number: 42 },
      located: new WorkspaceLocation({ path: CmuxDouble.WORKTREE, branch: 'feat/42' }),
      errand: 'escribe el plan',
    })
  }

  static named() {
    return { failed: false, stdout: 'OK workspace:4\n', stderr: '' }
  }

  static ran(cwd = CmuxDouble.WORKTREE) {
    return `${CmuxLauncher.MAGIC}\t1\tok\t${cwd}\n`
  }

  start() {
    return this.session().start(CmuxDouble.briefing())
  }
}

describe('CmuxPlanSession', () => {
  it('the_window_it_opens_is_cut_in_the_worktree_and_not_where_the_api_happens_to_run', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: CmuxDouble.ran() })

    await cmux.start()

    expect(cmux.calls[0]).toEqual([
      'new-workspace',
      '--name', 'ct-plan-ABC-42',
      '--cwd', CmuxDouble.WORKTREE,
      '--command', CmuxLauncher.typedFor(`${CmuxDouble.RUNS_IN}/42/${CmuxLauncher.SCRIPT_NAME}`),
    ])
  })

  it('the_errand_travels_by_disk_and_never_as_keystrokes', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: CmuxDouble.ran() })

    await cmux.start()

    expect(cmux.written[0][0]).toBe(`${CmuxDouble.RUNS_IN}/42/${CmuxLauncher.SCRIPT_NAME}`)
    expect(cmux.written[0][1]).toContain('escribe el plan')
    expect(JSON.stringify(cmux.calls[0])).not.toContain('escribe el plan')
  })

  it('the_handle_cmux_prints_is_what_comes_back_so_the_caller_can_reach_the_session_later', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: CmuxDouble.ran() })

    expect(await cmux.start()).toBe('workspace:4')
  })

  it('a_cmux_that_refuses_travels_out_typed', async () => {
    const cmux = new CmuxDouble({
      printed: { failed: true, stdout: '', stderr: 'no daemon' },
      sentinel: null,
    })

    await expect(cmux.start()).rejects.toBeInstanceOf(PlanSessionNotStarted)
  })

  it('a_cmux_that_names_nothing_is_not_taken_for_a_success', async () => {
    const cmux = new CmuxDouble({
      printed: { failed: false, stdout: 'starting...\n', stderr: '' },
      sentinel: CmuxDouble.ran(),
    })

    await expect(cmux.start()).rejects.toBeInstanceOf(PlanSessionNotNamed)
  })

  it('when_the_sentinel_does_not_show_up_the_line_is_resent_because_the_pty_can_eat_it', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: null })

    await cmux.start().catch(() => {})

    const typed = CmuxLauncher.typedFor(`${CmuxDouble.RUNS_IN}/42/${CmuxLauncher.SCRIPT_NAME}`)
    expect(cmux.calls).toContainEqual(['send', '--workspace', 'ct-plan-ABC-42', typed])
    expect(cmux.calls).toContainEqual(['send-key', '--workspace', 'ct-plan-ABC-42', 'Enter'])
  })

  it('a_sentinel_that_never_shows_up_is_reported_instead_of_being_called_a_launch', async () => {
    const cmux = new CmuxDouble({ printed: CmuxDouble.named(), sentinel: null })

    const refusal = await cmux.start().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionDidNotRun)
    expect(refusal.message).toMatch(/centinela/)
  })

  it('a_sentinel_that_says_the_binary_was_missing_names_the_binary_and_not_the_window', async () => {
    const cmux = new CmuxDouble({
      printed: CmuxDouble.named(),
      sentinel: `${CmuxLauncher.MAGIC}\t1\tmissing\t${CmuxDouble.WORKTREE}\n`,
    })

    const refusal = await cmux.start().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionDidNotRun)
    expect(refusal.message).toContain('claude')
  })

  it('a_shell_that_landed_somewhere_else_is_reported_because_the_window_title_would_not_show_it', async () => {
    const cmux = new CmuxDouble({
      printed: CmuxDouble.named(),
      sentinel: CmuxDouble.ran('/somewhere/else'),
    })

    const refusal = await cmux.start().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionDidNotRun)
    expect(refusal.message).toContain('/somewhere/else')
  })
})
