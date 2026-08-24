# El e2e al cierre del slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un slice cuyo spec declara un recorrido de e2e lo atraviese antes de abrir el PR, adjunte la evidencia y no pueda liberarse en rojo — y que un slice que no lo declara siga funcionando exactamente como hoy.

**Architecture:** Una columna `E2E` en la tabla §9 declara el recorrido por fila (o el token `no`); `slices.js` la parsea como una celda cruda más, `gates.js` deriva de ella el gate `e2e`, y `groom.js` la proyecta a una sección `## E2E` del issue. La travesía es **un paso terminal de la máquina de estados de `ct-step`** (`STEPS.E2E`, tras el commit de la última tarea), así que sin pasarla el run no llega a `DELIVERED` y la puerta que `--release` ya tiene lo cubre. El entorno lo declara el repo destino en `AGENTS.md`; el recorrido viaja congelado desde el spec.

**Tech Stack:** Node ≥ 24 (ESM), vitest, `gh` CLI, bash (`ct-init.sh`).

**Spec:** `docs/superpowers/specs/2026-08-24-e2e-al-cierre-del-slice-design.md`

## Global Constraints

- **Rama:** `alcaptar/merge_3_e2e`, base `un-solo-go` (`5990363`). No rebasar sin decirlo.
- **Baseline de la suite, MEDIDO en esta rama el 2026-08-24:** `npm test` da **2198 passed / 1 failed (2199 total)**, 74 de 75 ficheros, ~125 s. (El `2185/2186` que cita la descripción de la #32 es de antes de los tres últimos commits de esa rama: no lo uses.)

  El único fallo es `ct-init.test.js > SLICES_PRISTINE_HASHES no registra hashes de bloques que no existieron nunca`, **preexistente**, y su mensaje lista **exactamente un** hash huérfano: `4d6eebf4ea94b7197879d30293dc4719d82399b7feeb7711829c28a1dcaa7f1c`.

  **Cualquier otro fallo, y cualquier hash de más en ese mensaje, es de este trabajo.** Ese test es especialmente relevante para la Task 5, que añade un hash a esa misma lista: si al acabar el mensaje lista dos hashes, el segundo es tuyo — el hash que registres tiene que ser el del bloque que el `ct-init.sh` modificado siembra de verdad (ver el comando en esa tarea), no uno calculado a mano.

  **Y antes de nada: `npm install`.** Un worktree recién creado no trae `node_modules`, y `npm test` muere en el build con `Cannot find package 'esbuild'`.
- **Versión del plugin:** `0.41.0` en `.claude-plugin/plugin.json` y `package.json` (tarea 8).
- **Contrato de la tabla de slices:** `SLICES_CONTRACT_VERSION=19` en `scripts/ct-init.sh` (tarea 5).
- **Vocabulario cerrado de gates, orden canónico:** `visual`, `apply`, `plan`, `e2e`. `e2e` va **último** en el objeto `GATES` porque `GATE_ORDER = Object.keys(GATES)`.
- **`TYPE_GATES` no se toca.** Ningún `Tipo` implica `e2e`.
- **Token de «no aplica»:** `no` y `n/a`, case-insensitive, comparados sobre la **celda entera limpia**, nunca por prefijo.
- **El árbol de esta rama NO es el de `main`.** Trae `ct-step.mjs`, `run-machine.js`, `step-contracts.js`, `plan-tasks.js`, `run-metrics.js`, `go-response.js` y `ct-watch-go.mjs`. **Mira siempre el fichero real, no este plan.**
- **Exit codes.** En `dispatch-check` los `0`-`7` están cogidos (el `7` es la puerta del run entregado, que ya existe): el único nuevo es el **`8`**. En `ct-step` el mapa salta de 6 a 8, así que el nuevo es el **`7`** (`E2E_RED`); el `9` (`WRONG_STEP`) y el `3` (`NO_VERDICT`) se reusan tal cual.
- **Ruta del informe:** `docs/superpowers/e2e/<issue>.md` — número de issue a secas, sin slug. **Lo escribe el programa**, no el agente.
- **NO se toca `skills/finishing-a-development-branch/SKILL.md`.** Dejó de conducir el tramo interno cuando la #31 puso a `ct-step` a hacerlo. Esta PR no toca ninguna de las tres costuras vigiladas del fork.
- **Trampa conocida de `ct-step`:** al cargar el estado cruza `commitsDesde(baseSha)` con `run.task - 1` y **muere con `PRECONDITION` si no cuadran**. En el paso `e2e` habrá `tasksTotal` commits mientras `run.task` sigue valiendo `tasksTotal`, así que esa invariante NO se cumple y hay que darle su propia rama (Task 8, paso 3). Es el fallo que más probablemente aparezca al ejecutar.
- **Nada de `hooks/`**, así que no hay que reconstruir `dist/`. Si alguna tarea acaba tocando `hooks/` o un módulo que los hooks importen, aplica la regla del `dist/` del README (`npm run build` en el mismo commit).
- **Comentarios:** este repo documenta el POR QUÉ en el propio código, con el defecto que cierra cada pieza. Seguir ese registro; no es opcional aquí, es la convención del repo.

---

### Task 1: La columna `E2E` en el parser

**Files:**
- Modify: `scripts/slices.js` (zona de índices de columna, ~línea 378; construcción del slice, ~línea 550)
- Test: `__tests__/e2e-columna.test.js` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: campo `e2e: string` en cada objeto de `analyzeSlicesTable(md).slices` — **la celda cruda ya trimmed**, sin resolver. Exactamente el mismo contrato que el campo `gate`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-columna.test.js`:

```js
// ============================================================================
// La columna E2E: el parser la trata como una celda cruda más.
//
// Por qué cruda y no resuelta: slices.js "no sabe de gates, igual que no sabe
// de labels ni de addenda: su trabajo es convertir una tabla markdown en
// celdas fiables" (comentario del campo `gate`). La resolución de los tres
// estados de la celda vive en gates.js#resolveE2e.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { analyzeSlicesTable } from '../scripts/slices.js'

const table = (headerExtra, rowExtra) => `
## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |${headerExtra}
|---|-------|------|---------|-----|--------|-----------|------|------|------|${headerExtra ? '---|' : ''}
| 1 | uno | backend | algo | – | un criterio | – | core | – | – |${rowExtra}
`

describe('columna E2E', () => {
  it('sin columna E2E, el campo llega vacío y nada más cambia', () => {
    const { slices } = analyzeSlicesTable(table('', ''))
    expect(slices).toHaveLength(1)
    expect(slices[0].e2e).toBe('')
    expect(slices[0].name).toBe('uno')
  })

  it('con columna E2E, el campo trae la celda cruda ya trimmed', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' levantado con el example\\, curl -i :9115/metrics responde 200 |'))
    expect(slices[0].e2e).toBe('levantado con el example\\, curl -i :9115/metrics responde 200')
  })

  it('la celda `no` llega literal, sin interpretar', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' no |'))
    expect(slices[0].e2e).toBe('no')
  })

  it('la cabecera E2E no colisiona con ninguna de las diez existentes', () => {
    const { slices } = analyzeSlicesTable(table(' E2E |', ' un recorrido |'))
    const s = slices[0]
    expect(s.type).toBe('backend')
    expect(s.entrega).toBe('algo')
    expect(s.ac).toEqual(['un criterio'])
    expect(s.area).toEqual(expect.arrayContaining(['core']))
    expect(s.gate).toBe('–')
    expect(s.e2e).toBe('un recorrido')
  })

  it('la columna ausente NO produce aviso de columna opcional', () => {
    const res = analyzeSlicesTable(table('', ''))
    expect(res.missingOptionalColumns || []).not.toContain('E2E')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-columna.test.js`
Expected: FAIL — `expect(slices[0].e2e).toBe('levantado…')` recibe `undefined`.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/slices.js`, junto a `iGate = col('gate')`, añadir el índice con su comentario:

```js
        iGate = col('gate'),
        // iE2e: la columna que declara QUÉ se atraviesa en este slice, separada
        // de `Acepta` a propósito. La primera versión del diseño marcaba
        // criterios DENTRO de `Acepta` con un prefijo `[e2e]`, y se cayó al
        // aplicarla al caso real: de los cuatro `Acepta` del slice #5 de
        // mo-monitoring, el 1 y el 2 hablan de la respuesta del mismo router y
        // ningún criterio los separa. Dos personas congelando el mismo spec
        // marcarían cosas distintas — y esa marca era la única barrera contra
        // que el agente se inventara un flujo. Con una columna propia no se
        // clasifica a posteriori un texto que ya existía: se decide al
        // escribir, y en qué columna se escribe ES la decisión.
        //
        // No colisiona con ninguna cabecera existente (misma comprobación que
        // F21 dejó anotada para `gate`): "e2e" no es substring de
        // #/slice/tipo/entrega/dep/acepta/protegido/área/toca/gate, ni ninguna
        // de esas lo es de "e2e".
        iE2e = col('e2e')
```

En la construcción del slice, junto al campo `gate`:

```js
      // e2e: la celda CRUDA, sin resolver — mismo contrato que `gate`, y por
      // el mismo motivo. Los tres estados de esta celda (recorridos / el token
      // `no` / no declarado) los resuelve gates.js#resolveE2e; este parser no
      // sabe de e2e igual que no sabe de gates.
      e2e: (cells[iE2e] || '').trim(),
```

**No** añadir `E2E` a `missingOptionalColumns`. El comentario que lo justifica va donde está el de `Gate`:

```js
  // "E2E" tampoco entra en missingOptionalColumns, por el MISMO motivo que
  // "Gate" (arriba): cada entrada de esa lista produce un aviso con la
  // CONSECUENCIA de que falte la columna, y la consecuencia de que falte
  // "E2E" es que ningún slice del epic tiene e2e — que es exactamente el
  // comportamiento anterior a esta ronda. Avisarlo en todos los repos que no
  // usan la feature es ruido puro.
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-columna.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: 2199 tests, 1 failed — el mismo fallo preexistente de `SLICES_PRISTINE_HASHES` con **un solo** hash en su mensaje, y ninguno más.

- [ ] **Step 6: Commit**

```bash
git add scripts/slices.js __tests__/e2e-columna.test.js
git commit -m "feat(slices): la columna E2E, como celda cruda

Undécima columna, opcional, parseada con el mismo contrato que \`Gate\`:
la celda llega cruda y la resuelve otro módulo. Su ausencia no avisa,
por el mismo motivo que la de \`Gate\`: la consecuencia es el
comportamiento de hoy.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: `resolveE2e` y el gate derivado

**Files:**
- Modify: `scripts/gates.js` (objeto `GATES`; nueva función `resolveE2e`; firma de `resolveGates`)
- Test: `__tests__/e2e-resolucion.test.js` (crear)

**Interfaces:**
- Consumes: `slice.e2e` (string crudo) de la Task 1.
- Produces:
  - `export const E2E_NONE_TOKENS = new Set(['no', 'n/a'])`
  - `export function resolveE2e(cell) -> { runs: string[], declared: boolean, none: boolean, contradiction: boolean }`
  - `resolveGates(type, cell, e2eCell)` — tercer parámetro **opcional**; sin él, el comportamiento es idéntico al de hoy.
  - `GATES.e2e` con sus claves `kickoff` e `issue`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-resolucion.test.js`:

```js
// ============================================================================
// Los TRES estados de la celda E2E, y por qué son tres y no dos.
//
// Una celda vacía significaría dos cosas incompatibles: (a) se pensó y este
// slice no tiene nada que atravesar, y (b) nadie rellenó la columna. Mismo
// resultado, indistinguibles — y con (b) la feature queda inerte sin que nadie
// se entere. Es la ambigüedad que GATE_LABEL_NONE ya resolvió para el caso
// gemelo, con una diferencia que decide el diseño: gate:none lo DERIVA el
// plugin, y aquí la distinción sólo la sabe quien escribe el spec. No hay
// forma de derivarla, así que se declara.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { resolveE2e, resolveGates, GATES, gateLabels, gatesFromLabels } from '../scripts/gates.js'

describe('resolveE2e — los tres estados', () => {
  it('recorridos: declarado, con e2e', () => {
    const r = resolveE2e('levantado con el example\\, curl -i :9115/metrics responde 200')
    expect(r.runs).toEqual(['levantado con el example, curl -i :9115/metrics responde 200'])
    expect(r.declared).toBe(true)
    expect(r.none).toBe(false)
    expect(r.contradiction).toBe(false)
  })

  it('dos recorridos separados por coma no escapada son dos', () => {
    expect(resolveE2e('recorrido uno, recorrido dos').runs).toEqual(['recorrido uno', 'recorrido dos'])
  })

  it('el token `no` es declarado y sin e2e', () => {
    for (const cell of ['no', 'NO', ' no ', '`no`', '**no**', 'n/a', 'N/A']) {
      const r = resolveE2e(cell)
      expect(r.declared, cell).toBe(true)
      expect(r.none, cell).toBe(true)
      expect(r.runs, cell).toEqual([])
    }
  })

  it('un marcador de sin-valor es NO DECLARADO, no un `no`', () => {
    for (const cell of ['', '-', '–', '—', '―', '−', '--', '   ']) {
      const r = resolveE2e(cell)
      expect(r.declared, cell).toBe(false)
      expect(r.none, cell).toBe(false)
      expect(r.runs, cell).toEqual([])
    }
  })

  it('un recorrido que EMPIEZA por "no" es un recorrido, no el token', () => {
    const r = resolveE2e('no se puede acceder a /metrics sin levantar el server')
    expect(r.none).toBe(false)
    expect(r.runs).toEqual(['no se puede acceder a /metrics sin levantar el server'])
  })

  it('el token junto a un recorrido es una contradicción', () => {
    const r = resolveE2e('no, curl -i :9115/metrics responde 200')
    expect(r.contradiction).toBe(true)
    expect(r.declared).toBe(true)
  })

  it('un recorrido vacío entre comas se descarta en silencio', () => {
    expect(resolveE2e('uno,, dos').runs).toEqual(['uno', 'dos'])
  })
})

describe('el gate e2e derivado', () => {
  it('con recorridos, resolveGates añade e2e', () => {
    expect(resolveGates('backend', '–', 'curl -i :9115/metrics').gates).toEqual(['plan', 'e2e'])
  })

  it('con el token `no`, no lo añade', () => {
    expect(resolveGates('backend', '–', 'no').gates).toEqual(['plan'])
  })

  it('sin celda E2E (tercer argumento ausente), el comportamiento es el de hoy', () => {
    expect(resolveGates('ui', '–').gates).toEqual(['visual', 'plan'])
    expect(resolveGates('backend', '–').gates).toEqual(['plan'])
  })

  it('ningún Tipo implica e2e por sí solo', () => {
    for (const t of ['ui', 'infra', 'backend', '']) {
      expect(resolveGates(t, '–', '–').gates, t).not.toContain('e2e')
    }
  })

  it('e2e va ÚLTIMO en el orden canónico', () => {
    expect(resolveGates('ui', 'apply', 'un recorrido').gates).toEqual(['visual', 'apply', 'plan', 'e2e'])
  })

  it('el vocabulario incluye e2e con sus dos textos', () => {
    expect(Object.keys(GATES)).toEqual(['visual', 'apply', 'plan', 'e2e'])
    expect(GATES.e2e.kickoff).toMatch(/## E2E/)
    expect(GATES.e2e.kickoff).toMatch(/AGENTS\.md/)
    expect(GATES.e2e.issue).toMatch(/e2e/)
  })

  // El canal por el que el gate SOBREVIVE: /ct-next reconstruye el slice que
  // despacha a partir del ISSUE, así que un gate que no vuelva de sus labels
  // se pierde en un redespacho, en un --reopen y tras un /clear.
  it('la label sobrevive la ida y vuelta', () => {
    const gates = resolveGates('ui', '–', 'un recorrido').gates
    const labels = gateLabels(gates)
    expect(labels).toEqual(['gate:visual', 'gate:plan', 'gate:e2e'])
    const back = gatesFromLabels(labels)
    expect(back.gates).toEqual(gates)
    expect(back.declared).toBe(true)
    expect(back.unknown).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-resolucion.test.js`
Expected: FAIL — `resolveE2e is not a function`.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/gates.js`, añadir la entrada `e2e` **al final** del objeto `GATES` (el orden del objeto ES el orden canónico):

```js
  e2e: {
    // El único gate cuyo CONTENIDO viaja en una columna propia: los otros tres
    // son un token que se explica solo, y éste necesita decir QUÉ atravesar.
    // Por eso el texto manda al agente a la sección del issue en vez de
    // describir un recorrido: el recorrido lo escribió un humano al congelar y
    // no se puede reproducir aquí sin duplicarlo.
    //
    // Y por eso el kickoff nombra AGENTS.md: el guion viaja congelado desde el
    // spec, pero CÓMO se levanta este repo no lo puede saber el plugin — lo
    // declara el repo destino. Sin esa sección, el resultado es "no se pudo
    // comprobar", nunca un rojo y nunca una travesía improvisada.
    kickoff: 'GATE HUMANO `e2e` (lo pide el spec para ESTE slice, en la columna `E2E` de su fila): antes de abrir el PR, atraviesa los recorridos que trae la sección `## E2E` de tu issue — ésos y sólo ésos, no añadas ni quites ninguno. Cómo se levanta este repo lo dice la sección `## Cómo se atraviesa este repo (e2e)` de `AGENTS.md`: si no está rellenada, el veredicto es `no-verificado` con ese motivo, NUNCA rojo y nunca inventarse cómo arrancarlo. Escribe el informe en `docs/superpowers/e2e/<issue>.md` con el comando literal y su salida real por cada recorrido, commitéalo, y pégalo como comentario del PR. Si algún recorrido sale ROJO, PARA sin liberar. No lo cierras tú: lo cierra quien revisa.',
    issue: '**`e2e`** — este slice declara recorridos en la columna `E2E` de su fila: el PR debe traer el informe de haberlos atravesado (`docs/superpowers/e2e/<issue>.md`, commiteado y pegado como comentario) con el comando y su salida por cada uno. Un recorrido en rojo impide el `--release`; uno que no se pudo comprobar libera, pero lo dice. El agente no puede darlo por cumplido.',
  },
```

Añadir el token y el resolvedor, después de `parseGateCell`:

```js
// E2E_NONE_TOKENS: la declaración POSITIVA de que este slice no tiene nada que
// atravesar. Existe por lo mismo que GATE_LABEL_NONE (arriba): sin ella, una
// celda vacía significaría a la vez "se pensó y no hay" y "nadie rellenó la
// columna", y con lo segundo la feature queda inerte sin que nadie se entere.
// La diferencia con GATE_LABEL_NONE es que aquélla la DERIVA el plugin y ésta
// no se puede derivar: sólo lo sabe quien escribe el spec.
export const E2E_NONE_TOKENS = new Set(['no', 'n/a'])

// resolveE2e: celda cruda -> { runs, declared, none, contradiction }.
//
// LA COMPARACIÓN DEL TOKEN ES SOBRE LA CELDA ENTERA, NUNCA POR PREFIJO. Un
// recorrido perfectamente legítimo puede empezar por "no" ("no se puede
// acceder a /metrics sin levantar el server"), y leerlo como el token
// convertiría una declaración de trabajo en una renuncia — en silencio, que es
// la peor forma. Es el mismo criterio que state.js aplica al campo `blocked`
// ("sobre la cadena ENTERA, nunca por prefijo") y por el mismo motivo.
//
// UN MARCADOR DE "SIN VALOR" NO ES UN `no`. "–" significa "no he declarado
// nada aquí" — el significado que parseGateCell ya le da, y que aquí NO se
// reinterpreta: se toma literal y produce `declared: false`, que es lo que
// /ct-groom convierte en abort. Reinterpretarlo como "no aplica" devolvería la
// ambigüedad que este token existe para quitar.
export function resolveE2e(cell) {
  const raw = String(cell ?? '').trim()
  if (NO_VALUE.has(cleanGateToken(raw))) return { runs: [], declared: false, none: false, contradiction: false }
  const pieces = splitEscapedCommas(raw).map((x) => x.trim()).filter(Boolean)
  const none = pieces.some((p) => E2E_NONE_TOKENS.has(cleanGateToken(p)))
  const runs = pieces.filter((p) => !E2E_NONE_TOKENS.has(cleanGateToken(p)))
  return { runs, declared: true, none, contradiction: none && runs.length > 0 }
}
```

Añadir el import de `splitEscapedCommas` en la cabecera de `gates.js`:

```js
// splitEscapedCommas se importa de slices.js —y no se duplica— porque la
// columna E2E se trocea EXACTAMENTE igual que `Acepta`, y por el mismo motivo:
// un recorrido lleva comas casi siempre. NO_VALUE sí sigue duplicado aquí (ver
// su comentario): son seis caracteres y evita que kickoff.js arrastre el
// parser entero.
import { splitEscapedCommas } from './slices.js'
```

Extender `resolveGates` con el tercer parámetro:

```js
export function resolveGates(type, cell, e2eCell) {
  const { add, waive, unknown } = parseGateCell(cell)
  // El gate `e2e` NO sale de la columna `Gate`: se DERIVA de que la columna
  // `E2E` traiga algún recorrido. Escrito a mano habría dos sitios diciendo lo
  // mismo, y dos sitios divergen; derivado, no hay forma de pedir un e2e sin
  // decir qué atravesar. Que `e2e` esté igualmente en el vocabulario GATES no
  // es contradictorio: está para poder RECHAZAR un `Gate: e2e` escrito a mano
  // (ct-groom.mjs) y para tener sus dos textos, no para producirlo.
  const derived = resolveE2e(e2eCell).runs.length > 0 ? ['e2e'] : []
  const implied = [...gatesForType(type), ...derived]
  // …resto del cuerpo sin cambios…
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-resolucion.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: mismo fallo preexistente y ninguno más. **Atención:** `__tests__/f21-gate-y-tipo.test.js` y `skills-fork.test.js` pueden afirmar que el vocabulario tiene 3 entradas. Si fallan, actualizarlos **a propósito** (el vocabulario ahora tiene 4) y decirlo en el mensaje del commit.

- [ ] **Step 6: Commit**

```bash
git add scripts/gates.js __tests__/e2e-resolucion.test.js
git commit -m "feat(gates): resolveE2e, y el gate e2e derivado de la columna

Tres estados de celda: recorridos, el token \`no\` (declarado y sin
e2e), y el marcador de sin-valor (NO declarado). El token se compara
sobre la celda entera y nunca por prefijo, para que un recorrido que
empiece por 'no' siga siendo un recorrido.

El gate se DERIVA de la columna, no se escribe en \`Gate\`: escrito a
mano habría dos sitios diciendo lo mismo. Que \`e2e\` esté en el
vocabulario es para poder rechazarlo escrito a mano, no para producirlo.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Los cuatro aborts de `/ct-groom`

**Files:**
- Modify: `scripts/ct-groom.mjs` (bloque de validación de la columna `Gate`, ~línea 297-333)
- Test: `__tests__/e2e-groom-aborts.test.js` (crear)

**Interfaces:**
- Consumes: `resolveE2e` de la Task 2, `slice.e2e` de la Task 1.
- Produces: nada nuevo exportado. Cuatro entradas en `hardErrors`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-groom-aborts.test.js`, siguiendo el estilo de invocación por subproceso de `f21-gate-y-tipo.test.js` (spec en un tmpdir, `spawnSync` del ejecutable con `--dry-run`, aserción sobre `status` y `stderr`):

```js
// ============================================================================
// Las cuatro condiciones de abort de la columna E2E. Las cuatro son la misma
// familia: el spec dice dos cosas incompatibles sobre la MISMA fila, y no se
// elige un ganador en silencio.
//
// Por qué ABORTA y no avisa: un aviso dejaría viva la ambigüedad que el token
// `no` existe para quitar (los avisos se ignoran, y F14 documenta lo que pasa
// con los que se ignoran), y entonces el token no habría servido para nada.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const GROOM = new URL('../scripts/ct-groom.mjs', import.meta.url).pathname

const specWith = (gateCell, e2eCell) => `# Spec

Estado: CONGELADA

## Hipótesis del experimento
Que esto funcione.

## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | E2E |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-----|
| 1 | uno | backend | algo | – | un criterio | – | core | – | ${gateCell} | ${e2eCell} |
`

function groom(gateCell, e2eCell) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-e2e-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  const spec = join(dir, 'docs', 'spec.md')
  writeFileSync(spec, specWith(gateCell, e2eCell))
  const r = spawnSync(process.execPath, [GROOM, '--spec', spec, '--repo', 'o/r', '--dry-run'], { encoding: 'utf8' })
  rmSync(dir, { recursive: true, force: true })
  return r
}

describe('aborts de la columna E2E', () => {
  it('celda sin declarar (guion) aborta y nombra la fila', () => {
    const r = groom('–', '–')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/E2E/)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/\bno\b/)
  })

  it('el token junto a un recorrido aborta', () => {
    const r = groom('–', 'no, curl -i :9115/metrics')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
  })

  it('Gate: e2e con la celda diciendo `no` aborta', () => {
    const r = groom('e2e', 'no')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
  })

  it('Gate: e2e con la celda sin declarar aborta', () => {
    const r = groom('e2e', '–')
    expect(r.status).not.toBe(0)
  })

  it('celda `no` sin nada más NO aborta', () => {
    const r = groom('–', 'no')
    expect(r.status).toBe(0)
  })

  it('celda con un recorrido NO aborta', () => {
    const r = groom('–', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-groom-aborts.test.js`
Expected: FAIL — los cuatro primeros salen con status 0 (no hay validación todavía). Si el spec de prueba es rechazado por otra razón (falta una sección obligatoria), ajustar `specWith` hasta que el caso feliz salga 0 **antes** de implementar; un test que falla por el motivo equivocado no prueba nada.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/ct-groom.mjs`, junto a `unknownGateRows`/`contradictoryGateRows`, acumular y emitir:

```js
  // Las cuatro condiciones de abort de la columna E2E. Todas comparten forma
  // con las dos de `Gate` (arriba) y con el mismo criterio: /ct-groom valida
  // TODO antes de escribir nada, y --dry-run comprueba exactamente lo mismo.
  const e2eUndeclaredRows = []
  const e2eContradictoryRows = []
  const e2eGateWithoutRunsRows = []
  for (const s of slices) {
    const r = resolveE2e(s.e2e)
    // Sólo se exige decisión si la COLUMNA existe: un spec anterior a esta
    // ronda no la tiene, y ahí "no declarado" es el estado correcto de todas
    // sus filas. La columna presente es el compromiso; ausente, no hay nada
    // que reprochar.
    if (e2eColumnPresent && !r.declared) e2eUndeclaredRows.push({ n: s.n })
    if (r.contradiction) e2eContradictoryRows.push({ n: s.n })
    if (parseGateCell(s.gate).add.includes('e2e') && r.runs.length === 0) e2eGateWithoutRunsRows.push({ n: s.n, none: r.none })
  }
  if (e2eUndeclaredRows.length) {
    const first = e2eUndeclaredRows[0]
    hardErrors.push(`${e2eUndeclaredRows.length} fila(s) de la tabla §9 tienen la columna "E2E" sin declarar (ejemplo, slice #${first.n}) — esta tabla TIENE columna "E2E", así que cada fila tiene que decidir: escribe el recorrido a atravesar, o "no" si este slice no tiene nada que atravesar. Un guion ahí significa "no he declarado nada" (el mismo significado que en Dep/Acepta/Protegido/Área/Toca), y con eso no se distingue "se pensó y no hay" de "nadie rellenó la columna" — que es justo la ambigüedad que el token "no" existe para quitar. Si este epic no usa e2e en absoluto, quita la columna entera`)
  }
  if (e2eContradictoryRows.length) {
    const first = e2eContradictoryRows[0]
    hardErrors.push(`${e2eContradictoryRows.length} fila(s) de la tabla §9 dicen "no" Y declaran un recorrido en la MISMA celda "E2E" (ejemplo, slice #${first.n}) — no se elige un ganador en silencio: deja el recorrido, o deja el "no", y vuelve a intentarlo`)
  }
  if (e2eGateWithoutRunsRows.length) {
    const first = e2eGateWithoutRunsRows[0]
    hardErrors.push(`${e2eGateWithoutRunsRows.length} fila(s) de la tabla §9 declaran el gate "e2e" en la columna "Gate" pero su celda "E2E" ${first.none ? 'dice "no"' : 'está sin declarar'} (ejemplo, slice #${first.n}) — nadie sabría qué atravesar. El gate "e2e" no se escribe a mano: se DERIVA de que la columna "E2E" traiga un recorrido. Quita el "e2e" de la columna "Gate" y escribe el recorrido en "E2E"`)
  }
```

`e2eColumnPresent` sale del análisis de la tabla. Si `analyzeSlicesTable` no lo expone, añadirlo a su valor de retorno en `scripts/slices.js` (`e2eColumnPresent: iE2e !== -1`) — es un bit, y derivarlo en `ct-groom.mjs` mirando las celdas es imposible: una columna presente con todas las celdas en guion es indistinguible de una columna ausente.

Añadir `resolveE2e` y `parseGateCell` al import de `gates.js` en `ct-groom.mjs` si no están.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-groom-aborts.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: mismo fallo preexistente y ninguno más.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-groom.mjs scripts/slices.js __tests__/e2e-groom-aborts.test.js
git commit -m "feat(groom): los cuatro aborts de la columna E2E

Celda sin declarar (con la columna presente), token junto a recorrido,
y las dos formas de declarar el gate e2e a mano sin recorrido. Aborta y
no avisa: un aviso dejaría viva la ambigüedad que el token \`no\` existe
para quitar.

Sólo se exige decisión si la COLUMNA existe — un spec anterior a esta
ronda no la tiene, y ahí 'no declarado' es el estado correcto.
analyzeSlicesTable expone e2eColumnPresent porque ese bit no se puede
derivar de las celdas: una columna con todo en guion es indistinguible
de una columna ausente.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: La sección `## E2E` del issue

**Files:**
- Modify: `scripts/groom.js` (`E2E_HEADING`, `renderE2eContent`, `buildIssueBody`, `buildLabels` vía `gatesOf`)
- Modify: `scripts/reconcile.js` (divergencia de la sección nueva)
- Test: `__tests__/e2e-issue-body.test.js` (crear)

**Interfaces:**
- Consumes: `resolveE2e`, `resolveGates` de la Task 2.
- Produces:
  - `export const E2E_HEADING = '## E2E'`
  - `export function renderE2eContent(slice) -> string` (líneas `- <recorrido>`)
  - `gatesOf(slice)` pasa ahora `slice.e2e` como tercer argumento de `resolveGates`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-issue-body.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildIssueBody, buildLabels, renderE2eContent, E2E_HEADING, GATES_HEADING } from '../scripts/groom.js'

const slice = (e2e) => ({
  n: 5, issue: null, name: 'exposición y exporter', type: 'backend',
  entrega: 'get_metrics y el router', gate: '–', deps: [],
  ac: ['un criterio'], protected: '', area: ['core'], touches: [], e2e,
})

describe('la sección ## E2E del cuerpo del issue', () => {
  it('con recorridos, se emite con uno por línea y verbatim', () => {
    const body = buildIssueBody(slice('levantado con el example\\, curl -i :9115/metrics responde 200, el server escucha en 9115'), null)
    expect(body).toContain(E2E_HEADING)
    expect(body).toContain('- levantado con el example, curl -i :9115/metrics responde 200')
    expect(body).toContain('- el server escucha en 9115')
  })

  it('con `no`, la sección NO se emite', () => {
    expect(buildIssueBody(slice('no'), null)).not.toContain(E2E_HEADING)
  })

  it('sin columna, la sección NO se emite', () => {
    expect(buildIssueBody(slice(''), null)).not.toContain(E2E_HEADING)
  })

  it('la sección va DESPUÉS de ## Gates', () => {
    const body = buildIssueBody(slice('un recorrido'), null)
    expect(body.indexOf(E2E_HEADING)).toBeGreaterThan(body.indexOf(GATES_HEADING))
  })

  it('con recorridos, la label gate:e2e se emite', () => {
    expect(buildLabels(slice('un recorrido'))).toContain('gate:e2e')
  })

  it('con `no`, la label gate:e2e NO se emite', () => {
    expect(buildLabels(slice('no'))).not.toContain('gate:e2e')
  })

  it('renderE2eContent es la única fuente de verdad del contenido', () => {
    expect(renderE2eContent(slice('uno, dos'))).toBe('- uno\n- dos')
  })
})

// El caso de mesa que fija la proporción real, y que es el argumento de todo el
// diseño: si esto produjera un e2e por slice, un epic de 8 daría 6 informes de
// relleno — la forma más segura de que nadie leyera el séptimo. Medido a mano
// sobre mo-monitoring v1 aplicando el criterio "¿hace falta el sistema en pie?".
describe('mo-monitoring v1 como caso de mesa', () => {
  const filas = [
    { n: 1, name: 'esqueleto', type: 'infra', e2e: 'no' },
    { n: 2, name: 'modelo y environment', type: 'backend', e2e: 'no' },
    { n: 3, name: 'repositorio prometheus', type: 'backend', e2e: 'no' },
    { n: 4, name: 'summary collector', type: 'backend', e2e: 'no' },
    { n: 5, name: 'exposición y exporter', type: 'backend', e2e: 'levantado con el example\\, curl -i :9115/metrics responde 200 con content type text/plain; version=0.0.4' },
    { n: 6, name: 'logging JSON', type: 'backend', e2e: 'no' },
    { n: 7, name: 'instrument y guard', type: 'backend', e2e: 'no' },
    { n: 8, name: 'golden tests de paridad', type: 'backend', e2e: 'el example compila con cargo build --examples y sirve /metrics' },
  ].map((f) => ({ ...f, issue: null, entrega: '', gate: '–', deps: [], ac: ['x'], protected: '', area: ['core'], touches: [] }))

  it('exactamente 2 de 8 producen gate:e2e', () => {
    const conE2e = filas.filter((f) => buildLabels(f).includes('gate:e2e'))
    expect(conE2e.map((f) => f.n)).toEqual([5, 8])
  })

  it('las 6 con `no` no emiten sección ## E2E', () => {
    for (const f of filas.filter((f) => f.e2e === 'no')) {
      expect(buildIssueBody(f, null), `slice #${f.n}`).not.toContain(E2E_HEADING)
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-issue-body.test.js`
Expected: FAIL — `E2E_HEADING` es `undefined`.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/groom.js`:

```js
// E2E_HEADING: la sección de recorridos del cuerpo del issue. Constante
// exportada por el mismo motivo que GATES_HEADING: la nombran quien la escribe
// (buildIssueBody), quien detecta divergencia (reconcile.js) y quien la lee en
// la puerta del release (dispatch-check.mjs). Tres consumidores, una fuente.
export const E2E_HEADING = '## E2E'

// renderE2eContent: los recorridos, uno por línea y VERBATIM. Verbatim porque
// la puerta del release exige que el título de cada entrada del informe cite el
// recorrido tal cual: si esta función reformateara (capitalizar, quitar un
// punto final), el agente citaría lo que ve y la comparación fallaría por un
// carácter que nadie escribió.
export function renderE2eContent(slice) {
  return resolveE2e(slice.e2e).runs.map((r) => `- ${r}`).join('\n')
}
```

`gatesOf` pasa la celda:

```js
export function gatesOf(slice) {
  return resolveGates(slice.type, slice.gate, slice.e2e)
}
```

En `buildIssueBody`, después del bloque de `GATES_HEADING` y antes de `## Out of scope / Protected`:

```js
  // La sección se emite SÓLO si hay recorridos — a diferencia de "## Gates",
  // que se emite siempre. El motivo de aquélla ("«este slice no tiene gates»
  // es una afirmación que un humano que abre el PR necesita poder leer") no
  // aplica aquí: la ausencia de la sección ya lo dice, y emitirla vacía en las
  // tres cuartas partes de los issues es ruido. Medido en mo-monitoring v1:
  // 6 de 8 filas no tienen recorrido.
  const e2eContent = renderE2eContent(slice)
  if (e2eContent) {
    lines.push(E2E_HEADING)
    lines.push(e2eContent)
    lines.push('')
  }
```

En `scripts/reconcile.js`, añadir la sección a la comparación de divergencia siguiendo el patrón exacto de `GATES_HEADING` allí (misma pareja `locateSection`/`extractSectionContent`, mismo trato de "no la aplica sin `--reconcile`").

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-issue-body.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: mismo fallo preexistente. Los tests de `buildIssueBody` existentes que afirmen el orden exacto de secciones pueden fallar: actualizarlos, la sección nueva es deliberada.

- [ ] **Step 6: Commit**

```bash
git add scripts/groom.js scripts/reconcile.js __tests__/e2e-issue-body.test.js
git commit -m "feat(groom): la sección ## E2E del cuerpo del issue

Los recorridos, uno por línea y verbatim — verbatim porque la puerta del
release exige que el informe cite cada recorrido tal cual, y cualquier
reformateo haría fallar la comparación por un carácter que nadie
escribió.

Se emite sólo si hay recorridos, al contrario que ## Gates: la ausencia
ya dice lo que hay que saber, y emitirla vacía en 6 de cada 8 issues es
ruido.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: La sección de `AGENTS.md` y el contrato v19

**Files:**
- Modify: `scripts/ct-init.sh` (`SLICES_CONTRACT_VERSION`, el bloque del contrato, la siembra de la sección nueva)
- Test: `__tests__/e2e-agents-md.test.js` (crear)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: la sección `## Cómo se atraviesa este repo (e2e)` en el `AGENTS.md` del repo destino, entre marcadores propios.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-agents-md.test.js`, siguiendo el estilo de `ct-init.test.js` (repo temporal, `spawnSync` de `ct-init.sh`, aserción sobre el `AGENTS.md` resultante):

```js
// ============================================================================
// La sección de AGENTS.md que declara CÓMO se atraviesa este repo.
//
// El plugin gobierna repos ajenos y no puede saber cómo se pone en pie uno: en
// una librería Rust es `cargo run --example` y un puerto; en una app con
// staging es un navegador y flags. Lo declara el dueño del repo, igual que ya
// declara build/test/lint.
//
// Y OJO CON LO QUE NO SE REUTILIZA: SLICES_PRISTINE_HASHES hashea su bloque
// para detectar si el usuario lo tocó. Aquí sería al revés — esta sección es
// una PLANTILLA que el usuario TIENE que rellenar, y con hashes de pristine
// rellenarla se leería como manipulación. Mismo código, propósito opuesto: se
// toman los marcadores y la siembra, y se deja fuera versión y pristine.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INIT = new URL('../scripts/ct-init.sh', import.meta.url).pathname

function initIn(existingAgents) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e-'))
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
  if (existingAgents != null) writeFileSync(join(dir, 'AGENTS.md'), existingAgents)
  const r = spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return { r, agents }
}

describe('la sección de travesía en AGENTS.md', () => {
  it('se siembra con sus cinco campos y el plazo por defecto', () => {
    const { agents } = initIn(null)
    expect(agents).toContain('## Cómo se atraviesa este repo (e2e)')
    for (const f of ['Levantar:', 'Listo cuando:', 'Plazo:', 'Tirar:', 'Herramientas:', 'Fuera de límites:']) {
      expect(agents, f).toContain(f)
    }
    expect(agents).toMatch(/por defecto 60/)
  })

  it('rellenarla NO hace que el plugin deje de reconocerla', () => {
    const { agents } = initIn(null)
    const relleno = agents.replace('- Levantar:', '- Levantar:      cargo run --example serve')
    const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e2-'))
    spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    writeFileSync(join(dir, 'AGENTS.md'), relleno)
    const r = spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(r.status).toBe(0)
    expect(after).toContain('cargo run --example serve')
    expect(after).toContain('## Cómo se atraviesa este repo (e2e)')
  })

  it('no duplica la sección al correr dos veces', () => {
    const { agents } = initIn(null)
    const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e3-'))
    spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    writeFileSync(join(dir, 'AGENTS.md'), agents)
    spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(after.match(/## Cómo se atraviesa este repo \(e2e\)/g)).toHaveLength(1)
  })

  it('el contrato de la tabla de slices va por la v19 y documenta la columna E2E', () => {
    const { agents } = initIn(null)
    expect(agents).toMatch(/contrato.*v19|v19/)
    expect(agents).toContain('E2E')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-agents-md.test.js`
Expected: FAIL — la sección no existe. Si la firma de invocación de `ct-init.sh` no es `bash ct-init.sh <dir>`, corregir el helper mirando `__tests__/ct-init.test.js` **antes** de implementar.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/ct-init.sh`:

1. `SLICES_CONTRACT_VERSION=18` → `19`. Y añadir el hash del bloque nuevo a `SLICES_PRISTINE_HASHES` **sin quitar los anteriores** (el fichero ya dice «se añade, nunca se quita»). El hash se calcula **después** de editar el texto del bloque, sembrándolo en un repo limpio y hasheando lo sembrado — nunca a mano:

```bash
TMP=$(mktemp -d) && git init -q "$TMP" && bash scripts/ct-init.sh "$TMP" >/dev/null
awk '/<!-- ct-init:slices-contract -->/,/<!-- \/ct-init:slices-contract -->/' "$TMP/AGENTS.md" | shasum -a 256
rm -rf "$TMP"
```

Ese sha256 es la línea que se añade a `SLICES_PRISTINE_HASHES`. Si el bloque se vuelve a tocar en una tarea posterior, hay que recalcularlo — un hash que no corresponda al texto sembrado hace que `ct-init` trate como «tocado por el usuario» un bloque recién puesto por él mismo.
2. En el bloque del contrato, documentar la columna `E2E`: que es opcional, que si está hay que decidir fila por fila, que el token es `no`, y que un guion aborta.
3. Sembrar la sección nueva con sus propios marcadores, siguiendo el patrón de `SLICES_MARKER_OPEN`/`CLOSE` pero **sin** versión ni hash pristine:

```bash
E2E_MARKER_OPEN='<!-- ct-init:e2e-howto -->'
E2E_MARKER_CLOSE='<!-- /ct-init:e2e-howto -->'
E2E_HEADING='## Cómo se atraviesa este repo (e2e)'
# Sin versión y sin hash pristine, a propósito. El bloque del contrato de
# slices los lleva para detectar si el usuario lo tocó y decidir si se puede
# actualizar; esta sección es lo contrario — una PLANTILLA que el usuario TIENE
# que rellenar. Con un hash de pristine, rellenarla se leería como
# manipulación y el plugin dejaría de tocarla justo cuando está bien usada.
# Mismo mecanismo, propósito opuesto. Aquí la regla es la simple: si los
# marcadores ya están, no se toca nada.
```

El cuerpo sembrado:

```markdown
## Cómo se atraviesa este repo (e2e)

<!-- Rellena esto UNA vez. Lo lee el agente de un slice cuya fila declara
     recorridos en la columna E2E de la tabla §9. Si está sin rellenar, el
     agente marca sus recorridos como "no-verificado" y NO se inventa cómo
     levantar el repo. -->

- Levantar:
- Listo cuando:
- Plazo:              (opcional; por defecto 60 segundos)
- Tirar:
- Herramientas:
- Fuera de límites:
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-agents-md.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Correr la suite entera y comprobar el fallo preexistente**

Run: `npm test`
Expected: el fallo de `SLICES_PRISTINE_HASHES` **sigue siendo el mismo fallo, ni uno más**. Esta tarea toca justo ese fichero: si aparecen dos fallos en `ct-init.test.js`, el segundo es de este trabajo y hay que arreglarlo. Comparar contra el número anotado en las Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-init.sh __tests__/e2e-agents-md.test.js
git commit -m "feat(init): la sección de travesía en AGENTS.md, y el contrato a v19

El plugin no puede saber cómo se levanta un repo ajeno: lo declara su
dueño, igual que build/test/lint. Cinco campos, y el plazo con defecto
de 60s porque la mayoría no necesita pensarlo.

Marcadores y siembra reutilizados del bloque del contrato; versión y
hash pristine NO. Aquélla detecta si el usuario tocó un bloque que no
debía; ésta es una plantilla que el usuario TIENE que rellenar, y un
hash de pristine leería el uso correcto como manipulación.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: El paso en la tabla de la máquina

**Files:**
- Modify: `scripts/run-machine.js` (`STEPS`, `RUN_STATES`, `newRun`, `after`, `trasElCommit`; nueva `trasElE2e`)
- Test: `__tests__/e2e-run-machine.test.js` (crear)

**Interfaces:**
- Consumes: nada de tareas anteriores — este módulo es **puro** (ni un import, ni una lectura, ni un reloj) y así se queda.
- Produces:
  - `STEPS.E2E = 'e2e'`
  - `RUN_STATES.BLOCKED_E2E = 'blocked-e2e'`
  - `newRun({ plan, issue, baseSha, tasksTotal, e2eRuns })` — `e2eRuns` es un array de strings; ausente o vacío = este slice no tiene e2e. Se persiste en el run.
  - `after(run, outcome)` acepta `run.step === 'e2e'`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-run-machine.test.js`:

```js
// ============================================================================
// El paso e2e en la tabla. TERMINAL, no por tarea: se entra al comitear la
// ÚLTIMA tarea, y sólo si el run declara recorridos.
//
// Por qué terminal y no por tarea: el e2e verifica lo que la SLICE entrega, y
// una tarea es un commit — pedirle a la tarea 2 de 5 que atraviese un flujo de
// usuario es pedirle que atraviese algo que todavía no existe.
//
// Y por qué en la tabla y no al lado del release: la #31 hizo que la secuencia
// la decida esta función y no la prosa de una skill. Un e2e enganchado en
// paralelo serían dos mecanismos verificando la misma entrega.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { after, newRun, deliveredRun, STEPS, OUTCOMES, RUN_STATES } from '../scripts/run-machine.js'

const enCommitDeLaUltima = (e2eRuns) => ({
  ...newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 2, e2eRuns }),
  task: 2,
  step: STEPS.COMMIT,
})

describe('la entrada al paso e2e', () => {
  it('sin recorridos, la última tarea cierra en DELIVERED como hasta ahora', () => {
    const r = after(enCommitDeLaUltima([]), OUTCOMES.DONE)
    expect(r.state).toBe(RUN_STATES.DELIVERED)
  })

  it('con recorridos, la última tarea abre el paso e2e', () => {
    const r = after(enCommitDeLaUltima(['el server escucha en 9115']), OUTCOMES.DONE)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.E2E)
    expect(r.run.task).toBe(2)
  })

  it('una tarea intermedia NO entra en e2e aunque haya recorridos', () => {
    const run = { ...enCommitDeLaUltima(['un recorrido']), task: 1 }
    const r = after(run, OUTCOMES.DONE)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.IMPLEMENT)
    expect(r.run.task).toBe(2)
  })

  it('newRun guarda los recorridos y los deja congelados', () => {
    const run = newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 1, e2eRuns: ['uno', 'dos'] })
    expect(run.e2eRuns).toEqual(['uno', 'dos'])
    expect(Object.isFrozen(run)).toBe(true)
  })

  it('newRun sin e2eRuns deja una lista vacía, no undefined', () => {
    expect(newRun({ plan: 'p.md', issue: 4, baseSha: 'abc', tasksTotal: 1 }).e2eRuns).toEqual([])
  })
})

describe('las transiciones del paso e2e', () => {
  const enE2e = () => after(enCommitDeLaUltima(['un recorrido']), OUTCOMES.DONE).run

  it('DONE cierra en DELIVERED', () => {
    expect(after(enE2e(), OUTCOMES.DONE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('FAILED cierra en BLOCKED_E2E', () => {
    expect(after(enE2e(), OUTCOMES.FAILED).state).toBe(RUN_STATES.BLOCKED_E2E)
  })

  it('INDETERMINATE cierra en DELIVERED: no verificado NO retiene el slice', () => {
    // Deliberado: un docker que no arranca dejaría el slice en
    // status:in-progress reteniendo area:/touches: y una plaza de cap sin nadie
    // trabajando — el modo de fallo que F13 y F18 se dedicaron a quitar.
    expect(after(enE2e(), OUTCOMES.INDETERMINATE).state).toBe(RUN_STATES.DELIVERED)
  })

  it('DISCARDED repite el paso y suma un descarte', () => {
    const r = after(enE2e(), OUTCOMES.DISCARDED)
    expect(r.state).toBe(RUN_STATES.OPEN)
    expect(r.run.step).toBe(STEPS.E2E)
    expect(r.run.discards).toBe(1)
  })

  it('OVER_BUDGET corta por encima de todo, como en cualquier paso', () => {
    expect(after(enE2e(), OUTCOMES.OVER_BUDGET).state).toBe(RUN_STATES.ABORTED_BUDGET)
  })

  it('CORRECTIONS_ORDERED LANZA: el par que la tabla no describe no se interpreta', () => {
    expect(() => after(enE2e(), OUTCOMES.CORRECTIONS_ORDERED)).toThrow(/transición imposible/)
  })

  it('el run que entra no se toca nunca', () => {
    const antes = enE2e()
    after(antes, OUTCOMES.FAILED)
    expect(antes.step).toBe(STEPS.E2E)
    expect(antes.discards).toBe(0)
  })

  // El gate del release no cambia de criterio: sigue exigiendo `closed:
  // delivered`, y un run parado en e2e no lo tiene. Es lo que hace que no haga
  // falta una puerta nueva para imponer el paso.
  it('un run parado en e2e NO está entregado para deliveredRun', () => {
    const parado = enE2e()
    const r = deliveredRun(JSON.stringify({ ...parado, issue: 4 }), 4)
    expect(r.ok).toBe(false)
    expect(r.why).toMatch(/no está entregado/)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-run-machine.test.js`
Expected: FAIL — `STEPS.E2E` es `undefined`, así que `enCommitDeLaUltima` produce un run cuyo paso `e2e` no existe.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/run-machine.js`:

```js
export const STEPS = Object.freeze({
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  COMMIT: 'commit',
  // E2E — el único paso que NO es por tarea: se entra al comitear la última y
  // sólo si la slice declara recorridos. Va aquí y no colgado de `controls`
  // porque `controls` mide lo que el PLAN prometió contra el árbol, por tarea,
  // y esto atraviesa lo que el SPEC declaró contra el sistema levantado, por
  // slice. Colgarlo de controls obligaría a que cada tarea arrastrara un e2e
  // que no le toca, o a un controls especial en la última — una rama de la
  // tabla que no describe ningún estado real.
  E2E: 'e2e',
})

export const RUN_STATES = Object.freeze({
  OPEN: 'open',
  DELIVERED: 'delivered',
  BLOCKED_CONTROLS: 'blocked-controls',
  BLOCKED_JUDGE: 'blocked-judge',
  BLOCKED_COMMIT: 'blocked-commit',
  // Mismo sitio y misma forma que sus tres hermanos: un cierre en fallo del que
  // sale una persona, no un reintento.
  BLOCKED_E2E: 'blocked-e2e',
  ABORTED_BUDGET: 'aborted-budget',
})
```

En `newRun`, el campo con su comentario:

```js
export function newRun({ plan, issue, baseSha, tasksTotal, e2eRuns }) {
  return freeze({
    plan, issue, baseSha,
    task: 1,
    tasksTotal,
    // e2eRuns — los recorridos que la columna E2E del spec declara para esta
    // slice, sembrados por /ct-next en .agent/SLICE.md (ct-step no habla con
    // GitHub). Lista vacía y no `undefined` a propósito: `[]` significa "esta
    // slice no tiene e2e" y es un dato, mientras que `undefined` no se
    // distingue de "una versión vieja escribió este run".
    e2eRuns: Array.isArray(e2eRuns) ? [...e2eRuns] : [],
    step: STEPS.IMPLEMENT,
    controlRetries: 0,
    judgeRetries: 0,
    correctionRetries: 0,
    discards: 0,
    spendUsd: 0,
  })
}
```

En `after`, un `case` más — sin tocar ninguno de los cuatro existentes:

```js
    case STEPS.E2E: return trasElE2e(run, outcome)
```

Y la función, junto a sus hermanas:

```js
function trasElE2e(run, outcome) {
  switch (outcome) {
    case OUTCOMES.DONE:
      return cerrado(run, RUN_STATES.DELIVERED)
    // El no-verificado ENTREGA. No es indulgencia: si retuviera el run, un
    // docker que no arranca o una credencial caducada dejaría el slice en
    // status:in-progress ocupando `area:`/`touches:` y una plaza de `--cap` sin
    // nadie trabajando — el modo de fallo que F13 y F18 se dedicaron a quitar.
    // Lo que no pasa nunca es que se afirme verde: el motivo viaja en el
    // informe y `--release` lo imprime.
    case OUTCOMES.INDETERMINATE:
      return cerrado(run, RUN_STATES.DELIVERED)
    case OUTCOMES.FAILED:
      return cerrado(run, RUN_STATES.BLOCKED_E2E)
    // Un informe que no se puede leer no gasta reintento: no se tocó el código
    // ni el entorno. Mismo trato que en `implement`, y con el mismo respaldo —
    // el tope de descartes de la slice.
    case OUTCOMES.DISCARDED:
      return abierto(run, { step: STEPS.E2E, discards: run.discards + 1 })
    default:
      return imposible(run, outcome)
  }
}
```

En `trasElCommit`, la única rama existente que se toca — la de la última tarea:

```js
      return run.task < run.tasksTotal
        ? abierto(run, {
            task: run.task + 1,
            step: STEPS.IMPLEMENT,
            controlRetries: 0,
            judgeRetries: 0,
            correctionRetries: 0,
          })
        // Comiteada la última tarea, la slice está implementada — pero si el
        // spec declaró recorridos, todavía no está verificada de punta a punta.
        // `task` NO avanza: el paso es de la slice, no de una tarea sexta que no
        // existe. (Ojo: eso rompe la invariante `commits === task - 1` que
        // ct-step comprueba al cargar el estado — ver Task 8.)
        : (run.e2eRuns || []).length
          ? abierto(run, { step: STEPS.E2E })
          : cerrado(run, RUN_STATES.DELIVERED)
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-run-machine.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: el fallo preexistente y ninguno más. Los tests existentes de `run-machine` que afirmen la forma exacta del run de `newRun` pueden fallar por el campo nuevo: actualizarlos, es deliberado.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-machine.js __tests__/e2e-run-machine.test.js
git commit -m "feat(run-machine): STEPS.E2E, paso terminal de la slice

Se entra al comitear la última tarea y sólo si la slice declara
recorridos; task NO avanza, porque el paso es de la slice y no de una
tarea que no existe. Sin recorridos, la última tarea cierra en DELIVERED
exactamente como hasta ahora.

Los tres estados reusan el vocabulario que ya había: DONE entrega,
FAILED cierra en BLOCKED_E2E (la familia de sus tres hermanos), e
INDETERMINATE entrega — retenerlo dejaría el slice ocupando area:/
touches: sin nadie trabajando, el fallo de F13 y F18.

Sólo se toca UNA transición existente (la rama de la última tarea en
trasElCommit) y se añade un case: un conflicto al rebasar sobre la #31
se resuelve leyendo.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: El esquema del informe

**Files:**
- Modify: `scripts/step-contracts.js` (`E2E_SCHEMA`, `readE2eReport`)
- Test: `__tests__/e2e-schema.test.js` (crear)

**Interfaces:**
- Consumes: `OUTCOMES` de `run-machine.js`.
- Produces: `export function readE2eReport(structured, declaredRuns) -> { outcome, why?, runs? }`
  - `outcome` es un valor de `OUTCOMES`: `DONE`, `FAILED` o `DISCARDED`. `INDETERMINATE` **no** sale de aquí: un informe con no-verificados y ningún rojo es `DONE` con esos motivos dentro (ver el comentario del paso 3).
  - `export const E2E_SCHEMA` — el esquema declarativo que el prompt del agente cita.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-schema.test.js`:

```js
// ============================================================================
// El contrato del informe de e2e: JSON del agente -> un OUTCOME que la tabla
// consume. Hermano de readVerdict/readReport, no copia: mismo patrón (validar a
// mano, cero dependencias nuevas), otro contenido.
//
// LO QUE NO PUEDE COMPROBAR, Y SE DICE PORQUE UN LÍMITE DICHO ES OPERABLE: que
// la salida sea real. Nada impide que un agente invente un stdout — la misma
// clase de agujero que el plugin ya reconoce sobre el `-OK`. Lo único que lo
// acota es exigir el comando REPRODUCIBLE: una salida inventada se cae en
// cuanto alguien la pega.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { readE2eReport } from '../scripts/step-contracts.js'
import { OUTCOMES } from '../scripts/run-machine.js'

const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'
const B = 'el example compila y sirve /metrics'

const verde = (run) => ({
  run, verdict: 'verde',
  brought_up: 'cargo run --example serve',
  evidence: [{ command: 'curl -sS -o /dev/null -w "%{http_code}" localhost:9115/metrics', output: '200' }],
})
const rojo = (run) => ({ run, verdict: 'rojo', brought_up: 'cargo run --example serve', expected: '200', actual: '404', repro: 'curl -i localhost:9115/metrics', refuted_by: 'que el puerto lo ocupe otro proceso' })
const sinVerificar = (run) => ({ run, verdict: 'no-verificado', reason: 'la sección de AGENTS.md está sin rellenar', unblock: 'rellenar "Levantar" y "Listo cuando"' })

describe('readE2eReport', () => {
  it('todo verde → DONE', () => {
    const r = readE2eReport({ runs: [verde(A)] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DONE)
    expect(r.runs).toHaveLength(1)
  })

  it('un rojo → FAILED', () => {
    expect(readE2eReport({ runs: [rojo(A)] }, [A]).outcome).toBe(OUTCOMES.FAILED)
  })

  it('verde + no-verificado → DONE, con el motivo dentro', () => {
    const r = readE2eReport({ runs: [verde(A), sinVerificar(B)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.DONE)
    expect(r.runs.find((x) => x.run === B).reason).toMatch(/AGENTS\.md/)
  })

  it('structured ausente o no objeto → DISCARDED', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(readE2eReport(bad, [A]).outcome, JSON.stringify(bad)).toBe(OUTCOMES.DISCARDED)
    }
  })

  it('falta la entrada de un recorrido → DISCARDED, aunque el otro esté verde', () => {
    const r = readE2eReport({ runs: [verde(A)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
    expect(r.why).toContain(B)
  })

  it('una entrada de más → DISCARDED', () => {
    const r = readE2eReport({ runs: [verde(A), verde(B)] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
    expect(r.why).toContain(B)
  })

  it('un `run` que no es idéntico al declarado → DISCARDED', () => {
    const r = readE2eReport({ runs: [verde('el server escucha en 9115')] }, [A])
    expect(r.outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('un verdict fuera de los tres → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ ...verde(A), verdict: 'ok' }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('un verde sin evidence → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ ...verde(A), evidence: [] }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
    const sinSalida = { ...verde(A), evidence: [{ command: 'curl x', output: '' }] }
    expect(readE2eReport({ runs: [sinSalida] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('un no-verificado sin reason ni unblock → DISCARDED', () => {
    expect(readE2eReport({ runs: [{ run: A, verdict: 'no-verificado' }] }, [A]).outcome).toBe(OUTCOMES.DISCARDED)
  })

  it('EL ROJO GANA AL MAL FORMADO', () => {
    // Un rojo dice algo del PRODUCTO; un formato roto, del informe. Emitiendo
    // el descarte primero, el agente arreglaría el formato, reintentaría y sólo
    // ENTONCES vería el rojo: dos vueltas para un dato que ya se tenía.
    const r = readE2eReport({ runs: [rojo(A)] }, [A, B])
    expect(r.outcome).toBe(OUTCOMES.FAILED)
  })

  it('sin recorridos declarados no se llama a esto, pero si se llama no revienta', () => {
    expect(readE2eReport({ runs: [] }, []).outcome).toBe(OUTCOMES.DONE)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-schema.test.js`
Expected: FAIL — `readE2eReport is not a function`.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/step-contracts.js`, junto a `REPORT_SCHEMA` y `readVerdict`:

```js
export const E2E_VERDICTS = ['verde', 'rojo', 'no-verificado']

// E2E_SCHEMA: lo que se le pide al agente que atraviesa. Declarativo y
// exportado por el mismo motivo que VERDICT_SCHEMA: el prompt lo cita, y dos
// copias a mano de la misma forma divergen (pasó con JUDGE_TOOLS).
export const E2E_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['runs'],
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['run', 'verdict'],
        properties: {
          run: { type: 'string' },
          verdict: { enum: E2E_VERDICTS },
          brought_up: { type: 'string' },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['command', 'output'],
              properties: { command: { type: 'string' }, output: { type: 'string' } },
            },
          },
          expected: { type: 'string' },
          actual: { type: 'string' },
          repro: { type: 'string' },
          refuted_by: { type: 'string' },
          reason: { type: 'string' },
          unblock: { type: 'string' },
        },
      },
    },
  },
})

// readE2eReport: el informe -> un OUTCOME. Validación a mano y no con una
// librería de esquemas, igual que readVerdict y por lo mismo: el spec exige
// cero dependencias nuevas y lo que hay que comprobar cabe aquí.
//
// LA COMPARACIÓN DE `run` ES IDÉNTICA, sólo colapsando espacios. El recorrido
// llega al agente verbatim desde la celda del spec precisamente para que esto
// sea posible; normalizar más (minúsculas, quitar puntuación) haría pasar por
// "el mismo recorrido" dos textos que un humano escribió distintos, y ese
// título es la única prueba de que se atravesó lo que se pidió y no otra cosa.
//
// LO QUE NO COMPRUEBA: que la salida sea real. Ver la cabecera del test.
const colapsa = (s) => String(s || '').replace(/\s+/g, ' ').trim()

export function readE2eReport(structured, declaredRuns) {
  const declared = (declaredRuns || []).map(colapsa).filter(Boolean)
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) {
    return { outcome: OUTCOMES.DISCARDED, why: 'el agente no devolvió structured_output' }
  }
  if (!Array.isArray(structured.runs)) {
    return { outcome: OUTCOMES.DISCARDED, why: '`runs` no es una lista' }
  }
  const problemas = []
  const buenos = []
  const vistos = new Set()
  for (const run of declared) {
    const e = structured.runs.find((x) => x && colapsa(x.run) === run)
    if (!e) { problemas.push(`falta la entrada del recorrido "${run}"`); continue }
    vistos.add(e)
    if (!E2E_VERDICTS.includes(e.verdict)) {
      problemas.push(`el recorrido "${run}" trae un veredicto desconocido: ${JSON.stringify(e.verdict)}`)
      continue
    }
    if (e.verdict === 'verde') {
      const ev = Array.isArray(e.evidence) ? e.evidence.filter((x) => x && esTexto(x.command) && esTexto(x.output)) : []
      if (!ev.length) {
        problemas.push(`el recorrido "${run}" se declara verde sin evidencia: hace falta al menos un par comando/salida`)
        continue
      }
    }
    if (e.verdict === 'no-verificado' && !(esTexto(e.reason) && esTexto(e.unblock))) {
      // El formato de `blocked` (state.js), no el campo: "por qué" y "qué haría
      // falta". Sin las dos, un no-verificado es un encogimiento de hombros que
      // libera el slice sin dejar a nadie sabiendo qué arreglar.
      problemas.push(`el recorrido "${run}" se declara no-verificado sin \`reason\` y \`unblock\``)
      continue
    }
    buenos.push(e)
  }
  for (const e of structured.runs) {
    if (!vistos.has(e)) problemas.push(`el informe trae una entrada que esta slice no declara: "${colapsa(e && e.run)}"`)
  }
  // EL ROJO GANA AL MAL FORMADO: ver el test homónimo.
  if (buenos.some((e) => e.verdict === 'rojo')) {
    return { outcome: OUTCOMES.FAILED, runs: buenos, why: problemas.length ? problemas.join('; ') : null }
  }
  if (problemas.length) return { outcome: OUTCOMES.DISCARDED, why: problemas.join('; ') }
  return { outcome: OUTCOMES.DONE, runs: buenos }
}
```

`esTexto` ya existe en el fichero. Añadir el import de `OUTCOMES`:

```js
import { OUTCOMES } from './run-machine.js'
```

**Comprobar antes de añadirlo** que no crea un ciclo: `run-machine.js` es puro y no importa nada, así que `step-contracts.js → run-machine.js` es una arista nueva y segura. Si por lo que sea `run-machine.js` acabara importando `step-contracts.js`, no añadir el import y devolver las cadenas literales `'done'`/`'failed'`/`'discarded'` con un comentario que diga por qué.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-schema.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: el fallo preexistente y ninguno más. `step-contracts.test.js` puede afirmar la lista de exports: actualizarlo.

- [ ] **Step 6: Commit**

```bash
git add scripts/step-contracts.js __tests__/e2e-schema.test.js
git commit -m "feat(step-contracts): E2E_SCHEMA y readE2eReport

Hermano de readVerdict/readReport: JSON del agente, validado a mano sin
dependencias nuevas, devolviendo un OUTCOME que la tabla consume.

La comparación del recorrido es idéntica salvo espacios: es la única
prueba de que se atravesó lo que se pidió y no otra cosa. Un verde sin
par comando/salida se descarta, y un no-verificado sin reason+unblock
también — un no-verificado sin las dos es un encogimiento de hombros que
libera el slice sin dejar a nadie sabiendo qué arreglar.

El rojo gana al mal formado: emitiendo el descarte primero, el agente
arreglaría el formato y sólo entonces vería el rojo.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: El verbo `ct-step e2e`

**Files:**
- Modify: `scripts/ct-step.mjs` (`EXIT`, `USAGE`, la lista de verbos, la carga del estado, `verboE2e`, `verboNext`, `codigoDe`, el despacho final)
- Test: `__tests__/e2e-ct-step.test.js` (crear)

**Interfaces:**
- Consumes: `STEPS`, `RUN_STATES`, `OUTCOMES` (Task 6); `readE2eReport`, `E2E_SCHEMA` (Task 7).
- Produces: el verbo `e2e`, `EXIT.E2E_RED = 7`, y el fichero `docs/superpowers/e2e/<issue>.md` stageado.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-ct-step.test.js`. El helper monta un worktree de slice completo, copiando el patrón de `mkReleaseDryRunRepo` de `__tests__/dispatch-check-dryrun.test.js` (git init, base, rama, plan con `minimalPlanFor`, `.agent/SLICE.md`) y sembrando además `.agent/run-<issue>.json` en el paso `e2e`:

```js
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STEP = new URL('../scripts/ct-step.mjs', import.meta.url).pathname
const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'

// Un worktree de slice con UNA tarea ya comiteada y el run parado en `e2e`.
// La tarea comiteada importa: ct-step cruza los commits reales con el estado.
function worktreeEnE2e({ tasksTotal = 1, e2eRuns = [A] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-step-e2e-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  git('checkout', '-qb', 'feat/4')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', 'plan.md'), planDeUnaTarea())
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 4\n---\n')
  git('add', '-A'); git('commit', '-qm', 'tarea 1')
  writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/plan.md', issue: 4, baseSha,
    task: tasksTotal, tasksTotal, e2eRuns, step: 'e2e',
    controlRetries: 0, judgeRetries: 0, correctionRetries: 0, discards: 0, spendUsd: 0,
  }, null, 2))
  return dir
}

