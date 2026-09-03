import { isAbsolute, join } from 'node:path'
import { BigQueryTable } from '../../../plugin/scripts/bigquery-load.js'

export const InvocationOutcome = Object.freeze({
  READY: 'ready',
  UNEXPECTED_ARGUMENT: 'unexpected-argument',
  MALFORMED_PORT: 'malformed-port',
  UNKNOWN_STATE_HOME: 'unknown-state-home',
  MALFORMED_HARVEST_TABLE: 'malformed-harvest-table',
})

export class Invocation {
  static DEFAULT_PORT = 8787
  static PORT_VARIABLE = 'CT_API_PORT'
  static CONFIG_VARIABLE = 'CLAUDE_CONFIG_DIR'
  static STATE_DIRECTORY = 'control-tower'
  static DEFAULT_CONFIG_DIRECTORY = '.claude'
  static HOME_VARIABLE = 'HOME'
  static CLAIM_PREFIX = 'CT_CLAIM_'
  static CHILD_TIMEOUT_VARIABLE = 'CT_CLAIM_CHILD_TIMEOUT_MS'
  static HARVEST_TABLE_VARIABLE = 'CT_HARVEST_BQ_TABLE'
  static #MAX_PORT = 65535
  static #WHOLE_NUMBER = /^\d+$/

  constructor({ outcome, port, stateRoot, harvestTable, reason }) {
    if (!Object.values(InvocationOutcome).includes(outcome)) {
      throw new Error(`outcome must be an InvocationOutcome member, got ${outcome}`)
    }
    if ((outcome === InvocationOutcome.READY) === (reason === null)) {
      this.outcome = outcome
      this.port = port
      this.stateRoot = stateRoot
      this.harvestTable = harvestTable
      this.reason = reason
      Object.freeze(this)
      return
    }
    throw new Error(`outcome ${outcome} disagrees with its reason, got ${JSON.stringify(reason)}`)
  }

  static #refused(outcome, reason) {
    return new Invocation({ outcome, port: null, stateRoot: null, harvestTable: null, reason })
  }

  static #ready(port, stateRoot, harvestTable) {
    return new Invocation({ outcome: InvocationOutcome.READY, port, stateRoot, harvestTable, reason: null })
  }

  static configuredIn(environment, home) {
    const asked = environment[Invocation.CONFIG_VARIABLE]

    return asked === undefined || asked === ''
      ? join(home, Invocation.DEFAULT_CONFIG_DIRECTORY)
      : asked
  }

  static stateRootIn(environment, home) {
    const configured = Invocation.configuredIn(environment, home)

    return isAbsolute(configured) ? join(configured, Invocation.STATE_DIRECTORY) : null
  }

  static #port(environment) {
    const given = environment[Invocation.PORT_VARIABLE]
    if (given === undefined) return Invocation.DEFAULT_PORT
    if (!Invocation.#WHOLE_NUMBER.test(given) || Number(given) > Invocation.#MAX_PORT) return null

    return Number(given)
  }

  static harvestEnvironment(environment, { ghTimeoutMs }) {
    const inherited = Object.entries(environment)
      .filter(([named]) => !named.startsWith(Invocation.CLAIM_PREFIX))

    return {
      ...Object.fromEntries(inherited),
      [Invocation.CHILD_TIMEOUT_VARIABLE]: String(ghTimeoutMs),
    }
  }

  static from(argv, environment, home) {
    if (argv.length > 0) {
      return Invocation.#refused(
        InvocationOutcome.UNEXPECTED_ARGUMENT,
        `unexpected argument: ${JSON.stringify(argv[0])}`
      )
    }
    const port = Invocation.#port(environment)
    if (port === null) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_PORT,
        `${Invocation.PORT_VARIABLE} must be an integer between 0 and ${Invocation.#MAX_PORT}, got ${JSON.stringify(environment[Invocation.PORT_VARIABLE])}`
      )
    }
    const stateRoot = Invocation.stateRootIn(environment, home)
    if (stateRoot === null) {
      return Invocation.#refused(
        InvocationOutcome.UNKNOWN_STATE_HOME,
        `the home directory of whoever runs this could not be resolved, so there is no absolute path for the state Control Tower shares with its plugin: set ${Invocation.HOME_VARIABLE}, or ${Invocation.CONFIG_VARIABLE} to an absolute path`
      )
    }
    const given = environment[Invocation.HARVEST_TABLE_VARIABLE]
    if (given === undefined || given === '') {
      return Invocation.#ready(port, stateRoot, null)
    }
    const harvestTable = BigQueryTable.parse(given)
    if (harvestTable === null) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_HARVEST_TABLE,
        `${Invocation.HARVEST_TABLE_VARIABLE} must look like project:dataset.table, got ${JSON.stringify(given)}`
      )
    }

    return Invocation.#ready(port, stateRoot, harvestTable)
  }
}
