# F23 — el `ct-order` acotado por milestone: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el emparejado de issues por marcador `<!-- ct-order:N -->` en `/ct-groom` esté acotado al epic (milestone) de la corrida, y que los dos casos en los que ese acotado no puede decidir con seguridad paren la corrida antes de mutar nada.

**Architecture:** dos funciones puras nuevas (`epicTitleOf`/`partitionByEpic` en `scripts/gh-issues.js`, `specTarget` en `scripts/gh-issue-map.js`) y su cableado en `scripts/ct-groom.mjs`, todo dentro del bloque que ya existe entre el fetch de issues (línea ~600) y la primera mutación (creación del milestone, línea ~970). Ninguna llamada a `gh` nueva: se reutiliza el listado que ya se trae.

**Tech Stack:** Node ESM (`.js`/`.mjs`, sin transpilar), vitest, stub de `gh` en `__tests__/fixtures/fake-gh-bin/gh` controlado por variables de entorno.

**Spec:** `docs/superpowers/specs/2026-08-03-ct-order-por-milestone-design.md`

## Global Constraints

- **Worktree:** todo el trabajo va en `/Users/jpereag/Documents/control-tower-plugin-f23`, rama `f23-ct-order-por-milestone`. NUNCA sobre `main`.
- **Idioma:** todo mensaje de usuario, comentario y mensaje de commit va en castellano. Es la convención del repo entero, sin excepciones.
- **Los comentarios son documentación con carga estructural.** Nunca nombrar un fichero, función, línea o conducta que no se haya leído. Un comentario que describe algo que el código ya no hace es un defecto, no ruido.
- **Verificar el efecto, nunca el exit code.** Una comprobación que no puede detener la acción siguiente es decoración.
- **Auditar por propiedad, nunca por lista.** Las listas de ficheros de cada tarea son el punto de partida; si una tarea toca una propiedad, hay que barrer por esa propiedad y enumerar lo que aparezca, aunque no esté en la lista.
- **`dist/` está trackeado** y `hooks/hooks.json` ejecuta `dist/`, no `hooks/`. `npm test` corre `npm run build` antes, así que la suite queda VERDE con un `dist` commiteado obsoleto. F23 no debería tocar `hooks/`; la Tarea 8 lo verifica explícitamente.
- **Suite completa:** `npx vitest run` desde la raíz del worktree. Hoy: 51 ficheros, 1394 tests, verde.
- **No tocar nada del §5 del feedback de campo.** No tocar `/ct-next`: ya está acotado desde D1.

---

### Task 1: `epicTitleOf` y `partitionByEpic` en `scripts/gh-issues.js`

**Files:**
- Modify: `scripts/gh-issues.js` (añadir al final, tras `findByMarker`)
- Test: `__tests__/gh-issues.test.js`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `epicTitleOf(rawIssue) -> string | null` — el título del milestone de un issue crudo de `gh api repos/<o>/<r>/issues`, o `null` si no tiene ninguno (o si el milestone existe pero no trae un título usable).
  - `partitionByEpic(issues, milestoneTitle) -> { inEpic: object[], sinMilestone: object[], otrosEpics: object[] }` — reparte una lista de issues crudos en tres cubos disjuntos. Preserva el orden de entrada dentro de cada cubo.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `__tests__/gh-issues.test.js`, y añadir `epicTitleOf, partitionByEpic` al `import` de la línea 2:

```js
// F23 — el alcance por epic. epicTitleOf/partitionByEpic son a /ct-groom lo
// que epicKeyOf/buildOrderIndex (gh-issue-map.js) son a /ct-next: la misma
// idea, con la llave que cada uno puede permitirse. /ct-next usa el NÚMERO
// del milestone; /ct-groom no puede, porque enumera los issues ANTES de
// resolver el milestone (ver el comentario del call-site en ct-groom.mjs).
describe('epicTitleOf', () => {
  it('devuelve el título del milestone', () => {
    expect(epicTitleOf({ number: 1, milestone: { number: 4, title: 'Epic A' } })).toBe('Epic A')
  })
  it('sin milestone → null', () => {
    expect(epicTitleOf({ number: 1, milestone: null })).toBeNull()
    expect(epicTitleOf({ number: 1 })).toBeNull()
  })
  it('milestone sin título usable → null (no revienta, cae al cubo compartido)', () => {
    expect(epicTitleOf({ milestone: {} })).toBeNull()
    expect(epicTitleOf({ milestone: { title: '' } })).toBeNull()
    expect(epicTitleOf({ milestone: { title: 42 } })).toBeNull()
  })
  it('defensivo: entrada vacía no revienta', () => {
    expect(epicTitleOf(undefined)).toBeNull()
    expect(epicTitleOf(null)).toBeNull()
  })
})

describe('partitionByEpic', () => {
  const issues = [
    { number: 1, milestone: { title: 'Epic A' } },
    { number: 2, milestone: { title: 'Epic B' } },
    { number: 3, milestone: null },
    { number: 4, milestone: { title: 'Epic A' } },
  ]
  it('reparte en los tres cubos, disjuntos y en el orden de entrada', () => {
    const { inEpic, sinMilestone, otrosEpics } = partitionByEpic(issues, 'Epic A')
    expect(inEpic.map((i) => i.number)).toEqual([1, 4])
    expect(sinMilestone.map((i) => i.number)).toEqual([3])
    expect(otrosEpics.map((i) => i.number)).toEqual([2])
  })
  it('el título se compara EXACTO: no hay normalización de mayúsculas ni de espacios', () => {
    const { inEpic, otrosEpics } = partitionByEpic(issues, 'epic a')
    expect(inEpic).toEqual([])
    expect(otrosEpics.map((i) => i.number)).toEqual([1, 2, 4])
  })
  it('un título pedido que no existe deja inEpic vacío sin perder a nadie', () => {
    const { inEpic, sinMilestone, otrosEpics } = partitionByEpic(issues, 'Epic Z')
    expect(inEpic).toEqual([])
    expect(sinMilestone.length + otrosEpics.length).toBe(issues.length)
  })
  it('defensivo: lista vacía o ausente devuelve los tres cubos vacíos', () => {
    for (const entrada of [[], undefined, null]) {
      const p = partitionByEpic(entrada, 'Epic A')
      expect(p).toEqual({ inEpic: [], sinMilestone: [], otrosEpics: [] })
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/gh-issues.test.js`
Expected: FAIL — `epicTitleOf is not a function` (el import no resuelve).

- [ ] **Step 3: Implementar**

Añadir al final de `scripts/gh-issues.js`:

