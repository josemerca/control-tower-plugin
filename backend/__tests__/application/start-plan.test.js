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
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import {
  PlanAgentNotLaunched, PlanIssueNotClaimed, PlanIssueNotCreated, UserStoryNotRead,
  WorkspaceNotPrepared,
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

  constructor(answer = PlanIssuesDouble.OPENED, { claimFailure = null } = {}) {
    super()
    this.answer = answer
    this.claimFailure = claimFailure
    this.asked = []
    this.claimed = []
    this.requeued = []
    this.steps = []
  }

  static refusingToClaim(said) {
    return new PlanIssuesDouble(PlanIssuesDouble.OPENED, {
      claimFailure: new PlanIssueNotClaimed(said),
    })
  }

  async open({ story, repository }) {
    this.asked.push({ story, repository })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }

  async claim({ issue, repository }) {
    this.claimed.push({ issue, repository })
    if (this.claimFailure !== null) throw this.claimFailure
  }

  async requeue({ issue, repository }) {
    this.requeued.push({ issue, repository })
    this.steps.push('requeue')
  }
}

class WorkspaceDouble extends Workspace {
  static LOCATED = new WorkspaceLocation({ path: '/repo/.worktrees/7', branch: 'feat/7' })

  constructor(answer = WorkspaceDouble.LOCATED) {
    super()
    this.answer = answer
    this.asked = []
    this.undone = []
    this.steps = []
  }

  static refusing(said) {
    return new WorkspaceDouble(new WorkspaceNotPrepared(said))
  }

  async prepare({ issue, repository }) {
    this.asked.push({ issue, repository })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }

  async undo(located) {
    this.undone.push(located)
    this.steps.push('undo')
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
    this.steps = []
    this.planIssues.steps = this.steps
    this.workspace.steps = this.steps
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

  it('the_agent_and_everything_needed_to_watch_the_plan_come_back_as_one_thing_the_caller_cannot_misspell', async () => {
    const started = await new Flow().run()

    expect(started.agent).toBe('workspace:4')
    expect(started.watch).toBeInstanceOf(PlanWatch)
    expect(started.watch.issue).toBe(PlanIssuesDouble.OPENED)
    expect(started.watch.located).toBe(WorkspaceDouble.LOCATED)
    expect(started.watch.repository).toBe(Flow.REPOSITORY)
    expect(started.watch.agent).toBe(started.agent)
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

  it('a_launch_that_succeeds_never_undoes_the_workspace_it_just_prepared', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.workspace.undone).toEqual([])
  })
})

describe('StartPlan claims the issue so no second dispatcher takes it', () => {
  it('the_issue_is_claimed_before_the_worktree_is_cut_so_a_second_dispatcher_cannot_take_it', async () => {
    const claiming = new Flow()
    await claiming.run()
    const refused = new Flow({ planIssues: PlanIssuesDouble.refusingToClaim('gh issue edit failed: nope') })

    const refusal = await refused.refusal()

    expect(claiming.planIssues.claimed).toEqual([
      { issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY },
    ])
    expect(refusal).toBeInstanceOf(PlanIssueNotClaimed)
    expect(refused.workspace.asked).toEqual([])
  })

  it('a_worktree_that_could_not_be_cut_puts_the_issue_back_in_the_queue_instead_of_leaving_a_claim_nobody_works', async () => {
    const flow = new Flow({ workspace: WorkspaceDouble.refusing('branch is taken') })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(flow.planIssues.requeued).toEqual([
      { issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY },
    ])
  })

  it('an_agent_that_never_launched_puts_the_issue_back_in_the_queue_after_the_worktree_is_undone', async () => {
    const flow = new Flow({ planAgents: PlanAgentsDouble.refusing('cmux is not reachable') })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(flow.workspace.undone).toEqual([WorkspaceDouble.LOCATED])
    expect(flow.planIssues.requeued).toEqual([
      { issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY },
    ])
    expect(flow.steps).toEqual(['undo', 'requeue'])
  })

  it('a_port_that_nobody_implemented_says_so_for_the_two_ends_of_the_claim_too', async () => {
    await expect(new PlanIssues().claim({
      issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement claim/)
    await expect(new PlanIssues().requeue({
      issue: PlanIssuesDouble.OPENED, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement requeue/)
  })
})
