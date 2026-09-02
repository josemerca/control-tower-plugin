import { describe, it, expect, vi } from 'vitest'
import { StartPlan, StartPlanParams } from '../../src/application/actions/start-plan.js'
import { PlanSession } from '../../src/domain/plan-session.js'
import { PlanSessionNotStarted, WorkspaceNotPrepared } from '../../src/domain/exceptions.js'
import { TicketKey } from '../../src/domain/ticket-key.js'
import { Workspace } from '../../src/domain/workspace.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'

class PlanSessionDouble extends PlanSession {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  async start(briefing) {
    this.asked.push(briefing)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class WorkspaceDouble extends Workspace {
  constructor(answer, { undoFailure } = {}) {
    super()
    this.answer = answer
    this.asked = []
    this.undone = []
    this.undoFailure = undoFailure
  }

  async prepare(issue) {
    this.asked.push(issue)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }

  async undo(located) {
    this.undone.push(located)
    if (this.undoFailure instanceof Error) throw this.undoFailure
  }
}

class BriefDouble {
  static errandFor({ issue, repository }) {
    return `escribe el plan de #${issue.number} en ${repository}`
  }
}

const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })
const issue = { number: 42, url: 'https://github.com/owner/name/issues/42' }

describe('StartPlan', () => {
  const conducted = ({ workspace, planSession }) => new StartPlan({
    tickets: { detail: async (ticket) => ({ key: ticket }) },
    planIssues: { open: async () => issue },
    workspace,
    planSession,
    brief: BriefDouble,
  })

  it('the_ticket_it_was_given_is_the_one_the_session_is_asked_to_open', async () => {
    const planSession = new PlanSessionDouble('workspace:4')
    const ticket = new TicketKey('MO_SHOP-42')

    await conducted({ workspace: new WorkspaceDouble(located), planSession })
      .execute(new StartPlanParams({ ticket, repository: 'owner/name' }))

    expect(String(planSession.asked[0].ticket)).toBe(String(ticket))
  })

  it('the_handle_the_session_answers_is_what_the_caller_gets_back', async () => {
    const planSession = new PlanSessionDouble('workspace:9')

    const started = await conducted({ workspace: new WorkspaceDouble(located), planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-1'), repository: 'owner/name' }))

    expect(started.session).toBe('workspace:9')
  })

  it('a_session_that_refuses_to_start_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const planSession = new PlanSessionDouble(new PlanSessionNotStarted('Access denied'))

    const refusal = await conducted({ workspace: new WorkspaceDouble(located), planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-1'), repository: 'owner/name' }))
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionNotStarted)
    expect(refusal.name).toBe('PlanSessionNotStarted')
    expect(refusal.message).toBe('Access denied')
  })

  it('neither_what_goes_in_nor_what_comes_out_can_be_edited_after_the_use_case_settled_it', async () => {
    const planSession = new PlanSessionDouble('workspace:4')
    const params = new StartPlanParams({ ticket: new TicketKey('ABC-1'), repository: 'owner/name' })

    const started = await conducted({ workspace: new WorkspaceDouble(located), planSession }).execute(params)

    expect(Object.isFrozen(params)).toBe(true)
    expect(Object.isFrozen(started)).toBe(true)
  })

  it('the_ticket_reaches_the_session_whole_so_the_tab_can_be_named_after_it', async () => {
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({ workspace: new WorkspaceDouble(located), planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('MO_SHOP-42'), repository: 'owner/name' }))

    expect(String(planSession.asked[0].ticket)).toBe('MO_SHOP-42')
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanSession().start(new TicketKey('ABC-1'))).rejects.toThrow(/must implement start/)
  })
})

