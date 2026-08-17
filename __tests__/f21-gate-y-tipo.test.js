// ============================================================================
// F21 — EL GATE HUMANO Y EL TIPO TÉCNICO ERAN LA MISMA COLUMNA.
//
// Hallazgo, salido de despachar un slice real: el único gate humano que
// existía en todo el plugin vivía DENTRO de la cadena de texto del addendum de
// `ui` (kickoff.js#ADDENDA). No había ningún otro mecanismo — ni en slices.js,
// ni en groom.js, ni en el cuerpo del issue, ni en las labels. Es decir: la
// columna `Tipo` de la tabla §9 decidía DOS cosas a la vez, qué recordatorio
// técnico recibe el agente y si hay gate humano, y esos dos ejes no siempre
// coinciden. El caso real: un slice `Tipo: backend` (una migración con
// backfill) que el spec del epic marcaba explícitamente como necesitado de
// gate visual porque "la barra es lo más visible de todo el spec". Recibió el
// addendum de backend y NINGÚN gate, y nada lo señaló.
//
// La capa de ironía que hay que entender antes de leer estos tests: el spec
// del epic decía "el gate visual no depende de esto: vive en §10 y en la REGLA
// #-2, que son más fuertes que un addendum". Eso es cierto para un HUMANO que
// lee el spec. El agente despachado NO lee el spec: recibe el kickoff y el
// cuerpo del issue, y en ninguno de los dos aparece esa sección. Una garantía
// que vive solo en un documento que el destinatario nunca abre no es una
// garantía — y esa es la propiedad de fondo que esta ronda persigue:
//
//   NINGUNA EXIGENCIA QUE EL SPEC LE HAGA AL AGENTE PUEDE DEPENDER DE QUE EL
//   AGENTE LEA EL SPEC.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { renderKickoff, buildStateSeed, ADDENDA } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'
import { analyzeSlicesTable } from '../scripts/slices.js'
import { buildLabels, buildIssueBody, groomPlan } from '../scripts/groom.js'
import { mapGhIssue } from '../scripts/gh-issue-map.js'
import { GATES, TYPE_GATES, resolveGates, gatesForType, gatesFromLabels, GATE_LABEL_NONE } from '../scripts/gates.js'

