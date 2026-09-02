import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readGoCommitment } from '../../../plugin/scripts/go-registry.js'
import { matchesGo } from '../../../plugin/scripts/go-response.js'
import { DiskGoRegistry } from '../../src/infrastructure/disk-go-registry.js'
import { GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

class Both {
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')
  static BYTES = Buffer.from([127, 58, 145, 194])

  constructor(configDir) {
    this.configDir = configDir
  }

  static async inATemporaryHome() {
    return new Both(await mkdtemp(join(tmpdir(), 'ct-go-contract-')))
  }

  async remove() {
    await rm(this.configDir, { recursive: true, force: true })
  }

  async mint() {
    const registry = new DiskGoRegistry({
      random: () => Both.BYTES,
      write: async (path, text) => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, text)
      },
      root: join(this.configDir, 'control-tower'),
    })

    return registry.mint({ issueNumber: Both.ISSUE, repository: Both.REPOSITORY })
  }

  readBack() {
    return readGoCommitment({
      repo: Both.REPOSITORY.text, issue: Both.ISSUE, configDir: this.configDir,
    })
  }
}

describe('the two halves of the go the plugin reads', () => {
  let both = null

  afterEach(async () => {
    if (both !== null) await both.remove()
    both = null
  })

  it('the_release_gate_of_the_plugin_reads_the_commitment_this_backend_wrote', async () => {
    both = await Both.inATemporaryHome()

    const nonce = await both.mint()
    const read = both.readBack()

    expect(read.missing).toBeUndefined()
    expect(read.error).toBeUndefined()
    expect(read.commitment).toBe(DiskGoRegistry.commitmentOf(nonce))
  })

  it('the_release_gate_of_the_plugin_matches_the_comment_this_backend_sends', async () => {
    both = await Both.inATemporaryHome()

    const nonce = await both.mint()
    const commented = GhPlanIssues.goBodyFor(nonce)

    expect(matchesGo(commented, both.readBack().commitment)).toBe(true)
  })
})
