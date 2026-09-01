export const InvocationOutcome = Object.freeze({
  READY: 'ready',
  UNEXPECTED_ARGUMENT: 'unexpected-argument',
  MALFORMED_PORT: 'malformed-port',
})

export class Invocation {
  static DEFAULT_PORT = 8787
  static PORT_VARIABLE = 'CT_API_PORT'
  static #MAX_PORT = 65535
  static #WHOLE_NUMBER = /^\d+$/

  constructor({ outcome, port, reason }) {
    if (!Object.values(InvocationOutcome).includes(outcome)) {
      throw new Error(`outcome must be an InvocationOutcome member, got ${outcome}`)
    }
    if ((outcome === InvocationOutcome.READY) === (reason === null)) {
      this.outcome = outcome
      this.port = port
      this.reason = reason
      Object.freeze(this)
      return
    }
    throw new Error(`outcome ${outcome} disagrees with its reason, got ${JSON.stringify(reason)}`)
  }

  static #refused(outcome, reason) {
    return new Invocation({ outcome, port: null, reason })
  }

  static from(argv, environment) {
    if (argv.length > 0) {
      return Invocation.#refused(
        InvocationOutcome.UNEXPECTED_ARGUMENT,
        `unexpected argument: ${JSON.stringify(argv[0])}`
      )
    }
    const given = environment[Invocation.PORT_VARIABLE]
    if (given === undefined) {
      return new Invocation({ outcome: InvocationOutcome.READY, port: Invocation.DEFAULT_PORT, reason: null })
    }
    if (!Invocation.#WHOLE_NUMBER.test(given) || Number(given) > Invocation.#MAX_PORT) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_PORT,
        `${Invocation.PORT_VARIABLE} must be an integer between 0 and ${Invocation.#MAX_PORT}, got ${JSON.stringify(given)}`
      )
    }
    return new Invocation({ outcome: InvocationOutcome.READY, port: Number(given), reason: null })
  }
}
