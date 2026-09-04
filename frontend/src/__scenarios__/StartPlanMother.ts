const TICKET = 'ABC-123'
const REPO = 'owner/name'
const ANOTHER_REPO = 'owner/other-name'
const PATH = '/Users/pedro/code/name'
const ISSUE = { number: 7, url: 'https://github.com/owner/name/issues/7' }
const AGENT = 'workspace:4'
const BRANCH = 'feat/7'
const WORKTREE = '/Users/pedro/code/name/.worktrees/7'
const REQUEST_BODY = '{"id":"ABC-123","repo":"owner/name","path":"/Users/pedro/code/name"}'

const started = () => ({
  status: 202,
  body:
    '{"status":"started","id":"ABC-123","repo":"owner/name",' +
    '"issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"agent":"workspace:4",' +
    '"branch":"feat/7","worktree":"/Users/pedro/code/name/.worktrees/7"}',
})

const startedInAnotherRepo = () => ({
  status: 202,
  body:
    '{"status":"started","id":"ABC-123","repo":"owner/other-name",' +
    '"issue":{"number":7,"url":"https://github.com/owner/other-name/issues/7"},"agent":"workspace:9",' +
    '"branch":"feat/7","worktree":"/Users/pedro/code/other-name/.worktrees/7"}',
})

const malformedId = () => ({
  status: 400,
  body: '{"error":"id must be a user story key such as ABC-123"}',
})

const malformedRepo = () => ({
  status: 400,
  body: '{"error":"repo must be a repository such as owner/name"}',
})

const malformedPath = () => ({
  status: 400,
  body: '{"error":"path must be an absolute path"}',
})

const notACheckout = () => ({
  status: 400,
  body: '{"error":"path must be a git checkout of owner/name: /repo holds someone/else"}',
})

const planNotStarted = () => ({
  status: 503,
  body: '{"error":"could not start the plan: cmux is not reachable"}',
})

export const StartPlanMother = {
  TICKET,
  REPO,
  ANOTHER_REPO,
  PATH,
  ISSUE,
  AGENT,
  BRANCH,
  WORKTREE,
  REQUEST_BODY,
  started,
  startedInAnotherRepo,
  malformedId,
  malformedRepo,
  malformedPath,
  notACheckout,
  planNotStarted,
}
