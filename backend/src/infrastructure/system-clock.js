import { setTimeout as after } from 'node:timers/promises'
import { Clock } from '../domain/ports/clock.js'

export class SystemClock extends Clock {
  static #A_SECOND_IN_MS = 1000

  async sleep(seconds) {
    await after(seconds * SystemClock.#A_SECOND_IN_MS)
  }
}
