#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { composeHydration } from '../scripts/state.js'

const input = JSON.parse(readFileSync(0, 'utf8'))
const cwd = input.cwd || process.cwd()
const statePath = join(cwd, '.agent', 'STATE.md')

if (existsSync(statePath)) {
  const stateText = readFileSync(statePath, 'utf8')
  let gitLog = ''
  try { gitLog = execSync('git log --oneline -5', { cwd, encoding: 'utf8' }) } catch { /* repo sin commits */ }
  const additionalContext = composeHydration(stateText, gitLog)
  if (additionalContext) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    }))
  }
}
