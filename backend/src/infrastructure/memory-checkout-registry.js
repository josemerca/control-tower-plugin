import { CheckoutRegistry } from '../domain/ports/checkout-registry.js'

export class MemoryCheckoutRegistry extends CheckoutRegistry {
  constructor() {
    super()
    this.roots = new Map()
  }

  remember(root) {
    this.roots.set(root.text, root)
  }

  known() {
    return [...this.roots.values()]
  }
}