const here = dirname(fileURLToPath(import.meta.url))
const groomScript = join(here, '..', 'scripts', 'ct-groom.mjs')
const initScript = join(here, '..', 'scripts', 'ct-init.sh')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']
const fakeGhDir = join(here, 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

const SLICE = { n: 7, name: 'barra de progreso', type: 'backend', ac: ['AC-7.1'], deps: [], issue: '#7' }

// specWith: la tabla §9 de diez columnas (nueve de siempre + `Gate`), con las
// filas que se le pasen. Se escribe entera aquí y no con un helper del
// producto a propósito: un test que compone la tabla con el mismo código que
// la parsea no comprueba nada.
function specWith(rows) {
  return [
    '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
    '',
    '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function dryRun(specText, extraArgs = []) {
  const dir = makeSpecDir('f21-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specText)
  const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run', ...extraArgs], {
    encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv(),
  })
  rmSync(dir, { recursive: true, force: true })
  return res
}

// ============================================================================
// 1. El vocabulario de gates: cerrado, y derivado de lo que YA existía.
// ============================================================================
describe('F21 — vocabulario de gates', () => {
  it('los gates que existen salen de los addenda que ya los imponían, más el añadido deliberado de F-jjponz-1', () => {
    // `ui` imponía "gate de screenshot obligatorio"; `infra`, "apply solo tras
    // review". Son las dos ÚNICAS frases de ADDENDA que exigían un acto
    // humano; el resto son recordatorios técnicos. `plan` (F-jjponz-1) es el
    // primer gate AÑADIDO por la vía que la doctrina de gates.js reserva para
    // eso: acto deliberado, con su texto de kickoff y de issue (ver
    // gate-plan.test.js). Ningún Tipo lo implica.
    expect(Object.keys(GATES).sort()).toEqual(['apply', 'plan', 'visual'])
    expect(TYPE_GATES.ui).toEqual(['visual'])
    expect(TYPE_GATES.infra).toEqual(['apply'])
    // F-jjponz-2: `plan` está implicado en TODO slice (gatesForType lo añade
    // siempre); la renuncia por fila es `!plan`. Los Tipos sin gate técnico
    // llevan exactamente ese defecto y nada más.
    expect(gatesForType('backend')).toEqual(['plan'])
    expect(gatesForType('')).toEqual(['plan'])
    expect(gatesForType(undefined)).toEqual(['plan'])
  })

  it('los addenda dejan de llevar gate dentro: quedan recordatorios TÉCNICOS y nada más', () => {
    // Es la mitad "separar los dos ejes" del arreglo. Si la frase del gate se
    // quedara además dentro del addendum, un slice `ui` que RENUNCIA al gate
    // seguiría recibiéndola — el addendum contradiría al gate resuelto.
    for (const [type, text] of Object.entries(ADDENDA)) {
      expect(text.toLowerCase(), type).not.toMatch(/screenshot|\bgate\b|tras review/)
    }
    // Control: los addenda siguen existiendo y siguen siendo técnicos.
    expect(ADDENDA.ui.toLowerCase()).toMatch(/design system/)
    expect(ADDENDA.infra.toLowerCase()).toMatch(/dry-run/)
  })
})

// ============================================================================
// 2. resolveGates: los dos ejes, por fin separados.
// ============================================================================
describe('F21 — resolveGates(tipo, celda Gate)', () => {
  it('sin celda: los gates salen del Tipo más el defecto universal `plan` (F-jjponz-2)', () => {
    expect(resolveGates('ui', '').gates).toEqual(['visual', 'plan'])
    expect(resolveGates('ui', undefined).gates).toEqual(['visual', 'plan'])
    expect(resolveGates('infra', '').gates).toEqual(['apply', 'plan'])
    expect(resolveGates('backend', '').gates).toEqual(['plan'])
  })

  it('un marcador de "sin valor" en Gate significa "no he declarado nada", NO "renuncio a todo"', () => {
    // El mismo criterio de vacío que Dep/Acepta/Protegido/Área/Toca. Un autor
    // que rellena la columna con "–" porque el resto de la fila lo lleva no
    // está renunciando al gate de su Tipo — leerlo así sería quitar un gate
    // en silencio, justo lo contrario de lo que esta ronda pide.
    for (const marker of ['-', '–', '—', '―', '−', '--']) {
      expect(resolveGates('ui', marker).gates, marker).toEqual(['visual', 'plan'])
      expect(resolveGates('ui', marker).waived, marker).toEqual([])
    }
  })

  it('el caso que motiva la ronda: un gate que el Tipo NO implica se declara, y queda marcado como tal', () => {
    const r = resolveGates('backend', 'visual')
    expect(r.gates).toEqual(['visual', 'plan'])
    expect(r.added).toEqual(['visual']) // lo que hay que decir en voz alta
    expect(r.implied).toEqual(['plan'])
  })

  it('renunciar a un gate implicado por el Tipo es explícito (`!visual`) y queda registrado', () => {
    const r = resolveGates('ui', '!visual')
    expect(r.gates).toEqual(['plan'])
    expect(r.waived).toEqual(['visual'])
  })

  it('renunciar a un gate que el Tipo no implica no hace nada, y eso se reporta (no se calla)', () => {
    const r = resolveGates('backend', '!visual')
    expect(r.gates).toEqual(['plan'])
    expect(r.inertWaivers).toEqual(['visual'])
  })

  it('declarar un gate que el Tipo ya implica es redundante, no un error, y se reporta', () => {
    const r = resolveGates('ui', 'visual')
    expect(r.gates).toEqual(['visual', 'plan'])
    expect(r.redundant).toEqual(['visual'])
    expect(r.added).toEqual([])
  })

  it('pedir y renunciar al mismo gate en la misma celda es una contradicción, no un ganador silencioso', () => {
    const r = resolveGates('ui', 'visual, !visual')
    expect(r.contradictions).toEqual(['visual'])
  })

  it('un token que no está en el vocabulario NO produce gate y se reporta (nunca se inventa un gate que nadie sabe comprobar)', () => {
    const r = resolveGates('backend', 'seguridad')
    expect(r.gates).toEqual(['plan'])
    expect(r.unknown).toEqual(['seguridad'])
    expect(resolveGates('ui', '!seguridad').unknown).toEqual(['seguridad'])
  })

  it('"none" no es un token válido: renunciar es por gate, con nombre, nunca en bloque', () => {
    expect(resolveGates('ui', 'none').unknown).toEqual(['none'])
    expect(resolveGates('ui', 'none').gates).toEqual(['visual', 'plan']) // el gate del Tipo sigue en pie
  })

  it('tolera mayúsculas y marcado inline, igual que el resto de columnas de la tabla §9', () => {
    expect(resolveGates('backend', '`Visual`').gates).toEqual(['visual', 'plan'])
    expect(resolveGates('ui', '**!visual**').gates).toEqual(['plan'])
    expect(resolveGates('ui', '! visual').gates).toEqual(['plan'])
  })

  it('el orden de los gates resueltos es determinista, venga como venga la celda', () => {
    expect(resolveGates('backend', 'apply, visual').gates).toEqual(resolveGates('backend', 'visual, apply').gates)
  })

  // ==========================================================================
  // Casos que no venían en el encargo, salidos de sondear el parser.
  // ==========================================================================
  it('tolera el prefijo de label completo ("gate:visual"), que es lo que el autor ve en la UI de GitHub', () => {
    // Mismo error, y mismo remedio, que slices.js#stripColumnPrefix para
    // "area:x" dentro de la columna Área. Sin esto, escribir lo que se ve en
    // GitHub caía en el abort de "gate desconocido".
    expect(resolveGates('backend', 'gate:visual').gates).toEqual(['visual', 'plan'])
    expect(resolveGates('ui', '!gate:visual').gates).toEqual(['plan'])
  })

  it('un "!" sin ningún gate detrás se reporta, no se descarta en silencio', () => {
    // La celda NO estaba vacía: su autor cree haber declarado algo. Es la
    // versión más pequeña del fallo que toda esta ronda persigue.
    expect(resolveGates('ui', '!').unknown).toEqual(['!'])
  })

  it('un token con espacios ("visual visual", sin coma) no cuela como gate', () => {
    expect(resolveGates('backend', 'visual visual').gates).toEqual(['plan'])
    expect(resolveGates('backend', 'visual visual').unknown).toEqual(['visual visual'])
  })

  it('declarar el mismo gate dos veces no lo duplica en la salida', () => {
    expect(resolveGates('backend', 'visual, visual').gates).toEqual(['visual', 'plan'])
    expect(resolveGates('backend', 'visual, visual').added).toEqual(['visual'])
  })

  it('un Tipo que no matchea exactamente (mayúsculas, errata) NO implica ningún gate técnico — el aviso de /ct-groom es quien lo dice', () => {
    // Se documenta como comportamiento, no se "arregla" haciéndolo
    // case-insensitive: ADDENDA compara igual de exacto, y dos criterios
    // distintos para la misma columna serían peores que uno estricto con voz.
    // El defecto universal `plan` (F-jjponz-2) no depende del Tipo, así que
    // sobrevive incluso a una errata.
    expect(gatesForType('UI')).toEqual(['plan'])
    expect(gatesForType('iu')).toEqual(['plan'])
  })
})

// ============================================================================
// 3. La columna `Gate` de la tabla §9.
// ============================================================================
describe('F21 — columna Gate en la tabla §9', () => {
  it('se parsea como celda cruda del slice, y el reporte dice que la columna existe', () => {
    const report = analyzeSlicesTable(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | visual |']))
    expect(report.slices[0].gate).toBe('visual')
    expect(report.gateColumnPresent).toBe(true)
  })

  it('una tabla SIN columna Gate (todas las que existen hoy) sigue funcionando y NO genera un aviso de columna ausente', () => {
    // Cada columna opcional ausente imprime hoy un aviso con su consecuencia.
    // La consecuencia de que falte `Gate` es… ninguna: los gates se derivan
    // del Tipo exactamente como antes. Un aviso que sale siempre y no describe
    // ninguna degradación es ruido que entrena a ignorar los demás.
    const md = [
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', '',
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |',
      '|---|---|---|---|---|---|---|---|---|',
      '| 1 | pantalla | ui | alta | – | AC-1.1 | – | med | app |', '',
    ].join('\n')
    const report = analyzeSlicesTable(md)
    expect(report.gateColumnPresent).toBe(false)
    expect(report.missingOptionalColumns).not.toContain('Gate')
    expect(report.slices[0].gate).toBe('')
  })
})

// ============================================================================
// 4. El gate viaja al ISSUE: labels (máquina) y cuerpo (humano).
// ============================================================================
describe('F21 — el gate llega a GitHub, no solo al kickoff', () => {
  const uiSlice = { n: 1, name: 'pantalla', type: 'ui', gate: '', ac: [], deps: [], area: [], touches: [] }
  const backendConGate = { ...uiSlice, type: 'backend', gate: 'visual' }
  const backendPelado = { ...uiSlice, type: 'backend', gate: '' }

  it('un slice con gate lleva su label gate:<token>, en posición determinista', () => {
    const labels = buildLabels(uiSlice)
    expect(labels).toContain('gate:visual')
    expect(labels.indexOf('gate:visual')).toBeLessThan(labels.indexOf('status:backlog'))
    expect(buildLabels(backendConGate)).toContain('gate:visual')
  })

  it('un slice sin gates técnicos lleva el defecto `gate:plan`; `gate:none` queda para la renuncia total', () => {
    // Sin la label `gate:none`, "el issue no tiene ninguna label gate:"
    // significaría a la vez "este slice no tiene gates" y "este issue es
    // anterior a los gates" (ver el bloque de redespacho, más abajo). Con el
    // defecto universal de F-jjponz-2, la única forma de quedarse sin gates
    // es renunciar explícitamente a todos — `!plan` en un Tipo sin gate
    // técnico.
    expect(buildLabels(backendPelado)).toContain('gate:plan')
    expect(buildLabels(backendPelado)).not.toContain(GATE_LABEL_NONE)
    expect(buildLabels({ ...backendPelado, gate: '!plan' })).toContain(GATE_LABEL_NONE)
    expect(buildLabels(uiSlice)).not.toContain(GATE_LABEL_NONE)
  })

  it('el cuerpo del issue trae una sección de gates que un humano ve al abrir el PR', () => {
    const body = buildIssueBody(uiSlice, {})
    expect(body).toContain('## Gates')
    expect(body.toLowerCase()).toMatch(/screenshot|captura/)
    expect(body.toLowerCase()).toMatch(/human/) // quién lo cierra
  })

  it('la sección de gates existe SIEMPRE, también cuando no hay ninguno (ausencia declarada, no silencio)', () => {
    const body = buildIssueBody(backendPelado, {})
    expect(body).toContain('## Gates')
    expect(body.toLowerCase()).toMatch(/ninguno/)
  })

  it('una RENUNCIA queda escrita en el cuerpo del issue, con el Tipo que la implicaba', () => {
    const body = buildIssueBody({ ...uiSlice, gate: '!visual' }, {})
    expect(body.toLowerCase()).toMatch(/renuncia/)
    expect(body).toContain('visual')
    expect(body).toContain('`ui`')
  })

  it('groomPlan expone los gates resueltos como dato estructurado', () => {
    const plan = groomPlan([backendConGate], { milestone: 'Epic', specRef: {} })
    expect(plan.issues[0].gates).toEqual(['visual', 'plan'])
  })
})

// ============================================================================
// 5. El gate SOBREVIVE al redespacho: se lee de las labels del issue.
// ============================================================================
describe('F21 — gates leídos del issue (supervivencia al redespacho)', () => {
  it('mapGhIssue extrae los gates de las labels', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'type:backend' }, { name: 'gate:visual' }] })
    expect(i.gates).toEqual(['visual'])
    expect(i.gatesDeclared).toBe(true)
  })

  it('`gate:none` es una declaración de que no hay gates, no una ausencia de declaración', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'type:ui' }, { name: GATE_LABEL_NONE }] })
    expect(i.gates).toEqual([])
    expect(i.gatesDeclared).toBe(true)
  })

  it('un issue SIN ninguna label gate: (groomeado antes de esta ronda) no declara nada', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'type:ui' }] })
    expect(i.gatesDeclared).toBe(false)
  })

  it('una label `gate:` vacía o con solo espacios no cuenta como gate ni como declaración', () => {
    const i = mapGhIssue({ number: 4, title: '#1 x', body: '', labels: [{ name: 'gate:' }, { name: 'gate: ' }] })
    expect(i.gates).toEqual([])
    expect(i.gatesDeclared).toBe(false)
  })

  it('gatesFromLabels ignora tokens que no están en el vocabulario', () => {
    const r = gatesFromLabels(['gate:visual', 'gate:inventado'])
    expect(r.gates).toEqual(['visual'])
    expect(r.unknown).toEqual(['inventado'])
  })
})

