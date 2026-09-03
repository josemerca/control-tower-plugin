import { describe, it, expect } from 'vitest'
import {
  CollectionCommands,
  CollectionPolicy,
  CollectionStep,
  Delivery,
  DeliveryState,
  PullRequestState,
} from '../scripts/slice-collection.js'

class PullRequestListMother {
  static MERGED_HEAD = 'd678257f182a1b57c160dd3902ee01d2d80aa8ea'
  static LATER_MERGED_HEAD = '4db5f9d9592f9fddca46e20388b0e71169b717d5'

  static whatGhPrintedForPullRequest68() {
    return '[{"headRefOid":"d678257f182a1b57c160dd3902ee01d2d80aa8ea","mergeCommit":{"oid":"4db5f9d9592f9fddca46e20388b0e71169b717d5"},"mergedAt":"2026-09-02T15:51:36Z","number":68,"state":"MERGED"}]'
  }

  static nothingOpenedYet() {
    return '[]'
  }

  static oneClosedPullRequest() {
    return '[{"headRefOid":"2222222222222222222222222222222222222222","number":66,"state":"CLOSED"}]'
  }

  static anOpenOneBesideAClosedOne() {
    return '[{"headRefOid":"1111111111111111111111111111111111111111","number":70,"state":"OPEN"},{"headRefOid":"2222222222222222222222222222222222222222","number":66,"state":"CLOSED"}]'
  }

  static aMergedOneBesideAnOpenOne() {
    return '[{"headRefOid":"1111111111111111111111111111111111111111","number":70,"state":"OPEN"},{"headRefOid":"d678257f182a1b57c160dd3902ee01d2d80aa8ea","number":68,"state":"MERGED"}]'
  }

  static twoMergedPullRequests() {
    return '[{"headRefOid":"d678257f182a1b57c160dd3902ee01d2d80aa8ea","number":68,"state":"MERGED"},{"headRefOid":"4db5f9d9592f9fddca46e20388b0e71169b717d5","number":71,"state":"MERGED"}]'
  }

  static aStateThisReaderDoesNotKnow() {
    return '[{"headRefOid":"d678257f182a1b57c160dd3902ee01d2d80aa8ea","number":68,"state":"DRAFT"}]'
  }

  static aPullRequestWithoutAWholeNumber() {
    return '[{"headRefOid":"d678257f182a1b57c160dd3902ee01d2d80aa8ea","number":"68","state":"MERGED"}]'
  }

  static aPullRequestWithoutAHeadCommit() {
    return '[{"number":68,"state":"MERGED"}]'
  }

  static aPullRequestWhoseHeadIsNotACommitId() {
    return '[{"headRefOid":"d678257","number":68,"state":"MERGED"}]'
  }

  static oneObjectInsteadOfAList() {
    return '{"headRefOid":"d678257f182a1b57c160dd3902ee01d2d80aa8ea","number":68,"state":"MERGED"}'
  }

  static aListWithSomethingThatIsNotAPullRequest() {
    return '[null]'
  }

  static whatGhPrintsWhenItCannotAnswer() {
    return 'gh: Could not resolve to a Repository with the name josemerca/control-tower-plugin.'
  }
}

class CollectionCaseMother {
  static aMergedDeliveryWithBothArtifactsOnDisk() {
    return {
      delivery: Delivery.fromPullRequestList(PullRequestListMother.whatGhPrintedForPullRequest68()),
      hasWorktree: true,
      hasBranch: true,
      status: '',
      localTip: PullRequestListMother.MERGED_HEAD,
    }
  }

  static aBranchLeftWithoutItsWorktree() {
    return { ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(), hasWorktree: false, status: null }
  }

  static aWorktreeLeftWithoutItsBranch() {
    return { ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(), hasBranch: false, localTip: null }
  }

  static nothingLeftOnDisk() {
    return {
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      hasWorktree: false,
      status: null,
      hasBranch: false,
      localTip: null,
    }
  }

  static aDeliveryStateThePolicyDoesNotDescribe() {
    return Object.freeze({
      state: 'invented-state',
      number: 68,
      headRefOid: PullRequestListMother.MERGED_HEAD,
    })
  }
}

