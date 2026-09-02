export class PlanState {
  static WRITING = 'writing'
  static READY = 'ready'

  static declared() {
    return Object.values(PlanState)
  }
}
