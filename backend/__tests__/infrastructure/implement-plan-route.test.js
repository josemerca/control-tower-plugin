import { describe, it, expect, afterEach } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { PlanAgentNotResumed } from '../../src/domain/exceptions.js'

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
      story: params.story.text,
      issue: params.issue,
      repo: params.repository.text,
    })
  }
}

class RunningApi {
  static #started = []
  static PATH = '/implement-plan'
  static ACCEPTED_BODY = '{"id":"XOP-4909","repo":"jjponz/repo-pulse","issue":33}'
  static ANSWER = '{"status":"implementing","id":"XOP-4909","repo":"jjponz/repo-pulse","issue":33}'
  static spy = null

  static async listening(spy = new ImplementPlanSpy()) {
    RunningApi.spy = spy
    const server = new ApiServer({ port: 0, startPlan: null, implementPlan: spy })
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
      { story: 'XOP-4909', issue: 33, repo: 'jjponz/repo-pulse' },
    ])
  })

  it('a_malformed_story_key_is_refused_naming_the_shape_it_wanted_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"id":"nope","repo":"jjponz/repo-pulse","issue":33}')

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/^id must be a user story key/)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_issue_that_is_not_a_whole_number_from_one_is_refused_and_never_reaches_the_use_case', async () => {
    const response = await RunningApi.asking('{"id":"XOP-4909","repo":"jjponz/repo-pulse","issue":"33"}')

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'issue must be a whole number from one' })
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_malformed_repository_is_refused_before_it_can_become_an_argument_of_a_tool', async () => {
    const response = await RunningApi.asking('{"id":"XOP-4909","repo":"-o","issue":33}')

    expect(response.status).toBe(400)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_field_nobody_declared_is_named_in_the_refusal_instead_of_being_ignored', async () => {
    const response = await RunningApi.asking(
      '{"id":"XOP-4909","repo":"jjponz/repo-pulse","issue":33,"force":true}'
    )

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
