import { describe, it, expect, vi } from 'vitest'
import { GitWorkspace } from '../../src/infrastructure/git-workspace.js'
import { WorkspaceNotPrepared } from '../../src/domain/exceptions.js'
import { SliceSeed } from '../../src/infrastructure/slice-seed.js'
import { WorkspaceLocation } from '../../src/domain/workspace-location.js'

class GitDouble {
  static ROOT = '/repo/checkout'
  static BASE = 'main'
  static CUT = 'a1b2c3d'
  static COMMON_DIR = '/repo/checkout/.git'
  static WORKTREE = '/repo/checkout/.worktrees/42'
  static EXCLUDE_PATH = `${GitDouble.COMMON_DIR}/info/exclude`

  constructor({ answer, status, existingExclude = null, commonDir } = {}) {
    this.answer = answer ?? GitDouble.ok()
    this.status = status ?? GitDouble.clean()
    this.existingExclude = existingExclude
    this.commonDir = commonDir ?? GitDouble.COMMON_DIR
    this.calls = []
    this.written = []
    this.reads = []
    this.stderr = []
  }

  workspace() {
    return new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: (path) => {
        this.reads.push(path)
        return Promise.resolve(this.existingExclude)
      },
      write: (path, text) => {
        this.written.push([path, text])
        return Promise.resolve()
      },
      run: (argv) => {
        this.calls.push(argv)
        if (argv.includes('--git-common-dir')) {
          return Promise.resolve({ failed: false, stdout: `${this.commonDir}\n`, stderr: '' })
        }
        if (argv.includes('HEAD')) {
          return Promise.resolve({ failed: false, stdout: `${GitDouble.CUT}\n`, stderr: '' })
        }
        if (argv.includes('status')) {
          return Promise.resolve(this.status)
        }
        return Promise.resolve(this.answer)
      },
      stderr: (line) => {
        this.stderr.push(line)
      },
    })
  }

  static ok() {
    return { failed: false, stdout: '', stderr: '' }
  }

  static refused(stderr) {
    return { failed: true, stdout: '', stderr }
  }

  static clean() {
    return { failed: false, stdout: '', stderr: '' }
  }

  static stillVisible() {
    return { failed: false, stdout: `?? ${SliceSeed.RELATIVE_PATH}\n`, stderr: '' }
  }
}

