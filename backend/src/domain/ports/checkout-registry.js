export class CheckoutRegistry {
  remember(root) {
    throw new Error(`${this.constructor.name} must implement remember(root), asked to remember ${root}`)
  }

  known() {
    throw new Error(`${this.constructor.name} must implement known()`)
  }
}
