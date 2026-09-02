import { UserStoryKey } from '../domain/value-objects/user-story-key.js'
import { RepositoryName } from '../domain/value-objects/repository-name.js'

export const PlanRequestOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  BODY_TOO_LARGE: 'body-too-large',
  BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field',
  MALFORMED_ID: 'malformed-id',
  MALFORMED_REPO: 'malformed-repo',
})

export class PlanRequest {
  static ID_FIELD = 'id'
  static REPO_FIELD = 'repo'
  static KNOWN_FIELDS = Object.freeze([PlanRequest.ID_FIELD, PlanRequest.REPO_FIELD])

  constructor({ outcome, story, repository, fields }) {
    if (!Object.values(PlanRequestOutcome).includes(outcome)) {
      throw new Error(`outcome must be a PlanRequestOutcome member, got ${outcome}`)
    }
    if ((outcome === PlanRequestOutcome.ACCEPTED) === (story === null)) {
      throw new Error(`outcome ${outcome} disagrees with its story, got ${story}`)
    }
    if ((outcome === PlanRequestOutcome.ACCEPTED) === (repository === null)) {
      throw new Error(`outcome ${outcome} disagrees with its repository, got ${repository}`)
    }
    if (outcome !== PlanRequestOutcome.UNKNOWN_FIELD && fields.length > 0) {
      throw new Error(`outcome ${outcome} must carry no fields, got ${fields.join(', ')}`)
    }
    if (outcome === PlanRequestOutcome.UNKNOWN_FIELD && fields.length === 0) {
      throw new Error('an unknown-field outcome must name the fields it rejected')
    }
    this.outcome = outcome
    this.story = story
    this.repository = repository
    this.fields = Object.freeze([...fields])
    Object.freeze(this)
  }

  static accepted(story, repository) {
    return new PlanRequest({ outcome: PlanRequestOutcome.ACCEPTED, story, repository, fields: [] })
  }

  static refused(outcome) {
    return new PlanRequest({ outcome, story: null, repository: null, fields: [] })
  }

  static withUnknownFields(fields) {
    return new PlanRequest({
      outcome: PlanRequestOutcome.UNKNOWN_FIELD, story: null, repository: null, fields,
    })
  }

  static tooLarge() {
    return PlanRequest.refused(PlanRequestOutcome.BODY_TOO_LARGE)
  }

  static from(raw) {
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return PlanRequest.refused(PlanRequestOutcome.BODY_NOT_A_JSON_OBJECT)
    }
    const unknown = Object.keys(parsed).filter((field) => !PlanRequest.KNOWN_FIELDS.includes(field))
    if (unknown.length > 0) {
      return PlanRequest.withUnknownFields(unknown.sort())
    }
    const given = parsed[PlanRequest.ID_FIELD]
    if (!UserStoryKey.isWellFormed(given)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_ID)
    }
    const asked = parsed[PlanRequest.REPO_FIELD]
    if (!RepositoryName.isWellFormed(asked)) {
      return PlanRequest.refused(PlanRequestOutcome.MALFORMED_REPO)
    }
    return PlanRequest.accepted(new UserStoryKey(given), new RepositoryName(asked))
  }
}
