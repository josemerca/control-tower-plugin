export class SleepDouble {
  constructor() {
    this.slept = []
  }

  sleep(seconds) {
    this.slept.push(seconds)

    return Promise.resolve()
  }
}
