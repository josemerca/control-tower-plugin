import { describe, it, expect } from 'vitest'
import {
  EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, INHERITED_CONTEXT_PLACEHOLDER,
  readEpicContext, buildIssueBody, groomPlan,
} from '../scripts/groom.js'

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
