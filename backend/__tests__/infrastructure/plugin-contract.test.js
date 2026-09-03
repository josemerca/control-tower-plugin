import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { readGoCommitment, goPath } from '../../../plugin/scripts/go-registry.js'
import { matchesGo } from '../../../plugin/scripts/go-response.js'
import { controlTowerDir } from '../../../plugin/scripts/run-metrics.js'
import { LOOP_STATUS_LABELS } from '../../../plugin/scripts/groom.js'
import { DiskGoRegistry } from '../../src/infrastructure/disk-go-registry.js'
import { GhPlanIssues, PlanIssueBody } from '../../src/infrastructure/gh-plan-issues.js'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.js'
import { UserStory } from '../../src/domain/value-objects/user-story.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { Invocation } from '../../src/infrastructure/invocation.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

class Both {
  static ISSUE = 33
  static REPOSITORY = new RepositoryName('jjponz/repo-pulse')
  static FILL = 127

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
      random: (bytes) => Buffer.alloc(bytes, Both.FILL),
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

describe('the directory both halves write the go into', () => {
  const HOME = '/home/someone'

  it('the_state_root_this_backend_resolves_is_the_one_the_plugin_computes_for_the_same_environment', () => {
    const asked = [{}, { [Invocation.CONFIG_VARIABLE]: '/elsewhere/cfg' }]

    const ours = asked.map((environment) => Invocation.stateRootIn(environment, HOME))
    const theirs = asked.map((environment) => controlTowerDir({
      configDir: environment[Invocation.CONFIG_VARIABLE] || null, home: HOME,
    }))

    expect(ours).toEqual(theirs)
  })

  it('the_whole_path_of_the_registry_is_the_one_the_release_gate_opens', () => {
    const environment = { [Invocation.CONFIG_VARIABLE]: '/elsewhere/cfg' }

    const ours = DiskGoRegistry.pathFor({
      issueNumber: Both.ISSUE,
      repository: Both.REPOSITORY,
      root: Invocation.stateRootIn(environment, HOME),
    })

    expect(ours).toBe(goPath({
      repo: Both.REPOSITORY.text, issue: Both.ISSUE, configDir: '/elsewhere/cfg', home: HOME,
    }))
  })
})

describe('the status labels this backend writes and the plugin reads', () => {
  it('both_ends_of_the_claim_are_labels_the_loop_declares_instead_of_names_invented_here', () => {
    expect(LOOP_STATUS_LABELS).toContain(GhPlanIssues.IN_PROGRESS_LABEL)
    expect(LOOP_STATUS_LABELS).toContain(PlanIssueBody.READY_LABEL)
  })
})

describe('the sections the errand sends the agent to read', () => {
  const body = () => PlanIssueBody.of(new UserStory({
    key: new UserStoryKey('XOP-4909'), summary: 'la métrica de los campeones', description: 'como analista quiero',
  }))

  it('the_two_it_names_are_headings_the_plugin_really_renders_in_the_body_we_write', () => {
    const headings = body().split('\n').filter((line) => line.startsWith('## '))

    expect(headings).toContain(`## ${PlanAgentBrief.EPIC_CONTEXT}`)
    expect(headings).toContain(`## ${PlanAgentBrief.INHERITED_CONTEXT}`)
  })
})
