import { describe, it, expect } from 'vitest'
import { AcliUserStories } from '../../src/infrastructure/acli-user-stories.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { UserStoryNotRead, UserStoryNotUnderstood, UserStoryFailure } from '../../src/domain/exceptions.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { ExternalTool } from '../../src/infrastructure/external-tool.js'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.js'
import { SleepDouble } from '../sleep-double.js'

class AcliDouble {
  constructor(printed) {
    this.printed = printed
    this.calls = []
    this.sleeping = new SleepDouble()
  }

  static answering(fields) {
    return new AcliDouble(JSON.stringify({ key: 'MO_SHOP-42', fields }))
  }

  static refusing(said) {
    return new AcliDouble(new ProcessOutput({ code: 1, stdout: '', stderr: said }))
  }

  userStories() {
    return new AcliUserStories({
      acli: new ExternalTool({
        launch: (argv) => {
          this.calls.push(argv)
          if (this.printed instanceof ProcessOutput) return Promise.resolve(this.printed)
          return Promise.resolve(new ProcessOutput({ code: 0, stdout: this.printed, stderr: '' }))
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 3, waitSeconds: 2 }) }),
        sleep: (seconds) => this.sleeping.sleep(seconds),
      }),
    })
  }

  async detailFor(text = 'MO_SHOP-42') {
    return this.userStories().detail(new UserStoryKey(text))
  }

  async refusalFor(text = 'MO_SHOP-42') {
    return this.detailFor(text).catch((cause) => cause)
  }
}

describe('AcliUserStories', () => {
  it('the_call_it_makes_asks_for_the_story_by_key_and_only_for_the_fields_it_consumes', async () => {
    const acli = AcliDouble.answering({ summary: 'rename the button', description: '' })

    await acli.detailFor('MO_SHOP-42')

    expect(acli.calls).toEqual([[
      'jira', 'workitem', 'view', 'MO_SHOP-42', '--json', '--fields', 'summary,description',
    ]])
  })

  it('what_jira_says_comes_back_as_a_story_and_not_as_the_envelope_acli_printed', async () => {
    const acli = AcliDouble.answering({ summary: 'rename the button', description: 'plain text' })

    const story = await acli.detailFor()

    expect(story.key.text).toBe('MO_SHOP-42')
    expect(story.summary).toBe('rename the button')
    expect((await AcliDouble.answering({ summary: '  padded  ', description: '' }).detailFor()).summary)
      .toBe('padded')
    expect(story.description).toBe('plain text')
  })

  it('a_description_written_in_the_rich_format_arrives_as_the_text_a_reader_would_see', async () => {
    const acli = AcliDouble.answering({
      summary: 'a summary',
      description: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'first line' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'second line' }] },
        ],
      },
    })

    expect((await acli.detailFor()).description).toBe('first line\nsecond line')
  })

  it('the_bullets_of_a_list_do_not_run_into_each_other_because_each_item_breaks_the_line', async () => {
    const acli = AcliDouble.answering({
      summary: 'a summary',
      description: {
        type: 'doc',
        content: [{
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'text', text: 'one' }] },
            { type: 'listItem', content: [{ type: 'text', text: 'two' }] },
          ],
        }],
      },
    })

    expect((await acli.detailFor()).description).toBe('one\ntwo')
  })

  it('a_story_with_no_description_gives_an_empty_one_instead_of_the_word_undefined', async () => {
    const acli = AcliDouble.answering({ summary: 'a summary' })

    const story = await acli.detailFor()

    expect(story.description).toBe('')
    expect(story.hasDescription()).toBe(false)
  })

  it('a_story_with_no_summary_is_refused_because_there_would_be_nothing_to_title_the_issue_with', async () => {
    const refusal = await AcliDouble.answering({ summary: '   ' }).refusalFor()

    expect(refusal).toBeInstanceOf(UserStoryNotUnderstood)
    expect(refusal.message).toContain('no summary in jira')
  })

  it('an_acli_that_refuses_the_call_arrives_typed_so_the_caller_can_tell_it_from_a_crash', async () => {
    const refusal = await AcliDouble.refusing('no such work item').refusalFor()

    expect(refusal).toBeInstanceOf(UserStoryNotRead)
    expect(refusal.message).toContain('no such work item')
  })

  it('a_blip_reading_jira_is_retried_because_asking_for_the_same_story_twice_reads_the_same_story', async () => {
    const acli = AcliDouble.refusing('dial tcp: i/o timeout')

    const refusal = await acli.refusalFor()

    expect(acli.calls).toHaveLength(4)
    expect(acli.sleeping.slept).toEqual([2, 2, 2])
    expect(refusal).toBeInstanceOf(UserStoryNotRead)
  })

  it('a_story_that_does_not_exist_is_not_asked_for_again_because_it_will_not_appear', async () => {
    const acli = AcliDouble.refusing('Issue does not exist or you do not have permission to see it')

    await acli.refusalFor()

    expect(acli.calls).toHaveLength(1)
    expect(acli.sleeping.slept).toEqual([])
  })

  it('an_acli_that_is_not_logged_in_says_what_to_run_instead_of_repeating_its_own_wording', async () => {
    const refusal = await AcliDouble.refusing('401 Unauthorized').refusalFor()

    expect(refusal).toBeInstanceOf(UserStoryNotRead)
    expect(refusal.message).toContain('acli jira auth login')
    expect(refusal.message).toContain('401 Unauthorized')
  })

  it('acli_answering_something_unreadable_is_told_apart_from_acli_refusing_the_call', async () => {
    const unreadable = await new AcliDouble('not json at all').refusalFor()
    const refused = await AcliDouble.refusing('boom').refusalFor()

    expect(unreadable).toBeInstanceOf(UserStoryNotUnderstood)
    expect(refused).toBeInstanceOf(UserStoryNotRead)
    expect(unreadable).not.toBeInstanceOf(UserStoryNotRead)
  })

  it('an_answer_without_the_fields_we_read_is_refused_instead_of_becoming_an_empty_story', async () => {
    const refusal = await new AcliDouble('{"key":"MO_SHOP-42"}').refusalFor()

    expect(refusal).toBeInstanceOf(UserStoryNotUnderstood)
    expect(refusal.message).toContain('without the fields')
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await new AcliDouble('not json at all').refusalFor()
    const refused = await AcliDouble.refusing('boom').refusalFor()

    expect(unreadable).toBeInstanceOf(UserStoryFailure)
    expect(refused).toBeInstanceOf(UserStoryFailure)
  })
})
