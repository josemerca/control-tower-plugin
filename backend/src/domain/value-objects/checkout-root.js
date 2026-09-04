export class CheckoutRoot {
  static EXAMPLE = '/Users/you/repos/name'

  constructor(text) {
    if (!CheckoutRoot.isWellFormed(text)) {
      throw new Error(`a checkout root is an absolute path such as ${CheckoutRoot.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text
    Object.freeze(this)
  }

  static isWellFormed(text) {
    return typeof text === 'string' && text.startsWith('/')
  }

  toString() {
    return this.text
  }
}
