import { describe, it, expect } from 'vitest'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'
import { YardstickCitation } from '../scripts/yardstick-citation.js'

class CitationTextMother {
  static withPathForm(name = 'style.md') {
    return `\`${PluginYardstick.DIRECTORY}/${name}\` dice que la conversión vive en el dominio`
  }

  static withBareName(name = 'style.md') {
    return `${name}: la regla de inglés no la alcanza`
  }

  static asTheJudgeOfSliceEightWroteThem() {
    return 'style.md: la regla de inglés no la alcanza. architecture.md: no nace ningún módulo. '
      + 'decisions.md: la decisión se escribe una vez. testing.md: no hay tests en el diff. '
      + 'defects.md, sus cuatro reglas, una por una.'
  }

  static withTheRepoYardstick() {
    return `el fichero \`docs/${PluginYardstick.DIRECTORY}/style.md\` dice que se usa camelCase`
  }
}

describe('YardstickCitation.cites', () => {
  it('recognises_the_path_form_that_survives_a_renamed_document', () => {
    expect(YardstickCitation.cites(CitationTextMother.withPathForm('naming.md'))).toBe(true)
  })

  it('recognises_a_bare_document_name_which_is_how_the_judge_of_slice_eight_cited_all_five', () => {
    expect(YardstickCitation.cites(CitationTextMother.withBareName('defects.md'))).toBe(true)
  })

  it('refuses_a_bare_name_that_the_yardstick_does_not_carry_because_nothing_else_marks_it', () => {
    expect(YardstickCitation.cites(CitationTextMother.withBareName('naming.md'))).toBe(false)
    expect(YardstickCitation.cites(CitationTextMother.withBareName('AGENTS.md'))).toBe(false)
  })

  it('refuses_the_repository_own_yardstick_which_holds_both_substrings', () => {
    expect(YardstickCitation.cites(CitationTextMother.withTheRepoYardstick())).toBe(false)
    expect(YardstickCitation.cites('el fichero `docs/style.md` pide camelCase')).toBe(false)
  })

  it('refuses_a_path_glued_to_a_word', () => {
    expect(YardstickCitation.cites('mis_conventions/style.md no es la vara de ct')).toBe(false)
  })

  it('refuses_anything_that_is_not_text', () => {
    for (const nothing of ['', undefined, null, 42]) expect(YardstickCitation.cites(nothing)).toBe(false)
  })
})

describe('YardstickCitation.documentsIn', () => {
  it('answers_with_the_document_name_so_both_spellings_are_one_document_read', () => {
    expect(YardstickCitation.documentsIn(`${PluginYardstick.DIRECTORY}/style.md y también style.md`))
      .toEqual(['style.md'])
  })

  it('answers_once_per_document_however_many_times_the_text_cites_it', () => {
    const text = `${PluginYardstick.DIRECTORY}/style.md, otra vez ${PluginYardstick.DIRECTORY}/style.md, `
      + `y ${PluginYardstick.DIRECTORY}/defects.md`
    expect(YardstickCitation.documentsIn(text)).toEqual(['style.md', 'defects.md'])
  })

  it('counts_the_five_bare_names_the_slice_eight_judge_wrote_which_the_path_form_alone_counted_as_zero', () => {
    expect(YardstickCitation.documentsIn(CitationTextMother.asTheJudgeOfSliceEightWroteThem()))
      .toEqual(['style.md', 'architecture.md', 'decisions.md', 'testing.md', 'defects.md'])
  })

  it('takes_its_list_of_bare_names_from_the_files_that_define_the_yardstick', () => {
    for (const name of PluginYardstick.FILES) {
      expect(YardstickCitation.documentsIn(CitationTextMother.withBareName(name)), name).toEqual([name])
    }
  })

  it('still_counts_a_renamed_document_cited_with_its_path', () => {
    expect(YardstickCitation.documentsIn(CitationTextMother.withPathForm('naming.md'))).toEqual(['naming.md'])
  })

  it('answers_nothing_for_the_repository_own_yardstick', () => {
    expect(YardstickCitation.documentsIn(CitationTextMother.withTheRepoYardstick())).toEqual([])
  })

  it('answers_nothing_for_anything_that_is_not_text', () => {
    for (const nothing of [undefined, null, 42]) expect(YardstickCitation.documentsIn(nothing)).toEqual([])
  })

  it('measures_from_the_start_on_every_call_so_a_hoisted_global_regex_cannot_carry_lastIndex', () => {
    const text = `${PluginYardstick.DIRECTORY}/defects.md`
    expect(YardstickCitation.documentsIn(text)).toEqual(['defects.md'])
    expect(YardstickCitation.documentsIn(text)).toEqual(['defects.md'])
  })
})
