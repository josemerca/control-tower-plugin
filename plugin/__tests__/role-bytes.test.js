import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RoleBytes, RoleMaterialUndeclared } from '../scripts/role-bytes.js'
import { STEPS } from '../scripts/run-machine.js'

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

class FileSizes {
  constructor(bytes) {
    this.bytes = new Map(Object.entries(bytes))
    Object.freeze(this)
  }

  static declaring(bytes) {
    return new FileSizes(bytes)
  }

  reader() {
    return (path) => {
      if (!this.bytes.has(path)) throw new Error(`the test declared no size for ${path}`)
      return this.bytes.get(path)
    }
  }
}

class DispatchedRole {
  static ROOT = '/plugin'
  static PACKAGE = '/repo/.agent/run-7/task-1-review.diff'

  static #TDD_SKILL = {
    '/plugin/skills/test-driven-development/SKILL.md': 900,
    '/plugin/skills/test-driven-development/testing-anti-patterns.md': 80,
  }

  static everythingReadable() {
    return DispatchedRole.#reading({
      '/plugin/agents/ct-judge.md': 5000,
      ...DispatchedRole.#TDD_SKILL,
      [DispatchedRole.PACKAGE]: 42,
    })
  }

  static withoutSkillOrders() {
    return DispatchedRole.#reading({
      '/plugin/agents/ct-slice-judge.md': 3000,
      [DispatchedRole.PACKAGE]: 42,
    })
  }

  static withAnUnreadableAgent() {
    return DispatchedRole.#reading({
      '/plugin/agents/ct-judge.md': null,
      ...DispatchedRole.#TDD_SKILL,
      [DispatchedRole.PACKAGE]: 42,
    })
  }

  static withOneUnreadableSkill() {
    return DispatchedRole.#reading({
      '/plugin/agents/ct-judge.md': 5000,
      '/plugin/skills/test-driven-development/SKILL.md': 900,
      '/plugin/skills/test-driven-development/testing-anti-patterns.md': null,
      [DispatchedRole.PACKAGE]: 42,
    })
  }

  static #reading(sizes) {
    return new RoleBytes({ pluginRoot: DispatchedRole.ROOT, sizeOf: FileSizes.declaring(sizes).reader() })
  }
}

describe('what a dispatched role reads, in bytes', () => {
  it('a judge is charged its agent file, the skill it is ordered to load and the package it was handed', () => {
    const measured = DispatchedRole.everythingReadable()
      .measuresOf({ step: STEPS.JUDGE, packagePath: DispatchedRole.PACKAGE })
    expect({ ...measured }).toEqual({ agent_bytes: 5000, skill_bytes: 980, package_bytes: 42 })
  })

  it('a role that is ordered no skill is charged zero, which is an answer and not an absence', () => {
    const measured = DispatchedRole.withoutSkillOrders()
      .measuresOf({ step: STEPS.SLICE_JUDGE, packagePath: DispatchedRole.PACKAGE })
    expect(measured.skill_bytes).toBe(0)
  })

  it('an agent file that cannot be sized leaves null and never zero, which would claim a role dispatched with nothing', () => {
    const measured = DispatchedRole.withAnUnreadableAgent()
      .measuresOf({ step: STEPS.JUDGE, packagePath: DispatchedRole.PACKAGE })
    expect(measured.agent_bytes).toBeNull()
  })

  it('one skill file that cannot be sized leaves the whole sum null instead of a partial total that reads as the whole', () => {
    const measured = DispatchedRole.withOneUnreadableSkill()
      .measuresOf({ step: STEPS.JUDGE, packagePath: DispatchedRole.PACKAGE })
    expect(measured.skill_bytes).toBeNull()
  })

  it('a round that handed the role no package leaves the package null and still charges the rest', () => {
    const measured = DispatchedRole.everythingReadable()
      .measuresOf({ step: STEPS.JUDGE, packagePath: null })
    expect({ ...measured }).toEqual({ agent_bytes: 5000, skill_bytes: 980, package_bytes: null })
  })

  it('a step the list does not describe raises instead of falling into a catch-all that would charge it zero', () => {
    expect(() => DispatchedRole.everythingReadable()
      .measuresOf({ step: STEPS.CONTROLS, packagePath: null })).toThrow(RoleMaterialUndeclared)
  })

  it('the described steps are exactly the four that hand work to a subagent', () => {
    expect(RoleBytes.STEPS).toEqual([STEPS.IMPLEMENT, STEPS.JUDGE, STEPS.SLICE_JUDGE, STEPS.RECONCILE])
  })
})

describe('the list cannot name a file the plugin does not ship', () => {
  for (const step of RoleBytes.STEPS) {
    it(`every file charged to ${step} travels inside the plugin`, () => {
      const missing = RoleBytes.filesOf(step).filter((relative) => !existsSync(join(PLUGIN_ROOT, relative)))
      expect(missing).toEqual([])
    })
  }
})
