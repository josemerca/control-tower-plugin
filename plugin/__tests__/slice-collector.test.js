import { describe, it, expect } from 'vitest'
import { DeliveryState } from '../scripts/slice-collection.js'
import { CollectionOutcome, CollectionRead, SliceCollector } from '../scripts/slice-collector.js'
import { RunnerAnswer, ScriptedRunner } from './fixtures/scripted-runner.js'

class Conversation {
  constructor({ gh, git, cmux, workspace }) {
    this.spoken = []
    this.gh = new ScriptedRunner({ program: 'gh', answers: gh, spoken: this.spoken })
    this.git = new ScriptedRunner({ program: 'git', answers: git, spoken: this.spoken })
    this.cmux = new ScriptedRunner({ program: 'cmux', answers: cmux, spoken: this.spoken })
    this.workspace = new ScriptedRunner({ program: 'find-workspace', answers: workspace, spoken: this.spoken })
  }

  get collector() {
    return new SliceCollector({
      gh: this.gh.forArgv,
      git: this.git.forArgv,
      cmux: this.cmux.forArgv,
      findWorkspace: this.workspace.forCwd,
    })
  }
}

class SliceOnDisk {
  static MAIN_ROOT = '/checkout'
  static WORKTREE = '/checkout/.worktrees/7'
  static BRANCH = 'feat/7'

  static worktreeAndBranch() {
    return { known: true, mainRoot: SliceOnDisk.MAIN_ROOT, worktree: SliceOnDisk.WORKTREE, branch: SliceOnDisk.BRANCH, hasWorktree: true, hasBranch: true }
  }

  static worktreeWithoutItsBranch() {
    return { ...SliceOnDisk.worktreeAndBranch(), hasBranch: false }
  }

  static nothingLeft() {
    return { ...SliceOnDisk.worktreeAndBranch(), hasWorktree: false, hasBranch: false }
  }

  static aDiskThatCouldNotBeRead() {
    return { known: false }
  }
}

class GitHubTranscript {
  static MERGED_HEAD = '9f8a01d9b6cf0d0a2b7f6d5e4c3b2a1908f7e6d5'
  static ANOTHER_HEAD = '1122334455667788990011223344556677889900'

  static mergedAt(headRefOid) {
    return `[{"headRefOid":"${headRefOid}","number":71,"state":"MERGED"}]\n`
  }

  static stillOpen() {
    return '[{"headRefOid":"1122334455667788990011223344556677889900","number":71,"state":"OPEN"}]\n'
  }

  static closedWithoutMerging() {
    return '[{"headRefOid":"1122334455667788990011223344556677889900","number":71,"state":"CLOSED"}]\n'
  }

  static noPullRequestAtAll() {
    return '[]\n'
  }

  static somethingThatIsNotJson() {
    return 'gh: could not resolve to a Repository\n'
  }
}

class CollectionCase {
  static REPO = 'o/r'
  static PR_LIST = 'pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10'
  static STATUS = '-C /checkout/.worktrees/7 status --porcelain --untracked-files=all'
  static TIP = '-C /checkout rev-parse --verify --quiet refs/heads/feat/7'
  static REMOVE_WORKTREE = '-C /checkout worktree remove --force /checkout/.worktrees/7'
  static DELETE_BRANCH = '-C /checkout branch -D feat/7'
  static CLOSE_WORKSPACE = 'close-workspace --workspace workspace:3'

  static aMergedSliceThatIsSafeToCollect() {
    return new Conversation({
      gh: { [CollectionCase.PR_LIST]: RunnerAnswer.ok(GitHubTranscript.mergedAt(GitHubTranscript.MERGED_HEAD)) },
      git: {
        [CollectionCase.STATUS]: RunnerAnswer.ok(''),
        [CollectionCase.TIP]: RunnerAnswer.ok(`${GitHubTranscript.MERGED_HEAD}\n`),
        [CollectionCase.REMOVE_WORKTREE]: RunnerAnswer.ok(''),
        [CollectionCase.DELETE_BRANCH]: RunnerAnswer.ok('Deleted branch feat/7 (was 9f8a01d).\n'),
      },
      cmux: { [CollectionCase.CLOSE_WORKSPACE]: RunnerAnswer.ok('') },
      workspace: { [SliceOnDisk.WORKTREE]: { consultado: true, ref: 'workspace:3' } },
    })
  }

  static collectedFrom(conversation, artifacts = SliceOnDisk.worktreeAndBranch()) {
    return conversation.collector.collect({ artifacts, repo: CollectionCase.REPO })
  }

