#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseState, shouldBlockStop } from '../scripts/state.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
const statePath = join(cwd, '.agent', 'STATE.md')

if (!existsSync(statePath)) process.exit(0)

let headSha = ''
try { headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { process.exit(0) }

const { meta } = parseState(readFileSync(statePath, 'utf8'))
let stateSha = ''
if (meta.last_commit) {
  try {
    stateSha = execFileSync('git', ['rev-parse', `${meta.last_commit}^{commit}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    stateSha = String(meta.last_commit)
  }
}

if (shouldBlockStop({ headSha, stateSha, stopHookActive: input.stop_hook_active })) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'Hay commits más nuevos que el `last_commit` de .agent/STATE.md. Actualiza STATE.md (you_are_here, next_action, tasks[], last_commit) antes de cerrar el turno, para que la próxima sesión se hidrate correcta.',
  }))
}
