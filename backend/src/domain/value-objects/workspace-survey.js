export class WorkspaceSurvey {
  constructor({ repository, prepared }) {
    this.repository = repository
    this.prepared = Object.freeze([...prepared])
    Object.freeze(this)
  }
}
