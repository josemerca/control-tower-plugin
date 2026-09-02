import { describe, it, expect } from 'vitest'
import { JsonBody, Refusal } from '../../src/infrastructure/http.js'

describe('JsonBody', () => {
  it('an_overflowing_raw_body_reader_is_told_apart_from_any_other_failure_by_its_type', () => {
    expect(JsonBody.isOverflow({ type: 'entity.too.large' })).toBe(true)
    expect(JsonBody.isOverflow({ type: 'entity.parse.failed' })).toBe(false)
  })

  it('the_overflow_refusal_names_the_cap_it_enforces_instead_of_typing_the_number_twice', () => {
    const refusal = JsonBody.overflowRefusal()

    expect(refusal).toBeInstanceOf(Refusal)
    expect(refusal.status).toBe(413)
    expect(refusal.error).toBe(`body must not exceed ${JsonBody.MAX_BYTES} bytes`)
  })
})
