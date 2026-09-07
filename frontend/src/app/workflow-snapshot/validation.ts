import { LocalPath } from 'app/start-plan/LocalPath'
import { RepositoryName } from 'app/start-plan/RepositoryName'
import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { TicketKey } from 'app/start-plan/TicketKey'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== ''

const isTicketOrAbsent = (id: unknown): id is string | null =>
  id === null || (typeof id === 'string' && TicketKey.isWellFormed(id))

const isRequest = (value: unknown): value is StartPlanRequest =>
  isRecord(value) &&
  isTicketOrAbsent(value.id) &&
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

const isPlanForRequest = (value: unknown, request: StartPlanRequest): value is StartedPlan =>
  isRecord(value) &&
  isTicketOrAbsent(value.id) &&
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
  isWorktreeUnder(value.worktree, request.path)

export { isPlanForRequest, isRecord, isRequest }
