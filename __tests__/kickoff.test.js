import { describe, it, expect } from 'vitest'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP, ADDENDA } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'

const SLICE = { n: 7, entrega: 'refresh token', type: 'backend', ac: ['AC-7.1'], deps: [1], issue: '#7' }

describe('renderKickoff', () => {
  it('backend: has backend markers, not ui/infra/bugfix', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r' })
    expect(k).toContain('subagent-driven-development')
    expect(k).toContain('.agent/STATE.md')
    expect(k.toLowerCase()).toMatch(/migraci|rollback|contrato/) // backend present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/screenshot|design system/) // not ui
    expect(k.toLowerCase()).not.toMatch(/dry-run.*plan primero/) // not infra
    expect(k.toLowerCase()).not.toMatch(/reproduce-first.*test que falla/) // not bugfix
  })
  it('ui: has ui markers, not backend/infra/bugfix', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui' }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/screenshot|design system/) // ui present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/migraci|rollback|contrato/) // not backend
    expect(k.toLowerCase()).not.toMatch(/dry-run.*plan primero/) // not infra
    expect(k.toLowerCase()).not.toMatch(/reproduce-first.*test que falla/) // not bugfix
  })
  it('infra: has infra markers, not ui/backend/bugfix', () => {
    const k = renderKickoff({ ...SLICE, type: 'infra' }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/dry-run.*plan primero/) // infra present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/screenshot|design system/) // not ui
    expect(k.toLowerCase()).not.toMatch(/migraci|rollback|contrato/) // not backend
    expect(k.toLowerCase()).not.toMatch(/reproduce-first.*test que falla/) // not bugfix
  })
  it('bugfix: has bugfix markers, not ui/backend/infra', () => {
    const k = renderKickoff({ ...SLICE, type: 'bugfix' }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/reproduce-first.*test que falla/) // bugfix present
    // Verify other addenda are NOT present
    expect(k.toLowerCase()).not.toMatch(/screenshot|design system/) // not ui
    expect(k.toLowerCase()).not.toMatch(/migraci|rollback|contrato/) // not backend
    expect(k.toLowerCase()).not.toMatch(/dry-run.*plan primero/) // not infra
  })
})

// W-C: la liberación del claim (status:in-progress → status:in-review) sigue
// viviendo en el kickoff (la decide el agente, no el código) — pero tiene que
// ser el comando LITERAL con los valores reales sustituidos, no una
// descripción que el agente tenga que traducir por su cuenta y pueda no
// ejecutar nunca (ver el brief: "instruir al agente vía el prompt no es
// aceptable [para el claim] porque un prompt es advisory" — el release SÍ
// se deja en el prompt a propósito, pero con el mismo cuidado de literalidad).
//
// Fix round 1 (review de W-C), finding 1 — CRÍTICO EN LA PRÁCTICA: `${CLAUDE_
// PLUGIN_ROOT}` solo lo sustituye Claude Code al renderizar `commands/*.md` y
// `hooks/hooks.json` — NO es una variable de entorno del shell de la sesión
// del agente (verificado por el reviewer: `env | grep CLAUDE` en una sesión
// con el plugin cargado muestra CLAUDE_CONFIG_DIR/CLAUDE_CODE_*, pero nunca
// CLAUDE_PLUGIN_ROOT). Un kickoff que emita ese token literal produciría
// `node ${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-check.mjs ...` → el agente lo
// ejecutaría tal cual y obtendría `Cannot find module` — en CADA despacho con
// éxito, no un caso límite. `ct-next.mjs` ya resuelve `dispatchCheckPath`
// como ruta absoluta real (relativa a su propia ubicación): renderKickoff
// debe recibirla y usarla tal cual, nunca el token sin expandir.
describe('renderKickoff — instrucción de --release (W-C, fix round 1: ruta real, no ${CLAUDE_PLUGIN_ROOT})', () => {
  const FAKE_DISPATCH_CHECK_PATH = '/plugin/root/scripts/dispatch-check.mjs'

  it('incluye el comando literal de dispatch-check --release con la ruta ABSOLUTA real recibida, con issue y repo sustituidos', () => {
    const k = renderKickoff({ ...SLICE, n: 42 }, { repo: 'o/r', dispatchCheckPath: FAKE_DISPATCH_CHECK_PATH })
    expect(k).toContain(`node ${FAKE_DISPATCH_CHECK_PATH} 42 --repo o/r --release`)
  })

  it('NUNCA emite el token ${CLAUDE_PLUGIN_ROOT} sin expandir — no es una env var real del shell de la sesión del agente', () => {
    const k = renderKickoff({ ...SLICE, n: 7 }, { repo: 'menoplus-app/menoplus', dispatchCheckPath: FAKE_DISPATCH_CHECK_PATH })
    expect(k).not.toContain('CLAUDE_PLUGIN_ROOT')
  })
})

describe('buildStateSeed', () => {
  it('produce STATE.md parseable con los campos del slice', () => {
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.status).toBe('not_started')
    expect(meta.github_issue).toBe(7)
    expect(meta.branch).toBe('feat/7')
  })
  it('handles issue: null → github_issue: null', () => {
    const sliceNoIssue = { ...SLICE, issue: null }
    const seed = buildStateSeed(sliceNoIssue, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.github_issue).toBe(null)
  })
  it('handles empty ac array → next_action falls back to "ver issue"', () => {
    const sliceEmptyAc = { ...SLICE, ac: [] }
    const seed = buildStateSeed(sliceEmptyAc, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.next_action).toContain('ver issue')
  })
})

// F3: `Tipo` (columna §9 del spec) decide qué addendum recibe el agente
// despachado — ct-groom.mjs necesita el conjunto de valores reconocidos
// para avisar cuando el spec trae un `Tipo` que no matchea ninguna key de
// `ADDENDA`, SIN mantener una segunda lista hardcodeada que pueda divergir
// (si mañana se añade `type: 'ios'` aquí, el aviso de ct-groom.mjs lo
// reconoce automáticamente, sin tocar ct-groom.mjs). Para eso `ADDENDA`
// tiene que ser exportado — antes era un `const` interno de este módulo.
describe('ADDENDA', () => {
  it('se exporta (ct-groom.mjs deriva de aquí el conjunto de Tipo reconocidos, sin duplicarlo)', () => {
    expect(Object.keys(ADDENDA).sort()).toEqual(['backend', 'bugfix', 'infra', 'ui'])
  })
})

describe('ACCOUNT_MAP', () => {
  it('tiene personal/work y dirs', () => {
    expect(ACCOUNT_MAP.personal).toContain('menoplus')
    expect(ACCOUNT_MAP.personalDir).toMatch(/claude-personal/)
    expect(ACCOUNT_MAP.workDir).toMatch(/claude-work/)
  })
})
