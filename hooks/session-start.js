#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { composeHydration } from '../scripts/state.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
const statePath = join(cwd, '.agent', 'STATE.md')

if (existsSync(statePath)) {
  const stateText = readFileSync(statePath, 'utf8')
  let gitLog = ''
  try { gitLog = execFileSync('git', ['log', '--oneline', '-5'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { /* repo sin commits */ }
  const additionalContext = composeHydration(stateText, gitLog)
  if (additionalContext) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    }))
  }
}
