import { PluginYardstick } from './plugin-yardstick.js'

export class YardstickCitation {
  static #PATH_FORM = 'conventions/[\\w.-]+\\.md'

  static #NOT_PRECEDED_BY_PATH_OR_WORD = '(?<![\\w/])'

  static #escapedName(name) {
    return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  static #source() {
    const names = PluginYardstick.FILES.map(YardstickCitation.#escapedName).join('|')
    return `${YardstickCitation.#NOT_PRECEDED_BY_PATH_OR_WORD}(?:${YardstickCitation.#PATH_FORM}|(?:${names}))`
  }

  static #documentName(citation) {
    return citation.replace(new RegExp(`^${PluginYardstick.DIRECTORY}/`), '')
  }

  static cites(text) {
    return typeof text === 'string' && new RegExp(YardstickCitation.#source()).test(text)
  }

  static documentsIn(text) {
    if (typeof text !== 'string') return []
    const found = text.match(new RegExp(YardstickCitation.#source(), 'g')) ?? []
    return [...new Set(found.map(YardstickCitation.#documentName))]
  }
}
