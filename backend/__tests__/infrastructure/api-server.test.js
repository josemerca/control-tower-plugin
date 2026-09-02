import { describe, it, expect, afterEach, vi } from 'vitest'
import { connect } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { StartPlanResult } from '../../src/application/actions/start-plan.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanEvents, EventsRefusal } from '../../src/infrastructure/plan-events-route.js'
import {
  PlanAgentNotLaunched, UserStoryNotRead, PlanIssueNotCreated, PlanIssueNotNamed, WorkspaceNotPrepared,
  PlanProgressNotRead,
} from '../../src/domain/exceptions.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { PlanState } from '../../src/domain/value-objects/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'

class StartPlanSpy {
  static AGENT = 'workspace:4'
  static ISSUE = new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' })
  static LOCATED = new WorkspaceLocation({ path: '/repo/.worktrees/7', branch: 'feat/7' })
  static WATCH = new PlanWatch({
    issue: StartPlanSpy.ISSUE,
    located: StartPlanSpy.LOCATED,
    repository: new RepositoryName('owner/name'),
  })

  constructor({ failing = false } = {}) {
    this.asked = []
    this.repositories = []
    this.failing = failing
  }

  static failingWith(cause) {
    const spy = new StartPlanSpy()
    spy.execute = async () => {
      throw cause
    }

    return spy
  }

  static buggy() {
    const spy = new StartPlanSpy()
    spy.execute = async () => {
      throw new TypeError('a bug of ours')
    }

    return spy
  }

  async execute(params) {
    this.asked.push(params.story.text)
    this.repositories.push(params.repository.text)
    if (this.failing) throw new PlanAgentNotLaunched('cmux is not reachable')
    return new StartPlanResult({ agent: StartPlanSpy.AGENT, watch: StartPlanSpy.WATCH })
  }
}

class ProgressSpy {
  static UNREADABLE = 'git status could not say whether the plan is committed'

  constructor(state, cause) {
    this.state = state
    this.cause = cause
    this.asked = 0
  }

  static events(state, { sleepMs = 0 } = {}) {
    return ProgressSpy.answering(new ProgressSpy(state, null), sleepMs)
  }

  static unable({ sleepMs = 0 } = {}) {
    const spy = new ProgressSpy(null, new PlanProgressNotRead(ProgressSpy.UNREADABLE))

    return ProgressSpy.answering(spy, sleepMs)
  }

  static answering(spy, sleepMs) {
    return {
      spy,
      planEvents: new PlanEvents({
        read: () => spy.read(),
        sleep: () => new Promise((resolve) => setTimeout(resolve, sleepMs)),
      }),
    }
  }

  async read() {
    this.asked += 1
    if (this.cause !== null) throw this.cause
    return { state: this.state }
  }
}

class FrontendFixture {
  static INDEX = '<!doctype html><title>control tower</title>'

  static built() {
    const root = mkdtempSync(join(tmpdir(), 'ct-frontend-'))
    writeFileSync(join(root, 'index.html'), FrontendFixture.INDEX)

    return root
  }

  static missing() {
    return join(tmpdir(), 'ct-frontend-never-built')
  }
}

class RunningApi {
  static #started = []
  static STORY = 'ABC-123'
  static REPO = 'owner/name'
  static ACCEPTED_BODY = `{"id":"ABC-123","repo":"owner/name"}`
  static ANSWER =
    '{"status":"started","id":"ABC-123","repo":"owner/name",' +
    '"issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"agent":"workspace:4"}'
  static spy = null

  static async listening(options = {}) {
    RunningApi.spy = new StartPlanSpy()
    const server = new ApiServer({ port: 0, startPlan: RunningApi.spy, implementPlan: null, ...options })
    const port = await server.start()
    RunningApi.#started.push(server)
    return port
  }

  static async stopAll() {
    const running = RunningApi.#started.splice(0)
    await Promise.all(running.map((server) => server.stop()))
  }