describe('GitWorkspace', () => {
  it('it_cuts_the_branch_from_the_remote_base_so_the_session_starts_from_what_is_published', async () => {
    const git = new GitDouble()

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
    const located = await new GitDouble().workspace().prepare({ number: 42 })

    expect(located.path).toBe('/repo/checkout/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })

  it('a_git_that_refuses_travels_out_typed_carrying_what_git_said', async () => {
    const git = new GitDouble({ answer: GitDouble.refused("fatal: 'feat/42' is already checked out") })

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain("fatal: 'feat/42' is already checked out")
  })

  it('it_never_reuses_a_directory_it_did_not_create_because_git_is_the_one_that_refuses', async () => {
    const git = new GitDouble({ answer: GitDouble.refused('fatal: destination path already exists') })

    await expect(git.workspace().prepare({ number: 7 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_rule_that_hides_the_state_is_written_before_the_state_itself_in_the_directory_git_actually_reads', async () => {
    const git = new GitDouble()

    await git.workspace().prepare({ number: 42 })

    expect(git.written.map(([path]) => path)).toEqual([
      GitDouble.EXCLUDE_PATH,
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('the_exclude_rule_it_writes_is_exactly_the_path_of_the_state_file_and_nothing_else', async () => {
    const git = new GitDouble()

    await git.workspace().prepare({ number: 42 })

    expect(git.written[0][1]).toBe(`${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('a_common_dir_git_answers_as_relative_is_resolved_against_the_root_and_not_kept_as_a_dangling_path', async () => {
    const git = new GitDouble({ commonDir: '.git' })

    await git.workspace().prepare({ number: 42 })

    expect(git.written[0][0]).toBe(`${GitDouble.ROOT}/.git/info/exclude`)
  })

  it('a_users_existing_exclude_rules_survive_the_seeding_instead_of_being_truncated', async () => {
    const git = new GitDouble({ existingExclude: 'node_modules/\n' })

    await git.workspace().prepare({ number: 42 })

    expect(git.written[0][1]).toBe(`node_modules/\n${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('an_existing_exclude_file_missing_its_final_newline_does_not_get_the_new_rule_glued_onto_its_last_line', async () => {
    const git = new GitDouble({ existingExclude: 'node_modules/' })

    await git.workspace().prepare({ number: 42 })

    expect(git.written[0][1]).toBe(`node_modules/\n${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('a_second_seeding_does_not_duplicate_the_rule_because_it_is_already_in_the_shared_exclude_file', async () => {
    const git = new GitDouble({ existingExclude: `node_modules/\n${SliceSeed.RELATIVE_PATH}\n` })

    await git.workspace().prepare({ number: 42 })

    expect(git.written.map(([path]) => path)).toEqual([
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('a_common_dir_it_cannot_resolve_stops_the_seeding_because_the_state_would_be_visible_to_git', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => Promise.resolve(argv.includes('--git-common-dir')
        ? { failed: true, stdout: '', stderr: 'not a git repository' }
        : GitDouble.ok()),
    })

    await expect(git.workspace().prepare({ number: 42 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_state_it_seeds_carries_the_cut_it_measured_in_the_worktree_and_not_the_one_it_guessed', async () => {
    const git = new GitDouble()

    await git.workspace().prepare({ number: 42 })

    expect(git.written[1][1]).toContain('base_sha: "a1b2c3d"')
  })

  it('a_head_it_cannot_measure_stops_the_seeding_instead_of_writing_a_state_without_a_cut', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => Promise.resolve(argv.includes('HEAD')
        ? { failed: true, stdout: '', stderr: 'fatal: ambiguous argument HEAD' }
        : argv.includes('--git-common-dir')
          ? { failed: false, stdout: `${GitDouble.COMMON_DIR}\n`, stderr: '' }
          : GitDouble.ok())
    })

    await expect(git.workspace().prepare({ number: 42 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_check_that_the_state_stays_hidden_asks_git_with_untracked_files_all_so_a_whole_untracked_directory_cannot_collapse_into_one_line', async () => {
    const git = new GitDouble()

    await git.workspace().prepare({ number: 42 })

    expect(git.calls.at(-1)).toEqual([
      '-C', GitDouble.WORKTREE, 'status', '--porcelain', '--untracked-files=all',
    ])
  })

  it('a_state_file_that_is_still_visible_to_git_after_seeding_aborts_the_prepare_instead_of_trusting_the_exit_code', async () => {
    const git = new GitDouble({ status: GitDouble.stillVisible() })

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain(SliceSeed.RELATIVE_PATH)
  })

  it('a_status_check_that_git_refuses_to_answer_is_not_taken_for_a_clean_tree', async () => {
    const git = new GitDouble({ status: GitDouble.refused('git is not available') })

    await expect(git.workspace().prepare({ number: 42 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('undoing_a_location_removes_the_worktree_and_deletes_the_branch_it_was_cut_on', async () => {
    const git = new GitDouble()
    const located = await git.workspace().prepare({ number: 42 })
    git.calls = []

    await git.workspace().undo(located)

    expect(git.calls).toEqual([
      ['-C', GitDouble.ROOT, 'worktree', 'remove', '--force', GitDouble.WORKTREE],
      ['-C', GitDouble.ROOT, 'branch', '-D', 'feat/42'],
    ])
  })

  it('undoing_a_location_runs_both_orders_against_the_root_and_never_against_whatever_directory_the_process_happens_to_be_in', async () => {
    const git = new GitDouble()
    const located = await git.workspace().prepare({ number: 42 })
    git.calls = []

    await git.workspace().undo(located)

    expect(git.calls.every((argv) => argv[0] === '-C' && argv[1] === GitDouble.ROOT)).toBe(true)
  })
})

describe('GitWorkspace undoes what it already created when preparing the ground fails afterward', () => {
  const undone = [
    ['-C', GitDouble.ROOT, 'worktree', 'remove', '--force', GitDouble.WORKTREE],
    ['-C', GitDouble.ROOT, 'branch', '-D', 'feat/42'],
  ]

  it('a_common_dir_git_refuses_to_resolve_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        return Promise.resolve(argv.includes('--git-common-dir')
          ? { failed: true, stdout: '', stderr: 'not a git repository' }
          : GitDouble.ok())
      },
    })

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('no se pudo resolver el directorio común')
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_head_git_cannot_measure_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        return Promise.resolve(argv.includes('HEAD')
          ? { failed: true, stdout: '', stderr: 'fatal: ambiguous argument HEAD' }
          : GitDouble.ok())
      },
    })

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('no se pudo medir el commit')
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_status_check_git_refuses_to_answer_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble({ status: GitDouble.refused('git is not available') })

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_state_file_still_visible_to_git_after_seeding_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble({ status: GitDouble.stillVisible() })

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain(SliceSeed.RELATIVE_PATH)
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_cleanup_that_also_fails_after_a_common_dir_refusal_does_not_replace_the_original_failure', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        if (argv.includes('--git-common-dir')) {
          return Promise.resolve({ failed: true, stdout: '', stderr: 'not a git repository' })
        }
        if (argv.includes('remove')) return Promise.reject(new Error('worktree remove refused'))

        return Promise.resolve(GitDouble.ok())
      },
      stderr: (line) => git.stderr.push(line),
    })

    const refusal = await git.workspace().prepare({ number: 42 }).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('no se pudo resolver el directorio común')
    expect(git.stderr.join('')).toContain('worktree remove refused')
  })

  it('a_cleanup_that_fails_names_the_worktree_and_branch_it_could_not_collect', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        if (argv.includes('--git-common-dir')) {
          return Promise.resolve({ failed: true, stdout: '', stderr: 'not a git repository' })
        }
        if (argv.includes('remove')) return Promise.reject(new Error('worktree remove refused'))

        return Promise.resolve(GitDouble.ok())
      },
      stderr: (line) => git.stderr.push(line),
    })

    await git.workspace().prepare({ number: 42 }).catch(() => {})

    const said = git.stderr.join('')
    expect(said).toContain(GitDouble.WORKTREE)
    expect(said).toContain('feat/42')
  })
})

describe('GitWorkspace tells its diagnostic writer when undo itself cannot collect what it created', () => {
  it('a_direct_undo_that_git_refuses_reports_the_worktree_and_branch_left_behind_and_still_throws', async () => {
    const git = new GitDouble()
    const located = await git.workspace().prepare({ number: 42 })
    git.calls = []
    git.stderr = []
    git.workspace = () => new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        if (argv.includes('remove')) return Promise.reject(new Error('worktree remove refused'))

        return Promise.resolve(GitDouble.ok())
      },
      stderr: (line) => git.stderr.push(line),
    })

    const refusal = await git.workspace().undo(located).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(Error)
    expect(refusal.message).toBe('worktree remove refused')
    const said = git.stderr.join('')
    expect(said).toContain(GitDouble.WORKTREE)
    expect(said).toContain('feat/42')
  })

  it('the_default_diagnostic_writer_still_writes_to_the_real_stderr_when_nobody_injects_one', async () => {
    const complaining = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const located = new WorkspaceLocation({ path: GitDouble.WORKTREE, branch: 'feat/42' })
    const workspace = new GitWorkspace({
      root: GitDouble.ROOT,
      base: GitDouble.BASE,
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => (argv.includes('remove')
        ? Promise.reject(new Error('worktree remove refused'))
        : Promise.resolve(GitDouble.ok())),
    })

    try {
      await workspace.undo(located).catch(() => {})

      const said = complaining.mock.calls.map(([line]) => line).join('')
      expect(said).toContain(GitDouble.WORKTREE)
    } finally {
      complaining.mockRestore()
    }
  })
})
