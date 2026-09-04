import { describe, it, expect } from 'vitest'
import { MemoryCheckoutRegistry } from '../../src/infrastructure/memory-checkout-registry.js'
import { CheckoutRegistry } from '../../src/domain/ports/checkout-registry.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'

class Remembering {
  static ONE = new CheckoutRoot('/repos/one')
  static OTHER = new CheckoutRoot('/repos/other')

  static after(...roots) {
    const registry = new MemoryCheckoutRegistry()
    for (const root of roots) registry.remember(root)

    return registry.known().map((root) => root.text)
  }
}

describe('MemoryCheckoutRegistry', () => {
  it('it_is_the_registry_the_use_case_asks_for_and_not_a_lookalike', () => {
    expect(new MemoryCheckoutRegistry()).toBeInstanceOf(CheckoutRegistry)
  })

  it('a_server_that_just_started_knows_no_clone_so_the_first_sweep_has_nothing_to_survey', () => {
    expect(Remembering.after()).toEqual([])
  })

  it('a_clone_remembered_twice_is_known_once_so_the_sweep_never_surveys_the_same_checkout_twice', () => {
    expect(Remembering.after(Remembering.ONE, new CheckoutRoot('/repos/one'))).toEqual(['/repos/one'])
  })

  it('two_clones_are_both_known_in_the_order_their_plans_started', () => {
    expect(Remembering.after(Remembering.ONE, Remembering.OTHER)).toEqual(['/repos/one', '/repos/other'])
  })
})
