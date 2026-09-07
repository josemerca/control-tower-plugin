export class ChangeAsked {
  constructor({ id, text }) {
    this.id = id
    this.text = text
    Object.freeze(this)
  }
}
