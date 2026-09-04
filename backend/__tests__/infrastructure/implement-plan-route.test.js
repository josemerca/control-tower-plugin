import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { ReviewsSpy } from '../reviews-spy.js'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import {
  ImplementRequestOutcome, ImplementRefusal, ImplementCollapse,
} from '../../src/infrastructure/implement-plan-route.js'
import {
  PlanAgentNotResumed, PlanFailure, PlanGoNotAnswered, GoFailure, GoNotRecorded,
} from '../../src/domain/exceptions.js'

class ImplementPlanSpy {
  constructor() {
    this.asked = []
  }

  static failingWith(cause) {
    const spy = new ImplementPlanSpy()
    spy.execute = async () => {
      throw cause
    }

    return spy
  }

  static buggy() {
    const spy = new ImplementPlanSpy()
    spy.execute = async () => {
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params) {
    this.asked.push({
      agent: params.agent,
      issue: params.issue,
      repository: params.repository.text,
    })
  }
}

class RunningApi {
  static #started = []
  static PATH = '/implement-plan'
  static ACCEPTED_BODY = '{"agent":"workspace:20","issue":33,"repo":"jjponz/repo-pulse"}'
  static ANSWER = '{"status":"implementing","agent":"workspace:20","issue":33}'
  static spy = null
  static reviews = null
  static sessions = null
  static WATCHED = new PlanWatch({
    issue: new PlanIssue({ number: 33, url: 'https://github.com/jjponz/repo-pulse/issues/33' }),
    located: new WorkspaceLocation({ path: '/repo/.worktrees/33', branch: 'feat/33' }),
    repository: new RepositoryName('jjponz/repo-pulse'),
    agent: 'workspace:20',
  })

  static NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(spy = new ImplementPlanSpy()) {
    RunningApi.spy = spy
    RunningApi.reviews = new ReviewsSpy()
    RunningApi.sessions = new PlanSessions()
    RunningApi.sessions.remember(RunningApi.WATCHED)
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: spy,
      reviews: RunningApi.reviews,
      sessions: RunningApi.sessions,
      planEvents: RunningApi.NO_EVENTS,
      frontendRoot: RunningApi.NO_FRONTEND,
    })
    const port = await server.start()
    RunningApi.#started.push(server)

