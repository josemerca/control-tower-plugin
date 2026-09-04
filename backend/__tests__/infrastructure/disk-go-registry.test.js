import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { DiskGoRegistry } from '../../src/infrastructure/disk-go-registry.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { GoNotRecorded } from '../../src/domain/exceptions.js'

class DiskDouble {
  static ROOT = '/home/someone/.claude/control-tower'
  static FILL = 7
  static NONCE = '07070707'

  constructor(failure = null) {
    this.failure = failure
    this.written = []
  }

  static refusing(said) {
    return new DiskDouble(new Error(said))
  }

  registry({ root = DiskDouble.ROOT } = {}) {
    return new DiskGoRegistry({
      random: (bytes) => Buffer.alloc(bytes, DiskDouble.FILL),
      write: async (path, text) => {
        this.written.push({ path, text })
        if (this.failure !== null) throw this.failure
      },
      root,
    })
  }

  async mintFor({ issueNumber = 33, repository = new RepositoryName('jjponz/repo-pulse') } = {}) {
    return this.registry().mint({ issueNumber, repository })
  }

  async refusalFor(asked = {}) {
    return this.mintFor(asked).catch((cause) => cause)
  }
}

describe('DiskGoRegistry', () => {
  it('the_file_lands_where_dispatch_check_looks_for_the_go_of_that_repo_and_issue', async () => {
    const disk = new DiskDouble()

    await disk.mintFor()

    expect(disk.written).toHaveLength(1)
    expect(disk.written[0].path)
      .toBe('/home/someone/.claude/control-tower/go/jjponz__repo-pulse-33.json')
  })

  it('the_slash_of_a_repository_becomes_a_double_underscore_so_the_name_is_one_path_segment', async () => {
    const disk = new DiskDouble()

    await disk.mintFor({ repository: new RepositoryName('mercadona/mo.shop'), issueNumber: 451 })

    expect(disk.written[0].path).toContain('/go/mercadona__mo.shop-451.json')
    expect(disk.written[0].path.split('/go/')[1]).not.toContain('/')
  })

  it('the_nonce_is_returned_in_the_clear_and_only_its_digest_reaches_the_disk', async () => {
    const disk = new DiskDouble()

    const nonce = await disk.mintFor()

    const digest = createHash('sha256').update(DiskDouble.NONCE, 'utf8').digest('hex')
    expect(nonce).toBe(DiskDouble.NONCE)
    expect(disk.written[0].text).toContain(digest)
    expect(disk.written[0].text).not.toContain(DiskDouble.NONCE)
  })

  it('the_nonce_is_as_long_as_the_bytes_the_registry_asked_for_so_the_go_keeps_its_entropy', async () => {
    const disk = new DiskDouble()

    const nonce = await disk.mintFor()

    expect(nonce).toHaveLength(DiskGoRegistry.NONCE_BYTES * 2)
  })

  it('what_it_writes_names_the_repository_and_the_issue_the_go_belongs_to', async () => {
    const disk = new DiskDouble()

    await disk.mintFor()

    const digest = createHash('sha256').update(DiskDouble.NONCE, 'utf8').digest('hex')
    expect(disk.written[0].text).toBe(
      `{\n  "repo": "jjponz/repo-pulse",\n  "issue": 33,\n  "commitment": "${digest}"\n}\n`
    )
  })

  it('a_registry_the_disk_refused_is_a_go_that_was_never_recorded', async () => {
    const disk = DiskDouble.refusing('EACCES: permission denied')

    const refusal = await disk.refusalFor()

    expect(refusal).toBeInstanceOf(GoNotRecorded)
    expect(refusal.message).toContain('EACCES: permission denied')
    expect(refusal.message).toContain('go/jjponz__repo-pulse-33.json')
  })

  it('matches_a_valid_go_record_for_the_same_repository_and_issue', () => {
    const repository = new RepositoryName('jjponz/repo-pulse')
    const registry = new DiskGoRegistry({
      random: null,
      read: vi.fn(() => JSON.stringify({
        repo: repository.text, issue: 33, commitment: 'a'.repeat(64),
      })),
      stat: vi.fn(() => ({ isFile: () => true })),
      write: null,
      root: DiskDouble.ROOT,
    })

    expect(registry.matches({ repository, issue: { number: 33 } })).toBe(true)
  })

  it.each([
    null,
    '{',
    JSON.stringify({ repo: 'other/repo', issue: 33, commitment: 'a'.repeat(64) }),
    JSON.stringify({ repo: 'jjponz/repo-pulse', issue: 34, commitment: 'a'.repeat(64) }),
    JSON.stringify({ repo: 'jjponz/repo-pulse', issue: 33, commitment: 'not-a-digest' }),
  ])('does_not_match_an_absent_or_invalid_go_record %#', (record) => {
    const repository = new RepositoryName('jjponz/repo-pulse')
    const registry = new DiskGoRegistry({
      random: null,
      read: vi.fn(() => {
        if (record === null) throw new Error('ENOENT')
        return record
      }),
      stat: vi.fn(() => {
        if (record === null) throw new Error('ENOENT')
        return { isFile: () => true }
      }),
      write: null,
      root: DiskDouble.ROOT,
    })

    expect(registry.matches({ repository, issue: { number: 33 } })).toBe(false)
  })
})
