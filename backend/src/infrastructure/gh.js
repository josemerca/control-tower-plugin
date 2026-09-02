import { ExternalTool } from './external-tool.js'

export class Gh extends ExternalTool {
  static BIN = 'gh'

  static #ALSO_TRANSIENT = [
    'no server is currently available to service your request',
    'error connecting to',
  ]

  static #MISSING_LABEL = /'(.+?)' not found/

  isTransient(stderr) {
    const lowered = String(stderr).toLowerCase()

    return super.isTransient(stderr) ||
      Gh.#ALSO_TRANSIENT.some((marker) => lowered.includes(marker))
  }

  static labelMissingIn(stderr) {
    const found = String(stderr).match(Gh.#MISSING_LABEL)

    return found === null ? null : found[1]
  }
}
