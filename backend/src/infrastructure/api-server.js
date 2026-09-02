import express from 'express'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { Answer, Route, Browsers, JsonBody } from './http.js'
import { StartPlanRoute } from './start-plan-route.js'
import { ImplementPlanRoute } from './implement-plan-route.js'
import { PlanEventsRoute, PlanSessions } from './plan-events-route.js'

export const LOOPBACK = '127.0.0.1'
class FrontendPages {
  static mountedOn(app, root) {
    if (root === null || !existsSync(root)) return
    app.use(express.static(root, { index: 'index.html', redirect: false, fallthrough: true }))
  }
}
class Failures {
  static nothingMatched(request, response) {
    Answer.refuse(response, 404, 'not found')
  }

  static answer(cause, request, response, next) {
    if (JsonBody.isOverflow(cause)) {
      Answer.refuseAs(response, JsonBody.overflowRefusal())
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
  constructor({
    port, startPlan, implementPlan, planEvents = null, sessions = new PlanSessions(), frontendRoot = null,
  }) {
    this.requestedPort = port
    this.startPlan = startPlan
    this.implementPlan = implementPlan
    this.planEvents = planEvents
    this.sessions = sessions
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
      StartPlanRoute.handledBy(this.startPlan, this.sessions)
    )
    app.all(StartPlanRoute.PATH, StartPlanRoute.refuseOtherMethods)
    app.post(
      ImplementPlanRoute.PATH,
      Browsers.turnAwayForeign,
      JsonBody.demandDeclared,
      JsonBody.reader(),
      ImplementPlanRoute.handledBy(this.implementPlan)
    )
    app.all(ImplementPlanRoute.PATH, ImplementPlanRoute.refuseOtherMethods)
    app.get(
      PlanEventsRoute.PATH,
      Browsers.turnAwayForeign,
      PlanEventsRoute.handledBy(this.sessions, this.planEvents)
    )
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
