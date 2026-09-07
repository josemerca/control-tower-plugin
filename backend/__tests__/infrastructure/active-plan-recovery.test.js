import { describe, expect, it, vi } from 'vitest'
import { ActivePlanRecovery, CmuxActivePlan } from '../../src/infrastructure/active-plan-recovery.js'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.js'
import { PlanSessions } from '../../src/infrastructure/plan-events-route.js'
import { MemoryCheckoutRegistry } from '../../src/infrastructure/memory-checkout-registry.js'
import { DiskImplementationStartRegistry } from '../../src/infrastructure/disk-implementation-start-registry.js'

const CURRENT = Object.freeze({
  title: 'ct-plan-jjponz__repo-pulse-ABC-123',
  cwd: '/repo/.worktrees/45',
  cwdKnown: true,
  ref: 'workspace:9',
})

describe('CmuxActivePlan', () => {
  it('parses_the_current_control_tower_workspace_contract', () => {
    const watch = CmuxActivePlan.parse(CURRENT)

    expect(watch.story.text).toBe('ABC-123')
    expect(watch.repository.text).toBe('jjponz/repo-pulse')
    expect(watch.issue.number).toBe(45)
    expect(watch.issue.url).toBe('https://github.com/jjponz/repo-pulse/issues/45')
    expect(watch.located).toEqual({ root: '/repo', path: '/repo/.worktrees/45', branch: 'feat/45' })
    expect(watch.agent).toBe('workspace:9')
  })

  it.each([
    null,
    { ...CURRENT, title: 'another-workspace' },
    { ...CURRENT, title: 'ct-plan-jjponz__repo-pulse-not-a-story' },
    { ...CURRENT, title: 'ct-plan-not-a-repository-ABC-123' },
    { ...CURRENT, cwd: '/repo' },
    { ...CURRENT, cwd: 'repo/.worktrees/45' },
    { ...CURRENT, cwd: '/repo/.worktrees/0' },
    { ...CURRENT, cwdKnown: false },
    { ...CURRENT, ref: null },
    { ...CURRENT, ref: 'surface:9' },
  ])('ignores_a_malformed_or_unknown_entry %#', (entry) => {
    expect(CmuxActivePlan.parse(entry)).toBe(null)
  })
})

