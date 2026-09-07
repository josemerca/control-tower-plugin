import { describe, it, expect } from 'vitest'
import { PlanIssueBody, GhPlanIssues } from '../../src/infrastructure/gh-plan-issues.js'
import { UserStory } from '../../src/domain/value-objects/user-story.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { PlanComment } from '../../src/domain/value-objects/plan-comment.js'
import { mapGhIssue, extractAc, extractOrder } from '../../../plugin/scripts/gh-issue-map.js'
import { parseScope } from '../../../plugin/scripts/scope.js'
import { buildIssueBody } from '../../../plugin/scripts/groom.js'

class Groomed {
  static #ROW = {
    n: 1, name: 'un slice', entrega: 'lo que entrega', type: '', gate: '', e2e: '',
    ac: ['un criterio'], deps: [], protected: '',
  }

  static body() {
    return buildIssueBody(Groomed.#ROW, { path: 'spec.md', reason: 'sin remoto' }, 'contexto', null)
  }
}

class Opened {
  static NUMBER = 41

  static story({ summary = 'El buscador acepta acentos', description = 'como comprador quiero' } = {}) {
    return new UserStory({ key: new UserStoryKey('MO_SHOP-42'), summary, description })
  }

  static asGithubSees({ story = Opened.story(), comment = null } = {}) {
    return {
      number: Opened.NUMBER,
      title: PlanIssueBody.titleFor({ story, comment }),
      body: PlanIssueBody.of({ story, comment }),
      labels: PlanIssueBody.labels({ story, comment }).map((name) => ({ name })),
      milestone: null,
    }
  }

  static asTheDispatcherReadsIt(story = Opened.story()) {
    return mapGhIssue(Opened.asGithubSees({ story }))
  }

  static commentOnly(text = 'lo que pide el humano') {
    return { story: null, comment: new PlanComment(text) }
  }
}

