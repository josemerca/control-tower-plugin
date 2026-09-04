const ISSUE = 7
const PATH = `/plan-events/${ISSUE}?repo=owner%2Fname`
const PATH_IN_ANOTHER_REPO = `/plan-events/${ISSUE}?repo=owner%2Fother-name`

const writing = () => '{"state":"writing"}'
const ready = () => '{"state":"ready"}'
const unreadable = () => '{"error":"git status could not say whether the plan is committed"}'
const notWatched = () => '{"error":"no plan was started for that issue"}'

export const PlanEventsMother = {
  ISSUE,
  PATH,
  PATH_IN_ANOTHER_REPO,
  writing,
  ready,
  unreadable,
  notWatched,
}