  static rehearsedFrom(conversation, artifacts = SliceOnDisk.worktreeAndBranch()) {
    return conversation.collector.rehearse({ artifacts, repo: CollectionCase.REPO })
  }
}

describe('a merged slice is collected in one order and never in another', () => {
  it('a_merged_pull_request_with_a_clean_tree_at_the_tip_it_merged_is_collected', () => {
    const report = CollectionCase.collectedFrom(CollectionCase.aMergedSliceThatIsSafeToCollect())
    expect(report.outcome).toBe(CollectionOutcome.COLLECTED)
    expect(report.pending).toEqual([])
    expect(report.done.map((command) => command.line)).toEqual([
      'cmux close-workspace --workspace workspace:3',
      'git -C /checkout worktree remove --force /checkout/.worktrees/7',
      'git -C /checkout branch -D feat/7',
    ])
  })

  it('the_cmux_workspace_is_closed_before_the_worktree_goes_and_the_branch_goes_last', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    CollectionCase.collectedFrom(conversation)
    expect(conversation.spoken).toEqual([
      'gh pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10',
      'git -C /checkout/.worktrees/7 status --porcelain --untracked-files=all',
      'git -C /checkout rev-parse --verify --quiet refs/heads/feat/7',
      'find-workspace /checkout/.worktrees/7',
      'cmux close-workspace --workspace workspace:3',
      'git -C /checkout worktree remove --force /checkout/.worktrees/7',
      'git -C /checkout branch -D feat/7',
    ])
  })

  it('a_slice_whose_agent_is_already_gone_is_collected_with_git_alone', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.workspace.answers[SliceOnDisk.WORKTREE] = { consultado: true, ref: null }
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.COLLECTED)
    expect(report.done.map((command) => command.line)).toEqual([
      'git -C /checkout worktree remove --force /checkout/.worktrees/7',
      'git -C /checkout branch -D feat/7',
    ])
  })

  it('a_worktree_left_without_its_branch_is_collected_without_asking_git_for_a_tip', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    const report = CollectionCase.collectedFrom(conversation, SliceOnDisk.worktreeWithoutItsBranch())
    expect(report.outcome).toBe(CollectionOutcome.COLLECTED)
    expect(conversation.spoken).not.toContain('git -C /checkout rev-parse --verify --quiet refs/heads/feat/7')
    expect(report.done.map((command) => command.line)).toEqual([
      'cmux close-workspace --workspace workspace:3',
      'git -C /checkout worktree remove --force /checkout/.worktrees/7',
    ])
  })

  it('a_tip_that_arrives_with_the_newline_git_prints_is_still_the_tip_the_pull_request_merged', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.git.answers[CollectionCase.TIP] = RunnerAnswer.ok(`${GitHubTranscript.MERGED_HEAD}\n`)
    expect(CollectionCase.collectedFrom(conversation).outcome).toBe(CollectionOutcome.COLLECTED)
  })
})

