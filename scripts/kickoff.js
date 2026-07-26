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

export function renderKickoff(slice, { repo, dispatchCheckPath }) {
  const addendum = ADDENDA[slice.type] || ''
  return [
    `Estás implementando UN slice (${slice.entrega}) del repo ${repo}, issue ${slice.issue || `orden #${slice.n}`}.`,
    `Es human-gated: NO empieces el siguiente slice; al terminar deja el PR listo y PARA.`,
    `Arranque verification-first: confirma pwd/rama, git log, y baseline verde ANTES de tocar nada.`,
    `Hidrátate de .agent/STATE.md y del issue de GitHub; los criterios de aceptación son ${slice.ac.join(', ') || '(ver issue)'}.`,
    `Sigue superpowers:subagent-driven-development (impl → spec-review → code-review) con TDD.`,
    addendum,
    // W-C: el claim (status:ready → status:in-progress) lo hace /ct-next en
    // código, ANTES de crear este worktree — no por el prompt. El release
    // (in-progress → in-review) SÍ se deja aquí a propósito (decisión ya
    // tomada), con el Phase 3 PR conformance gate como backstop eventual. El
    // comando es LITERAL, con issue/repo ya sustituidos — no una descripción
    // que el agente tenga que traducir por su cuenta y pueda no ejecutar.
    //
    // Fix round 1 (review de W-C), finding 1: `${CLAUDE_PLUGIN_ROOT}` NO es
    // una env var del shell de la sesión del agente — solo la sustituye
    // Claude Code al renderizar `commands/*.md`/`hooks/hooks.json`. Un
    // kickoff (un prompt de texto plano, no un fichero de comando) que
    // emitiera ese token literal produciría un `Cannot find module` en TODO
    // despacho con éxito. `dispatchCheckPath` llega ya resuelto como ruta
    // absoluta real (ct-next.mjs la calcula relativa a su propia ubicación)
    // y se interpola tal cual — nunca el token sin expandir.
    `Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre PR, libera el claim con \`node ${dispatchCheckPath} ${slice.n} --repo ${repo} --release\`, deja el estado mergeable y PARA.`,
  ].filter(Boolean).join('\n')
}

export function buildStateSeed(slice, { branch, base }) {
  const issueNum = slice.issue != null ? parseInt(String(slice.issue).replace('#', ''), 10) : null
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
