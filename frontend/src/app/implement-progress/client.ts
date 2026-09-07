import { ImplementationProgressState, ImplementationStep, ImplementProgressOutcome, PullRequest } from 'app/implement-progress/ImplementProgress.types'

const PATH = (issue: number) => `/implement-progress/${issue}`
const ROOT_FIELD = 'root'
const REPO_FIELD = 'repo'
const NOT_READ_CODE = 'implementation-progress-not-read'
const KNOWN_STEPS: readonly string[] = Object.values(ImplementationStep)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumberOrNull = (value: unknown): value is number | null => value === null || typeof value === 'number'

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

type ImplementationProgressWire = {
  step: ImplementationStep
  task: number | null
  total_tasks: number | null
  name: string | null
  attempt: number | null
  discards: number | null
  pull_request?: unknown
}

const isImplementationProgressWire = (value: unknown): value is ImplementationProgressWire =>
  isRecord(value) &&
  typeof value.step === 'string' &&
  KNOWN_STEPS.includes(value.step) &&
  isNumberOrNull(value.task) &&
  isNumberOrNull(value.total_tasks) &&
  isStringOrNull(value.name) &&
  isNumberOrNull(value.attempt) &&
  isNumberOrNull(value.discards)

const isPullRequestWire = (value: unknown): value is PullRequest =>
  isRecord(value) && typeof value.number === 'number' && typeof value.url === 'string'

const toPullRequest = (value: unknown): PullRequest | null => (isPullRequestWire(value) ? { number: value.number, url: value.url } : null)

const toState = (wire: ImplementationProgressWire): ImplementationProgressState => ({
  step: wire.step,
  task: wire.task,
  totalTasks: wire.total_tasks,
  name: wire.name,
  attempt: wire.attempt,
  discards: wire.discards,
  pullRequest: toPullRequest(wire.pull_request),
})

const isRefusal = (value: unknown): value is { code: string; detail: string } =>
  isRecord(value) && typeof value.code === 'string' && typeof value.detail === 'string'

const get = async ({ issue, root, repo }: { issue: number; root: string; repo: string }): Promise<ImplementProgressOutcome> => {
  let response: Response
  try {
    response = await fetch(
      `${PATH(issue)}?${ROOT_FIELD}=${encodeURIComponent(root)}&${REPO_FIELD}=${encodeURIComponent(repo)}`,
    )
  } catch {
    return { kind: 'backend-unreachable' }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'backend-unreachable' }
  }

  if (response.ok) {
    if (!isImplementationProgressWire(body)) return { kind: 'backend-unreachable' }
    return { kind: 'read', state: toState(body) }
  }

  if (!isRefusal(body)) return { kind: 'backend-unreachable' }
  if (body.code === NOT_READ_CODE) return { kind: 'not-read' }
  return { kind: 'refused', error: body.detail }
}

export const ImplementProgressClient = { get }
