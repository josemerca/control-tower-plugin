export const ImplementationStep = Object.freeze({
  STARTING: 'starting',
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  ADVISE: 'advise',
  COMMIT: 'commit',
  RECONCILE: 'reconcile',
  GLOBAL: 'global',
  SLICE_JUDGE: 'slice-judge',
  E2E: 'e2e',
  DELIVERED: 'delivered',
  IN_REVIEW: 'in-review',
  FIXING: 'fixing',
})

export class ImplementationState {
  static TASKLESS = Object.freeze([
    ImplementationStep.STARTING, ImplementationStep.RECONCILE, ImplementationStep.GLOBAL,
    ImplementationStep.SLICE_JUDGE, ImplementationStep.E2E, ImplementationStep.DELIVERED,
    ImplementationStep.IN_REVIEW, ImplementationStep.FIXING,
  ])

  constructor({ step, task, totalTasks, name, attempt, discards, pullRequest = null }) {
    this.step = step
    this.task = task
    this.totalTasks = totalTasks
    this.name = name
    this.attempt = attempt
    this.discards = discards
    this.pullRequest = pullRequest
    Object.freeze(this)
  }

  static of({ step, task, totalTasks, name, attempt, discards, pullRequest = null }) {
    if (ImplementationState.TASKLESS.includes(step)) {
      return new ImplementationState({
        step, task: null, totalTasks, name: null, attempt: null, discards, pullRequest,
      })
    }
    return new ImplementationState({ step, task, totalTasks, name, attempt, discards, pullRequest })
  }

  underReview({ step, pullRequest }) {
    return ImplementationState.of({
      step, task: null, totalTasks: this.totalTasks, name: null, attempt: null,
      discards: this.discards, pullRequest,
    })
  }

  static starting() {
    return ImplementationState.of({
      step: ImplementationStep.STARTING, task: null, totalTasks: null, name: null, attempt: null, discards: null,
    })
  }
}
