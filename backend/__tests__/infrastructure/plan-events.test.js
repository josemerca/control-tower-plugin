import { describe, it, expect } from 'vitest'
import { PlanEvents } from '../../src/infrastructure/plan-events.js'
import { PlanState } from '../../src/domain/plan-state.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'

class EventsDouble {
  static SUBJECT = {
    located: new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' }),
    issue: { number: 42 },
  }

  constructor(answers) {
    this.answers = [...answers]
    this.slept = 0
  }

  events() {
    return new PlanEvents({
      sleep: () => {
        this.slept += 1
        return Promise.resolve()
      },
      read: () => Promise.resolve({ state: this.answers.shift() ?? PlanState.READY }),
    })
  }

  async collected(cancelled) {
    const frames = []
    for await (const frame of this.events().stream(EventsDouble.SUBJECT, cancelled)) frames.push(frame)

    return frames
  }
}

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
