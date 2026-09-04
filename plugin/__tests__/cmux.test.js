import { describe, expect, it, vi } from 'vitest'
import { listCmuxWorkspaces } from '../scripts/cmux.js'

const WORKSPACE = {
  custom_title: 'ct-plan-owner__repo-ABC-123',
  current_directory: '/repo/.worktrees/7',
  ref: 'workspace:7',
}

function partialRun(argv) {
  if (argv[0] === 'list-windows') return JSON.stringify([{ id: 'one' }, { id: 'two' }])
  if (argv[3] === 'one') return JSON.stringify({ workspaces: [WORKSPACE] })
  throw new Error('window query failed')
}

describe('listCmuxWorkspaces', () => {
  it('keeps_partial_window_results_by_default', () => {
    expect(listCmuxWorkspaces({ run: partialRun })).toEqual([{
      title: WORKSPACE.custom_title,
      cwd: WORKSPACE.current_directory,
      cwdKnown: true,
      ref: WORKSPACE.ref,
    }])
  })

  it('returns_null_when_a_required_window_query_fails', () => {
    expect(listCmuxWorkspaces({ run: partialRun, requireComplete: true })).toBe(null)
  })

  it('returns_a_conclusive_empty_list_when_there_are_no_windows', () => {
    const run = vi.fn(() => '[]')

    expect(listCmuxWorkspaces({ run, requireComplete: true })).toEqual([])
    expect(run).toHaveBeenCalledOnce()
  })
})
