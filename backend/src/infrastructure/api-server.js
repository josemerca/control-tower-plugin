import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { PlanRequest, PlanRequestOutcome } from './plan-request.js'
import { PlanRefusal } from './plan-refusal.js'
import { StartPlanParams } from '../application/actions/start-plan.js'
import { PlanSessionFailure } from '../domain/exceptions.js'

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
  static #HOST = 'Host'
  static LOOPBACK_NAMES = Object.freeze(['127.0.0.1', 'localhost', '[::1]'])

  static #hostnameOf(host) {
    return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  }

  static isOurOwnPage(origin, host) {
    if (typeof host !== 'string' || !Browsers.LOOPBACK_NAMES.includes(Browsers.#hostnameOf(host))) return false

    return origin === `http://${host}`
  }

  static turnAwayForeign(request, response, next) {
    const origin = request.get(Browsers.#ORIGIN)
    if (origin === undefined || Browsers.isOurOwnPage(origin, request.get(Browsers.#HOST))) {
      next()
      return
    }
    Answer.refuse(response, 403, 'this api only serves the page it hosts')
  }
}

class FrontendPages {
  static mountedOn(app, root) {
    if (root === null || !existsSync(root)) return
    app.use(express.static(root, { index: 'index.html', redirect: false, fallthrough: true }))
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

  static handledBy(startPlan) {
    return async (request, response) => {
      const asked = PlanRequest.from(JsonBody.textOf(request))
      if (asked.outcome !== PlanRequestOutcome.ACCEPTED) {
        Answer.refuseAs(response, PlanRefusal.of(asked))
        return
      }
      await StartPlanRoute.#accept(startPlan, response, asked.ticket)
    }
  }

  static async #accept(startPlan, response, ticket) {
    let started
    try {
      started = await startPlan.execute(new StartPlanParams({ ticket }))
    } catch (cause) {
      if (!(cause instanceof PlanSessionFailure)) throw cause
      Answer.refuse(response, 503, `could not start the plan session: ${cause.message}`)
      return
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
  constructor({ port, startPlan, frontendRoot = null }) {
    this.requestedPort = port
    this.startPlan = startPlan
    this.frontendRoot = frontendRoot
    this.server = null
  }

  #route() {
    const app = express()
    app.disable('x-powered-by')
    app.set('case sensitive routing', true)
    app.use(Route.collapseTrailingSlashes)
    FrontendPages.mountedOn(app, this.frontendRoot)
    app.post(
      StartPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      StartPlanRoute.handledBy(this.startPlan)
    )
    app.all(StartPlanRoute.PATH, StartPlanRoute.refuseOtherMethods)
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