class SliceArtifactsMother {
  static asDispatchCheckReadsThemForSlice68() {
    return {
      known: true,
      mainRoot: '/checkout',
      worktree: '/checkout/.worktrees/68',
      branch: 'feat/68',
      hasWorktree: true,
      hasBranch: true,
    }
  }
}

describe('the vocabularies this decision is written in', () => {
  it('every_delivery_state_is_distinct_so_no_two_situations_that_are_fixed_differently_collapse', () => {
    const members = Object.values(DeliveryState)

    expect(new Set(members).size).toBe(members.length)
    expect(members).toHaveLength(4)
  })

  it('every_collection_step_is_distinct_so_no_two_situations_that_are_fixed_differently_collapse', () => {
    const members = Object.values(CollectionStep)

    expect(new Set(members).size).toBe(members.length)
    expect(members).toHaveLength(5)
  })

  it('the_three_literals_gh_prints_are_kept_with_the_spelling_that_contract_gives_them', () => {
    expect(Object.values(PullRequestState)).toEqual(['OPEN', 'CLOSED', 'MERGED'])
  })

  it('no_vocabulary_can_be_widened_at_runtime_by_a_consumer', () => {
    expect(Object.isFrozen(DeliveryState)).toBe(true)
    expect(Object.isFrozen(CollectionStep)).toBe(true)
    expect(Object.isFrozen(PullRequestState)).toBe(true)
  })
})

describe('Delivery, read from what gh pr list prints', () => {
  it('the_transcript_of_a_merged_pull_request_is_read_as_merged_with_the_commit_that_landed', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.whatGhPrintedForPullRequest68())

    expect(delivery.state).toBe(DeliveryState.MERGED)
    expect(delivery.number).toBe(68)
    expect(delivery.headRefOid).toBe('d678257f182a1b57c160dd3902ee01d2d80aa8ea')
  })

  it('the_keys_this_reader_does_not_consume_are_projected_away_instead_of_breaking_the_read', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.whatGhPrintedForPullRequest68())

    expect(Object.keys(delivery)).toEqual(['state', 'number', 'headRefOid'])
  })

  it('a_delivery_is_frozen_so_a_consumer_cannot_rewrite_the_head_it_was_read_from', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.whatGhPrintedForPullRequest68())

    expect(Object.isFrozen(delivery)).toBe(true)
  })

  it('an_empty_list_is_a_delivery_never_opened_and_not_an_absent_value', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.nothingOpenedYet())

    expect(delivery.state).toBe(DeliveryState.NOT_OPENED)
    expect(delivery.number).toBe(null)
    expect(delivery.headRefOid).toBe(null)
  })

  it('a_closed_pull_request_alone_is_abandoned_because_its_work_never_reached_the_base', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.oneClosedPullRequest())

    expect(delivery.state).toBe(DeliveryState.ABANDONED)
    expect(delivery.number).toBe(66)
  })

  it('an_open_pull_request_beside_a_closed_one_is_open_so_a_second_attempt_is_not_read_as_abandonment', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.anOpenOneBesideAClosedOne())

    expect(delivery.state).toBe(DeliveryState.OPEN)
    expect(delivery.number).toBe(70)
  })

  it('a_merged_pull_request_beside_an_open_one_is_merged_so_a_later_reopen_does_not_hide_the_landing', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.aMergedOneBesideAnOpenOne())

    expect(delivery.state).toBe(DeliveryState.MERGED)
    expect(delivery.number).toBe(68)
  })

  it('two_merged_pull_requests_are_settled_by_the_highest_number_so_the_head_is_the_last_one_that_landed', () => {
    const delivery = Delivery.fromPullRequestList(PullRequestListMother.twoMergedPullRequests())

    expect(delivery.number).toBe(71)
    expect(delivery.headRefOid).toBe(PullRequestListMother.LATER_MERGED_HEAD)
  })

  it('a_pull_request_state_this_reader_does_not_know_raises_quoting_what_gh_printed', () => {
    const printed = PullRequestListMother.aStateThisReaderDoesNotKnow()

    expect(() => Delivery.fromPullRequestList(printed))
      .toThrow('gh pr list printed a pull request state this reader does not know')
    expect(() => Delivery.fromPullRequestList(printed)).toThrow(printed)
  })

  it('what_gh_prints_when_it_cannot_answer_raises_quoting_it_instead_of_passing_for_a_delivery_never_opened', () => {
    const printed = PullRequestListMother.whatGhPrintsWhenItCannotAnswer()

    expect(() => Delivery.fromPullRequestList(printed)).toThrow('gh pr list printed unreadable JSON')
    expect(() => Delivery.fromPullRequestList(printed)).toThrow(printed)
  })

  it('one_object_instead_of_a_list_raises_quoting_what_gh_printed', () => {
    const printed = PullRequestListMother.oneObjectInsteadOfAList()

    expect(() => Delivery.fromPullRequestList(printed))
      .toThrow('gh pr list printed something that is not a list of pull requests')
    expect(() => Delivery.fromPullRequestList(printed)).toThrow(printed)
  })

  it('a_listed_entry_that_is_not_an_object_raises_quoting_what_gh_printed', () => {
    const printed = PullRequestListMother.aListWithSomethingThatIsNotAPullRequest()

    expect(() => Delivery.fromPullRequestList(printed))
      .toThrow('gh pr list printed a pull request that is not an object')
    expect(() => Delivery.fromPullRequestList(printed)).toThrow(printed)
  })

  it('a_pull_request_whose_number_is_not_a_whole_number_raises_instead_of_being_read', () => {
    const printed = PullRequestListMother.aPullRequestWithoutAWholeNumber()

    expect(() => Delivery.fromPullRequestList(printed))
      .toThrow('gh pr list printed a pull request whose number is not a whole number')
    expect(() => Delivery.fromPullRequestList(printed)).toThrow(printed)
  })

  it('a_pull_request_without_the_head_commit_the_guard_compares_raises_instead_of_being_read', () => {
    const printed = PullRequestListMother.aPullRequestWithoutAHeadCommit()

    expect(() => Delivery.fromPullRequestList(printed))
      .toThrow('gh pr list printed a pull request whose headRefOid is not a commit')
    expect(() => Delivery.fromPullRequestList(printed)).toThrow(printed)
  })

  it('a_head_that_is_not_a_commit_id_raises_instead_of_being_compared_against_a_tip_it_can_never_equal', () => {
    const printed = PullRequestListMother.aPullRequestWhoseHeadIsNotACommitId()

    expect(() => Delivery.fromPullRequestList(printed))
      .toThrow('gh pr list printed a pull request whose headRefOid is not a commit')
    expect(() => Delivery.fromPullRequestList(printed)).toThrow(printed)
  })
})

