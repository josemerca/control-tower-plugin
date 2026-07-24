import { parse, stringify } from 'yaml'

const FM = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

export function parseState(md) {
  const m = md.match(FM)
  if (!m) return { meta: {}, body: md.trim() }
  return { meta: parse(m[1]) ?? {}, body: m[2].trim() }
}

export function renderState({ meta, body }) {
  return `---\n${stringify(meta).trim()}\n---\n\n${(body ?? '').trim()}\n`
}

export function composeHydration(stateText, gitLog) {
  if (!stateText || !stateText.trim()) return ''
  return `# Estado del slice (hidratación automática)\n\n${stateText.trim()}\n\n## Últimos commits\n${(gitLog || '').trim()}`
}

export function shouldBlockStop({ headSha, stateSha, stopHookActive }) {
  if (stopHookActive) return false
  if (!stateSha) return false
  return headSha !== stateSha
}
