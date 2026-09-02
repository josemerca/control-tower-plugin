import { UserStories } from '../domain/ports/user-stories.js'
import { UserStory } from '../domain/value-objects/user-story.js'
import { UserStoryNotRead, UserStoryNotUnderstood } from '../domain/exceptions.js'

export class AcliUserStories extends UserStories {
  static BIN = 'acli'

  static #FIELDS = 'summary,description'
  static #UNAUTHENTICATED = /auth|login|unauthorized|401/i
  static #BREAKING_NODES = ['paragraph', 'heading', 'listItem']
  static #BLANK_RUN = /\n{3,}/g

  constructor({ acli }) {
    super()
    this.acli = acli
  }

  static argvFor(key) {
    return ['jira', 'workitem', 'view', key.text, '--json', '--fields', AcliUserStories.#FIELDS]
  }

  async detail(key) {
    const argv = AcliUserStories.argvFor(key)
    const output = await this.acli.run(argv, { safeToRepeat: true })
    if (output.failed) {
      throw new UserStoryNotRead(
        `${AcliUserStories.BIN} ${argv[0]} failed: ${AcliUserStories.#reasonFor(output.stderr.trim())}`
      )
    }

    return AcliUserStories.#storyFrom(output.stdout, key)
  }

  static #reasonFor(message) {
    return AcliUserStories.#UNAUTHENTICATED.test(message)
      ? `${AcliUserStories.BIN} is not authenticated, run "acli jira auth login" and try again: ${message}`
      : message
  }

  static #storyFrom(printed, key) {
    const fields = AcliUserStories.#fieldsIn(printed, key)

    return new UserStory({
      key,
      summary: AcliUserStories.#summaryIn(fields, key),
      description: AcliUserStories.#plainText(fields.description),
    })
  }

  static #fieldsIn(printed, key) {
    let parsed
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw new UserStoryNotUnderstood(
        `acli answered something that is not json for ${key}, it printed ${JSON.stringify(printed)}`
      )
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.fields !== 'object' || parsed.fields === null) {
      throw new UserStoryNotUnderstood(
        `acli answered without the fields of ${key}, it printed ${JSON.stringify(printed)}`
      )
    }

    return parsed.fields
  }

  static #summaryIn(fields, key) {
    const { summary } = fields
    if (typeof summary !== 'string' || summary.trim().length === 0) {
      throw new UserStoryNotUnderstood(`${key} has no summary in jira, so there is nothing to plan`)
    }

    return summary.trim()
  }

  static #plainText(description) {
    if (typeof description === 'string') return description.trim()
    if (description === null || typeof description !== 'object') return ''
    const parts = []
    AcliUserStories.#walk(description, parts)

    return parts.join('').replace(AcliUserStories.#BLANK_RUN, '\n\n').trim()
  }

  static #walk(node, parts) {
    if (node === null || typeof node !== 'object') return
    if (typeof node.text === 'string') parts.push(node.text)
    if (!Array.isArray(node.content)) return
    for (const child of node.content) AcliUserStories.#walk(child, parts)
    if (AcliUserStories.#BREAKING_NODES.includes(node.type)) parts.push('\n')
  }
}
