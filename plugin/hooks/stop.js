#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { parseStateSafe, describeStopRelation, classifyStopState, withLastCommit } from '../scripts/state.js'
import { resolveStatePath } from '../scripts/state-paths.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
// F22: misma precedencia que en session-start.js. En un worktree de slice esto
// resuelve a .agent/SLICE.md, que es el fichero cuya frescura importa.
//
// `rel` (la misma ruta, relativa) viaja hasta los mensajes. Aquí NO es un
// detalle: desde que la semilla trae el sha de la base, el motivo de bloqueo
// de este hook sale en CADA turno de CADA slice, y decía «Actualiza STATE.md»
// — el fichero TRACKEADO de la coordinadora, cuya contaminación es justo lo
// que F22 elimina.
const { path: statePath, rel: stateRel } = resolveStatePath(cwd)

if (!statePath) process.exit(0)

// Runner que NUNCA lanza y devuelve el código de salida: `merge-base
// --is-ancestor` contesta por código (0 sí / 1 no), así que un runner que
// convierta el 1 en excepción no sabe distinguir "no es ancestro" de "git ha
// fallado" — y esa diferencia es justo la que este hook necesita.
const git = (args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.error || r.status == null) return { status: -1, stdout: '' }
  return { status: r.status, stdout: r.stdout || '' }
}

// Sin HEAD no hay nada que comparar: repo recién inicializado sin commits, o
// cwd que no es un repo. Se sale en silencio (igual que antes).
let headSha = ''
try { headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { process.exit(0) }
if (!headSha) process.exit(0)

// '' cuando HEAD está desprendido — y entonces se dice "HEAD (desprendido en
// …)" en vez de inventarse una rama.
const branchProbe = git(['symbolic-ref', '--short', '-q', 'HEAD'])
const branch = branchProbe.status === 0 ? branchProbe.stdout.trim() : ''

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
      reason: `No se ha podido interpretar el frontmatter YAML de ${stateRel} (${parseError}). Arréglalo antes de cerrar el turno: mientras siga así, la próxima sesión no podrá hidratarse del estado ni saber si el trabajo está BLOQUEADO (campo \`blocked\`), y este mismo aviso volverá a salir.`,
    }))
  }
  process.exit(0)
}
// F12: antes esto era `headSha !== stateSha` y el mensaje afirmaba «hay
// commits más nuevos» — una relación de ancestría que el código no comprobaba
// en ningún momento. Ahora se le pregunta a git y cada caso dice lo suyo (ver
// la cabecera de la sección en scripts/state.js).
const relation = describeStopRelation({ headSha, lastCommit: meta.last_commit, git, branch })
const verdict = classifyStopState({ relation, stopHookActive: input.stop_hook_active, stateRel })

// #95/H5: el trabajo por encima lo comiteó ct-step, así que el sha que el guard
// pedía al agente lo escribe el programa — en el fichero que `resolveStatePath`
// resolvió, que en un worktree de slice es SLICE.md y nunca el STATE.md
// trackeado de la coordinadora. Si la escritura falla, no se dice nada: el
// turno cierra igual y el guard volverá a mirar en el siguiente.
if (verdict.updateLastCommitTo) {
  const { text, updated } = withLastCommit(readFileSync(statePath, 'utf8'), verdict.updateLastCommitTo)
  if (updated) {
    try { writeFileSync(statePath, text) } catch { /* el cierre de turno no depende de esto */ }
  }
}

if (verdict.block) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: verdict.reason }))
} else if (verdict.systemMessage) {
  // No bloquea, pero tampoco calla: `systemMessage` es el canal no bloqueante
  // de la salida JSON de los hooks. El turno cierra igual.
  process.stdout.write(JSON.stringify({ systemMessage: verdict.systemMessage }))
}
