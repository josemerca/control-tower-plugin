const ISSUE = 7
const PATH = `/plan-events/${ISSUE}?repo=owner%2Fname`
const PATH_IN_ANOTHER_REPO = `/plan-events/${ISSUE}?repo=owner%2Fother-name`
const PULL_REQUEST = { number: 42, url: 'https://github.com/josemerca/ct-loop-sandbox/pull/42' }

const writing = () => '{"state":"writing"}'
const ready = () => '{"state":"ready"}'
const unreadable = () => '{"code":"plan-progress-not-read","detail":"git status could not say whether the plan is committed"}'
const implementing = () => '{"state":"implementing"}'
const inReview = () => `{"state":"in-review","pullRequest":${JSON.stringify(PULL_REQUEST)}}`
const fixing = () => `{"state":"fixing","pullRequest":${JSON.stringify(PULL_REQUEST)}}`
const deliveryUnreadable = () =>
  '{"code":"delivery-progress-not-read","detail":"gh pr list failed: HTTP 502"}'

export const PlanEventsMother = {
  ISSUE,
  PATH,
  PATH_IN_ANOTHER_REPO,
  PULL_REQUEST,
  writing,
  ready,
  unreadable,
  implementing,
  inReview,
  fixing,
  deliveryUnreadable,
}
