import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

class YardstickDocumentMother {
  static withContentForEach(content = '# Heading\nRule body.\n') {
    return PluginYardstick.FILES.map((name) => ({ name, content }))
  }

  static realistic() {
    return [
      { name: 'code.md', content: '# How code is written here\nno prose\n' },
      { name: 'decisions.md', content: '# Where a decision lives\nonce\n' },
      { name: 'architecture.md', content: '# Where each thing lives\nthree layers\n' },
      { name: 'testing.md', content: '# What a test pins\nthe name is the sentence\n' },
    ]
  }

  static withBlankContentFor(name) {
    return YardstickDocumentMother.withContentForEach().map((document) =>
      document.name === name ? { name, content: '  \n\n' } : document
    )
  }

  static withNullContentFor(name) {
    return YardstickDocumentMother.withContentForEach().map((document) =>
      document.name === name ? { name, content: null } : document
    )
  }

  static withNonStringContentFor(name) {
    return YardstickDocumentMother.withContentForEach().map((document) =>
      document.name === name ? { name, content: 42 } : document
    )
  }

  static none() {
    return []
  }

  static onlyUnknownName() {
    return [{ name: 'other.md', content: 'x' }]
  }

  static onlyCodeAndDecisions() {
    return YardstickDocumentMother.withContentForEach().slice(0, 2)
  }

  static withLeadingNullEntry() {
    return [null, { name: 'code.md', content: 'x' }]
  }
}

describe('PluginYardstick.FILES', () => {
  it('lists_the_four_yardstick_documents_in_paste_order', () => {
    expect(PluginYardstick.FILES).toEqual(['code.md', 'decisions.md', 'architecture.md', 'testing.md'])
  })

  it('every_declared_file_exists_in_the_conventions_directory', () => {
    const onDisk = readdirSync(join(root, PluginYardstick.DIRECTORY))
    for (const name of PluginYardstick.FILES) expect(onDisk).toContain(name)
  })

  it('every_markdown_file_in_the_directory_is_declared_so_none_travels_unlisted', () => {
    const onDisk = readdirSync(join(root, PluginYardstick.DIRECTORY)).filter((file) => file.endsWith('.md'))
    expect([...onDisk].sort()).toEqual([...PluginYardstick.FILES].sort())
  })
})

describe('PluginYardstick.missingDocuments', () => {
  it('reports_nothing_missing_when_all_four_arrive_with_content', () => {
    expect(PluginYardstick.missingDocuments(YardstickDocumentMother.withContentForEach())).toEqual([])
  })

  it('names_the_document_that_arrives_blank_because_a_blank_document_is_not_a_document', () => {
    expect(PluginYardstick.missingDocuments(YardstickDocumentMother.withBlankContentFor('decisions.md')))
      .toEqual(['decisions.md'])
  })

  it('names_the_document_that_arrives_null', () => {
    expect(PluginYardstick.missingDocuments(YardstickDocumentMother.withNullContentFor('code.md')))
      .toEqual(['code.md'])
  })

  it('names_the_document_absent_from_the_received_list', () => {
    expect(PluginYardstick.missingDocuments(YardstickDocumentMother.onlyCodeAndDecisions()))
      .toEqual(['architecture.md', 'testing.md'])
  })

  it('reports_all_four_missing_when_nothing_is_received', () => {
    expect(PluginYardstick.missingDocuments(YardstickDocumentMother.none())).toEqual([...PluginYardstick.FILES])
  })

  it('treats_anything_that_is_not_a_list_of_documents_as_all_missing_instead_of_throwing', () => {
    expect(PluginYardstick.missingDocuments({})).toEqual([...PluginYardstick.FILES])
    expect(PluginYardstick.missingDocuments(5)).toEqual([...PluginYardstick.FILES])
    expect(PluginYardstick.missingDocuments(undefined)).toEqual([...PluginYardstick.FILES])
  })

  it('treats_non_string_content_as_missing_instead_of_throwing', () => {
    expect(PluginYardstick.missingDocuments(YardstickDocumentMother.withNonStringContentFor('testing.md')))
      .toEqual(['testing.md'])
  })

  it('a_null_entry_inside_the_list_does_not_break_the_count_of_the_rest', () => {
    expect(PluginYardstick.missingDocuments(YardstickDocumentMother.withLeadingNullEntry()))
      .toEqual(['decisions.md', 'architecture.md', 'testing.md'])
  })
})

