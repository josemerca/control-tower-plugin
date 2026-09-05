import { join } from 'node:path'
import { STEPS } from './run-machine.js'

export class RoleMaterialUndeclared extends Error {
  constructor(step) {
    super(`no role material is declared for the step "${step}"`)
    this.step = step
  }
}

export class RoleBytesMeasures {
  constructor({ agent_bytes, skill_bytes, package_bytes }) {
    this.agent_bytes = agent_bytes
    this.skill_bytes = skill_bytes
    this.package_bytes = package_bytes
    Object.freeze(this)
  }
}

export class RoleBytes {
  static #TEST_DRIVEN_DEVELOPMENT = Object.freeze([
    'skills/test-driven-development/SKILL.md',
    'skills/test-driven-development/testing-anti-patterns.md',
  ])

  static #NO_SKILL = Object.freeze([])

  static #MATERIAL = new Map([
    [STEPS.IMPLEMENT, { agent: 'prompts/task-implementer.md', skills: RoleBytes.#TEST_DRIVEN_DEVELOPMENT }],
    [STEPS.JUDGE, { agent: 'agents/ct-judge.md', skills: RoleBytes.#TEST_DRIVEN_DEVELOPMENT }],
    [STEPS.SLICE_JUDGE, { agent: 'agents/ct-slice-judge.md', skills: RoleBytes.#NO_SKILL }],
    [STEPS.RECONCILE, { agent: 'agents/ct-reconciler.md', skills: RoleBytes.#NO_SKILL }],
  ])

  static STEPS = Object.freeze([...RoleBytes.#MATERIAL.keys()])

  static #materialOf(step) {
    const material = RoleBytes.#MATERIAL.get(step)
    if (!material) throw new RoleMaterialUndeclared(step)
    return material
  }

  static filesOf(step) {
    const material = RoleBytes.#materialOf(step)
    return Object.freeze([material.agent, ...material.skills])
  }

  constructor({ pluginRoot, sizeOf }) {
    this.pluginRoot = pluginRoot
    this.sizeOf = sizeOf
    Object.freeze(this)
  }

  measuresOf({ step, packagePath }) {
    const material = RoleBytes.#materialOf(step)
    return new RoleBytesMeasures({
      agent_bytes: this.sizeOf(join(this.pluginRoot, material.agent)),
      skill_bytes: this.#skillBytes(material.skills),
      package_bytes: packagePath === null ? null : this.sizeOf(packagePath),
    })
  }

  #skillBytes(skills) {
    let total = 0
    for (const skill of skills) {
      const bytes = this.sizeOf(join(this.pluginRoot, skill))
      if (bytes === null) return null
      total += bytes
    }
    return total
  }
}
