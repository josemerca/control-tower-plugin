#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseStateSafe, shouldBlockStop } from '../scripts/state.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
const statePath = join(cwd, '.agent', 'STATE.md')

if (!existsSync(statePath)) process.exit(0)

let headSha = ''
try { headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { process.exit(0) }

// F7: `parseState` LANZA con un frontmatter mal formado, y aquí se llamaba sin
// red — un STATE.md con un YAML roto hacía reventar este hook (stack trace por
// stderr) en CADA cierre de turno de ese repo, sin decir en ningún momento que
// el problema era el fichero. Ahora se trata como lo que es: el estado no se
// puede leer, así que ni se sabe si HEAD ha avanzado ni se sabe si el trabajo
// está bloqueado — y eso se DICE (una vez; `stop_hook_active` corta el bucle
// igual que en el camino normal) en vez de morir a gritos o, peor, callar.
const { meta, error: parseError } = parseStateSafe(readFileSync(statePath, 'utf8'))
if (parseError) {
  if (!input.stop_hook_active) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `No se ha podido interpretar el frontmatter YAML de .agent/STATE.md (${parseError}). Arréglalo antes de cerrar el turno: mientras siga así, la próxima sesión no podrá hidratarse del estado ni saber si el trabajo está BLOQUEADO (campo \`blocked\`), y este mismo aviso volverá a salir.`,
    }))
  }
  process.exit(0)
}
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
    reason: 'Hay commits más nuevos que el `last_commit` de .agent/STATE.md. Actualiza STATE.md (you_are_here, next_action, tasks[], last_commit) antes de cerrar el turno, para que la próxima sesión se hidrate correcta. Y si el trabajo NO puede continuar (bloqueado por una decisión, un dato falso, una dependencia externa…), no lo escribas en prosa dentro de next_action: ponlo en el campo `blocked` (`blocked: {reason: "…", unblock: "…"}`), que es lo que el hook de SessionStart anuncia y lo que suspende el next_action en la siguiente sesión.',
  }))
}
