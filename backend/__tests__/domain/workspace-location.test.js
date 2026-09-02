import { describe, it, expect } from 'vitest'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { Workspace } from '../../src/domain/ports/workspace.js'

describe('WorkspaceLocation', () => {
  it('it_carries_the_directory_and_the_branch_together_because_neither_is_usable_alone', () => {
    const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })

    expect(located.path).toBe('/repo/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })

  it('it_cannot_be_edited_after_it_is_built', () => {
    expect(Object.isFrozen(new WorkspaceLocation({ path: '/a', branch: 'b' }))).toBe(true)
  })

  it('a_location_without_a_directory_refuses_to_exist_instead_of_answering_undefined_later', () => {
    expect(() => new WorkspaceLocation({ path: '', branch: 'feat/42' })).toThrow(/directory/)
  })

  it('a_location_without_a_branch_refuses_to_exist_because_nothing_could_be_committed_to_it', () => {
    expect(() => new WorkspaceLocation({ path: '/a', branch: '' })).toThrow(/branch/)
  })

  it('a_directory_made_only_of_spaces_refuses_to_exist_the_same_as_an_empty_one', () => {
    expect(() => new WorkspaceLocation({ path: '   ', branch: 'feat/42' })).toThrow(/directory/)
  })

  it('a_branch_made_only_of_spaces_refuses_to_exist_the_same_as_an_empty_one', () => {
    expect(() => new WorkspaceLocation({ path: '/a', branch: '   ' })).toThrow(/branch/)
  })
})

describe('Workspace', () => {
  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new Workspace().prepare({ number: 42 })).rejects.toThrow(/must implement prepare/)
  })

  it('a_port_that_nobody_implemented_undo_for_says_so_instead_of_answering_undefined', async () => {
    const located = new WorkspaceLocation({ path: '/repo/.worktrees/42', branch: 'feat/42' })

    await expect(new Workspace().undo(located)).rejects.toThrow(/must implement undo/)
  })
})
