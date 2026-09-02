import { Answer } from './http.js'
import { PlanState } from '../domain/value-objects/plan-state.js'
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
      if (read.state === PlanState.READY) return
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
  static NOT_WATCHED = 'no plan was started for that issue'
  static #HEADERS = Object.freeze({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  static #ignore() {}

  static handledBy(sessions, events) {
    return async (request, response) => {
      const watched = sessions.watching(Number(request.params.issue))
      if (watched === null) {
        Answer.refuse(response, 404, PlanEventsRoute.NOT_WATCHED)
        return
      }
      const disconnected = Disconnection.watch(request)
      response.on('error', PlanEventsRoute.#ignore)
      response.writeHead(200, PlanEventsRoute.#HEADERS)
      for await (const frame of events.stream(watched, disconnected)) {
        response.write(frame)
      }
      response.end()
    }
  }
}
