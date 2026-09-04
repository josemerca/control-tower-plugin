import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { isPlanForRequest, isRecord, isRequest } from 'app/workflow-snapshot/validation'

type WorkflowSnapshot = {
  phase: 'planning' | 'ready' | 'implementing'
  request: StartPlanRequest
  plan: StartedPlan
}

type StoredWorkflowSnapshot = {
  version: 1
  workflow: WorkflowSnapshot
}

const KEY = 'control-tower.workflow'
const VERSION = 1

const isWorkflow = (value: unknown): value is WorkflowSnapshot =>
  isRecord(value) &&
  (value.phase === 'planning' || value.phase === 'ready' || value.phase === 'implementing') &&
  isRequest(value.request) &&
  isPlanForRequest(value.plan, value.request)

const load = (): WorkflowSnapshot | null => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!isRecord(value) || value.version !== VERSION || !isWorkflow(value.workflow)) return null

    return value.workflow
  } catch {
    return null
  }
}

const save = (workflow: WorkflowSnapshot) => {
  try {
    const stored: StoredWorkflowSnapshot = { version: VERSION, workflow }
    localStorage.setItem(KEY, JSON.stringify(stored))
  } catch {
    // The in-memory workflow remains usable when storage is unavailable.
  }
}

const remove = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export const WorkflowSnapshotStorage = { load, save, remove }
export const WORKFLOW_SNAPSHOT_KEY = KEY
export type { WorkflowSnapshot }