// ============================================================================
// 6. El kickoff: el gate deja de depender del Tipo.
// ============================================================================
describe('F21 — renderKickoff', () => {
  it('un slice backend CON gate visual recibe el gate (era el caso real que no lo recibía)', () => {
    const k = renderKickoff({ ...SLICE, gates: ['visual'], gatesDeclared: true }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/screenshot|captura/)
    expect(k.toLowerCase()).toMatch(/human/) // que lo cierra un humano, no él
    expect(k.toLowerCase()).toMatch(/migraci|rollback/) // y conserva su addendum técnico de backend
  })

  it('un slice ui que RENUNCIÓ al gate no lo recibe', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui', gates: [], gatesDeclared: true }, { repo: 'o/r' })
    expect(k.toLowerCase()).not.toMatch(/screenshot|captura/)
    expect(k.toLowerCase()).toMatch(/design system/) // el addendum técnico de ui sigue
  })

  it('un issue anterior a los gates cae al Tipo: un `type:ui` sin labels gate: NO pierde su gate', () => {
    // Sin este fallback, el día que esto se despliega todos los issues `ui` ya
    // groomeados perderían su gate en silencio — exactamente la avería que
    // esta ronda existe para cerrar, en la otra dirección.
    const k = renderKickoff({ ...SLICE, type: 'ui', gatesDeclared: false }, { repo: 'o/r' })
    expect(k.toLowerCase()).toMatch(/screenshot|captura/)
  })

  it('el gate viaja también al .agent/STATE.md sembrado, para sobrevivir a una re-hidratación', () => {
    // Mismo motivo que el campo `role` (F20) y que `blocked` (F7): lo que
    // tiene que sobrevivir a un /clear es un CAMPO, no una frase dentro de un
    // prompt que se pierde con el contexto de la sesión.
    const seed = buildStateSeed({ ...SLICE, gates: ['visual'], gatesDeclared: true }, { branch: 'feat/7', base: 'main' })
    const st = parseState(seed)
    expect(JSON.stringify(st.meta.gates)).toContain('visual')
  })

  it('el kickoff nombra la sección "Out of scope / Protected" del issue', () => {
    // Segundo hallazgo de la misma lente: la columna `Protegido` SÍ llega al
    // cuerpo del issue, pero el kickoff enumera los criterios de aceptación
    // uno a uno y no nombraba jamás lo que queda FUERA de alcance. "Hidrátate
    // del issue" es más débil que nombrar la sección.
    const k = renderKickoff(SLICE, { repo: 'o/r' })
    expect(k).toContain('Out of scope / Protected')
  })
})

