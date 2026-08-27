import { describe, it, expect } from 'vitest'
import { readFrozenDecisions, FROZEN_DECISIONS_HEADING, buildIssueBody, groomPlan } from '../scripts/groom.js'
import { extractOrder, extractAc, extractDepsInSection, extractStrayDeps } from '../scripts/gh-issue-map.js'
import { renderKickoff } from '../scripts/kickoff.js'

const SLICE = { n: 1, name: 'login', type: 'backend', entrega: '', gate: '', deps: [], ac: ['AC-1.1'], protected: '', area: [], touches: [] }
const SPEC_REF = { path: 'spec.md', heading: null, url: null, reason: 'sin publicar' }

// Formato LITERAL de _TEMPLATE-execution-spec.md, verificado contra
// docs/loop/loop.body.html: la cita del usuario va DENTRO del paréntesis.
const SPEC = `# Epic

## Decisiones congeladas
- **D-1 · versión mínima** — iOS 17. *(Procedencia: hablada — «lo dijo el PO».)*
- **D-2 · nombre** — se llama Pilares. *(Procedencia: deducida de D-1.)*

## 9. Slices
`

describe('readFrozenDecisions', () => {
  it('proyecta la sección con la procedencia quitada de cada línea', () => {
    const { content } = readFrozenDecisions(SPEC)
    expect(content).toBe('- **D-1 · versión mínima** — iOS 17.\n- **D-2 · nombre** — se llama Pilares.')
  })
  it('spec sin la sección → content null y reason ausente', () => {
    const r = readFrozenDecisions('# Epic\n\nnada\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('ausente')
  })
  it('sección presente pero vacía → content null y reason vacia', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n\n## 9. Slices\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('vacia')
  })
  it('una cabecera ### dentro la trunca → content null, reason malformada Y el aviso nombra la línea (I3.2)', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — algo.\n### sub\nmás\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('malformada')
    expect(r.warnings.join('\n')).toContain('### sub') // el aviso nombra la línea ofensora, no solo el reason
  })
  // B2 — fallo de limpieza OBSERVABLE: un sufijo que la regex no casa (aquí, la
  // cursiva con guion bajo) NO viaja en silencio: la sección se proyecta pero
  // con un aviso que nombra la línea donde sobrevive "Procedencia".
  it('sufijo no reconocido → se proyecta CON aviso (no falla mudo)', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — iOS 17. _(Procedencia: hablada.)_\n\n## 9. Slices\n')
    expect(r.content).toContain('iOS 17')
    expect(r.warnings.join('\n')).toMatch(/Procedencia/)
    expect(r.warnings.join('\n')).toContain('- **D-1** — iOS 17.') // nombra la línea
  })
  it('la cabecera se exporta con el literal correcto', () => {
    expect(FROZEN_DECISIONS_HEADING).toBe('## Decisiones congeladas')
  })
  // DeepSeek #1 — data loss: una línea con DOS marcadores no debe borrar el
  // texto entre ellos. Se recorta SOLO el sufijo final; el marcador interior
  // sobrevive y B2 lo avisa (no es un fallo mudo).
  it('línea con dos marcadores → recorta solo el último, no pierde texto, y avisa', () => {
    const spec = '## Decisiones congeladas\n- **D-1** — iOS 17 (fijada *(Procedencia: anterior)*) y re-confirmada *(Procedencia: hablada.)*\n\n## 9. Slices\n'
    const r = readFrozenDecisions(spec)
    expect(r.content).toContain('y re-confirmada') // NO se pierde el texto intermedio
    expect(r.content).not.toContain('hablada.)*')  // el sufijo final sí se recorta
    expect(r.warnings.join('\n')).toMatch(/Procedencia/) // el marcador interior superviviente se avisa
  })
  // DeepSeek #2 — falso positivo: la palabra "Procedencia" en prosa, sin
  // marcador, NO es un fallo de limpieza y no debe avisar.
  it('la palabra "Procedencia" en prosa (sin marcador) no dispara aviso', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — revisar la Procedencia en el acta.\n\n## 9. Slices\n')
    expect(r.content).toContain('revisar la Procedencia en el acta.')
    expect(r.warnings).toEqual([]) // sin marcador, sin aviso
  })
})

describe('buildIssueBody — decisiones congeladas', () => {
  it('emite la sección cuando hay contenido', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    expect(body).toContain('## Decisiones congeladas')
    expect(body).toContain('- **D-1** — iOS 17.')
  })
  it('no emite la sección cuando no hay contenido', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, null)
    expect(body).not.toContain('## Decisiones congeladas')
  })
  it('coloca decisiones tras el contexto del epic y antes del heredado', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, 'contexto común', '- **D-1** — x.')
    expect(body.indexOf('## Contexto del epic')).toBeLessThan(body.indexOf('## Decisiones congeladas'))
    expect(body.indexOf('## Decisiones congeladas')).toBeLessThan(body.indexOf('## Contexto heredado'))
  })
})

