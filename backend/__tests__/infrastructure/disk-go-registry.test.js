import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { DiskGoRegistry } from '../../src/infrastructure/disk-go-registry.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { GoNotRecorded } from '../../src/domain/exceptions.js'

class DiskDouble {
  static ROOT = '/home/someone/.claude/control-tower'
  static BYTES = Buffer.from([1, 2, 3, 4])
  static NONCE = '01020304'

  constructor(failure = null) {
    this.failure = failure
    this.written = []
  }

  static refusing(said) {
    return new DiskDouble(new Error(said))
  }

  registry({ root = DiskDouble.ROOT } = {}) {
    return new DiskGoRegistry({
      random: () => DiskDouble.BYTES,
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

  it('what_it_writes_names_the_repository_and_the_issue_the_go_belongs_to', async () => {
    const disk = new DiskDouble()

    await disk.mintFor()

    expect(JSON.parse(disk.written[0].text)).toEqual({
      repo: 'jjponz/repo-pulse',
      issue: 33,
      commitment: createHash('sha256').update(DiskDouble.NONCE, 'utf8').digest('hex'),
    })
  })

  it('a_registry_the_disk_refused_is_a_go_that_was_never_recorded', async () => {
    const disk = DiskDouble.refusing('EACCES: permission denied')

    const refusal = await disk.refusalFor()

    expect(refusal).toBeInstanceOf(GoNotRecorded)
    expect(refusal.message).toContain('EACCES: permission denied')
    expect(refusal.message).toContain('go/jjponz__repo-pulse-33.json')
  })

  it('a_registry_without_a_root_refuses_to_exist_instead_of_writing_where_nobody_reads', () => {
    expect(() => new DiskGoRegistry({ random: () => DiskDouble.BYTES, write: async () => {} }))
      .toThrow(/absolute path/)
  })
})
