import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderKickoff, buildStateSeed, ADDENDA, SENAL_AUSENTE } from '../scripts/kickoff.js'
import { BaselineOutcome, BaselineResult } from '../scripts/baseline.js'
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
    const k = renderKickoff(SLICE, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain('ct-step')
    // F22: el fichero de estado de un agente de slice es `.agent/SLICE.md`.
    // El kickoff SOLO lo recibe un agente de slice, así que nombrar aquí el
    // `.agent/STATE.md` de la coordinadora era mandarlo al fichero trackeado
    // cuya contaminación motivó toda esta ronda.
    expect(k).toContain('.agent/SLICE.md')
    expect(k).toContain(ADDENDA.backend)
    for (const otro of otrosAddenda('backend')) expect(k).not.toContain(otro)
  })
  it('ui: lleva su addendum y ninguno de los otros', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui' }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain(ADDENDA.ui)
    expect(k.toLowerCase()).toMatch(/screenshot|design system/)
    for (const otro of otrosAddenda('ui')) expect(k).not.toContain(otro)
  })
  it('infra: lleva su addendum y ninguno de los otros', () => {
    const k = renderKickoff({ ...SLICE, type: 'infra' }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain(ADDENDA.infra)
    expect(k.toLowerCase()).toMatch(/dry-run.*plan primero/)
    for (const otro of otrosAddenda('infra')) expect(k).not.toContain(otro)
  })
  it('bugfix: lleva su addendum y ninguno de los otros', () => {
    const k = renderKickoff({ ...SLICE, type: 'bugfix' }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
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
    const k = renderKickoff({ ...SLICE, n: 42 }, { repo: 'o/r', dispatchCheckPath: FAKE_DISPATCH_CHECK_PATH , conventionsDir: '/plugin/conventions' })
    expect(k).toContain(`node ${FAKE_DISPATCH_CHECK_PATH} 42 --repo o/r --release`)
  })

  it('NUNCA emite el token ${CLAUDE_PLUGIN_ROOT} sin expandir — no es una env var real del shell de la sesión del agente', () => {
    const k = renderKickoff({ ...SLICE, n: 7 }, { repo: 'menoplus-app/menoplus', dispatchCheckPath: FAKE_DISPATCH_CHECK_PATH , conventionsDir: '/plugin/conventions' })
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
  // D-4 — el epic viaja sembrado en el estado del slice, no preguntado a gh en
  // cada run: lo lee la telemetría de ct-run, que agrega por epic.
  it('siembra el epic que trae el slice', () => {
    const { meta } = parseState(buildStateSeed({ ...SLICE, epic: '12' }, { branch: 'feat/7', base: 'main' }))
    expect(meta.epic).toBe('12')
  })

  it('un slice sin milestone DECLARA la ausencia, no la deja vacía', () => {
    // Misma regla que impidió que ct-next asumiera `main` en silencio cuando no
    // conocía la base: un hueco en una métrica se lee como un cero, y un cero
    // es una afirmación.
    for (const sinEpic of [{ ...SLICE }, { ...SLICE, epic: null }, { ...SLICE, epic: '' }]) {
      const { meta } = parseState(buildStateSeed(sinEpic, { branch: 'feat/7', base: 'main' }))
      expect(meta.epic).toBe('(sin milestone)')
    }
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
    const k = renderKickoff(SLICE, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' , conventionsDir: '/plugin/conventions' })
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

// Slice 1 (apuntes de Capde) — `base_sha`: el SHA del corte, en un campo que
// nadie sobreescribe. El sha ya llegaba a `buildStateSeed` (ct-next lo resuelve
// de `origin/<base>` antes de cortar el worktree) pero solo se volcaba en
// `last_commit`, que el agente pisa en su primer commit de trabajo: el único
// rastro del corte desaparecía del fichero, y el diff de release acabó midiendo
// contra la copia LOCAL de la rama base (corrida del slice 10, main 7 commits
// por detrás).
describe('buildStateSeed — base_sha, el sha del corte que nadie sobreescribe (slice 1)', () => {
  const CORTE = 'c3af34c0dead0000beef0000cafe0000feed1234'

  it('la semilla lleva base_sha: = SHA de origin/<base> en el corte', () => {
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main', baseSha: CORTE })
    // En el TEXTO y en su propia línea, no solo tras parsear: su consumidor
    // (dispatch-check, slice 2) lo leerá con un regex sobre el fichero.
    expect(seed).toMatch(new RegExp(`^base_sha: ${CORTE}$`, 'm'))
    expect(parseState(seed).meta.base_sha).toBe(CORTE)
  })

  it('sin SHA resoluble, el campo no aparece', () => {
    // Las dos formas en que ct-next entrega "no lo pude resolver": el
    // argumento ausente (default de la firma) y la cadena vacía explícita
    // (`resolvedBaseSha` tras el catch de ct-next.mjs:1679).
    for (const opts of [{ branch: 'feat/7', base: 'main' }, { branch: 'feat/7', base: 'main', baseSha: '' }]) {
      const seed = buildStateSeed(SLICE, opts)
      expect(seed).not.toMatch(/^base_sha:/m) // nunca `base_sha: ""`
      expect(Object.prototype.hasOwnProperty.call(parseState(seed).meta, 'base_sha')).toBe(false)
    }
  })

  it('`last_commit` no cambia: mismo sha cuando hay, y `""` cuando no — la asimetría es deliberada', () => {
    expect(parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'main', baseSha: CORTE })).meta.last_commit).toBe(CORTE)
    expect(parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' })).meta.last_commit).toBe('')
  })

  it('`base:` sigue siendo el nombre de la rama, nunca el sha: de ahí sale el `--base` de `gh pr create`', () => {
    const { meta } = parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'develop', baseSha: CORTE }))
    expect(meta.base).toBe('develop')
    expect(meta.base).not.toBe(meta.base_sha)
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
    const k = renderKickoff({ ...S, order: 47 }, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' , conventionsDir: '/plugin/conventions' })
    expect(k.split('\n')[0]).not.toMatch(/§9/)
  })

  it('sin orden §9 conocido, no se inventa ninguno', () => {
    const { meta } = parseState(buildStateSeed({ ...S, order: undefined }, { branch: 'feat/47', base: 'main' }))
    expect(meta.you_are_here).toMatch(/issue #47/)
    expect(meta.you_are_here).not.toMatch(/§9/)
  })

  it('el kickoff distingue los dos números en la primera línea', () => {
    const k = renderKickoff(S, { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs' , conventionsDir: '/plugin/conventions' })
    expect(k.split('\n')[0]).toMatch(/issue #47/)
    expect(k.split('\n')[0]).toMatch(/#3 de la tabla §9/)
  })

  it('sin `issue` pero con `n`, el kickoff NO llama "orden" al número de issue (era el bug simétrico)', () => {
    const k = renderKickoff({ ...S, issue: null }, { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs' , conventionsDir: '/plugin/conventions' })
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
  const OPTS = { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs', ctStepPath: '/x/ct-step.mjs' , conventionsDir: '/plugin/conventions' }

  it('cita los skills PROPIOS (control-tower-loop:*) y ninguna referencia al namespace superpowers:', () => {
    const k = renderKickoff(SLICE, OPTS)
    // D-4 tomada en este fork: la conducción es de ct-step, y el kickoff ya
    // no manda a subagent-driven-development — lo prohíbe explícitamente.
    expect(k).toContain('/x/ct-step.mjs')
    expect(k).not.toMatch(/sigue control-tower-loop:subagent-driven-development/)
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
    // tiene que aparecer ANTES de la conducción por ct-step — la máquina
    // arranca sobre un plan commiteado (`--plan` es su primer argumento) y
    // sin plan no hay run.
    expect(k.indexOf('control-tower-loop:writing-plans-prescriptive'))
      .toBeLessThan(k.indexOf('/x/ct-step.mjs'))
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

  // Tarea 10 — sin esto el paso `reconcile` existe en la máquina y nadie del
  // lado del agente sabe invocarlo ni sabe qué hacer con un conflicto.
  it('nombra el paso `ct-step reconcile` y que ante un conflicto despacha ct-reconciler sin Bash y sin Write', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toContain('ct-step reconcile')
    expect(k).toMatch(/despacha ct-reconciler como subagente, declarado sin Bash y sin Write/)
  })

  // La cuenta tiene que llevar el paso nuevo: antes de esta tarea eran dos
  // (global, slice-verdict); con `reconcile` delante, son tres.
  it('cuenta tres pasos tras el commit de la última tarea, no dos', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/quedan tres pasos más/)
    expect(k).not.toMatch(/quedan dos pasos más/)
  })
})

// Slice 10 — la señal en el despacho. El campo `senal:` se siembra SIEMPRE
// (con el texto verbatim del issue, o con SENAL_AUSENTE — la ausencia se
// declara, no se omite, mismo criterio que gates:/blocked:), porque su lector
// es ct-step, que lo pega como primera sección del paquete del juez de slice
// sin ningún agente en medio. La línea del kickoff, en cambio, es
// CONDICIONAL: solo sale con señal declarada — "ninguna exigencia que el spec
// le haga al agente puede depender de que el agente lea el spec", y con
// exención o sin declaración no hay nada que exigir (el silencio cuando no
// hay nada que decir es lo que mantiene útiles a las líneas que sí salen).
describe('la señal en el despacho (Slice 10)', () => {
  const OPTS = { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs', ctStepPath: '/x/ct-step.mjs' , conventionsDir: '/plugin/conventions' }

  it('buildStateSeed siembra senal: con el texto del issue, verbatim', () => {
    const seed = buildStateSeed({ ...SLICE, senal: 'métrica `backfill_progress` con label `estado`' }, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.senal).toBe('métrica `backfill_progress` con label `estado`')
  })

  it('buildStateSeed declara la ausencia con SENAL_AUSENTE cuando el issue no trae sección', () => {
    for (const sinSenal of [{ ...SLICE }, { ...SLICE, senal: null }, { ...SLICE, senal: '' }, { ...SLICE, senal: '  ' }]) {
      const { meta } = parseState(buildStateSeed(sinSenal, { branch: 'feat/7', base: 'main' }))
      expect(meta.senal).toBe(SENAL_AUSENTE)
    }
    // La constante abre con "(sin señal declarada" — es el prefijo con el que
    // la rúbrica del juez de slice reconoce el estado sin-vara.
    expect(SENAL_AUSENTE.startsWith('(sin señal declarada')).toBe(true)
  })

  it('la apertura que la rúbrica del juez de slice cita es un prefijo real de SENAL_AUSENTE', () => {
    // Hallazgo low del juez del Slice 10: el cruce era unidireccional — el
    // test de arriba vigila la constante, pero la CITA del agente («it opens
    // with `(sin señal declarada`») no estaba atada a ella, así que editar esa
    // frase en agents/ct-slice-judge.md rompería el reconocimiento de sin-vara
    // sin que ningún test lo notara. Se lee del fichero real, como todas las
    // ataduras agente↔constante de step-contracts.test.js.
    const agente = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-slice-judge.md'), 'utf8')
    const cita = /opens with\s+`([^`]+)`/.exec(agente)
    expect(cita).not.toBeNull()
    expect(SENAL_AUSENTE.startsWith(cita[1])).toBe(true)
  })

  it('la exención razonada viaja al SLICE.md tal cual (N/A — razón)', () => {
    const { meta } = parseState(buildStateSeed({ ...SLICE, senal: 'N/A — pantalla sin telemetría nueva que prometer' }, { branch: 'feat/7', base: 'main' }))
    expect(meta.senal).toBe('N/A — pantalla sin telemetría nueva que prometer')
  })

  it('renderKickoff nombra la señal cuando el issue la declara', () => {
    const k = renderKickoff({ ...SLICE, senal: 'métrica x' }, OPTS)
    expect(k).toContain('Este slice declara una SEÑAL DE OBSERVABILIDAD (sección "## Señal de observabilidad" del issue): lo que esa señal promete tiene que emitirlo el código de PRODUCCIÓN de este slice, instrumentado como ya instrumenta este repo y sin labels de cardinalidad ilimitada — el juez del slice entero lo comprueba contra el diff acumulado antes del PR.')
    // Tras la línea de "Lee también las secciones…" — la zona de "qué leer
    // del issue", antes del primer acto.
    expect(k.indexOf('Lee también las secciones')).toBeLessThan(k.indexOf('SEÑAL DE OBSERVABILIDAD'))
  })

  it('renderKickoff calla con exención y calla sin declaración', () => {
    expect(renderKickoff({ ...SLICE, senal: 'N/A — sin telemetría nueva' }, OPTS)).not.toContain('SEÑAL DE OBSERVABILIDAD')
    expect(renderKickoff(SLICE, OPTS)).not.toContain('SEÑAL DE OBSERVABILIDAD')
    expect(renderKickoff({ ...SLICE, senal: '–' }, OPTS)).not.toContain('SEÑAL DE OBSERVABILIDAD')
  })
})

// La vara la dicta ct (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md, §7):
// el brief se construye DESPUÉS del plan, así que pegar la vara de ct sólo ahí
// deja al implementador entre dos vetos — obedecer `**Files:**` y que el juez le
// bloquee la forma, o construir la forma y que el control de alcance le vete por
// tocar rutas que el plan no declaró. Son tres consumidores, no dos. (La del
// REPO ya llegaba: la skill manda arrancar de `.agent/conventions.md`.)
describe('el primer acto nombra la vara de ct', () => {
  const OPTS_CON_VARA = {
    repo: 'o/r',
    dispatchCheckPath: '/x/dispatch-check.mjs',
    ctStepPath: '/x/ct-step.mjs',
    conventionsDir: '/plugin/conventions',
  }

  it('manda leerla, y la nombra por su ruta absoluta', () => {
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k).toMatch(/LEE la vara de ct/)
    expect(k).toContain('/plugin/conventions')
  })

  it('la orden cae ANTES de la entrada que manda escribir el plan', () => {
    // El ancla es esa entrada y no la siguiente: leer la vara después de haber
    // escrito el plan no sirve de nada, así que un ancla más laxa dejaría pasar
    // justo la regresión que este test existe para cazar.
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k.indexOf('/plugin/conventions')).toBeGreaterThan(-1)
    expect(k.indexOf('/plugin/conventions')).toBeLessThan(k.indexOf('Primer acto'))
  })

  it('enuncia la precedencia con SUS DOS LADOS: es el único sitio donde la lee quien planifica', () => {
    // `SKILL.md` ya no la enuncia (el presupuesto de la skill obligó a recortar
    // la tercera copia), así que este texto es el único que llega a quien escribe
    // el plan. Un enunciado que sólo dijera "gana ct" le haría anular las
    // convenciones del repo que ct no toca, que es el fallo contrario.
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k).toMatch(/preferencia/i)
    expect(k).toMatch(/regla a regla/i)
    expect(k).toMatch(/no por tema/i)
    expect(k).toMatch(/prohíbe lo que uno de esos documentos manda/i)
    expect(k).toMatch(/obliga entera/i)
  })
})

// #96 — el baseline lo mide el programa (scripts/baseline.js) al preparar el
// worktree, y viaja en la semilla como DATO: el agente lo lee, no lo ejecuta
// para afirmarlo. El kickoff deja de ordenarlo y pasa a señalar dónde está.
describe('buildStateSeed — baseline medido por el dispatcher, no afirmado por el agente (#96)', () => {
  it('siembra `baseline:` con el resultado, el comando y el resumen que le pasan', () => {
    const baseline = new BaselineResult({ outcome: BaselineOutcome.RED, command: 'npm test', summary: 'exit 1 · 2 failed' })
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main', baseSha: 'abc', baseline })
    expect(seed).toMatch(/^baseline:$/m)
    expect(parseState(seed).meta.baseline).toEqual({ outcome: 'rojo', command: 'npm test', summary: 'exit 1 · 2 failed' })
  })

  it('sin baseline medido, el campo declara la ausencia como no-verificado en vez de omitirse', () => {
    const { meta } = parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' }))
    expect(meta.baseline.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(meta.baseline.command).toBe(null)
    expect(meta.baseline.summary).toMatch(/nadie/)
  })
})

describe('renderKickoff — el baseline está en la semilla, no en una orden al agente (#96)', () => {
  const kickoff = () => renderKickoff(SLICE, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs', conventionsDir: '/plugin/conventions' })

  it('ya no manda confirmar pwd/rama ni dejar el baseline en verde antes de tocar nada', () => {
    expect(kickoff()).not.toMatch(/baseline verde ANTES/)
    expect(kickoff()).not.toMatch(/confirma pwd\/rama/)
  })

  it('señala el campo `baseline:` de .agent/SLICE.md como el sitio donde ya está medido', () => {
    expect(kickoff()).toMatch(/`baseline:`.*\.agent\/SLICE\.md/)
  })
})