// El plan mínimo que plan-contract.js acepta y plan-tasks.js sabe trocear, con
// UNA tarea y su bloque **Verification:**. Es el `minimalPlanFor` de
// __tests__/dispatch-check-dryrun.test.js:73, copiado (no importado: los tests
// de este repo no se importan entre sí) y fijado al issue 4.
const FENCE = '```'
const planDeUnaTarea = () => [
  '# #4 — fixture slice',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 1. Context and goal',
  'Fixture.',
  '### Desired end state',
  'Work done.',
  '### Out of scope',
  'N/A — fixture.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| fixture | yes |',
  '## 3. Reference patterns',
  'N/A — fixture.',
  '## 4. Inventory',
  'work.txt',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy',
  'N/A — fixture.',
  '## 7. Tasks',
  '### Task 1 — do the work',
  '**Objective:** the work is committed.',
  '**Files:** work.txt',
  'Final text (work.txt):',
  FENCE,
  'trabajo',
  FENCE,
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.',
  FENCE + 'bash',
  'git log --oneline -1',
  FENCE,
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'None.',
  '',
].join('\n')

const step = (dir, args) => spawnSync(process.execPath, [STEP, ...args, '--plan', 'docs/superpowers/plans/plan.md', '--issue', '4'], { cwd: dir, encoding: 'utf8' })
const informe = (dir, obj) => { const p = join(dir, 'informe.json'); writeFileSync(p, JSON.stringify(obj)); return 'informe.json' }

