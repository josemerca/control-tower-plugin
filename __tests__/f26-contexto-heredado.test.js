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
