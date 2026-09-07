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
    'is data, not an exception',
    'cutting right before the external system',
    'hunt **the mutations that leave it green**',
  ]

  static ownDocument() {
    return readFileSync(join(Subjects.OWN_CONVENTIONS, 'this-repository.md'), 'utf8')
  }

  static everyTravellingRule() {
    return readdirSync(Subjects.TRAVELLING_YARDSTICK)
      .map((file) => readFileSync(join(Subjects.TRAVELLING_YARDSTICK, file), 'utf8'))
      .join('\n')
  }
}

describe('this repository declares only what no other repository inherits', () => {
  it('the_conventions_folder_holds_one_document_and_it_is_this_repository', () => {
    expect(readdirSync(Subjects.OWN_CONVENTIONS)).toEqual(['this-repository.md'])
  })

  it('it_keeps_the_ubiquitous_language_that_no_other_repository_can_inherit', () => {
    for (const term of ['User story', 'Plan issue', 'Plan agent', 'GO', 'Harvest ledger']) {
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
})