const VERDE = { runs: [{ run: A, verdict: 'verde', brought_up: 'cargo run --example serve', evidence: [{ command: 'curl -sS localhost:9115/metrics', output: '# HELP x' }] }] }
const ROJO = { runs: [{ run: A, verdict: 'rojo', brought_up: 'cargo run --example serve', expected: '200', actual: '404', repro: 'curl -i localhost:9115/metrics', refuted_by: 'otro proceso en el puerto' }] }

describe('ct-step e2e', () => {
  it('en verde: exit 0, run delivered y el markdown escrito y stageado', () => {
    const dir = worktreeEnE2e()
    try {
      const r = step(dir, ['e2e', informe(dir, VERDE)])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).toBe('delivered')
      const md = join(dir, 'docs', 'superpowers', 'e2e', '4.md')
      expect(existsSync(md)).toBe(true)
      expect(readFileSync(md, 'utf8')).toContain(A)
      const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir, encoding: 'utf8' })
      expect(staged).toContain('docs/superpowers/e2e/4.md')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('en rojo: exit 7, run blocked-e2e y NO delivered', () => {
    const dir = worktreeEnE2e()
    try {
      const r = step(dir, ['e2e', informe(dir, ROJO)])
      expect(r.status).toBe(7)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.closed).not.toBe('delivered')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('fuera de su paso: exit 9 y dice cuál toca', () => {
    const dir = worktreeEnE2e()
    try {
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({ ...run, step: 'implement', task: 1 }))
      const r = step(dir, ['e2e', informe(dir, VERDE)])
      expect(r.status).toBe(9)
      expect(r.stderr).toMatch(/implement/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('el JSON ilegible es un descarte, no un error de uso', () => {
    const dir = worktreeEnE2e()
    try {
      writeFileSync(join(dir, 'roto.json'), '{no es json')
      const r = step(dir, ['e2e', 'roto.json'])
      expect(r.status).toBe(0)
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(run.discards).toBe(1)
      expect(run.step).toBe('e2e')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('`next` en el paso e2e dice qué se espera y cita el esquema', () => {
    const dir = worktreeEnE2e()
    try {
      const r = step(dir, ['next'])
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/e2e/)
      expect(r.stdout).toContain(A)
      expect(r.stdout).toMatch(/AGENTS\.md/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('sin recorridos, el run no entra nunca en e2e (y `next` no lo pide)', () => {
    const dir = worktreeEnE2e({ e2eRuns: [] })
    try {
      const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      writeFileSync(join(dir, '.agent', 'run-4.json'), JSON.stringify({ ...run, step: 'commit' }))
      const r = step(dir, ['commit'])
      const after = JSON.parse(readFileSync(join(dir, '.agent', 'run-4.json'), 'utf8'))
      expect(after.step).not.toBe('e2e')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
```

**Rellenar `planDeUnaTarea()` copiando `minimalPlanFor` de `__tests__/dispatch-check-dryrun.test.js` antes de correr nada.** No inventar la forma del plan: la fija `plan-contract.js`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-ct-step.test.js`
Expected: FAIL — `verbo desconocido: e2e`, exit 2.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/ct-step.mjs`:

1. **`EXIT`**, en el hueco que dejó el mapa:

```js
  E2E_RED: 7,             // algún recorrido de e2e no se completa
```

2. **`USAGE`** y la lista de verbos:

```js
  e2e <fichero.json>        el informe de la travesía de punta a punta de la slice
```

```js
if (!['next', 'report', 'controls', 'verdict', 'commit', 'e2e'].includes(verbo)) {
```

3. **La invariante de los commits.** Al cargar el estado, la comprobación
   `hechos !== run.task - 1` **no vale en el paso `e2e`**: allí las
   `tasksTotal` tareas ya están comiteadas y `task` sigue valiendo
   `tasksTotal`. Su propia rama, con el motivo escrito:

```js
  // En `e2e` la cuenta es otra: el paso es de la SLICE, no de una tarea, así
  // que `task` no avanzó al comitear la última y los commits hechos son
  // `tasksTotal`, no `task - 1`. Sin esta rama, el paso terminal muere en
  // PRECONDITION la primera vez que se entra en él.
  const esperados = run.step === STEPS.E2E ? run.tasksTotal : run.task - 1
  if (hechos !== esperados) {
    die(`el estado y git no cuentan lo mismo: el fichero va por la tarea ${run.task}${run.step === STEPS.E2E ? ' con el e2e pendiente (todas comiteadas)' : ''} y desde ${run.baseSha.slice(0, 7)} hay ${hechos}. No se sigue a ciegas.`, EXIT.PRECONDITION)
  }
```

4. **`verboE2e`**, con la forma de `verboVerdict`:

```js
function verboE2e() {
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del informe de e2e')
  const { outcome, runs, why } = porLeer
    ? { outcome: OUTCOMES.DISCARDED, why: porLeer }
    : readE2eReport(valor, run.e2eRuns)
  medir('e2e', {
    outcome,
    runs: runs ? runs.length : 0,
    red: runs ? runs.filter((r) => r.verdict === 'rojo').length : 0,
    unverified: runs ? runs.filter((r) => r.verdict === 'no-verificado').length : 0,
    why: why || null,
  })
  if (outcome === OUTCOMES.DISCARDED) {
    out(`informe de e2e descartado: ${why}`)
    return outcome
  }
  // El markdown lo escribe el PROGRAMA, no el agente. Mismo reparto que el
  // commit ("comitea el programa, no el implementador"): así no hay prosa que
  // validar, no puede faltar un encabezado ni citarse mal un recorrido, y lo
  // que llega al PR es exactamente lo que el esquema aceptó.
  escribirInformeE2e(runs)
  for (const r of runs) out(`${r.verdict === 'verde' ? 'verde' : r.verdict}: ${r.run}`)
  return outcome
}
```

`escribirInformeE2e(runs)` compone el markdown (un `##` por recorrido con su veredicto, cómo se levantó, los pares comando/salida, y `reason`/`unblock` o los cuatro campos del rojo), lo escribe en `docs/superpowers/e2e/<issue>.md` creando el directorio, y lo stagea con `git(['add', ...])` — igual que `verboReport` stagea las rutas declaradas.

5. **`verboNext`**: la rama del paso `e2e`, que imprime los recorridos, recuerda que el entorno está en `AGENTS.md`, y cita `E2E_SCHEMA`. Sigue el patrón de las cuatro ramas que ya hay.

6. **`codigoDe`**: `case RUN_STATES.BLOCKED_E2E: return EXIT.E2E_RED`.

7. **El despacho final**: añadir `e2e: verboE2e` al objeto de verbos.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-ct-step.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: el fallo preexistente y ninguno más. Si `ct-step.test.js` afirma la lista de verbos o el mapa de `EXIT`, actualizarlo: es deliberado.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-step.mjs __tests__/e2e-ct-step.test.js
git commit -m "feat(ct-step): el verbo e2e, con EXIT.E2E_RED en el 7 que estaba libre

El agente entrega JSON y el markdown del PR lo redacta el programa —
mismo reparto que el commit: así no hay prosa que validar y lo que llega
al PR es exactamente lo que el esquema aceptó.

Y la trampa que este paso destapa: al cargar el estado, ct-step cruza los
commits con \`task - 1\`. En el paso terminal las tareas ya están todas
comiteadas y \`task\` no avanzó, así que esa cuenta no vale y tiene su
propia rama. Sin ella, el paso muere en PRECONDITION la primera vez que
se entra.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Los recorridos llegan al worktree

**Files:**
- Modify: `scripts/kickoff.js` (`buildStateSeed`, `renderKickoff`)
- Modify: `scripts/ct-next.mjs` (pasar los recorridos del issue al seed)
- Test: `__tests__/e2e-semilla.test.js` (crear)

**Interfaces:**
- Consumes: `resolveE2e` (Task 2); el slice reconstruido del issue por `gh-issue-map.js#mapGhIssue`.
- Produces: campo `e2e` (lista) en `.agent/SLICE.md`, y los recorridos nombrados en el kickoff.

**Ojo con los dos nombres, que no es un descuido:** el campo se llama `e2e` en `.agent/SLICE.md` y `e2eRuns` en `.agent/run-<issue>.json`. Son dos ficheros con dos convenciones ya establecidas —`SLICE.md` usa `github_issue`, `last_commit` (snake_case, lo lee un agente); el run usa `tasksTotal`, `baseSha` (camelCase, lo lee un programa)— y unificarlos obligaría a romper una de las dos. Quien los cruza es `ct-step` al crear el run: lee `e2e` de la semilla y lo pasa como `e2eRuns` a `newRun`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-semilla.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildStateSeed, renderKickoff } from '../scripts/kickoff.js'
import { parseStateSafe } from '../scripts/state.js'

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
    const k = renderKickoff(slice('curl -i :9115/metrics responde 200'), { repo: 'o/r', dispatchCheckPath: 'd.mjs', base: 'main' })
    expect(k).toContain('curl -i :9115/metrics responde 200')
    expect(k).toMatch(/ct-step e2e/)
  })

  it('sin recorridos, el kickoff no habla de e2e', () => {
    const k = renderKickoff(slice('no'), { repo: 'o/r', dispatchCheckPath: 'd.mjs', base: 'main' })
    expect(k).not.toMatch(/ct-step e2e/)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-semilla.test.js`
Expected: FAIL — `meta.e2e` es `undefined`.

- [ ] **Step 3: Implementar el mínimo**

En `buildStateSeed`, junto al campo `gates`:

```js
      // e2e — los recorridos que declara la columna E2E del spec. A diferencia
      // de `gates` (que es texto legible y del que su propio comentario avisa
      // que "ningún código del plugin decide nada con él"), ESTE campo SÍ lo lee
      // un programa: `ct-step` lo necesita porque no habla con GitHub. Por eso
      // es una LISTA y no una frase.
      //
      // Y por eso mismo `dispatch-check --release` no se fía de él: este
      // fichero es agent-reachable. La semilla es el canal de trabajo; la
      // prueba se hace contra el issue.
      e2e: resolveE2e(slice.e2e).runs,
```

En `renderKickoff`, nombrar los recorridos cuando los haya (el texto del gate ya viene por `renderGateKickoffLines`; aquí van los recorridos literales y la línea de `ct-step e2e`).

En `scripts/ct-next.mjs`, asegurar que el slice que llega a `buildStateSeed` trae la celda `e2e`. **Comprobar de dónde sale**: si el dispatcher reconstruye el slice desde el issue con `mapGhIssue`, hay que extraer la sección `## E2E` allí (con `extractSectionContent`) y ponerla en el campo — no se puede leer del spec, que el dispatcher no abre.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-semilla.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: el fallo preexistente y ninguno más. Los tests de `buildStateSeed`/`renderKickoff` que afirmen el conjunto exacto de campos o el texto del kickoff pueden fallar: actualizarlos.

- [ ] **Step 6: Commit**

```bash
git add scripts/kickoff.js scripts/ct-next.mjs scripts/gh-issue-map.js __tests__/e2e-semilla.test.js
git commit -m "feat(next): los recorridos llegan al worktree, como lista

ct-step no habla con GitHub, así que /ct-next siembra los recorridos en
.agent/SLICE.md. Es una LISTA y no una frase porque, al contrario que el
campo \`gates\`, este lo lee un programa.

Y por eso mismo --release no se fía de él (Task 10): el fichero es
agent-reachable. La semilla es el canal de trabajo; la prueba se hace
contra el issue.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: `--release` verifica la correspondencia

**Files:**
- Modify: `scripts/dispatch-check.mjs` (bloque `if (release)`, tras la puerta del run entregado)
- Modify: `__tests__/fixtures/fake-gh-bin/gh` (soportar `--json body`)
- Test: `__tests__/e2e-release-correspondencia.test.js` (crear)

**Interfaces:**
- Consumes: `E2E_HEADING` (Task 4), `deliveredRun` (ya existe), `gh-issue-map.js#extractSectionContent`.
- Produces: exit `8` en `--release`.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/e2e-release-correspondencia.test.js`. Reutiliza el helper `mkReleaseDryRunRepo` de `__tests__/dispatch-check-dryrun.test.js` (copiarlo, no importarlo: los tests de este repo no se importan entre sí) y el fake de `gh` con una variable nueva `FAKE_GH_VIEW_BODY`:

```js
import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = new URL('../scripts/dispatch-check.mjs', import.meta.url).pathname
const FAKE_GH = new URL('./fixtures/fake-gh-bin', import.meta.url).pathname
const A = 'el server escucha en 9115 por defecto y en el puerto indicado si se pasa'

const cuerpo = (recorridos) => [
  '## Acceptance criteria (EARS, 1:1 con tests)',
  '- un criterio',
  '',
  '## Gates',
  '- **`plan`** — …',
  ...(recorridos.length ? ['', '## E2E', ...recorridos.map((r) => `- ${r}`)] : []),
  '',
].join('\n')

// Worktree de slice con la tarea comiteada, el plan y el run ENTREGADO. Copiado
// de mkReleaseDryRunRepo (__tests__/dispatch-check-dryrun.test.js:117): los
// tests de este repo no se importan entre sí.
function repo({ e2eRuns = [A], closed = 'delivered', contaminaEstado = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-rel-corr-'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-08-12-issue-9-work.md'), planDeUnaTarea())
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  mkdirSync(join(dir, 'docs', 'superpowers', 'e2e'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'e2e', '9.md'), `## ${A}\n- Veredicto: verde\n`)
  if (contaminaEstado) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\nrole: coordinadora\n---\n')
  }
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 9\nbase: main\n---\n')
  writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
    issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e',
    e2eRuns, closed,
  }, null, 2))
  return dir
}

// `planDeUnaTarea` es el mismo helper de la Task 8, con el issue a 9.

function release(dir, { body, viewFail = false } = {}) {
  const log = join(dir, 'gh-argv.log')
  const r = spawnSync(process.execPath, [SCRIPT, '9', '--repo', 'o/r', '--release'], {
    cwd: dir, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${FAKE_GH}:${process.env.PATH}`,
      FAKE_GH_ARGV_LOG_FILE: log,
      ...(body !== undefined ? { FAKE_GH_VIEW_BODY: body } : {}),
      ...(viewFail ? { FAKE_GH_VIEW_FAIL: '1' } : {}),
      FAKE_GH_VIEW_LABELS: JSON.stringify(['status:in-progress', 'gate:plan', 'gate:e2e']),
    },
  })
  return { ...r, argv: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

describe('--release: correspondencia entre el run y el issue', () => {
  it('run entregado que cubre los recorridos del issue → libera', () => {
    const dir = repo()
    try {
      const r = release(dir, { body: cuerpo([A]) })
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/released #9/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('issue con recorridos y run que NO los declara → exit 8, sin tocar labels', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: cuerpo([A]) })
      expect(r.status).toBe(8)
      expect(r.stderr).toContain(A)
      // La aserción que de verdad importa: NADA se mutó en GitHub.
      expect(r.argv).not.toMatch(/issue edit/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('cuerpo del issue ilegible → exit 8, y NO afirma que no haya recorridos', () => {
    const dir = repo()
    try {
      const r = release(dir, { viewFail: true })
      expect(r.status).toBe(8)
      expect(r.stderr).toMatch(/no se (ha podido|pudo)/i)
      expect(r.stderr).not.toMatch(/no declara recorridos/)
      expect(r.argv).not.toMatch(/issue edit/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('issue sin sección ## E2E → libera sin mirar el run', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      expect(release(dir, { body: cuerpo([]) }).status).toBe(0)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('label gate:e2e sin sección → libera, con aviso por stderr', () => {
    const dir = repo({ e2eRuns: [] })
    try {
      const r = release(dir, { body: cuerpo([]) })
      expect(r.status).toBe(0)
      expect(r.stderr).toMatch(/aviso:/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('el orden manda: una rama que introduce .agent/STATE.md sale 5, no 8', () => {
    const dir = repo({ e2eRuns: [], contaminaEstado: true })
    try {
      expect(release(dir, { body: cuerpo([A]) }).status).toBe(5)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('run NO entregado → sale 7, la puerta que ya existía, no 8', () => {
    const dir = repo({ closed: undefined })
    try {
      expect(release(dir, { body: cuerpo([A]) }).status).toBe(7)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-release-correspondencia.test.js`
Expected: FAIL — hoy libera con exit 0 en todos los casos.

- [ ] **Step 3: Implementar el mínimo**

Extender el fake de `gh` con `FAKE_GH_VIEW_BODY` para el camino `--json body`, junto a `FAKE_GH_VIEW_LABELS` y `FAKE_GH_VIEW_COMMENTS` y con el mismo estilo de comentario.

En `dispatch-check.mjs`, **después** de la puerta del run entregado:

```js
  // F-e2e — LA CORRESPONDENCIA. La máquina de ct-step ya impide entregar un run
  // sin pasar el e2e (run-machine.js), así que esto NO vuelve a verificar la
  // travesía: verifica que el run entregado hable de los MISMOS recorridos que
  // el issue declara.
  //
  // Existe porque el run lee sus recorridos de `.agent/SLICE.md`, que es
  // agent-reachable — este mismo fichero ya desconfía de su `base:` por eso. Un
  // agente que vaciara ese campo tendría un run "entregado" sin haber
  // atravesado nada, y la puerta del 7 lo dejaría pasar. Aquí se cruza contra el
  // ISSUE, que es la fuente que el agente no controla.
  //
  // Y se lee la SECCIÓN `## E2E`, no la label `gate:e2e`: las dos pueden
  // discrepar si alguien edita el issue a mano, y manda la sección porque es la
  // única que dice QUÉ atravesar. Label sin sección no describe trabajo (se
  // libera, con aviso); sección sin label sí (se exige igual).
```

El flujo: leer el cuerpo del issue por `gh` (si falla → `dieErr(..., 8)` diciendo que **no se afirma** que no haya recorridos); extraer la sección; si no hay recorridos, seguir (con aviso por `stderr` si la label está); si hay, comparar contra `run.e2eRuns` del fichero de estado leído por la puerta anterior; si no coinciden → `dieErr(..., 8)` con los que faltan.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-release-correspondencia.test.js`
Expected: PASS, 7 tests.

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: el fallo preexistente y ninguno más.

- [ ] **Step 6: Commit**

```bash
git add scripts/dispatch-check.mjs __tests__/fixtures/fake-gh-bin/gh __tests__/e2e-release-correspondencia.test.js
git commit -m "feat(release): exit 8 si el run entregado no cubre los recorridos del issue

No verifica la travesía otra vez — de eso ya se encarga la máquina. Cruza
lo que el run dice haber atravesado contra lo que el ISSUE declara,
porque el run lo lee de .agent/SLICE.md y ese fichero es agent-reachable:
vaciar ese campo daría un run 'entregado' sin haber atravesado nada.

Lee la sección y no la label: manda la que dice qué atravesar.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: El scope-gate, la documentación y la versión

**Files:**
- Modify: `scripts/scope.js` (`LOOP_ARTIFACT_PATTERNS`)
- Modify: `commands/ct-groom.md`, `commands/ct-next.md`, `commands/ct-step.md`, `README.md`
- Modify: `.claude-plugin/plugin.json`, `package.json` (0.41.0)
- Test: `__tests__/e2e-scope.test.js` (crear)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la exención del scope-gate y la documentación.

- [ ] **Step 1: Escribir el test que falla**

```js
import { describe, it, expect } from 'vitest'
import { LOOP_ARTIFACT_PATTERNS } from '../scripts/scope.js'

describe('el informe de e2e es un artefacto del loop', () => {
  it('docs/superpowers/e2e/** está exento del scope-gate', () => {
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/e2e/**')
  })

  it('es un directorio propio, no la exención del spec', () => {
    // No va al «Registro de cierre» del spec a propósito: esa exención está
    // documentada como el agujero por el que, en el incidente del despacho 1,
    // un agente metió parte de su autorización falsa.
    expect(LOOP_ARTIFACT_PATTERNS.filter((p) => p.includes('e2e'))).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/e2e-scope.test.js`
Expected: FAIL — el patrón no está.

- [ ] **Step 3: Implementar el mínimo**

En `scripts/scope.js`:

```js
  // `ct-step e2e` ESCRIBE aquí el informe de la travesía y lo stagea, así que
  // viaja en el commit de la slice. Directorio PROPIO y no el «Registro de
  // cierre» del spec a propósito: esa exención (specs/**, arriba) es el agujero
  // por el que, en el incidente del despacho 1, un agente metió parte de su
  // autorización falsa — y meter por ahí justo la evidencia de que algo se
  // verificó es la peor combinación posible. Aquí no escribe nadie más.
  'docs/superpowers/e2e/**',
```

Documentar:
- `commands/ct-groom.md`: la columna `E2E`, sus tres estados y los cuatro aborts.
- `commands/ct-step.md`: el verbo `e2e`, su sitio en la secuencia y el `EXIT 7`.
- `commands/ct-next.md`: el exit `8` de `--release` y el campo `e2e` de la semilla.
- `README.md`: la columna en las 4 reglas de celda, el gate en su tabla, el paso en el diagrama de estados del run, y **el límite de falsificación en «Límites conocidos»** (§8.1 del spec).

Versión a `0.41.0` en `.claude-plugin/plugin.json` y `package.json`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/e2e-scope.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Correr la suite entera y cerrar**

Run: `npm test`
Expected: **exactamente 1 fallo**, el preexistente. Comparar con el número anotado al principio.

Run: `git diff --name-only un-solo-go...HEAD | grep -E '^(hooks|dist)/' || echo "sin hooks ni dist: no hace falta npm run build"`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: la exención del scope-gate, la documentación y 0.41.0

El informe va a un directorio propio exento, no al Registro de cierre
del spec: esa exención es el agujero del incidente del despacho 1.

README documenta el límite: la evidencia es falsificable, y lo único que
lo acota es exigir el comando reproducible. Un límite dicho es operable.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Verificación final (antes de abrir el PR)

- [ ] `npm test` — 1 solo fallo, el preexistente de `SLICES_PRISTINE_HASHES`.
- [ ] `git diff --name-only un-solo-go...HEAD` — nada de `hooks/` ni `dist/`, y **nada en `skills/`**.
- [ ] Un spec **sin** columna `E2E` produce exactamente los mismos issues que antes de esta rama.
- [ ] Un slice sin recorridos recorre `implement → controls → judge → commit` y entrega, sin pasar por `e2e`.
- [ ] `node scripts/ct-step.mjs` sin argumentos lista el verbo `e2e` en su `USAGE`.
- [ ] El PR se abre con `--base un-solo-go`, no `main`, y su cuerpo dice que va detrás de #32.
