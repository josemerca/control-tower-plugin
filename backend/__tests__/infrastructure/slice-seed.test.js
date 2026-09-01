import { describe, it, expect } from 'vitest'
import { SliceSeed } from '../../src/infrastructure/slice-seed.js'

describe('SliceSeed', () => {
  const seeded = () => SliceSeed.textFor({ issue: { number: 42 }, branch: 'feat/42', base: 'main', cut: 'a1b2c3d' })

  it('it_opens_with_a_frontmatter_the_plugin_hook_can_parse', () => {
    expect(seeded().startsWith('---\n')).toBe(true)
    expect(seeded()).toContain('\n---\n')
  })

  it('it_says_the_session_is_the_one_that_writes_the_plan_and_not_the_coordinator', () => {
    expect(seeded()).toContain('role: "slice-agent')
  })

  it('the_cut_travels_as_both_the_base_and_the_last_commit_because_no_work_has_landed_yet', () => {
    expect(seeded()).toContain('base_sha: "a1b2c3d"')
    expect(seeded()).toContain('last_commit: "a1b2c3d"')
  })

  it('it_declares_that_nothing_is_blocked_instead_of_leaving_the_field_out', () => {
    expect(seeded()).toContain('blocked: null')
  })

  it('it_names_the_issue_so_a_session_that_rehydrates_knows_what_it_is_working_on', () => {
    expect(seeded()).toContain('github_issue: 42')
    expect(seeded()).toContain('branch: "feat/42"')
    expect(seeded()).toContain('base: "main"')
  })

  it('the_rule_it_asks_git_to_ignore_is_the_very_file_it_writes', () => {
    expect(SliceSeed.EXCLUDE_RULE).toBe(SliceSeed.RELATIVE_PATH)
  })

  it('the_exclude_file_hangs_off_the_git_dir_and_not_off_the_worktree_because_dot_git_is_a_file_there', () => {
    expect(SliceSeed.EXCLUDE_PATH.startsWith('.git/')).toBe(false)
    expect(SliceSeed.EXCLUDE_PATH).toBe('info/exclude')
  })
})
