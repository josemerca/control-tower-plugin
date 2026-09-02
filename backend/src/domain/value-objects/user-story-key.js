export class UserStoryKey {
  static #SHAPE = /^[A-Z][A-Z0-9_]*-\d+$/
  static EXAMPLE = 'ABC-123'

  constructor(text) {
    if (!UserStoryKey.isWellFormed(text)) {
      throw new Error(`a user story key looks like ${UserStoryKey.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text
    Object.freeze(this)
  }

  static isWellFormed(text) {
    return typeof text === 'string' && UserStoryKey.#SHAPE.test(text)
  }

  toString() {
    return this.text
  }
}
