const AGENT = 'workspace:4'
const ISSUE = 7
const REPO = 'owner/name'
const REQUEST_BODY = '{"agent":"workspace:4","issue":7,"repo":"owner/name"}'

const implementing = () => ({
  status: 202,
  body: '{"status":"implementing","agent":"workspace:4","issue":7}',
})

const malformedAgent = () => ({
  status: 400,
  body: '{"code":"malformed-agent","detail":"agent must be the handle start-plan answered with"}',
})

const malformedRepo = () => ({
  status: 400,
  body: '{"code":"malformed-repo","detail":"repo must be a repository such as owner/name"}',
})

const agentNotResumed = () => ({
  status: 400,
  body: '{"code":"plan-agent-not-resumed","detail":"cmux send failed: no such workspace"}',
})

export const ImplementPlanMother = {
  AGENT,
  ISSUE,
  REPO,
  REQUEST_BODY,
  implementing,
  malformedAgent,
  malformedRepo,
  agentNotResumed,
}