describe('Delivery, when its fields would disagree with each other', () => {
  it('a_delivery_never_opened_that_carries_a_number_is_refused_by_the_constructor', () => {
    expect(() => new Delivery({ state: DeliveryState.NOT_OPENED, number: 68, headRefOid: null }))
      .toThrow('disagrees with its number')
  })

  it('a_delivery_never_opened_that_carries_a_head_commit_is_refused_by_the_constructor', () => {
    expect(() => new Delivery({
      state: DeliveryState.NOT_OPENED,
      number: null,
      headRefOid: PullRequestListMother.MERGED_HEAD,
    })).toThrow('disagrees with its headRefOid')
  })

  it('an_opened_delivery_without_its_head_commit_is_refused_by_the_constructor', () => {
    expect(() => new Delivery({ state: DeliveryState.MERGED, number: 68, headRefOid: null }))
      .toThrow('disagrees with its headRefOid')
  })

  it('an_opened_delivery_without_its_number_is_refused_by_the_constructor', () => {
    expect(() => new Delivery({
      state: DeliveryState.MERGED,
      number: null,
      headRefOid: PullRequestListMother.MERGED_HEAD,
    })).toThrow('disagrees with its number')
  })

  it('a_state_outside_the_vocabulary_is_refused_by_the_constructor', () => {
    expect(() => new Delivery({ state: 'invented-state', number: null, headRefOid: null }))
      .toThrow('state must be a DeliveryState member')
  })
})