describe('what the policy refuses to collect is never touched', () => {
  it('an_open_pull_request_is_waited_on_with_the_state_it_was_read_in', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.gh.answers[CollectionCase.PR_LIST] = RunnerAnswer.ok(GitHubTranscript.stillOpen())
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.WAITING)
    expect(report.delivery.state).toBe(DeliveryState.OPEN)
    expect(report.delivery.number).toBe(71)
    expect(conversation.spoken).toEqual([
      'gh pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10',
      'git -C /checkout/.worktrees/7 status --porcelain --untracked-files=all',
      'git -C /checkout rev-parse --verify --quiet refs/heads/feat/7',
    ])
  })

  it('a_pull_request_closed_without_merging_is_waited_on_and_not_collected', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.gh.answers[CollectionCase.PR_LIST] = RunnerAnswer.ok(GitHubTranscript.closedWithoutMerging())
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.WAITING)
    expect(report.delivery.state).toBe(DeliveryState.ABANDONED)
  })

  it('a_branch_with_no_pull_request_at_all_is_waited_on_and_not_collected', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.gh.answers[CollectionCase.PR_LIST] = RunnerAnswer.ok(GitHubTranscript.noPullRequestAtAll())
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.WAITING)
    expect(report.delivery.state).toBe(DeliveryState.NOT_OPENED)
  })

  it('a_tree_with_uncommitted_changes_is_kept_and_cmux_is_not_even_asked', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.git.answers[CollectionCase.STATUS] = RunnerAnswer.ok(' M scripts/dispatch-check.mjs\n?? nota.txt\n')
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.KEPT_DIRTY_TREE)
    expect(report.done).toEqual([])
    expect(conversation.spoken).not.toContain('find-workspace /checkout/.worktrees/7')
  })

  it('a_local_tip_that_is_not_the_commit_the_pull_request_merged_is_kept', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.git.answers[CollectionCase.TIP] = RunnerAnswer.ok(`${GitHubTranscript.ANOTHER_HEAD}\n`)
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.KEPT_TIP_NOT_MERGED)
    expect(report.delivery.headRefOid).toBe(GitHubTranscript.MERGED_HEAD)
    expect(report.done).toEqual([])
  })

  it('a_disk_with_neither_worktree_nor_branch_has_nothing_left_and_runs_no_command', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    const report = CollectionCase.collectedFrom(conversation, SliceOnDisk.nothingLeft())
    expect(report.outcome).toBe(CollectionOutcome.NOTHING_LEFT)
    expect(conversation.spoken).toEqual([
      'gh pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10',
    ])
  })

  it('a_rehearsal_answers_the_commands_it_would_run_and_runs_none_of_them', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    const report = CollectionCase.rehearsedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.WOULD_COLLECT)
    expect(report.done).toEqual([])
    expect(report.pending.map((command) => command.line)).toEqual([
      'cmux close-workspace --workspace workspace:3',
      'git -C /checkout worktree remove --force /checkout/.worktrees/7',
      'git -C /checkout branch -D feat/7',
    ])
    expect(conversation.spoken).toEqual([
      'gh pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10',
      'git -C /checkout/.worktrees/7 status --porcelain --untracked-files=all',
      'git -C /checkout rev-parse --verify --quiet refs/heads/feat/7',
      'find-workspace /checkout/.worktrees/7',
    ])
  })
})

describe('execute runs exactly the commands a rehearsal already decided', () => {
  it('execute_runs_the_rehearsed_commands_without_asking_github_again', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    const rehearsed = CollectionCase.rehearsedFrom(conversation)
    const report = conversation.collector.execute(rehearsed)
    expect(report.outcome).toBe(CollectionOutcome.COLLECTED)
    expect(conversation.spoken.filter((line) => line.startsWith('gh ')).length).toBe(1)
  })

  it('execute_refuses_a_report_that_is_not_would_collect', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.gh.answers[CollectionCase.PR_LIST] = RunnerAnswer.ok(GitHubTranscript.stillOpen())
    const rehearsed = CollectionCase.rehearsedFrom(conversation)
    expect(() => conversation.collector.execute(rehearsed))
      .toThrow('SliceCollector.execute needs a would-collect report, got "waiting"')
  })
})

describe('a read that failed is a read that failed, never an empty answer', () => {
  it('a_pull_request_list_that_could_not_be_read_is_not_a_branch_without_a_pull_request', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.gh.answers[CollectionCase.PR_LIST] = RunnerAnswer.failed(1, 'gh: HTTP 502\n')
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.NOT_READ)
    expect(report.read).toBe(CollectionRead.PULL_REQUEST_LIST)
    expect(report.detail).toBe('exit code 1: gh: HTTP 502')
    expect(report.delivery).toBe(null)
    expect(conversation.spoken).toEqual([
      'gh pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10',
    ])
  })

  it('a_pull_request_list_that_is_not_json_is_a_read_that_failed_and_quotes_what_gh_printed', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.gh.answers[CollectionCase.PR_LIST] = RunnerAnswer.ok(GitHubTranscript.somethingThatIsNotJson())
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.NOT_READ)
    expect(report.read).toBe(CollectionRead.PULL_REQUEST_LIST)
    expect(report.detail).toContain(GitHubTranscript.somethingThatIsNotJson())
  })

  it('a_git_status_that_could_not_be_read_is_not_a_clean_tree', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.git.answers[CollectionCase.STATUS] = RunnerAnswer.failed(128, 'fatal: not a git repository\n')
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.NOT_READ)
    expect(report.read).toBe(CollectionRead.WORKING_TREE_STATUS)
    expect(report.detail).toBe('exit code 128: fatal: not a git repository')
    expect(conversation.spoken).not.toContain('git -C /checkout worktree remove --force /checkout/.worktrees/7')
  })

  it('a_tip_that_could_not_be_read_is_not_a_branch_that_agrees_with_the_pull_request', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.git.answers[CollectionCase.TIP] = RunnerAnswer.failed(1, '')
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.NOT_READ)
    expect(report.read).toBe(CollectionRead.LOCAL_TIP)
    expect(report.detail).toBe('exit code 1: (it printed nothing on its error channel)')
  })

  it('a_tip_that_is_not_a_commit_is_a_read_that_failed_and_not_a_tip_to_compare', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.git.answers[CollectionCase.TIP] = RunnerAnswer.ok('\n')
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.NOT_READ)
    expect(report.read).toBe(CollectionRead.LOCAL_TIP)
    expect(report.detail).toBe('printed something that is not a commit: ""')
  })

  it('a_cmux_that_could_not_be_asked_stops_the_collection_before_anything_is_removed', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.workspace.answers[SliceOnDisk.WORKTREE] = { consultado: false, ref: null }
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.NOT_READ)
    expect(report.read).toBe(CollectionRead.CMUX_WORKSPACE)
    expect(report.detail).toBe('cmux could not be asked which workspace sits in /checkout/.worktrees/7')
    expect(conversation.spoken).toEqual([
      'gh pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10',
      'git -C /checkout/.worktrees/7 status --porcelain --untracked-files=all',
      'git -C /checkout rev-parse --verify --quiet refs/heads/feat/7',
      'find-workspace /checkout/.worktrees/7',
    ])
  })
})

