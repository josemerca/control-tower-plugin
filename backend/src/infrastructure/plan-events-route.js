import { Answer } from './http.js'
import { PlanState } from '../domain/value-objects/plan-state.js'

export class PlanSessions {
  constructor() {
    this.live = new Map()
  }

  remember({ issue, located, repository }) {
    this.live.set(issue.number, { issue, located, repository })
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

  static frameFor(state) {
    return `data: ${JSON.stringify({ state })}\n\n`
  }

  async *stream(session, cancelled = () => false) {
    let last = null
    for (;;) {
      const read = await this.read(session)
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
