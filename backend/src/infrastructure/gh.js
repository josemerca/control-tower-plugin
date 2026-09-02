export class Gh {
  static BIN = 'gh'

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
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'no server is currently available to service your request',
    'error connecting to',
  ]

  static #SERVER_STATUS = /http 5\d\d/

  static #MISSING_LABEL = /'(.+?)' not found/

  constructor({ launch, policy, clock }) {
    this.launch = launch
    this.policy = policy
    this.clock = clock
  }

  async run(argv, { safeToRepeat }) {
    let output = await this.launch(argv)
    let attempted = 0
    while (output.failed) {
      const decision = this.policy.afterAFailure({
        transient: Gh.isTransient(output.stderr),
        safeToRepeat,
        attempted,
      })
      if (!decision.retry) break

      await this.clock.sleep(decision.waitSeconds)
      output = await this.launch(argv)
      attempted += 1
    }

    return output
  }

  static isTransient(stderr) {
    const lowered = String(stderr).toLowerCase()

    return Gh.#MARKERS.some((marker) => lowered.includes(marker)) || Gh.#SERVER_STATUS.test(lowered)
  }

  static labelMissingIn(stderr) {
    const found = String(stderr).match(Gh.#MISSING_LABEL)

    return found === null ? null : found[1]
  }
}
