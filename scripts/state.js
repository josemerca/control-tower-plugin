import { parse, stringify } from 'yaml'

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseState(md) {
  const s = (md ?? '').replace(/^﻿/, '').trimStart()
  const m = s.match(FM)
  if (!m) return { meta: {}, body: s.trim() }
  return { meta: parse(m[1]) ?? {}, body: m[2].trim() }
}

export function renderState({ meta, body }) {
  return `---\n${stringify(meta).trim()}\n---\n\n${(body ?? '').trim()}\n`
}

export function composeHydration(stateText, gitLog) {
  if (!stateText || !stateText.trim()) return ''
  const head = `# Estado del slice (hidratación automática)\n\n${stateText.trim()}`
  const log = (gitLog || '').trim()
  return log ? `${head}\n\n## Últimos commits\n${log}` : head
}

export function shouldBlockStop({ headSha, stateSha, stopHookActive }) {
  if (stopHookActive) return false
  if (!stateSha) return false
  return headSha !== stateSha
}
