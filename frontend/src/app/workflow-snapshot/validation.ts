import { LocalPath } from 'app/start-plan/LocalPath'
import { RepositoryName } from 'app/start-plan/RepositoryName'
import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

const isRequest = (value: unknown): value is StartPlanRequest =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  TicketKey.isWellFormed(value.id) &&
  typeof value.repo === 'string' &&
  RepositoryName.isWellFormed(value.repo) &&
  typeof value.path === 'string' &&
  LocalPath.isWellFormed(value.path)

const isWorktreeUnder = (worktree: string, path: string): boolean => {
  const normalizedWorktree = LocalPath.normalize(worktree)
  const normalizedPath = LocalPath.normalize(path)
  const prefix = normalizedPath === '/' ? '/' : `${normalizedPath}/`

  return normalizedWorktree !== normalizedPath && normalizedWorktree.startsWith(prefix)
}

const isWellFormedRoot = (value: unknown): value is string | undefined =>
  value === undefined || (typeof value === 'string' && LocalPath.isWellFormed(value))

const isPlanForRequest = (value: unknown, request: StartPlanRequest): value is StartedPlan =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  TicketKey.isWellFormed(value.id) &&
  value.id === request.id &&
  typeof value.repo === 'string' &&
  RepositoryName.isWellFormed(value.repo) &&
  value.repo === request.repo &&
  isRecord(value.issue) &&
  typeof value.issue.number === 'number' &&
  Number.isInteger(value.issue.number) &&
  value.issue.number > 0 &&
  isNonEmptyString(value.issue.url) &&
  isNonEmptyString(value.agent) &&
  isNonEmptyString(value.branch) &&
  isNonEmptyString(value.worktree) &&
  LocalPath.isWellFormed(value.worktree) &&
  isWellFormedRoot(value.root) &&
  isWorktreeUnder(value.worktree, typeof value.root === 'string' ? value.root : request.path)

export { isPlanForRequest, isRecord, isRequest }
