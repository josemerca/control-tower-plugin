export class ExternalTool {
  static #NETWORK = [
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
  ]

  static #SERVER_STATUS = /http 5\d\d/

  constructor({ launch, policy, sleep }) {
    this.launch = launch
    this.policy = policy
    this.sleep = sleep
  }

  async run(argv, { safeToRepeat }) {
    let output = await this.launch(argv)
    let attempted = 0
    while (output.failed) {
      const decision = this.policy.afterAFailure({
        transient: this.isTransient(output.stderr),
        safeToRepeat,
        attempted,
      })
      if (!decision.retry) break

      await this.sleep(decision.waitSeconds)
      output = await this.launch(argv)
      attempted += 1
    }

    return output
  }

  isTransient(stderr) {
    const lowered = String(stderr).toLowerCase()

    return ExternalTool.#NETWORK.some((marker) => lowered.includes(marker)) ||
      ExternalTool.#SERVER_STATUS.test(lowered)
  }
}
