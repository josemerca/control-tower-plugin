import { describe, it, expect } from 'vitest'
import { GitWorkspace } from '../../src/infrastructure/git-workspace.js'
import { WorkspaceNotPrepared } from '../../src/domain/exceptions.js'

class GitDouble {
  static ROOT = '/repo/checkout'
  static BASE = 'main'

  constructor(answer) {
    this.answer = answer
    this.calls = []
  }

  workspace() {
    return new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      run: (argv) => {
        this.calls.push(argv)
        return Promise.resolve(this.answer)
      },
    })
  }

  static ok() {
    return { failed: false, stdout: '', stderr: '' }
  }

  static refused(stderr) {
    return { failed: true, stdout: '', stderr }
  }
}

describe('GitWorkspace', () => {
  it('it_cuts_the_branch_from_the_remote_base_so_the_session_starts_from_what_is_published', async () => {
    const git = new GitDouble(GitDouble.ok())

    await git.workspace().prepare({ number: 42 })

    expect(git.calls).toEqual([[
      '-C', '/repo/checkout',
      'worktree', 'add',
      '-b', 'feat/42',
      '/repo/checkout/.worktrees/42',
      'origin/main',
    ]])
  })

  it('the_location_it_answers_is_where_the_session_will_actually_run', async () => {
    const located = await new GitDouble(GitDouble.ok()).workspace().prepare({ number: 42 })

    expect(located.path).toBe('/repo/checkout/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })

  it('a_git_that_refuses_travels_out_typed_carrying_what_git_said', async () => {
    const git = new GitDouble(GitDouble.refused("fatal: 'feat/42' is already checked out"))

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain("fatal: 'feat/42' is already checked out")
  })

  it('it_never_reuses_a_directory_it_did_not_create_because_git_is_the_one_that_refuses', async () => {
    const git = new GitDouble(GitDouble.refused('fatal: destination path already exists'))

    await expect(git.workspace().prepare({ number: 7 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })
})
