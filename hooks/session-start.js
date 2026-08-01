#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { composeHydration } from '../scripts/state.js'
import { resolveStatePath } from '../scripts/state-paths.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
// F22: en el worktree de un slice hay DOS ficheros de estado y sólo uno habla
// de este trabajo. Ver scripts/state-paths.js para por qué la precedencia es
// carga estructural.
const { path: statePath } = resolveStatePath(cwd)

if (statePath) {
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
