const ISSUE = 7
const REPO = 'owner/name'
const PATH = `/plan-events/7?repo=${encodeURIComponent(REPO)}`

const writing = () => '{"state":"writing"}'
const ready = () => '{"state":"ready"}'
const unreadable = () => '{"error":"git status could not say whether the plan is committed"}'
const notWatched = () => '{"error":"no plan was started for that issue"}'

export const PlanEventsMother = {
  ISSUE,
  PATH,
  writing,
  ready,
  unreadable,
  notWatched,
}
