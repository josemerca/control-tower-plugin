import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseStateSafe } from '../../../plugin/scripts/state.js'
import { buildStateSeed } from '../../../plugin/scripts/kickoff.js'
import { resolveStatePath } from '../../../plugin/scripts/state-paths.js'
import { GitWorkspace, SliceSeed } from '../../src/infrastructure/git-workspace.js'
import {
  WorkspaceFailure, WorkspaceNotPrepared, WorkspaceNotRead, WorkspaceNotUnderstood,
} from '../../src/domain/exceptions.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

class GitDouble {
  static ROOT = '/repo/checkout'
  static CHECKOUT = new CheckoutRoot(GitDouble.ROOT)
  static REPOSITORY = new RepositoryName('owner/name')
  static REMOTE_URL = 'git@github.com:owner/name.git'
  static BASE = 'main'
  static DECLARED = `refs/remotes/origin/${GitDouble.BASE}\n`
  static CUT = 'a1b2c3d'
  static COMMON_DIR = '/repo/checkout/.git'
  static WORKTREE = '/repo/checkout/.worktrees/42'
  static EXCLUDE_PATH = `${GitDouble.COMMON_DIR}/info/exclude`

  constructor({ answer, status, existingExclude = null, commonDir, declared, remote } = {}) {
    this.answer = answer ?? GitDouble.ok()
    this.remote = remote ?? GitDouble.naming(GitDouble.REMOTE_URL)
    this.status = status ?? GitDouble.clean()
    this.existingExclude = existingExclude
    this.commonDir = commonDir ?? GitDouble.COMMON_DIR
    this.declared = declared ?? GitDouble.declaring()
    this.calls = []
    this.written = []
    this.reads = []
    this.stderr = []
  }

