export class Tickets {
  async detail(key) {
    throw new Error(`${this.constructor.name} must implement detail(key), asked for ${key}`)
  }
}
