import { describe, it, expect } from 'vitest'
import { PlanEvents, PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { PlanState } from '../../src/domain/value-objects/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { PlanProgressNotRead } from '../../src/domain/exceptions.js'

class EventsDouble {
  static SUBJECT = new PlanWatch({
    issue: new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' }),
    located: new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' }),
    repository: new RepositoryName('owner/name'),
  })

  constructor(answers) {
    this.answers = [...answers]
    this.slept = 0
  }

  static unable(said) {
    return new EventsDouble([new PlanProgressNotRead(said)])
  }

  events() {
    return new PlanEvents({
      sleep: () => {
        this.slept += 1
        return Promise.resolve()
      },
      read: () => {
        if (this.answers.length === 0) {
          throw new Error('the progress was read more times than this test scripted an answer for')
        }

        const answer = this.answers.shift()
        if (answer instanceof Error) return Promise.reject(answer)

        return Promise.resolve({ state: answer })
      },
    })
  }

  async collected(cancelled) {
    const frames = []
    for await (const frame of this.events().stream(EventsDouble.SUBJECT, cancelled)) frames.push(frame)

    return frames
  }
}

class Watched {
  static sessions() {
    const sessions = new PlanSessions()
    sessions.remember(EventsDouble.SUBJECT)

    return sessions
  }
}

describe('PlanSessions', () => {
  it('what_it_hands_back_is_the_whole_watch_so_the_flow_cannot_lose_the_repository_on_the_way', () => {
    expect(Watched.sessions().watching(42)).toBe(EventsDouble.SUBJECT)
  })

  it('an_issue_nobody_started_a_plan_for_is_answered_with_nothing_instead_of_an_empty_watch', () => {
    expect(new PlanSessions().watching(404)).toBe(null)
  })

  it('a_watch_it_was_told_to_forget_is_answered_with_nothing_the_same_as_one_that_never_started', () => {
    const sessions = Watched.sessions()

    sessions.forget(42)

    expect(sessions.watching(42)).toBe(null)
  })
})

describe('PlanEvents', () => {
  it('a_frame_is_the_server_sent_event_a_browser_can_parse', () => {
    expect(PlanEvents.frameFor(PlanState.READY)).toBe('data: {"state":"ready"}\n\n')
  })

  it('it_emits_the_first_state_it_reads_so_a_late_subscriber_is_not_left_blank', async () => {
    const events = new EventsDouble([PlanState.WRITING, PlanState.READY])

    expect((await events.collected())[0]).toBe(PlanEvents.frameFor(PlanState.WRITING))
  })

  it('it_stops_after_ready_because_there_is_nothing_left_to_watch', async () => {
    const frames = await new EventsDouble([PlanState.WRITING, PlanState.READY]).collected()

    expect(frames).toEqual([
      PlanEvents.frameFor(PlanState.WRITING),
      PlanEvents.frameFor(PlanState.READY),
    ])
  })

  it('a_state_that_did_not_change_is_not_repeated_down_the_wire', async () => {
    const frames = await new EventsDouble([
      PlanState.WRITING, PlanState.WRITING, PlanState.WRITING, PlanState.READY,
    ]).collected()

    expect(frames).toEqual([
      PlanEvents.frameFor(PlanState.WRITING),
      PlanEvents.frameFor(PlanState.READY),
    ])
  })

  it('it_waits_between_reads_instead_of_spinning', async () => {
    const events = new EventsDouble([PlanState.WRITING, PlanState.WRITING, PlanState.READY])

    await events.collected()

    expect(events.slept).toBe(2)
  })

  it('every_plan_state_says_whether_it_ends_the_watch_so_a_third_one_cannot_arrive_as_writing', () => {
    expect(PlanEvents.declaredStates().sort()).toEqual(PlanState.declared().sort())
  })

  it('a_plan_state_nobody_declared_an_ending_for_raises_instead_of_being_polled_forever_as_if_unfinished', async () => {
    const events = new EventsDouble(['stalled'])

    await expect(events.collected()).rejects.toThrow(/no ending declared for plan state stalled/)
  })

  it('a_progress_that_could_not_be_read_reaches_the_page_as_one_error_frame_and_not_as_a_state', async () => {
    const frames = await EventsDouble.unable('git status refused').collected()

    expect(frames).toEqual(['event: error\ndata: {"error":"git status refused"}\n\n'])
  })

  it('a_progress_that_could_not_be_read_ends_the_stream_instead_of_launching_two_subprocesses_forever', async () => {
    const events = new EventsDouble([
      PlanState.WRITING, new PlanProgressNotRead('git status refused'),
    ])

    const frames = await events.collected()

    expect(frames).toHaveLength(2)
    expect(events.answers).toEqual([])
  })

  it('a_bug_of_ours_is_not_dressed_up_as_an_error_frame_because_nobody_could_act_on_it', async () => {
    const events = new EventsDouble([new TypeError('a bug of ours')])

    await expect(events.collected()).rejects.toThrow(/a bug of ours/)
  })

  it('a_cancel_signal_stops_the_generator_that_would_otherwise_spin_forever_on_an_unchanging_state', async () => {
    const events = new EventsDouble(Array(50).fill(PlanState.WRITING))
    let asked = 0
    const cancelled = () => {
      asked += 1
      return asked >= 2
    }

    const frames = await events.collected(cancelled)

    expect(frames).toEqual([PlanEvents.frameFor(PlanState.WRITING)])
    expect(events.slept).toBe(2)
  })
})
