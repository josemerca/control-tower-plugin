export class CtStepCommit {
  static TRAILER_KEY = 'Committed-By'

  static TRAILER_VALUE = 'ct-step'

  static TRAILER_LINE = `${CtStepCommit.TRAILER_KEY}: ${CtStepCommit.TRAILER_VALUE}`

  static TRAILER_FORMAT = `%(trailers:key=${CtStepCommit.TRAILER_KEY},valueonly,separator=%x2C)`

  static wroteAllOf(trailerValuesByCommit) {
    const commits = [...trailerValuesByCommit]
    if (commits.length === 0) return false
    return commits.every((values) => CtStepCommit.wrote(values))
  }

  static wrote(trailerValues) {
    return String(trailerValues ?? '')
      .split(',')
      .some((value) => value.trim() === CtStepCommit.TRAILER_VALUE)
  }
}