```js
// F23 — el alcance por epic de /ct-groom. Contrapartida de epicKeyOf/
// buildOrderIndex (scripts/gh-issue-map.js), que resuelven lo mismo para
// /ct-next, pero con OTRA llave y por un motivo concreto: /ct-next indexa por
// `milestone.number`, y /ct-groom no puede, porque enumera los issues del
// repo ANTES de haber resuelto (o creado) el milestone de la corrida — ese
// orden es deliberado, no accidental: el listado se colocó por delante de la
// creación del milestone precisamente para que un abort de validación no
// dejara un milestone y unas labels ya creados en GitHub (ver el comentario
// largo de ct-groom.mjs sobre el orden de las lecturas). En ese punto lo
// único que se conoce del epic es su TÍTULO, que es el argumento
// `--milestone`; y el título ya es la llave con la que el propio script hace
// idempotente la creación del milestone, así que no se introduce ninguna
// noción de identidad nueva.
//
// Un issue SIN milestone no se le atribuye a nadie: cae en `sinMilestone`,
// su propio cubo. Mismo criterio que NO_MILESTONE_KEY — compartido y con
// aviso, nunca invisible. Quien decide qué hacer con ese cubo es el caller
// (ct-groom.mjs), no esta función: aquí solo se reparte.
export function epicTitleOf(rawIssue) {
  const title = rawIssue?.milestone?.title
  return (typeof title === 'string' && title.length > 0) ? title : null
}

// partitionByEpic: tres cubos DISJUNTOS que suman siempre la entrada entera —
// ninguna llamada puede perder un issue por el camino, que es justo el modo
// de fallo que produciría duplicados (un issue que existe pero que el groom
// no ve se vuelve a crear). El orden de entrada se preserva dentro de cada
// cubo para que los mensajes al humano salgan en el orden en que GitHub los
// devolvió, no en uno arbitrario.
//
// El título se compara EXACTO, sin normalizar mayúsculas ni espacios: es la
// misma comparación que hace la resolución del milestone más abajo en
// ct-groom.mjs (`allMilestones.find((m) => m.title === milestone)`). Aflojar
// la comparación aquí y no allí haría que este reparto creyera estar viendo
// un epic que la creación del milestone consideraría distinto — y esa
// discrepancia es exactamente lo que produce duplicados.
export function partitionByEpic(issues, milestoneTitle) {
  const inEpic = []
  const sinMilestone = []
  const otrosEpics = []
  for (const issue of (issues || [])) {
    const title = epicTitleOf(issue)
    if (title === null) sinMilestone.push(issue)
    else if (title === milestoneTitle) inEpic.push(issue)
    else otrosEpics.push(issue)
  }
  return { inEpic, sinMilestone, otrosEpics }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/gh-issues.test.js`
Expected: PASS, todos los `describe` de ese fichero incluidos los previos.

- [ ] **Step 5: Commit**

```bash
git add scripts/gh-issues.js __tests__/gh-issues.test.js
git commit -m "F23: epicTitleOf/partitionByEpic — el alcance por epic con la llave que /ct-groom puede permitirse

/ct-next indexa por milestone.number; /ct-groom enumera los issues antes de
resolver el milestone, así que en ese punto sólo tiene el título. El reparto
en tres cubos disjuntos garantiza que ningún issue se pierda: un issue que
existe pero que el groom no ve es exactamente lo que produce duplicados.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `specTarget` en `scripts/gh-issue-map.js`

**Files:**
- Modify: `scripts/gh-issue-map.js` (justo después de `normalizeSpecLink`)
- Test: `__tests__/gh-issue-map.test.js`

**Interfaces:**
- Consumes: `normalizeSpecLink` (ya existe en ese fichero).
- Produces: `specTarget(specLinkLine) -> string | null` — el DESTINO del enlace al spec, o sea lo que va después del primer `Spec: ` de la línea que emite `renderSpecLink` (`scripts/groom.js:148`). `null` si la entrada es nula o si no contiene ese separador.

**Por qué el destino y no la línea entera:** `renderSpecLink` compone `> Slice \`#N\` del epic. Spec: <destino>`, y ese prefijo cambió de formato en F6 (`#N` → `` `#N` ``; las dos formas viven en `SPEC_LINK_PREFIXES`). Comparar la línea entera daría un falso negativo sobre cualquier issue creado antes de F6. `diffIssue` sí compara la línea entera y debe seguir haciéndolo — es contenido del spec y su divergencia es reportable; aquí la pregunta es otra: «¿estos dos issues apuntan al mismo documento?».

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `__tests__/gh-issue-map.test.js` (y `specTarget` al import de la línea 2):

