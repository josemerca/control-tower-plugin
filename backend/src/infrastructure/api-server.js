import express from 'express'
import { createServer } from 'node:http'
import { PlanRequest, PlanRequestOutcome } from './plan-request.js'
import { PlanRefusal } from './plan-refusal.js'
import { StartPlanParams } from '../application/actions/start-plan.js'
import { PlanSessionFailure, WorkspaceFailure } from '../domain/exceptions.js'

export const LOOPBACK = '127.0.0.1'

class Answer {
  static JSON_MEDIA_TYPE = 'application/json'

  static send(response, status, payload) {
    response.setHeader('Content-Type', Answer.JSON_MEDIA_TYPE)
    response.status(status).end(JSON.stringify(payload))
  }

  static refuse(response, status, error) {
    Answer.send(response, status, { error })
  }

  static refuseAs(response, refusal) {
    Answer.refuse(response, refusal.status, refusal.error)
  }
}

class Route {
  static #TRAILING_SLASHES = /\/+$/

  static collapseTrailingSlashes(request, response, next) {
    const asked = request.url.indexOf('?')
    const path = asked === -1 ? request.url : request.url.slice(0, asked)
    const query = asked === -1 ? '' : request.url.slice(asked)
    request.url = `${path.replace(Route.#TRAILING_SLASHES, '') || '/'}${query}`

    next()
  }
}

class Browsers {
  static #ORIGIN = 'Origin'

  static turnAway(request, response, next) {
    if (request.get(Browsers.#ORIGIN) === undefined) {
      next()
      return
    }
    Answer.refuse(response, 403, 'this api does not serve browsers')
  }
}

class JsonBody {
  static MAX_BYTES = 8 * 1024

  static #declaredBy(request) {
    const declared = request.get('Content-Type')

    return typeof declared === 'string' && declared.split(';')[0].trim() === Answer.JSON_MEDIA_TYPE
  }

  static demandDeclared(request, response, next) {
    if (JsonBody.#declaredBy(request)) {
      next()
      return
    }
    Answer.refuse(response, 415, `Content-Type must be ${Answer.JSON_MEDIA_TYPE}`)
  }

  static reader() {
    return express.raw({ type: Answer.JSON_MEDIA_TYPE, limit: JsonBody.MAX_BYTES, inflate: false })
  }

  static textOf(request) {
    return Buffer.isBuffer(request.body) ? request.body.toString('utf8') : ''
  }
}

class StartPlanRoute {
  static PATH = '/start-plan'
  static METHOD = 'POST'

  static handledBy(startPlan, sessions) {
    return async (request, response) => {
      const asked = PlanRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== PlanRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, PlanRefusal.of(asked))
        return
      }
      await StartPlanRoute.#accept(startPlan, sessions, response, asked.ticket)
    }
  }

  static async #accept(startPlan, sessions, response, ticket) {
    let started
    try {
      started = await startPlan.execute(new StartPlanParams({ ticket }))
    } catch (cause) {
      if (!(cause instanceof PlanSessionFailure) && !(cause instanceof WorkspaceFailure)) throw cause
      Answer.refuse(response, 503, `could not start the plan session: ${cause.message}`)
      return
    }
    if (started.issue !== undefined && started.located !== undefined) {
      sessions.set(started.issue.number, { located: started.located, issue: started.issue })
    }
    Answer.send(response, 202, {
      status: 'started',
      [PlanRequest.ID_FIELD]: ticket.text,
      session: started.session,
    })
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', StartPlanRoute.METHOD)
    Answer.refuse(response, 405, 'method not allowed')
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

class PlanEventsRoute {
  static PATH = '/plan-events/:issue'
  static METHOD = 'GET'
  static #HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }

  static #ignore() {}

  static handledBy(sessions, events) {
    return async (request, response) => {
      const watched = sessions.get(Number(request.params.issue))
      if (watched === undefined) {
        Answer.refuse(response, 404, 'no plan session was started for that issue')
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

class Failures {
  static #TOO_LARGE = 'entity.too.large'

  static nothingMatched(request, response) {
    Answer.refuse(response, 404, 'not found')
  }

  static answer(cause, request, response, next) {
    if (cause.type === Failures.#TOO_LARGE) {
      Answer.refuseAs(response, PlanRefusal.of(PlanRequest.tooLarge()))
      return
    }
    if (cause.status === undefined) {
      process.stderr.write(`request to ${request.originalUrl} failed: ${cause.stack ?? cause.message}\n`)
    }
    if (response.headersSent || response.writableEnded) {
      request.destroy()
      response.destroy()
      return
    }
    response.once('finish', () => request.destroy())
    Answer.refuse(response, 400, 'request failed')
  }
}

export class ApiServer {
  constructor({ port, startPlan, sessions, planEvents }) {
    this.requestedPort = port
    this.startPlan = startPlan
    this.sessions = sessions ?? new Map()
    this.planEvents = planEvents
    this.server = null
  }

  #route() {
    const app = express()
    app.disable('x-powered-by')
    app.set('case sensitive routing', true)
    app.use(Route.collapseTrailingSlashes)
    app.post(
      StartPlanRoute.PATH,
      Browsers.turnAway,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      StartPlanRoute.handledBy(this.startPlan, this.sessions)
    )
    app.all(StartPlanRoute.PATH, StartPlanRoute.refuseOtherMethods)
    if (this.planEvents !== undefined) {
      app.get(PlanEventsRoute.PATH, PlanEventsRoute.handledBy(this.sessions, this.planEvents))
    }
    app.use(Failures.nothingMatched)
    app.use(Failures.answer)

    return app
  }

  async start() {
    if (this.server !== null) {
      throw new Error('start() was called on a server that is already listening')
    }
    const server = createServer(this.#route())
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.requestedPort, LOOPBACK, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    this.server = server

    return server.address().port
  }

  async stop() {
    if (this.server === null) return
    const server = this.server
    this.server = null
    await new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
}
