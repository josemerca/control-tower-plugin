import { describe, expect, it, vi } from 'vitest'
import { DiskImplementationStartRegistry } from '../../src/infrastructure/disk-implementation-start-registry.js'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'

const WATCH = new PlanWatch({
  story: new UserStoryKey('ABC-123'),
  issue: new PlanIssue({ number: 33, url: 'https://github.com/owner/repo/issues/33' }),
  located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/33', branch: 'feat/33' }),
  repository: new RepositoryName('owner/repo'),
  agent: 'workspace:20',
})

describe('DiskImplementationStartRegistry', () => {
  it('writes_all_identity_needed_to_match_a_recovered_cmux_plan', async () => {
    const write = vi.fn()
    const registry = new DiskImplementationStartRegistry({
      read: vi.fn(), stat: vi.fn(), write, root: '/state',
    })

    await registry.remember(WATCH)

    expect(write).toHaveBeenCalledWith(
      '/state/implementation-starts/owner__repo-33.json',
      `${JSON.stringify({
        repo: 'owner/repo',
        issue: 33,
        agent: 'workspace:20',
        story: 'ABC-123',
        root: '/repo',
        branch: 'feat/33',
        worktree: '/repo/.worktrees/33',
      }, null, 2)}\n`
    )
  })
})
