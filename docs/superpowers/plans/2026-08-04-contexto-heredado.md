# Contexto heredado entre slices — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el cuerpo de cada issue de un epic lleve dos secciones de contexto con dueños separados — una que el groom mantiene desde el spec, otra que el plugin no toca jamás — y que el kickoff se las nombre al agente.

**Architecture:** todo el criterio vive en módulos puros (`scripts/groom.js`, `scripts/reconcile.js`, `scripts/kickoff.js`); `scripts/ct-groom.mjs` es pegamento que lee el spec, imprime avisos y pasa el texto al plan. Se reusa el escáner de secciones ya endurecido (`gh-issue-map.js#locateSection`) tanto sobre cuerpos de issue como sobre el fichero de spec — no se escribe un segundo parser.

**Tech Stack:** Node ESM, vitest. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-08-04-contexto-heredado-design.md`

## Global Constraints

- **Las dos cabeceras son constantes exportadas de `scripts/groom.js`**, nunca cadenas tecleadas: `EPIC_CONTEXT_HEADING = '## Contexto del epic'`, `INHERITED_CONTEXT_HEADING = '## Contexto heredado'`. Los tests las importan, no las escriben a mano.
- **`## Contexto heredado` no se compara, no se reescribe, no se inserta y no se borra.** Ninguna tarea de este plan puede añadir código que la escriba después de crearse el issue.
- **Ninguna de las dos secciones cuenta jamás para el exit code `3`** — ni divergiendo ni duplicada. No se tocan `hasDrift` ni `reconcileGaps`.
- **Posición en el cuerpo:** enlace al spec → `## Descripción` → `## Contexto del epic` → `## Contexto heredado` → `## Acceptance criteria` → `## Dependencias` → `## Gates` → `## Out of scope / Protected` → marcador `ct-order`.
- **Comentarios:** describen la propiedad, nunca citan una tarea o función que aún no existe. Una cifra que no aporte va como orden de magnitud, no como número exacto que envejece.
- **Suite completa verde** (`npm test`) antes de cerrar la última tarea. El test `dispatch-check-dryrun.test.js > T11 hook CT_CLAIM_PRECLAIM_DELAY_MS` mide reloj y puede fallar bajo carga con la suite en paralelo; si falla, correr **ese fichero solo** (`npx vitest run __tests__/dispatch-check-dryrun.test.js`) antes de tratarlo como regresión.

---

## File Structure

| Fichero | Responsabilidad | Tarea |
|---|---|---|
| `scripts/groom.js` | constantes de cabecera, lectura de la sección del spec con su guardarraíl, emisión de ambas secciones | 1, 2 |
| `scripts/ct-groom.mjs` | leer el spec, imprimir avisos, pasar el texto a `groomPlan` | 3 |
| `scripts/reconcile.js` | comparar `## Contexto del epic`, reportarla como nota, aplicarla con splice | 4, 5 |
| `scripts/kickoff.js` | la línea que nombra las dos secciones | 6 |
| `commands/ct-groom.md` | el contrato de la sección nueva del spec | 7 |
| `__tests__/f26-contexto-heredado.test.js` | **nuevo** — las propiedades del §6 del spec | 1–6 |

---

### Task 1: Constantes de cabecera y lectura de la sección del spec

Lógica pura, sin red ni disco. Es la pieza de la que dependen todas las demás.

**Files:**
- Modify: `scripts/groom.js` (añadir al principio, junto a `GATES_HEADING` en la línea 9)
- Test: `__tests__/f26-contexto-heredado.test.js` (crear)

**Interfaces:**
- Consumes: `locateSection` de `scripts/gh-issue-map.js` (devuelve `{ headingStart, headingEnd, contentEnd, content }` o `null`). Verificado sin ciclo de importación: `gh-issue-map.js` sólo importa `gates.js`.
- Produces:
  - `EPIC_CONTEXT_HEADING: string`
  - `INHERITED_CONTEXT_HEADING: string`
  - `INHERITED_CONTEXT_PLACEHOLDER: string`
  - `readEpicContext(specMd: string) => { content: string|null, warnings: string[] }`

- [ ] **Step 1: Write the failing test**

Crear `__tests__/f26-contexto-heredado.test.js`:

