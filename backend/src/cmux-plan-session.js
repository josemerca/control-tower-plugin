export class CmuxPlanSession {
  static #REF = /^OK\s+(workspace:\d+)\s*$/m

  constructor({ run }) {
    this.run = run
  }

  static argvFor(id, cwd) {
    return [
      'new-workspace',
      '--name', `ct-plan-${id}`,
      '--cwd', cwd,
      '--command', `echo "plan session up for ${id}"`,
    ]
  }

  async start(id) {
    const printed = await this.run(CmuxPlanSession.argvFor(id, process.cwd()))
    const found = printed.match(CmuxPlanSession.#REF)
    if (found === null) {
      throw new Error(`cmux did not name the workspace it created, it printed ${JSON.stringify(printed)}`)
    }
    return found[1]
  }
}
