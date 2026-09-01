export class PlanProgress {
  async of({ located, issue }) {
    throw new Error(`${this.constructor.name} must implement of({ located, issue }), asked for ${issue?.number} at ${located?.path}`)
  }
}