// ============================================================================
// 7. /ct-groom lo dice en voz alta.
// ============================================================================
describe('F21 — /ct-groom habla de los gates', () => {
  it('un gate que el Tipo NO implica se anuncia por stderr (quien groomea tiene que verlo)', () => {
    const res = dryRun(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | visual |']))
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/gate/i)
    expect(res.stderr).toContain('visual')
    expect(res.stderr).toContain('backend')
    expect(res.stderr).toMatch(/no implica|no viene de/i)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('gate:visual')
  })

  it('una RENUNCIA se anuncia por stderr, nunca en silencio', () => {
    const res = dryRun(specWith(['| 1 | pantalla | ui | alta | – | AC-1.1 | – | med | app | !visual |']))
    expect(res.status).toBe(0)
    expect(res.stderr.toLowerCase()).toMatch(/renuncia/)
    expect(res.stderr).toContain('visual')
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('gate:plan') // el defecto universal sigue en pie
    expect(plan.issues[0].labels).not.toContain('gate:visual')
  })

  it('un token de gate desconocido ABORTA antes de escribir nada, y dice cuál es el vocabulario y cómo se renuncia', () => {
    // Estrechar lo que el sistema acepta crea una categoría nueva de rechazo,
    // y esa categoría necesita voz: no basta con "valor inválido".
    const res = dryRun(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | seguridad |']))
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('seguridad')
    expect(res.stderr).toContain('visual')
    expect(res.stderr).toContain('apply')
    expect(res.stderr).toContain('!')
    expect(res.stdout).toBe('') // ni plan ni nada escrito
  })

  it('pedir y renunciar al mismo gate aborta en vez de elegir un ganador', () => {
    const res = dryRun(specWith(['| 1 | pantalla | ui | alta | – | AC-1.1 | – | med | app | visual, !visual |']))
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('visual')
  })

  it('una renuncia que no renuncia a nada se avisa (no se calla ni aborta)', () => {
    const res = dryRun(specWith(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | !visual |']))
    expect(res.status).toBe(0)
    expect(res.stderr.toLowerCase()).toMatch(/no implica|no tiene ese gate|no hace nada/)
  })

  it('un Tipo con errata pierde también sus GATES, y el aviso de Tipo desconocido lo dice (no solo el addendum)', () => {
    // Caso que no venía en el encargo: `TYPE_GATES` compara exacto, igual que
    // `ADDENDA`. Un "UI" en mayúsculas se queda sin addendum Y sin gate — la
    // segunda mitad es la grave, y hasta esta ronda el aviso no la nombraba
    // porque los gates no existían como concepto.
    const res = dryRun(specWith(['| 1 | pantalla | UI | alta | – | AC-1.1 | – | med | app | – |']))
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/gates humanos/)
    expect(res.stderr).toContain('ui→visual')
    expect(res.stderr).toContain('columna "Gate"') // el remedio, en el propio aviso
    const plan = JSON.parse(res.stdout)
    // pierde el gate TÉCNICO de su Tipo (visual), pero el defecto universal
    // `plan` no depende del Tipo y sobrevive a la errata.
    expect(plan.issues[0].labels).toContain('gate:plan')
    expect(plan.issues[0].labels).not.toContain('gate:visual')
  })

  it('el caso por defecto (Tipo ui, sin columna Gate) sigue trayendo su gate sin que nadie declare nada', () => {
    const md = [
      '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices', '',
      '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
      '|---|---|---|---|---|---|---|',
      '| 1 | pantalla | ui | alta | – | AC-1.1 | – |', '',
    ].join('\n')
    const res = dryRun(md)
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).toContain('gate:visual')
    expect(res.stderr).not.toMatch(/columna "Gate"/)
  })
})

// ============================================================================
// 8. El contrato §9 que /ct-init siembra.
// ============================================================================
describe('F21 — el contrato §9 documenta los gates y la invariante', () => {
  it('la sección sembrada explica la columna Gate, la renuncia con `!` y el vocabulario', () => {
    const dir = mkdtempSync(join(tmpdir(), 'f21-init-'))
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('**Gate**')
    expect(agents).toContain('`!visual`')
    for (const g of Object.keys(GATES)) expect(agents, g).toContain(`\`${g}\``)
    expect(agents).toContain('gate:none')
    rmSync(dir, { recursive: true, force: true })
  })

  it('la sección sembrada dice en voz alta que lo que no llega al issue no llega al agente', () => {
    // Es la lección del caso real: el spec confiaba en una §10 y una "REGLA
    // #-2" que el agente despachado nunca abre.
    const dir = mkdtempSync(join(tmpdir(), 'f21-init-'))
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // F30: la sección dejó de llamarse "§9". Lo que este test defiende es la
    // FRASE, no el nombre — así que se ancla en lo invariante ("fuera de la
    // tabla … no llega al agente") y no en cómo se llame la tabla ese mes.
    expect(agents).toMatch(/fuera de la tabla[^\n]*no llega al agente/i)
    expect(agents).not.toMatch(/§9/)
    rmSync(dir, { recursive: true, force: true })
  })
})
