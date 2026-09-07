import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class Subjects {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static BACKEND = join(Subjects.HERE, '..')
  static OWN_CONVENTIONS = join(Subjects.BACKEND, 'conventions')
  static TRAVELLING_YARDSTICK = join(Subjects.BACKEND, '..', 'plugin', 'conventions')

  static RULES_THAT_WENT_UP = [
    'the burden of proof is on what is added',
    'which call breaks without it',
    'makes the name a lie',
    'The failure of the external system is data, not an exception',
    'cutting right before the external system',
    'hunt **the mutations that leave it green**',
    'the folder is the discriminator, never a suffix on the name',
    'A class nobody instantiates is a namespace',
    'a test double is not a consumer',
  ]

  static RULES_NO_OTHER_REPOSITORY_CAN_RECOVER = [
    'no declared debt in `backend/`',
    "From `backend/`, never the repository root. The fast subset is `npx vitest run --exclude '**/*-real-process.test.js'`",
    'never sow a label that is not ours',
    'killed in `afterEach`, not after the assertion',
    'Every family under `PlanFailure` names its two causes',
    'The wire format of a `code` is kebab-case',
    'invocation.js      moved out of the entrypoint until it is observable',
    'The `backend-best-practices` skill — general guidance; it yields to both.',
    'owner/repo#N',
    'Jira, GitHub, cmux, acli and gh exist only in',
    'ToolRunner      launches a binary with its budget',
    'The flag is named `safeToRepeat`.** `gh issue create` never gets `true`.',
    'A controller under `infrastructure/` is named `<endpoint>-route.js`, one\nfile per endpoint.',
  ]

  static ownDocument() {
    return readFileSync(join(Subjects.OWN_CONVENTIONS, 'this-repository.md'), 'utf8')
  }

  static everyTravellingRule() {
    return readdirSync(Subjects.TRAVELLING_YARDSTICK, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => readFileSync(join(Subjects.TRAVELLING_YARDSTICK, entry.name), 'utf8'))
      .join('\n')
  }
}

describe('this repository declares only what no other repository inherits', () => {
  it('the_conventions_folder_holds_one_document_and_it_is_this_repository', () => {
    expect(readdirSync(Subjects.OWN_CONVENTIONS)).toEqual(['this-repository.md'])
  })

  it('it_keeps_the_ubiquitous_language_that_no_other_repository_can_inherit', () => {
    for (const term of ['User story', 'Plan issue', 'Plan agent', '**GO**', 'Harvest ledger']) {
      expect(Subjects.ownDocument(), `${term} left the repository with nothing to replace it`).toContain(term)
    }
  })

  it('it_restates_no_rule_the_travelling_yardstick_already_carries', () => {
    for (const rule of Subjects.RULES_THAT_WENT_UP) {
      expect(Subjects.ownDocument(), `this-repository.md restates a travelling rule: ${rule}`).not.toContain(rule)
    }
  })

  it('every_rule_it_dropped_is_a_rule_the_travelling_yardstick_now_carries', () => {
    const everyRule = Subjects.everyTravellingRule()
    for (const rule of Subjects.RULES_THAT_WENT_UP) {
      expect(everyRule, `nobody carries this rule any more: ${rule}`).toContain(rule)
    }
  })

  it('it_keeps_every_rule_no_other_repository_could_recover', () => {
    for (const rule of Subjects.RULES_NO_OTHER_REPOSITORY_CAN_RECOVER) {
      expect(Subjects.ownDocument(), `${rule} left the repository with nothing to replace it`).toContain(rule)
    }
  })

  it('no_rule_it_keeps_is_one_the_travelling_yardstick_could_have_written_itself', () => {
    const everyRule = Subjects.everyTravellingRule()
    for (const rule of Subjects.RULES_NO_OTHER_REPOSITORY_CAN_RECOVER) {
      expect(everyRule, `the travelling yardstick already carries this: ${rule}`).not.toContain(rule)
    }
  })
})
