import { describe, it, expect, vi } from 'vitest'
import { StartPlan, StartPlanParams } from '../../src/application/actions/start-plan.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { UserStories } from '../../src/domain/ports/user-stories.js'
import { Workspace } from '../../src/domain/ports/workspace.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { UserStory } from '../../src/domain/value-objects/user-story.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import {
  PlanAgentNotLaunched, PlanIssueNotCreated, UserStoryNotRead, WorkspaceNotPrepared,
} from '../../src/domain/exceptions.js'

class UserStoriesDouble extends UserStories {
  constructor(answer) {
    super()
    this.answer = answer
    this.asked = []
  }

  static reading(summary) {
    return new UserStoriesDouble((key) => new UserStory({ key, summary, description: 'as a user I want' }))
  }

  async detail(key) {
    this.asked.push(key)
    if (this.answer instanceof Error) throw this.answer
    return this.answer(key)
  }
}

class PlanIssuesDouble extends PlanIssues {
  static OPENED = new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' })

  constructor(answer = PlanIssuesDouble.OPENED) {
    super()
    this.answer = answer
    this.asked = []
  }

  async open({ story, repository }) {
    this.asked.push({ story, repository })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class WorkspaceDouble extends Workspace {
  static LOCATED = new WorkspaceLocation({ path: '/repo/.worktrees/7', branch: 'feat/7' })

  constructor(answer = WorkspaceDouble.LOCATED, { undoFailure = null } = {}) {
    super()
    this.answer = answer
    this.undoFailure = undoFailure
    this.asked = []
    this.undone = []
  }

  static refusing(said) {
    return new WorkspaceDouble(new WorkspaceNotPrepared(said))
  }

  static leaking(said) {
    return new WorkspaceDouble(WorkspaceDouble.LOCATED, { undoFailure: new Error(said) })
  }

  async prepare({ issue, repository }) {
    this.asked.push({ issue, repository })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }

  async undo(located) {
    this.undone.push(located)
    if (this.undoFailure !== null) throw this.undoFailure
  }
}

class PlanAgentsDouble extends PlanAgents {
  constructor(answer = 'workspace:4') {
    super()
    this.answer = answer
    this.asked = []
  }

  static refusing(said) {
    return new PlanAgentsDouble(new PlanAgentNotLaunched(said))
  }

  async launch(briefing) {
    this.asked.push(briefing)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class Flow {
  static STORY = new UserStoryKey('MO_SHOP-42')
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor({ userStories, planIssues, workspace, planAgents } = {}) {
    this.userStories = userStories ?? UserStoriesDouble.reading('the summary of the story')
    this.planIssues = planIssues ?? new PlanIssuesDouble()
    this.workspace = workspace ?? new WorkspaceDouble()
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run(story = Flow.STORY) {
    return new StartPlan(this).execute(new StartPlanParams({ story, repository: Flow.REPOSITORY }))
  }

  async refusal(story = Flow.STORY) {
    return this.run(story).catch((cause) => cause)
  }
}

describe('StartPlan', () => {
  it('the_story_it_was_given_is_the_one_it_reads_before_anything_is_created', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.userStories.asked).toEqual([Flow.STORY])
  })

  it('the_issue_is_opened_in_the_repository_the_caller_named_and_carries_what_jira_said', async () => {
    const flow = new Flow({ userStories: UserStoriesDouble.reading('rename the button') })

    await flow.run()

    const [asked] = flow.planIssues.asked
    expect(asked.repository).toBe(Flow.REPOSITORY)
    expect(asked.story.summary).toBe('rename the button')
    expect(asked.story.key).toBe(Flow.STORY)
  })

  it('the_workspace_is_prepared_for_the_issue_that_was_just_opened', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.workspace.asked).toEqual([
      { issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY },
    ])
  })

  it('the_worktree_is_prepared_for_the_repository_the_issue_was_opened_in_so_neither_can_drift_from_the_other', async () => {
    const flow = new Flow()

    await flow.run()

    const [prepared] = flow.workspace.asked
    expect(prepared.repository).toBe(flow.planIssues.asked[0].repository)
  })

  it('the_agent_is_told_where_to_run_and_which_issue_in_which_repository_and_never_has_to_work_it_out', async () => {
    const flow = new Flow()

    await flow.run()

    const [briefing] = flow.planAgents.asked
    expect(briefing.located).toBe(WorkspaceDouble.LOCATED)
    expect(briefing.issue).toBe(PlanIssuesDouble.OPENED)
    expect(briefing.repository).toBe(Flow.REPOSITORY)
  })

  it('the_story_reaches_the_agent_whole_so_the_tab_can_be_named_after_it', async () => {
    const flow = new Flow()

    await flow.run()

    expect(String(flow.planAgents.asked[0].story)).toBe('MO_SHOP-42')
  })

  it('the_issue_the_agent_and_where_the_work_landed_all_come_back_so_the_caller_can_watch_it', async () => {
    const started = await new Flow().run()

    expect(started.issue).toBe(PlanIssuesDouble.OPENED)
    expect(started.agent).toBe('workspace:4')
    expect(started.located).toBe(WorkspaceDouble.LOCATED)
  })

  it('a_story_that_cannot_be_read_stops_the_flow_before_an_issue_is_created_for_nothing', async () => {
    const flow = new Flow({ userStories: new UserStoriesDouble(new UserStoryNotRead('acli is not authenticated')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(UserStoryNotRead)
    expect(flow.planIssues.asked).toEqual([])
    expect(flow.workspace.asked).toEqual([])
    expect(flow.planAgents.asked).toEqual([])
  })

  it('an_issue_that_cannot_be_created_stops_the_flow_before_a_worktree_is_cut_for_nothing', async () => {
    const flow = new Flow({ planIssues: new PlanIssuesDouble(new PlanIssueNotCreated('label not found')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanIssueNotCreated)
    expect(flow.workspace.asked).toEqual([])
    expect(flow.planAgents.asked).toEqual([])
  })

  it('no_agent_is_launched_when_there_is_nowhere_for_it_to_work', async () => {
    const flow = new Flow({ workspace: WorkspaceDouble.refusing('branch is taken') })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(flow.planAgents.asked).toEqual([])
  })

  it('an_agent_that_refuses_to_launch_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing('Access denied') })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.name).toBe('PlanAgentNotLaunched')
    expect(refusal.message).toBe('Access denied')
  })

  it('a_story_with_no_summary_at_all_is_refused_by_the_value_object_and_not_carried_around_empty', async () => {
    const flow = new Flow({ userStories: UserStoriesDouble.reading(undefined) })

    await expect(flow.run()).rejects.toThrow(/a user story carries text/)
  })

  it('a_story_that_is_not_keyed_by_a_story_key_cannot_be_built_at_all', () => {
    expect(() => new UserStory({ key: 'MO_SHOP-42', summary: 'a', description: 'b' }))
      .toThrow(/keyed by a UserStoryKey/)
  })

  it('an_issue_without_a_number_cannot_be_built_because_nothing_downstream_could_use_it', () => {
    expect(() => new PlanIssue({ number: 0, url: 'https://github.com/owner/name/issues/0' }))
      .toThrow(/numbered from one/)
    expect(() => new PlanIssue({ number: 7, url: '' })).toThrow(/reachable at a url/)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new PlanAgents().launch(null)).rejects.toThrow(/must implement launch/)
    await expect(new PlanIssues().open({ story: null, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement open/)
    await expect(new UserStories().detail(Flow.STORY)).rejects.toThrow(/must implement detail/)
    await expect(new Workspace().prepare({
      issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement prepare/)
    await expect(new Workspace().undo(WorkspaceDouble.LOCATED)).rejects.toThrow(/must implement undo/)
  })
})

describe('StartPlan collects the ground it prepared when the launch never took off', () => {
  it('a_launch_that_fails_after_the_workspace_was_prepared_undoes_that_workspace', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing('cmux is not reachable') })

    await flow.refusal()

    expect(flow.workspace.undone).toEqual([WorkspaceDouble.LOCATED])
  })

  it('the_failure_that_reaches_the_caller_is_still_the_launch_failure_and_not_a_status_derived_from_it', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing('cmux is not reachable') })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toBe('cmux is not reachable')
  })

  it('a_cleanup_that_also_fails_does_not_replace_the_launch_failure_that_caused_it', async () => {
    const flow = new Flow({
      workspace: WorkspaceDouble.leaking('worktree remove failed'),
      planAgents: PlanAgentsDouble.refusing('cmux is not reachable'),
    })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toBe('cmux is not reachable')
  })

  it('a_workspace_with_no_undo_at_all_does_not_replace_the_launch_failure_that_caused_the_cleanup', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing('cmux is not reachable') })
    flow.workspace = { prepare: async () => WorkspaceDouble.LOCATED }

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.message).toBe('cmux is not reachable')
  })

  it('a_launch_that_succeeds_never_undoes_the_workspace_it_just_prepared', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.workspace.undone).toEqual([])
  })

  it('a_cleanup_that_fails_never_writes_to_stderr_because_the_adapter_that_failed_already_reported_it', async () => {
    const flow = new Flow({
      workspace: WorkspaceDouble.leaking('worktree remove failed'),
      planAgents: PlanAgentsDouble.refusing('cmux is not reachable'),
    })
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await flow.refusal()

      expect(complaining.mock.calls).toEqual([])
    } finally {
      complaining.mockRestore()
    }
  })
})