describe('StartPlan prepares the ground before it opens the session', () => {
  const conducted = ({ workspace, planSession }) => new StartPlan({
    tickets: { detail: async (ticket) => ({ key: ticket }) },
    planIssues: { open: async () => issue },
    workspace,
    planSession,
    brief: BriefDouble,
  })

  it('the_workspace_is_prepared_for_the_issue_that_was_just_opened', async () => {
    const workspace = new WorkspaceDouble(located)
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({ workspace, planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))

    expect(workspace.asked).toEqual([issue])
  })

  it('the_session_is_told_where_to_run_and_what_to_do_and_never_has_to_work_it_out', async () => {
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({ workspace: new WorkspaceDouble(located), planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))

    expect(planSession.asked[0].located).toBe(located)
    expect(planSession.asked[0].errand).toBe('escribe el plan de #42 en owner/name')
    expect(String(planSession.asked[0].ticket)).toBe('ABC-42')
  })

  it('where_the_work_landed_comes_back_so_the_caller_can_watch_it', async () => {
    const started = await conducted({
      workspace: new WorkspaceDouble(located),
      planSession: new PlanSessionDouble('workspace:4'),
    }).execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))

    expect(started.located).toBe(located)
  })

  it('no_session_is_opened_when_there_is_nowhere_for_it_to_work', async () => {
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({
      workspace: new WorkspaceDouble(new WorkspaceNotPrepared('branch is taken')),
      planSession,
    })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch(() => {})

    expect(planSession.asked).toEqual([])
  })

  it('a_workspace_that_refuses_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const refusal = await conducted({
      workspace: new WorkspaceDouble(new WorkspaceNotPrepared('branch is taken')),
      planSession: new PlanSessionDouble('workspace:4'),
    })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
  })
})

describe('StartPlan cleans up after a launch that never took off', () => {
  const conducted = ({ workspace, planSession }) => new StartPlan({
    tickets: { detail: async (ticket) => ({ key: ticket }) },
    planIssues: { open: async () => issue },
    workspace,
    planSession,
    brief: BriefDouble,
  })

  it('a_launch_that_fails_after_the_workspace_was_prepared_undoes_that_workspace', async () => {
    const workspace = new WorkspaceDouble(located)
    const planSession = new PlanSessionDouble(new PlanSessionNotStarted('cmux is not reachable'))

    await conducted({ workspace, planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch(() => {})

    expect(workspace.undone).toEqual([located])
  })

  it('the_failure_that_reaches_the_caller_is_still_the_launch_failure_and_not_a_status_derived_from_it', async () => {
    const workspace = new WorkspaceDouble(located)
    const planSession = new PlanSessionDouble(new PlanSessionNotStarted('cmux is not reachable'))

    const refusal = await conducted({ workspace, planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionNotStarted)
    expect(refusal.message).toBe('cmux is not reachable')
  })

  it('a_cleanup_that_also_fails_does_not_replace_the_launch_failure_that_caused_it', async () => {
    const workspace = new WorkspaceDouble(located, { undoFailure: new Error('worktree remove failed') })
    const planSession = new PlanSessionDouble(new PlanSessionNotStarted('cmux is not reachable'))

    const refusal = await conducted({ workspace, planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionNotStarted)
    expect(refusal.message).toBe('cmux is not reachable')
  })

  it('a_launch_that_succeeds_never_undoes_the_workspace_it_just_prepared', async () => {
    const workspace = new WorkspaceDouble(located)
    const planSession = new PlanSessionDouble('workspace:4')

    await conducted({ workspace, planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))

    expect(workspace.undone).toEqual([])
  })

  it('a_workspace_with_no_undo_at_all_does_not_replace_the_launch_failure_that_caused_the_cleanup', async () => {
    const workspace = { prepare: async () => located }
    const planSession = new PlanSessionDouble(new PlanSessionNotStarted('cmux is not reachable'))

    const refusal = await conducted({ workspace, planSession })
      .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
      .catch((cause) => cause)

    expect(refusal).toBeInstanceOf(PlanSessionNotStarted)
    expect(refusal.message).toBe('cmux is not reachable')
  })

  it('a_cleanup_that_fails_leaves_a_trace_on_the_error_channel_instead_of_disappearing_in_silence', async () => {
    const workspace = new WorkspaceDouble(located, { undoFailure: new Error('worktree remove failed') })
    const planSession = new PlanSessionDouble(new PlanSessionNotStarted('cmux is not reachable'))
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await conducted({ workspace, planSession })
        .execute(new StartPlanParams({ ticket: new TicketKey('ABC-42'), repository: 'owner/name' }))
        .catch(() => {})

      const said = complaining.mock.calls.map(([line]) => line).join('')
      expect(said).toContain('worktree remove failed')
    } finally {
      complaining.mockRestore()
    }
  })
})
