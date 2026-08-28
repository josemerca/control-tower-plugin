import { describe, it, expect } from 'vitest'
import { SliceBase, BaseBranch } from '../scripts/slice-base.js'

class GitDouble {
  constructor(answers) {
    this.answers = answers
  }

  run = (argv) => {
    const key = argv.join(' ')
    if (!(key in this.answers)) throw new Error(`Unexpected git command: ${key}`)
    return this.answers[key]
  }
}

describe('SliceBase', () => {
  it('a_fused_branch_is_measured_from_the_merge_base_and_not_from_the_cut', () => {
    const git = new GitDouble({ 'merge-base HEAD origin/main': 'dddddddddddddddddddddddddddddddddddddddd' })
    const base = new SliceBase({ git: git.run })

    expect(base.measurementRef({ baseBranch: 'main', fallbackRef: 'bbbbbbbb' }))
      .toBe('dddddddddddddddddddddddddddddddddddddddd')
  })

  it('a_remote_that_does_not_resolve_falls_back_to_the_cut_instead_of_measuring_nothing', () => {
    const git = new GitDouble({ 'merge-base HEAD origin/main': null })
    const base = new SliceBase({ git: git.run })

    expect(base.measurementRef({ baseBranch: 'main', fallbackRef: 'bbbbbbbb' })).toBe('bbbbbbbb')
  })

  it('no_remote_and_no_cut_answers_nothing_instead_of_guessing_a_reference', () => {
    const git = new GitDouble({ 'merge-base HEAD origin/main': null })
    const base = new SliceBase({ git: git.run })

    expect(base.measurementRef({ baseBranch: 'main', fallbackRef: null })).toBe(null)
  })
})

class RemoteDouble {
  constructor(branches) {
    this.branches = branches
  }

  has = (name) => this.branches.includes(name)
}

describe('BaseBranch', () => {
  it('the_branch_the_seed_names_wins_over_whatever_the_remote_happens_to_carry', () => {
    const remote = new RemoteDouble(['HEAD', 'main', 'release/7'])
    const resolver = new BaseBranch({ remoteRefExists: remote.has })

    expect(resolver.resolve({ declared: 'release/7' })).toBe('release/7')
  })

  it('a_seed_that_names_no_branch_takes_the_first_of_the_usual_ones_the_remote_really_has', () => {
    const remote = new RemoteDouble(['master'])
    const resolver = new BaseBranch({ remoteRefExists: remote.has })

    expect(resolver.resolve({ declared: '' })).toBe('master')
  })

  it('a_remote_without_any_of_the_usual_branches_answers_nothing_instead_of_naming_one_that_is_not_there', () => {
    const remote = new RemoteDouble([])
    const resolver = new BaseBranch({ remoteRefExists: remote.has })

    expect(resolver.resolve({ declared: undefined })).toBe(null)
  })
})
