export class ImplementationProgress {
  async of({ root, issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement of({ root, issue, repository }), asked for ${issue} of ${repository} at ${root}`
    )
  }
}