  static async post(port, path, body, headers = {}) {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    })
  }

  static async startPlan(port, body, headers = {}) {
    return RunningApi.post(port, '/start-plan', body, headers)
  }

  static async accepted(port) {
    return RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY)
  }

  static ask(port, lines) {
    return new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1', () => socket.write(lines))
      let said = ''
      socket.on('data', (chunk) => {
        said += chunk
      })
      socket.on('close', () => resolve(said.split('\r\n')[0]))
    })
  }

  static asking(path, headers, body, host = '127.0.0.1') {
    const written = [`POST ${path} HTTP/1.1`, `Host: ${host}`, 'Connection: close', ...headers]
    if (body !== undefined) written.push(`Content-Length: ${Buffer.byteLength(body)}`)

    return `${written.join('\r\n')}\r\n\r\n${body ?? ''}`
  }

  static cutMidBody(port) {
    return new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          'POST /start-plan HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
            'Content-Type: application/json\r\nContent-Length: 5000\r\n\r\n{"id":"'
        )
        socket.destroy()
        resolve()
      })
    })
  }
}

describe('ApiServer', () => {
  afterEach(async () => {
    await RunningApi.stopAll()
  })

  it('a_request_cut_halfway_through_its_body_does_not_take_the_whole_process_down_with_it', async () => {
    const port = await RunningApi.listening()

    await RunningApi.cutMidBody(port)
    const afterwards = await RunningApi.accepted(port)

    expect(afterwards.status).toBe(202)
  })

  it('a_client_that_hangs_up_is_ordinary_and_does_not_get_reported_as_something_gone_wrong', async () => {
    const port = await RunningApi.listening()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await RunningApi.cutMidBody(port)
      await RunningApi.accepted(port)

      expect(complaining.mock.calls).toEqual([])
    } finally {
      complaining.mockRestore()
    }
  })

  it('start_plan_accepts_and_answers_with_the_agent_it_launched_rather_than_waiting_for_it', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.accepted(port)

    expect(response.status).toBe(202)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.text()).toBe(RunningApi.ANSWER)
  })

  it('an_agent_that_cannot_be_launched_is_reported_as_such_instead_of_a_generic_failure', async () => {
    RunningApi.spy = new StartPlanSpy({ failing: true })
    const server = new ApiServer({ port: 0, startPlan: RunningApi.spy, implementPlan: null })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(503)
      expect(await response.text()).toBe(
        '{"error":"could not start the plan: cmux is not reachable"}'
      )
    } finally {
      await server.stop()
    }
  })

  it('a_story_an_issue_or_a_worktree_the_tool_refuses_are_all_answered_as_worth_trying_again', async () => {
    const causes = [
      new UserStoryNotRead('acli is not authenticated'),
      new PlanIssueNotCreated('label not found'),
      new WorkspaceNotPrepared('branch is taken'),
    ]

    for (const cause of causes) {
      const server = new ApiServer({ port: 0, startPlan: StartPlanSpy.failingWith(cause), implementPlan: null })
      const port = await server.start()

      try {
        const response = await RunningApi.accepted(port)

        expect(response.status).toBe(503)
        expect(await response.text()).toBe(`{"error":"could not start the plan: ${cause.message}"}`)
      } finally {
        await server.stop()
      }
    }
  })

  it('a_tool_that_answered_something_unreadable_is_not_offered_as_something_to_retry', async () => {
    const server = new ApiServer({
      port: 0, startPlan: StartPlanSpy.failingWith(new PlanIssueNotNamed('gh printed "done"')), implementPlan: null,
    })
    const port = await server.start()

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(502)
      expect(await response.text()).toBe('{"error":"could not start the plan: gh printed \\"done\\""}')
    } finally {
      await server.stop()
    }
  })

  it('a_failure_that_is_not_a_refusal_to_start_is_not_dressed_up_as_one', async () => {
    const server = new ApiServer({ port: 0, startPlan: StartPlanSpy.buggy(), implementPlan: null })
    const port = await server.start()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      const response = await RunningApi.accepted(port)

      expect(response.status).toBe(400)
      expect(await response.text()).toBe('{"error":"request failed"}')
    } finally {
      complaining.mockRestore()
      await server.stop()
    }
  })

  it('a_bug_of_ours_leaves_a_trace_on_the_error_channel_instead_of_vanishing_behind_that_400', async () => {
    const server = new ApiServer({ port: 0, startPlan: StartPlanSpy.buggy(), implementPlan: null })
    const port = await server.start()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await RunningApi.accepted(port)

      const said = complaining.mock.calls.map(([line]) => line).join('')
      expect(said).toContain('request to /start-plan failed')
      expect(said).toContain('a bug of ours')
    } finally {
      complaining.mockRestore()
      await server.stop()
    }
  })

  it('the_id_that_reaches_the_agent_is_the_one_the_body_carried_and_not_a_default', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/start-plan', '{"id":"MO_SHOP-42","repo":"owner/name"}')

    expect(RunningApi.spy.asked).toEqual(['MO_SHOP-42'])
    expect(await response.text()).toBe(RunningApi.ANSWER.replace('ABC-123', 'MO_SHOP-42'))
  })

  it('a_refused_request_never_starts_a_process', async () => {
    const port = await RunningApi.listening()

    await RunningApi.startPlan(port, '{"id":"nope","repo":"owner/name"}')

    expect(RunningApi.spy.asked).toEqual([])
  })

  it('trailing_slashes_do_not_change_the_route_however_many_of_them_are_written', async () => {
    const port = await RunningApi.listening()

    const one = await RunningApi.post(port, '/start-plan/', RunningApi.ACCEPTED_BODY)
    const two = await RunningApi.post(port, '/start-plan//', RunningApi.ACCEPTED_BODY)

    expect([one.status, two.status]).toEqual([202, 202])
  })

  it('a_query_string_does_not_hide_the_route_because_routing_reads_the_path_and_not_the_raw_url', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/start-plan?from=ui', RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(202)
  })

  it('reading_start_plan_is_refused_because_starting_a_plan_claims_the_issue_and_cuts_a_worktree', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`)

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('an_unknown_route_is_rejected_instead_of_answering_ok_to_anything', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/whatever', RunningApi.ACCEPTED_BODY)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"error":"not found"}')
  })

  it('a_request_from_a_foreign_page_is_refused_because_any_site_can_post_to_localhost', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      Origin: 'https://evil.example',
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('{"error":"this api only serves the page it hosts"}')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_request_from_the_page_this_server_hosts_is_accepted_because_that_page_is_the_frontend', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      Origin: `http://127.0.0.1:${port}`,
    })

    expect(response.status).toBe(202)
  })

  it('the_page_opened_as_localhost_is_still_our_own_because_the_host_header_says_so_too', async () => {
    const port = await RunningApi.listening()

    const said = await RunningApi.ask(
      port,
      RunningApi.asking(
        '/start-plan',
        [`Origin: http://localhost:${port}`, 'Content-Type: application/json'],
        RunningApi.ACCEPTED_BODY,
        `localhost:${port}`
      )
    )

    expect(said).toContain('202')
  })

  it('a_host_that_is_not_loopback_does_not_vouch_for_its_origin_because_dns_can_point_any_name_here', async () => {
    const port = await RunningApi.listening()

    const said = await RunningApi.ask(
      port,
      RunningApi.asking(
        '/start-plan',
        [`Origin: http://rebound.example:${port}`, 'Content-Type: application/json'],
        RunningApi.ACCEPTED_BODY,
        `rebound.example:${port}`
      )
    )

    expect(said).toContain('403')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('an_origin_on_another_port_of_loopback_is_foreign_because_another_local_server_is_another_site', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      Origin: `http://127.0.0.1:${port + 1}`,
    })

    expect(response.status).toBe(403)
  })

  it('the_frontend_build_is_served_from_the_root_so_page_and_api_share_one_origin', async () => {
    const root = FrontendFixture.built()
    const port = await RunningApi.listening({ frontendRoot: root })

    const response = await fetch(`http://127.0.0.1:${port}/`)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(FrontendFixture.INDEX)
  })

  it('a_frontend_root_that_does_not_exist_yet_leaves_the_api_up_instead_of_refusing_to_start', async () => {
    const port = await RunningApi.listening({ frontendRoot: FrontendFixture.missing() })

    const page = await fetch(`http://127.0.0.1:${port}/`)
    const api = await RunningApi.accepted(port)

    expect(page.status).toBe(404)
    expect(api.status).toBe(202)
  })

  it('serving_pages_does_not_open_start_plan_to_a_get_because_static_files_fall_through_to_the_routes', async () => {
    const port = await RunningApi.listening({ frontendRoot: FrontendFixture.built() })

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`)

    expect(response.status).toBe(405)
  })

  it('a_body_not_declared_as_json_is_refused_so_a_page_cannot_reach_this_without_a_preflight', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      'Content-Type': 'text/plain',
    })

    expect(response.status).toBe(415)
  })

  it('a_charset_on_the_content_type_is_still_json_because_clients_add_one_unasked', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, RunningApi.ACCEPTED_BODY, {
      'Content-Type': 'application/json; charset=utf-8',
    })

    expect(response.status).toBe(202)
  })

  it('a_body_that_is_not_json_is_refused_instead_of_starting_a_plan_for_nothing', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, 'ABC-123')

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"body must be a JSON object"}')
  })

  it('valid_json_that_is_not_an_object_is_refused_as_such_and_not_mistaken_for_a_missing_id', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      ['"ABC-123"', '[{"id":"ABC-123"}]', 'null', '123'].map((body) => RunningApi.startPlan(port, body))
    )

    expect(await Promise.all(refused.map((response) => response.text()))).toEqual(
      Array(4).fill('{"error":"body must be a JSON object"}')
    )
  })

  it('a_body_with_no_id_is_refused_because_there_is_nothing_to_plan_without_one', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, '{}')

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"id must be a user story key such as ABC-123"}')
  })

  it('an_id_that_is_not_shaped_like_a_story_key_is_refused_before_it_ever_becomes_a_branch_name', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      [
        '{"id":"   "}',
        '{"id":123}',
        '{"id":"../../etc/passwd"}',
        '{"id":"-o"}',
        '{"id":"abc-1"}',
        '{"id":"ABC"}',
        '{"id":"ABC-123 rm -rf"}',
        '{"id":"ABC-123\\n"}',
      ].map((body) => RunningApi.startPlan(port, body))
    )

    expect(refused.map((response) => response.status)).toEqual(Array(8).fill(400))
  })

  it('an_unknown_field_is_refused_because_it_means_the_other_side_changed_shape', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${RunningApi.STORY}","repo":"owner/name","priority":"high"}`)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"unknown field: priority"}')
  })

  it('the_repository_the_body_names_is_the_one_the_use_case_is_asked_to_open_the_issue_in', async () => {
    const port = await RunningApi.listening()

    await RunningApi.post(port, '/start-plan', '{"id":"ABC-123","repo":"josemerca/ct-loop-sandbox"}')

    expect(RunningApi.spy.repositories).toEqual(['josemerca/ct-loop-sandbox'])
  })

  it('a_body_with_no_repo_is_refused_because_an_issue_has_to_be_opened_somewhere', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${RunningApi.STORY}"}`)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"repo must be a repository such as owner/name"}')
  })

  it('a_repo_that_is_not_shaped_like_one_is_refused_before_it_ever_becomes_an_argument_of_gh', async () => {
    const port = await RunningApi.listening()

    const refused = await Promise.all(
      [
        '{"id":"ABC-123","repo":"name"}',
        '{"id":"ABC-123","repo":"owner/name/extra"}',
        '{"id":"ABC-123","repo":"-o/name"}',
        '{"id":"ABC-123","repo":"owner/../../etc"}',
        '{"id":"ABC-123","repo":"owner/name rm -rf"}',
        '{"id":"ABC-123","repo":""}',
        '{"id":"ABC-123","repo":123}',
      ].map((body) => RunningApi.startPlan(port, body))
    )

    expect(refused.map((response) => response.status)).toEqual(Array(7).fill(400))
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_body_over_the_cap_is_refused_instead_of_being_buffered_whole', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.startPlan(port, `{"id":"${'A'.repeat(9000)}","repo":"owner/name"}`)

    expect(response.status).toBe(413)
  })

  it('the_route_is_one_exact_name_and_not_the_thousand_aliases_a_case_blind_router_answers_to', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.post(port, '/START-PLAN', `{"id":"${RunningApi.STORY}"}`)

    expect(response.status).toBe(404)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('a_compressed_body_is_not_a_shape_this_api_agreed_to_accept_and_never_reaches_the_domain_inflated', async () => {
    const port = await RunningApi.listening()

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: gzipSync(Buffer.from(`{"id":"${RunningApi.STORY}"}`)),
    })

    expect(response.status).toBe(400)
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('the_cap_counts_the_bytes_the_client_sent_so_a_refusal_never_names_a_size_nobody_wrote', async () => {
    const port = await RunningApi.listening()
    const squeezed = gzipSync(Buffer.from(`{"id":"${'A'.repeat(20000)}"}`))

    const response = await fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
      body: squeezed,
    })

    expect(squeezed.length).toBeLessThan(8 * 1024)
    expect(response.status).not.toBe(413)
  })

  it('a_body_that_arrives_with_no_length_is_judged_by_the_domain_instead_of_blamed_on_its_media_type', async () => {
    const port = await RunningApi.listening()

    const said = await RunningApi.ask(port, RunningApi.asking('/start-plan', ['Content-Type: application/json']))

    expect(said).toContain('400')
  })

  it('the_trace_of_a_failure_names_the_url_the_client_asked_for_and_not_the_one_routing_rewrote', async () => {
    const server = new ApiServer({ port: 0, startPlan: StartPlanSpy.buggy(), implementPlan: null })
    const port = await server.start()
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    try {
      await RunningApi.post(port, '/start-plan//', RunningApi.ACCEPTED_BODY)

      expect(complaining.mock.calls.map(([line]) => line).join('')).toContain('request to /start-plan// failed')
    } finally {
      complaining.mockRestore()
      await server.stop()
    }
  })

  it('a_path_that_climbs_out_and_back_in_is_not_the_route_however_a_client_writes_it', async () => {
    const port = await RunningApi.listening()
    const body = `{"id":"${RunningApi.STORY}"}`

    const climbed = await RunningApi.ask(
      port,
      RunningApi.asking('/foo/../start-plan', ['Content-Type: application/json'], body)
    )

    expect(climbed).toContain('404')
    expect(RunningApi.spy.asked).toEqual([])
  })

  it('the_answer_does_not_advertise_the_stack_that_serves_it', async () => {
    const port = await RunningApi.listening()

    const response = await RunningApi.accepted(port)

    expect(response.headers.get('x-powered-by')).toBe(null)
  })

  it('stop_closes_the_socket_so_a_later_request_cannot_reach_a_server_believed_dead', async () => {
    const server = new ApiServer({ port: 0, startPlan: new StartPlanSpy(), implementPlan: null })
    const port = await server.start()

    await server.stop()

    await expect(RunningApi.accepted(port)).rejects.toThrow()
  })

  it('an_error_after_a_successful_listen_is_not_swallowed_by_the_promise_that_already_resolved', async () => {
    const server = new ApiServer({ port: 0, startPlan: new StartPlanSpy(), implementPlan: null })
    await server.start()

    try {
      expect(() => server.server.emit('error', new Error('boom'))).toThrow('boom')
    } finally {
      await server.stop()
    }
  })

  it('starting_twice_is_refused_instead_of_leaking_the_first_server_out_of_reach', async () => {
    const server = new ApiServer({ port: 0, startPlan: new StartPlanSpy(), implementPlan: null })
    await server.start()

    try {
      await expect(server.start()).rejects.toThrow(/already listening/)
    } finally {
      await server.stop()
    }
  })

  it('a_plan_events_request_for_an_issue_nobody_started_is_a_404_instead_of_an_open_stream', async () => {
    const { planEvents } = ProgressSpy.events(PlanState.READY)
    const port = await RunningApi.listening({ planEvents })

    const response = await fetch(`http://127.0.0.1:${port}/plan-events/404`)

    expect(response.status).toBe(404)
    expect(await response.text()).toBe(`{"error":"${EventsRefusal.NOT_WATCHED}"}`)
  })

  it('an_issue_that_is_not_a_number_is_a_400_the_caller_can_fix_and_not_a_404_for_a_lookup_of_nan', async () => {
    const { spy, planEvents } = ProgressSpy.events(PlanState.READY)
    const port = await RunningApi.listening({ planEvents })

    const response = await fetch(`http://127.0.0.1:${port}/plan-events/abc`)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"the issue to watch is a number such as 42"}')
    expect(spy.asked).toBe(0)
  })

  it('a_plan_that_started_is_remembered_so_the_page_can_watch_it_by_the_issue_it_opened', async () => {
    const { planEvents } = ProgressSpy.events(PlanState.READY)
    const port = await RunningApi.listening({ planEvents })

    await RunningApi.accepted(port)
    const response = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe(PlanEvents.frameFor(PlanState.READY))
    expect(response.headers.get('access-control-allow-origin')).toBe(null)
  })

  it('a_second_subscription_after_ready_is_a_404_so_an_event_source_gives_up_instead_of_reconnecting_forever', async () => {
    const { planEvents } = ProgressSpy.events(PlanState.READY)
    const port = await RunningApi.listening({ planEvents })

    await RunningApi.accepted(port)
    await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`)
    const again = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`)

    expect(again.status).toBe(404)
    expect(await again.text()).toBe(`{"error":"${EventsRefusal.NOT_WATCHED}"}`)
  })

  it('a_subscription_after_a_progress_nobody_could_read_is_a_404_too_because_that_ending_is_final_as_well', async () => {
    const { planEvents } = ProgressSpy.unable()
    const port = await RunningApi.listening({ planEvents })

    await RunningApi.accepted(port)
    await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`)
    const again = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`)

    expect(again.status).toBe(404)
  })

  it('a_page_that_hangs_up_while_the_plan_is_still_being_written_keeps_its_watch_so_it_can_come_back', async () => {
    const { planEvents } = ProgressSpy.events(PlanState.WRITING, { sleepMs: 5 })
    const port = await RunningApi.listening({ planEvents })

    await RunningApi.accepted(port)
    const controller = new AbortController()
    const opened = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`, {
      signal: controller.signal,
    })
    await opened.body.getReader().read()
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 30))

    const again = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`, {
      signal: AbortSignal.timeout(50),
    }).catch((cause) => cause)

    expect(again.status ?? 200).toBe(200)
  })

  it('the_events_route_turns_away_a_foreign_page_exactly_like_the_one_that_starts_a_plan', async () => {
    const { spy, planEvents } = ProgressSpy.events(PlanState.READY)
    const port = await RunningApi.listening({ planEvents })

    await RunningApi.accepted(port)
    const response = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`, {
      headers: { Origin: 'https://evil.example' },
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('{"error":"this api only serves the page it hosts"}')
    expect(spy.asked).toBe(0)
  })

  it('a_progress_nobody_could_read_reaches_the_page_as_an_error_frame_and_closes_instead_of_hanging_open', async () => {
    const { spy, planEvents } = ProgressSpy.unable()
    const port = await RunningApi.listening({ planEvents })

    await RunningApi.accepted(port)
    const response = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`, {
      headers: { Origin: `http://127.0.0.1:${port}` },
    })

    expect(response.status).toBe(200)
    expect(await response.text())
      .toBe(`event: error\ndata: {"error":"${ProgressSpy.UNREADABLE}"}\n\n`)
    expect(spy.asked).toBe(1)
  })

  it('closing_the_connection_from_the_client_stops_the_progress_port_from_being_asked_again', async () => {
    const { spy, planEvents } = ProgressSpy.events(PlanState.WRITING, { sleepMs: 5 })
    const port = await RunningApi.listening({ planEvents })

    await RunningApi.accepted(port)
    const controller = new AbortController()
    const opened = await fetch(`http://127.0.0.1:${port}/plan-events/${StartPlanSpy.ISSUE.number}`, {
      signal: controller.signal,
    })
    await opened.body.getReader().read()
    controller.abort()

    await new Promise((resolve) => setTimeout(resolve, 30))
    const askedRightAfterAbort = spy.asked
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(askedRightAfterAbort).toBeGreaterThan(0)
    expect(spy.asked).toBe(askedRightAfterAbort)
  })
})