```js
// F23 — specTarget: "¿estos dos issues apuntan al mismo spec?", que NO es la
// misma pregunta que "¿la línea del enlace ha cambiado?" (eso lo responde
// diffIssue comparando la línea entera, y debe seguir haciéndolo).
describe('specTarget', () => {
  it('devuelve lo que va tras "Spec: " en la forma actual del enlace', () => {
    const linea = '> Slice `#2` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
    expect(specTarget(linea)).toBe('[docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)')
  })
  it('la forma ANTERIOR a F6 (sin backticks) da el MISMO destino — es el motivo de comparar el destino y no la línea', () => {
    const destino = '[docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)'
    expect(specTarget(`> Slice #2 del epic. Spec: ${destino}`)).toBe(destino)
    expect(specTarget(`> Slice \`#2\` del epic. Spec: ${destino}`)).toBe(destino)
  })
  it('el ORDEN del slice no forma parte del destino: dos slices distintos del mismo spec coinciden', () => {
    const destino = '`docs/spec.md` § `9. Slices` — sin enlace: el fichero no está publicado'
    expect(specTarget(`> Slice \`#1\` del epic. Spec: ${destino}`))
      .toBe(specTarget(`> Slice \`#7\` del epic. Spec: ${destino}`))
  })
  it('specs distintos dan destinos distintos', () => {
    const a = specTarget('> Slice `#1` del epic. Spec: [docs/a.md](https://github.com/o/r/blob/main/docs/a.md)')
    const b = specTarget('> Slice `#1` del epic. Spec: [docs/b.md](https://github.com/o/r/blob/main/docs/b.md)')
    expect(a).not.toBe(b)
  })
  it('sin separador "Spec: " → null (no se inventa un destino)', () => {
    expect(specTarget('> Slice `#1` del epic.')).toBeNull()
    expect(specTarget('una línea cualquiera')).toBeNull()
  })
  it('defensivo: null/undefined/vacío → null', () => {
    expect(specTarget(null)).toBeNull()
    expect(specTarget(undefined)).toBeNull()
    expect(specTarget('')).toBeNull()
    expect(specTarget('> Slice `#1` del epic. Spec: ')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run __tests__/gh-issue-map.test.js -t specTarget`
Expected: FAIL — `specTarget is not a function`.

- [ ] **Step 3: Implementar**

Añadir en `scripts/gh-issue-map.js`, inmediatamente después de `normalizeSpecLink`:

```js
// specTarget (F23): el DESTINO del enlace al spec — lo que renderSpecLink
// (scripts/groom.js) escribe después de "Spec: ". Responde a una pregunta
// distinta de la de diffIssue, y por eso no reutiliza su comparación:
//
//   diffIssue pregunta "¿la línea del enlace de ESTE issue ha cambiado
//   respecto a lo que el spec produce hoy?" — es contenido del spec, su
//   divergencia es reportable, y desde F10 se compara ENTERA a propósito
//   (detecta que el spec se ha movido de fichero o de repo).
//
//   specTarget pregunta "¿estos dos issues apuntan al MISMO documento?",
//   para decidir si un issue de otro milestone es en realidad este mismo
//   epic bajo otro título. Ahí el prefijo estorba: la línea empieza por
//   "> Slice `#N` del epic. " y ese prefijo (a) lleva el orden del slice y
//   (b) cambió de formato en F6 (`#N` con backticks, ver
//   SPEC_LINK_PREFIXES), así que comparar la línea entera daría un falso
//   negativo sobre cualquier issue creado antes de F6.
//
// Falla en ABIERTO por diseño: si dos costumbres de invocación producen dos
// destinos distintos para el mismo fichero (relativa vs. absoluta — el
// ping-pong que F10 documenta en reconcile.js), esta función los ve como
// specs distintos, el caller no dispara su puerta, y el comportamiento es el
// que había antes de F23. Un falso NEGATIVO devuelve el statu quo; un falso
// positivo pararía una corrida legítima. La dirección segura es ésta.
const SPEC_TARGET_SEPARATOR = 'Spec: '
export function specTarget(specLinkLine) {
  const line = normalizeSpecLink(specLinkLine)
  if (line === null) return null
  const at = line.indexOf(SPEC_TARGET_SEPARATOR)
  if (at === -1) return null
  const target = line.slice(at + SPEC_TARGET_SEPARATOR.length).trim()
  return target.length > 0 ? target : null
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run __tests__/gh-issue-map.test.js`
Expected: PASS (fichero completo, para confirmar que no se ha roto nada de D1).

- [ ] **Step 5: Commit**

```bash
git add scripts/gh-issue-map.js __tests__/gh-issue-map.test.js
git commit -m "F23: specTarget — \"¿el mismo documento?\" no es la pregunta que responde diffIssue

diffIssue compara la línea del enlace ENTERA a propósito desde F10, porque su
pregunta es si el enlace ha cambiado. Para decidir si un issue de otro
milestone es este mismo epic bajo otro título hace falta la otra pregunta, y
ahí el prefijo \"> Slice #N del epic. \" estorba: lleva el orden del slice y
cambió de formato en F6.

Falla en abierto: dos rutas distintas del mismo fichero se ven como specs
distintos, la puerta no dispara, y queda el comportamiento previo a F23.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: acotar el emparejado y los huérfanos a `inEpic`

Es el arreglo del §2 propiamente dicho. Al terminar esta tarea las dos caras medidas en campo se comportan bien; las puertas de las tareas 4 y 5 cubren lo que este acotado no puede decidir solo.

**Files:**
- Modify: `scripts/ct-groom.mjs` — import (línea 25), declaración de estado (~566), bloque de huérfanos + emparejado (~617-628), registro en memoria del issue recién creado (~1064)
- Test: `__tests__/ct-groom-dryrun.test.js`

**Interfaces:**
- Consumes: `partitionByEpic` de la Tarea 1.
- Produces: la variable de módulo `inEpic` (`object[] | null`), que es la lista contra la que se emparejan marcadores y se detectan huérfanos durante toda la corrida.

**Barrido por propiedad, obligatorio en esta tarea.** La propiedad es: *«cualquier sitio que decida algo a partir del marcador `ct-order` de un issue existente»*. El barrido ya hecho da estos consumidores en todo el repo — hay que **repetirlo** (`grep -rn "existingIssues\|findByMarker\|extractOrder" scripts`) y enumerar cualquiera que no esté aquí:

| Sitio | Qué hacer |
|---|---|
| `ct-groom.mjs` bucle de huérfanos (~618) | pasa a recorrer `inEpic` |
| `ct-groom.mjs` `findByMarker` (~627) | recibe `inEpic` |
| `ct-groom.mjs` push en memoria (~1064) | **empuja a `inEpic`, no a `existingIssues`** — si no, un segundo slice del mismo orden en la misma corrida deja de verse |
| `ct-next.mjs` vía `buildDispatchInput` | ya acotado (D1). NO tocar |
| `dispatch-check.mjs:299` | pagina issues igual pero proyecta a `{n, labels}` y no lee el marcador. NO tocar |

- [ ] **Step 1: Escribir los tests que fallan — las dos caras del §2**

Añadir a `__tests__/ct-groom-dryrun.test.js`, al final:

```js
// F23 — las dos caras del §2 del feedback de campo, medidas en producción
// sobre menoplus-app/menoplus con los issues #451–#456 de un epic anterior y
// cerrado. Antes de este arreglo, el emparejado por marcador barría el REPO
// ENTERO, así que el contrato §9 ("los # son únicos dentro de su milestone,
// no del repo") era cierto en /ct-next y falso aquí.
const TRES_SLICES = (a, b, c) => `## 9. Slices
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|---|---|---|---|---|---|---|---|
| ${a} | uno | backend | a | – | AC-${a}.1 | – | api | db |
| ${b} | dos | backend | b | – | AC-${b}.1 | – | api | db |
| ${c} | tres | backend | c | – | AC-${c}.1 | – | api | db |
`

// Los seis del epic anterior: cerrados, en OTRO milestone, con ct-order 1..6
// y un enlace a OTRO spec (para no disparar la puerta de la Tarea 5, que es
// una comprobación distinta — aquí lo que se prueba es el acotado).
const EPIC_ANTERIOR = [1, 2, 3, 4, 5, 6].map((n) => ({
  number: 450 + n,
  title: `#${n} slice viejo`,
  state: 'closed',
  milestone: { number: 1, title: 'Epic anterior' },
  labels: [{ name: 'type:backend' }],
  body: `> Slice \`#${n}\` del epic. Spec: [otro-spec.md](https://github.com/o/r/blob/main/otro-spec.md)\n\ncuerpo viejo\n\n<!-- ct-order:${n} -->`,
}))

describe('ct-groom — el marcador ct-order acotado por milestone (F23, §2 del feedback)', () => {
  it('cara 1: tabla §9 empezando en 1,2,3 sobre un epic anterior con 1..6 → crea los tres, cero divergencias, cero huérfanos, exit 0', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]) }) })
    expect(res.status).toBe(0)
    // Lo que hacía antes: emparejaba con #451/#452/#453 y reportaba el
    // milestone distinto como divergencia, sin crear nada.
    expect(res.stderr).not.toMatch(/divergencia/)
    expect(res.stderr).not.toMatch(/#45[123]/)
    // Y además declaraba huérfanos a #454/#455/#456 en la MISMA corrida.
    expect(res.stderr).not.toMatch(/hu.rfano/)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  it('cara 2: tabla §9 empezando en 7,8,9 → NO declara huérfanos a los seis del epic anterior', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(7, 8, 9))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/hu.rfano/)
    expect(res.stderr).not.toMatch(/#45[1-6]/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el huérfano legítimo — un issue DEL EPIC ACTUAL cuyo orden ya no está en la tabla — sigue avisando y sigue saliendo 3', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const HUERFANO_REAL = {
      number: 601,
      title: '#9 slice retirado',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }],
      body: 'cuerpo\n\n<!-- ct-order:9 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...EPIC_ANTERIOR, HUERFANO_REAL]]]) }) })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/issue #601.*ct-order:9/)
    expect(res.stderr).toMatch(/hu.rfano/)
    // El acotado no ha silenciado la señal, sólo la ha limitado a su epic:
    // ninguno de los seis del epic anterior aparece.
    expect(res.stderr).not.toMatch(/#45[1-6]/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el emparejado SÍ ocurre dentro del propio epic: un issue del milestone pedido con el mismo orden no se duplica', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const DEL_EPIC = {
      number: 700,
      title: '#1 uno',
      state: 'open',
      milestone: { number: 2, title: 'Epic nuevo' },
      labels: [{ name: 'type:backend' }, { name: 'area:api' }, { name: 'touches:db' }, { name: 'status:backlog' }],
      body: 'cuerpo\n\n<!-- ct-order:1 -->',
    }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[...EPIC_ANTERIOR, DEL_EPIC]]]) }) })
    // Divergencia real (el body no trae AC ni enlace al spec) → exit 3,
    // nombrando el issue de SU epic. Lo que importa aquí es que lo encuentra.
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/slice #1.*issue #700/)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run __tests__/ct-groom-dryrun.test.js -t "acotado por milestone"`
Expected: FAIL — cara 1 sale 3 en vez de 0 y su stderr trae `divergencia` y `#451`; cara 2 trae `huérfano` y `#451`.

