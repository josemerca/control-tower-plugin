export class HarvestOutcome {
  static COLLECTED = 'collected'
  static WAITING = 'waiting'
  static KEPT = 'kept'
  static PARTIAL = 'partial'

  static declared() {
    return Object.values(HarvestOutcome)
  }
}
