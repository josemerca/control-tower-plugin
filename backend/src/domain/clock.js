export class Clock {
  async sleep(seconds) {
    throw new Error(`${this.constructor.name} must implement sleep(seconds), asked for ${seconds}`)
  }
}