- [ ] **Step 3: Cablear `partitionByEpic` en `ct-groom.mjs`**

3a. Import — línea 25, añadir `partitionByEpic`:

```js
import { flattenIssuePages, flattenPages, realIssuesOnly, findByMarker, partitionByEpic } from './gh-issues.js'
```

3b. Declaración de estado — justo después de `let existingIssues = null` (~línea 566), añadir:

```js
// inEpic (F23): los issues del epic de ESTA corrida — los del milestone cuyo
// título es el argumento `--milestone`. Es la lista contra la que se emparejan
// los marcadores `ct-order` y se detectan huérfanos, y por eso vive aquí
// arriba y no dentro del bloque de lectura: el registro en memoria del issue
// recién creado (mucho más abajo, en el bucle de creación) tiene que empujar
// a ESTA lista, no a `existingIssues`, o dos slices del mismo orden en la
// misma corrida dejarían de verse el uno al otro.
//
// Por qué el emparejado se acota (§2 del feedback de campo, medido en
// producción): /ct-groom numera los slices 1..N POR EPIC y escribe ese número
// en `<!-- ct-order:N -->`, así que el marcador NO es único en el repo — el
// contrato §9 lo promete explícitamente ("únicos dentro de su milestone, no
// del repo"). Buscarlo por todo el repo hacía dos cosas, las dos falsas:
// emparejaba una tabla §9 nueva empezando en 1,2,3 con los issues de un epic
// anterior y CERRADO (reportando su milestone distinto como "divergencia", y
// con --reconcile los habría arrastrado al milestone nuevo), y declaraba
// huérfanos a los issues de cualquier otro epic del repo.
let inEpic = null
```

3c. Sustituir el bloque de huérfanos y emparejado (líneas ~617-628). El texto actual:

```js
  const knownOrders = new Set(plan.issues.map((i) => i.order))
  for (const i of existingIssues) {
```

pasa a:

```js
  const knownOrders = new Set(plan.issues.map((i) => i.order))
  const partition = partitionByEpic(existingIssues, milestone)
  inEpic = partition.inEpic
  for (const i of inEpic) {
```

y el mensaje de huérfano nombra el epic (misma señal, alcance explícito):

```js
      console.error(`aviso: issue #${i.number} lleva el marcador ct-order:${order}, pero el slice #${order} ya no está en la tabla §9 del spec — issue huérfano del epic "${milestone}" (¿se eliminó el slice sin cerrar/renumerar su issue?); revísalo a mano`)
```

y el emparejado (~627):

```js
    const found = findByMarker(inEpic, marker)
```

3d. Registro en memoria del issue recién creado (~1064). El texto actual:

```js
  existingIssues.push({ number: null, body: iss.body })
```

pasa a:

```js
  // F23: empuja a `inEpic`, que es la lista contra la que emparejan los
  // marcadores desde que el emparejado está acotado por epic. Empujar a
  // `existingIssues` dejaría esta guarda sin efecto en silencio.
  inEpic.push({ number: null, body: iss.body })
```

- [ ] **Step 4: Arreglar los fixtures preexistentes que este acotado invalida**

Cuatro tests preexistentes cambian de comportamiento. **Están enumerados aquí porque el barrido ya se hizo — pero repítelo igualmente** (`grep -rn "ct-order:" __tests__/ct-groom-*.test.js __tests__/f1*.test.js`) y trata cualquiera que no esté en esta tabla.

| Fichero:línea | Fixture | Por qué se rompe | Arreglo |
|---|---|---|---|
| `f18-lecturas-acotadas.test.js:50` | `existente` | **No tiene clave `milestone` en absoluto**, y lleva `ct-order:1` con una tabla §9 que sí tiene el slice 1. Cae en `sinMilestone` y a partir de la Tarea 4 dispara la Puerta A → exit 1 | añadir `milestone: { title: 'Epic' }`. Afecta a los 5 `it` del fichero, todos corren con `--milestone Epic` |
| `ct-groom-dryrun.test.js:1270` | `EXISTING` | `milestone: { title: 'Sprint 1' }` con `--milestone Epic` → `otrosEpics`; su body no lleva enlace al spec, así que la Puerta B tampoco lo ve → no empareja, exit 0 en vez de 3 | `milestone: { title: 'Epic' }`, y borrar las aserciones de las líneas 1288-1289 (`milestone difiere`, `"Sprint 1"`) |
| `ct-groom-reconcile.test.js:87` | `existingIssueDrift` | mismo caso, pero su body **es `matchingBody()`, con el enlace al MISMO spec** → a partir de la Tarea 5 **dispara la Puerta B** → exit 1. Es la prueba de que la Puerta B funciona sobre un fixture que ya existía, no sobre uno fabricado | `milestone: { title: 'Epic' }`, y borrar las aserciones de las líneas 114-115 |
| `ct-groom-reconcile.test.js:189` | `expect(editLine).toMatch(/--milestone Epic/)` | Es la aserción que **prueba el peligro que el §2 señalaba**: que `--reconcile` mete el milestone en el `gh issue edit`. Con el emparejado acotado ya no puede haber divergencia de milestone, así que ese flag deja de salir | **invertirla**, no borrarla (ver abajo) |

Para el cuarto, sustituir la línea 189 por:

```js
    // F23: el flag `--milestone` ya NO sale de aquí, y esta aserción invertida
    // es la que lo prueba. Con el emparejado acotado por epic, un issue
    // emparejado siempre tiene el milestone pedido, así que diff.milestone es
    // inalcanzable desde /ct-groom — y con él desaparece POR CONSTRUCCIÓN el
    // peligro que el §2 del feedback señalaba en mayúsculas: un --reconcile
    // que arrastrase un issue cerrado de otro epic al milestone nuevo. La
    // rama sigue viva en reconcile.js (módulo puro, otros callers), pero este
    // call-site no puede alcanzarla. Se invierte en vez de borrarse porque un
    // test que desaparece no documenta nada.
    expect(editLine).not.toMatch(/--milestone/)
```

y cambiar el título de ese `it` de `'aplica título + milestone + labels en una sola llamada…'` a `'aplica título + labels en una sola llamada a `gh issue edit` (el milestone ya no puede divergir: F23), exit 0'`.

**No silenciar ningún test: corregir el fixture, no la aserción.** Los cuatro cambios son «el mundo del fixture era incoherente con lo que el código ahora exige», no «bajemos el listón».

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run __tests__/ct-groom-dryrun.test.js __tests__/ct-groom-reconcile.test.js __tests__/f18-lecturas-acotadas.test.js`
Expected: PASS. Luego `npx vitest run` completo.

Nota: el cambio de `ct-groom-reconcile.test.js:87` no falla hasta la Tarea 5 (es la Puerta B quien lo tumba), pero se hace **aquí**, en una sola pasada, porque sale del mismo barrido. Si al correr la suite en esta tarea ese test ya pasa con el fixture corregido, es lo esperado.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-groom.mjs __tests__/ct-groom-dryrun.test.js __tests__/ct-groom-reconcile.test.js __tests__/f18-lecturas-acotadas.test.js
git commit -m "F23: el emparejado por ct-order acotado al epic de la corrida

§2 del feedback de campo. El contrato §9 promete que los # son únicos dentro
de su milestone, no del repo; era cierto en /ct-next desde D1 y falso aquí.

Son DOS call-sites de la misma propiedad, no uno: el emparejado por marcador y
la detección de huérfanos. Por eso una tabla nueva empezando en 1,2,3 producía
divergencias espurias Y huérfanos espurios en la misma corrida.

