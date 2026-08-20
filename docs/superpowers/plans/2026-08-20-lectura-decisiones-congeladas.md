# Lectura de decisiones congeladas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las decisiones congeladas del spec (`## Decisiones congeladas`) lleguen al cuerpo de cada issue del epic como prosa que el agente lee, sin que un humano las copie a mano.

**Architecture:** `## Decisiones congeladas` recibe **el mismo trato que `## Contexto del epic`** (transporte del spec al issue + reconciliación), a imagen y semejanza de esa maquinaria ya probada. Única diferencia: al proyectar se le quita la procedencia. Fase «que las lea»; el cumplimiento queda fuera (ver spec §8).

**Tech Stack:** Node ESM, Vitest. Tests puros por import directo; la proyección E2E se prueba spawneando `ct-groom.mjs --dry-run`.

**Spec:** `docs/superpowers/specs/2026-08-18-lectura-decisiones-congeladas-design.md`

**Ficheros:** modifica `scripts/groom.js`, `scripts/ct-groom.mjs`, `scripts/reconcile.js`, `scripts/kickoff.js`, `commands/ct-groom.md`; crea `__tests__/decisiones-congeladas.test.js`, `__tests__/ct-groom-decisiones.test.js`, `__tests__/reconcile-decisiones.test.js`.

**Regla de estilo (del usuario, no negociable):** todo a imagen y semejanza de lo existente. Cada pieza es el espejo de su equivalente de `## Contexto del epic`, con los mismos comentarios que explican el porqué. Todos los edits son **aditivos** (constante nueva, función nueva, un parámetro más en firmas existentes) — no se reemplaza lógica.

---

## Task 1: `readFrozenDecisions` + constante (groom.js)

**Files:**
- Modify: `scripts/groom.js` (constante junto a `EPIC_CONTEXT_HEADING`; función tras `readEpicContext`, ~línea 200)
- Test: `__tests__/decisiones-congeladas.test.js` (crear)

- [ ] **Step 1: Write the failing test**

Crea `__tests__/decisiones-congeladas.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { readFrozenDecisions, FROZEN_DECISIONS_HEADING } from '../scripts/groom.js'

const SPEC = `# Epic