```js
import { describe, it, expect } from 'vitest'
import {
  EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, INHERITED_CONTEXT_PLACEHOLDER,
  readEpicContext,
} from '../scripts/groom.js'

// El guardarraíl de las subcabeceras no es una preferencia de estilo: el
// reemplazo con el que --reconcile mantiene esta sección al día termina en la
// primera cabecera que encuentra dentro (cualquier nivel), así que una
// cabecera ahí dejaría el resto del texto huérfano bajo el texto nuevo. Se
// corta en el productor, donde todavía hay a quién decírselo.
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js`
Expected: FAIL — `readEpicContext is not a function` (y las constantes `undefined`).

- [ ] **Step 3: Write minimal implementation**

En `scripts/groom.js`, añadir el import y el bloque justo después de `GATES_HEADING`:

```js
import { locateSection } from './gh-issue-map.js'
```

```js
// Las DOS secciones de contexto del cuerpo de un issue, con dueños distintos
// y por eso con reglas distintas:
//
//   EPIC_CONTEXT_HEADING      la escribe /ct-groom desde el spec, idéntica en
//                             todos los issues del epic, y la mantiene al día.
//   INHERITED_CONTEXT_HEADING la escribe la sesión coordinadora. El plugin la
//                             emite vacía al crear el issue y no vuelve a
//                             tocarla nunca: ni la compara, ni la reescribe,
//                             ni la inserta, ni la borra.
//
// Son constantes exportadas por el mismo motivo que GATES_HEADING: las nombran
// el que las escribe, el que las compara y sus tests, y una cabecera tecleada
// en tres sitios acaba divergiendo en uno. La primera es además la MISMA
// cadena en el fichero de spec y en el cuerpo del issue: una sola que aprender.
export const EPIC_CONTEXT_HEADING = '## Contexto del epic'
export const INHERITED_CONTEXT_HEADING = '## Contexto heredado'

// El placeholder afirma dos cosas que un humano necesita leer ahí mismo: quién
// rellena la sección, y que lo que escriba no se lo va a pisar nadie. Una
// sección vacía sin esa segunda frase invita a no usarla.
export const INHERITED_CONTEXT_PLACEHOLDER =
  '_(vacía — la rellena la sesión coordinadora cuando algo ya mergeado condiciona a este slice. `/ct-groom` no escribe aquí ni reescribe lo que escribas.)_'

// SUBHEADING_RE: cabecera ATX de nivel 3 o más, con la indentación de 0 a 3
// espacios que CommonMark admite. Los niveles 1 y 2 quedan fuera a propósito:
// una "## " o una "# " detrás de la sección no está DENTRO de ella, sólo la
// termina, que es lo normal en cualquier documento.
const SUBHEADING_RE = /^ {0,3}#{3,}\s/

// subheadingInside: la línea que terminó la sección, si resulta ser una
// cabecera de nivel 3 o más — es decir, una subcabecera del propio contexto
// del epic. `locateSection` corta el contenido en la primera cabecera de
// CUALQUIER nivel, así que basta con mirar qué hay justo detrás del corte: si
// es una subcabecera, había una dentro.
//
// `contentEnd` apunta al '\n' que precede a la línea terminadora (o al final
// del texto si no hay ninguna), así que la primera línea no vacía a partir de
// ahí es esa línea terminadora.
function subheadingInside(specMd, loc) {
  const rest = (specMd || '').slice(loc.contentEnd)
  const line = rest.split('\n').find((l) => l.trim() !== '')
  return line && SUBHEADING_RE.test(line) ? line.trim() : null
}

// readEpicContext: lee del fichero de spec el texto que va a viajar, idéntico,
// al cuerpo de cada issue del epic.
//
// La sección se localiza POR EL TEXTO DE SU CABECERA, nunca por un número de
// sección — mismo criterio con el que analyzeSlicesTable localiza la tabla de
// slices por sus columnas: los números de sección de un spec se mueven en
// cuanto alguien inserta algo por delante.
//
// Devuelve `content: null` en los tres casos en que no hay nada que emitir
// (ausente, vacía, o con una subcabecera dentro), cada uno con su propio
// aviso: los tres se arreglan de forma distinta y un mensaje único obligaría a
// adivinar cuál pasó. Un spec sin esta sección es un spec VÁLIDO — de ahí que
// esto avise y nunca lance.
export function readEpicContext(specMd) {
  const warnings = []
  const loc = locateSection(specMd || '', EPIC_CONTEXT_HEADING)
  if (!loc) {
    warnings.push(`aviso: el spec no trae la sección "${EPIC_CONTEXT_HEADING}" — los issues de este epic se crearán sin contexto común. Si lo quieres, añade esa sección al spec, fuera de la tabla de slices, y vuelve a correr.`)
    return { content: null, warnings }
  }
  const offending = subheadingInside(specMd, loc)
  if (offending) {
    warnings.push(`aviso: la sección "${EPIC_CONTEXT_HEADING}" del spec contiene una cabecera ("${offending}") y por eso NO se emite en ningún issue. El texto de esta sección se mantiene al día con un reemplazo que termina en la primera cabecera que encuentra dentro, así que esa cabecera dejaría el resto del texto huérfano. Usa negritas o una lista en su lugar.`)
    return { content: null, warnings }
  }
  const content = loc.content.trim()
  if (!content) {
    warnings.push(`aviso: la sección "${EPIC_CONTEXT_HEADING}" del spec está presente pero sin contenido — se trata igual que si no estuviera. Escribe algo debajo de la cabecera, o quítala.`)
    return { content: null, warnings }
  }
  return { content, warnings }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js`
