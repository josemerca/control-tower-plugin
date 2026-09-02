import { describe, it, expect } from 'vitest'
import { StartPlan, StartPlanParams } from '../../src/application/actions/start-plan.js'
import { PlanAgents } from '../../src/domain/ports/plan-agents.js'
import { PlanIssues } from '../../src/domain/ports/plan-issues.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { UserStories } from '../../src/domain/ports/user-stories.js'
import { UserStory } from '../../src/domain/value-objects/user-story.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import {
  PlanAgentNotLaunched, PlanIssueNotCreated, UserStoryNotRead,
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

class PlanAgentsDouble extends PlanAgents {
  constructor(answer = 'workspace:4') {
    super()
    this.answer = answer
    this.asked = []
  }

  async launch({ story, issue }) {
    this.asked.push({ story, issue })
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

class Flow {
  static STORY = new UserStoryKey('MO_SHOP-42')
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor({ userStories, planIssues, planAgents } = {}) {
    this.userStories = userStories ?? UserStoriesDouble.reading('the summary of the story')
    this.planIssues = planIssues ?? new PlanIssuesDouble()
    this.planAgents = planAgents ?? new PlanAgentsDouble()
  }

  async run(story = Flow.STORY) {
    return new StartPlan(this).execute(
      new StartPlanParams({ story, repository: Flow.REPOSITORY })
    )
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

  it('the_agent_is_launched_on_the_issue_that_was_just_created_and_not_on_the_story_alone', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.planAgents.asked).toEqual([
      { story: Flow.STORY, issue: PlanIssuesDouble.OPENED },
    ])
  })

  it('both_the_issue_and_the_agent_come_back_so_the_caller_can_reach_either_of_them_later', async () => {
    const started = await new Flow().run()

    expect(started.issue).toBe(PlanIssuesDouble.OPENED)
    expect(started.agent).toBe('workspace:4')
  })

  it('a_story_that_cannot_be_read_stops_the_flow_before_an_issue_is_created_for_nothing', async () => {
    const flow = new Flow({ userStories: new UserStoriesDouble(new UserStoryNotRead('acli is not authenticated')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(UserStoryNotRead)
    expect(flow.planIssues.asked).toEqual([])
    expect(flow.planAgents.asked).toEqual([])
  })

  it('an_issue_that_cannot_be_created_stops_the_flow_before_an_agent_is_launched_for_nothing', async () => {
    const flow = new Flow({ planIssues: new PlanIssuesDouble(new PlanIssueNotCreated('label not found')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanIssueNotCreated)
    expect(flow.planAgents.asked).toEqual([])
  })

  it('an_agent_that_refuses_to_launch_travels_out_typed_instead_of_being_turned_into_a_status', async () => {
    const flow = new Flow({ planAgents: new PlanAgentsDouble(new PlanAgentNotLaunched('Access denied')) })

    const refusal = await flow.refusal()

    expect(refusal).toBeInstanceOf(PlanAgentNotLaunched)
    expect(refusal.name).toBe('PlanAgentNotLaunched')
    expect(refusal.message).toBe('Access denied')
  })

  it('the_story_reaches_the_agent_whole_so_the_tab_can_be_named_after_it', async () => {
    const flow = new Flow()

    await flow.run()

    expect(String(flow.planAgents.asked[0].story)).toBe('MO_SHOP-42')
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
    await expect(new PlanAgents().launch({ story: Flow.STORY, issue: PlanIssuesDouble.OPENED }))
      .rejects.toThrow(/must implement launch/)
    await expect(new PlanIssues().open({ story: null, repository: Flow.REPOSITORY }))
      .rejects.toThrow(/must implement open/)
    await expect(new UserStories().detail(Flow.STORY)).rejects.toThrow(/must implement detail/)
  })
})
