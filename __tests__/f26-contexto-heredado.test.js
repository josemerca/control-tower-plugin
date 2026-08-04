import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
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

  it('sin Acceptance criteria como ancla, NO inserta nada y no revienta', () => {
    const sinAncla = [
      '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)',
      '',
      INHERITED_CONTEXT_HEADING,
      'lo de la coordinadora',
    ].join('\n')
    const r = buildReconcileBody(sinAncla, wanted({ ac: [] }))
    expect(r.body === null || !r.body.includes(EPIC_CONTEXT_HEADING)).toBe(true)
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

  // Un cuerpo sin "## Acceptance criteria" (un humano la borró) y sin la
  // sección del epic: no hay dónde insertarla en su sitio. La tabla no pide
  // ningún criterio, así que AC no diverge y no hay ningún gap que sí cuente.
  const SIN_ANCLA_BODY = [
    `> Slice \`#1\` del epic. Spec: [spec.md § 9. Slices](${specUrl('spec.md')})`,
    '',
    '## Descripción',
    'modelo',
    '',
    INHERITED_CONTEXT_HEADING,
    'lo de la coordinadora',
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
    expect(res.stderr).toMatch(/Acceptance criteria.*ancla/)
    expect(res.stderr).not.toMatch(/aplicaría/) // no hay body nuevo: no se anuncia ninguna escritura
  })

  it('la sección heredada sigue intacta y sin compararse', () => {
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
