import {
  WORKFLOW_SNAPSHOT_KEY,
  WorkflowSnapshot,
  WorkflowSnapshotStorage,
} from 'app/workflow-snapshot/storage'

const workflow = (): WorkflowSnapshot => ({
  phase: 'planning',
  request: { id: 'ABC-123', repo: 'owner/name', path: '/Users/pedro/code/name' },
  plan: {
    id: 'ABC-123',
    repo: 'owner/name',
    issue: { number: 7, url: 'https://github.com/owner/name/issues/7' },
    agent: 'workspace:4',
    branch: 'feat/7',
    worktree: '/Users/pedro/code/name/.worktrees/7',
  },
})

describe('WorkflowSnapshotStorage', () => {
  it('should load a saved versioned workflow', () => {
    WorkflowSnapshotStorage.save(workflow())

    expect(WorkflowSnapshotStorage.load()).toEqual(workflow())
  })

  it.each([
    ['invalid JSON', '{not-json'],
    ['an unknown version', JSON.stringify({ version: 2, workflow: workflow() })],
    ['a malformed workflow', JSON.stringify({ version: 1, workflow: { ...workflow(), plan: null } })],
  ])('should treat %s as empty', (_case, value) => {
    localStorage.setItem(WORKFLOW_SNAPSHOT_KEY, value)

    expect(WorkflowSnapshotStorage.load()).toBeNull()
  })

  it.each([
    ['a malformed request ticket', (value: WorkflowSnapshot) => { value.request.id = 'abc-123' }],
    ['a malformed request repository', (value: WorkflowSnapshot) => { value.request.repo = 'name' }],
    ['a malformed request path', (value: WorkflowSnapshot) => { value.request.path = 'relative/path' }],
    ['a non-positive issue', (value: WorkflowSnapshot) => { value.plan.issue.number = 0 }],
    ['an empty issue URL', (value: WorkflowSnapshot) => { value.plan.issue.url = ' ' }],
    ['an empty agent', (value: WorkflowSnapshot) => { value.plan.agent = '' }],
    ['an empty branch', (value: WorkflowSnapshot) => { value.plan.branch = '' }],
    ['an empty worktree', (value: WorkflowSnapshot) => { value.plan.worktree = '' }],
    ['a mismatched ticket', (value: WorkflowSnapshot) => { value.plan.id = 'XYZ-456' }],
    ['a mismatched repository', (value: WorkflowSnapshot) => { value.plan.repo = 'owner/other' }],
    ['a worktree outside the request path', (value: WorkflowSnapshot) => { value.plan.worktree = '/tmp/worktree' }],
  ])('should reject %s', (_case, makeInvalid) => {
    const invalid = workflow()
    makeInvalid(invalid)
    localStorage.setItem(WORKFLOW_SNAPSHOT_KEY, JSON.stringify({ version: 1, workflow: invalid }))

    expect(WorkflowSnapshotStorage.load()).toBeNull()
  })

  it('should treat unavailable storage as empty', () => {
    const reading = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable')
    })

    expect(WorkflowSnapshotStorage.load()).toBeNull()
    reading.mockRestore()
  })

  it('should not fail when storage rejects writes and removals', () => {
    const writing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable')
    })
    expect(() => WorkflowSnapshotStorage.save(workflow())).not.toThrow()
    writing.mockRestore()

    const removing = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage is unavailable')
    })
    expect(() => WorkflowSnapshotStorage.remove()).not.toThrow()
    removing.mockRestore()
  })
})