describe('ActivePlanRecovery', () => {
  const VALID_MARKER = JSON.stringify({
    repo: 'jjponz/repo-pulse', issue: 45, agent: 'workspace:9', story: 'ABC-123',
    root: '/repo', branch: 'feat/45', worktree: '/repo/.worktrees/45',
  })

  function fixture({
    entries = [CURRENT], marker = null, go = false, regular = true, readFailure = null,
  } = {}) {
    const sessions = new PlanSessions()
    const activePlans = new ActivePlans({ sessions })
    const reviews = { startRecovered: vi.fn() }
    const checkouts = new MemoryCheckoutRegistry()
    const implementationStarts = new DiskImplementationStartRegistry({
      read: vi.fn(() => {
        if (readFailure !== null) throw readFailure
        return marker
      }),
      stat: vi.fn(() => {
        if (marker === null && readFailure === null) throw new Error('ENOENT')
        return { isFile: () => regular }
      }),
      write: vi.fn(),
      root: '/state',
    })
    const recovery = new ActivePlanRecovery({
      list: vi.fn(() => entries),
      implementationStarts,
      goRegistry: { matches: vi.fn(() => go) },
      sessions,
      reviews,
      activePlans,
      checkouts,
    })

    return { recovery, sessions, activePlans, reviews, checkouts }
  }

  it('a_plan_with_no_go_and_no_implementation_marker_recovers_as_planning', () => {
    const recovered = fixture()

    recovered.recovery.recover()

    expect(recovered.sessions.known()).toHaveLength(1)
    expect(recovered.reviews.startRecovered).toHaveBeenCalledWith(recovered.sessions.known()[0])
    expect(recovered.activePlans.known()[0].phase).toBe('planning')
  })

  it('a_valid_go_without_an_implementation_marker_recovers_as_uncertain', () => {
    const recovered = fixture({ go: true })

    expect(recovered.recovery.recover()).toBe(true)

    expect(recovered.sessions.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
    expect(recovered.activePlans.known()[0].phase).toBe('uncertain')
    expect(recovered.checkouts.known().map((root) => root.text)).toEqual(['/repo'])
  })

  it('exposes_a_plan_with_a_matching_marker_as_implementing_without_restarting_its_watches', () => {
    const recovered = fixture({ marker: VALID_MARKER })

    recovered.recovery.recover()

    expect(recovered.sessions.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
    expect(recovered.activePlans.known()[0].phase).toBe('implementing')
    expect(recovered.checkouts.known().map((root) => root.text)).toEqual(['/repo'])
  })

  it.each([
    ['empty', ''],
    ['malformed', '{'],
    ['Go commitment only', JSON.stringify({ repo: 'jjponz/repo-pulse', issue: 45, commitment: 'a'.repeat(64) })],
    ['mismatched repository', VALID_MARKER.replace('jjponz/repo-pulse', 'other/repo')],
    ['mismatched issue', VALID_MARKER.replace('"issue":45', '"issue":44')],
    ['mismatched agent', VALID_MARKER.replace('workspace:9', 'workspace:10')],
    ['mismatched story', VALID_MARKER.replace('ABC-123', 'ABC-124')],
    ['mismatched root', VALID_MARKER.replace('"/repo"', '"/other"')],
    ['mismatched branch', VALID_MARKER.replace('feat/45', 'feat/44')],
    ['mismatched worktree', VALID_MARKER.replace('/repo/.worktrees/45', '/repo/.worktrees/44')],
  ])('keeps_a_plan_with_an_%s_marker_in_planning', (description, marker) => {
    const recovered = fixture({ marker })

    recovered.recovery.recover()

    expect(recovered.activePlans.known()[0].phase).toBe('planning')
    expect(recovered.reviews.startRecovered).toHaveBeenCalledOnce()
  })

  it('keeps_a_plan_with_a_marker_path_that_is_a_directory_in_planning', () => {
    const recovered = fixture({ marker: VALID_MARKER, regular: false })

    recovered.recovery.recover()

    expect(recovered.activePlans.known()[0].phase).toBe('planning')
  })

  it('keeps_a_plan_with_an_unreadable_marker_in_planning_without_stopping_startup', () => {
    const recovered = fixture({ marker: VALID_MARKER, readFailure: new Error('EACCES') })

    expect(() => recovered.recovery.recover()).not.toThrow()
    expect(recovered.activePlans.known()[0].phase).toBe('planning')
  })

  it('deduplicates_cmux_entries_for_the_same_repository_and_issue', () => {
    const recovered = fixture({ entries: [CURRENT, { ...CURRENT, ref: 'workspace:10' }] })

    recovered.recovery.recover()

    expect(recovered.sessions.known()).toHaveLength(1)
    expect(recovered.reviews.startRecovered).toHaveBeenCalledOnce()
  })

  it('does_not_start_a_second_review_when_recovery_is_repeated', () => {
    const recovered = fixture()

    expect(recovered.recovery.recover()).toBe(true)
    expect(recovered.recovery.recover()).toBe(true)

    expect(recovered.sessions.known()).toHaveLength(1)
    expect(recovered.reviews.startRecovered).toHaveBeenCalledOnce()
  })

  it('restores_the_checkout_root_for_a_recovered_planning_session', () => {
    const recovered = fixture()

    recovered.recovery.recover()

    expect(recovered.checkouts.known().map((root) => root.text)).toEqual(['/repo'])
  })

  it('recovers_nothing_when_the_cmux_query_is_not_conclusive', () => {
    const recovered = fixture({ entries: null })

    expect(recovered.recovery.recover()).toBe(false)
    expect(recovered.activePlans.known()).toEqual([])
    expect(recovered.reviews.startRecovered).not.toHaveBeenCalled()
  })
})