## Decisiones congeladas
- **D-1 · versión mínima** — iOS 17. *(Procedencia: hablada.)*
- **D-2 · nombre** — se llama Pilares. *(Procedencia: deducida.)*

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
  it('una cabecera ### dentro la trunca → content null y reason malformada', () => {
    const r = readFrozenDecisions('## Decisiones congeladas\n- **D-1** — algo.\n### sub\nmás\n')
    expect(r.content).toBe(null)
    expect(r.reason).toBe('malformada')
  })
  it('la cabecera se exporta con el literal correcto', () => {
    expect(FROZEN_DECISIONS_HEADING).toBe('## Decisiones congeladas')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/decisiones-congeladas.test.js`
Expected: FAIL — `readFrozenDecisions`/`FROZEN_DECISIONS_HEADING` no exportados.

- [ ] **Step 3: Add the constant**

En `scripts/groom.js`, justo después de `export const INHERITED_CONTEXT_HEADING = '## Contexto heredado'` (línea 27):

```javascript
// FROZEN_DECISIONS_HEADING: la sección de decisiones congeladas del spec, que
// groom proyecta al cuerpo de cada issue del epic. Mismo trato que
// EPIC_CONTEXT_HEADING (del spec, idéntica en todos los issues, reconciliada),
// con una sola diferencia: al proyectar se le quita la procedencia de cada
// línea (ver readFrozenDecisions). Constante exportada por el mismo motivo que
// las de al lado: la nombran el que la escribe, el que la compara y sus tests.
// Es la MISMA cadena en el fichero de spec y en el cuerpo del issue.
export const FROZEN_DECISIONS_HEADING = '## Decisiones congeladas'
```

- [ ] **Step 4: Add `readFrozenDecisions`**

En `scripts/groom.js`, justo después del cierre de `readEpicContext` (tras la línea 200):

```javascript
// PROCEDENCIA_SUFFIX_RE: el sufijo "*(Procedencia: …)*" que la plantilla de
// decisiones escribe al final de cada línea. Es meta para quien CONGELA
// (hablada | deducida | propuesta), no para quien EJECUTA: al agente le da
// igual el origen — la decisión le vincula igual —, así que se quita al
// proyectar. No es un parser: no se clasifica, no se filtra por valor, solo se
// recorta el sufijo. La regla "una propuesta no se congela" es
// responsabilidad del autor, como los [NEEDS CLARIFICATION] de la puerta de
// congelación.
const PROCEDENCIA_SUFFIX_RE = /\s*\*\(Procedencia:.*?\)\*\s*$/i

// readFrozenDecisions: espejo de readEpicContext para "## Decisiones
// congeladas". Misma silueta —localiza por texto de cabecera, mismos cuatro
// casos de "no hay texto" con su reason, mismos guardarraíles de delimitador
// sin cerrar y de truncamiento—, con UNA diferencia: el contenido se devuelve
// ya sin la procedencia de cada línea. Reusa EPIC_CONTEXT_REASONS porque los
// motivos son agnósticos de la sección (ausente/vacía autorizan a --reconcile
// a retirar; malformada no autoriza nada).
export function readFrozenDecisions(specMd) {
  const warnings = []
  const src = normalizeToLF(specMd || '')
  const loc = locateSection(src, FROZEN_DECISIONS_HEADING)
  if (!loc) {
    warnings.push(`aviso: el spec no trae la sección "${FROZEN_DECISIONS_HEADING}" — ningún issue de este epic lleva decisiones congeladas (ni el que se cree ahora, ni el que ya exista: con --reconcile la sección se retira del cuerpo). Si lo quieres, añade esa sección al spec, fuera de la tabla de slices, y vuelve a correr.`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.ABSENT, warnings }
  }
  const abierto = unterminatedDelimiter(loc.content)
  if (abierto) {
    const que = abierto === 'valla' ? 'una valla de código (```) sin cerrar' : 'un comentario HTML (<!--) sin cerrar'
    warnings.push(`aviso: la sección "${FROZEN_DECISIONS_HEADING}" del spec contiene ${que} y por eso NO se emite en ningún issue. Sin el cierre, la sección no termina donde parece: se traga todo lo que venga detrás en el spec (la tabla de slices incluida) y ese texto acabaría en el cuerpo de todos los issues. Cierra el delimitador y vuelve a correr. ${MALFORMED_KEEPS_WHAT_IS_THERE}`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.MALFORMED, warnings }
  }
  const truncating = truncationLine(src, loc)
  if (truncating) {
    warnings.push(`aviso: la sección "${FROZEN_DECISIONS_HEADING}" del spec contiene ("${truncating}") y por eso NO se emite en ningún issue. La sección se reescribe entera desde el spec: el reemplazo termina en la primera cosa que corta la sección (cabecera de cualquier nivel, comentario HTML, etc.), así que nada que corte puede vivir dentro. ${MALFORMED_KEEPS_WHAT_IS_THERE}`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.MALFORMED, warnings }
  }
  const content = loc.content.trim()
  if (!content) {
    warnings.push(`aviso: la sección "${FROZEN_DECISIONS_HEADING}" del spec está presente pero sin contenido — se trata igual que si no estuviera, o sea que ningún issue lleva decisiones congeladas (y con --reconcile la sección se retira del cuerpo de los que ya la tengan). Escribe algo debajo de la cabecera, o quítala.`)
    return { content: null, reason: EPIC_CONTEXT_REASONS.EMPTY, warnings }
  }
  // La única diferencia con readEpicContext: se quita la procedencia de cada
  // línea. Se hace sobre el contenido YA validado (tras los guardarraíles): los
  // guardarraíles miran la sección cruda; la limpieza solo afecta a lo que se
  // proyecta al cuerpo.
  const cleaned = content.split('\n').map((l) => l.replace(PROCEDENCIA_SUFFIX_RE, '')).join('\n')
  return { content: cleaned, reason: null, warnings }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/decisiones-congeladas.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/groom.js __tests__/decisiones-congeladas.test.js
git commit -m "feat: readFrozenDecisions — lee ## Decisiones congeladas del spec sin procedencia"
```

---

## Task 2: `buildIssueBody` emite la sección + `groomPlan` la lleva (groom.js)

**Files:**
- Modify: `scripts/groom.js` (`buildIssueBody` ~409-465; `groomPlan` ~487-532)
- Test: `__tests__/decisiones-congeladas.test.js` (añadir)

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/decisiones-congeladas.test.js`:

```javascript
import { buildIssueBody } from '../scripts/groom.js'

const SLICE = { n: 1, name: 'login', type: 'backend', entrega: '', gate: '', deps: [], ac: ['AC-1.1'], protected: '', area: [], touches: [] }
const SPEC_REF = { path: 'spec.md', heading: null, url: null, reason: 'sin publicar' }

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/decisiones-congeladas.test.js -t "decisiones congeladas"`
Expected: FAIL — `buildIssueBody` ignora el 4º argumento.

- [ ] **Step 3: Cambiar la firma de `buildIssueBody` y emitir la sección**

En `scripts/groom.js`, cambia la firma (línea 409):

```javascript
export function buildIssueBody(slice, specRef, epicContext = null, frozenDecisions = null) {
```

Y justo DESPUÉS del bloque `if (epicContext) { … }` (el que empuja `EPIC_CONTEXT_HEADING`, termina en la línea 439) y ANTES de `lines.push(INHERITED_CONTEXT_HEADING)` (línea 440), añade:

```javascript
  // Decisiones congeladas: mismo trato que el contexto del epic (del spec,
  // reconciliada) y por eso emitida aquí mismo, justo detrás. Sección propia
  // —no dentro de "## Contexto del epic"— y solo si hay contenido. Con esto el
  // orden del cuerpo pasa a ser epic → decisiones → heredado → criterios.
  if (frozenDecisions) {
    lines.push(FROZEN_DECISIONS_HEADING)
    lines.push(frozenDecisions)
    lines.push('')
  }
```

- [ ] **Step 4: `groomPlan` lee y lleva `frozenDecisions`**

En `scripts/groom.js`, cambia la firma de `groomPlan` (línea 487) para añadir dos campos al objeto destructurado:

```javascript
export function groomPlan(slices, { milestone, specRef, epicContext = null, epicContextReason = null, frozenDecisions = null, frozenDecisionsReason = null }) {
```

Justo después de `const epicContextUnknown = epicContextReason === EPIC_CONTEXT_REASONS.MALFORMED` (línea 493), añade:

```javascript
  // frozenDecisionsUnknown (espejo de epicContextUnknown): "no se pudo leer un
  // texto válido" NO es "el epic no tiene decisiones". Sin esta distinción,
  // frozenDecisions: null viajaría igual en los dos casos y buildReconcileBody
  // lo leería siempre como "retira la sección".
  const frozenDecisionsUnknown = frozenDecisionsReason === EPIC_CONTEXT_REASONS.MALFORMED
```

En la construcción del body (línea 503), pasa el 4º argumento:

```javascript
      body: buildIssueBody(s, specRef, epicContext, frozenDecisions),
```

Y en el objeto de cada issue, justo después de `epicContext,` y `epicContextUnknown,` (líneas 528-529), añade:

```javascript
      // Las decisiones viajan en el plan, no solo dentro del body ya
      // renderizado, por el mismo motivo que epicContext: para que comparar
      // este slice contra un issue existente no obligue a re-parsear el cuerpo
      // recién generado, y para que el JSON del --dry-run las muestre.
      frozenDecisions,
      frozenDecisionsUnknown,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/decisiones-congeladas.test.js`
Expected: PASS (8 tests).

- [ ] **Step 6: Regression**

Run: `npx vitest run __tests__/groom.test.js`
Expected: PASS (la sección solo se emite con contenido; sin él, body idéntico al de hoy).

- [ ] **Step 7: Commit**

```bash
git add scripts/groom.js __tests__/decisiones-congeladas.test.js
git commit -m "feat: buildIssueBody emite ## Decisiones congeladas; groomPlan la lleva"
```

---

## Task 3: Wiring en `ct-groom.mjs` (auto-proyección al crear)

**Files:**
- Modify: `scripts/ct-groom.mjs` (import línea 19; lectura tras 518; llamada a `groomPlan` 528)
- Test: `__tests__/ct-groom-decisiones.test.js` (crear)

- [ ] **Step 1: Write the failing test**

Crea `__tests__/ct-groom-decisiones.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = () => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` })
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

function runGroom(specMd) {
  const dir = makeSpecDir('ctg-dec-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specMd)
  try {
    return { status: 0, stdout: execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() }) }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  } finally {
    rmSyncBestEffort(dir)
  }
}

