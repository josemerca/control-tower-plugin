export class PlanSessionFailure extends Error {
  constructor(reason) {
    super(reason)
    this.name = new.target.name
  }
}

export class PlanSessionNotStarted extends PlanSessionFailure {}

export class PlanSessionNotNamed extends PlanSessionFailure {}
