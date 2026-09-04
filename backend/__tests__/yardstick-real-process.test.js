import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Yardstick } from './yardstick.js'

class Census {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static BACKEND = join(Census.HERE, '..')
  static REPOSITORY = join(Census.BACKEND, '..')

  static measured() {
    return Yardstick.measuredUnder(Census.BACKEND)
  }

  static tracked() {
    const listing = ['ls-files', '--cached', '--others', '--exclude-standard', 'backend']
    return execFileSync('git', listing, { cwd: Census.REPOSITORY, encoding: 'utf8' })
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.replace(/^backend\//, ''))
  }

  static measurable(files) {
    return files.filter((file) => Yardstick.MEASURED_EXTENSIONS.includes(`.${file.split('.').pop()}`))
  }
}

describe('the census of what the yardstick measures is the one git keeps', () => {
  it('the_census_matches_what_git_sees_so_neither_a_new_file_nor_a_deleted_one_goes_unnoticed', () => {
    const tracked = Census.tracked()

    expect(tracked.length).toBeGreaterThan(0)
    expect([...Census.measured()].sort()).toEqual(Census.measurable(tracked).sort())
  })
})
