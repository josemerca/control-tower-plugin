import { createServer } from 'node:http'
import { PlanRequest, PlanRequestOutcome } from './plan-request.js'
import { PlanRefusal } from './plan-refusal.js'

export const LOOPBACK = '127.0.0.1'

export class ApiServer {
  static #START_PLAN_PATH = '/start-plan'
  static #START_PLAN_METHOD = 'POST'
  static #JSON_MEDIA_TYPE = 'application/json'
  static #MAX_BODY_BYTES = 8 * 1024
  static #JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' })

  constructor({ port, planSession }) {
    this.requestedPort = port
    this.planSession = planSession
    this.server = null
  }

  async start() {
    if (this.server !== null) {
      throw new Error('start() was called on a server that is already listening')
    }
    const server = createServer((request, response) => {
      this.#answer(request, response).catch((cause) => this.#collapse(request, response, cause))
    })
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

  async #answer(request, response) {
    if (this.#pathOf(request.url) !== ApiServer.#START_PLAN_PATH) {
      this.#refuse(response, 404, 'not found')
      return
    }
    if (request.method !== ApiServer.#START_PLAN_METHOD) {
      response
        .writeHead(405, { ...ApiServer.#JSON_HEADERS, Allow: ApiServer.#START_PLAN_METHOD })
        .end(JSON.stringify({ error: 'method not allowed' }))
      return
    }
    if (request.headers.origin !== undefined) {
      this.#refuse(response, 403, 'this api does not serve browsers')
      return
    }
    if (!this.#declaresJson(request)) {
      this.#refuse(response, 415, `Content-Type must be ${ApiServer.#JSON_MEDIA_TYPE}`)
      return
    }
    const asked = await this.#read(request)
    if (asked.outcome === PlanRequestOutcome.ACCEPTED) {
      await this.#accept(response, asked.id)
      return
    }
    const refusal = PlanRefusal.of(asked)
    this.#refuse(response, refusal.status, refusal.error)
  }

  async #accept(response, id) {
    let session
    try {
      session = await this.planSession.start(id)
    } catch (cause) {
      this.#refuse(response, 503, `could not start the plan session: ${cause.message}`)
      return
    }
    response
      .writeHead(202, ApiServer.#JSON_HEADERS)
      .end(JSON.stringify({ status: 'started', [PlanRequest.ID_FIELD]: id, session }))
  }

  #declaresJson(request) {
    const declared = request.headers['content-type']
    return typeof declared === 'string' && declared.split(';')[0].trim() === ApiServer.#JSON_MEDIA_TYPE
  }

  #pathOf(url) {
    let pathname
    try {
      ;({ pathname } = new URL(url, `http://${LOOPBACK}`))
    } catch {
      return null
    }
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  }

  async #read(request) {
    const room = Buffer.allocUnsafe(ApiServer.#MAX_BODY_BYTES)
    let filled = 0
    for await (const chunk of request) {
      if (filled + chunk.length > ApiServer.#MAX_BODY_BYTES) {
        return PlanRequest.tooLarge()
      }
      chunk.copy(room, filled)
      filled += chunk.length
    }
    return PlanRequest.from(room.toString('utf8', 0, filled))
  }

  #refuse(response, status, error) {
    response.writeHead(status, ApiServer.#JSON_HEADERS).end(JSON.stringify({ error }))
  }

  #collapse(request, response, cause) {
    request.destroy()
    if (response.headersSent || response.writableEnded) {
      response.destroy()
      return
    }
    this.#refuse(response, 400, 'request failed')
  }
}