describe('a step that failed after another one mutated leaves the rest written down', () => {
  it('a_worktree_that_git_refused_to_remove_leaves_both_git_commands_pending_and_separate', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.git.answers[CollectionCase.REMOVE_WORKTREE] = RunnerAnswer.failed(128, 'fatal: validation failed, cannot remove working tree\n')
    conversation.git.answers[CollectionCase.DELETE_BRANCH] = RunnerAnswer.failed(1, "error: cannot delete branch 'feat/7' used by worktree\n")
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.PARTIAL)
    expect(report.done.map((command) => command.line)).toEqual(['cmux close-workspace --workspace workspace:3'])
    expect(report.pending.map((command) => command.line)).toEqual([
      'git -C /checkout worktree remove --force /checkout/.worktrees/7',
      'git -C /checkout branch -D feat/7',
    ])
    expect(report.detail).toBe([
      'git -C /checkout worktree remove --force /checkout/.worktrees/7 failed with exit code 128: fatal: validation failed, cannot remove working tree',
      "git -C /checkout branch -D feat/7 failed with exit code 1: error: cannot delete branch 'feat/7' used by worktree",
    ].join('; '))
  })

  it('a_cmux_close_that_failed_does_not_stop_the_worktree_and_the_branch_from_going', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.cmux.answers[CollectionCase.CLOSE_WORKSPACE] = RunnerAnswer.failed(1, 'cmux: close-workspace failed\n')
    const report = CollectionCase.collectedFrom(conversation)
    expect(report.outcome).toBe(CollectionOutcome.PARTIAL)
    expect(report.pending.map((command) => command.line)).toEqual(['cmux close-workspace --workspace workspace:3'])
    expect(report.done.map((command) => command.line)).toEqual([
      'git -C /checkout worktree remove --force /checkout/.worktrees/7',
      'git -C /checkout branch -D feat/7',
    ])
  })
})

describe('what the collector refuses to guess', () => {
  it('a_disk_that_could_not_be_read_is_a_caller_bug_and_not_a_slice_with_nothing_left', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    expect(() => CollectionCase.collectedFrom(conversation, SliceOnDisk.aDiskThatCouldNotBeRead()))
      .toThrow('SliceCollector needs the artifacts of a disk that could be read')
  })

  it('a_cmux_answer_whose_shape_changed_raises_instead_of_passing_for_no_workspace', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.workspace.answers[SliceOnDisk.WORKTREE] = { ref: 'workspace:3' }
    expect(() => CollectionCase.collectedFrom(conversation))
      .toThrow('the cmux lookup answered without saying whether cmux could be asked')
  })

  it('a_runner_that_does_not_answer_with_an_exit_code_raises_instead_of_being_read_as_empty', () => {
    const conversation = CollectionCase.aMergedSliceThatIsSafeToCollect()
    conversation.gh.answers[CollectionCase.PR_LIST] = GitHubTranscript.mergedAt(GitHubTranscript.MERGED_HEAD)
    expect(() => CollectionCase.collectedFrom(conversation))
      .toThrow('the runner of gh pr list must answer { code, stdout, stderr }')
  })
})