Expected: PASS (10 tests).

Esta implementación se prototipó contra el `locateSection` real antes de escribir el plan: los diez casos de arriba, más el de la valla de código, se comportan como aquí se dice. Si alguno falla, es que algo cambió — no que el caso esté mal planteado.

- [ ] **Step 5: Commit**

```bash
git add scripts/groom.js __tests__/f26-contexto-heredado.test.js
git commit -m "F26: las dos cabeceras de contexto y la lectura de la seccion del spec

El guardarrail de las subcabeceras corta en el productor: una cabecera
dentro de la seccion que se reescribe dejaria el resto del texto huerfano
bajo el reemplazo, porque el reemplazo termina en la primera cabecera que
encuentra."
```

---

### Task 2: `buildIssueBody` emite las dos secciones y `groomPlan` lleva el texto

**Files:**
- Modify: `scripts/groom.js:218-255` (`buildIssueBody`), `scripts/groom.js:277-308` (`groomPlan`)
- Test: `__tests__/f26-contexto-heredado.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `EPIC_CONTEXT_HEADING`, `INHERITED_CONTEXT_HEADING`, `INHERITED_CONTEXT_PLACEHOLDER` (Task 1).
- Produces:
  - `buildIssueBody(slice, specRef, epicContext = null) => string` — tercer parámetro **opcional**; omitirlo produce exactamente el cuerpo de antes más la sección heredada vacía.
  - `groomPlan(slices, { milestone, specRef, epicContext }) => { milestone, issues: [...] }` — cada issue del plan gana el campo `epicContext: string|null`, que `reconcile.js` consume en las tareas 4 y 5.

- [ ] **Step 1: Write the failing test**

Añadir a `__tests__/f26-contexto-heredado.test.js`:

```js
import { buildIssueBody, groomPlan } from '../scripts/groom.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js`
Expected: FAIL — el cuerpo no contiene ninguna de las dos cabeceras.

- [ ] **Step 3: Write minimal implementation**

En `scripts/groom.js#buildIssueBody`, entre el bloque de `## Descripción` y el de `## Acceptance criteria`:

```js
export function buildIssueBody(slice, specRef, epicContext = null) {
```

```js
  // Las dos secciones de contexto van DESPUÉS de la descripción y ANTES de los
  // criterios de aceptación: son el contexto con el que esos criterios se
  // interpretan, y detrás de ellos se leerían tarde.
  //
  // El contexto del epic sólo se emite si el spec trae texto real — sin él, el
  // spec no tiene ninguna opinión, y una sección vacía afirmaría que sí la
  // tiene y está en blanco. La heredada se emite SIEMPRE, aunque nadie haya
  // escrito nada todavía: una sección que sólo existe cuando alguien se acordó
  // de crearla es una sección que nadie crea cuando hace falta, y sin un sitio
  // fijo cada quien inventa el suyo — con lo que ningún kickoff puede
  // nombrarla.
  if (epicContext) {
    lines.push(EPIC_CONTEXT_HEADING)
    lines.push(epicContext)
    lines.push('')
  }
  lines.push(INHERITED_CONTEXT_HEADING)
  lines.push(INHERITED_CONTEXT_PLACEHOLDER)
  lines.push('')
```

En `groomPlan`, cambiar la firma y añadir el campo:

```js
export function groomPlan(slices, { milestone, specRef, epicContext = null }) {
```

```js
      body: buildIssueBody(s, specRef, epicContext),
```

