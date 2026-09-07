export class PlanComment {
  static EXAMPLE = 'un texto que diga qué hay que planificar'

  constructor(text) {
    if (!PlanComment.isWellFormed(text)) {
      throw new Error(`a plan comment looks like ${PlanComment.EXAMPLE}, got ${JSON.stringify(text)}`)
    }
    this.text = text.trim()
    Object.freeze(this)
  }

  static isWellFormed(text) {
    return typeof text === 'string' && text.trim().length > 0
  }
}
