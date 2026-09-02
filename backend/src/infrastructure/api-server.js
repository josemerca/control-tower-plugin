import express from 'express'
import { createServer } from 'node:http'
import { Answer, Route, Browsers, JsonBody } from './http.js'
import { StartPlanRoute, PlanRequest, PlanRefusal } from './start-plan-route.js'

export const LOOPBACK = '127.0.0.1'

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
  constructor({ port, startPlan }) {
    this.requestedPort = port
    this.startPlan = startPlan
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
