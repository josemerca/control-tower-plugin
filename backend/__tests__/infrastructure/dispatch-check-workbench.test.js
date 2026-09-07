import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { DispatchCheckWorkbench } from '../../src/infrastructure/dispatch-check-workbench.js'
import { Workbench } from '../../src/domain/ports/workbench.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { SliceNotReopened, ReopenNotUnderstood } from '../../src/domain/exceptions.js'

class PluginContract {
  static SCRIPT = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'plugin', 'scripts', 'dispatch-check.mjs'
  )
  static #REOPEN = /\nif \(reopen\) \{\n([\s\S]*?)\n\}\n/
  static #DIED = /\bdie(?:Err|Out)[\s\S]*?,\s*(\d+)\s*\)/g

  static #reopenBlock() {
    const source = readFileSync(PluginContract.SCRIPT, 'utf8')
    const reopen = source.match(PluginContract.#REOPEN)
    if (reopen === null) throw new Error(`${PluginContract.SCRIPT} no longer carries a reopen block`)

    return reopen[1]
  }

  static #ascending(codes) {
    return [...new Set(codes)].sort((one, other) => one - other)
  }

  static codesDyingInSource(block) {
    return PluginContract.#ascending([...block.matchAll(PluginContract.#DIED)].map((found) => Number(found[1])))
  }

  static codesTheReopenBlockCanExitWith() {
    const block = PluginContract.#reopenBlock()
    const died = PluginContract.codesDyingInSource(block)
    const hasExit0 = /process\.exit\(0\)/.test(block)

    return hasExit0 ? PluginContract.#ascending([...died, 0]) : died
  }
}

class NodeDouble {
  static DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static ISSUE = new PlanIssue({
    number: 7, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')

  constructor(answer) {
    this.answer = answer
    this.calls = []
  }

  static exiting(code, { stdout = '', stderr = '' } = {}) {
    return new NodeDouble(new ProcessOutput({ code, stdout, stderr }))
  }

  workbench() {
    return new DispatchCheckWorkbench({
      node: (argv, options) => {
        this.calls.push({ argv, options })

        return Promise.resolve(this.answer)
      },
      dispatchCheck: NodeDouble.DISPATCH_CHECK,
    })
  }

  async reopen() {
    return this.workbench().reopen({ issue: NodeDouble.ISSUE, repository: NodeDouble.REPOSITORY })
  }

  async refusal() {
    return this.reopen().catch((cause) => cause)
  }
}

describe('DispatchCheckWorkbench', () => {
  it('the_invocation_it_sends_is_the_reopen_of_that_issue_in_that_repository', async () => {
    const node = NodeDouble.exiting(0)

    await node.reopen()

    expect(node.calls.map((call) => call.argv)).toEqual([[
      NodeDouble.DISPATCH_CHECK, '7', '--repo', 'josemerca/ct-loop-sandbox', '--reopen',
    ]])
  })

  it('a_reopened_slice_comes_back_without_a_refusal_so_the_errand_can_be_typed', async () => {
    await expect(NodeDouble.exiting(0).reopen()).resolves.toBeUndefined()
  })

  it('a_label_that_could_not_be_written_travels_out_as_not_reopened_because_the_issue_stays_in_review', async () => {
    const refusal = await NodeDouble.exiting(1, { stderr: 'no se pudo reabrir #7' }).refusal()

    expect(refusal).toBeInstanceOf(SliceNotReopened)
    expect(refusal).not.toBeInstanceOf(ReopenNotUnderstood)
    expect(refusal.message).toContain('no se pudo reabrir #7')
  })

  it('a_precondition_that_does_not_hold_travels_out_as_not_reopened_and_says_nothing_was_touched', async () => {
    const refusal = await NodeDouble.exiting(2, { stderr: '#7 ya está en status:ready' }).refusal()

    expect(refusal).toBeInstanceOf(SliceNotReopened)
    expect(refusal.message).toContain('ya está en status:ready')
  })

  it('a_state_that_could_not_be_read_travels_out_as_not_reopened_so_the_next_tick_can_try_again', async () => {
    const refusal = await NodeDouble.exiting(3, { stderr: 'no se pudo leer el estado' }).refusal()

    expect(refusal).toBeInstanceOf(SliceNotReopened)
  })

  it('a_code_the_contract_never_declared_travels_out_as_not_understood_instead_of_being_guessed', async () => {
    const refusal = await NodeDouble.exiting(9, { stdout: 'algo', stderr: 'otra cosa' }).refusal()

    expect(refusal).toBeInstanceOf(ReopenNotUnderstood)
    expect(refusal).not.toBeInstanceOf(SliceNotReopened)
    expect(refusal.message).toContain('9')
  })

  it('the_declared_codes_are_the_four_the_reopen_contract_names', () => {
    expect(DispatchCheckWorkbench.declaredCodes().sort()).toEqual([0, 1, 2, 3])
  })

  it('every_code_the_reopen_block_can_exit_with_is_one_this_adapter_declares', () => {
    const scriptCodes = PluginContract.codesTheReopenBlockCanExitWith()
    const declaredCodes = DispatchCheckWorkbench.declaredCodes()

    expect(declaredCodes.sort()).toEqual(scriptCodes.sort())
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new Workbench().reopen({
      issue: NodeDouble.ISSUE, repository: NodeDouble.REPOSITORY,
    })).rejects.toThrow(/must implement reopen/)
  })
})
