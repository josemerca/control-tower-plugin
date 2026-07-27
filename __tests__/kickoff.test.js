import { describe, it, expect } from 'vitest'
import { renderKickoff, buildStateSeed, ACCOUNT_MAP, ADDENDA } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'
import { resolveAccount, resolveAccountLegacy, validateAccountMap } from '../scripts/dispatch.js'

const SLICE = { n: 7, name: 'refresh token', type: 'backend', ac: ['AC-7.1'], deps: [1], issue: '#7' }

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
    expect(ACCOUNT_MAP.personal.some((p) => p.endsWith('/menoplus'))).toBe(true)
    expect(ACCOUNT_MAP.personalDir).toMatch(/claude-personal/)
    expect(ACCOUNT_MAP.workDir).toMatch(/claude-work/)
  })

  // D4, defecto 1: el mapa REAL (no uno de laboratorio) tiene que pasar su
  // propia validación — si no, ct-next.mjs abortaría con exit 2 en CADA
  // corrida, y eso solo se descubriría al ejecutarlo.
  it('el mapa por defecto es válido según validateAccountMap', () => {
    expect(validateAccountMap(ACCOUNT_MAP)).toEqual([])
  })

  // El caso concreto que motivó todo el defecto 1, fijado end-to-end contra
  // el mapa REAL: con el mapa anterior, este repo se despachaba con la cuenta
  // PERSONAL (`mercadona` no podía casar nunca porque el owner se descartaba
  // antes de llegar al matcher).
  it('un repo cualquiera de la org mercadona va a la cuenta de TRABAJO', () => {
    const r = resolveAccount('mercadona/algun-tool-interno', ACCOUNT_MAP)
    expect(r.dir).toBe(ACCOUNT_MAP.workDir)
    expect(r.matched).toBe(true)
  })

  it('los repos personales conocidos siguen yendo a la cuenta personal', () => {
    for (const slug of ['menoplus-app/menoplus', 'josemerca/control-tower', 'josemerca/control-tower-plugin']) {
      expect(resolveAccount(slug, ACCOUNT_MAP).dir).toBe(ACCOUNT_MAP.personalDir)
    }
  })

  // La `legacy` existe solo para poder ANUNCIAR una reclasificación; si
  // alguien la borra sin borrar también el aviso de ct-next.mjs, ese aviso
  // deja de existir en silencio.
  it('conserva las listas legacy para poder detectar reclasificaciones de cuenta', () => {
    expect(ACCOUNT_MAP.legacy.work).toContain('mercadona')
    expect(resolveAccountLegacy('mercadona/algun-tool-interno', ACCOUNT_MAP).dir).toBe(ACCOUNT_MAP.personalDir)
  })
})

// D4, defecto 4: el número de ISSUE y el número de ORDEN §9 son dos espacios
// de identificadores distintos. El STATE.md sembrado llamaba "slice #N" al
// número de issue — y el agente que lo lee se lo cree.
describe('buildStateSeed / renderKickoff — issue vs. orden §9 (D4, defecto 4)', () => {
  const S = { n: 47, order: 3, name: 'refresh token', type: 'backend', ac: ['AC-1'], issue: '#47' }

  it('you_are_here nombra el ISSUE como issue, y el orden §9 como orden §9', () => {
    const { meta } = parseState(buildStateSeed(S, { branch: 'feat/47', base: 'main' }))
    expect(meta.you_are_here).toMatch(/issue #47/)
    expect(meta.you_are_here).toMatch(/#3/)
    // Lo que NO puede volver a decir: "slice #47" (el número de issue
    // presentado como número de slice).
    expect(meta.you_are_here).not.toMatch(/slice #47/)
  })

  // gh-issue-map.js#mapGhIssue rellena `order: order ?? i.number` — un issue
  // SIN marcador <!-- ct-order:N --> (creado a mano, o anterior a /ct-groom)
  // acaba con un "orden" que es una copia sintética de su número de issue.
  // Anunciar eso como "slice #47 de la tabla §9" sería inventarse justo el
  // dato que este arreglo existe para no confundir.
  it('order === n (relleno sintético de mapGhIssue) → NO se anuncia ningún orden §9', () => {
    const { meta } = parseState(buildStateSeed({ ...S, order: 47 }, { branch: 'feat/47', base: 'main' }))
    expect(meta.you_are_here).toMatch(/issue #47/)
    expect(meta.you_are_here).not.toMatch(/§9/)
    const k = renderKickoff({ ...S, order: 47 }, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' })
    expect(k.split('\n')[0]).not.toMatch(/§9/)
  })

  it('sin orden §9 conocido, no se inventa ninguno', () => {
    const { meta } = parseState(buildStateSeed({ ...S, order: undefined }, { branch: 'feat/47', base: 'main' }))
    expect(meta.you_are_here).toMatch(/issue #47/)
    expect(meta.you_are_here).not.toMatch(/§9/)
  })

  it('el kickoff distingue los dos números en la primera línea', () => {
    const k = renderKickoff(S, { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs' })
    expect(k.split('\n')[0]).toMatch(/issue #47/)
    expect(k.split('\n')[0]).toMatch(/#3 de la tabla §9/)
  })

  it('sin `issue` pero con `n`, el kickoff NO llama "orden" al número de issue (era el bug simétrico)', () => {
    const k = renderKickoff({ ...S, issue: null }, { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs' })
    expect(k.split('\n')[0]).toMatch(/issue #47/)
    expect(k.split('\n')[0]).not.toMatch(/orden #47/)
  })
})
