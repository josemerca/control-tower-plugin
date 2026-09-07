const ISSUE = 7
const ROOT = '/Users/pedro/code/name'
const NOT_READ_DETAIL = 'the worktree /Users/pedro/code/name/.worktrees/7 is not there, so its run cannot be read'
const MALFORMED_ROOT_DETAIL = 'root is an absolute path such as /Users/you/repos/name'

const progress = () => ({
  status: 200,
  body: '{"step":"judge","task":3,"total_tasks":7,"name":"el lector del plan","attempt":2,"discards":0}',
})

const delivered = () => ({
  status: 200,
  body: '{"step":"delivered","task":null,"total_tasks":8,"name":null,"attempt":null,"discards":1}',
})

const withoutTaskName = () => ({
  status: 200,
  body: '{"step":"implement","task":1,"total_tasks":8,"name":null,"attempt":1,"discards":0}',
})

const notRead = () => ({
  status: 400,
  body: `{"code":"implementation-progress-not-read","detail":"${NOT_READ_DETAIL}"}`,
})

const malformedRoot = () => ({
  status: 400,
  body: `{"code":"malformed-root","detail":"${MALFORMED_ROOT_DETAIL}"}`,
})

export const ImplementProgressMother = {
  ISSUE,
  ROOT,
  NOT_READ_DETAIL,
  MALFORMED_ROOT_DETAIL,
  progress,
  delivered,
  withoutTaskName,
  notRead,
  malformedRoot,
}
