export class ImplementationProgress {
  async of({ root, issue }) {
    throw new Error(
      `${this.constructor.name} must implement of({ root, issue }), asked for ${issue} at ${root}`
    )
  }
}
