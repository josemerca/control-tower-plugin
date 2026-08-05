import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, INHERITED_CONTEXT_PLACEHOLDER,
  readEpicContext, buildIssueBody, groomPlan,
} from '../scripts/groom.js'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { renderKickoff } from '../scripts/kickoff.js'

// El guardarraíl de truncamientos no es una preferencia de estilo: la sección
// se reescribe entera desde el spec, y ese reemplazo termina en la primera
// cosa que corta la sección (cabecera de cualquier nivel, comentario HTML,
// etc.). Cualquier cosa que corte no puede vivir dentro, o dejaría el resto
// del texto huérfano bajo el reemplazo. Se corta en el productor, donde
// todavía hay a quién decírselo.
describe('readEpicContext — la sección del spec y su guardarraíl', () => {
  const conSeccion = (cuerpo) => [
    '# Spec',
    '',
    '## 8. Algo',
    'texto previo',
    '',
    EPIC_CONTEXT_HEADING,
    cuerpo,
    '',
    '## 9. Slices',
    '| # | Slice | Dep |',
    '|---|---|---|',
    '| 1 | A | – |',
  ].join('\n')

  it('devuelve el contenido cuando la sección existe y está limpia', () => {
    const r = readEpicContext(conSeccion('- `today_madrid()`, nunca `date.today()`\n- sin `JSONB` en modelos'))
    expect(r.content).toBe('- `today_madrid()`, nunca `date.today()`\n- sin `JSONB` en modelos')
    expect(r.warnings).toEqual([])
  })

  it('sin la sección: content null y un aviso que dice qué añadir', () => {
    const r = readEpicContext('# Spec\n\n## 9. Slices\n| # | Slice | Dep |')
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain(EPIC_CONTEXT_HEADING)
  })

  it('sección presente pero vacía: se trata como ausente, con su propio aviso', () => {
    const r = readEpicContext(conSeccion(''))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('sin contenido')
  })

  it('sección con una cabecera dentro: no se emite, y el aviso nombra la línea', () => {
    const r = readEpicContext(conSeccion('preámbulo\n\n### 1 · Un detalle\ntexto del detalle'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('### 1 · Un detalle')
  })

  it('el guardarraíl cubre cualquier nivel y la indentación que CommonMark admite', () => {
    expect(readEpicContext(conSeccion('t\n\n#### hondo')).warnings[0]).toContain('#### hondo')
    expect(readEpicContext(conSeccion('t\n\n   ### indentada')).warnings[0]).toContain('### indentada')
  })

  it('una cabecera de nivel 1 o 2 detrás NO es una subcabecera: sólo termina la sección', () => {
    expect(readEpicContext(conSeccion('- una regla')).content).toBe('- una regla')
    const conH1 = ['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '', '# Otro título'].join('\n')
    expect(readEpicContext(conH1).content).toBe('- una regla')
  })

  // Una "###" dentro de una valla de código es un ejemplo, no una cabecera, y
  // no parte nada. Sale gratis: el escáner que se reusa ya lleva el
  // endurecimiento de vallas encima. Se fija con test para que siga siendo
  // cierto si alguien cambia de escáner.
  it('una ### dentro de una valla de código no dispara el guardarraíl', () => {
    const r = readEpicContext(conSeccion('ejemplo:\n\n```md\n### esto es un ejemplo\n```'))
    expect(r.warnings).toEqual([])
    expect(r.content).toContain('### esto es un ejemplo')
  })

  it('la sección al final del fichero, sin nada detrás, se lee entera', () => {
    const r = readEpicContext(['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '- otra regla'].join('\n'))
    expect(r.content).toBe('- una regla\n- otra regla')
  })

  it('la última sección del fichero CON una ### dentro también se corta', () => {
    const r = readEpicContext(['# Spec', '', EPIC_CONTEXT_HEADING, 'preámbulo', '', '### dentro', 'texto'].join('\n'))
    expect(r.content).toBeNull()
    expect(r.warnings[0]).toContain('### dentro')
  })

  it('el placeholder de la sección heredada dice quién la rellena y que el plugin no la toca', () => {
    expect(INHERITED_CONTEXT_PLACEHOLDER).toMatch(/coordinadora/)
    expect(INHERITED_CONTEXT_PLACEHOLDER).toMatch(/ct-groom/)
  })

  it('INHERITED_CONTEXT_HEADING tiene el valor exacto', () => {
    expect(INHERITED_CONTEXT_HEADING).toBe('## Contexto heredado')
  })

  it('comentario HTML autocontenido dentro dispara el aviso y nombra la línea', () => {
    const r = readEpicContext(conSeccion('texto\n\n<!-- TODO: revisar esto -->'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('<!-- TODO: revisar esto -->')
  })

  it('validación: cabecera H3 dentro sigue disparando el aviso', () => {
    const r = readEpicContext(conSeccion('preámbulo\n\n### 1 · Un detalle\ntexto del detalle'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('### 1 · Un detalle')
  })

  it('validación: valla de código sigue sin disparar', () => {
    const r = readEpicContext(conSeccion('ejemplo:\n\n```md\n### esto es un ejemplo\n```'))
    expect(r.warnings).toEqual([])
    expect(r.content).toContain('### esto es un ejemplo')
  })

  it('validación: cabecera H1/H2 detrás sigue siendo un final normal', () => {
    expect(readEpicContext(conSeccion('- una regla')).content).toBe('- una regla')
    const conH1 = ['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '', '# Otro título'].join('\n')
    expect(readEpicContext(conH1).content).toBe('- una regla')
  })

  it('cabecera H1 o H2 desnuda (sin texto) es un fin normal, no truncamiento', () => {
    // Una línea que sea exactamente "##" sin nada detrás es una cabecera
    // válida para locateSection y termina la sección normalmente
    const conH2Desnudo = ['# Spec', '', EPIC_CONTEXT_HEADING, '- una regla', '', '##'].join('\n')
    const r = readEpicContext(conH2Desnudo)
    expect(r.content).toBe('- una regla')
    expect(r.warnings).toEqual([])
  })
})

const SLICE = { n: 2, issue: null, name: 'card del plan', type: 'ui', entrega: 'card contraíble', deps: [1], ac: ['AC-2.1'], protected: 'schema §6' }
const SPEC_REF = { path: 'docs/spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices', reason: null }

describe('buildIssueBody — las dos secciones nuevas', () => {
  it('con contexto del epic: lo emite tal cual, y la heredada va vacía', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, '- `today_madrid()`, nunca `date.today()`')
    expect(body).toContain(`${EPIC_CONTEXT_HEADING}\n- \`today_madrid()\`, nunca \`date.today()\``)
    expect(body).toContain(`${INHERITED_CONTEXT_HEADING}\n${INHERITED_CONTEXT_PLACEHOLDER}`)
  })

  it('sin contexto del epic: esa sección NO existe, la heredada sí', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null)
    expect(body).not.toContain(EPIC_CONTEXT_HEADING)
    expect(body).toContain(INHERITED_CONTEXT_HEADING)
  })

  it('el tercer parámetro es opcional y no rompe a quien llame con dos', () => {
    expect(buildIssueBody(SLICE, SPEC_REF)).toContain(INHERITED_CONTEXT_HEADING)
  })

  // El orden importa: es contexto para interpretar los criterios de
  // aceptación, así que leerlo después de ellos es leerlo tarde.
  it('van tras Descripción y antes de Acceptance criteria', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, '- una regla')
    const pos = (s) => body.indexOf(s)
    expect(pos('## Descripción')).toBeLessThan(pos(EPIC_CONTEXT_HEADING))
    expect(pos(EPIC_CONTEXT_HEADING)).toBeLessThan(pos(INHERITED_CONTEXT_HEADING))
    expect(pos(INHERITED_CONTEXT_HEADING)).toBeLessThan(pos('## Acceptance criteria'))
  })

  it('groomPlan reparte el MISMO texto a todos los issues del epic', () => {
    const plan = groomPlan(
      [SLICE, { ...SLICE, n: 3, name: 'otro slice' }],
      { milestone: 'E1', specRef: SPEC_REF, epicContext: '- una regla común' },
    )
    expect(plan.issues.map((i) => i.epicContext)).toEqual(['- una regla común', '- una regla común'])
    for (const i of plan.issues) expect(i.body).toContain('- una regla común')
  })

  it('groomPlan sin epicContext deja el campo a null, no a undefined', () => {
    const plan = groomPlan([SLICE], { milestone: 'E1', specRef: SPEC_REF })
    expect(plan.issues[0].epicContext).toBeNull()
  })
})

// ============================================================================
// Integración end-to-end: /ct-groom --dry-run de verdad, no las funciones
// puras de arriba. `readEpicContext`/`groomPlan`/`buildIssueBody` ya están
// probadas en aislamiento — lo que falta comprobar es que ct-groom.mjs las
// conecta: lee el spec, imprime los avisos por stderr, y pasa el texto al
// plan. Mecánica de invocación (spawnSync + PATH con el `gh` de mentira)
// reusada tal cual de __tests__/ct-groom-dryrun.test.js / f21-gate-y-tipo.test.js
// — no se inventa una segunda forma de arrancar el binario.
// ============================================================================
const groomScript = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = (overrides = {}) => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}`, ...overrides })

function dryRun(specText) {
  const dir = makeSpecDir('f26-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specText)
  const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
    encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv(),
  })
  rmSync(dir, { recursive: true, force: true })
  return res
}

const SLICES_TABLE = [
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
  '|---|---|---|---|---|---|---|',
  '| 1 | login | backend | modelo | – | AC-1.1 | schema |',
  '| 2 | refresh | backend | flow | #1 | AC-2.1 | – |',
].join('\n')

// Se invoca el binario real con --dry-run, no una función interna: el aviso y
// el reparto del texto sólo son ciertos si el wrapper de verdad los conecta.
describe('/ct-groom --dry-run — el contexto del epic llega al plan', () => {
  it('con la sección en el spec: el texto sale en cada issue del dry-run', () => {
    const spec = [EPIC_CONTEXT_HEADING, '- una regla común', '', '## 9. Slices', SLICES_TABLE, ''].join('\n')
    const res = dryRun(spec)
    expect(res.status).toBe(0)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues).toHaveLength(2)
    expect(plan.issues.every((i) => i.epicContext === '- una regla común')).toBe(true)
  })

  it('sin la sección: avisa por stderr y epicContext queda a null', () => {
    const spec = ['## 9. Slices', SLICES_TABLE, ''].join('\n')
    const res = dryRun(spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toContain(EPIC_CONTEXT_HEADING)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.every((i) => i.epicContext === null)).toBe(true)
  })

  it('con una cabecera dentro: avisa nombrando la línea y no emite la sección', () => {
    const spec = [
      EPIC_CONTEXT_HEADING, 'preámbulo', '', '### 1 · Un detalle', 'texto del detalle', '',
      '## 9. Slices', SLICES_TABLE, '',
    ].join('\n')
    const res = dryRun(spec)
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('### 1 · Un detalle')
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.every((i) => !i.body.includes(EPIC_CONTEXT_HEADING))).toBe(true)
  })
})

// ============================================================================
// Task 4: diffIssue compara "## Contexto del epic" contra el spec; la sección
// heredada nunca se compara ni produce campo alguno.
// ============================================================================
import { diffIssue, hasDrift, formatDrift } from '../scripts/reconcile.js'

const bodyCon = (epic, heredado) => [
  '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
  '',
  ...(epic ? [EPIC_CONTEXT_HEADING, epic, ''] : []),
  ...(heredado ? [INHERITED_CONTEXT_HEADING, heredado, ''] : []),
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- AC-2.1',
  '',
  '## Out of scope / Protected',
  '- 🚫 nada',
].join('\n')

const WANTED = {
  order: 2, title: '#2 card', labels: [], deps: [], ac: ['AC-2.1'],
  descripcion: null, protectedLine: '- 🚫 nada', gatesContent: '',
  specLink: '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
  epicContext: '- regla nueva',
}
const existingWith = (body) => ({ number: 90, title: '#2 card', state: 'open', milestone: { title: 'E1' }, labels: [], body })

describe('diffIssue — el contexto del epic se compara; el heredado nunca', () => {
  it('detecta que el texto del epic difiere', () => {
    const d = diffIssue(existingWith(bodyCon('- regla VIEJA', null)), WANTED, 'E1', [])
    expect(d.epicContextDiffers).toBe(true)
  })

  it('null en los dos lados es acuerdo, no divergencia', () => {
    const d = diffIssue(existingWith(bodyCon(null, null)), { ...WANTED, epicContext: null }, 'E1', [])
    expect(d.epicContextDiffers).toBe(false)
  })

  it('NO cuenta para el exit code, ni divergiendo ni duplicada', () => {
    const d = diffIssue(existingWith(bodyCon('- regla VIEJA', null)), WANTED, 'E1', [])
    expect(hasDrift(d)).toBe(false)
    const dup = bodyCon('- a', null) + `\n${EPIC_CONTEXT_HEADING}\n- b\n\n${INHERITED_CONTEXT_HEADING}\nx\n\n${INHERITED_CONTEXT_HEADING}\ny\n`
    const d2 = diffIssue(existingWith(dup), { ...WANTED, epicContext: '- a' }, 'E1', [])
    expect(d2.duplicateMachineSections).toEqual([])
    expect(hasDrift(d2)).toBe(false)
  })

  it('se reporta como nota:, nunca como divergencia:', () => {
    const d = diffIssue(existingWith(bodyCon('- regla VIEJA', null)), WANTED, 'E1', [])
    const linea = formatDrift(d).find((l) => l.includes(EPIC_CONTEXT_HEADING))
    expect(linea).toMatch(/^nota:/)
  })

  // La sección heredada es la petición literal del §4: el plugin no opina.
  it('el contenido de la sección heredada no produce NINGÚN campo ni línea', () => {
    const a = diffIssue(existingWith(bodyCon('- x', 'lo que escribio la coordinadora')), { ...WANTED, epicContext: '- x' }, 'E1', [])
    const b = diffIssue(existingWith(bodyCon('- x', 'algo COMPLETAMENTE distinto')), { ...WANTED, epicContext: '- x' }, 'E1', [])
    expect(formatDrift(a)).toEqual(formatDrift(b))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

// ============================================================================
// Task 5: buildReconcileBody reescribe "## Contexto del epic" desde el spec;
// "## Contexto heredado" sobrevive byte a byte, siempre — nadie la splicea.
// ============================================================================
import { buildReconcileBody } from '../scripts/reconcile.js'
import { extractSectionContent, extractAc } from '../scripts/gh-issue-map.js'

// El trozo LITERAL del cuerpo entre dos cabeceras. extractSectionContent no
// sirve para afirmar "intacto": corta en la primera cabecera de cualquier
// nivel, así que sobre una sección con subcabeceras dentro compararía sólo su
// primer trozo y diría que sí a cosas que no.
const trozo = (body, desde, hasta) => body.slice(body.indexOf(desde), body.indexOf(hasta))

describe('buildReconcileBody — reescribe el del epic, no toca el heredado', () => {
  const CON_AMBAS = [
    '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
    '',
    EPIC_CONTEXT_HEADING,
    '- regla VIEJA',
    '',
    INHERITED_CONTEXT_HEADING,
    'Preámbulo de la coordinadora.',
    '',
    '### 1 · Una subcabecera suya',
    'Texto bajo la subcabecera.',
    '',
    '| col | col |',
    '|---|---|',
    '| a | b |',
    '',
    '## Acceptance criteria (EARS, 1:1 con tests)',
    '- AC-VIEJO',
    '',
    '## Out of scope / Protected',
    '- 🚫 nada',
  ].join('\n')

  const wanted = (over) => ({
    specLink: '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
    ac: ['AC-NUEVO'], deps: [], epicContext: '- regla NUEVA', ...over,
  })

  it('reescribe el del epic y deja el heredado byte a byte, con sus subcabeceras y su tabla', () => {
    const r = buildReconcileBody(CON_AMBAS, wanted())
    expect(extractSectionContent(r.body, EPIC_CONTEXT_HEADING)).toBe('- regla NUEVA')
    expect(trozo(r.body, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
      .toBe(trozo(CON_AMBAS, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
    expect(extractAc(r.body)).toEqual(['AC-NUEVO'])
  })

  it('sin la cabecera del epic, la inserta justo ANTES de Acceptance criteria', () => {
    const sinEpic = CON_AMBAS.replace(`${EPIC_CONTEXT_HEADING}\n- regla VIEJA\n\n`, '')
    const r = buildReconcileBody(sinEpic, wanted())
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf('## Acceptance criteria'))
    expect(extractSectionContent(r.body, EPIC_CONTEXT_HEADING)).toBe('- regla NUEVA')
  })

  // Sin NINGÚN ancla (ni "## Contexto heredado" ni "## Acceptance criteria")
  // se sigue rindiendo, que es la propiedad del §6.4 del diseño: no se
  // inventa una posición. Lo que cambió en la review final de rama es cuál es
  // el ancla preferente, no que se escriba a ciegas cuando no hay ninguna.
  it('sin ningún ancla, NO inserta nada y no revienta', () => {
    const sinAncla = [
      '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
      '',
      '## Descripción',
      'lo que entrega',
    ].join('\n')
    const r = buildReconcileBody(sinAncla, wanted({ ac: [] }))
    expect(r.body === null || !r.body.includes(EPIC_CONTEXT_HEADING)).toBe(true)
  })

  // Y con la heredada presente pero sin AC, ya SÍ hay un ancla seguro: se
  // inserta justo antes de ella (fuera de su texto), en la posición del §3.4.
  it('con la heredada pero sin Acceptance criteria, ancla en la heredada', () => {
    const soloHeredada = [
      '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
      '',
      INHERITED_CONTEXT_HEADING,
      'lo de la coordinadora',
    ].join('\n')
    const r = buildReconcileBody(soloHeredada, wanted({ ac: [] }))
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf(INHERITED_CONTEXT_HEADING))
    expect(r.body).toContain(`${INHERITED_CONTEXT_HEADING}\nlo de la coordinadora`)
  })

  it('si el spec deja de traer contexto, la sección del epic se retira entera', () => {
    const r = buildReconcileBody(CON_AMBAS, wanted({ epicContext: null }))
    expect(r.body).not.toContain(EPIC_CONTEXT_HEADING)
    expect(r.body).toContain(INHERITED_CONTEXT_HEADING)
    expect(r.body).not.toContain('\n\n\n')
  })

  // La propiedad que hoy se sostiene sola y que nadie protege.
  it('nunca inserta la sección heredada cuando falta del cuerpo', () => {
    const sinHeredado = CON_AMBAS.replace(/## Contexto heredado[\s\S]*?(?=## Acceptance)/, '')
    const r = buildReconcileBody(sinHeredado, wanted())
    expect(r.body).not.toContain(INHERITED_CONTEXT_HEADING)
  })

  it('un cambio SÓLO en el heredado no produce ninguna escritura', () => {
    const yaAlDia = CON_AMBAS.replace('- regla VIEJA', '- regla NUEVA').replace('- AC-VIEJO', '- AC-NUEVO')
    expect(buildReconcileBody(yaAlDia, wanted()).body).toBeNull()
  })
})

// ============================================================================
// Task 6: renderKickoff nombra las dos secciones de contexto
// ============================================================================

describe('renderKickoff — nombra las dos secciones', () => {
  const K = () => renderKickoff({ n: 7, name: 'card', type: 'ui', ac: ['AC-7.1'], deps: [], issue: '#7' }, { repo: 'o/r' })

  it('nombra las dos cabeceras EXACTAS que emite el groom', () => {
    expect(K()).toContain(EPIC_CONTEXT_HEADING)
    expect(K()).toContain(INHERITED_CONTEXT_HEADING)
  })

  it('la salida NO depende de ningún contenido de contexto que traiga el slice', () => {
    // La propiedad de verdad: se NOMBRAN las secciones y no se interpola su
    // texto. Se comprueba comparando dos salidas —una sin campos de contexto,
    // otra con los mismos campos cargados de texto reconocible— y exigiendo que
    // sean idénticas. Si alguien introduce interpolación mañana, esa igualdad
    // se rompe y el test lo dice. Un test que no puede fallar no protege la
    // decisión de diseño.
    const sinContexto = K()
    const conContexto = renderKickoff(
      {
        n: 7, name: 'card', type: 'ui', ac: ['AC-7.1'], deps: [], issue: '#7',
        epicContext: 'TEXTO EPICCONTEXT QUE NO DEBE APARECER',
        inheritedContext: 'TEXTO INHERITEDCONTEXT QUE NO DEBE APARECER',
      },
      { repo: 'o/r' },
    )
    expect(sinContexto).toBe(conContexto)
  })

  it('anuncia explícitamente el caso «vacía»: la sección existe pero sin contenido', () => {
    expect(K()).toMatch(/vacía/)
  })

  it('anuncia explícitamente el caso «ausente»: issue previo a esta ronda nunca recibe la sección heredada', () => {
    expect(K()).toMatch(/no está|no aparece/)
  })

  it('sigue nombrando Out of scope / Protected — no lo desplaza', () => {
    expect(K()).toContain('## Out of scope / Protected')
  })
})

// ============================================================================
// REVIEW FINAL DE RAMA — C1: la costura entre las funciones puras de arriba y
// ct-groom.mjs. Todo lo anterior de este fichero prueba las piezas por
// separado; el defecto vivía justo en el punto donde el wrapper las une, y por
// eso ningún test lo veía: --reconcile calculaba el body nuevo y lo tiraba
// cuando la ÚNICA divergencia era el contexto del epic (el escenario primario
// de la feature), porque gateaba la escritura en `hasDrift`, que excluye esta
// sección a propósito (§4.4). Son DOS preguntas distintas: "¿hay algo que
// escribir?" no es "¿esto cuenta para el exit code?".
// ============================================================================
import { specUrl } from './fixtures/spec-repo.js'

const SPEC_REF_E2E = { path: 'spec.md', heading: '9. Slices', url: specUrl('spec.md'), reason: null }
const SLICE_1 = { n: 1, name: 'login', type: 'backend', entrega: 'modelo', deps: [], ac: ['AC-1.1'], protected: 'schema' }
// Las labels que el plan produce hoy para SLICE_1 (verificado contra
// groom.js#buildLabels). `status:` nunca se compara, así que da igual cuál
// lleve el issue.
const LABELS_1 = [{ name: 'type:backend' }, { name: 'gate:none' }, { name: 'status:backlog' }]

const ONE_SLICE_TABLE = [
  '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
  '|---|---|---|---|---|---|---|',
  '| 1 | login | backend | modelo | – | AC-1.1 | schema |',
].join('\n')

const specConContexto = (contexto) => [
  EPIC_CONTEXT_HEADING, contexto, '', '## 9. Slices', ONE_SLICE_TABLE, '',
].join('\n')

function invoke(specText, issues, extraArgs) {
  const dir = makeSpecDir('f26-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specText)
  const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', ...extraArgs], {
    encoding: 'utf8',
    stdio: QUIET_STDIO,
    env: fakeEnv({
      FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([issues]),
    }),
  })
  rmSync(dir, { recursive: true, force: true })
  return res
}

const issueCon = (epicContext) => ({
  number: 501,
  title: '#1 login',
  state: 'open',
  milestone: { title: 'Epic' },
  labels: LABELS_1,
  body: buildIssueBody(SLICE_1, SPEC_REF_E2E, epicContext),
})

describe('C1 — el contexto del epic como ÚNICA divergencia sí se escribe', () => {
  it('--dry-run --reconcile lo anuncia con una línea "aplicaría" que nombra la sección', () => {
    const res = invoke(specConContexto('- regla NUEVA'), [issueCon('- regla VIEJA')], ['--dry-run', '--reconcile'])
    expect(res.status).toBe(0) // §4.4: esta sección jamás produce un 3
    expect(res.stderr).toMatch(/--reconcile aplicaría: gh issue edit 501/)
    // El preview nombra lo que de verdad cambiaría, no una lista fija de
    // categorías que aquí sería falsa (ni deps ni AC divergen).
    expect(res.stderr).toMatch(/aplicaría.*contexto del epic/)
    expect(res.stderr).not.toMatch(/aplicaría.*criterios de aceptación/)
  })

  it('la corrida real llama a `gh issue edit` con el --body reescrito, y el resumen nombra la categoría', () => {
    const res = invoke(specConContexto('- regla NUEVA'), [issueCon('- regla VIEJA')], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\): .*contexto del epic/)
    expect(res.stdout).not.toMatch(/reconciliado \(orden #1\): *$/m) // nunca un dos-puntos pelado
  })

  it('sin --reconcile no se escribe nada, y el exit sigue siendo 0 (nunca 3 por esta sección)', () => {
    const res = invoke(specConContexto('- regla NUEVA'), [issueCon('- regla VIEJA')], [])
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/^nota:.*Contexto del epic/m)
    expect(res.stderr).not.toMatch(/^divergencia:.*Contexto del epic/m)
  })

  it('sin ninguna divergencia (el contexto ya coincide) no se llama a `gh issue edit`', () => {
    const res = invoke(specConContexto('- regla NUEVA'), [issueCon('- regla NUEVA')], ['--dry-run', '--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/aplicaría/)
  })
})

// La rendición sin ancla ya estaba probada en la capa pura (más arriba: "sin
// Acceptance criteria como ancla, NO inserta nada"). Lo que faltaba es que se
// DIGA: AC y Dependencias se rinden en voz alta desde la review round 4, y
// ésta lo hacía en silencio — con el arreglo de C1, el caller pasaba a
// anunciar una escritura que no existía.
describe('la rendición del contexto del epic se dice, y sigue sin mover el exit code', () => {
  const SIN_ANCLA_TABLE = [
    '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido |',
    '|---|---|---|---|---|---|---|',
    '| 1 | login | backend | modelo | – | – | schema |',
  ].join('\n')

  // Un cuerpo sin ningún ancla —ni "## Acceptance criteria" (un humano la
  // borró) ni "## Contexto heredado" (issue anterior a F26)— y sin la sección
  // del epic: no hay dónde insertarla en su sitio. La tabla no pide ningún
  // criterio, así que AC no diverge y no hay ningún gap que sí cuente.
  const SIN_ANCLA_BODY = [
    `> Slice \`#1\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`,
    '',
    '## Descripción',
    'modelo',
    '',
    '## Out of scope / Protected',
    '- 🚫 schema',
    '',
    '<!-- ct-order:1 -->',
  ].join('\n')

  const spec = [EPIC_CONTEXT_HEADING, '- regla', '', '## 9. Slices', SIN_ANCLA_TABLE, ''].join('\n')
  const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body: SIN_ANCLA_BODY }

  it('lo dice como nota:, nombra el ancla que falta, y no escribe nada', () => {
    const res = invoke(spec, [issue], ['--dry-run', '--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/nota:.*NO ha reescrito la sección "## Contexto del epic"/)
    expect(res.stderr).toMatch(/ancla.*Contexto heredado.*Acceptance criteria/) // nombra las DOS que servirían
    expect(res.stderr).not.toMatch(/aplicaría/) // no hay body nuevo: no se anuncia ninguna escritura
  })

  it('la sección heredada no se compara ni se inserta', () => {
    const res = invoke(spec, [issue], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(new RegExp(`divergencia.*${INHERITED_CONTEXT_HEADING}`))
  })
})

// ============================================================================
// REVIEW FINAL DE RAMA — C2: los splices escribían DENTRO de "## Contexto
// heredado". Todos los localizadores de buildReconcileBody son "primera
// aparición sobre el body entero", sin ninguna noción de zona intocable. El
// caso de uso real —la coordinadora pega contexto del issue del slice
// anterior, que lleva las MISMAS cabeceras que todo issue del epic— convertía
// su texto en el objetivo del splice. El placeholder promete por escrito lo
// contrario: «`/ct-groom` no escribe aquí ni reescribe lo que escribas».
// ============================================================================

const SPEC_LINK_3 = `> Slice \`#3\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`
const FIN_DEL_PEGADO = 'Hasta aquí lo pegado por la coordinadora.'

// El cuerpo real que reprodujo el defecto: la coordinadora pega el bloque de
// criterios del slice #2 dentro de SU sección, cabecera incluida.
const CON_PEGADO = (pegado) => [
  SPEC_LINK_3,
  '',
  '## Descripción',
  'flow',
  '',
  EPIC_CONTEXT_HEADING,
  '- regla VIEJA',
  '',
  INHERITED_CONTEXT_HEADING,
  'El slice #2 dejó montado el endpoint. Copio lo suyo:',
  '',
  ...pegado,
  '',
  FIN_DEL_PEGADO,
  '',
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- AC-3.1 VIEJO',
  '',
  '## Dependencias',
  '- merge-after `#2`',
  '',
  '## Out of scope / Protected',
  '- 🚫 nada',
  '',
  '<!-- ct-order:3 -->',
].join('\n')

const WANTED_3 = { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [2], epicContext: '- regla NUEVA' }

// Se compara con `trozo` (fragmento LITERAL entre dos anclas), nunca con
// extractSectionContent: ése corta en la primera cabecera de cualquier nivel,
// así que sobre una sección con cabeceras pegadas dentro compararía sólo su
// primer trozo y daría por buena una sección destrozada.
describe('C2 — nada de lo que escriba la coordinadora se toca', () => {
  it('una cabecera de AC pegada dentro: su texto sobrevive byte a byte', () => {
    const body = CON_PEGADO(['## Acceptance criteria (EARS, 1:1 con tests)', '- AC-2.1 de la coordinadora', '- AC-2.2 de la coordinadora'])
    const r = buildReconcileBody(body, WANTED_3)
    const resultado = r.body ?? body
    expect(resultado).toContain(FIN_DEL_PEGADO)
    expect(trozo(resultado, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
    // Y se dice: no se aplica a ciegas sobre la copia equivocada, se reporta.
    expect(r.unresolvedAc).toBe(true)
  })

  it('una cabecera de Dependencias pegada dentro: su texto sobrevive byte a byte', () => {
    const body = CON_PEGADO(['## Dependencias', '- merge-after `#1`'])
    const r = buildReconcileBody(body, { ...WANTED_3, deps: [2, 5] })
    const resultado = r.body ?? body
    expect(trozo(resultado, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
    expect(r.unresolvedDeps).toBe(true)
  })

  it('la cabecera del contexto del epic pegada dentro: no se escribe en la copia de ella, y se dice', () => {
    const body = CON_PEGADO([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, WANTED_3)
    const resultado = r.body ?? body
    expect(trozo(resultado, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
    expect(r.unresolvedEpicContext).toBe('duplicada')
  })

  it('el ancla de inserción de Dependencias también tiene que ser inequívoca', () => {
    // Sin "## Dependencias" propia y con la de Protegido pegada dentro de la
    // sección heredada: la inserción anclaba en la PRIMERA aparición, o sea
    // dentro del texto de la coordinadora.
    const body = [
      SPEC_LINK_3, '',
      INHERITED_CONTEXT_HEADING,
      'Copio lo suyo:', '',
      '## Out of scope / Protected',
      '- 🚫 lo que protegía el slice #2',
      '',
      FIN_DEL_PEGADO, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [2], epicContext: null })
    const resultado = r.body ?? body
    expect(trozo(resultado, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
    expect(r.unresolvedDeps).toBe(true)
  })

  it('la línea de enlace al spec pegada dentro no es la línea del issue', () => {
    // Aquí sí muerde el rango prohibido literal: la línea de enlace no es una
    // cabecera, así que no termina la sección heredada y vive DENTRO de ella.
    const pegada = '> Slice `#2` del epic. Spec: [spec.md § 9. Slices](https://github.com/o/r/blob/main/OTRO.md#9-slices)'
    const body = [
      INHERITED_CONTEXT_HEADING,
      'El slice #2 apuntaba a:',
      pegada,
      '',
      FIN_DEL_PEGADO, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [], epicContext: null })
    expect(r.body).toContain(pegada) // intacta
    expect(trozo(r.body, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
    expect(r.body).toContain(SPEC_LINK_3) // la del issue se antepone, como cuando falta del todo
  })
})

// ============================================================================
// REVIEW FINAL DE RAMA — C3: `truncationLine` sólo caza terminadores que
// cortan la sección DEMASIADO PRONTO. Una valla de código sin cerrar (o un
// `<!--` sin `-->`) hace lo contrario: esconde del escáner todas las líneas
// siguientes, así que no hay terminador NINGUNO y la sección se traga el resto
// del spec —tabla de slices incluida— sin un solo aviso. Ese delimitador sin
// cerrar viaja después al cuerpo de cada issue, y el siguiente --reconcile
// splicea desde la cabecera del epic hasta el final del body: se lleva por
// delante "## Contexto heredado", los AC, los gates, lo protegido y el
// marcador `ct-order` (y perder el marcador desempareja el issue, así que el
// groom siguiente crea un duplicado).
// ============================================================================
describe('C3 — un delimitador sin cerrar dentro de la sección del spec', () => {
  const specCon = (cuerpo) => [
    '# Spec', '', EPIC_CONTEXT_HEADING, cuerpo, '', '## 9. Slices',
    '| # | Slice | Dep |', '|---|---|---|', '| 1 | A | – |',
  ].join('\n')

  it('valla de código sin cerrar: no se emite, y el aviso lo dice', () => {
    const r = readEpicContext(specCon('- regla A\n```js\nconst x = 1'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/valla|```/)
    expect(r.warnings[0]).toContain(EPIC_CONTEXT_HEADING)
  })

  it('comentario HTML sin cerrar: mismo trato', () => {
    const r = readEpicContext(specCon('- regla A\n<!-- ojo con esto'))
    expect(r.content).toBeNull()
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/comentario/)
  })

  it('la tabla de slices NUNCA acaba dentro del contexto del epic', () => {
    for (const roto of ['- regla\n```js\nconst x = 1', '- regla\n<!-- ojo']) {
      expect(readEpicContext(specCon(roto)).content).toBeNull()
    }
  })

  // Una valla BIEN cerrada sigue siendo contenido legítimo: el guardarraíl
  // caza el delimitador abierto, no el bloque de código.
  it('una valla bien cerrada no dispara nada', () => {
    const r = readEpicContext(specCon('ejemplo:\n\n```md\n### no es una cabecera\n```'))
    expect(r.warnings).toEqual([])
    expect(r.content).toContain('### no es una cabecera')
  })

  // El guardarraíl no puede ser la única línea de defensa: un humano edita el
  // cuerpo del issue a mano, y ahí no hay ningún productor al que cortar.
  it('el splice del epic se defiende de un cuerpo de issue con la valla abierta', () => {
    const body = [
      SPEC_LINK_3, '',
      EPIC_CONTEXT_HEADING,
      '- regla VIEJA',
      '```js',
      'const x = 1',
      '',
      INHERITED_CONTEXT_HEADING,
      'lo de la coordinadora',
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada', '',
      '<!-- ct-order:3 -->',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [], epicContext: '- regla NUEVA' })
    const resultado = r.body ?? body
    expect(resultado).toContain(INHERITED_CONTEXT_HEADING)
    expect(resultado).toContain('lo de la coordinadora')
    expect(resultado).toContain('## Out of scope / Protected')
    expect(resultado).toContain('<!-- ct-order:3 -->')
    expect(r.unresolvedEpicContext).toBe('seccion-sin-cerrar')
  })

  it('tampoco se escribe un texto nuevo que traiga la valla abierta', () => {
    const body = [
      SPEC_LINK_3, '',
      EPIC_CONTEXT_HEADING, '- regla VIEJA', '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-3.1 NUEVO', '',
      '## Out of scope / Protected', '- 🚫 nada',
    ].join('\n')
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 NUEVO'], deps: [], epicContext: '- regla\n```js\nconst x = 1' })
    expect(r.body === null || !r.body.includes('const x = 1')).toBe(true)
    expect(r.unresolvedEpicContext).toBe('texto-sin-cerrar')
  })
})

// ============================================================================
// REVIEW FINAL DE RAMA — I1: los tres (ahora cuatro) modos de fallo del
// guardarraíl colapsaban en `content: null`, indistinguible aguas abajo de "el
// spec no tiene ninguna opinión". Y `buildReconcileBody` lee `null` como
// RETIRA LA SECCIÓN ENTERA. O sea: añadir un `###` de más al spec borraba el
// contexto de los N issues del epic en el siguiente --reconcile. El aviso
// decía sólo que la sección no se emitiría, y el diseño §7 lo llamaba
// "fail-safe": ninguna de las dos cosas es cierta con --reconcile delante.
// ============================================================================
describe('I1 — "no tengo texto válido" no es "el epic no tiene contexto"', () => {
  const conMotivo = (spec) => readEpicContext(spec)

  it('readEpicContext dice POR QUÉ, no sólo que no hay texto', () => {
    const tabla = '\n\n## 9. Slices\n| # | Slice | Dep |'
    expect(conMotivo('# Spec' + tabla).reason).toBe('ausente')
    expect(conMotivo(`# Spec\n\n${EPIC_CONTEXT_HEADING}\n` + tabla).reason).toBe('vacia')
    expect(conMotivo(`# Spec\n\n${EPIC_CONTEXT_HEADING}\ntexto\n\n### dentro\nmás` + tabla).reason).toBe('malformada')
    expect(conMotivo(`# Spec\n\n${EPIC_CONTEXT_HEADING}\ntexto\n\`\`\`js\nx` + tabla).reason).toBe('malformada')
    expect(conMotivo(`# Spec\n\n${EPIC_CONTEXT_HEADING}\n- regla` + tabla).reason).toBeNull()
  })

  it('el aviso de una sección malformada dice que NO se borra lo que ya hay en los issues', () => {
    const w = conMotivo(`# Spec\n\n${EPIC_CONTEXT_HEADING}\ntexto\n\n### dentro\nmás\n\n## 9. Slices`).warnings[0]
    expect(w).toMatch(/no se (borra|toca|retira)/i)
  })

  it('un spec malformado NO retira la sección del cuerpo de los issues', () => {
    const spec = [
      EPIC_CONTEXT_HEADING, 'preámbulo', '', '### 1 · un detalle', 'texto', '',
      '## 9. Slices', ONE_SLICE_TABLE, '',
    ].join('\n')
    const res = invoke(spec, [issueCon('- regla que YA está en el issue')], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('### 1 · un detalle')
    expect(res.stdout).not.toMatch(/reconciliado/) // no hay nada que aplicar: el spec no tiene opinión válida
  })

  it('un spec SIN la sección sí la retira: eso sí significa "el epic no tiene contexto"', () => {
    const spec = ['## 9. Slices', ONE_SLICE_TABLE, ''].join('\n')
    const res = invoke(spec, [issueCon('- regla que YA está en el issue')], ['--reconcile'])
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/reconciliado \(orden #1\): .*contexto del epic/)
  })
})

// ============================================================================
// REVIEW FINAL DE RAMA — I2: ct-groom.mjs lee el spec sin normalizar, y
// `readEpicContext` es el primer valor MULTI-LÍNEA derivado del spec que llega
// a un cuerpo (las celdas de la tabla van todas por `trim`, así que esta
// exposición es nueva de esta rama). Un spec en CRLF metía `\r` dentro del
// body, y como diffIssue/buildReconcileBody comparan texto ya normalizado a LF
// contra un valor con `\r`, no podían coincidir NUNCA: una `nota:` en cada
// corrida, para siempre, y una escritura en cada corrida, para siempre.
// ============================================================================
describe('I2 — un spec en CRLF no mete \\r en el cuerpo de los issues', () => {
  const crlf = (...lineas) => lineas.join('\r\n')

  it('el contenido sale en LF puro', () => {
    const r = readEpicContext(crlf('# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## 9. Slices'))
    expect(r.content).toBe('- regla A\n- regla B')
    expect(r.content).not.toContain('\r')
  })

  it('el texto leído de un spec CRLF y el del MISMO spec en LF son idénticos', () => {
    const lineas = ['# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## 9. Slices']
    expect(readEpicContext(lineas.join('\r\n')).content).toBe(readEpicContext(lineas.join('\n')).content)
  })

  it('no converge nunca: el mismo texto no puede quedar en divergencia perpetua', () => {
    const contexto = readEpicContext(crlf('# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## 9. Slices')).content
    const body = [SPEC_LINK_3, '', EPIC_CONTEXT_HEADING, '- regla A', '- regla B', '', '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1', '', '## Out of scope / Protected', '- 🚫 nada'].join('\n')
    const wanted = { specLink: SPEC_LINK_3, ac: ['AC-1'], deps: [], epicContext: contexto }
    expect(buildReconcileBody(body, wanted).body).toBeNull() // segunda corrida: nada que escribir
  })

  // El guardarraíl tiene que ver el spec CRLF igual que el LF. Sin normalizar,
  // ATX_HEADING_RE no reconoce "##\r" como cabecera: la sección no termina ahí
  // y se traga el resto del fichero — el mismo daño que C3, por otra puerta.
  it('una cabecera desnuda en un spec CRLF termina la sección, no se la traga', () => {
    const r = readEpicContext(crlf('# Spec', '', EPIC_CONTEXT_HEADING, '- regla A', '', '##', 'texto de otra sección'))
    expect(r.content).toBe('- regla A')
    expect(r.warnings).toEqual([])
  })
})

// ============================================================================
// REVIEW FINAL DE RAMA (menor) — al INSERTAR la sección del epic que falta (un
// issue anterior a F26), el único ancla era "## Acceptance criteria", así que
// la sección aterrizaba DESPUÉS de "## Contexto heredado" e invertía el orden
// que fija el §3.4 del diseño (epic → heredado → criterios). Reproducido.
// ============================================================================
describe('la inserción respeta el orden del §3.4', () => {
  const sinEpic = [
    SPEC_LINK_3, '',
    '## Descripción', 'flow', '',
    INHERITED_CONTEXT_HEADING, 'lo de la coordinadora', '',
    '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1', '',
    '## Out of scope / Protected', '- 🚫 nada',
  ].join('\n')

  it('la sección del epic queda ANTES de la heredada, no después', () => {
    const r = buildReconcileBody(sinEpic, { specLink: SPEC_LINK_3, ac: ['AC-1'], deps: [], epicContext: '- regla' })
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf(INHERITED_CONTEXT_HEADING))
    expect(r.body.indexOf(INHERITED_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf('## Acceptance criteria'))
    expect(extractSectionContent(r.body, EPIC_CONTEXT_HEADING)).toBe('- regla')
    // Y no se ha tocado una sola letra de lo suyo.
    expect(r.body).toContain(`${INHERITED_CONTEXT_HEADING}\nlo de la coordinadora`)
  })

  it('sin sección heredada sigue anclando en Acceptance criteria', () => {
    const sinNinguna = sinEpic.replace(`${INHERITED_CONTEXT_HEADING}\nlo de la coordinadora\n\n`, '')
    const r = buildReconcileBody(sinNinguna, { specLink: SPEC_LINK_3, ac: ['AC-1'], deps: [], epicContext: '- regla' })
    expect(r.body.indexOf(EPIC_CONTEXT_HEADING)).toBeLessThan(r.body.indexOf('## Acceptance criteria'))
    expect(r.body).not.toContain(INHERITED_CONTEXT_HEADING) // nunca se inserta
  })
})

// La propiedad no negociable del §4.4, comprobada end-to-end sobre el binario
// real y en las tres formas en que esta sección puede quedar sin aplicar
// (diverge, está duplicada, se rinde sin ancla). El código de salida se lee de
// spawnSync, nunca a través de una tubería.
describe('§4.4 — el contexto del epic no puede producir un exit 3, pase lo que pase', () => {
  const casos = {
    'diverge y se aplica': buildIssueBody(SLICE_1, SPEC_REF_E2E, '- regla VIEJA'),
    'está duplicada en el cuerpo': buildIssueBody(SLICE_1, SPEC_REF_E2E, '- regla VIEJA')
      .replace(INHERITED_CONTEXT_HEADING, `${EPIC_CONTEXT_HEADING}\n- una copia pegada\n\n${INHERITED_CONTEXT_HEADING}`),
  }
  for (const [nombre, body] of Object.entries(casos)) {
    it(`${nombre}: exit 0, y ninguna línea de "divergencia:" por esta sección`, () => {
      const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
      for (const args of [[], ['--reconcile'], ['--dry-run', '--reconcile']]) {
        const res = invoke(specConContexto('- regla NUEVA'), [issue], args)
        expect(res.status, `${nombre} con ${args.join(' ') || '(sin flags)'}`).toBe(0)
        expect(res.stderr).not.toMatch(new RegExp(`divergencia:.*${EPIC_CONTEXT_HEADING}`))
      }
    })
  }

  // El tercer caso —una valla sin cerrar DENTRO de la sección del epic en el
  // cuerpo del issue— sí sale 3, y hay que decir por qué, porque no lo causa
  // esta sección: la valla abierta esconde del escáner TODO lo que viene
  // detrás, así que "## Acceptance criteria" deja de existir para quien lee el
  // cuerpo y los criterios salen como divergencia real. El cuerpo está roto de
  // verdad; el 3 es correcto y no viene del contexto del epic, que sigue sin
  // producir ni una línea de "divergencia:".
  it('con la valla abierta el 3 lo produce AC (que deja de ser legible), nunca esta sección', () => {
    const body = buildIssueBody(SLICE_1, SPEC_REF_E2E, '- regla VIEJA\n```js')
    const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
    const res = invoke(specConContexto('- regla NUEVA'), [issue], ['--reconcile'])
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/divergencia:.*criterio de aceptación/)
    expect(res.stderr).not.toMatch(new RegExp(`divergencia:.*${EPIC_CONTEXT_HEADING}`))
    // Y no se ha escrito nada en la sección del epic: se ha dicho por qué.
    expect(res.stderr).toMatch(/nota:.*NO ha reescrito la sección "## Contexto del epic".*SIN CERRAR/s)
  })
})

// ============================================================================
// SEGUNDA OLEADA — Importante: la línea de éxito de la corrida REAL afirmaba
// lo que el código se había NEGADO a hacer. Usaba `driftCategories` (lo que
// DIVERGE) donde el preview de --dry-run ya usaba `bodyDriftCategories` (lo
// que se ESCRIBIÓ), así que preview y corrida real se contradecían y la
// afirmación falsa caía por stdout, el canal que este script reserva para lo
// que de verdad ha pasado.
// ============================================================================

describe('la línea de "reconciliado" nombra lo que se escribió, no lo que diverge', () => {
  const dosVecesElEpic = (epicContext) =>
    `${buildIssueBody(SLICE_1, SPEC_REF_E2E, epicContext)}\n\n${EPIC_CONTEXT_HEADING}\n- copia pegada`

  it('con la sección del epic duplicada, stdout no dice que la reconcilió', () => {
    const issue = {
      number: 501, title: '#1 login MAL', state: 'open', milestone: { title: 'Epic' },
      labels: LABELS_1, body: dosVecesElEpic('- regla VIEJA'),
    }
    const res = invoke(specConContexto('- regla NUEVA'), [issue], ['--reconcile'])
    // stderr ya decía la verdad: no se ha reescrito.
    expect(res.stderr).toMatch(/nota:.*NO ha reescrito la sección "## Contexto del epic"/)
    // stdout no puede decir lo contrario en la misma corrida.
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\): título/)
    expect(res.stdout).not.toMatch(/reconciliado \(orden #1\):.*contexto del epic/)
  })

  it('lo mismo para AC: una sección duplicada no se reporta como reconciliada', () => {
    const conAcDuplicada = [
      buildIssueBody({ ...SLICE_1, ac: ['AC-1.1 VIEJO'] }, SPEC_REF_E2E, null),
      '',
      '## Acceptance criteria (EARS, 1:1 con tests)',
      '- AC-1.1 copia pegada',
    ].join('\n')
    const issue = {
      number: 501, title: '#1 login MAL', state: 'open', milestone: { title: 'Epic' },
      labels: LABELS_1, body: conAcDuplicada,
    }
    const spec = ['## 9. Slices', ONE_SLICE_TABLE, ''].join('\n')
    const res = invoke(spec, [issue], ['--reconcile'])
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\): título/)
    expect(res.stdout).not.toMatch(/reconciliado \(orden #1\):.*criterios de aceptación/)
  })
})

// ============================================================================
// SEGUNDA OLEADA — C2, la mitad que quedaba abierta: la cabecera pegada ÚNICA.
//
// La primera oleada cerró el caso DUPLICADO (`seccionSpliceable` se rinde si la
// cabecera aparece dos veces). Queda el caso en el que el issue NO tiene esa
// sección propia, así que la copia pegada por la coordinadora es la única del
// body: la cuenta es 1, y el splice se aplicaba dentro de su texto. El borrado
// corre hasta la SIGUIENTE cabecera ATX, así que se lleva por delante toda la
// prosa que ella escribiera después de lo pegado, no sólo lo pegado.
//
// El arreglo amplía la zona prohibida: termina en "## Acceptance criteria" (la
// cabecera que buildIssueBody emite SIEMPRE justo detrás de la heredada), no en
// la primera cabecera ATX que aparezca — que, dentro de la sección heredada,
// puede ser la que ella pegó.
// ============================================================================

// Sin sección propia de Dependencias ni de Contexto del epic: lo pegado es la
// ÚNICA copia de esa cabecera en todo el body.
const PEGADO_UNICO = (pegado) => [
  SPEC_LINK_3,
  '',
  '## Descripción',
  'flow',
  '',
  INHERITED_CONTEXT_HEADING,
  'El slice #2 dejó montado el endpoint. Copio lo suyo:',
  '',
  ...pegado,
  '',
  FIN_DEL_PEGADO,
  '',
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- AC-3.1 VIEJO',
  '',
  '## Out of scope / Protected',
  '- 🚫 nada',
  '',
  '<!-- ct-order:3 -->',
].join('\n')

describe('C2 (2ª oleada) — la cabecera pegada ÚNICA tampoco es objetivo del splice', () => {
  it('"## Dependencias" pegada y el spec pasa a pedir una dep: su texto sobrevive byte a byte', () => {
    const body = PEGADO_UNICO(['## Dependencias', '- merge-after `#1`'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [2], epicContext: null })
    const resultado = r.body ?? body
    expect(resultado).toContain(FIN_DEL_PEGADO) // su prosa POSTERIOR a lo pegado
    expect(trozo(resultado, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
    // Y se dice: nada de rendirse en silencio y dejar que el caller lo reporte
    // como aplicado.
    expect(r.unresolvedDeps).toBe(true)
  })

  it('"## Contexto del epic" pegada en un issue anterior a F26: su texto sobrevive byte a byte', () => {
    const body = PEGADO_UNICO([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [], epicContext: '- regla NUEVA' })
    const resultado = r.body ?? body
    expect(resultado).toContain(FIN_DEL_PEGADO)
    expect(trozo(resultado, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, '## Acceptance criteria'))
    // La sección que le falta al issue se inserta en SU sitio (§3.4: antes de
    // la heredada), no encima de la copia de ella.
    expect(resultado.indexOf(`${EPIC_CONTEXT_HEADING}\n- regla NUEVA`)).toBeLessThan(resultado.indexOf(INHERITED_CONTEXT_HEADING))
  })

  it('la protección del caso DUPLICADO sigue en pie (no se cambia una por otra)', () => {
    const body = CON_PEGADO(['## Dependencias', '- merge-after `#1`'])
    const r = buildReconcileBody(body, { ...WANTED_3, deps: [2, 5] })
    const resultado = r.body ?? body
    expect(trozo(resultado, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
      .toBe(trozo(body, INHERITED_CONTEXT_HEADING, FIN_DEL_PEGADO))
    expect(r.unresolvedDeps).toBe(true)
  })
})

// El caso del epic converge, y eso hay que fijarlo: la copia insertada queda
// POR DELANTE de la que pegó la coordinadora, así que la pasada siguiente lee
// la del plugin como "la primera" y ya no reescribe nada. Sin esta propiedad,
// el arreglo cambiaría un borrado de texto por una reescritura perpetua.
describe('C2 (2ª oleada) — insertar la sección del epic delante de la copia pegada CONVERGE', () => {
  it('la segunda pasada sobre el body ya escrito devuelve body: null', () => {
    const body = PEGADO_UNICO([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const wanted = { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [], epicContext: '- regla NUEVA' }
    const primera = buildReconcileBody(body, wanted)
    expect(primera.body).not.toBeNull()
    expect(buildReconcileBody(primera.body, wanted).body).toBeNull()
  })
})

// El mismo caso, extremo a extremo sobre el binario real: es como se reprodujo
// (exit 0, "reconciliado … contexto del epic" y la prosa de la coordinadora
// desaparecida del `--body` enviado a `gh`). La línea de éxito ahora es cierta
// —la sección SÍ se escribe, en su sitio— y lo que se comprueba es que el body
// que sale por el cable conserva su texto.
describe('C2 (2ª oleada) — extremo a extremo: el --body enviado conserva el texto de la coordinadora', () => {
  it('el `gh issue edit` lleva la sección del epic nueva Y la prosa pegada intacta', () => {
    const dir = makeSpecDir('f26-')
    const spec = join(dir, 'spec.md')
    const argvLog = join(dir, 'argv.log')
    writeFileSync(spec, specConContexto('- regla NUEVA'))
    // Cuerpo de issue anterior a F26 (sin sección del epic propia) con el
    // bloque del vecino pegado dentro de la heredada, y prosa suya detrás.
    const body = [
      `> Slice \`#1\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`, '',
      '## Descripción', 'modelo', '',
      INHERITED_CONTEXT_HEADING,
      'Copio lo del slice anterior:', '',
      EPIC_CONTEXT_HEADING, '- la regla que le tocaba al vecino', '',
      FIN_DEL_PEGADO, '',
      '## Acceptance criteria (EARS, 1:1 con tests)', '- AC-1.1', '',
      '## Out of scope / Protected', '- 🚫 schema', '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
    const res = spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', '--reconcile'], {
      encoding: 'utf8',
      stdio: QUIET_STDIO,
      env: fakeEnv({
        FAKE_GH_MILESTONES_LIST: JSON.stringify([{ title: 'Epic', number: 7 }]),
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[issue]]),
        FAKE_GH_ARGV_LOG_FILE: argvLog,
      }),
    })
    const log = existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : ''
    rmSync(dir, { recursive: true, force: true })
    expect(res.status).toBe(0) // §4.4: esta sección nunca produce un 3
    expect(log).toMatch(/issue edit 501/)
    expect(log).toContain('- regla NUEVA') // la sección del epic, escrita
    expect(log).toContain(FIN_DEL_PEGADO) // y su prosa, intacta — esto es lo que se perdía
    expect(log).toContain('- la regla que le tocaba al vecino') // lo pegado, también
    expect(res.stdout).toMatch(/issue #501 reconciliado \(orden #1\):.*contexto del epic/)
  })
})

// La rendición del contexto del epic tiene que decir lo que SABE. Con la zona
// sin acotar (sin "## Acceptance criteria" localizable) no se puede afirmar que
// la copia sea texto de la coordinadora: sólo que no hay forma de saber dónde
// acaba lo suyo. Es la misma distinción que ya hacía la ruta de Dependencias.
describe('C2 (2ª oleada) — el motivo de la rendición del epic no afirma de quién es el texto', () => {
  const conAcRenombrada = (pegado) => PEGADO_UNICO(pegado)
    .replace('## Acceptance criteria (EARS, 1:1 con tests)', '## Criterios')

  it('zona sin acotar → "zona-sin-fin", no "en-heredado"', () => {
    const body = conAcRenombrada([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: [], deps: [], epicContext: null })
    expect(r.unresolvedEpicContext).toBe('zona-sin-fin')
    expect(r.body).toBeNull() // y el cuerpo no se toca
    expect(body).toContain(FIN_DEL_PEGADO)
  })

  it('con la zona acotada sí se puede afirmar: "en-heredado"', () => {
    const body = PEGADO_UNICO([EPIC_CONTEXT_HEADING, '- la regla que le tocaba al slice #2'])
    const r = buildReconcileBody(body, { specLink: SPEC_LINK_3, ac: ['AC-3.1 VIEJO'], deps: [], epicContext: null })
    expect(r.unresolvedEpicContext).toBe('en-heredado')
  })

  // El motivo se busca por clave directa en EPIC_CONTEXT_SURRENDERS, sin
  // respaldo: uno nuevo sin su frase saldría por stderr como "undefined".
  it('el motivo nuevo tiene su frase: el aviso sale entero y no afirma de quién es el texto', () => {
    const body = [
      `> Slice \`#1\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`, '',
      '## Descripción', 'modelo', '',
      INHERITED_CONTEXT_HEADING, 'Copio lo del vecino:', '',
      EPIC_CONTEXT_HEADING, '- la regla del vecino', '',
      FIN_DEL_PEGADO, '',
      '## Criterios', '- AC-1.1', '',
      '## Out of scope / Protected', '- 🚫 schema', '',
      '<!-- ct-order:1 -->',
    ].join('\n')
    const issue = { number: 501, title: '#1 login', state: 'open', milestone: { title: 'Epic' }, labels: LABELS_1, body }
    const res = invoke(['## 9. Slices', ONE_SLICE_TABLE, ''].join('\n'), [issue], ['--reconcile'])
    expect(res.stderr).toMatch(/NO ha reescrito la sección "## Contexto del epic": no se puede saber dónde termina/)
    expect(res.stderr).not.toMatch(/undefined/)
    // Y no se afirma de quién es el texto, que es lo que este motivo existe para no decir.
    expect(res.stderr).not.toMatch(/NO ha reescrito la sección "## Contexto del epic":[^\n]*pertenece a la sesión coordinadora/)
  })
})