El push en memoria del issue recién creado va ahora a inEpic: empujarlo a
existingIssues habría dejado esa guarda sin efecto en silencio.

Cuatro fixtures preexistentes daban por hecho el emparejado global. Se corrige
el fixture, no la aserción — salvo la de f18, que no tenía milestone en
absoluto, y la del argv de --reconcile, que se INVIERTE: que --milestone ya no
salga del `gh issue edit` es exactamente lo que este arreglo garantiza, y un
test que desaparece no documenta nada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Puerta A — issues sin milestone, y el aviso no bloqueante

**Files:**
- Modify: `scripts/ct-groom.mjs` (bloque nuevo tras el reparto, antes de la detección de huérfanos)
- Test: `__tests__/ct-groom-dryrun.test.js`

**Interfaces:**
- Consumes: `partition.sinMilestone` (Tarea 3), `extractOrder` (ya importado), `knownOrders` (ya calculado).
- Produces: el array `bloqueos` y la función `abortarSiHayBloqueos()`, a los que la Tarea 5 añade su propia categoría. Formato: `bloqueos` es un array de `{ titular: string, lineas: string[], remedio: string }`.

**Criterio.** Un issue sin milestone con `ct-order:N`:
- si **N está** en la tabla §9 de hoy → **bloquea**. No hay forma de saber si es de este epic (alguien le quitó el milestone, o se borró el milestone en GitHub) o de otro, y las dos lecturas posibles hacen daño: emparejarlo reescribiría un issue ajeno, ignorarlo crearía un duplicado.
- si **N no está** → **aviso informativo**, no bloquea. Nunca invisible, que es el criterio de `NO_MILESTONE_KEY`.

**Exit code: 1**, por precedente del propio fichero (`ct-groom.mjs` ya usa 1 para «leí un estado inconsistente, NO continúo» en el listado de items del project). `2` es validación de argv/spec; `3` es «hubo divergencia pero el trabajo se hizo», y aquí no se hace nada.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `__tests__/ct-groom-dryrun.test.js`:

```js
describe('ct-groom — puerta A: issues sin milestone (F23)', () => {
  const SIN_MILESTONE = (number, order) => ({
    number,
    title: `#${order} suelto`,
    state: 'open',
    milestone: null,
    labels: [],
    body: `cuerpo\n\n<!-- ct-order:${order} -->`,
  })

  it('colisiona con la tabla §9 → exit 1, los nombra, y NO muta nada', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 2), SIN_MILESTONE(488, 3)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#487\s+ct-order:2/)
    expect(res.stderr).toMatch(/#488\s+ct-order:3/)
    expect(res.stderr).toMatch(/no se ha creado ni modificado nada/)
    expect(res.stderr).toMatch(/gh issue edit .*--milestone/)
    // El efecto, no el exit code: la puerta cae ANTES de la primera mutación,
    // que es la creación del milestone.
    expect(res.stdout).not.toMatch(/milestone creado/)
    expect(res.stdout).not.toMatch(/issue creado/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('NO colisiona con la tabla §9 → aviso que lo nombra, la corrida sigue', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 9)]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/issue #487.*ct-order:9.*no tiene milestone/)
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues.map((i) => i.order)).toEqual([1, 2, 3])
    rmSync(dir, { recursive: true, force: true })
  })

  it('bajo --dry-run la puerta también aborta: un preview que calla que la corrida real se pararía informa menos que la corrida real', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MILESTONE(487, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stdout).not.toMatch(/"issues"/) // ni siquiera se imprime el plan
    rmSync(dir, { recursive: true, force: true })
  })

  it('un issue sin milestone y SIN marcador ct-order no dice nada de nada', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const SUELTO = { number: 490, title: 'issue a mano', state: 'open', milestone: null, labels: [], body: 'sin marcador' }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SUELTO]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/#490/)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run __tests__/ct-groom-dryrun.test.js -t "puerta A"`
Expected: FAIL — hoy salen 0 (o 3) en vez de 1 y no aparece ningún mensaje.

- [ ] **Step 3: Implementar**

En `scripts/ct-groom.mjs`, inmediatamente después de `inEpic = partition.inEpic` y **antes** del bucle de huérfanos:

```js
  // F23 — las puertas del alcance por epic. Van AQUÍ, entre el listado de
  // issues y todo lo demás, porque este punto está por delante de la primera
  // mutación del script (la creación del milestone, mucho más abajo): una
  // comprobación que no puede detener la acción siguiente es decoración, y
  // una que aborta después de crear el milestone deja basura en GitHub — el
  // mismo motivo por el que el listado se colocó donde está.
  //
  // Las dos puertas se calculan ENTERAS y se reportan JUNTAS antes de un
  // único exit: nombrar sólo el primer bloqueante dice "quita ése y sale", y
  // es falso cuando hay más de uno.
  //
  // Código de salida 1, por precedente de este mismo fichero: 1 es "leí un
  // estado inconsistente, NO continúo" (ver el abort del listado de items del
  // project); 2 es error de validación de argv/spec; 3 es "hubo divergencia
  // pero el trabajo se hizo", y aquí no se hace nada.
  const bloqueos = []
  const repoRefBloqueo = typeof repo === 'string' ? repo : '<owner/repo>'

  // Puerta A — issues SIN milestone. No se les puede atribuir un epic, así
  // que las dos lecturas posibles hacen daño: emparejarlo reescribiría un
  // issue ajeno; ignorarlo crearía un duplicado del slice que sí es nuestro.
  // Sólo bloquea si su orden COLISIONA con la tabla §9 de hoy — un marcador
  // que no compite con nada no impide nada, pero tampoco se calla (mismo
  // criterio que NO_MILESTONE_KEY en gh-issue-map.js: cubo compartido con
  // aviso, nunca invisible).
  const sinMilestoneBloqueantes = []
  for (const i of partition.sinMilestone) {
    const order = extractOrder(i.body)
    if (order == null) continue
    if (knownOrders.has(order)) {
      sinMilestoneBloqueantes.push(`  #${i.number}  ct-order:${order}`)
    } else {
      console.error(`aviso: issue #${i.number} lleva el marcador ct-order:${order} y no tiene milestone — no puedo decidir a qué epic pertenece, así que queda fuera de este groom. No colisiona con la tabla §9 de este spec, por eso no bloquea; asígnale su milestone para que deje de aparecer: gh issue edit ${i.number} --repo ${repoRefBloqueo} --milestone "<el suyo>"`)
    }
  }
  if (sinMilestoneBloqueantes.length) {
    bloqueos.push({
      titular: 'estos issues llevan un marcador ct-order que colisiona con la tabla §9 de este spec, pero NO tienen milestone — no puedo decidir si son de este epic o de otro:',
      lineas: sinMilestoneBloqueantes,
      remedio: `asígnales su milestone y vuelve a correr: gh issue edit <n> --repo ${repoRefBloqueo} --milestone "<el suyo>"`,
    })
  }

  // (la Tarea 5 añade aquí la Puerta B, al mismo array)

  if (bloqueos.length) {
    for (const { titular, lineas, remedio } of bloqueos) {
      console.error(titular)
      for (const linea of lineas) console.error(linea)
      console.error(remedio)
    }
    console.error('/ct-groom NO continúa: no se ha creado ni modificado nada.')
    process.exit(1)
  }
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run __tests__/ct-groom-dryrun.test.js`
Expected: PASS. Luego `npx vitest run` completo.

- [ ] **Step 5: Commit**

```bash
git add scripts/ct-groom.mjs __tests__/ct-groom-dryrun.test.js
git commit -m "F23: puerta A — un issue sin milestone que colisiona con la tabla §9 para la corrida

