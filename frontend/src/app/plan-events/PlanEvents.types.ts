export type PlanState = 'writing' | 'ready'

export type PlanEvent = {
  state: PlanState
}

export type PlanFailure = {
  error: string
}

export type PlanEventsListener = {
  onState: (state: PlanState) => void
  onFailure: (error: string) => void
  onUnreachable: () => void
}

export type PlanEventsSubscription = {
  close: () => void
}
