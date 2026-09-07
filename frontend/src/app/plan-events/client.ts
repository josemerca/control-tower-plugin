import {
  PlanEvent,
  PlanEventsListener,
  PlanEventsSubscription,
  PlanFailure,
} from 'app/plan-events/PlanEvents.types'

const PATH = '/plan-events'
const MESSAGE_EVENT = 'message'
const FAILURE_EVENT = 'error'

const carriesData = (event: Event): event is MessageEvent<string> => 'data' in event

const watch = (issue: number, repo: string, listener: PlanEventsListener): PlanEventsSubscription => {
  const source = new EventSource(`${PATH}/${issue}?repo=${encodeURIComponent(repo)}`)
  let settled = false
  const settle = () => {
    if (settled) return
    settled = true
    source.close()
  }

  source.addEventListener(MESSAGE_EVENT, (event: MessageEvent<string>) => {
    const { state, pullRequest } = JSON.parse(event.data) as PlanEvent
    listener.onState(state, pullRequest ?? null)
  })

  source.addEventListener(FAILURE_EVENT, (event: Event) => {
    if (settled) return
    settle()
    if (carriesData(event)) {
      const { detail } = JSON.parse(event.data) as PlanFailure
      listener.onFailure(detail)
      return
    }
    listener.onUnreachable()
  })

  return { close: settle }
}

export const PlanEventsClient = {
  watch,
}
