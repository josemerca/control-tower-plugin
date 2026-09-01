import { describe, it, expect } from 'vitest'
import { GitWorkspace } from '../../src/infrastructure/git-workspace.js'
import { WorkspaceNotPrepared } from '../../src/domain/exceptions.js'

class GitDouble {
  static ROOT = '/repo/checkout'
  static BASE = 'main'
  static CUT = 'a1b2c3d'
  static GIT_DIR = '/repo/checkout/.git/worktrees/42'

  constructor(answer) {
    this.answer = answer
    this.calls = []
    this.written = []
  }

  workspace() {
    return new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      write: (path, text) => {
        this.written.push([path, text])
        return Promise.resolve()
      },
      run: (argv) => {
        this.calls.push(argv)
        if (argv.includes('--absolute-git-dir')) {
          return Promise.resolve({ failed: false, stdout: `${GitDouble.GIT_DIR}\n`, stderr: '' })
        }
        if (argv.includes('rev-parse')) {
          return Promise.resolve({ failed: false, stdout: `${GitDouble.CUT}\n`, stderr: '' })
        }
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

    expect(git.calls[0]).toEqual([
      '-C', '/repo/checkout',
      'worktree', 'add',
      '-b', 'feat/42',
      '/repo/checkout/.worktrees/42',
      'origin/main',
    ])
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

  it('the_rule_that_hides_the_state_is_written_before_the_state_itself', async () => {
    const git = new GitDouble(GitDouble.ok())

    await git.workspace().prepare({ number: 42 })

    expect(git.written.map(([path]) => path)).toEqual([
      '/repo/checkout/.git/worktrees/42/info/exclude',
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('a_git_dir_it_cannot_resolve_stops_the_seeding_because_the_state_would_be_visible_to_git', async () => {
    const git = new GitDouble(GitDouble.ok())
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      write: () => Promise.resolve(),
      run: (argv) => Promise.resolve(argv.includes('--absolute-git-dir')
        ? { failed: true, stdout: '', stderr: 'not a git repository' }
        : GitDouble.ok()),
    })

    await expect(git.workspace().prepare({ number: 42 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_state_it_seeds_carries_the_cut_it_measured_in_the_worktree_and_not_the_one_it_guessed', async () => {
    const git = new GitDouble(GitDouble.ok())

    await git.workspace().prepare({ number: 42 })

    expect(git.written[1][1]).toContain('base_sha: "a1b2c3d"')
  })

  it('a_head_it_cannot_measure_stops_the_seeding_instead_of_writing_a_state_without_a_cut', async () => {
    const git = new GitDouble(GitDouble.ok())
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      write: () => Promise.resolve(),
      run: (argv) => Promise.resolve(argv.includes('HEAD')
        ? { failed: true, stdout: '', stderr: 'fatal: ambiguous argument HEAD' }
        : GitDouble.ok()),
    })

    await expect(git.workspace().prepare({ number: 42 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })
})