const HYP = '## Hipótesis\n\nApuesta del fixture.\n\n'
const TABLE = `## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

describe('ct-groom --dry-run — decisiones congeladas', () => {
  it('proyecta la sección al cuerpo, sin la procedencia', () => {
    const DEC = '## Decisiones congeladas\n- **D-1 · versión** — iOS 17. *(Procedencia: hablada.)*\n\n'
    const r = runGroom(HYP + DEC + TABLE)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('## Decisiones congeladas')
    expect(r.stdout).toContain('iOS 17')
    expect(r.stdout).not.toContain('Procedencia')
  })
  it('sin la sección, el cuerpo no la lleva', () => {
    const r = runGroom(HYP + TABLE)
    expect(r.status).toBe(0)
    expect(r.stdout).not.toContain('## Decisiones congeladas')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ct-groom-decisiones.test.js`
Expected: FAIL — el cuerpo del dry-run no lleva la sección (ct-groom no lee la sección todavía).

- [ ] **Step 3: Import aditivo**

En `scripts/ct-groom.mjs`, línea 19, añade `readFrozenDecisions` a la lista del import desde `./groom.js`:

```javascript
import { groomPlan, readEpicContext, readFrozenDecisions, EPIC_CONTEXT_HEADING, analyzeSpecFreeze, HYPOTHESIS_REASONS } from './groom.js'
```

- [ ] **Step 4: Leer la sección y pasarla a `groomPlan`**

Justo después del bloque de `readEpicContext` (líneas 517-518), añade:

