export class PlanSessionNotStarted extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'PlanSessionNotStarted'
  }
}
