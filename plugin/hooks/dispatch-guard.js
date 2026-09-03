#!/usr/bin/env node
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Dispatch, DispatchGate } from '../scripts/dispatch-gate.js'

class RunFile {
  static #DIR = '.agent'
  static #SHAPE = /^run-\d+\.json$/

  static onlyOneIn(cwd) {
    const found = RunFile.#listedIn(cwd)
    if (found.length !== 1) return null
    return RunFile.#parsed(found[0])
  }

  static #listedIn(cwd) {
    if (cwd === '') return []
    try {
      return readdirSync(join(cwd, RunFile.#DIR))
        .filter((entry) => RunFile.#SHAPE.test(entry))
        .map((entry) => join(cwd, RunFile.#DIR, entry))
    } catch {
      return []
    }
  }

  static #parsed(path) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      return null
    }
  }
}

export class DispatchGuard {
  static #EVENT = 'PreToolUse'
  static #TOOL = 'Task'

  static decide(input, readRun, ctStepPath) {
    if (input?.hook_event_name !== DispatchGuard.#EVENT) return null
    if (input.tool_name !== DispatchGuard.#TOOL) return null
    const run = readRun(input.cwd)
    if (run === null) return null
    const verdict = DispatchGate.verdictFor(run, ctStepPath)
    if (verdict.dispatch === Dispatch.LET_THROUGH) return null
    if (verdict.dispatch === Dispatch.DENIED) return DispatchGuard.#payloadDenying(verdict.reason)
    throw new Error(`DispatchGuard cannot answer a verdict it does not know: ${JSON.stringify(verdict.dispatch)}`)
  }

  static #payloadDenying(reason) {
    return {
      hookSpecificOutput: {
        hookEventName: DispatchGuard.#EVENT,
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }
  }

  static ctStepBesideThisHook(hookUrl) {
    return join(dirname(dirname(fileURLToPath(hookUrl))), 'scripts', 'ct-step.mjs')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input
  try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }

  const decision = DispatchGuard.decide(input, RunFile.onlyOneIn, DispatchGuard.ctStepBesideThisHook(import.meta.url))
  if (decision) process.stdout.write(JSON.stringify(decision), () => process.exit(0))
  else process.exit(0)
}