```javascript
// Decisiones congeladas: mismo tratamiento que el contexto del epic — se lee
// del spec por su cabecera y sus avisos se imprimen aquí, sin abortar nunca (un
// spec sin la sección es válido; el remedio va dentro del aviso).
const { content: frozenDecisions, reason: frozenDecisionsReason, warnings: frozenDecisionsWarnings } = readFrozenDecisions(specMd)
for (const w of frozenDecisionsWarnings) console.error(w)
```

Y en la llamada a `groomPlan` (línea 528), añade los dos campos:

```javascript
  plan = groomPlan(slices, { milestone, specRef, epicContext, epicContextReason, frozenDecisions, frozenDecisionsReason })
```

- [ ] **Step 5: Run test + regression**

Run: `npx vitest run __tests__/ct-groom-decisiones.test.js __tests__/ct-groom-dryrun.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-groom.mjs __tests__/ct-groom-decisiones.test.js
git commit -m "feat: ct-groom lee ## Decisiones congeladas y la proyecta al crear"
```

---

## Task 4: Recordatorio en el kickoff (kickoff.js)

**Files:**
- Modify: `scripts/kickoff.js` (import línea 11; array de `renderKickoff`, tras línea 243)
- Test: `__tests__/decisiones-congeladas.test.js` (añadir)

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/decisiones-congeladas.test.js`:

```javascript
import { renderKickoff } from '../scripts/kickoff.js'

