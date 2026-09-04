import {
  PlanEvent,
  PlanEventsListener,
  PlanEventsSubscription,
  PlanFailure,
  PlanState,
} from 'app/plan-events/PlanEvents.types'

const PATH = '/plan-events'
const MESSAGE_EVENT = 'message'
const FAILURE_EVENT = 'error'
const LAST_STATE: PlanState = 'ready'

const carriesData = (event: Event): event is MessageEvent<string> => 'data' in event

const watch = (issue: number, repo: string, listener: PlanEventsListener): PlanEventsSubscription => {
  const source = new EventSource(`${PATH}/${issue}?repo=${encodeURIComponent(repo)}`)
  let settled = false
  const settle = () => {
    settled = true
    source.close()
  }

  source.addEventListener(MESSAGE_EVENT, (event: MessageEvent<string>) => {
    const { state } = JSON.parse(event.data) as PlanEvent
    if (state === LAST_STATE) settle()
    listener.onState(state)
  })

  source.addEventListener(FAILURE_EVENT, (event: Event) => {
    if (settled) return
    settle()
    if (carriesData(event)) {
      const { error } = JSON.parse(event.data) as PlanFailure
      listener.onFailure(error)
      return
    }
    listener.onUnreachable()
  })

  return { close: settle }
}

export const PlanEventsClient = {
  watch,
}
