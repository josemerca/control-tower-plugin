import { ApiServer, LOOPBACK } from './api-server.js'

class CtApi {
  static #DEFAULT_PORT = 8787
  static #MAX_PORT = 65535
  static #PORT_VARIABLE = 'CT_API_PORT'
  static #USAGE = 'usage: ct-api.mjs (no arguments; set CT_API_PORT to pick a port, 0 for an ephemeral one)'
  static #BAD_USAGE = 2
  static #CANNOT_LISTEN = 1

  static #refuseUsage(reason) {
    process.stderr.write(`${reason}\n${CtApi.#USAGE}\n`)
    process.exit(CtApi.#BAD_USAGE)
  }

  static #refuseListen(reason) {
    process.stderr.write(`${reason}\n`)
    process.exit(CtApi.#CANNOT_LISTEN)
  }

  static #portFrom(environment) {
    const given = environment[CtApi.#PORT_VARIABLE]
    if (given === undefined) return CtApi.#DEFAULT_PORT
    if (!/^\d+$/.test(given) || Number(given) > CtApi.#MAX_PORT) {
      CtApi.#refuseUsage(
        `${CtApi.#PORT_VARIABLE} must be an integer between 0 and ${CtApi.#MAX_PORT}, got ${JSON.stringify(given)}`
      )
    }
    return Number(given)
  }

  static async run(argv, environment) {
    if (argv.length > 0) {
      CtApi.#refuseUsage(`unexpected argument: ${JSON.stringify(argv[0])}`)
    }
    const server = new ApiServer({ port: CtApi.#portFrom(environment) })
    let port
    try {
      port = await server.start()
    } catch (error) {
      CtApi.#refuseListen(`could not listen on ${LOOPBACK}: ${error.message}`)
    }
    process.stdout.write(`${JSON.stringify({ port })}\n`)
  }
}

await CtApi.run(process.argv.slice(2), process.env)