describe('groomPlan — decisiones congeladas viajan en el plan', () => {
  it('cada issue lleva frozenDecisions y frozenDecisionsUnknown', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic', specRef: SPEC_REF, frozenDecisions: '- **D-1** — iOS 17.' })
    expect(plan.issues[0].frozenDecisions).toBe('- **D-1** — iOS 17.')
    expect(plan.issues[0].frozenDecisionsUnknown).toBe(false)
    expect(plan.issues[0].body).toContain('## Decisiones congeladas')
  })
  it('reason malformada → frozenDecisionsUnknown true (no es "no tiene")', () => {
    const plan = groomPlan([SLICE], { milestone: 'Epic', specRef: SPEC_REF, frozenDecisions: null, frozenDecisionsReason: 'malformada' })
    expect(plan.issues[0].frozenDecisionsUnknown).toBe(true)
  })
})

describe('buildIssueBody — decisiones con contenido hostil no rompe los extractores (I2/P1)', () => {
  // La prosa mete EL PEOR caso para cada extractor: un ct-order con su cierre
  // "-->" (que una regex laxa casaría), un merge-after, un AC y un closes.
  const HOSTILE = '- **D-1** — respeta el marcador ct-order:99 -->, no toques merge-after #7, mira AC-1.1 y closes #3.'
  it('extractOrder devuelve el orden REAL del slice, no el ct-order:99 --> de la prosa (P1)', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE) // SLICE.n === 1
    expect(extractOrder(body)).toBe(1) // solo casa la LÍNEA "<!-- ct-order:1 -->" del final; NO el 99 con --> de la prosa
  })
  it('extractAc no se traga el AC-1.1 metido en la prosa de la decisión', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE)
    expect(extractAc(body)).toEqual(SLICE.ac) // lee la sección de AC, no la de decisiones
  })
  it('extractDepsInSection lee SOLO "## Dependencias", ajena al merge-after de la prosa', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE)
    expect(extractDepsInSection(body).deps).toEqual([]) // devuelve {deps, malformed}; SLICE no tiene deps y el #7 hostil vive fuera de esa sección
  })
  it('extractStrayDeps SÍ recoge el merge-after #7 de la prosa — ruido conocido y aceptado, no un fallo', () => {
    const body = buildIssueBody(SLICE, SPEC_REF, null, HOSTILE)
    // Documenta la limitación honestamente (spec §7): un merge-after en prosa
    // produce un stray dep. NO mueve el exit code (es nota, no divergencia
    // máquina). Aquí se fija el comportamiento REAL, no uno aspiracional.
    expect(extractStrayDeps(body, [])).toContain(7)
  })
})

describe('kickoff — decisiones congeladas (B1)', () => {
  const slice = { n: 2, name: 'scoring', type: 'backend', deps: [1], ac: ['AC'], gate: '', protected: '' }
  // `conventionsDir` es OBLIGATORIO desde que la vara la dicta ct
  // (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md §7):
  // `renderKickoff` lanza si no lo recibe, porque un kickoff sin la ruta de la
  // vara de ct deja al que planifica escribiendo un plan que el juez va a
  // bloquear, y perderlo en silencio era el fallo que esa guarda cierra. Estos
  // tres tests son de OTRO eje —que el kickoff nombre la sección de decisiones
  // congeladas, su frase de entrada y su destino en el plan— y siguen midiendo
  // exactamente eso: el argumento se pasa para poder llegar a lo que asertan,
  // igual que en el resto de los llamadores de esta función.
  const OPTS = { repo: 'o/r', conventionsDir: '/plugin/conventions' }
  // renderKickoff devuelve el texto del kickoff como una sola cadena.
  it('nombra la sección usando la CONSTANTE, no un literal (I3.9)', () => {
    expect(renderKickoff(slice, OPTS)).toContain(FROZEN_DECISIONS_HEADING)
  })
  it('la enumera como entrada del plan (misma frase que AC/Protegido)', () => {
    const entradaLine = renderKickoff(slice, OPTS).split('\n').find((l) => l.includes('entrada que la skill pide'))
    expect(entradaLine).toBeDefined()
    expect(entradaLine).toContain(FROZEN_DECISIONS_HEADING)
  })
  it('nombra el destino ## 2. Closed decisions', () => {
    expect(renderKickoff(slice, OPTS)).toContain('## 2. Closed decisions')
  })
})