describe('CollectionPolicy, deciding what to do with what the slice left on disk', () => {
  it('nothing_on_disk_leaves_nothing_to_collect_even_when_the_pull_request_landed', () => {
    expect(CollectionPolicy.stepFor(CollectionCaseMother.nothingLeftOnDisk()))
      .toBe(CollectionStep.NOTHING_LEFT)
  })

  it('a_delivery_never_opened_waits_because_the_work_is_not_in_the_base_yet', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      delivery: Delivery.fromPullRequestList(PullRequestListMother.nothingOpenedYet()),
    })).toBe(CollectionStep.WAIT)
  })

  it('an_open_delivery_waits_because_the_work_is_not_in_the_base_yet', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      delivery: Delivery.fromPullRequestList(PullRequestListMother.anOpenOneBesideAClosedOne()),
    })).toBe(CollectionStep.WAIT)
  })

  it('an_abandoned_delivery_waits_instead_of_deleting_work_that_never_reached_the_base', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      delivery: Delivery.fromPullRequestList(PullRequestListMother.oneClosedPullRequest()),
    })).toBe(CollectionStep.WAIT)
  })

  it('a_modified_file_in_the_worktree_keeps_everything_even_though_the_pull_request_landed', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      status: ' M plugin/scripts/dispatch-check.mjs\n',
    })).toBe(CollectionStep.KEEP_DIRTY_TREE)
  })

  it('an_untracked_file_in_the_worktree_keeps_everything_because_nobody_else_holds_that_work', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      status: '?? scratch.md\n',
    })).toBe(CollectionStep.KEEP_DIRTY_TREE)
  })

  it('a_status_that_is_only_whitespace_is_a_clean_worktree_and_does_not_keep_anything', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      status: '\n',
    })).toBe(CollectionStep.COLLECT)
  })

  it('a_local_tip_other_than_the_head_that_landed_keeps_everything_instead_of_deleting_unpushed_commits', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      localTip: '9999999999999999999999999999999999999999',
    })).toBe(CollectionStep.KEEP_TIP_NOT_MERGED)
  })

  it('a_merged_delivery_with_a_clean_worktree_at_the_head_that_landed_is_collected', () => {
    expect(CollectionPolicy.stepFor(CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk()))
      .toBe(CollectionStep.COLLECT)
  })

  it('a_branch_left_without_its_worktree_is_collected_when_its_tip_is_the_head_that_landed', () => {
    expect(CollectionPolicy.stepFor(CollectionCaseMother.aBranchLeftWithoutItsWorktree()))
      .toBe(CollectionStep.COLLECT)
  })

  it('a_branch_left_without_its_worktree_is_kept_when_its_tip_is_not_the_head_that_landed', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aBranchLeftWithoutItsWorktree(),
      localTip: '9999999999999999999999999999999999999999',
    })).toBe(CollectionStep.KEEP_TIP_NOT_MERGED)
  })

  it('a_worktree_left_without_its_branch_is_collected_when_its_tree_is_clean', () => {
    expect(CollectionPolicy.stepFor(CollectionCaseMother.aWorktreeLeftWithoutItsBranch()))
      .toBe(CollectionStep.COLLECT)
  })

  it('a_worktree_left_without_its_branch_is_kept_when_its_tree_is_dirty', () => {
    expect(CollectionPolicy.stepFor({
      ...CollectionCaseMother.aWorktreeLeftWithoutItsBranch(),
      status: ' M plugin/scripts/dispatch-check.mjs\n',
    })).toBe(CollectionStep.KEEP_DIRTY_TREE)
  })

  it('a_delivery_state_the_policy_does_not_describe_raises_instead_of_falling_into_a_default_branch', () => {
    expect(() => CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      delivery: CollectionCaseMother.aDeliveryStateThePolicyDoesNotDescribe(),
    })).toThrow('CollectionPolicy does not describe the delivery state')
  })
})

