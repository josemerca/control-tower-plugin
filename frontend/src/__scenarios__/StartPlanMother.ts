const TICKET = 'ABC-123'
const COMMENT = 'revisar la caché de precios en el checkout'
const REPO = 'owner/name'
const ANOTHER_REPO = 'owner/other-name'
const PATH = '/Users/pedro/code/name'
const ISSUE = { number: 7, url: 'https://github.com/owner/name/issues/7' }
const AGENT = 'workspace:4'
const BRANCH = 'feat/7'
const WORKTREE = '/Users/pedro/code/name/.worktrees/7'
const REQUEST_BODY = '{"id":"ABC-123","repo":"owner/name","path":"/Users/pedro/code/name"}'
const REQUEST_BODY_COMMENT_ONLY =
  '{"user_comment":"revisar la caché de precios en el checkout","repo":"owner/name","path":"/Users/pedro/code/name"}'
const REQUEST_BODY_WITH_COMMENT =
  '{"id":"ABC-123","user_comment":"revisar la caché de precios en el checkout","repo":"owner/name",' +
  '"path":"/Users/pedro/code/name"}'

const started = () => ({
  status: 202,
  body:
    '{"status":"started","id":"ABC-123","repo":"owner/name",' +
    '"issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"agent":"workspace:4",' +
    '"branch":"feat/7","worktree":"/Users/pedro/code/name/.worktrees/7"}',
})

const startedWithoutStory = () => ({
  status: 202,
  body:
    '{"status":"started","id":null,"repo":"owner/name",' +
    '"issue":{"number":9,"url":"https://github.com/owner/name/issues/9"},"agent":"workspace:5",' +
    '"branch":"feat/9","worktree":"/Users/pedro/code/name/.worktrees/9"}',
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
  body: '{"code":"malformed-id","detail":"id must be a user story key such as ABC-123"}',
})

const malformedRepo = () => ({
  status: 400,
  body: '{"code":"malformed-repo","detail":"repo must be a repository such as owner/name"}',
})

const malformedPath = () => ({
  status: 400,
  body: '{"code":"malformed-path","detail":"path must be an absolute path"}',
})

const notACheckout = () => ({
  status: 400,
  body: '{"code":"checkout-not-confirmed","detail":"owner/name: /repo holds someone/else"}',
})

const planNotStarted = () => ({
  status: 400,
  body: '{"code":"plan-agent-not-launched","detail":"cmux is not reachable"}',
})

export const StartPlanMother = {
  TICKET,
  COMMENT,
  REPO,
  ANOTHER_REPO,
  PATH,
  ISSUE,
  AGENT,
  BRANCH,
  WORKTREE,
  REQUEST_BODY,
  REQUEST_BODY_COMMENT_ONLY,
  REQUEST_BODY_WITH_COMMENT,
  started,
  startedWithoutStory,
  startedInAnotherRepo,
  malformedId,
  malformedRepo,
  malformedPath,
  notACheckout,
  planNotStarted,
}