describe('kickoff — decisiones congeladas', () => {
  it('nombra la sección ## Decisiones congeladas', () => {
    const slice = { n: 2, name: 'scoring', type: 'backend', deps: [1], ac: ['AC'], gate: '', protected: '' }
    const lines = renderKickoff(slice, { repo: 'o/r' })
    expect(lines.join('\n')).toContain('## Decisiones congeladas')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/decisiones-congeladas.test.js -t "kickoff"`
Expected: FAIL — el kickoff no nombra la sección.

- [ ] **Step 3: Import aditivo**

En `scripts/kickoff.js`, línea 11, añade `FROZEN_DECISIONS_HEADING` al import desde `./groom.js`:

```javascript
import { EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING } from './groom.js'
```

- [ ] **Step 4: Añadir la línea al array de `renderKickoff`**

En el array que devuelve `renderKickoff`, inmediatamente DESPUÉS de la línea que empieza por `` `Lee también las secciones "${EPIC_CONTEXT_HEADING}" `` (línea 243), añade un nuevo elemento:

```javascript
    `Lee también la sección "${FROZEN_DECISIONS_HEADING}" del issue: son decisiones del epic con consecuencia sobre este trabajo, que DEBES respetar (no las reinterpretes ni las cambies). Si no aparece, no hay ninguna — no la busques fuera del issue.`,
```

- [ ] **Step 5: Run test + regression**

Run: `npx vitest run __tests__/decisiones-congeladas.test.js __tests__/kickoff.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/kickoff.js __tests__/decisiones-congeladas.test.js
git commit -m "feat: el kickoff nombra la sección ## Decisiones congeladas"
```

---

## Task 5: Comparación en reconcile — `diffIssue` + `DUPLICATE_CHECKS` + `formatDrift`

**Files:**
- Modify: `scripts/reconcile.js` (import línea 100; `DUPLICATE_CHECKS` ~207-225; `diffIssue` ~332-386; `formatDrift` ~519)
- Test: `__tests__/reconcile-decisiones.test.js` (crear)

- [ ] **Step 1: Write the failing test**

Crea `__tests__/reconcile-decisiones.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { diffIssue, formatDrift } from '../scripts/reconcile.js'
import { groomPlan, buildIssueBody } from '../scripts/groom.js'

const SPEC_REF = { path: 'spec.md', heading: null, url: null, reason: 'sin publicar' }
const SLICE = { n: 1, name: 'login', type: 'backend', entrega: '', gate: '', deps: [], ac: ['AC-1.1'], protected: 'schema', area: [], touches: [] }

// wanted: el issue que el plan dice que ESTE slice debería tener, con las
// decisiones que se le pasen (y opcionalmente contexto del epic / reason).
function wanted(frozenDecisions, opts = {}) {
  const plan = groomPlan([SLICE], {
    milestone: 'Epic', specRef: SPEC_REF,
    epicContext: opts.epicContext ?? null,
    frozenDecisions, frozenDecisionsReason: opts.frozenDecisionsReason ?? null,
  })
  return plan.issues[0]
}

// existingIssue: la forma cruda de gh api, con un body que NO lleva la sección
// (un issue anterior a esta ronda). Labels/milestone/título calcados del wanted
// para que solo difieran las decisiones.
function existingIssue(body) {
  const w = wanted('- **D-1** — iOS 17.')
  return { number: 5, title: w.title, state: 'open', milestone: { title: 'Epic' }, labels: w.labels.map((name) => ({ name })), body }
}

describe('diffIssue — frozenDecisionsDiffers', () => {
  it('detecta divergencia cuando el spec trae decisiones y el issue no', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, null))
    const diff = diffIssue(existing, wanted('- **D-1** — iOS 17.'), 'Epic', [])
    expect(diff.frozenDecisionsDiffers).toBe(true)
  })
  it('no cuenta como divergencia cuando el motivo es malformada (unknown)', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.'))
    const diff = diffIssue(existing, wanted(null, { frozenDecisionsReason: 'malformada' }), 'Epic', [])
    expect(diff.frozenDecisionsDiffers).toBe(false)
  })
  it('se reporta como nota, no como divergencia (no mueve el exit code)', () => {
    const existing = existingIssue(buildIssueBody(SLICE, SPEC_REF, null, null))
    const diff = diffIssue(existing, wanted('- **D-1** — iOS 17.'), 'Epic', [])
    const rep = formatDrift(diff).join('\n')
    expect(rep).toContain('nota:')
    expect(rep).toContain('## Decisiones congeladas')
    expect(rep).not.toContain('divergencia:')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/reconcile-decisiones.test.js`
Expected: FAIL — `diff.frozenDecisionsDiffers` es `undefined`.

- [ ] **Step 3: Import aditivo en reconcile.js**

En `scripts/reconcile.js`, línea 100, añade `FROZEN_DECISIONS_HEADING` al import desde `./groom.js`:

```javascript
import { renderDepsContent, renderAcContent, GATES_HEADING, EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING } from './groom.js'
```

- [ ] **Step 4: Descriptor en `DUPLICATE_CHECKS`**

En la lista `DUPLICATE_CHECKS`, justo después de la entrada de `EPIC_CONTEXT_HEADING` (línea 224), añade:

```javascript
  // Decisiones congeladas: como el contexto del epic, un duplicado es
  // cosmético (ninguna máquina decide nada con ellas) — se avisa, no cuenta.
  { headings: FROZEN_DECISIONS_HEADING, label: 'Decisiones congeladas', machine: false },
```

- [ ] **Step 5: `frozenDecisionsDiffers` en `diffIssue`**

En `diffIssue`, justo después del bloque que calcula `epicContextDiffers` (termina en la línea 340), añade el espejo:

```javascript
  // Decisiones congeladas: mismo criterio que epicContextDiffers, incluida la
  // rama `frozenDecisionsUnknown` (el spec trae la sección pero no se pudo leer
  // un texto válido — no es divergencia, es no tener con qué comparar).
  const currentFrozenDecisions = extractSectionContent(body, FROZEN_DECISIONS_HEADING)
  const wantedFrozenDecisions = wantedIssue.frozenDecisions ?? null
  let frozenDecisionsDiffers
  if (wantedIssue.frozenDecisionsUnknown) {
    frozenDecisionsDiffers = false
  } else if (currentFrozenDecisions === null && wantedFrozenDecisions === null) {
    frozenDecisionsDiffers = false
  } else if (currentFrozenDecisions === null || wantedFrozenDecisions === null) {
    frozenDecisionsDiffers = true
  } else {
    frozenDecisionsDiffers = currentFrozenDecisions.trim() !== wantedFrozenDecisions.trim()
  }
```

Y en el objeto que `diffIssue` retorna, justo después de `epicContextDiffers,` (línea 386), añade:

```javascript
    frozenDecisionsDiffers,
```

- [ ] **Step 6: Nota en `formatDrift`**

En `formatDrift`, justo después de la línea `if (diff.epicContextDiffers) …` (línea 519), añade:

```javascript
  if (diff.frozenDecisionsDiffers) lines.push(`nota: ${head}: la sección "${FROZEN_DECISIONS_HEADING}" difiere del spec (no cuenta para el exit code; con --reconcile se reescribe desde el spec salvo que el body no deje hacerlo con seguridad, en cuyo caso se dice aquí mismo con otra nota y el motivo)`)
```

- [ ] **Step 7: Run test + regression**

Run: `npx vitest run __tests__/reconcile-decisiones.test.js __tests__/reconcile.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/reconcile.js __tests__/reconcile-decisiones.test.js
git commit -m "feat: reconcile compara ## Decisiones congeladas (nota, no divergencia)"
```

---

## Task 6: Reescritura/inserción en reconcile — `buildReconcileBody` + reporte en ct-groom

**Files:**
- Modify: `scripts/reconcile.js` (`buildReconcileBody` ~647-998)
- Modify: `scripts/ct-groom.mjs` (`bodyDriftCategories` ~603-610; mapa de rendiciones ~618-630; reporte de nota ~936)
- Test: `__tests__/reconcile-decisiones.test.js` (añadir)

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/reconcile-decisiones.test.js`:

```javascript
import { buildReconcileBody } from '../scripts/reconcile.js'

describe('buildReconcileBody — decisiones congeladas', () => {
  it('inserta la sección en un issue que no la tenía, antes del heredado', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, null)
    const res = buildReconcileBody(existing, wanted('- **D-1** — iOS 17.'))
    expect(res.body).toContain('## Decisiones congeladas')
    expect(res.body).toContain('iOS 17')
    expect(res.body.indexOf('## Decisiones congeladas')).toBeLessThan(res.body.indexOf('## Contexto heredado'))
  })
  it('reescribe la sección cuando el spec cambia', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 16.')
    const res = buildReconcileBody(existing, wanted('- **D-1** — iOS 17.'))
    expect(res.body).toContain('iOS 17')
    expect(res.body).not.toContain('iOS 16')
  })
  it('retira la sección cuando el spec ya no la trae', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    const res = buildReconcileBody(existing, wanted(null))
    expect(res.body).not.toContain('## Decisiones congeladas')
  })
  it('NO retira la sección cuando el motivo es malformada (unknown)', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, '- **D-1** — iOS 17.')
    const res = buildReconcileBody(existing, wanted(null, { frozenDecisionsReason: 'malformada' }))
    expect(res.body).toBe(null) // nada cambió: unknown no autoriza a retirar
  })
  it('al insertar epic y decisiones en un issue viejo, el orden es epic → decisiones → heredado', () => {
    const existing = buildIssueBody(SLICE, SPEC_REF, null, null)
    const res = buildReconcileBody(existing, wanted('- **D-1** — x.', { epicContext: 'contexto común' }))
    expect(res.body.indexOf('## Contexto del epic')).toBeLessThan(res.body.indexOf('## Decisiones congeladas'))
    expect(res.body.indexOf('## Decisiones congeladas')).toBeLessThan(res.body.indexOf('## Contexto heredado'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/reconcile-decisiones.test.js -t "buildReconcileBody"`
Expected: FAIL — `buildReconcileBody` no toca la sección.

- [ ] **Step 3: Declarar `unresolvedFrozenDecisions`**

En `buildReconcileBody`, junto a `let unresolvedEpicContext = null` (línea 653), añade:

```javascript
  let unresolvedFrozenDecisions = null
```

- [ ] **Step 4: Bloque de splice/inserción, espejo del de epic**

Justo DESPUÉS del cierre del bloque `if (epicDiffers) { … }` (termina en la línea 993, el `}` antes de `if (!changed)`) y ANTES de `if (!changed) return …`, añade:

```javascript
  // Decisiones congeladas. Mismo trato exacto que "## Contexto del epic": del
  // spec, se reescribe (es texto del epic, no prosa que un humano edite en un
  // issue suelto). Va DESPUÉS del bloque del epic a propósito: las dos se
  // insertan ancladas en "## Contexto heredado", así que correr esta segunda
  // deja el orden epic → decisiones → heredado que fija buildIssueBody. Las
  // posiciones se localizan sobre el body YA actualizado por los splices de
  // arriba.
  const currentFrozen = extractSectionContent(body, FROZEN_DECISIONS_HEADING)
  const wantedFrozen = wantedIssue.frozenDecisions ?? null
  const frozenDiffers = wantedIssue.frozenDecisionsUnknown
    ? false
    : (currentFrozen === null && wantedFrozen === null)
      ? false
      : (currentFrozen === null || wantedFrozen === null)
        ? true
        : currentFrozen.trim() !== wantedFrozen.trim()
  if (frozenDiffers) {
    const frozen = seccionSpliceable(FROZEN_DECISIONS_HEADING)
    const frozenLoc = frozen.loc
    // Defensa en el consumidor (igual que en el contexto del epic): un
    // delimitador sin cerrar dentro de la sección haría que el splice borrara
    // hasta el final del body. Se mira la sección y también el texto nuevo.
    const seccionAbierta = frozenLoc ? unterminatedDelimiter(frozenLoc.content) : null
    const textoAbierto = wantedFrozen ? unterminatedDelimiter(wantedFrozen) : null
    if (seccionAbierta || textoAbierto) {
      unresolvedFrozenDecisions = seccionAbierta ? 'seccion-sin-cerrar' : 'texto-sin-cerrar'
    } else if (frozen.ambigua) {
      unresolvedFrozenDecisions = 'duplicada'
    } else if (wantedFrozen && frozenLoc) {
      body = body.slice(0, frozenLoc.headingEnd) + wantedFrozen + '\n' + body.slice(frozenLoc.contentEnd)
      changed = true
    } else if (wantedFrozen && !frozenLoc) {
      // Sección ausente y el spec sí la trae: se inserta entera. Ancla
      // preferente "## Contexto heredado" (para respetar epic → decisiones →
      // heredado), con "## Acceptance criteria" de respaldo — igual que el
      // contexto del epic. Como este bloque corre DESPUÉS del suyo, si el epic
      // se acaba de insertar la sección aterriza entre el epic y la heredada.
      // No se usa seccionSpliceable para la heredada, por el mismo motivo que
      // allí: su cabecera es el primer carácter de la zona que esa función
      // descarta.
      const heredadaUnica = countHeadingLines(body, INHERITED_CONTEXT_HEADING) === 1
        ? locateSection(body, INHERITED_CONTEXT_HEADING)
        : null
      const ancla = heredadaUnica ? { loc: heredadaUnica, ambigua: false } : seccionSpliceable(AC_HEADING_FORMS)
      if (ancla.loc) {
        body = body.slice(0, ancla.loc.headingStart) + `${FROZEN_DECISIONS_HEADING}\n${wantedFrozen}\n\n` + body.slice(ancla.loc.headingStart)
        changed = true
      } else {
        unresolvedFrozenDecisions = ancla.ambigua ? 'ancla-duplicada' : 'sin-ancla'
      }
    } else if (!wantedFrozen && frozenLoc) {
      // El spec ya no trae decisiones: la sección se retira entera, cabecera
      // incluida. Se recorta un '\n' del final del primer trozo para no dejar
      // dos líneas en blanco en la costura, igual que al retirar el epic.
      const before = body.slice(0, frozenLoc.headingStart).replace(/\n$/, '')
      body = before + body.slice(frozenLoc.contentEnd)
      changed = true
    } else {
      // `!wantedFrozen && !frozenLoc` y aun así `frozenDiffers`: la única copia
      // cae en la zona de la coordinadora (extractSectionContent la leyó) y el
      // spec ya no trae decisiones. No se toca (no es texto del plugin) y se
      // dice, o el caller reportaría como retirada una sección que sigue ahí.
      unresolvedFrozenDecisions = frozen.motivo
    }
  }
```

- [ ] **Step 5: Devolver `unresolvedFrozenDecisions`**

En `buildReconcileBody`, cambia los DOS `return` finales (líneas 995 y 997) para incluir el nuevo campo:

```javascript
  if (!changed) return { body: null, unresolvedAc, unresolvedDeps, unresolvedReasons, unresolvedEpicContext, unresolvedFrozenDecisions }
  const finalBody = eol === '\r\n' ? body.replace(/\n/g, '\r\n') : body
  return { body: finalBody, unresolvedAc, unresolvedDeps, unresolvedReasons, unresolvedEpicContext, unresolvedFrozenDecisions }
```

- [ ] **Step 6: Run reconcile tests**

Run: `npx vitest run __tests__/reconcile-decisiones.test.js __tests__/reconcile.test.js`
Expected: PASS.

- [ ] **Step 7: Reporte en ct-groom.mjs — categoría, mapa de rendiciones y nota**

En `scripts/ct-groom.mjs`, añade `FROZEN_DECISIONS_HEADING` al import de `./groom.js` (línea 19, junto a lo añadido en Task 3):

```javascript
import { groomPlan, readEpicContext, readFrozenDecisions, EPIC_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING, analyzeSpecFreeze, HYPOTHESIS_REASONS } from './groom.js'
```

En `bodyDriftCategories`, después de la línea de `epicContextDiffers` (línea 608), añade:

```javascript
  if (diff.frozenDecisionsDiffers && !bodyResult.unresolvedFrozenDecisions) cats.push('decisiones congeladas')
```

Después del objeto `EPIC_CONTEXT_SURRENDERS` (termina en la línea 630), añade su espejo:

```javascript
// FROZEN_DECISIONS_SURRENDERS: por qué buildReconcileBody no pudo reescribir
// "## Decisiones congeladas". Espejo de EPIC_CONTEXT_SURRENDERS, con las mismas
// anclas ("## Contexto heredado" o, en su defecto, "## Acceptance criteria").
// Se reporta como nota: y NUNCA mueve el exit code.
const FROZEN_DECISIONS_SURRENDERS = {
  'sin-ancla': 'no existe la sección en el issue, y tampoco ninguna de las dos cabeceras que sirven de ancla para ponerla en su sitio ("## Contexto heredado" o, en su defecto, "## Acceptance criteria"); añade a mano una de ellas y vuelve a correr',
  'ancla-duplicada': 'no existe la sección en el issue y su ancla ("## Acceptance criteria") aparece más de una vez, así que insertarla ahí podría escribir dentro de texto ajeno; deja una sola copia del ancla y vuelve a correr',
  duplicada: 'aparece más de una vez en el body y no hay forma de saber cuál copia es la del plugin — una puede ser texto pegado dentro de "## Contexto heredado", que no se toca nunca; deja una sola copia y vuelve a correr',
  'seccion-sin-cerrar': 'la sección del issue tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, así que no se sabe dónde termina: reescribirla se llevaría por delante todo lo que venga detrás en el cuerpo. Cierra el delimitador en el issue y vuelve a correr',
  'texto-sin-cerrar': 'el texto que trae el spec tiene una valla de código (```) o un comentario HTML (<!--) SIN CERRAR, y escribirlo en el cuerpo dejaría el issue en ese mismo estado. Ciérralo en el spec y vuelve a correr',
  'en-heredado': 'el spec ya no trae decisiones congeladas, y la única copia de esta sección en el body queda por detrás de la cabecera "## Contexto heredado", dentro de la zona que pertenece a la sesión coordinadora y que no se toca nunca. No se retira nada; si esa copia sobra, quítala tú',
  'zona-sin-fin': 'no se puede saber dónde termina "## Contexto heredado" en este body: su cabecera está, pero "## Acceptance criteria" —la cabecera que la sigue siempre— no aparece exactamente una vez. Sin ese límite esta sección no se reescribe ni se retira. Restaura (o desduplica) "## Acceptance criteria" y vuelve a correr',
}
```

Y donde se emite la nota de rendición del epic (línea 936-937, dentro del `if (bodyResult.unresolvedEpicContext …)`), justo DESPUÉS de ese bloque, añade su espejo:

```javascript
    if (bodyResult.unresolvedFrozenDecisions && diff.frozenDecisionsDiffers) {
      console.error(`nota: slice #${diff.order} (issue #${found.number}) — --reconcile NO ha reescrito la sección "${FROZEN_DECISIONS_HEADING}": ${FROZEN_DECISIONS_SURRENDERS[bodyResult.unresolvedFrozenDecisions]} (no cuenta para el exit code)`)
    }
```

- [ ] **Step 8: Run test + regression completa de reconcile/ct-groom**

Run: `npx vitest run __tests__/reconcile-decisiones.test.js __tests__/ct-groom-reconcile.test.js __tests__/ct-groom-dryrun.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/reconcile.js scripts/ct-groom.mjs __tests__/reconcile-decisiones.test.js
git commit -m "feat: --reconcile reescribe/inserta/retira ## Decisiones congeladas"
```

---

## Task 7: Documentar la sección en el comando (commands/ct-groom.md)

**Files:**
- Modify: `commands/ct-groom.md` (tras la sección de `## Contexto del epic`, ~línea 59)

- [ ] **Step 1: Añadir la subsección de documentación**

En `commands/ct-groom.md`, inmediatamente después del párrafo que documenta `## Contexto del epic` (termina antes de la línea 61, la de `## Contexto heredado`), añade:

```markdown
### `## Decisiones congeladas` — sección opcional del spec, fuera de la tabla

Igual que `## Contexto del epic`, el spec admite una sección opcional **`## Decisiones congeladas`** (fuera de la tabla, localizada **por el texto de su cabecera, no por su número de sección**). Su contenido se copia al cuerpo de todos los issues del epic —para que el agente que implementa un slice tenga delante las decisiones del epic que su trabajo debe respetar—, y `--reconcile` lo mantiene al día si el spec cambia. **Diferencia con el contexto del epic:** de cada línea se quita la procedencia (`*(Procedencia: …)*`) al proyectar — es meta para quien congela, no para quien ejecuta. Cada decisión es un bullet (`- **D-N · …** — …`); no metas cabeceras (`###`) dentro, o la sección no se emite (mismo guardarraíl que el contexto del epic). Un spec sin esta sección es válido.
```

- [ ] **Step 2: Verify docs consistency (no test framework, revisión manual)**

Run: `grep -n "Decisiones congeladas" commands/ct-groom.md`
Expected: la nueva subsección aparece.

- [ ] **Step 3: Commit**

```bash
git add commands/ct-groom.md
git commit -m "docs: documenta la sección ## Decisiones congeladas en ct-groom"
```

---

## Task 8: Verificación final

- [ ] **Step 1: Toda la suite verde**

Run: `npm test`
Expected: toda la suite pasa (los nuevos tests + cero regresiones).

- [ ] **Step 2: E2E manual (dry-run)**

Escribe un spec con `## Hipótesis`, una tabla `## 9. Slices` válida y una sección `## Decisiones congeladas` con una decisión `- **D-1 · X** — Y. *(Procedencia: hablada.)*`, y corre `node scripts/ct-groom.mjs <spec> --repo o/r --milestone Epic --dry-run`.
Expected: el cuerpo del issue lleva `## Decisiones congeladas` con `- **D-1 · X** — Y.` (sin la procedencia), colocada entre `## Contexto del epic` (si lo hay) y `## Contexto heredado`.

- [ ] **Step 3: Actualizar la versión**

En `package.json`, sube la versión a `0.35.0` (cambio de contrato aditivo, ver spec §9).

```bash
git add package.json
git commit -m "chore: v0.35.0 — ## Decisiones congeladas llega al implementador"
```