describe('PlanIssueBody', () => {
  it('the_dispatcher_reads_the_issue_as_ready_with_the_plan_gate_that_stops_it_for_a_human', () => {
    const seen = Opened.asTheDispatcherReadsIt()

    expect(seen.status).toBe('ready')
    expect(seen.gates).toEqual(['plan'])
    expect(seen.gatesDeclared).toBe(true)
  })

  it('with_no_order_marker_the_dispatcher_falls_back_to_the_issue_number_so_two_userStories_never_collide', () => {
    expect(extractOrder(PlanIssueBody.of({ story: Opened.story(), comment: null }))).toBe(null)
    expect(Opened.asTheDispatcherReadsIt().n).toBe(Opened.NUMBER)
  })

  it('the_sections_nobody_wrote_are_read_as_empty_and_not_as_content_that_was_never_there', () => {
    const seen = Opened.asTheDispatcherReadsIt()

    expect(seen.ac).toEqual([])
    expect(seen.deps).toEqual([])
    expect(extractAc(PlanIssueBody.of({ story: Opened.story(), comment: null }))).toEqual([])
  })

  it('what_jira_said_is_where_the_kickoff_sends_the_agent_to_read_it', () => {
    const body = PlanIssueBody.of({
      story: Opened.story({ description: 'la búsqueda ignora los acentos' }),
      comment: null,
    })

    expect(body).toContain('## Contexto del epic\nla búsqueda ignora los acentos')
    expect(body).toContain('## Descripción\nEl buscador acepta acentos')
  })

  it('a_story_with_no_description_says_the_user_story_is_unwritten_instead_of_leaving_a_blank', () => {
    const body = PlanIssueBody.of({ story: Opened.story({ description: '   ' }), comment: null })

    expect(body).toContain('MO_SHOP-42 no trae descripción en Jira')
  })

  it('the_scope_guard_finds_no_scope_declared_which_is_what_it_answers_when_it_cannot_check', () => {
    const scope = parseScope(PlanIssueBody.of({ story: Opened.story(), comment: null }))

    expect(scope.declared).toBe(false)
    expect(scope.reason).toContain('no declara `Alcance:`')
  })

  it('an_issue_number_written_in_jira_does_not_become_a_link_to_someone_elses_issue_here', () => {
    const body = PlanIssueBody.of({
      story: Opened.story({ description: 'Slice #7 del epic, sobre las vistas de #5' }),
      comment: null,
    })

    expect(body).toContain('Slice `#7` del epic, sobre las vistas de `#5`')
    expect(body.split('\n').filter((line) => /(?<![\w`])#\d+/.test(line))).toEqual([])
  })

  it('a_handle_written_in_jira_does_not_notify_whoever_owns_it_on_github', () => {
    const body = PlanIssueBody.of({
      story: Opened.story({ description: 'lo revisa @jjponz, escribe a foo@bar.com' }),
      comment: null,
    })

    expect(body).toContain('lo revisa `@jjponz`, escribe a foo@bar.com')
  })

  it('what_jira_already_wrote_as_code_is_left_alone_instead_of_being_fenced_twice', () => {
    expect(PlanIssueBody.quieted('ya viene en `#7` y suelto #8')).toBe('ya viene en `#7` y suelto `#8`')
  })

  it('the_headings_it_writes_are_the_ones_the_plugin_writes_so_a_rename_there_cannot_pass_unseen', () => {
    const groomed = Groomed.body()

    for (const heading of [
      PlanIssueBody.DESCRIPTION_HEADING,
      PlanIssueBody.AC_HEADING,
      PlanIssueBody.PROTECTED_HEADING,
    ]) {
      expect(groomed, `the plugin no longer writes ${heading}`).toContain(`\n${heading}\n`)
    }
  })

  it('a_summary_carrying_an_issue_number_does_not_reach_out_and_touch_that_issue_either', () => {
    const body = PlanIssueBody.of({ story: Opened.story({ summary: 'Bug #4521 con @jjponz' }), comment: null })

    expect(body).toContain('## Descripción\nBug `#4521` con `@jjponz`')
    expect(body.split('\n').filter((line) => /(?<![\w`])#\d+/.test(line))).toEqual([])
  })

  it('a_reference_written_the_long_way_round_reaches_the_other_repository_just_the_same', () => {
    expect(PlanIssueBody.quieted('ver mercadona/shop#123 ahora'))
      .toBe('ver `mercadona/shop#123` ahora')
    expect(PlanIssueBody.quieted('ver https://github.com/mercadona/shop/issues/9 ahora'))
      .toBe('ver `https://github.com/mercadona/shop/issues/9` ahora')
  })

  it('a_story_with_no_summary_worth_the_name_says_so_instead_of_leaving_the_section_blank', () => {
    expect(PlanIssueBody.of({ story: Opened.story({ summary: '—' }), comment: null }))
      .toContain('_MO_SHOP-42 no trae resumen en Jira._')
  })

  it('the_title_names_the_story_because_without_a_slice_table_there_is_no_order_to_name', () => {
    expect(PlanIssueBody.titleFor({ story: Opened.story(), comment: null }))
      .toBe('MO_SHOP-42 El buscador acepta acentos')
  })

  it('every_section_the_plugin_writes_and_we_can_fill_is_there_in_the_order_it_writes_them', () => {
    const headings = PlanIssueBody.of({ story: Opened.story(), comment: null })
      .split('\n').filter((line) => line.startsWith('## '))

    expect(headings).toEqual([
      '## Descripción',
      '## Contexto del epic',
      '## Contexto heredado',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '## Gates',
      '## Out of scope / Protected',
    ])
  })

  it('the_comment_reaches_the_issue_in_a_section_of_its_own_so_the_agent_knows_who_asked', () => {
    const body = PlanIssueBody.of({
      story: Opened.story(),
      comment: new PlanComment('lo que pide el humano'),
    })

    expect(body).toContain('## Comentario de quien pide el plan\nlo que pide el humano')
  })

  it('an_issue_number_written_in_the_comment_does_not_reach_out_and_touch_that_issue', () => {
    const body = PlanIssueBody.of({
      story: Opened.story(),
      comment: new PlanComment('Slice #7 del comentario'),
    })

    expect(body).toContain('## Comentario de quien pide el plan\nSlice `#7` del comentario')
    expect(body.split('\n').filter((line) => /(?<![\w`])#\d+/.test(line))).toEqual([])
  })

  it('a_story_asked_for_without_a_comment_writes_the_body_it_wrote_before', () => {
    const body = PlanIssueBody.of({ story: Opened.story(), comment: null })

    expect(body).not.toContain(PlanIssueBody.COMMENT_HEADING)
  })

  it('the_section_of_the_comment_sits_between_the_description_and_the_epic_context', () => {
    const headings = PlanIssueBody.of({
      story: Opened.story(),
      comment: new PlanComment('lo que pide el humano'),
    }).split('\n').filter((line) => line.startsWith('## '))

    expect(headings).toEqual([
      '## Descripción',
      '## Comentario de quien pide el plan',
      '## Contexto del epic',
      '## Contexto heredado',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '## Gates',
      '## Out of scope / Protected',
    ])
  })

  it('the_gates_section_tells_the_human_how_to_answer_the_go_instead_of_naming_the_gate_alone', () => {
    expect(PlanIssueBody.of({ story: Opened.story(), comment: null })).toContain('-OK <nonce>')
  })
})

describe('an issue with no user story is born from the comment alone', () => {
  it('an_issue_with_no_user_story_is_titled_by_the_first_line_of_the_comment', () => {
    const { story, comment } = Opened.commentOnly('arreglar el buscador\ny quitar el filtro roto')

    expect(PlanIssueBody.titleFor({ story, comment })).toBe('arreglar el buscador')
  })

  it('a_first_line_longer_than_a_github_title_is_cut_and_says_it_was_cut', () => {
    const exactly72 = 'a'.repeat(72)
    const oneOver = 'a'.repeat(73)

    expect(PlanIssueBody.titleFor(Opened.commentOnly(exactly72))).toBe(exactly72)
    expect(PlanIssueBody.titleFor(Opened.commentOnly(oneOver)))
      .toBe(`${'a'.repeat(71)}${PlanIssueBody.HEADLINE_CUT}`)
  })

  it('the_first_line_of_a_body_with_no_story_says_the_plan_was_asked_by_hand_instead_of_naming_a_key', () => {
    const [firstLine] = PlanIssueBody.of(Opened.commentOnly()).split('\n')

    expect(firstLine).toBe(PlanIssueBody.NO_STORY_LINE)
  })

  it('a_body_with_no_story_says_there_is_no_jira_story_where_the_epic_context_goes', () => {
    const body = PlanIssueBody.of(Opened.commentOnly())

    expect(body).toContain(`## Contexto del epic\n${PlanIssueBody.NO_STORY_EPIC_CONTEXT}`)
  })

  it('a_comment_whose_first_line_carries_no_words_says_so_instead_of_leaving_the_description_blank', () => {
    const body = PlanIssueBody.of(Opened.commentOnly('—'))

    expect(body).toContain(`## Descripción\n${PlanIssueBody.NO_HEADLINE}`)
  })
})

describe('the issue body says how changes are asked for', () => {
  it('the_issue_body_tells_the_human_to_comment_the_token_instead_of_just_naming_it', () => {
    const body = PlanIssueBody.of({ story: Opened.story(), comment: null })

    expect(body.split(GhPlanIssues.CHANGES_TOKEN)).toHaveLength(2)
    expect(PlanIssueBody.CHANGES_LINE).toMatch(/comenta/)
    expect(PlanIssueBody.CHANGES_LINE).toMatch(/cambios en el plan/)
    expect(PlanIssueBody.CHANGES_LINE).toMatch(/lo que escribas detrás/)
    expect(PlanIssueBody.CHANGES_LINE).toMatch(/plan rehecho/)
    expect(PlanIssueBody.CHANGES_LINE).toContain(`\`${GhPlanIssues.CHANGES_TOKEN}\``)
  })

  it('what_it_says_is_the_second_line_of_the_issue_because_that_is_where_it_gets_read', () => {
    const [story, asking] = PlanIssueBody.of({ story: Opened.story(), comment: null }).split('\n')

    expect(story).toBe(`> Historia de usuario: ${Opened.story().key}`)
    expect(asking).toBe(PlanIssueBody.CHANGES_LINE)
  })
})