describe('PluginYardstick.composeSection', () => {
  const section = PluginYardstick.composeSection(YardstickDocumentMother.realistic())

  it('states_the_program_wrote_it_and_the_plan_cannot_remove_it', () => {
    expect(section).toContain('conventions/')
    expect(section).toContain('ningún agente')
  })

  it('headers_each_document_with_its_path_so_the_judge_can_cite_it', () => {
    for (const name of PluginYardstick.FILES) {
      expect(section).toContain(`## Vara de ct: conventions/${name}`)
    }
  })

  it('pastes_each_document_content_verbatim', () => {
    expect(section).toContain('# How code is written here\nno prose')
    expect(section).toContain('the name is the sentence')
  })

  it('keeps_the_declared_order', () => {
    const positions = PluginYardstick.FILES.map((name) => section.indexOf(`conventions/${name}`))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

describe('PluginYardstick.composeSection refuses to compose half a promise', () => {
  it('throws_instead_of_returning_only_the_header_when_the_list_is_empty', () => {
    expect(() => PluginYardstick.composeSection(YardstickDocumentMother.none()))
      .toThrow(/cannot compose the ct yardstick/)
  })

  it('throws_when_only_unknown_names_are_received_because_they_are_not_yardstick_documents', () => {
    expect(() => PluginYardstick.composeSection(YardstickDocumentMother.onlyUnknownName()))
      .toThrow(/cannot compose the ct yardstick/)
  })

  it('throws_naming_the_missing_document_when_one_arrives_blank', () => {
    expect(() => PluginYardstick.composeSection(YardstickDocumentMother.withBlankContentFor('architecture.md')))
      .toThrow(/architecture\.md/)
  })

  it('throws_naming_the_missing_document_when_one_arrives_with_non_string_content', () => {
    expect(() => PluginYardstick.composeSection(YardstickDocumentMother.withNullContentFor('code.md')))
      .toThrow(/code\.md/)
  })
})

describe('the precedence header carries both sides of the rule', () => {
  const header = () => PluginYardstick.composeSection(YardstickDocumentMother.withContentForEach()).split('## Vara de ct:')[0]

  it('states_ct_takes_precedence', () => {
    expect(header()).toMatch(/preferencia/i)
  })

  it('states_precedence_is_measured_rule_by_rule_not_by_topic', () => {
    expect(header()).toMatch(/regla a regla/i)
    expect(header()).toMatch(/no por tema/i)
  })

  it('states_a_repo_rule_ct_does_not_address_still_binds_in_full', () => {
    expect(header()).toMatch(/obliga entera/i)
  })

  it('states_both_directions_of_the_clash_the_repo_requiring_what_ct_forbids_and_forbidding_what_ct_requires', () => {
    const normalized = header().replace(/^>\s?/gm, '').replace(/\s+/g, ' ')
    expect(normalized).toMatch(/manda hacer algo que uno de estos documentos prohíbe/i)
    expect(normalized).toMatch(/prohíbe algo que exigen/i)
  })

  it('carries_the_naming_case_with_both_sides_because_that_is_what_makes_the_rule_operative', () => {
    const text = header()
    expect(text).toMatch(/mayúsculas/i)
    expect(text).toContain('castellano')
    expect(text).toContain('conventions/code.md')
  })
})

describe('the same rule reaches both English texts: the judge and the implementer', () => {
  const TARGET_FILES = {
    'agents/ct-judge.md': join(root, 'agents', 'ct-judge.md'),
    'prompts/task-implementer.md': join(root, 'prompts', 'task-implementer.md'),
  }

  const CLAIMS = {
    'ct takes precedence': /take precedence/i,
    'it is measured rule by rule, not by topic': /rule by rule, not by topic/i,
    'both directions of the clash: what the repo requires and what it forbids':
      /forbids, or forbids what they require/i,
    "the repo yardstick is not voided where ct stays silent": {
      'agents/ct-judge.md': /it binds in full|does not delete this repo's yardstick/i,
      'prompts/task-implementer.md': /does not excuse you from this repo's conventions/i,
    },
  }

  for (const [fileLabel, path] of Object.entries(TARGET_FILES)) {
    const text = readFileSync(path, 'utf8').replace(/\s+/g, ' ')
    for (const [claim, pattern] of Object.entries(CLAIMS)) {
      const regex = pattern instanceof RegExp ? pattern : pattern[fileLabel]
      it(`${fileLabel} states: ${claim}`, () => {
        expect(text, `${fileLabel} does not state: ${claim}`).toMatch(regex)
      })
    }
  }
})

describe('scripts/vara.js, the sibling module, is untouched', () => {
  it('keeps_transporting_the_repo_declaration_from_its_own_dot_agent_file', async () => {
    const repoYardstick = await import('../scripts/vara.js')
    expect(repoYardstick.CONVENTIONS_FILE).toBe('.agent/conventions.md')
    expect(typeof repoYardstick.seccionDeVara).toBe('function')
  })
})

describe('the patrones item measures both yardsticks', () => {
  const item = () => {
    const text = readFileSync(join(root, 'agents', 'ct-judge.md'), 'utf8')
    return /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(text)[0]
  }

  it('names_both_yardsticks_and_names_the_ct_one_by_the_plugin_directory', () => {
    expect(item()).toContain("plugin's `conventions/` directory")
    expect(item()).toContain('.agent/conventions.md')
  })

  it('states_precedence_is_measured_rule_by_rule_not_by_topic', () => {
    expect(item()).toMatch(/rule by rule/i)
  })

  it('states_a_repo_rule_ct_does_not_address_still_binds_and_does_not_void_the_repo', () => {
    expect(item()).toContain('it binds in full')
    expect(item()).toContain("does not delete this repo's yardstick")
  })

  it('declares_sin_vara_can_no_longer_happen_instead_of_offering_it_as_an_outcome', () => {
    expect(item()).toMatch(/never `sin-vara`/)
    expect(item()).not.toMatch(/count the item `sin-vara`/)
  })

  it('keeps_no_aplica_for_a_diff_with_no_code_to_compare', () => {
    expect(item()).toContain('no-aplica')
  })

  it('names_the_four_documents_and_requires_citing_rule_and_path', () => {
    for (const name of PluginYardstick.FILES) expect(item()).toContain(name)
    expect(item()).toContain('evidence')
  })

  it('closes_the_old_module_loophole_with_the_same_phrase_as_the_document', () => {
    expect(item()).toContain('a new concept is a new module')
  })
})

describe('the texts that teach the ct yardstick name it', () => {
  const readFile = (...parts) => readFileSync(join(root, ...parts), 'utf8')

  it('ct_step_is_the_one_that_reads_it_from_disk', () => {
    expect(readFile('scripts', 'ct-step.mjs')).toContain('plugin-yardstick.js')
  })

  it('kickoff_names_the_directory_in_the_slices_first_act', () => {
    expect(readFile('scripts', 'kickoff.js')).toContain(PluginYardstick.DIRECTORY)
  })

  it('the_task_implementer_prompt_names_the_directory', () => {
    expect(readFile('prompts', 'task-implementer.md')).toContain(`${PluginYardstick.DIRECTORY}/`)
  })

  it('the_writing_plans_prescriptive_skill_names_the_directory', () => {
    expect(readFile('skills', 'writing-plans-prescriptive', 'SKILL.md')).toContain(`${PluginYardstick.DIRECTORY}/`)
  })

  it('ct_judge_names_the_directory_inside_the_patrones_item', () => {
    const text = readFile('agents', 'ct-judge.md')
    const match = /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(text)
    expect(match).not.toBeNull()
    expect(match[0]).toContain(`${PluginYardstick.DIRECTORY}/`)
  })
})

describe('the implementer and the judge read the same text', () => {
  const readImplementerAndJudge = () => [
    readFileSync(join(root, 'prompts', 'task-implementer.md'), 'utf8'),
    readFileSync(join(root, 'agents', 'ct-judge.md'), 'utf8'),
  ]

  it('both_name_the_four_ct_documents', () => {
    for (const text of readImplementerAndJudge()) {
      for (const name of PluginYardstick.FILES) expect(text).toContain(name)
    }
  })

  it('both_still_name_the_repo_declaration_because_there_are_two_yardsticks', () => {
    for (const text of readImplementerAndJudge()) expect(text).toContain('.agent/conventions.md')
  })

  it('both_carry_the_full_phrase_that_closes_the_old_module_exemption', () => {
    for (const text of readImplementerAndJudge()) {
      expect(text).toContain('a new concept is a new module and is born conforming')
    }
  })
})