  workspace() {
    return new GitWorkspace({
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
        return Promise.resolve(this.answering(argv))
      },
      stderr: (line) => {
        this.stderr.push(line)
      },
    })
  }

  answering(argv) {
    if (argv.includes('get-url')) return this.remote
    if (argv.includes('symbolic-ref')) return this.declared
    if (argv.includes('--git-common-dir')) return { failed: false, stdout: `${this.commonDir}\n`, stderr: '' }
    if (argv.includes('HEAD')) return { failed: false, stdout: `${GitDouble.CUT}\n`, stderr: '' }
    if (argv.includes('status')) return this.status
    if (argv.includes('worktree') || argv.includes('branch')) return this.answer
    throw new Error(`nobody wrote an answer for git ${argv.join(' ')}`)
  }

  asking(order) {
    return this.calls.find((argv) => argv.includes(order))
  }

  prepared(issue = { number: 42 }) {
    return this.workspace().prepare({ issue, repository: GitDouble.REPOSITORY, root: GitDouble.CHECKOUT })
  }

  confirmed() {
    return this.workspace().confirm({ root: GitDouble.CHECKOUT, repository: GitDouble.REPOSITORY })
  }

  refusedTo(asking) {
    return asking.catch((cause) => cause)
  }

  cut() {
    return this.asking('worktree')
  }

  static ok() {
    return { failed: false, stdout: '', stderr: '' }
  }

  static declaring(stdout = GitDouble.DECLARED) {
    return { failed: false, stdout, stderr: '' }
  }

  static naming(url) {
    return { failed: false, stdout: `${url}\n`, stderr: '' }
  }

  static declaringNothing(argv) {
    if (argv.includes('get-url')) return GitDouble.naming(GitDouble.REMOTE_URL)

    return argv.includes('symbolic-ref') ? GitDouble.declaring() : null
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

    await git.prepared()

    expect(git.cut()).toEqual([
      '-C', '/repo/checkout',
      'worktree', 'add',
      '-b', 'feat/42',
      '/repo/checkout/.worktrees/42',
      'origin/main',
    ])
  })

  it('the_base_it_cuts_from_is_the_one_the_remote_declares_and_never_a_name_the_backend_assumed', async () => {
    const git = new GitDouble({ declared: GitDouble.declaring('refs/remotes/origin/trunk\n') })

    await git.prepared()

    expect(git.asking('symbolic-ref')).toEqual([
      '-C', GitDouble.ROOT, 'symbolic-ref', 'refs/remotes/origin/HEAD',
    ])
    expect(git.cut().at(-1)).toBe('origin/trunk')
  })

  it('the_base_the_remote_declares_is_the_one_the_seed_records_so_a_rehydrated_agent_reads_the_truth', async () => {
    const git = new GitDouble({ declared: GitDouble.declaring('refs/remotes/origin/trunk\n') })

    await git.prepared()

    expect(parseStateSafe(git.written[1][1]).meta.base).toBe('trunk')
  })

  it('a_remote_that_declares_no_default_branch_stops_before_a_worktree_is_cut_for_nothing', async () => {
    const git = new GitDouble({
      declared: GitDouble.refused('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref'),
    })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('does not declare a default branch')
    expect(git.calls.some((argv) => argv.includes('worktree'))).toBe(false)
  })

  it('git_answering_something_that_is_not_a_remote_head_is_not_guessed_into_a_branch_name', async () => {
    const git = new GitDouble({ declared: GitDouble.declaring('refs/heads/main\n') })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('refs/remotes/origin/HEAD')
    expect(git.calls.some((argv) => argv.includes('worktree'))).toBe(false)
  })

  it('git_answering_no_common_directory_at_all_is_not_pasted_onto_the_root_as_a_dangling_path', async () => {
    const git = new GitDouble({ commonDir: '   ' })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('--git-common-dir')
  })

  it('a_state_file_git_never_hid_after_the_rule_was_written_broke_our_contract_with_git_and_says_so', async () => {
    const git = new GitDouble({ status: GitDouble.stillVisible() })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain(SliceSeed.RELATIVE_PATH)
  })

  it('git_answering_something_unreadable_is_told_apart_from_git_refusing_the_call', async () => {
    const unreadable = await new GitDouble({ declared: GitDouble.declaring('refs/heads/main\n') })
      .prepared().catch((cause) => cause)
    const refused = await new GitDouble({ declared: GitDouble.refused('fatal: no such ref') })
      .prepared().catch((cause) => cause)

    expect(unreadable).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refused).toBeInstanceOf(WorkspaceNotPrepared)
    expect(unreadable).not.toBeInstanceOf(WorkspaceNotPrepared)
    expect(refused).not.toBeInstanceOf(WorkspaceNotUnderstood)
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await new GitDouble({ declared: GitDouble.declaring('refs/heads/main\n') })
      .prepared().catch((cause) => cause)
    const refused = await new GitDouble({ declared: GitDouble.refused('fatal: no such ref') })
      .prepared().catch((cause) => cause)

    expect(unreadable).toBeInstanceOf(WorkspaceFailure)
    expect(refused).toBeInstanceOf(WorkspaceFailure)
  })

  it('confirming_asks_the_remote_of_the_root_it_was_given_and_nothing_else', async () => {
    const git = new GitDouble()

    await git.confirmed()

    expect(git.calls).toEqual([['-C', GitDouble.ROOT, 'remote', 'get-url', 'origin']])
  })

  it('a_root_that_is_a_different_repository_than_the_issue_is_refused_naming_both', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('git@github.com:someone/else.git') })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('someone/else')
    expect(refusal.message).toContain('owner/name')
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('an_https_remote_names_the_same_repository_as_its_ssh_form_so_neither_checkout_is_refused', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('https://github.com/owner/name.git') })

    await expect(git.confirmed()).resolves.toBeUndefined()
  })

  it('an_https_remote_without_the_git_suffix_names_the_same_repository_too', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('https://github.com/owner/name') })

    await expect(git.confirmed()).resolves.toBeUndefined()
  })

  it('a_remote_url_nobody_can_read_a_repository_out_of_is_our_broken_contract_with_git_and_not_a_refusal', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('/some/local/mirror') })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('/some/local/mirror')
  })

  it('a_remote_git_refuses_to_name_at_all_is_a_root_that_cannot_be_read_and_names_the_root', async () => {
    const git = new GitDouble({ remote: GitDouble.refused("fatal: cannot change to '/repo/checkout': No such file or directory") })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(WorkspaceNotRead)
    expect(refusal.message).toContain('No such file or directory')
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('preparing_never_asks_the_remote_again_because_the_root_was_confirmed_at_the_door', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.calls.some((argv) => argv.includes('get-url'))).toBe(false)
    expect(git.calls[0]).toEqual(['-C', GitDouble.ROOT, 'symbolic-ref', 'refs/remotes/origin/HEAD'])
  })

  it('the_location_it_answers_is_where_the_session_will_actually_run_and_the_root_it_was_cut_from', async () => {
    const located = await new GitDouble().prepared()

    expect(located.root).toBe('/repo/checkout')
    expect(located.path).toBe('/repo/checkout/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })

  it('a_git_that_refuses_travels_out_typed_carrying_what_git_said', async () => {
    const git = new GitDouble({ answer: GitDouble.refused("fatal: 'feat/42' is already checked out") })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain("fatal: 'feat/42' is already checked out")
  })

  it('it_never_reuses_a_directory_it_did_not_create_because_git_is_the_one_that_refuses', async () => {
    const git = new GitDouble({ answer: GitDouble.refused('fatal: destination path already exists') })

    await expect(git.prepared({ number: 7 })).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_rule_that_hides_the_state_is_written_before_the_state_itself_in_the_directory_git_actually_reads', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.written.map(([path]) => path)).toEqual([
      GitDouble.EXCLUDE_PATH,
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('the_exclude_rule_it_writes_is_exactly_the_path_of_the_state_file_and_nothing_else', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.written[0][1]).toBe(`${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('a_common_dir_git_answers_as_relative_is_resolved_against_the_root_and_not_kept_as_a_dangling_path', async () => {
    const git = new GitDouble({ commonDir: '.git' })

    await git.prepared()

    expect(git.written[0][0]).toBe(`${GitDouble.ROOT}/.git/info/exclude`)
  })

  it('a_users_existing_exclude_rules_survive_the_seeding_instead_of_being_truncated', async () => {
    const git = new GitDouble({ existingExclude: 'node_modules/\n' })

    await git.prepared()

    expect(git.written[0][1]).toBe(`node_modules/\n${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('an_existing_exclude_file_missing_its_final_newline_does_not_get_the_new_rule_glued_onto_its_last_line', async () => {
    const git = new GitDouble({ existingExclude: 'node_modules/' })

    await git.prepared()

    expect(git.written[0][1]).toBe(`node_modules/\n${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('a_second_seeding_does_not_duplicate_the_rule_because_it_is_already_in_the_shared_exclude_file', async () => {
    const git = new GitDouble({ existingExclude: `node_modules/\n${SliceSeed.RELATIVE_PATH}\n` })

    await git.prepared()

    expect(git.written.map(([path]) => path)).toEqual([
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('a_common_dir_it_cannot_resolve_stops_the_seeding_because_the_state_would_be_visible_to_git', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => Promise.resolve(GitDouble.declaringNothing(argv) ?? (argv.includes('--git-common-dir')
        ? { failed: true, stdout: '', stderr: 'not a git repository' }
        : GitDouble.ok())),
    })

    await expect(git.prepared()).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_state_it_seeds_carries_the_cut_it_measured_in_the_worktree_and_not_the_one_it_guessed', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(parseStateSafe(git.written[1][1]).meta.base_sha).toBe(GitDouble.CUT)
  })

  it('the_state_it_seeds_names_the_gate_that_holds_this_slice_because_the_skill_reads_it_from_there', async () => {
    const git = new GitDouble()

    await git.prepared()

    const gates = parseStateSafe(git.written[1][1]).meta.gates
    expect(gates).toContain('plan — GATE HUMANO pendiente')
    expect(gates).toContain('lo cierra una persona desde la app')
    expect(gates).toContain('`-REVIEW`')
  })

  it('the_gate_it_seeds_says_the_gates_section_of_the_issue_describes_another_flow', async () => {
    const git = new GitDouble()

    await git.prepared()

    const gates = parseStateSafe(git.written[1][1]).meta.gates
    expect(gates).toContain('la sección "## Gates" del issue describe el carril de /ct-next')
    expect(gates).not.toMatch(/revisa (el PR|la pull request)/)
    expect(gates).not.toMatch(/-OK/)
  })

  it('a_head_it_cannot_measure_stops_the_seeding_instead_of_writing_a_state_without_a_cut', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => Promise.resolve(GitDouble.declaringNothing(argv) ?? (argv.includes('HEAD')
        ? { failed: true, stdout: '', stderr: 'fatal: ambiguous argument HEAD' }
        : argv.includes('--git-common-dir')
          ? { failed: false, stdout: `${GitDouble.COMMON_DIR}\n`, stderr: '' }
          : GitDouble.ok()))
    })

    await expect(git.prepared()).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_check_that_the_state_stays_hidden_asks_git_with_untracked_files_all_so_a_whole_untracked_directory_cannot_collapse_into_one_line', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.calls.at(-1)).toEqual([
      '-C', GitDouble.WORKTREE, 'status', '--porcelain', '--untracked-files=all',
    ])
  })

  it('a_status_check_that_git_refuses_to_answer_is_not_taken_for_a_clean_tree', async () => {
    const git = new GitDouble({ status: GitDouble.refused('git is not available') })

    await expect(git.prepared()).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('undoing_a_location_removes_the_worktree_and_deletes_the_branch_it_was_cut_on', async () => {
    const git = new GitDouble()
    const located = await git.prepared()
    git.calls = []

    await git.workspace().undo(located)

    expect(git.calls).toEqual([
      ['-C', GitDouble.ROOT, 'worktree', 'remove', '--force', GitDouble.WORKTREE],
      ['-C', GitDouble.ROOT, 'branch', '-D', 'feat/42'],
    ])
  })

  it('undoing_a_location_runs_both_orders_against_the_root_the_location_carries_and_never_against_the_process_directory', async () => {
    const git = new GitDouble()
    const located = new WorkspaceLocation({ root: '/elsewhere/clone', path: '/elsewhere/clone/.worktrees/42', branch: 'feat/42' })

    await git.workspace().undo(located)

    expect(git.calls).toEqual([
      ['-C', '/elsewhere/clone', 'worktree', 'remove', '--force', '/elsewhere/clone/.worktrees/42'],
      ['-C', '/elsewhere/clone', 'branch', '-D', 'feat/42'],
    ])
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
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        return Promise.resolve(GitDouble.declaringNothing(argv) ?? (argv.includes('--git-common-dir')
          ? { failed: true, stdout: '', stderr: 'not a git repository' }
          : GitDouble.ok()))
      },
    })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('could not resolve the common git directory')
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_head_git_cannot_measure_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        return Promise.resolve(GitDouble.declaringNothing(argv) ?? (argv.includes('HEAD')
          ? { failed: true, stdout: '', stderr: 'fatal: ambiguous argument HEAD' }
          : argv.includes('--git-common-dir')
            ? { failed: false, stdout: `${GitDouble.COMMON_DIR}\n`, stderr: '' }
            : GitDouble.ok()))
      },
    })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('could not measure the commit')
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_status_check_git_refuses_to_answer_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble({ status: GitDouble.refused('git is not available') })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_state_file_still_visible_to_git_after_seeding_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble({ status: GitDouble.stillVisible() })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain(SliceSeed.RELATIVE_PATH)
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_cleanup_that_also_fails_after_a_common_dir_refusal_does_not_replace_the_original_failure', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        if (argv.includes('get-url')) return Promise.resolve(GitDouble.naming(GitDouble.REMOTE_URL))
        if (argv.includes('symbolic-ref')) return Promise.resolve(GitDouble.declaring())
        if (argv.includes('--git-common-dir')) {
          return Promise.resolve({ failed: true, stdout: '', stderr: 'not a git repository' })
        }
        if (argv.includes('remove')) return Promise.reject(new Error('worktree remove refused'))

        return Promise.resolve(GitDouble.ok())
      },
      stderr: (line) => git.stderr.push(line),
    })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('could not resolve the common git directory')
    expect(git.stderr.join('')).toContain('worktree remove refused')
  })

  it('a_cleanup_that_fails_names_the_worktree_and_branch_it_could_not_collect', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      run: (argv) => {
        git.calls.push(argv)
        if (argv.includes('get-url')) return Promise.resolve(GitDouble.naming(GitDouble.REMOTE_URL))
        if (argv.includes('symbolic-ref')) return Promise.resolve(GitDouble.declaring())
        if (argv.includes('--git-common-dir')) {
          return Promise.resolve({ failed: true, stdout: '', stderr: 'not a git repository' })
        }
        if (argv.includes('remove')) return Promise.reject(new Error('worktree remove refused'))

        return Promise.resolve(GitDouble.ok())
      },
      stderr: (line) => git.stderr.push(line),
    })

    await git.prepared().catch(() => {})

    const said = git.stderr.join('')
    expect(said).toContain(GitDouble.WORKTREE)
    expect(said).toContain('feat/42')
  })
})

describe('GitWorkspace tells its diagnostic writer when undo itself cannot collect what it created', () => {
  it('a_direct_undo_that_git_refuses_reports_the_worktree_and_branch_left_behind_and_still_throws', async () => {
    const git = new GitDouble()
    const located = await git.prepared()
    git.calls = []
    git.stderr = []
    git.workspace = () => new GitWorkspace({
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
    const located = new WorkspaceLocation({ root: GitDouble.ROOT, path: GitDouble.WORKTREE, branch: 'feat/42' })
    const workspace = new GitWorkspace({
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

class SeedFixture {
  static CUT = 'a1b2c3d'
  static #made = []

  static text() {
    return SliceSeed.textFor({
      issue: { number: 42 }, branch: 'feat/42', base: 'main', cut: SeedFixture.CUT,
    })
  }

  static sownWorktree() {
    const worktree = mkdtempSync(join(tmpdir(), 'ct-slice-'))
    SeedFixture.#made.push(worktree)
    const state = join(worktree, SliceSeed.RELATIVE_PATH)
    mkdirSync(dirname(state), { recursive: true })
    writeFileSync(state, SeedFixture.text())

    return worktree
  }

  static sweep() {
    for (const worktree of SeedFixture.#made.splice(0)) {
      rmSync(worktree, { recursive: true, force: true })
    }
  }
}

describe('SliceSeed', () => {
  it('it_says_the_agent_is_the_one_that_writes_the_plan_and_not_the_coordinator', () => {
    expect(parseStateSafe(SeedFixture.text()).meta.role).toMatch(/^slice-agent/)
  })

  it('the_cut_travels_as_both_the_base_and_the_last_commit_because_no_work_has_landed_yet', () => {
    const { meta } = parseStateSafe(SeedFixture.text())

    expect(meta.base_sha).toBe(SeedFixture.CUT)
    expect(meta.last_commit).toBe(SeedFixture.CUT)
  })

  it('it_names_the_issue_so_an_agent_that_rehydrates_knows_what_it_is_working_on', () => {
    const { meta } = parseStateSafe(SeedFixture.text())

    expect(meta.github_issue).toBe(42)
    expect(meta.branch).toBe('feat/42')
    expect(meta.base).toBe('main')
  })

  it('the_exclusion_it_asks_git_for_is_the_very_file_it_writes', () => {
    expect(SliceSeed.EXCLUDE_RULE).toBe(SliceSeed.RELATIVE_PATH)
  })

  it('the_exclude_file_hangs_off_the_git_dir_and_not_off_the_worktree_because_dot_git_is_a_file_there', () => {
    expect(SliceSeed.EXCLUDE_PATH.startsWith('.git/')).toBe(false)
    expect(SliceSeed.EXCLUDE_PATH).toBe('info/exclude')
  })
})

class PluginSeed {
  static NOT_OURS = Object.freeze({
    epic: 'the plan of one issue belongs to no milestone: the epic is groomed, this is not',
    senal: 'an observability signal is declared by an implementation slice, not by writing a plan',
    gates: 'the human gates close on the pull request of an implementation, and no plan opens one',
    e2e: 'a plan walks no end-to-end run: it is written and committed, nothing is exercised',
    tasks: 'the tasks are what the plan itself declares, so seeding them would prejudge it',
    verify: 'the verification of a plan is --check-plan, which the errand already names',
  })

  static keys() {
    return Object.keys(parseStateSafe(buildStateSeed(
      { name: 'a slice', issue: '#42', ac: ['does the thing'] },
      { branch: 'feat/42', base: 'main', baseSha: SeedFixture.CUT }
    )).meta)
  }

  static expectedOfUs() {
    return PluginSeed.keys().filter((key) => !(key in PluginSeed.NOT_OURS))
  }
}

describe('what the backend sows is read back by the plugin that has to read it', () => {
  afterEach(() => {
    SeedFixture.sweep()
  })

  it('the_plugins_own_reader_parses_the_seed_without_an_error_instead_of_the_two_halves_drifting', () => {
    const worktree = SeedFixture.sownWorktree()

    const read = parseStateSafe(readFileSync(join(worktree, SliceSeed.RELATIVE_PATH), 'utf8'))

    expect(read.error).toBe(null)
  })

  it('the_cut_and_the_absence_of_a_block_reach_the_plugin_as_data_and_not_as_unparsed_prose', () => {
    const worktree = SeedFixture.sownWorktree()

    const read = parseStateSafe(readFileSync(join(worktree, SliceSeed.RELATIVE_PATH), 'utf8'))

    expect(read.meta.last_commit).toBe(SeedFixture.CUT)
    expect(read.meta.blocked).toBe(null)
  })

  it('a_branch_carrying_a_quote_is_serialised_instead_of_breaking_the_yaml_the_plugin_has_to_parse', () => {
    const text = SliceSeed.textFor({
      issue: { number: 42 }, branch: 'feat/42-"quoted"', base: 'main', cut: SeedFixture.CUT,
    })

    const read = parseStateSafe(text)

    expect(read.error).toBe(null)
    expect(read.meta.branch).toBe('feat/42-"quoted"')
  })

  it('every_field_the_plugins_own_seed_carries_is_carried_here_too_except_the_ones_declared_not_to_apply', () => {
    const ours = Object.keys(parseStateSafe(SeedFixture.text()).meta)

    expect(PluginSeed.expectedOfUs().filter((key) => !ours.includes(key))).toEqual([])
  })

  it('the_plan_is_already_under_way_when_this_is_sown_so_it_says_so_where_the_plugin_seeds_not_started', () => {
    expect(parseStateSafe(SeedFixture.text()).meta.status).toBe('in_progress')
    expect(parseStateSafe(buildStateSeed(
      { name: 'a slice', issue: '#42', ac: ['does the thing'] },
      { branch: 'feat/42', base: 'main', baseSha: SeedFixture.CUT }
    )).meta.status).toBe('not_started')
  })

  it('a_worktree_that_carries_the_seed_is_recognised_by_the_plugin_as_a_slice_and_not_as_a_coordinator', () => {
    const worktree = SeedFixture.sownWorktree()

    expect(resolveStatePath(worktree).kind).toBe('slice')
  })
})

class SurveyDouble extends GitDouble {
  static PORCELAIN = [
    'worktree /repo/checkout',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/main',
    '',
    'worktree /repo/elsewhere/11',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/feat/11',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /repo/checkout/.worktrees/13',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/hotfix',
    'locked manual hold',
    '',
    'worktree /repo/checkout/.worktrees/42',
    'HEAD 9a8b7c6d5e4f30211f0e9d8c7b6a5948372615ff',
    'branch refs/heads/feat/42',
    '',
    'worktree /repo/checkout/.worktrees/7',
    'HEAD 4f2c1ab9d3e5c7081b6a0f2d9e4c8b1a5d3f7e60',
    'branch refs/heads/feat/7',
    '',
    'worktree /repo/checkout/.worktrees/9',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'detached',
    '',
    'worktree /repo/checkout/.worktrees/notes',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/feat/notes',
    '',
    'worktree /repo/checkout/.worktrees/0',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/feat/0',
    '',
    '',
  ].join('\n')

  constructor({ listed, remote } = {}) {
    super({ remote })
    this.listed = listed ?? SurveyDouble.listing()
  }

  answering(argv) {
    if (argv.includes('list')) return this.listed

    return super.answering(argv)
  }

  surveyed() {
    return this.workspace().survey(GitDouble.CHECKOUT)
  }

  refusal() {
    return this.surveyed().catch((cause) => cause)
  }

  numbers() {
    return this.surveyed().then((survey) => survey.prepared.map((prepared) => prepared.issueNumber))
  }

  static listing(stdout = SurveyDouble.PORCELAIN) {
    return { failed: false, stdout, stderr: '' }
  }
}

describe('GitWorkspace surveying the checkout', () => {
  it('the_checkout_is_asked_for_its_worktrees_in_the_form_that_is_a_contract_and_not_a_display', async () => {
    const git = new SurveyDouble()

    await git.surveyed()

    expect(git.asking('list')).toEqual(['-C', '/repo/checkout', 'worktree', 'list', '--porcelain'])
  })

  it('every_worktree_the_backend_prepared_comes_back_with_the_issue_it_belongs_to_and_where_it_sits', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.issueNumber)).toEqual([42, 7])
    expect(surveyed.prepared.map((prepared) => prepared.located.path)).toEqual([
      '/repo/checkout/.worktrees/42',
      '/repo/checkout/.worktrees/7',
    ])
    expect(surveyed.prepared.map((prepared) => prepared.located.branch)).toEqual(['feat/42', 'feat/7'])
  })

  it('the_checkout_itself_is_not_a_prepared_workspace_so_the_sweep_never_asks_to_collect_the_repository', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.path)).not.toContain('/repo/checkout')
  })

  it('a_worktree_on_a_branch_shaped_like_ours_that_sits_somewhere_else_is_not_ours_because_the_layout_names_it', async () => {
    expect(await new SurveyDouble().numbers()).not.toContain(11)
  })

  it('a_detached_worktree_under_our_directory_is_left_alone_instead_of_being_taken_for_the_branch_it_is_not', async () => {
    expect(await new SurveyDouble().numbers()).not.toContain(9)
  })

  it('a_worktree_under_our_directory_on_a_branch_that_is_not_the_one_we_cut_is_left_alone', async () => {
    expect(await new SurveyDouble().numbers()).not.toContain(13)
  })

  it('a_directory_under_the_worktrees_that_is_not_an_issue_number_is_not_an_issue_however_well_its_branch_reads', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.path))
      .not.toContain('/repo/checkout/.worktrees/notes')
  })

  it('the_repository_the_survey_names_is_the_one_the_origin_declares_and_never_one_the_backend_assumed', async () => {
    const git = new SurveyDouble()

    const surveyed = await git.surveyed()

    expect(git.asking('get-url')).toEqual(['-C', '/repo/checkout', 'remote', 'get-url', 'origin'])
    expect(surveyed.repository).toBeInstanceOf(RepositoryName)
    expect(surveyed.repository.text).toBe('owner/name')
  })

  it('a_git_that_cannot_list_the_worktrees_travels_out_typed_carrying_what_git_said', async () => {
    const refusal = await new SurveyDouble({
      listed: SurveyDouble.refused('fatal: not a git repository (or any of the parent directories): .git'),
    }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotRead)
    expect(refusal.message).toContain('fatal: not a git repository')
  })

  it('an_origin_nobody_can_read_a_repository_out_of_stops_the_survey_instead_of_naming_one_we_invented', async () => {
    const refusal = await new SurveyDouble({ remote: SurveyDouble.naming('/some/local/mirror') }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('/some/local/mirror')
  })

  it('an_answer_that_is_not_porcelain_at_all_is_our_broken_contract_with_git_and_not_a_checkout_without_worktrees', async () => {
    const refusal = await new SurveyDouble({
      listed: SurveyDouble.listing('/repo/checkout          368980b [main]\n'),
    }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('"/repo/checkout          368980b [main]"')
  })

  it('a_git_that_printed_nothing_is_not_a_checkout_that_holds_no_worktrees', async () => {
    const refusal = await new SurveyDouble({ listed: SurveyDouble.listing('') }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('always lists at least itself')
  })

  it('the_two_ways_a_survey_can_fail_are_told_apart_and_still_share_the_family_a_caller_can_catch', async () => {
    const refused = await new SurveyDouble({ listed: SurveyDouble.refused('fatal: no worktrees') }).refusal()
    const unreadable = await new SurveyDouble({ listed: SurveyDouble.listing('nonsense\n') }).refusal()

    expect(refused).toBeInstanceOf(WorkspaceNotRead)
    expect(unreadable).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refused).not.toBeInstanceOf(WorkspaceNotUnderstood)
    expect(unreadable).not.toBeInstanceOf(WorkspaceNotRead)
    expect(refused).toBeInstanceOf(WorkspaceFailure)
    expect(unreadable).toBeInstanceOf(WorkspaceFailure)
  })

  it('a_directory_numbered_zero_is_kept_out_by_the_guard_because_issues_are_numbered_from_one', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.path))
      .not.toContain('/repo/checkout/.worktrees/0')
  })

  it('an_origin_that_reads_as_owner_slash_name_but_is_not_one_never_becomes_an_argument_of_the_harvest', async () => {
    const refusal = await new SurveyDouble({
      remote: SurveyDouble.naming('git@github.com:ow ner/na me.git'),
    }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('ow ner/na me')
  })

  it('every_prepared_workspace_the_survey_answers_carries_the_root_it_was_surveyed_from', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.root)).toEqual(['/repo/checkout', '/repo/checkout'])
  })
})
