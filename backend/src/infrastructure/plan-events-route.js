import { Answer, Refusal } from './http.js'
import { PlanProgressFailure } from '../domain/exceptions.js'

export class PlanSessions {
  constructor() {
    this.live = new Map()
  }

  remember(watch) {
    this.live.set(watch.issue.number, watch)
  }

  watching(number) {
    return this.live.get(number) ?? null
  }

  forget(number) {
    this.live.delete(number)
  }
}

export const EventsRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  MALFORMED_ISSUE: 'malformed-issue',
  NOT_WATCHED: 'not-watched',
})

export class EventsRequest {
  static EXAMPLE = 42
  static #NUMBERED = /^[1-9][0-9]*$/

  constructor({ outcome, watched }) {
    if (!Object.values(EventsRequestOutcome).includes(outcome)) {
      throw new Error(`outcome must be an EventsRequestOutcome member, got ${outcome}`)
    }
    if ((outcome === EventsRequestOutcome.ACCEPTED) === (watched === null)) {
      throw new Error(`outcome ${outcome} disagrees with its watch, got ${watched}`)
    }
    this.outcome = outcome
    this.watched = watched
    Object.freeze(this)
  }

  static accepted(watched) {
    return new EventsRequest({ outcome: EventsRequestOutcome.ACCEPTED, watched })
  }

  static refused(outcome) {
    return new EventsRequest({ outcome, watched: null })
  }

  static from(rawIssue, sessions) {
    if (typeof rawIssue !== 'string' || !EventsRequest.#NUMBERED.test(rawIssue)) {
      return EventsRequest.refused(EventsRequestOutcome.MALFORMED_ISSUE)
    }
    const watched = sessions.watching(Number(rawIssue))
    if (watched === null) {
      return EventsRequest.refused(EventsRequestOutcome.NOT_WATCHED)
    }

    return EventsRequest.accepted(watched)
  }
}

export class EventsRefusal {
  static NOT_WATCHED = 'no plan was started for that issue'
  static #BY_OUTCOME = Object.freeze({
    [EventsRequestOutcome.MALFORMED_ISSUE]: () => new Refusal({
      status: 400,
      error: `the issue to watch is a number such as ${EventsRequest.EXAMPLE}`,
    }),
    [EventsRequestOutcome.NOT_WATCHED]: () =>
      new Refusal({ status: 404, error: EventsRefusal.NOT_WATCHED }),
  })

  static of(asked) {
    const declared = EventsRefusal.#BY_OUTCOME[asked.outcome]
    if (declared === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }

    return declared(asked)
  }

  static declaredOutcomes() {
    return Object.keys(EventsRefusal.#BY_OUTCOME)
  }
}

export class PlanEvents {
  constructor({ read, sleep }) {
    this.read = read
    this.sleep = sleep
  }

  static ERROR_EVENT = 'error'

  static frameFor(state) {
    return `data: ${JSON.stringify({ state })}\n\n`
  }

  static failureFrameFor(cause) {
    return `event: ${PlanEvents.ERROR_EVENT}\ndata: ${JSON.stringify({ error: cause.message })}\n\n`
  }

  async *stream(session, cancelled = () => false) {
    let last = null
    for (;;) {
      let read
      try {
        read = await this.read(session)
      } catch (cause) {
        if (!(cause instanceof PlanProgressFailure)) throw cause
        yield PlanEvents.failureFrameFor(cause)
        return
      }
      if (read.state !== last) {
        last = read.state
        yield PlanEvents.frameFor(read.state)
      }
      await this.sleep()
      if (cancelled()) return
    }
  }
}

class Disconnection {
  static watch(request) {
    let happened = false
    request.on('close', () => {
      happened = true
    })

    return () => happened
  }
}

export class PlanEventsRoute {
  static PATH = '/plan-events/:issue'
  static METHOD = 'GET'
  static #HEADERS = Object.freeze({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  static #ignore() {}

  static handledBy(sessions, events) {
    return async (request, response) => {
      const asked = EventsRequest.from(request.params.issue, sessions)
      if (asked.outcome !== EventsRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, EventsRefusal.of(asked))
        return
      }
      const disconnected = Disconnection.watch(request)
      response.on('error', PlanEventsRoute.#ignore)
      response.writeHead(200, PlanEventsRoute.#HEADERS)
      for await (const frame of events.stream(asked.watched, disconnected)) {
        response.write(frame)
      }
      if (!disconnected()) sessions.forget(asked.watched.issue.number)
      response.end()
    }
  }
}
