export class ReviewsSpy {
  constructor() {
    this.started = []
    this.stopped = []
  }

  start(watch) {
    this.started.push(watch)
  }

  stop({ issue, repository }) {
    this.stopped.push(`${repository.text}#${issue}`)
  }
}