y dentro del objeto de cada issue, junto a `ac`/`descripcion`/`protectedLine`:

```js
      // El texto del epic viaja en el plan, no sólo dentro del body ya
      // renderizado, por el mismo motivo que ac/descripcion/protectedLine: la
      // comparación contra un issue existente lo necesita sin volver a parsear
      // el cuerpo que acaba de generar, y quien lea el JSON del --dry-run
      // tiene que poder ver qué va a salir sin reproducir la lectura del spec.
      epicContext,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js __tests__/groom.test.js`
Expected: PASS. `groom.test.js` no debe romperse — el tercer parámetro es opcional.

- [ ] **Step 5: Commit**

```bash
git add scripts/groom.js __tests__/f26-contexto-heredado.test.js
git commit -m "F26: el groom emite las dos secciones al crear el issue

La del epic solo si el spec trae texto real; la heredada siempre, aunque
este vacia — sin un sitio fijo cada quien inventa el suyo, y entonces no
hay ninguna cabecera que el kickoff pueda nombrar."
```

---

### Task 3: `/ct-groom` lee el spec y avisa

**Files:**
- Modify: `scripts/ct-groom.mjs:18` (import), `scripts/ct-groom.mjs:487-504` (tras `resolveSpecRef`, antes de `groomPlan`)
- Test: `__tests__/f26-contexto-heredado.test.js` (añadir bloque de integración con `--dry-run`)

**Interfaces:**
- Consumes: `readEpicContext` (Task 1), `groomPlan` con `epicContext` (Task 2).
- Produces: el JSON de `--dry-run` gana `epicContext` en cada issue; los avisos salen por `stderr`.

- [ ] **Step 1: Write the failing test**

Mirar primero cómo monta el proceso `__tests__/ct-groom-dryrun.test.js` (helper de invocación, fixtures de spec) y **reusar exactamente ese helper**, no escribir uno nuevo. Añadir:

```js
// Se invoca el binario real con --dry-run, no una función interna: el aviso y
// el reparto del texto sólo son ciertos si el wrapper de verdad los conecta.
describe('/ct-groom --dry-run — el contexto del epic llega al plan', () => {
  it('con la sección en el spec: el texto sale en cada issue del dry-run', () => {
    // spec con `## Contexto del epic` + tabla de dos slices
    // esperado: JSON.parse(stdout).issues.every(i => i.epicContext === '- una regla común')
  })

  it('sin la sección: avisa por stderr y epicContext queda a null', () => {
    // esperado: stderr contiene '## Contexto del epic'
    //           JSON.parse(stdout).issues.every(i => i.epicContext === null)
  })

  it('con una cabecera dentro: avisa nombrando la línea y no emite la sección', () => {
    // esperado: stderr contiene '### 1 · Un detalle'
    //           el body del dry-run NO contiene '## Contexto del epic'
  })
})
```

**El implementador escribe el cuerpo de estos tres tests con el helper del fichero existente.** Los comentarios de arriba fijan el aserto exacto de cada uno; lo que falta es la mecánica de invocación, que ya está resuelta en `ct-groom-dryrun.test.js` y no debe duplicarse a ojo.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js`
Expected: FAIL — `epicContext` es `undefined` en el JSON y no sale ningún aviso.

- [ ] **Step 3: Write minimal implementation**

En `scripts/ct-groom.mjs`, ampliar el import de `groom.js`:

```js
import { groomPlan, readEpicContext } from './groom.js'
```

Y justo después del bucle `for (const w of specLinkWarnings) console.error(w)`:

```js
// El contexto común del epic: una sección del spec, fuera de la tabla de
// slices, cuyo texto viaja idéntico al cuerpo de cada issue. Sus avisos se
// imprimen aquí, junto a los del enlace al spec, y NUNCA abortan: un spec sin
// esa sección es un spec válido, y bloquear un groom entero por una sección
// opcional malformada sería desproporcionado. El remedio va dentro del aviso.
const { content: epicContext, warnings: epicContextWarnings } = readEpicContext(specMd)
for (const w of epicContextWarnings) console.error(w)
```

Y pasar el texto al plan:

```js
  plan = groomPlan(slices, { milestone, specRef, epicContext })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js __tests__/ct-groom-dryrun.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ct-groom.mjs __tests__/f26-contexto-heredado.test.js
git commit -m "F26: /ct-groom lee la seccion del spec y reparte su texto

Los avisos nunca abortan: un spec sin esa seccion es valido, y el remedio
va dentro del propio aviso."
```

