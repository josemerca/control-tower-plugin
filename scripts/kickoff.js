import { homedir } from 'node:os'
import { join } from 'node:path'
import { renderState } from './state.js'

export const ACCOUNT_MAP = {
  personal: ['menoplus', 'munger', 'control-tower'],
  work: ['mo.', 'mercadona'],
  personalDir: join(homedir(), '.claude-personal'),
  workDir: join(homedir(), '.claude-work'),
}

const ADDENDA = {
  ui: 'Addendum UI: gate de screenshot obligatorio y respeta el design system; no cambies tokens de marca.',
  backend: 'Addendum backend: migración forward+rollback, respeta contratos, reporta el cambio de API.',
  infra: 'Addendum infra: dry-run/plan primero, nunca secretos en claro, apply solo tras review.',
  bugfix: 'Addendum bugfix: reproduce-first (test que falla con el síntoma exacto), causa raíz, fix mínimo, test de regresión.',
}

export function renderKickoff(slice, { repo }) {
  const addendum = ADDENDA[slice.type] || ''
  return [
    `Estás implementando UN slice (${slice.entrega}) del repo ${repo}, issue ${slice.issue || `orden #${slice.n}`}.`,
    `Es human-gated: NO empieces el siguiente slice; al terminar deja el PR listo y PARA.`,
    `Arranque verification-first: confirma pwd/rama, git log, y baseline verde ANTES de tocar nada.`,
    `Hidrátate de .agent/STATE.md y del issue de GitHub; los criterios de aceptación son ${slice.ac.join(', ') || '(ver issue)'}.`,
    `Sigue superpowers:subagent-driven-development (impl → spec-review → code-review) con TDD.`,
    addendum,
    `Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre PR, deja el estado mergeable y PARA.`,
  ].filter(Boolean).join('\n')
}

export function buildStateSeed(slice, { branch, base }) {
  const issueNum = slice.issue ? parseInt(String(slice.issue).replace('#', ''), 10) : null
  return renderState({
    meta: {
      task: slice.entrega,
      status: 'not_started',
      branch,
      base,
      last_commit: '',
      github_issue: issueNum,
      you_are_here: `worktree fresco para el slice #${slice.n}`,
      next_action: `hidrátate del issue y empieza por el primer AC (${slice.ac[0] || 'ver issue'})`,
      verify: '',
      tasks: [],
    },
    body: '## Current State\n(slice recién despachado, sin trabajo aún)',
  })
}
