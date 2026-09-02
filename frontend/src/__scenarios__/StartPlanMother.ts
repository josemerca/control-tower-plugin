const TICKET = 'ABC-123'
const SESSION = 'workspace:4'

const started = () => ({
  status: 202,
  body: `{"status":"started","id":"${TICKET}","session":"${SESSION}"}`,
})

const malformedId = () => ({
  status: 400,
  body: '{"error":"id must be a ticket key such as ABC-123"}',
})

const sessionNotStarted = () => ({
  status: 503,
  body: '{"error":"could not start the plan session: cmux is not reachable"}',
})

export const StartPlanMother = {
  TICKET,
  SESSION,
  started,
  malformedId,
  sessionNotStarted,
}
