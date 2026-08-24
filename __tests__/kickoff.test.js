import { describe, it, expect } from 'vitest'
import {renderKickoff, buildStateSeed, ADDENDA} from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'

const SLICE = { n: 7, name: 'refresh token', type: 'backend', ac: ['AC-7.1'], deps: [1], issue: '#7' }

// F-jjponz-4 — estos cuatro tests buscaban los marcadores de cada addendum
// (`contrato`, `screenshot`, `dry-run`…) sobre el kickoff ENTERO, usándolo como
// proxy del addendum. Es el falso positivo cruzado que `gates.js` avisa: en
// cuanto el texto común del kickoff usa una de esas palabras —esta ronda añadió
// "contratos" al Primer acto— los tests de ui/infra/bugfix fallan sin que nada
// esté roto. La ausencia se comprueba ahora contra el addendum REAL (ADDENDA ya
// se exporta), que es lo que de verdad quieren decir: "el kickoff de este Tipo
// no lleva el addendum de otro".
const otrosAddenda = (tipo) =>
  Object.entries(ADDENDA).filter(([t]) => t !== tipo).map(([, texto]) => texto)

describe('renderKickoff', () => {
  it('backend: lleva su addendum y ninguno de los otros', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r' })
    expect(k).toContain('subagent-driven-development')
    // F22: el fichero de estado de un agente de slice es `.agent/SLICE.md`.
    // El kickoff SOLO lo recibe un agente de slice, así que nombrar aquí el
    // `.agent/STATE.md` de la coordinadora era mandarlo al fichero trackeado
    // cuya contaminación motivó toda esta ronda.
    expect(k).toContain('.agent/SLICE.md')
    expect(k).toContain(ADDENDA.backend)
    for (const otro of otrosAddenda('backend')) expect(k).not.toContain(otro)
  })
  it('ui: lleva su addendum y ninguno de los otros', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui' }, { repo: 'o/r' })
    expect(k).toContain(ADDENDA.ui)
    expect(k.toLowerCase()).toMatch(/screenshot|design system/)
    for (const otro of otrosAddenda('ui')) expect(k).not.toContain(otro)
  })
  it('infra: lleva su addendum y ninguno de los otros', () => {
    const k = renderKickoff({ ...SLICE, type: 'infra' }, { repo: 'o/r' })
    expect(k).toContain(ADDENDA.infra)
    expect(k.toLowerCase()).toMatch(/dry-run.*plan primero/)
    for (const otro of otrosAddenda('infra')) expect(k).not.toContain(otro)
  })
  it('bugfix: lleva su addendum y ninguno de los otros', () => {
    const k = renderKickoff({ ...SLICE, type: 'bugfix' }, { repo: 'o/r' })
    expect(k).toContain(ADDENDA.bugfix)
    expect(k.toLowerCase()).toMatch(/reproduce-first.*test que falla/)
    for (const otro of otrosAddenda('bugfix')) expect(k).not.toContain(otro)
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
  // F7: el campo `blocked` tiene que EXISTIR en el fichero que el agente va a
  // editar. Un campo que solo está documentado en el plugin es un campo que
  // nadie escribe el día que hace falta — y ese día, la alternativa es prosa
  // dentro de `next_action`, que es justo el fallo.
  it('siembra `blocked: null` explícito (un slice recién despachado no está bloqueado, y el campo queda a la vista)', () => {
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' })
    expect(seed).toMatch(/^blocked:/m) // presente en el texto, no solo tras parsear
    const { meta } = parseState(seed)
    expect(Object.prototype.hasOwnProperty.call(meta, 'blocked')).toBe(true)
    expect(meta.blocked).toBe(null)
  })

  it('el kickoff le dice al agente cómo marcar un bloqueo, y que NO lo escriba en next_action', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' })
    expect(k).toMatch(/`blocked: \{reason:/)
    expect(k).toMatch(/NO en prosa dentro de next_action/)
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

// F32 — el modelo de dos niveles (handoff §4.3): nivel epic = CT, nivel slice =
// los skills FORKADOS dentro del plugin. El kickoff es el único texto que el
// agente despachado lee SEGURO, así que es aquí donde tiene que decir (a) qué
// skills seguir —los propios, no los de un plugin que la tarea 6 desinstala—,
// (b) cuál es el primer acto —el plan del slice, escrito contra el código real
// con el ISSUE como spec—, y (c) las dos prohibiciones que la costura 3 del
// fork ya impone pero que no pueden depender de que el agente llegue a leerla.
describe('renderKickoff — F32, modelo de dos niveles (skills propios, plan primero, prohibiciones)', () => {
  const OPTS = { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs' }

  it('cita los skills PROPIOS (control-tower-loop:*) y ninguna referencia al namespace superpowers:', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toContain('control-tower-loop:subagent-driven-development')
    expect(k).toContain('control-tower-loop:writing-plans-prescriptive')
    expect(k).toContain('--check-plan')
    // Con dos puntos a propósito: `docs/superpowers/plans/` (la ruta-convención
    // de los planes) sí puede y debe aparecer; el namespace del plugin viejo, no.
    expect(k).not.toMatch(/superpowers:/)
  })

  it('el primer acto es el plan del slice: writing-plans con el ISSUE como spec, guardado en docs/superpowers/plans/ y commiteado en el PR', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/plan del slice/i)
    expect(k).toMatch(/issue como spec/i)
    expect(k).toContain('docs/superpowers/plans/')
    // El orden en el texto ES el orden de ejecución: el plan (writing-plans)
    // tiene que aparecer ANTES de seguir con subagent-driven-development —
    // SDD arranca en su rombo "Have implementation plan?" y la respuesta
    // tiene que ser sí.
    expect(k.indexOf('control-tower-loop:writing-plans-prescriptive'))
      .toBeLessThan(k.indexOf('control-tower-loop:subagent-driven-development'))
  })

  // F-jjponz-4 — el kickoff avisa del recorte antes de que el agente escriba
  // 1.271 líneas de código en el plan y se coma un rechazo del validador.
  it('el primer acto dice que los bloques son SOLO los esenciales, y que los cuerpos los escribe el implementador', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/bloques esenciales/i)
    expect(k).toMatch(/cuerpos/i)
  })

  it('prohibiciones explícitas: NO mergear (el merge es humano) y NO crear worktrees nuevos', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/NO mergees/)
    expect(k).toMatch(/NO crees worktrees/)
    // La razón de la prohibición del worktree viaja con ella: ya está en uno.
    expect(k).toMatch(/ya estás en/i)
  })
})
