import express from 'express'
import { createServer } from 'node:http'
import { PlanRequest, PlanRequestOutcome } from './plan-request.js'

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

  static demandDeclared(request, response, next) {
    if (request.is(Answer.JSON_MEDIA_TYPE)) {
      next()
      return
    }
    Answer.refuse(response, 415, `Content-Type must be ${Answer.JSON_MEDIA_TYPE}`)
  }

  static reader() {
    return express.raw({ type: Answer.JSON_MEDIA_TYPE, limit: JsonBody.MAX_BYTES })
  }

  static textOf(request) {
    return Buffer.isBuffer(request.body) ? request.body.toString('utf8') : ''
  }
}

class StartPlan {
  static PATH = '/start-plan'
  static METHOD = 'POST'

  static #REFUSALS = Object.freeze({
    [PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT]: { status: 400, error: 'body must be a JSON object' },
    [PlanRequestOutcome.MALFORMED_ID]: { status: 400, error: 'id must be a ticket key such as ABC-123' },
  })

  static accept(request, response) {
    const asked = PlanRequest.from(JsonBody.textOf(request))
    if (asked.outcome === PlanRequestOutcome.ACCEPTED) {
      Answer.send(response, 200, { status: 'ok', [PlanRequest.ID_FIELD]: asked.id })
      return
    }
    if (asked.outcome === PlanRequestOutcome.UNKNOWN_FIELD) {
      Answer.refuse(response, 400, `unknown field: ${asked.fields.join(', ')}`)
      return
    }
    const refusal = StartPlan.#REFUSALS[asked.outcome]
    if (refusal === undefined) {
      throw new Error(`no refusal declared for outcome ${asked.outcome}`)
    }
    Answer.refuse(response, refusal.status, refusal.error)
  }

  static refuseOtherMethods(request, response) {
    response.setHeader('Allow', StartPlan.METHOD)
    Answer.refuse(response, 405, 'method not allowed')
  }
}

class Failures {
  static #TOO_LARGE = 'entity.too.large'

  static nothingMatched(request, response) {
    Answer.refuse(response, 404, 'not found')
  }

  static answer(cause, request, response, next) {
    request.destroy()
    if (response.headersSent || response.writableEnded) {
      response.destroy()
      return
    }
    if (cause.type === Failures.#TOO_LARGE) {
      Answer.refuse(response, 413, `body must not exceed ${JsonBody.MAX_BYTES} bytes`)
      return
    }
    Answer.refuse(response, 400, 'request failed')
  }
}

export class ApiServer {
  constructor({ port }) {
    this.requestedPort = port
    this.server = null
  }

  static #route() {
    const app = express()
    app.disable('x-powered-by')
    app.set('etag', false)
    app.use(Route.collapseTrailingSlashes)
    app.post(
      StartPlan.PATH,
      Browsers.turnAway,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      StartPlan.accept
    )
    app.all(StartPlan.PATH, StartPlan.refuseOtherMethods)
    app.use(Failures.nothingMatched)
    app.use(Failures.answer)
    return app
  }

  async start() {
    if (this.server !== null) {
      throw new Error('start() was called on a server that is already listening')
    }
    const server = createServer(ApiServer.#route())
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
