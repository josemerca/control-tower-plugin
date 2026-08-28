import { describe, it, expect } from 'vitest'
import { SliceBase } from '../scripts/slice-base.js'

class GitDouble {
  constructor(answers) {
    this.answers = answers
    this.calls = []
  }

  run = (argv) => {
    this.calls.push(argv)
    const key = argv.join(' ')
    if (!(key in this.answers)) return null
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
    const git = new GitDouble({})
    const base = new SliceBase({ git: git.run })

    expect(base.measurementRef({ baseBranch: 'main', fallbackRef: 'bbbbbbbb' })).toBe('bbbbbbbb')
  })

  it('no_remote_and_no_cut_answers_nothing_instead_of_guessing_a_reference', () => {
    const git = new GitDouble({})
    const base = new SliceBase({ git: git.run })

    expect(base.measurementRef({ baseBranch: 'main', fallbackRef: null })).toBe(null)
  })
})