---

### Task 4: comparar `## Contexto del epic` y reportarla como nota

**Files:**
- Modify: `scripts/reconcile.js:100` (import), `:201-215` (`DUPLICATE_CHECKS`), `:274-352` (`diffIssue`), `:419-460` (`formatDrift`)
- Test: `__tests__/f26-contexto-heredado.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `EPIC_CONTEXT_HEADING`, `INHERITED_CONTEXT_HEADING` (Task 1); `wantedIssue.epicContext` (Task 2).
- Produces: `diffIssue(...)` gana el campo booleano `epicContextDiffers`. **No** gana ningún campo para la sección heredada — el plugin no tiene opinión sobre ella.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js`
Expected: FAIL — `d.epicContextDiffers` es `undefined`.

- [ ] **Step 3: Write minimal implementation**

Import en `scripts/reconcile.js`:

```js
import { renderDepsContent, renderAcContent, GATES_HEADING, EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING } from './groom.js'
```

En `DUPLICATE_CHECKS`, añadir las dos entradas:

```js
  // Las dos secciones de contexto duplicadas son cosméticas: ninguna máquina
  // decide nada con ellas. Se avisa —un duplicado suele ser un merge mal
  // resuelto, y quien edite la copia equivocada merece saberlo— pero anclar el
  // exit code a esto entrenaría a ignorar el resto del informe.
  { headings: EPIC_CONTEXT_HEADING, label: 'Contexto del epic', machine: false },
  { headings: INHERITED_CONTEXT_HEADING, label: 'Contexto heredado', machine: false },
```

En `diffIssue`, junto a la comparación de Descripción:

```js
  // Contexto del epic: mismo criterio de tres estados que Descripción — null
  // en ambos lados es acuerdo (silencio real), null en uno solo es
  // divergencia, y sólo se compara el texto cuando los dos lados tienen
  // sección.
  //
  // La sección heredada NO se compara aquí ni en ningún otro sitio: su dueño
  // es quien la escribe, y el plugin no tiene ninguna opinión sobre su
  // contenido. Que no aparezca en este diff es la propiedad, no un olvido.
  const currentEpicContext = extractSectionContent(body, EPIC_CONTEXT_HEADING)
  const wantedEpicContext = wantedIssue.epicContext ?? null
  let epicContextDiffers
  if (currentEpicContext === null && wantedEpicContext === null) {
    epicContextDiffers = false
  } else if (currentEpicContext === null || wantedEpicContext === null) {
    epicContextDiffers = true
  } else {
    epicContextDiffers = currentEpicContext.trim() !== wantedEpicContext.trim()
  }
```

y añadirlo al objeto devuelto, junto a `descripcionDiffers`:

```js
    epicContextDiffers,
```

En `formatDrift`, junto a las notas de Descripción/Protegido:

```js
  if (diff.epicContextDiffers) lines.push(`nota: ${head}: la sección "${EPIC_CONTEXT_HEADING}" difiere del spec (no cuenta para el exit code). Con --reconcile se reescribe desde el spec; la sección "${INHERITED_CONTEXT_HEADING}" de al lado no se toca nunca`)
```

**No tocar `hasDrift`.** Es lo que mantiene la sección fuera del exit code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js __tests__/reconcile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reconcile.js __tests__/f26-contexto-heredado.test.js
git commit -m "F26: comparar el contexto del epic y reportarlo como nota

Nunca cuenta para el exit code: todo issue anterior a esta ronda saldria
3 en cada corrida hasta que alguien reescribiera su cuerpo a mano, y eso
entrena a ignorar el resto del informe. El contexto heredado no se
compara en absoluto."
```

---

### Task 5: `--reconcile` reescribe el contexto del epic, y sólo ése

El corazón de la ronda. Escribe en el cuerpo de un issue real, así que cada rama se prueba por separado.

**Files:**
- Modify: `scripts/reconcile.js:523-608` (`buildReconcileBody`)
- Test: `__tests__/f26-contexto-heredado.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `EPIC_CONTEXT_HEADING`, `wantedIssue.epicContext`, `locateSection`, `AC_HEADING_FORMS`.
- Produces: ningún campo nuevo en el valor de retorno. **`reconcileGaps` no se toca**: esta sección no cuenta para el exit code, así que no puede producir un gap.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js`
Expected: FAIL — el primer test falla porque el contexto del epic sigue diciendo `- regla VIEJA`.

- [ ] **Step 3: Write minimal implementation**

En `scripts/reconcile.js#buildReconcileBody`, tras el bloque de Dependencias y antes del `if (!changed)`:

```js
  // Contexto del epic. Es prosa, y aun así se reescribe — al contrario que
  // Descripción y Protegido, que no. Lo que las distingue: aquéllas son prosa
  // que un humano edita de forma rutinaria y legítima en un issue suelto; ésta
  // es texto del epic, idéntico en todos sus issues, y editarla a mano en uno
  // solo es exactamente la divergencia que mantenerla al día viene a eliminar.
  // Quien quiera contexto propio de este slice tiene la sección de al lado, que
  // no se toca nunca — y el placeholder con el que se crea ya se lo dice.
  //
  // Las posiciones se localizan sobre el body YA actualizado por los splices
  // de arriba, no sobre el original.
  const currentEpic = extractSectionContent(body, EPIC_CONTEXT_HEADING)
  const wantedEpic = wantedIssue.epicContext ?? null
  const epicDiffers = (currentEpic === null && wantedEpic === null)
    ? false
    : (currentEpic === null || wantedEpic === null)
      ? true
      : currentEpic.trim() !== wantedEpic.trim()
  if (epicDiffers) {
    const epicLoc = locateSection(body, EPIC_CONTEXT_HEADING)
    if (wantedEpic && epicLoc) {
      body = body.slice(0, epicLoc.headingEnd) + wantedEpic + '\n' + body.slice(epicLoc.contentEnd)
      changed = true
    } else if (wantedEpic && !epicLoc) {
      // Sección ausente (un issue anterior a esta ronda) y el spec sí trae
      // texto: se inserta entera justo ANTES de "## Acceptance criteria", que
      // es la posición que le corresponde y a la vez el único ancla seguro.
      // Sin ese ancla no se inventa una posición — insertar al final a ciegas
      // es lo que, con una valla de código sin cerrar por delante, añadía una
      // sección nueva en cada corrida sin límite.
      const acLoc = locateSection(body, AC_HEADING_FORMS)
      if (acLoc) {
        body = body.slice(0, acLoc.headingStart) + `${EPIC_CONTEXT_HEADING}\n${wantedEpic}\n\n` + body.slice(acLoc.headingStart)
        changed = true
      }
      // Sin ancla: no se escribe nada y no se marca ningún gap. Esta sección
      // nunca cuenta para el exit code, así que no puede producir uno.
    } else if (!wantedEpic && epicLoc) {
      // El spec ya no trae contexto del epic: la sección se retira ENTERA,
      // cabecera incluida. Se recorta un '\n' del final del primer trozo para
      // no dejar dos líneas en blanco en la costura, igual que al retirar
      // "## Dependencias".
      const before = body.slice(0, epicLoc.headingStart).replace(/\n$/, '')
      body = before + body.slice(epicLoc.contentEnd)
      changed = true
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js __tests__/reconcile.test.js __tests__/ct-groom-reconcile.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/reconcile.js __tests__/f26-contexto-heredado.test.js
git commit -m "F26: --reconcile mantiene al dia el contexto del epic, y solo ese

El heredado sobrevive byte a byte, con subcabeceras y tablas dentro, y eso
pasa de sostenerse solo a estar fijado por test. Sin ancla no se inserta
nada: no se inventa una posicion."
```

---

### Task 6: el kickoff nombra las dos secciones

**Files:**
- Modify: `scripts/kickoff.js:1-10` (import), `scripts/kickoff.js:153-236` (`renderKickoff`)
- Test: `__tests__/f26-contexto-heredado.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `EPIC_CONTEXT_HEADING`, `INHERITED_CONTEXT_HEADING` (Task 1). Sin ciclo: `kickoff.js` no lo importa nadie desde `groom.js`.
- Produces: una línea más en la salida de `renderKickoff`.

- [ ] **Step 1: Write the failing test**

```js
import { renderKickoff } from '../scripts/kickoff.js'

