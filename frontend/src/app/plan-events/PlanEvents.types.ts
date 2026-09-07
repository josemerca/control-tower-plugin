export type PlanState = 'writing' | 'ready' | 'implementing' | 'in-review' | 'fixing'

export type PullRequest = {
  number: number
  url: string
}

export type PlanEvent = {
  state: PlanState
  pullRequest?: PullRequest
}

export type PlanFailure = {
  code: string
  detail: string
}

export type PlanEventsListener = {
  onState: (state: PlanState, pullRequest: PullRequest | null) => void
  onFailure: (error: string) => void
  onUnreachable: () => void
}

export type PlanEventsSubscription = {
  close: () => void
}