describe('CollectionPolicy, when what it was told about disk disagrees with what it was given to read', () => {
  it('a_local_tip_that_still_carries_the_newline_git_printed_is_refused_instead_of_being_read_as_another_commit', () => {
    expect(() => CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      localTip: `${PullRequestListMother.MERGED_HEAD}\n`,
    })).toThrow('disagrees with the local tip given')
  })

  it('the_guards_run_before_nothing_left_so_a_status_given_without_a_worktree_is_refused_and_not_ignored', () => {
    expect(() => CollectionPolicy.stepFor({
      ...CollectionCaseMother.nothingLeftOnDisk(),
      status: '',
    })).toThrow('disagrees with the git status given')
  })

  it('a_worktree_on_disk_without_the_status_of_its_tree_is_refused_instead_of_read_as_clean', () => {
    expect(() => CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      status: null,
    })).toThrow('disagrees with the git status given')
  })

  it('a_status_given_for_a_worktree_that_is_not_on_disk_is_refused', () => {
    expect(() => CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      hasWorktree: false,
    })).toThrow('disagrees with the git status given')
  })

  it('a_branch_on_disk_without_its_local_tip_is_refused_instead_of_read_as_the_head_that_landed', () => {
    expect(() => CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      localTip: null,
    })).toThrow('disagrees with the local tip given')
  })

  it('a_local_tip_given_for_a_branch_that_is_not_on_disk_is_refused', () => {
    expect(() => CollectionPolicy.stepFor({
      ...CollectionCaseMother.aMergedDeliveryWithBothArtifactsOnDisk(),
      hasBranch: false,
    })).toThrow('disagrees with the local tip given')
  })
})

describe('CollectionCommands, the argv the collection is made of', () => {
  it('the_pull_request_query_asks_every_state_of_the_slice_branch_and_only_the_three_fields_the_reader_projects', () => {
    expect(CollectionCommands.prListArgv({ repo: 'josemerca/control-tower-plugin', branch: 'feat/68' }))
      .toEqual([
        'pr', 'list',
        '--repo', 'josemerca/control-tower-plugin',
        '--head', 'feat/68',
        '--state', 'all',
        '--json', 'number,state,headRefOid',
        '--limit', '10',
      ])
  })

  it('the_worktree_status_query_counts_untracked_files_so_a_new_file_is_not_read_as_a_clean_tree', () => {
    expect(CollectionCommands.statusArgv(SliceArtifactsMother.asDispatchCheckReadsThemForSlice68()))
      .toEqual(['-C', '/checkout/.worktrees/68', 'status', '--porcelain', '--untracked-files=all'])
  })

  it('the_local_tip_query_reads_the_branch_ref_from_the_main_checkout_and_stays_quiet_when_it_is_not_there', () => {
    expect(CollectionCommands.tipArgv(SliceArtifactsMother.asDispatchCheckReadsThemForSlice68()))
      .toEqual(['-C', '/checkout', 'rev-parse', '--verify', '--quiet', 'refs/heads/feat/68'])
  })

  it('removing_the_worktree_is_asked_of_the_main_checkout_and_forced_so_a_locked_worktree_does_not_stop_it', () => {
    expect(CollectionCommands.removeWorktreeArgv(SliceArtifactsMother.asDispatchCheckReadsThemForSlice68()))
      .toEqual(['-C', '/checkout', 'worktree', 'remove', '--force', '/checkout/.worktrees/68'])
  })

  it('deleting_the_branch_is_asked_of_the_main_checkout_with_the_flag_that_does_not_ask_again_whether_it_landed', () => {
    expect(CollectionCommands.deleteBranchArgv(SliceArtifactsMother.asDispatchCheckReadsThemForSlice68()))
      .toEqual(['-C', '/checkout', 'branch', '-D', 'feat/68'])
  })

  it('closing_the_cmux_workspace_names_it_by_the_reference_cmux_itself_gave', () => {
    expect(CollectionCommands.closeWorkspaceArgv('cmux://workspace/7'))
      .toEqual(['close-workspace', '--workspace', 'cmux://workspace/7'])
  })

  it('every_argv_builder_takes_the_artifacts_object_dispatch_check_already_has_without_renaming_a_key', () => {
    const artifacts = SliceArtifactsMother.asDispatchCheckReadsThemForSlice68()

    expect(CollectionCommands.statusArgv(artifacts)).toContain(artifacts.worktree)
    expect(CollectionCommands.tipArgv(artifacts)).toContain(`refs/heads/${artifacts.branch}`)
    expect(CollectionCommands.removeWorktreeArgv(artifacts)).toContain(artifacts.worktree)
    expect(CollectionCommands.deleteBranchArgv(artifacts)).toContain(artifacts.branch)
  })
})
