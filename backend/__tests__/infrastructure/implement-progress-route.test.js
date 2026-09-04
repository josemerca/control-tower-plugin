import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { ReviewsSpy } from '../reviews-spy.js'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { ImplementationState, ImplementationStep } from '../../src/domain/value-objects/implementation-state.js'
import { ImplementationProgressNotRead } from '../../src/domain/exceptions.js'

class ReadImplementationProgressSpy {
  constructor() {
    this.asked = []
  }

  static answering(state) {
    const spy = new ReadImplementationProgressSpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      return { state }
    }

    return spy
  }

  static failingWith(cause) {
    const spy = new ReadImplementationProgressSpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      throw cause
    }

    return spy
  }

  static buggy() {
    const spy = new ReadImplementationProgressSpy()
    spy.execute = async (params) => {
      spy.asked.push(params)
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params) {
    this.asked.push(params)
    throw new Error('ReadImplementationProgressSpy was not given an answer')
  }
}

class RunningApi {
  static #started = []
  static PATH = '/implement-progress/99'
  static ROOT = '/checkout'
  static IN_THE_MIDDLE_OF_A_TASK = ImplementationState.of({
    step: ImplementationStep.JUDGE,
    task: 3,
    totalTasks: 7,
    name: 'el lector del plan',
    attempt: 2,
    discards: 0,
  })

  static NO_FRONTEND = join(tmpdir(), 'ct-frontend-never-built')
  static NO_EVENTS = new PlanEvents({
    read: () => Promise.reject(new Error('this suite never streams plan events')),
    sleep: () => Promise.resolve(),
  })

  static async listening(spy = ReadImplementationProgressSpy.answering(RunningApi.IN_THE_MIDDLE_OF_A_TASK)) {
    const server = new ApiServer({
      port: 0,
      startPlan: null,
      implementPlan: null,
      implementProgress: spy,
      reviews: new ReviewsSpy(),
      sessions: new PlanSessions(),
      planEvents: RunningApi.NO_EVENTS,
      frontendRoot: RunningApi.NO_FRONTEND,
    })
    const port = await server.start()
    RunningApi.#started.push(server)

    return { port, spy }
  }

  static async stopAll() {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async get(port, path) {
    return fetch(`http://127.0.0.1:${port}${path}`)
  }

  static async asking(path, spy) {
    const running = await RunningApi.listening(spy)

    return { response: await RunningApi.get(running.port, path), spy: running.spy }
  }
}

afterEach(async () => {
  await RunningApi.stopAll()
})

describe('ImplementProgressRoute', () => {
  it('a_run_in_the_middle_of_a_task_answers_the_step_the_task_and_its_name', async () => {
    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(
      '{"step":"judge","task":3,"total_tasks":7,"name":"el lector del plan","attempt":2,"discards":0}'
    )
  })

  it('the_wire_says_total_tasks_and_the_value_object_says_totalTasks', async () => {
    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout`)

    const body = await response.json()

    expect(Object.prototype.hasOwnProperty.call(body, 'total_tasks')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(body, 'totalTasks')).toBe(false)
  })

  it('a_slice_that_has_not_started_answers_starting_with_nothing_filled_in', async () => {
    const spy = ReadImplementationProgressSpy.answering(ImplementationState.starting())

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout`, spy)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(
      '{"step":"starting","task":null,"total_tasks":null,"name":null,"attempt":null,"discards":null}'
    )
  })

  it('a_call_with_no_root_is_refused_and_the_progress_is_never_read', async () => {
    const spy = ReadImplementationProgressSpy.answering(RunningApi.IN_THE_MIDDLE_OF_A_TASK)

    const { response } = await RunningApi.asking(RunningApi.PATH, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-root',
      detail: 'root is an absolute path such as /Users/you/repos/name',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_relative_root_is_refused_the_same_way', async () => {
    const spy = ReadImplementationProgressSpy.answering(RunningApi.IN_THE_MIDDLE_OF_A_TASK)

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=repos/name`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'malformed-root',
      detail: 'root is an absolute path such as /Users/you/repos/name',
    })
    expect(spy.asked).toEqual([])
  })

  it('a_worktree_that_is_not_there_collapses_into_a_progress_that_could_not_be_read', async () => {
    const spy = ReadImplementationProgressSpy.failingWith(
      new ImplementationProgressNotRead('no worktree at /checkout/.worktrees/99')
    )

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      code: 'implementation-progress-not-read',
      detail: 'no worktree at /checkout/.worktrees/99',
    })
  })

  it('an_issue_that_is_not_a_number_reaches_the_query_as_NaN_and_not_as_a_refusal', async () => {
    const spy = ReadImplementationProgressSpy.answering(RunningApi.IN_THE_MIDDLE_OF_A_TASK)

    const { response } = await RunningApi.asking('/implement-progress/abc?root=%2Fcheckout', spy)

    expect(response.status).toBe(200)
    expect(spy.asked).toHaveLength(1)
    expect(Number.isNaN(spy.asked[0].issue)).toBe(true)
  })

  it('a_bug_of_ours_is_not_dressed_up_as_a_refusal', async () => {
    const spy = ReadImplementationProgressSpy.buggy()

    const { response } = await RunningApi.asking(`${RunningApi.PATH}?root=%2Fcheckout`, spy)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'request-failed', detail: 'request failed' })
  })
})
