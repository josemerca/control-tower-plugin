const TICKET = 'ABC-123'
const REPO = 'owner/name'
const ISSUE = { number: 7, url: 'https://github.com/owner/name/issues/7' }
const AGENT = 'workspace:4'
const REQUEST_BODY = '{"id":"ABC-123","repo":"owner/name"}'

const started = () => ({
  status: 202,
  body:
    '{"status":"started","id":"ABC-123","repo":"owner/name",' +
    '"issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},"agent":"workspace:4"}',
})

const malformedId = () => ({
  status: 400,
  body: '{"error":"id must be a user story key such as ABC-123"}',
})

const malformedRepo = () => ({
  status: 400,
  body: '{"error":"repo must be a repository such as owner/name"}',
})

const planNotStarted = () => ({
  status: 503,
  body: '{"error":"could not start the plan: cmux is not reachable"}',
})

export const StartPlanMother = {
  TICKET,
  REPO,
  ISSUE,
  AGENT,
  REQUEST_BODY,
  started,
  malformedId,
  malformedRepo,
  planNotStarted,
}