describe('renderKickoff — nombra las dos secciones', () => {
  const K = () => renderKickoff({ n: 7, name: 'card', type: 'ui', ac: ['AC-7.1'], deps: [], issue: '#7' }, { repo: 'o/r' })

  it('nombra las dos cabeceras EXACTAS que emite el groom', () => {
    expect(K()).toContain(EPIC_CONTEXT_HEADING)
    expect(K()).toContain(INHERITED_CONTEXT_HEADING)
  })

  it('no interpola el texto de ninguna: sólo las nombra', () => {
    // El kickoff se teclea entero en un pty y estas secciones son prosa de
    // longitud arbitraria — mismo criterio ya tomado para Out of scope.
    const k = renderKickoff(
      { n: 7, name: 'card', type: 'ui', ac: ['AC-7.1'], deps: [], issue: '#7', epicContext: 'TEXTO QUE NO DEBE APARECER' },
      { repo: 'o/r' },
    )
    expect(k).not.toContain('TEXTO QUE NO DEBE APARECER')
  })

  it('es honesto con los dos casos sin contenido: vacía y ausente', () => {
    expect(K()).toMatch(/vacía|no está|no aparece/)
  })

  it('sigue nombrando Out of scope / Protected — no lo desplaza', () => {
    expect(K()).toContain('## Out of scope / Protected')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js`
Expected: FAIL — el kickoff no menciona ninguna de las dos cabeceras.

- [ ] **Step 3: Write minimal implementation**

Import en `scripts/kickoff.js`:

```js
import { EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING } from './groom.js'
```

Y una línea nueva en el array de `renderKickoff`, **inmediatamente después** de la que ya nombra `## Out of scope / Protected`:

```js
    // Mismo criterio que la línea de "Out of scope / Protected", justo encima,
    // y por los mismos dos motivos: se NOMBRAN las secciones y no se interpola
    // su texto —es prosa de longitud arbitraria y esto se teclea entero en un
    // pty—, y se enumeran en vez de confiar en "hidrátate del issue", porque
    // lo que se enumera se lee y lo que se deja a "ya lo verá" compite con el
    // resto del cuerpo.
    //
    // La frase final cubre los dos casos distintos en que no hay nada que
    // leer: la sección está y está vacía, o no está en absoluto (un issue
    // creado antes de que estas secciones existieran nunca recibe la
    // heredada). Sin ella, un agente que no encuentra lo que se le acaba de
    // nombrar lo busca fuera del issue, que es justo lo que no puede hacer.
    `Lee también las secciones "${EPIC_CONTEXT_HEADING}" y "${INHERITED_CONTEXT_HEADING}" del issue: traen lo que el spec y los slices ya mergeados condicionan sobre este trabajo y que no cabe en los criterios de aceptación. Si alguna está vacía o no aparece, no hay nada que heredar — no lo busques fuera del issue.`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f26-contexto-heredado.test.js __tests__/kickoff.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/kickoff.js __tests__/f26-contexto-heredado.test.js
git commit -m "F26: el kickoff nombra las dos secciones de contexto

Nombrarlas, no interpolarlas: es prosa de longitud arbitraria y el kickoff
se teclea entero en un pty. Y dice que una seccion vacia o ausente
significa que no hay nada que heredar, para que no se busque fuera."
```

---

### Task 7: documentar el contrato y cerrar la ronda

**Files:**
- Modify: `commands/ct-groom.md` (junto a la descripción de la tabla de slices, ~línea 24, y a la lista de lo que compara `--reconcile`, ~línea 110)
- Modify: `.claude-plugin/plugin.json` (versión)
- Test: la suite completa

**Interfaces:**
- Consumes: todo lo anterior. No produce interfaces nuevas.

- [ ] **Step 1: Documentar la sección nueva del spec**

En `commands/ct-groom.md`, añadir junto a la descripción de las columnas opcionales:

```markdown
Además de la tabla, el spec admite una sección opcional **`## Contexto del epic`** (fuera de la tabla, en cualquier punto del fichero — se localiza por el texto de su cabecera, no por su número de sección). Su contenido se copia **idéntico al cuerpo de todos los issues del epic**, y `--reconcile` lo mantiene al día si el spec cambia.

**No puede contener cabeceras dentro** (`###`, `####`…). El reemplazo con el que se mantiene al día termina en la primera cabecera que encuentre, así que una cabecera ahí dejaría el resto del texto huérfano. Si la hay, `/ct-groom` avisa nombrando la línea y no emite la sección en ningún issue. Usa negritas o listas.

Cada issue recibe además una sección **`## Contexto heredado`** vacía. Ésa la escribe quien coordina, cuando algo ya mergeado condiciona a ese slice — y `/ct-groom` **no la toca nunca**: ni la compara, ni la reescribe, ni la inserta, ni la borra.
```

Y en la lista de lo que compara `--reconcile`, junto a Descripción/Protegido:

```markdown
- **`## Contexto del epic`**: se compara y **se reescribe** desde el spec. Se reporta como `nota:` y **nunca** cuenta para el `3`. `## Contexto heredado` queda fuera de la comparación **por completo, siempre**.
```

- [ ] **Step 2: Subir la versión**

Localizar dónde vive la versión (`grep -rn '"version"' .claude-plugin/plugin.json package.json`) y ponerla en `0.25.0` en **todos** los sitios donde aparezca la del plugin. Es un cambio de contrato aditivo.

- [ ] **Step 3: Correr la suite completa**

Run: `npm test`
Expected: PASS. Si falla `dispatch-check-dryrun.test.js > T11 hook CT_CLAIM_PRECLAIM_DELAY_MS`, es el test de reloj: correr `npx vitest run __tests__/dispatch-check-dryrun.test.js` aislado antes de tratarlo como regresión.

- [ ] **Step 4: Verificar la coherencia de `dist/`**

Run: `npx vitest run __tests__/dist-coherente-con-fuentes.test.js`
Expected: PASS. `dist/` sólo empaqueta los dos hooks (`session-start`, `stop`), que esta ronda no toca — si este test se pone rojo, algo se ha movido que no debía.

- [ ] **Step 5: Barrer la zona, no la línea**

Releer de arriba abajo los tres ficheros tocados (`groom.js`, `reconcile.js`, `kickoff.js`) buscando **frases que estos cambios hayan vuelto falsas** — sobre todo comentarios que explican **por qué** algo se apaga o se deja fuera, escritos cuando lo que se apagaba era otra cosa. Candidatos concretos:

- el comentario de `hasDrift` que enumera qué nunca cuenta para el exit code;
- el comentario de `formatDrift` que enumera qué es `nota:` y qué es `divergencia:`;
- el de `DUPLICATE_CHECKS` sobre qué duplicados son cosméticos;
- el cabecero de `buildReconcileBody`, que enumera **qué secciones reescribe** y afirma que Descripción/Protegido no se reescriben por ser prosa — ahora hay una prosa que sí se reescribe, y ese enunciado necesita el matiz que las distingue;
- el de `diffIssue` que dice qué partes del cuerpo quedan fuera del diff.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "F26: contrato de la seccion del spec, version 0.25.0 y barrido

El barrido cierra el defecto que mas veces aparecio en las rondas
anteriores: un arreglo que desplaza una afirmacion en vez de eliminarla y
deja falso un comentario que no tocaba. El cabecero de buildReconcileBody
afirmaba que la prosa no se reescribe; ahora hay una que si."
```

---

## Self-Review

**Cobertura del spec, sección por sección:**

| Spec | Tarea |
|---|---|
| §3.1 fuente y localización por texto de cabecera | 1 |
| §3.1 spec sin la sección / con ella vacía | 1 |
| §3.2 sección heredada vacía con placeholder | 1, 2 |
| §3.3 guardarraíl de subcabeceras | 1 |
| §3.4 posición en el cuerpo | 2 (y 5, en la inserción) |
| §4.1 constantes exportadas | 1 |
| §4.2 emisión al crear | 2, 3 |
| §4.3 reescritura, inserción anclada, rendirse sin ancla, retirada | 5 |
| §4.3 la heredada no se compara ni se toca | 4, 5 |
| §4.4 nunca cuenta para el exit code; duplicados `machine: false` | 4 |
| §4.5 la línea del kickoff | 6 |
| §5 tabla de piezas | 1–7 |
| §6 las ocho propiedades con test | 1, 2, 4, 5, 6 |
| §9 versión 0.25.0 | 7 |

**Consistencia de tipos:** `epicContext` es `string|null` en las cinco superficies donde viaja — el retorno de `readEpicContext`, el parámetro de `groomPlan`, el tercer parámetro de `buildIssueBody`, el campo de cada issue del plan y `wantedIssue.epicContext`. Nunca `undefined`: `groomPlan` lo normaliza con un default `= null`, y `diffIssue`/`buildReconcileBody` lo leen con `?? null`.

**Placeholders:** la Task 3 delega el cuerpo de tres tests al helper de invocación de `ct-groom-dryrun.test.js`, con el aserto exacto de cada uno escrito. Es deliberado: duplicar a ojo la mecánica de arranque de un proceso real es peor que reusar la que ya funciona. Ningún otro paso deja código sin escribir.
