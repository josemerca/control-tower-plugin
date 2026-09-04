import express from 'express'

export class Refusal {
  constructor({ status, error }) {
    this.status = status
    this.error = error
    Object.freeze(this)
  }
}

export class Answer {
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

export class Route {
  static #TRAILING_SLASHES = /\/+$/

  static collapseTrailingSlashes(request, response, next) {
    const asked = request.url.indexOf('?')
    const path = asked === -1 ? request.url : request.url.slice(0, asked)
    const query = asked === -1 ? '' : request.url.slice(asked)
    request.url = `${path.replace(Route.#TRAILING_SLASHES, '') || '/'}${query}`

    next()
  }
}

export class Browsers {
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

export class JsonBody {
  static MAX_BYTES = 8 * 1024
  static #OVERFLOW = 'entity.too.large'

  static isOverflow(cause) {
    return cause.type === JsonBody.#OVERFLOW
  }

  static overflowRefusal() {
    return new Refusal({ status: 413, error: `body must not exceed ${JsonBody.MAX_BYTES} bytes` })
  }

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
