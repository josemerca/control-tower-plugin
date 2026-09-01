export class TicketKey {
  static #SHAPE = /^[A-Z][A-Z0-9_]*-\d+$/
  static EXAMPLE = 'ABC-123'

  constructor(text) {
    if (!TicketKey.isWellFormed(text)) {
      throw new Error(`a ticket key looks like ${TicketKey.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text
    Object.freeze(this)
  }

  static isWellFormed(text) {
    return typeof text === 'string' && TicketKey.#SHAPE.test(text)
  }

  toString() {
    return this.text
  }
}
