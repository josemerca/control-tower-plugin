export class GhFailure {
  static #MARKERS = [
    'connection reset',
    'connection refused',
    'tls handshake',
    'i/o timeout',
    'context deadline exceeded',
    'unexpected eof',
    'unexpected end of json input',
    'temporary failure in name resolution',
    'dial tcp',
    'no such host',
    'network is unreachable',
    'secondary rate limit',
    'api rate limit exceeded',
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'no server is currently available to service your request',
    'error connecting to',
  ]

  static #SERVER_STATUS = /http 5\d\d/

  static #MISSING_LABEL = /'(.+?)' not found/

  static isTransient(stderr) {
    const lowered = String(stderr).toLowerCase()

    return GhFailure.#MARKERS.some((marker) => lowered.includes(marker)) ||
      GhFailure.#SERVER_STATUS.test(lowered)
  }

  static labelMissingIn(stderr) {
    const found = String(stderr).match(GhFailure.#MISSING_LABEL)

    return found === null ? null : found[1]
  }
}