No se le puede atribuir un epic, y las dos lecturas posibles hacen daño:
emparejarlo reescribiría un issue ajeno, ignorarlo crearía un duplicado. Se
rehúsa actuar en vez de adivinar.

Cae antes de la primera mutación (la creación del milestone), también bajo
--dry-run: un preview que calla que la corrida real se pararía informa menos
que la corrida real. Exit 1 por precedente del propio fichero.

Un marcador sin milestone que NO colisiona sólo produce aviso: cubo compartido
con aviso, nunca invisible.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Puerta B — el mismo epic bajo otro título

Cubre un riesgo que **introduce el propio arreglo** y que no está en el feedback: al acotar por título, una errata en `--milestone` (o un epic renombrado en GitHub) hace que `/ct-groom` vea cero issues en su epic y **recree el epic entero duplicado** en un milestone nuevo, con exit 0. Es la clase de error del §7.1: un comando que no da error y no hace lo que parece.

**Files:**
- Modify: `scripts/ct-groom.mjs` (en el hueco marcado por la Tarea 5 dentro del bloque de puertas)
- Test: `__tests__/ct-groom-dryrun.test.js`

**Interfaces:**
- Consumes: `partition.otrosEpics` (Tarea 3), `specTarget` (Tarea 2), `extractSpecLink` (hay que **añadirlo al import** de `./gh-issue-map.js` en la línea 35, que hoy trae sólo `extractOrder, resolveStatus`), `bloqueos` (Tarea 4), `plan.issues[].specLink` (ya lo expone `groomPlan`).
- Produces: nada nuevo hacia fuera.

**Criterio.** Un issue en **otro** milestone bloquea si y sólo si se cumplen las tres: lleva `ct-order:N`, **N está** en la tabla §9 de hoy, **y** su destino de spec (`specTarget`) es igual al que el plan produce para ese mismo orden. Enlace distinto (o ausente en cualquiera de los dos lados) **no dispara nada**: es un epic distinto reusando números, que es precisamente el caso que F23 viene a habilitar.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `__tests__/ct-groom-dryrun.test.js`. Los issues «del mismo spec» se construyen con el `buildIssueBody` real y el mismo `SPEC_REF_OK` que usa el resto del fichero, para que el destino coincida de verdad y no por casualidad:

```js
describe('ct-groom — puerta B: el mismo epic bajo otro título (F23)', () => {
  // MISMO spec que produce el plan de este directorio de test (spec.md), pero
  // en OTRO milestone: la firma de un epic renombrado, o de una errata en
  // --milestone.
  const mismoSpecOtroEpic = (number, order) => ({
    number,
    title: `#${order} uno`,
    state: 'open',
    milestone: { number: 1, title: 'Epic anterior' },
    labels: [{ name: 'type:backend' }],
    body: buildIssueBody(
      { n: order, name: 'uno', type: 'backend', entrega: 'a', deps: [], ac: [`AC-${order}.1`], protected: '–' },
      SPEC_REF_OK,
    ),
  })

  it('mismo orden + mismo spec en otro milestone → exit 1, nombra el issue y su milestone real, no muta nada', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[mismoSpecOtroEpic(452, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#452\s+ct-order:2/)
    expect(res.stderr).toMatch(/Epic anterior/)
    expect(res.stderr).toMatch(/Epic nuevo/)
    expect(res.stderr).toMatch(/no se ha creado ni modificado nada/)
    expect(res.stdout).not.toMatch(/milestone creado/)
    expect(res.stdout).not.toMatch(/issue creado/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('mismo orden pero OTRO spec → no dispara: es un epic distinto reusando números, que es lo que F23 habilita', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[EPIC_ANTERIOR]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('mismo spec pero un orden que NO está en la tabla de hoy → no dispara', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo', '--dry-run'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[mismoSpecOtroEpic(452, 8)]]]) }) })
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/no se ha creado ni modificado nada/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('las DOS puertas en la misma corrida: los dos bloques se reportan y se sale UNA sola vez', () => {
    const dir = makeSpecDir('ctg-')
    const spec = join(dir, 'spec.md'); writeFileSync(spec, TRES_SLICES(1, 2, 3))
    const SIN_MS = { number: 487, title: '#3 suelto', state: 'open', milestone: null, labels: [], body: 'x\n\n<!-- ct-order:3 -->' }
    const res = spawnSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic nuevo'],
      { encoding: 'utf8', env: fakeEnv({ FAKE_GH_LIST_SEQUENCE: JSON.stringify([[[SIN_MS, mismoSpecOtroEpic(452, 2)]]]) }) })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/#487\s+ct-order:3/)   // puerta A
    expect(res.stderr).toMatch(/#452\s+ct-order:2/)   // puerta B
    // Un solo cierre: el pie aparece exactamente una vez.
    expect(res.stderr.match(/no se ha creado ni modificado nada/g)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run __tests__/ct-groom-dryrun.test.js -t "puerta B"`
Expected: FAIL — el primero y el cuarto salen 0 en vez de 1.

- [ ] **Step 3: Implementar**

3a. Import — línea 35, añadir `extractSpecLink` y `specTarget`:

```js
import { extractOrder, resolveStatus, extractSpecLink, specTarget } from './gh-issue-map.js'
```

3b. Sustituir el comentario `// (la Tarea 5 añade aquí la Puerta B, al mismo array)` por:

```js
  // Puerta B — el MISMO epic bajo OTRO título. Riesgo que introduce el propio
  // acotado por epic, no uno que ya existiera: mientras el emparejado era
  // global, un `--milestone` con una errata (o un epic renombrado en GitHub)
  // seguía encontrando sus issues por marcador y a lo sumo reportaba
  // divergencia. Acotado, esa misma corrida ve CERO issues en su epic y
  // recrea el epic entero duplicado en un milestone nuevo, con exit 0 — un
  // comando que no da error y no hace lo que parece.
  //
  // La señal que lo distingue de un epic distinto reusando números es el
  // enlace al spec, que todo issue groomeado lleva en el body (groom.js#
  // renderSpecLink). Mismo orden + MISMO documento = el mismo epic con otro
  // nombre. Documento distinto = dos epics legítimos compartiendo el número
  // de orden, que es EXACTAMENTE lo que F23 viene a habilitar: no dispara.
  //
  // Se compara el DESTINO del enlace (specTarget), no la línea entera: la
  // línea empieza por "> Slice `#N` del epic. " y ese prefijo cambió de
  // formato en F6, así que comparar entero fallaría contra cualquier issue
  // anterior. Si falta el enlace en cualquiera de los dos lados, o si dos
  // costumbres de invocación produjeron rutas distintas del mismo fichero, la
  // puerta NO dispara: un falso negativo devuelve el comportamiento previo a
  // F23, un falso positivo pararía una corrida legítima.
  const specTargetPorOrden = new Map(plan.issues.map((i) => [i.order, specTarget(i.specLink)]))
  const otroEpicBloqueantes = []
  for (const i of partition.otrosEpics) {
    const order = extractOrder(i.body)
    if (order == null || !knownOrders.has(order)) continue
    const suyo = specTarget(extractSpecLink(i.body))
    const nuestro = specTargetPorOrden.get(order)
    if (suyo === null || nuestro === null || suyo !== nuestro) continue
    otroEpicBloqueantes.push(`  #${i.number}  ct-order:${order}  milestone: "${epicTitleOf(i)}"`)
  }
  if (otroEpicBloqueantes.length) {
    bloqueos.push({
      titular: 'estos slices ya tienen un issue en OTRO milestone que apunta al MISMO spec — parece este mismo epic bajo otro título, no un epic distinto:',
      lineas: otroEpicBloqueantes,
      remedio: `este spec pide --milestone "${milestone}". Si renombraste el epic, usa su título real; si es un epic nuevo de verdad, su tabla §9 no debería apuntar al mismo spec que el anterior.`,
    })
  }
```

3c. `epicTitleOf` se usa en el mensaje — añadirlo al import de `./gh-issues.js` de la línea 25:

```js
import { flattenIssuePages, flattenPages, realIssuesOnly, findByMarker, partitionByEpic, epicTitleOf } from './gh-issues.js'
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run __tests__/ct-groom-dryrun.test.js`
Expected: PASS. Luego `npx vitest run` completo.

- [ ] **Step 5: Commit**

```bash
git add scripts/ct-groom.mjs __tests__/ct-groom-dryrun.test.js
git commit -m "F23: puerta B — el mismo epic bajo otro título no se duplica en silencio

Riesgo que introduce el propio acotado: con el emparejado global, una errata en
--milestone encontraba igual sus issues por marcador; acotado, ve cero issues
en su epic y recrea el epic entero duplicado con exit 0.

La señal que lo distingue de dos epics legítimos reusando números es el enlace
al spec. Se compara el destino, no la línea: el prefijo cambió de formato en
F6. Falla en abierto — un falso negativo devuelve el statu quo, un falso
positivo pararía una corrida legítima.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: documentar lo que quedó estructuralmente muerto y corregir el comentario obsoleto

Sin código nuevo. Dos comentarios: uno que evita que alguien «arregle» algo que ya no puede pasar, y otro que hoy describe una conducta que el código dejó de tener en D1.

**Files:**
- Modify: `scripts/ct-groom.mjs` (junto al cálculo de `diff` en `reconcileEntries`)
- Modify: `scripts/reconcile.js` (junto a la rama `--milestone` de `buildReconcileEditArgs`)
- Modify: `scripts/groom.js:258` (comentario de `findDuplicateOrders`)

- [ ] **Step 1: Verificar que la afirmación es cierta antes de escribirla**

No basta con razonarlo. Comprobar que `diff.milestone` es inalcanzable desde `ct-groom` con el emparejado acotado, revisando que `findByMarker` sólo recibe `inEpic` y que `partitionByEpic` mete en `inEpic` únicamente issues cuyo `epicTitleOf` es exactamente `milestone` — que es el mismo valor que se le pasa a `diffIssue` como `wantedMilestone`.

Run: `grep -n "findByMarker\|diffIssue(" scripts/ct-groom.mjs`
Expected: un único `findByMarker(inEpic, marker)` y un único `diffIssue(found, iss, plan.milestone, ownedLabelPrefixes)`. Confirmar además que `plan.milestone === milestone` (`groomPlan` lo recibe como `{ milestone }`).

- [ ] **Step 2: Escribir los tres comentarios**

En `scripts/ct-groom.mjs`, justo encima de la línea `const diff = diffIssue(found, iss, plan.milestone, ownedLabelPrefixes)`:

```js
    // F23: `diff.milestone` es INALCANZABLE desde aquí desde que el
    // emparejado está acotado por epic — `found` sale de `inEpic`, y a
    // `inEpic` sólo entran issues cuyo milestone es exactamente el que se le
    // pasa a diffIssue como `wantedMilestone`. Con ello desaparece POR
    // CONSTRUCCIÓN el peligro que el §2 del feedback señalaba en mayúsculas:
    // un --reconcile que, además de reescribir el body, arrastrase un issue
    // cerrado de otro epic al milestone nuevo. La comparación NO se borra de
    // reconcile.js: ese módulo es puro, compartido y testeado, y sigue siendo
    // la reparación correcta para cualquier caller que le pase un issue de
    // otro alcance. Lo que ya no puede ocurrir es que ESTE call-site lo haga.
```

En `scripts/reconcile.js`, encima de `if (diff.milestone) args.push('--milestone', diff.milestone.wanted)`:

```js
  // F23: desde ct-groom.mjs esta rama ya no se alcanza (allí el emparejado
  // está acotado por epic, así que un issue emparejado siempre tiene el
  // milestone pedido). Se conserva porque diffIssue/buildReconcileEditArgs
  // son puros y no le deben nada a ese call-site: para cualquier caller que
  // compare un issue contra un milestone distinto, mover el milestone sigue
  // siendo la reparación correcta. No es código muerto — es código sin
  // consumidor actual, que no es lo mismo.
```

En `scripts/groom.js`, corregir el comentario de `findDuplicateOrders` (líneas ~257-264). El texto que hoy dice «y esa función se queda con el ÚLTIMO issue visto para un orden repetido» pasa a:

```js
// findDuplicateOrders: los números de slice (`#` de la tabla §9) son la
// única llave que buildOrderIndex (scripts/gh-issue-map.js) usa para mapear
// "orden -> número de issue de GitHub" dentro de un epic. Desde D1 esa
// función no resuelve una colisión a ciegas: el primer issue visto conserva
// el slot y el hueco entero se acumula en `collisions`, lo que hace que
// buildDispatchInput EXCLUYA de la tanda al epic afectado. Aun así, un
// duplicado en la FUENTE (dos filas de la tabla §9 con el mismo `#`) sigue
// siendo un error que hay que cortar aquí y no allí: dejarlo pasar convierte
// un epic entero en indispachable, y en ct-groom.mjs el placeholder en
// memoria de un issue recién creado (aún sin `number` real) hace que el
// segundo slice del mismo orden opere contra un issue `null`. Se corta en el
// productor (aquí) en vez de dejar que el consumidor se defienda.
```

- [ ] **Step 3: Verificar que no se ha roto nada**

Run: `npx vitest run`
Expected: PASS, 51+ ficheros. Los comentarios no cambian conducta; esta corrida confirma que ninguna edición se coló fuera de un comentario.

- [ ] **Step 4: Commit**

```bash
git add scripts/ct-groom.mjs scripts/reconcile.js scripts/groom.js
git commit -m "F23: documentar lo que quedó sin consumidor, y corregir un comentario que ya mentía

diff.milestone es inalcanzable desde ct-groom con el emparejado acotado: el
peligro del --reconcile que el §2 señalaba desaparece por construcción, no por
una nota que pide revisar. La comparación no se borra — reconcile.js es puro y
no le debe nada a ese call-site.

Y el comentario de findDuplicateOrders describía la conducta de buildOrderIndex
ANTERIOR a D1 ('se queda con el último issue visto'). En este repo los
comentarios son documentación con carga estructural.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: documentación del comando y bump de versión

**Files:**
- Modify: `commands/ct-groom.md`
- Modify: `.claude-plugin/plugin.json` (única ubicación de la versión en todo el repo — verificado)

- [ ] **Step 1: Escribir la sección nueva en `commands/ct-groom.md`**

Añadir, después de la sección que hoy explica «De un abort a mitad se sale volviendo a correr, no limpiando a mano»:

```markdown
### El alcance de un groom es su epic, no el repo

`/ct-groom` numera los slices `1..N` **por epic** (una invocación = un `--milestone` = un epic) y escribe ese número en `<!-- ct-order:N -->`. El contrato §9 lo dice: *«los `#` de esta tabla son únicos dentro de su milestone, no del repo»*. Desde F23 eso es cierto también aquí — hasta entonces lo era sólo en `/ct-next`, y una tabla §9 nueva empezando en `1,2,3` emparejaba con los issues de un epic anterior y cerrado.

En la práctica: **puedes empezar la tabla §9 de cada spec en `1`**. Dos epics del mismo repo no se pisan.

Un groom sólo mira los issues cuyo milestone es el que le has pasado. Los de otros epics no se emparejan, no se reportan como divergencia y no se declaran huérfanos. «Issue huérfano» pasa a significar lo que dice: un issue **de este epic** cuyo orden ya no está en la tabla §9.

### Las dos situaciones en las que `/ct-groom` se para en seco

Ambas caen **antes de tocar nada** (antes incluso de crear el milestone), también bajo `--dry-run`, y salen con **exit 1** diciendo `no se ha creado ni modificado nada`. Si coinciden las dos, se reportan las dos y se sale una sola vez.

**1. Un issue sin milestone cuyo `ct-order` colisiona con tu tabla §9.** No hay forma de saber si es de este epic (alguien le quitó el milestone, o se borró el milestone en GitHub) o de otro, y las dos lecturas posibles hacen daño: emparejarlo reescribiría un issue ajeno, ignorarlo crearía un duplicado. Asígnale su milestone y vuelve a correr.

> Un issue sin milestone cuyo `ct-order` **no** colisiona con tu tabla sólo produce un aviso. No bloquea, pero tampoco se calla.

**2. Un slice tuyo que ya tiene issue en otro milestone, apuntando al mismo spec.** Es la firma de un epic renombrado en GitHub, o de una errata en `--milestone`. Sin esta puerta, esa corrida vería cero issues en su epic y recrearía el epic entero duplicado, con exit 0. Si renombraste el epic, usa su título real; si es un epic nuevo de verdad, su tabla §9 no debería apuntar al spec del anterior.

> Un issue de otro milestone que apunta a **otro** spec no dispara nada: eso son dos epics legítimos compartiendo números de orden, que es justo lo que este alcance permite.
```

- [ ] **Step 2: Bump de versión**

En `.claude-plugin/plugin.json`, `"version": "0.22.1"` → `"version": "0.23.0"`. Minor, no patch: cambia el comportamiento observable de `/ct-groom` y añade dos modos de abortar que antes no existían.

- [ ] **Step 3: Verificar**

Run: `npx vitest run __tests__/manifest.test.js && grep -c "alcance de un groom" commands/ct-groom.md`
Expected: PASS y `1`.

- [ ] **Step 4: Commit**

```bash
git add commands/ct-groom.md .claude-plugin/plugin.json
git commit -m "F23: documentar el alcance por epic y las dos puertas — 0.23.0

Minor y no patch: cambia el comportamiento observable de /ct-groom y añade dos
modos de abortar que antes no existían.

La doc dice explícitamente lo que este arreglo devuelve al usuario: la tabla §9
de cada spec puede empezar en 1.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: verificación final por propiedad

Nada de esto es ceremonia: cada comprobación existe porque su ausencia produjo un defecto real en F22 o en el periodo de campo.

**Files:** ninguno (salvo lo que las comprobaciones destapen).

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: 51+ ficheros, todos verdes. Anotar el número de tests para compararlo con los 1394 de partida.

- [ ] **Step 2: Coherencia `dist/` ↔ fuentes**

`hooks/hooks.json` ejecuta `dist/`, no `hooks/`, y `npm test` reconstruye antes de correr — así que la suite queda verde con un `dist` commiteado obsoleto. Ya pasó una vez en F22.

Run: `npm run build && git status --porcelain dist/`
Expected: **salida vacía**. Si no lo está, el bundle commiteado no correspondía a los fuentes: hay que commitear el `dist/` reconstruido antes de cerrar. (F23 no debería tocar `hooks/`; si esta comprobación ensucia `dist/`, averiguar por qué antes de commitear a ciegas.)

- [ ] **Step 3: Barrido por propiedad, repetido al final**

Run: `grep -rn "existingIssues\|findByMarker\|extractOrder\|epicTitleOf\|partitionByEpic" scripts`
Expected: enumerar **todos** los resultados y confirmar uno a uno que cada decisión tomada a partir de un marcador `ct-order` de un issue existente está acotada a `inEpic`, o que está deliberadamente fuera (los tres cubos del reparto y las dos puertas). Cualquier hallazgo que no estuviera en la tabla de la Tarea 3 se anota y se trata, no se ignora.

- [ ] **Step 4: Reproducir el defecto original contra el código nuevo**

El arnés de reproducción vive en `scratchpad/repro-f23.mjs` y llama a los mismos call-sites del script. Adaptarlo al código nuevo (usando `partitionByEpic` antes de `findByMarker`) y correrlo.

Expected: cara 1 → crea los tres, cero divergencias, cero huérfanos. Cara 2 → crea los tres, cero huérfanos. Es la comprobación de que lo que se arregló es lo que se midió, no algo parecido.

- [ ] **Step 5: Commit de cierre si algo cambió**

Si los pasos 2-4 no destaparon nada, no hay commit. Si destaparon algo, arreglarlo con su test antes de continuar.

---

### Task 9: retirar el rodeo de menoplus

**Fuera del repo del plugin.** Dos ficheros en `/Users/jpereag/Documents/menoplus-app/menoplus`, más una memoria local. **No commitear nada de esto en el worktree del plugin.**

**Files:**
- Modify: `docs/superpowers/control-tower-loop-feedback-2026-08-01.md` (§8, la línea «Vigente mientras el §2 no se arregle»)
- Modify: el spec de producto del 2026-07-31 del mismo repo (localizarlo: `grep -rln "empezar en 10\|no se usa --reconcile\|ct-order" docs/superpowers/specs/`)
- Delete: `/Users/jpereag/.claude-personal/projects/-Users-jpereag-Documents-control-tower-plugin/memory/ct-order-global-menoplus.md` y su línea en `MEMORY.md`

- [ ] **Step 1: Localizar los dos sitios y leerlos enteros antes de tocarlos**

Run: `grep -rn "empezar en 10\|reconcile\|ct-order" /Users/jpereag/Documents/menoplus-app/menoplus/docs/superpowers/`
Expected: el §8 del documento de feedback (línea 191) y el spec del 2026-07-31. Leer el párrafo entero de cada uno: la restricción puede estar redactada de dos formas distintas y hay que retirar la restricción, no borrar el contexto que explica por qué existió.

- [ ] **Step 2: Editar**

En el §8 del feedback, sustituir la línea «Vigente mientras el §2 no se arregle: …» por una que diga que está **retirada**, con la versión que lo cierra (0.23.0) y la fecha, para que el documento siga siendo legible como registro histórico.

En el spec de producto, retirar la instrucción de empezar la tabla §9 por encima de lo gastado y la prohibición de `--reconcile`, dejando dicho desde qué versión.

- [ ] **Step 3: Enseñar el diff y PREGUNTAR antes de commitear**

Run: `git -C /Users/jpereag/Documents/menoplus-app/menoplus diff`

**No commitear ni pushear sin el visto bueno de José.** Es un repo de producto con su propio estado de trabajo; el plugin no manda ahí.

- [ ] **Step 4: Borrar la memoria obsoleta**

Sólo después de que F23 esté mergeado. La memoria `ct-order-global-menoplus.md` dice que la tabla §9 empieza en 10+ y que `--reconcile` está prohibido: al cerrar esto es falsa, y una memoria falsa es peor que ninguna. Borrar el fichero y su línea en `MEMORY.md`.
