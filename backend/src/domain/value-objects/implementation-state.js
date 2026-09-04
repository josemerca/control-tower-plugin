export const ImplementationStep = Object.freeze({
  STARTING: 'starting',
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  COMMIT: 'commit',
  RECONCILE: 'reconcile',
  GLOBAL: 'global',
  SLICE_JUDGE: 'slice-judge',
  E2E: 'e2e',
  DELIVERED: 'delivered',
})

export class ImplementationState {
  static TASKLESS = Object.freeze([
    ImplementationStep.STARTING, ImplementationStep.RECONCILE, ImplementationStep.GLOBAL,
    ImplementationStep.SLICE_JUDGE, ImplementationStep.E2E, ImplementationStep.DELIVERED,
  ])

  constructor({ step, task, totalTasks, name, attempt, discards }) {
    this.step = step
    this.task = task
    this.totalTasks = totalTasks
    this.name = name
    this.attempt = attempt
    this.discards = discards
    Object.freeze(this)
  }

  static of({ step, task, totalTasks, name, attempt, discards }) {
    if (ImplementationState.TASKLESS.includes(step)) {
      return new ImplementationState({ step, task: null, totalTasks, name: null, attempt: null, discards })
    }
    return new ImplementationState({ step, task, totalTasks, name, attempt, discards })
  }

  static starting() {
    return ImplementationState.of({
      step: ImplementationStep.STARTING, task: null, totalTasks: null, name: null, attempt: null, discards: null,
    })
  }
}