    return port
  }

  static async stopAll() {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async post(port, body, headers = { 'Content-Type': 'application/json' }) {
    return fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'POST', body, headers })
  }

  static async asking(body) {
    return RunningApi.post(await RunningApi.listening(), body)
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ImplementPlanRoute', () => {
  it('an_accepted_order_answers_that_the_implementation_is_under_way', async () => {
    const response = await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe(RunningApi.ANSWER)
  })

  it('the_three_fields_reach_the_use_case_as_domain_values_and_not_as_the_raw_json', async () => {
    await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(RunningApi.spy.asked).toEqual([
      { agent: 'workspace:20', issue: 33, repository: 'jjponz/repo-pulse' },
    ])
  })

  it('a_repository_that_is_not_owner_slash_name_is_refused_before_it_can_become_an_argument_of_gh', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":33,"repo":"-oProxy"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'repo must be a repository such as owner/name',
    })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_agent_handle_with_whitespace_is_refused_before_it_can_become_an_argument_of_cmux', async () => {
    const response = await RunningApi.asking('{"agent":"ct-plan XOP-4909","issue":33,"repo":"jjponz/repo-pulse"}')

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^agent must be the handle/)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_issue_that_is_not_a_whole_number_from_one_is_refused_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":"33"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'issue must be a whole number from one' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_issue_of_zero_is_refused_because_the_count_of_whole_numbers_from_one_starts_at_one', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":0}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'issue must be a whole number from one' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_field_nobody_declared_is_named_in_the_refusal_instead_of_being_ignored', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":33,"force":true}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'unknown field: force' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_body_that_is_not_a_json_object_is_refused_as_such', async () => {
    const response = await RunningApi.asking('[]')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'body must be a JSON object' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_body_over_the_cap_is_refused_with_the_same_answer_start_plan_gives_and_never_reaches_the_use_case', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, `{"id":"${'A'.repeat(9000)}","issue":33}`)

    expect(response.status).toBe(413)
    expect(await response.text()).toBe('{"error":"body must not exceed 8192 bytes"}')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_tool_that_refuses_to_write_in_the_tab_answers_that_trying_again_may_work', async () => {
    const port = await RunningApi.listening(
      ImplementPlanSpy.failingWith(new PlanAgentNotResumed('cmux send failed: no such workspace'))
    )

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(503)
    expect((await response.json()).error).toMatch(/^could not implement the plan: /)
  })

  it('a_bug_of_ours_is_not_dressed_up_as_the_tool_refusing', async () => {
    const port = await RunningApi.listening(ImplementPlanSpy.buggy())

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'request failed' })
  })

  it('a_body_with_no_json_content_type_is_refused_before_it_is_read', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, RunningApi.ACCEPTED_BODY, { 'Content-Type': 'text/plain' })

    expect(response.status).toBe(415)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('any_method_other_than_post_is_refused_saying_which_one_is_allowed', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}${RunningApi.PATH}`, { method: 'GET' })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })
})

describe('ImplementRefusal', () => {
  it('every_refusable_outcome_has_an_answer_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    const refusable = Object.values(ImplementRequestOutcome).filter(
      (outcome) => outcome !== ImplementRequestOutcome.ACCEPTED
    )

    expect(ImplementRefusal.declaredOutcomes().sort()).toEqual(refusable.sort())
  })

  it('an_outcome_with_no_answer_raises_instead_of_being_served_as_a_blank_refusal', () => {
    expect(() => ImplementRefusal.of({ outcome: 'invented' })).toThrow(/no refusal declared/)
  })
})

describe('ImplementCollapse', () => {
  const RESUMING_AN_AGENT = ['GoNotRecorded', 'PlanGoNotAnswered', 'PlanAgentNotResumed']

  it('every_way_resuming_an_agent_can_collapse_has_a_status_so_adding_one_cannot_reach_the_client_as_a_crash', () => {
    expect(ImplementCollapse.declaredFailures().sort()).toEqual(RESUMING_AN_AGENT.sort())
  })

  it('a_go_nobody_could_record_is_something_to_try_again_and_names_why', () => {
    const collapse = ImplementCollapse.of(new GoNotRecorded('the directory is not writable'))

    expect(collapse.status).toBe(503)
    expect(collapse.error).toBe('could not implement the plan: the directory is not writable')
  })

  it('a_go_the_issue_did_not_take_is_something_to_try_again_and_names_what_gh_said', () => {
    const collapse = ImplementCollapse.of(new PlanGoNotAnswered('gh issue comment failed: nope'))

    expect(collapse.status).toBe(503)
    expect(collapse.error).toBe('could not implement the plan: gh issue comment failed: nope')
  })

  it('a_family_is_not_a_way_of_collapsing_so_answering_one_raises_instead_of_guessing', () => {
    expect(() => ImplementCollapse.of(new PlanFailure('nope'))).toThrow(/no status declared/)
    expect(() => ImplementCollapse.of(new GoFailure('nope'))).toThrow(/no status declared/)
  })
})

describe('implementing the plan lifts the watch on its issue', () => {
  afterEach(RunningApi.stopAll)

  it('implementing_the_plan_lifts_the_watch_because_there_is_nothing_left_to_ask_for', async () => {
    const response = await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
    expect(RunningApi.reviews.stopped).toEqual([{
      issue: 33, repository: RunningApi.WATCHED.repository,
    }])
  })

  it('implementing_the_plan_forgets_the_session_so_nothing_keeps_reading_the_contract_of_a_plan_being_built', async () => {
    await RunningApi.asking(RunningApi.ACCEPTED_BODY)

    expect(RunningApi.sessions.watching(33)).toBe(null)
  })

  it('a_refused_request_to_implement_forgets_no_session', async () => {
    await RunningApi.asking('{"agent":"workspace:20","issue":0,"repo":"a/b"}')

    expect(RunningApi.sessions.watching(33)).toBe(RunningApi.WATCHED)
  })

  it('a_refused_request_to_implement_lifts_no_watch', async () => {
    const response = await RunningApi.asking('{"agent":"workspace:20","issue":0,"repo":"a/b"}')

    expect(response.status).toBe(400)
    expect(RunningApi.reviews.stopped).toEqual([])
  })

  it('a_plan_the_agent_would_not_take_keeps_its_watch_so_the_changes_can_still_be_asked_for', async () => {
    const spy = ImplementPlanSpy.failingWith(new PlanAgentNotResumed('no such workspace'))

    const response = await RunningApi.post(await RunningApi.listening(spy), RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(503)
    expect(RunningApi.reviews.stopped).toEqual([])
  })
})
