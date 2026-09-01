import { describe, it, expect } from 'vitest'
import { buildStateSeed, renderKickoff } from '../scripts/kickoff.js'
import { parseStateSafe } from '../scripts/state.js'
import { buildIssueBody } from '../scripts/groom.js'
import { mapGhIssue } from '../scripts/gh-issue-map.js'
import { newRun } from '../scripts/run-machine.js'

const slice = (e2e) => ({
  n: 5, issue: '#12', name: 'exposición', type: 'backend', entrega: '', gate: '–',
  deps: [], ac: ['x'], protected: '', area: ['core'], touches: [], e2e,
  gates: ['plan', 'e2e'], gatesDeclared: true,
})

describe('la semilla lleva los recorridos', () => {
  it('el campo e2e es una LISTA, no una frase', () => {
    const md = buildStateSeed(slice('uno, dos'), { branch: 'feat/5', base: 'main', baseSha: 'abc' })
    const { meta } = parseStateSafe(md)
    expect(meta.e2e).toEqual(['uno', 'dos'])
  })

  it('sin recorridos, el campo es una lista vacía y no desaparece', () => {
    const { meta } = parseStateSafe(buildStateSeed(slice('no'), { branch: 'feat/5', base: 'main', baseSha: 'abc' }))
    expect(meta.e2e).toEqual([])
  })

  it('el kickoff nombra los recorridos y manda cerrarlos con ct-step e2e', () => {
    const k = renderKickoff(slice('curl -i :9115/metrics responde 200'), { repo: 'o/r', dispatchCheckPath: 'd.mjs', base: 'main' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain('curl -i :9115/metrics responde 200')
    expect(k).toMatch(/ct-step e2e/)
  })

  it('sin recorridos, el kickoff no habla de e2e', () => {
    const k = renderKickoff(slice('no'), { repo: 'o/r', dispatchCheckPath: 'd.mjs', base: 'main' , conventionsDir: '/plugin/conventions' })
    expect(k).not.toMatch(/ct-step e2e/)
  })
})

// Propiedad end-to-end (T9, el brief la pide explícitamente): la cadena
// entera "celda del spec -> sección del issue -> .agent/SLICE.md ->
// newRun({e2eRuns})" no tenía ningún test que la recorriera de un tirón.
// Cualquiera de sus tres primeros tramos (resolveE2e, buildIssueBody/
// mapGhIssue, buildStateSeed) puede renombrar su campo sin que ningún test de
// unidad se entere — este es el que sí lo notaría.
//
// EL CUARTO TRAMO, OJO: el test de abajo llama a `newRun` DIRECTAMENTE con
// `e2eRuns: meta.e2e` — comprueba que `newRun` acepta y guarda ese parámetro,
// no que `ct-step.mjs` (línea 221, `newRun({ ..., e2eRuns: sliceMeta.e2e })`)
// siga leyendo el campo correcto de `sliceMeta`. Un renombrado de ESA línea no
// lo detectaría este test: haría falta ejecutar el binario, no la función.
describe('cadena completa: celda del spec -> sección del issue -> SLICE.md -> newRun (T9, propiedad end-to-end)', () => {
  it('un recorrido con coma escapada en el spec sobrevive el viaje entero hasta run.e2eRuns', () => {
    // 1. La celda cruda del spec, con una coma ESCAPADA dentro del propio
    // recorrido (no separando dos recorridos) — el caso que resolveE2e/
    // splitEscapedCommas existen para no partir en dos.
    const specSlice = {
      n: 9, entrega: 'expone métricas', ac: ['AC-9.1 expone /metrics'], deps: [], protected: '–',
      e2e: 'curl -i :9115/metrics responde 200\\, sin auth',
    }
    const specRef = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }

    // 2. /ct-groom escribe el body del issue: la sección "## E2E" con el
    // recorrido YA resuelto (la coma escapada, ya una coma literal).
    const body = buildIssueBody(specSlice, specRef)
    expect(body).toContain('## E2E')
    expect(body).toContain('- curl -i :9115/metrics responde 200, sin auth')

    // 3. /ct-next reconstruye el slice DESDE EL ISSUE (nunca abre el spec):
    // mapGhIssue extrae esa misma sección a `e2eRuns`.
    const issueSlice = mapGhIssue({
      number: 9, title: '#9 expone métricas',
      labels: [{ name: 'status:ready' }, { name: 'type:backend' }],
      body,
    })
    expect(issueSlice.e2eRuns).toEqual(['curl -i :9115/metrics responde 200, sin auth'])

    // 4. buildStateSeed siembra ese array en .agent/SLICE.md — parseStateSafe
    // es el mismo lector que usa ct-step.mjs.
    const seed = buildStateSeed(issueSlice, { branch: 'feat/9', base: 'main', baseSha: 'deadbeef' })
    const { meta } = parseStateSafe(seed)
    expect(meta.e2e).toEqual(['curl -i :9115/metrics responde 200, sin auth'])

    // 5. ct-step.mjs (línea 221) pasa `sliceMeta.e2e` como `e2eRuns` a
    // newRun — el punto de consumo real que Task 8 ya dejó construido.
    const run = newRun({ plan: 'docs/plan.md', issue: 9, baseSha: 'deadbeef', tasksTotal: 1, e2eRuns: meta.e2e })
    expect(run.e2eRuns).toEqual(['curl -i :9115/metrics responde 200, sin auth'])
  })

  it('sin recorridos en el spec, la cadena entera da `[]` en cada tramo (nunca `undefined`)', () => {
    const specSlice = { n: 10, entrega: 'x', ac: ['AC-10.1'], deps: [], protected: '–', e2e: 'no' }
    const specRef = { path: 'spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/spec.md#9-slices', reason: null }
    const body = buildIssueBody(specSlice, specRef)
    // groom.js#buildIssueBody omite la sección ENTERA cuando no hay recorridos.
    expect(body).not.toContain('## E2E')

    const issueSlice = mapGhIssue({
      number: 10, title: '#10 x',
      labels: [{ name: 'status:ready' }, { name: 'type:backend' }],
      body,
    })
    expect(issueSlice.e2eRuns).toEqual([])

    const seed = buildStateSeed(issueSlice, { branch: 'feat/10', base: 'main', baseSha: 'deadbeef' })
    const { meta } = parseStateSafe(seed)
    expect(meta.e2e).toEqual([])

    const run = newRun({ plan: 'docs/plan.md', issue: 10, baseSha: 'deadbeef', tasksTotal: 1, e2eRuns: meta.e2e })
    expect(run.e2eRuns).toEqual([])
  })
})
