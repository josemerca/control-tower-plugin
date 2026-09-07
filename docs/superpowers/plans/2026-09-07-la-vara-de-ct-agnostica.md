# La vara de ct, agnóstica — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir a `plugin/conventions/` las reglas que `backend/conventions/` pagó, reescritas sin lenguaje ni forma de programa, para que plan, implementador, juez y reconciliador midan con ellas en cualquier repositorio.

**Architecture:** Tres documentos nuevos en la vara que viaja con el plugin (`simplicity.md`, `domain.md`, `boundaries.md`), dos que crecen (`architecture.md`, `testing.md`), y `architecture.md` vaciada de todo lo que es borde — que al mudarse a `boundaries.md` pasa de regir `new modules` a regir todo diff. `PluginYardstick.FILES` pasa de cinco a ocho nombres, que es el único cambio de mecanismo: el resto del transporte (pegado al implementador, por ruta al juez y al reconciliador, filtrado por `Applies to:`) ya existe y no se toca. `backend/conventions/` se reduce a un documento con lo que sólo decide este repositorio.

**Tech Stack:** Node 24, vitest 4, ESM. Los documentos son Markdown en inglés.

**Spec:** `docs/superpowers/specs/2026-09-07-la-vara-de-ct-agnostica-design.md`

## Global Constraints

- **Los ocho documentos se escriben en inglés**, como exige `conventions/style.md`, y sin comentarios ni prosa explicativa fuera de la propia regla.
- **Cada documento declara su alcance en las seis primeras líneas**, con la forma literal `Applies to: **every diff**.` o `Applies to: **new modules**.` — `PluginYardstick.scopeOf` lee esa línea con `/^Applies to:\s*(.+)$/m` y `appliesToTask` sólo trata distinto el alcance que contiene `new modules`.
- **Los tres documentos nuevos son cortos: del orden de sesenta líneas cada uno.** Viajan pegados en el brief de toda tarea, y hoy los cinco enteros son 24 KB.
- **Ningún token de lenguaje ni de herramienta en la vara**: nada de `vitest`, `pytest`, `execFile`, `npx`, `Object.freeze`, `fetch`, ni extensiones de fichero. La Tarea 4 clava esto con un test.
- **Agnóstica de lenguaje y de herramienta, NO de arquitectura.** Es la restricción que se lee mal, así que queda escrita: `layer`, `port`, `value object`, `use case`, `adapter`, `export` y `test` son el vocabulario que la vara **impone** — `architecture.md` define las tres capas, los ports y la forma de un caso de uso, y `testing.md` dice qué clava un test —, así que se usan tal cual. Un circunloquio que los evite es un defecto: hace que el documento se lea como una paráfrasis de la vara en vez de como parte de ella, y rompe el vocabulario común por el que el juez cita.
- **La palabra `boundary` está reservada** para el documento del borde exterior que nace en la Tarea 3, **en su sentido de "lo que un campo cruza": eso es un `layer`.** El término compuesto `boundary model` NO está reservado: es el nombre del concepto y `architecture.md` ya lo usa, así que se dice tal cual y no se parafrasea.
- **La prosa envuelve a unas 80 columnas**, como los cinco documentos que ya están. Una frase que un test exige literal se parte justo después del literal, no se deja en una línea de 130 caracteres.
- **Los tests que este plan añade se escriben con la vara del propio repo**: **sin comentarios**, y con el nombre sujeto a dos comprobaciones mecánicas de `plugin/__tests__/modulos-conformes.test.js`, que mide los ficheros del plugin contra `style.md`: **ninguna letra no ASCII** y **ninguna palabra de la lista exacta `PALABRAS_CASTELLANAS`** (que incluye `vara`, `documento`, `documentos`, `regla`, `reglas`, `ruta`, `rutas`, `fichero`, `ficheros`, `alcance`, `nombre`, `texto`, `cita`…). Un nombre en inglés cumple las dos sin pensar; un nombre en castellano cumple si va sin tildes y esquiva esa lista, que es lo que hacen los nombres que ya están en `conventions-vara.test.js`. **Toda tarea que toque un fichero de test del plugin corre `modulos-conformes.test.js`**: dos nombres prescritos por este plan lo dejaron rojo cuatro tareas porque su verificación no lo nombraba. Donde un bloque de código de este plan lleve un comentario, el comentario es para quien lee el plan y no viaja al fichero.
- **Palabras que la vara NO puede contener**, porque `conventions-vara.test.js` ya prohíbe que repita una regla que un ítem de la rúbrica posee: `skip`, `xfail`, `pre-existing test`, `flaky`, `deterministic`, `isolated`, `call count`, `real behaviour`, `real behavior`, `no sentence of the task`, `speculative`, `scaffolding`. Al redactar, se dice lo mismo con otras palabras o no se dice.
- **Cada tarea verifica corriendo SÓLO sus ficheros de test.** La suite entera del plugin tarda unos seis minutos: `npx vitest run __tests__/<fichero>` desde `plugin/`, nunca `npm test`.
- **Un commit por tarea**, y lo comitea quien implementa la tarea.

---

## Ficheros que este plan toca

**Crear:**
- `plugin/conventions/simplicity.md` — la carga de la prueba de lo que se añade (Tarea 1)
- `plugin/conventions/domain.md` — el nombre, el port, el value object, las familias de excepciones (Tarea 2)
- `plugin/conventions/boundaries.md` — el borde exterior (Tarea 3)
- `backend/conventions/this-repository.md` — lo que sólo decide este repositorio (Tarea 9)
- `backend/__tests__/conventions-no-restatement.test.js` — el test que impide que backend restate la vara (Tarea 9)

**Modificar:**
- `plugin/scripts/plugin-yardstick.js` — `FILES`, una vez por tarea que estrena documento (Tareas 1, 2, 3)
- `plugin/conventions/architecture.md` — gana el árbol y la carga de la prueba del tipo nuevo (Tarea 5), pierde todo el borde (Tarea 3)
- `plugin/conventions/testing.md` — gana las tres reglas, la tabla, la mutación (Tarea 6)
- `plugin/scripts/kickoff.js` — el plan deja de estar invitado a no leer (Tarea 7)
- `plugin/scripts/step-contracts.js`, `plugin/scripts/ct-step.mjs`, `plugin/agents/ct-slice-judge.md` — la ruta de `simplicity.md` en el paquete del juez de slice (Tarea 8)
- `plugin/scripts/run-metrics.js`, `plugin/scripts/ct-next.mjs`, `plugin/agents/ct-reconciler.md`, `plugin/skills/writing-plans-prescriptive/SKILL.md` — la prosa que clava el número cinco (Tarea 4)
- `plugin/__tests__/conventions-vara.test.js` — el mapa `ALCANCES` y las aserciones nuevas (Tareas 1, 2, 3, 5, 6)
- `plugin/__tests__/kickoff.test.js`, `plugin/__tests__/ct-step-vara-y-telemetria.test.js` — los dos tests que nombran cinco (Tareas 4, 7)

**Borrar:**
- `plugin/conventions/` no pierde ningún fichero.
- `backend/conventions/README.md`, `architecture.md`, `domain.md`, `infrastructure.md`, `simplicity.md`, `testing.md` (Tarea 9)

---

### Task 1: `simplicity.md`, y su frontera con el ítem `alcance`

El primero porque es el que no tiene equivalente en la vara y el que más cambia lo que el juez caza. Y el que necesita una frontera declarada: el ítem `alcance` de la rúbrica ya pregunta *qué frase de la tarea pide esto*, y este documento pregunta *qué llamada se rompe sin esto*. Son dos preguntas distintas — un plan puede pedir un campo que ningún llamante usa — pero se solapan en la superficie, y el juez tiene prohibido contar el mismo defecto en dos ítems.

**Files:**
- Create: `plugin/conventions/simplicity.md`
- Modify: `plugin/scripts/plugin-yardstick.js:3` (`FILES`)
- Test: `plugin/__tests__/conventions-vara.test.js:24-30` (`ALCANCES`) y un `describe` nuevo

**Interfaces:**
- Consumes: nada.
- Produces: el nombre `simplicity.md` dentro de `PluginYardstick.FILES`, en tercera posición. Las Tareas 2 y 3 insertan los suyos en el mismo array; la Tarea 8 pasa su ruta al paquete del juez de slice.

- [ ] **Step 1: Escribir los tests que fallan**

En `plugin/__tests__/conventions-vara.test.js`, añadir la entrada al mapa que ya existe — con eso hereda los tres tests genéricos que el fichero genera por documento (declara su alcance, lleva más de veinte líneas de sustancia, y toda cita `conventions/x.md` apunta a un documento que existe):

```js
const ALCANCES = {
  'defects.md': 'every diff',
  'style.md': 'every diff',
  'simplicity.md': 'every diff',
  'decisions.md': 'every diff',
  'architecture.md': 'new modules',
}
```

Y añadir al final del fichero el `describe` propio, en el estilo de mapa de afirmaciones que el fichero ya usa:

```js
describe('simplicity.md carries the burden of proof, and says where it ends', () => {
  const AFIRMACIONES = {
    'declara la regla única, y que se descarga contra el problema de hoy':
      () => expect(Documento.texto('simplicity.md')).toContain('the burden of proof is on what is added'),
    'nombra la pregunta que decide un campo, una rama o un símbolo público':
      () => expect(Documento.texto('simplicity.md')).toContain('which call breaks without it'),
    'nombra la pregunta que decide una línea de observabilidad':
      () => expect(Documento.texto('simplicity.md')).toContain('who reads this, and where'),
    'dice que una petición de una revisión o de un juicio no exime':
      () => expect(Documento.texto('simplicity.md')).toContain('does not move when the addition is asked for by a reviewer'),
    'dice que lo que no se puede descargar vuelve como hallazgo y no se implementa':
      () => expect(Documento.texto('simplicity.md')).toContain('goes back as a finding for a human to decide, and is not implemented meanwhile'),
    'lleva el cortafuegos, para que no se lea como permiso para saltarse una capa':
      () => expect(Documento.texto('simplicity.md')).toContain('Nothing here authorises dropping a layer'),
    'declara su frontera con el item alcance de la rubrica, que pregunta otra cosa':
      () => expect(Documento.texto('simplicity.md')).toContain('What the plan asked for is a different question from this one'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`simplicity.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Desde `plugin/`: `npx vitest run __tests__/conventions-vara.test.js`
Esperado: FAIL — `ENOENT` al leer `conventions/simplicity.md` en todos los `it` nuevos y en los tres genéricos de `simplicity.md`.

- [ ] **Step 3: Escribir `plugin/conventions/simplicity.md`**

Encabezados exactos, en este orden, y con las frases que los tests exigen dentro:

```markdown
# What a diff does not add

Applies to: **every diff**.

[la regla única: "the burden of proof is on what is added", y que se descarga
contra el problema que se resuelve hoy; "It might one day" no la descarga]

**Nothing here authorises dropping a layer.** [las capas, los ports y los value
objects son cómo se construye, no complejidad que recortar. **Dice `dropping` y no
`skipping` a propósito: el guardián de la vara prohíbe el término `skip`, que es del
ítem `manipulacion-tests` de la rúbrica, y la frase original lo contenía dentro de
una palabra. Se cambia la frase, nunca el guardián.**]

## The guard lives where the value enters from outside

## A field, a branch and a public symbol answer to a call that exists

## An unreachable check is not a check

## Observability answers to a reader who exists

## A request from a review or a judgement is not exempt

## What other documents own, and this one does not repeat

## Antipatterns
```

Reglas de redacción de esta tarea:

- La sección de la guarda dice que el chequeo de lo que un valor **carries** ocurre una vez, en la puerta por la que entra de fuera, y que aguas abajo todo llamante es código propio. **No cita `conventions/domain.md` todavía**: ese documento nace en la Tarea 2 y el test `every document it cites by name is a document that exists` caería. La remisión a la guarda propia del value object la añade la Tarea 2, que es cuando el documento existe.
- La sección del campo cierra con la pregunta literal: `which call breaks without it`.
- La sección del check inalcanzable dice que una mutación que sobrevive tiene dos reparaciones y que cuál de las dos lo decide `conventions/testing.md`.
- La sección de observabilidad cierra con la pregunta literal: `who reads this, and where`.
- La sección de la petición contiene `does not move when the addition is asked for by a reviewer, a verifier or a judge`, y la salida: `goes back as a finding for a human to decide, and is not implemented meanwhile`.
- **La frontera con la rúbrica** va en la sección "What other documents own": una línea que diga `What the plan asked for is a different question from this one`, y a continuación que este documento pregunta por el llamante y no por la frase del plan, así que una adición que el plan pidió y que ningún llamante usa se mide aquí. **No se nombra el ítem de la rúbrica por su nombre ni se usan las palabras que el test de rúbrica prohíbe.**

- [ ] **Step 4: Añadir el nombre a `FILES`**

En `plugin/scripts/plugin-yardstick.js`:

```js
static FILES = ['defects.md', 'style.md', 'simplicity.md', 'decisions.md', 'architecture.md', 'testing.md']
```

- [ ] **Step 5: Correr los tests y verlos pasar**

Desde `plugin/`:
- `npx vitest run __tests__/conventions-vara.test.js` → PASS
- `npx vitest run __tests__/plugin-yardstick.test.js` → PASS. **Toda tarea que toca `FILES` corre este fichero**: su fixture y tres de sus aserciones enumeran los documentos por su nombre, y una lista que se queda corta rompe seis tests sin que nada más lo note.
- `npx vitest run __tests__/ct-step-vara-y-telemetria.test.js` → PASS. Este itera `PluginYardstick.FILES`, así que ya exige que `simplicity.md` viaje pegado y verbatim en el brief; es la prueba de que el transporte no necesitó cambios.
- `npx vitest run __tests__/run-metrics.test.js` → PASS. Es la prueba de que `briefVaraCtMeasures` cuenta cabeceras y no depende del número de documentos.

- [ ] **Step 6: Commit**

```bash
git add plugin/conventions/simplicity.md plugin/scripts/plugin-yardstick.js plugin/__tests__/conventions-vara.test.js
git commit -m "feat(conventions): la vara de ct mide lo que un diff no añade"
```

---

### Task 2: `domain.md`

**Files:**
- Create: `plugin/conventions/domain.md`
- Modify: `plugin/conventions/simplicity.md` (la remisión que la Tarea 1 no pudo escribir)
- Modify: `plugin/scripts/plugin-yardstick.js:3` (`FILES`)
- Test: `plugin/__tests__/conventions-vara.test.js`

**Interfaces:**
- Consumes: `simplicity.md` existe y remite aquí para la guarda propia del value object (Tarea 1, Step 3).
- Produces: el nombre `domain.md` en `PluginYardstick.FILES`, quinta posición.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir `'domain.md': 'every diff'` al mapa `ALCANCES`, y este `describe`:

```js
describe('domain.md keeps the tools out of the domain', () => {
  const AFIRMACIONES = {
    'declara que el port dice lo que el dominio necesita, no lo que el adaptador sabe hacer':
      () => expect(Documento.texto('domain.md')).toContain('The port declares what the domain needs, not what the adapter knows how to do'),
    'da el test que decide un nombre: cambiar el adaptador convierte el nombre en mentira':
      () => expect(Documento.texto('domain.md')).toContain('makes the name a lie'),
    'corta el port por quien esta al otro lado y no por paso del flujo':
      () => expect(Documento.texto('domain.md')).toContain('never by step of the flow'),
    'identifica al colaborador por lo que se le pide, no por lo que responde':
      () => expect(Documento.texto('domain.md')).toContain('identified by what is asked of it'),
    'dice que lo que nunca se duplica es la intencion, no la forma':
      () => expect(Documento.texto('domain.md')).toContain('Repeated shape is not the subject'),
    'dice cual es la guarda del value object, y que se queda aunque hoy nadie la necesite':
      () => expect(Documento.texto('domain.md')).toContain('what makes them this value and not any value'),
    'excluye la segunda opinion sobre lo que otro tipo ya garantiza':
      () => expect(Documento.texto('domain.md')).toContain('re-verifies what another type already guarantees'),
    'separa las dos causas de fallo porque se reparan en sitios distintos':
      () => expect(Documento.texto('domain.md')).toContain('they are repaired in different places'),
    'remite a simplicity.md para lo que pasa aguas abajo de una puerta':
      () => expect(Documento.texto('domain.md')).toContain('`conventions/simplicity.md`'),
    'y simplicity.md ya remite aqui para la guarda propia del value object':
      () => expect(Documento.texto('simplicity.md')).toContain('`conventions/domain.md`'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`domain.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Desde `plugin/`: `npx vitest run __tests__/conventions-vara.test.js`
Esperado: FAIL — `ENOENT` al leer `conventions/domain.md`.

- [ ] **Step 3: Escribir `plugin/conventions/domain.md`**

```markdown
# The domain and its words

Applies to: **every diff** — the rule about names binds wherever a domain word
is chosen, not only inside the domain layer.

## The domain does not speak any tool's language

## One port per collaborator, growing with methods

## Value objects

## Exceptions: families of two causes

## Antipatterns
```

Reglas de redacción de esta tarea:

- La primera sección lleva la frase del test y el criterio que lo decide: si cambiar el adaptador por otra implementación `makes the name a lie`, el nombre pertenece al adaptador. Los dos casos que lo pagaron van **sin los nombres de este repositorio**: un tipo nombrado por lo que reparte una herramienta de sesiones cuando el dominio necesitaba *quien planifica*, y otro nombrado por lo que vende un gestor de incidencias cuando el dominio necesitaba *la historia a planificar*.
- La sección del port dice que corta por quién está al otro lado, `never by step of the flow`, que el colaborador está `identified by what is asked of it` y no por el ejecutable ni el servicio que contesta, que dos preguntas distintas son dos ports, y cierra con `Repeated shape is not the subject; repeated intent is.` remitiendo a `conventions/decisions.md`.
- La sección del value object dice que queda congelado en construcción y que guarda `what makes them this value and not any value`, citando lo que recibió; que esa guarda se queda aunque los llamantes de hoy ya la satisfagan; y que lo que no le corresponde es el chequeo que `re-verifies what another type already guarantees`. Remite a `conventions/simplicity.md` para lo que pasa aguas abajo de una puerta.
- **Y se cierra la remisión que la Tarea 1 no pudo escribir:** en `simplicity.md`, la sección de la guarda gana la línea que remite a `conventions/domain.md` para la guarda que un value object mantiene para sí — eso es de ese documento y `simplicity.md` no lo repite. Ahora el documento existe y la cita se puede seguir.
- La sección de las excepciones separa las dos causas —el sistema externo falló, con la razón en su canal de error; y contestó algo que no sabemos leer, con nuestro contrato roto— porque `they are repaired in different places`, y remite a `conventions/boundaries.md` para la proyección de cada causa hacia fuera. **Esa cita obliga a que la Tarea 3 exista**: el test de citas cruzadas del fichero falla si `boundaries.md` no está. Por eso esta cita se escribe aquí y no antes.

- [ ] **Step 4: Añadir el nombre a `FILES`**

```js
static FILES = ['defects.md', 'style.md', 'simplicity.md', 'decisions.md', 'domain.md', 'architecture.md', 'testing.md']
```

- [ ] **Step 5: Correr los tests**

Desde `plugin/`: `npx vitest run __tests__/conventions-vara.test.js __tests__/plugin-yardstick.test.js` — el segundo porque esta tarea toca `FILES` y ese fichero enumera los documentos en su fixture y en tres aserciones.
Esperado: FAIL en un solo test — `every document it cites by name is a document that exists`, porque `domain.md` cita `conventions/boundaries.md`, que aún no existe. **Ese fallo es el esperado y es la costura con la Tarea 3.** Si prefieres no dejar rojo entre tareas, la cita a `boundaries.md` se escribe en el Step 3 de la Tarea 3 en vez de aquí; en ese caso este Step 5 debe salir en verde.

- [ ] **Step 6: Commit**

```bash
git add plugin/conventions/domain.md plugin/conventions/simplicity.md plugin/scripts/plugin-yardstick.js plugin/__tests__/conventions-vara.test.js
git commit -m "feat(conventions): la vara de ct mide el nombre, el port y el value object"
```

---

### Task 3: `boundaries.md` nace y `architecture.md` se vacía

La tarea con más riesgo, y las dos mitades son una sola operación: si las reglas del borde se escriben en `boundaries.md` sin quitarlas de `architecture.md`, quedan escritas dos veces. Se hace en un commit para que ningún estado intermedio tenga la duplicación.

**Files:**
- Create: `plugin/conventions/boundaries.md`
- Modify: `plugin/conventions/architecture.md` (borrar `## The boundary` y `## The entrypoint` enteras, y sus antipatrones)
- Modify: `plugin/scripts/plugin-yardstick.js:3` (`FILES`)
- Test: `plugin/__tests__/conventions-vara.test.js`, `plugin/__tests__/plugin-yardstick.test.js`

**Interfaces:**
- Consumes: la cita a `conventions/boundaries.md` que dejó `domain.md` (Tarea 2).
- Produces: el nombre `boundaries.md` en `PluginYardstick.FILES`, séptima posición.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir `'boundaries.md': 'every diff'` al mapa `ALCANCES`, y estos dos `describe` — el segundo es el que defiende el vaciado:

```js
describe('boundaries.md owns the outer edge, in both shapes a program has', () => {
  const AFIRMACIONES = {
    'quien llama declara si su llamada es segura de repetir':
      () => expect(Documento.texto('boundaries.md')).toContain('The caller declares whether its call is safe to repeat'),
    'el tronco sabe el idioma de la red y la especializacion el de su sistema':
      () => expect(Documento.texto('boundaries.md')).toContain("the subclass knows the tool's"),
    'un sistema sin idioma medido hereda el tronco desnudo':
      () => expect(Documento.texto('boundaries.md')).toContain('inventing markers nobody measured is a preference dressed as a rule'),
    'un rate limit no es un blip':
      () => expect(Documento.texto('boundaries.md')).toContain('A rate limit is not a blip'),
    'el fallo del sistema externo vuelve como dato':
      () => expect(Documento.texto('boundaries.md')).toContain('is data, not an exception'),
    'ningun sistema externo se llama sin tope, y el adaptador no lo elige':
      () => expect(Documento.texto('boundaries.md')).toContain('the adapter does not choose the cap'),
    'la conversion al dominio vive en el modelo del borde, con una puerta':
      () => expect(Documento.texto('boundaries.md')).toContain('The conversion to the domain lives in the'),
    'el texto de otro sistema entra con su sintaxis activa aquietada':
      () => expect(Documento.texto('boundaries.md')).toContain('gets its active syntax quieted'),
    'la proyeccion del vocabulario hacia fuera es exhaustiva y devuelve un value object':
      () => expect(Documento.texto('boundaries.md')).toContain('is exhaustive and returns a value object'),
    'el codigo de una respuesta se declara y no se deriva del nombre de una clase':
      () => expect(Documento.texto('boundaries.md')).toContain("never derived from an exception's class name"),
    'el borde exterior es el unico que ensambla el grafo':
      () => expect(Documento.texto('boundaries.md')).toContain('the only place that assembles the dependency graph'),
    'nombra las DOS formas del borde, no solo el programa que termina':
      () => {
        const texto = Documento.texto('boundaries.md')
        expect(texto).toContain('a program that ends')
        expect(texto).toContain('a service that answers')
      },
    'conserva la regla que vale en las dos formas':
      () => expect(Documento.texto('boundaries.md')).toContain('One code per decision of whoever receives'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`boundaries.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('architecture.md kept nothing of the edge, so no rule is written twice', () => {
  // Dos listas y no una: los encabezados DESAPARECEN de architecture.md y
  // boundaries.md tiene los suyos propios, así que de ellos sólo se comprueba la
  // ausencia. Las reglas se comprueban en los dos lados: ausentes allí, presentes aquí.
  const ENCABEZADOS_QUE_DESAPARECEN = ['## The boundary', '## The entrypoint']

  const REGLAS_QUE_SE_MUDAN = [
    'exit codes',
    'assembles the dependency graph',
    'An unknown key is a rejection',
    'validated by projection',
    'a cast checks nothing',
    'without a cap',
    'is data, not an exception',
    'An adapter is named after its implementation',
    'An adapter does not decide policy',
    "the contract's name",
  ]

  for (const encabezado of ENCABEZADOS_QUE_DESAPARECEN) {
    it(`architecture.md ya no tiene la seccion ${encabezado}`, () => {
      expect(Documento.texto('architecture.md')).not.toContain(encabezado)
    })
  }

  for (const regla of REGLAS_QUE_SE_MUDAN) {
    it(`no queda en architecture.md: ${regla}`, () => {
      expect(Documento.texto('architecture.md')).not.toContain(regla)
    })

    it(`y esta en boundaries.md: ${regla}`, () => {
      expect(Documento.texto('boundaries.md')).toContain(regla)
    })
  }
})
```

- [ ] **Step 1b: Escribir el test del alcance, que es lo que distingue a los tres nuevos**

En `plugin/__tests__/plugin-yardstick.test.js`, donde ya viven los tests de `forTask` y `appliesToTask`. Este es el único test que prueba la diferencia entre el alcance de los tres nuevos y el de `architecture.md`, y sin él nada impide que un documento nuevo nazca con `Applies to: new modules` por copia:

```js
it('los tres documentos nuevos alcanzan a una tarea que no crea ninguna ruta, y architecture.md no', () => {
  const documentos = ['simplicity.md', 'domain.md', 'boundaries.md', 'architecture.md'].map((name) => ({
    name,
    content: readFileSync(join(pluginRoot, 'conventions', name), 'utf8'),
  }))
  const alcanzan = PluginYardstick.forTask(documentos, { creates: false }).map((d) => d.name)
  expect(alcanzan).toEqual(['simplicity.md', 'domain.md', 'boundaries.md'])
})
```

(`pluginRoot` es la raíz que ese fichero ya resuelve para leer los documentos; si aún no la tiene, se resuelve igual que en `conventions-vara.test.js`.)

- [ ] **Step 2: Correr los tests y verlos fallar**

Desde `plugin/`: `npx vitest run __tests__/conventions-vara.test.js __tests__/plugin-yardstick.test.js`
Esperado: FAIL — `ENOENT` en los tests de `boundaries.md`, los dos `architecture.md ya no tiene la seccion ...` y los nueve `no queda en architecture.md: ...` porque todo eso está hoy en `architecture.md`, y el del alcance porque `boundaries.md` no existe.

- [ ] **Step 3: Escribir `plugin/conventions/boundaries.md`**

```markdown
# The outer edge

Applies to: **every diff**.

## Talking to an external system

## Boundary models

## Answering outwards

## The outer edge of the program

## Antipatterns
```

Reglas de redacción de esta tarea:

- "Talking to an external system" lleva, en este orden: el fallo que vuelve como dato (`is data, not an exception`) porque la razón viaja en el canal de diagnóstico y un throw en el sitio de la llamada la borra; `The caller declares whether its call is safe to repeat` con el caso de la creación cuya respuesta se perdió; el tope (`the adapter does not choose the cap`, entra por el constructor sin valor por defecto, falla cerrado y descarta lo escrito a medias); el tronco y la especialización (`the subclass knows the tool's`) con `inventing markers nobody measured is a preference dressed as a rule`; y `A rate limit is not a blip`.
- "Boundary models" lleva `The conversion to the domain lives in the boundary model`, con una puerta; que se proyectan sólo las claves que se consumen y que una respuesta a la que le falta lo declarado falla citando las palabras del sistema; que una clave desconocida es un rechazo (`An unknown key is a rejection`); que un cast no comprueba nada (`a cast checks nothing`); `validated by projection` para el formato ajeno de vocabulario abierto; `An adapter is named after its implementation`; `An adapter does not decide policy`; y que el texto de otro sistema `gets its active syntax quieted` antes de entrar en un documento ajeno, con el caso medido y sin nombrar el producto.
- "Answering outwards" lleva la proyección que `is exhaustive and returns a value object` y levanta ante un miembro sin mapear, y el código declarado junto a su detalle, `never derived from an exception's class name`, con el motivo: renombrar la excepción cambiaría en silencio lo que recibe el cliente.
- "The outer edge of the program" es la sección reescrita, y es donde está el desacoplamiento: `the only place that assembles the dependency graph`, sin contenedor de inyección y con el constructor como costura; y la traducción de los errores del dominio al vocabulario de su invocador, con las dos formas nombradas — `a program that ends` (el código de salida, con el resultado en el canal estándar y el diagnóstico en el de error, siempre separados) y `a service that answers` (la respuesta, y el traductor se llama manejador) — cerrando con `One code per decision of whoever receives, not one per error.`

- [ ] **Step 4: Vaciar `plugin/conventions/architecture.md`**

Borrar enteras las secciones `## The boundary` y `## The entrypoint`, y de `## Antipatterns` estas seis líneas:

```
- A cast at the boundary.
- A boundary model that ignores unknown keys.
- An adapter that decides policy.
- A call to an external process with no cap, or an adapter that picks its own.
- A validation error leaving the boundary layer.
- A port whose only method returns a constant.
```

Las cinco primeras se van a los antipatrones de `boundaries.md`. **La sexta se queda en `architecture.md`**: el port cuyo único método devuelve una constante es una regla de la forma del caso de uso, que sigue viviendo ahí, y su línea ya está en la sección "The shape of a use case" — sólo hay que dejarla en un antipatrón de un documento y no de dos.

- [ ] **Step 5: Añadir el nombre a `FILES`**

```js
static FILES = ['defects.md', 'style.md', 'simplicity.md', 'decisions.md', 'domain.md', 'architecture.md', 'boundaries.md', 'testing.md']
```

- [ ] **Step 6: Correr los tests y verlos pasar**

Desde `plugin/`:
- `npx vitest run __tests__/conventions-vara.test.js` → PASS, incluido el test de citas cruzadas que la Tarea 2 dejó rojo.
- `npx vitest run __tests__/plugin-yardstick.test.js` → PASS.
- `npx vitest run __tests__/ct-step-vara-y-telemetria.test.js` → PASS.
- `npx vitest run __tests__/modulos-conformes.test.js` → PASS. Es el guardián que mide los módulos del plugin contra la vara; se corre aquí porque esta tarea cambia qué exige la vara sobre bordes en todo diff.

- [ ] **Step 7: Commit**

```bash
git add plugin/conventions/boundaries.md plugin/conventions/architecture.md plugin/scripts/plugin-yardstick.js plugin/__tests__/conventions-vara.test.js plugin/__tests__/plugin-yardstick.test.js
git commit -m "feat(conventions): el borde sale de architecture.md y rige en todo diff"
```

---

### Task 4: la vara deja de presuponer la forma del programa, y nadie dice "cinco"

**Files:**
- Modify: `plugin/scripts/run-metrics.js:213`, `plugin/scripts/ct-next.mjs:53`, `plugin/scripts/kickoff.js:154`, `plugin/scripts/ct-step.mjs:1459`, `plugin/agents/ct-reconciler.md:46`, `plugin/skills/writing-plans-prescriptive/SKILL.md:59,248`
- Test: `plugin/__tests__/conventions-vara.test.js`, `plugin/__tests__/ct-step-vara-y-telemetria.test.js:198`

**Interfaces:**
- Consumes: los ocho documentos ya existen (Tareas 1-3).
- Produces: nada que otra tarea use.

- [ ] **Step 1: Escribir los tests que fallan**

En `conventions-vara.test.js`:

```js
describe('the yardstick names no language and no tool', () => {
  const PROHIBIDOS = [
    /vitest/i, /pytest/i, /execFile/, /\bnpx\b/, /Object\.freeze/, /\bfetch\b/,
    /\.m?jsx?\b/, /\.tsx?\b/, /\bnode_modules\b/,
  ]

  for (const nombre of Object.keys(ALCANCES)) {
    for (const prohibido of PROHIBIDOS) {
      it(`${nombre} no nombra ${prohibido}`, () => {
        expect(Documento.texto(nombre)).not.toMatch(prohibido)
      })
    }
  }

  it('donde la vara habla de un codigo de salida, nombra tambien la otra forma del borde', () => {
    for (const nombre of Object.keys(ALCANCES)) {
      const texto = Documento.texto(nombre)
      if (!/exit code/i.test(texto)) continue
      expect(texto, `${nombre} habla de exit code sin nombrar el servicio que atiende`)
        .toContain('a service that answers')
    }
  })

  it('nadie en el plugin sigue diciendo que la vara son cinco documentos', () => {
    const fuentes = ['scripts/run-metrics.js', 'scripts/ct-next.mjs', 'scripts/kickoff.js', 'scripts/ct-step.mjs',
      'agents/ct-reconciler.md', 'skills/writing-plans-prescriptive/SKILL.md']
    for (const ruta of fuentes) {
      const texto = readFileSync(join(root, ruta), 'utf8')
      expect(texto, `${ruta} sigue diciendo cinco`).not.toMatch(/cinco documentos|five documents/i)
    }
  })
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Desde `plugin/`: `npx vitest run __tests__/conventions-vara.test.js`
Esperado: FAIL en `nadie en el plugin sigue diciendo que la vara son cinco documentos` (seis ficheros la contienen). Los de tokens prohibidos deberían pasar ya si las Tareas 1-3 respetaron la restricción global; si alguno falla, el arreglo es el documento y no el test.

- [ ] **Step 3: Cambiar las seis prosas**

Una por una, y ninguna es un número suelto:

- `run-metrics.js:213`: donde dice que con los cinco documentos de hoy el techo es 5, decir que el techo es el número de documentos que la vara declara —hoy ocho— y que un número por debajo dice cuál sobra o cuál no se está mirando. **No introducir un literal**: la columna se sigue calculando sobre el `result` de los ítems.
- `ct-next.mjs:53`: "estos cinco documentos" → "los documentos de la vara".
- `kickoff.js:154`: el comentario que explica por qué `conventionsDir` es obligatorio dice que omitido produciría "los cinco documentos de undefined"; cambiar a "los documentos de undefined".
- `ct-step.mjs:1459`: "los cinco documentos enteros son 24 KB" → "los ocho documentos enteros son unos 35 KB". El argumento no cambia: por eso el reconciliador los recibe por ruta.
- `agents/ct-reconciler.md:46`: "the five documents of the plugin's `conventions/`" → "the documents of the plugin's `conventions/`".
- `writing-plans-prescriptive/SKILL.md:59` y `:248`: igual, y en `:248` revisar además la frase que dice que §3 nombra los tres primeros por ruta, que con el orden nuevo ya no describe nada.

- [ ] **Step 4: Renombrar los dos `it` que cuentan documentos en `ct-step-vara-y-telemetria.test.js`**

El de `:198` itera `PluginYardstick.FILES` y por tanto ya cubre ocho; sólo su nombre miente:

```js
it('el brief termina con los documentos de la vara, DETRÁS de la tarea', () => {
```

Y el de `:238` —**reasignado aquí desde la revisión de la Tarea 2**— dice "los otros cuatro" y su bucle enumera cuatro documentos cuando ya viajan más. Es una comprobación de subconjunto, así que sigue verde mientras miente: renómbralo y haz que su lista salga de `PluginYardstick.FILES` menos los que la tarea no alcanza, en vez de estar escrita a mano. Un nombre que lleva la cuenta volverá a mentir en el octavo documento, así que el nombre nuevo no la lleva.

- [ ] **Step 5: Correr los tests y verlos pasar**

Desde `plugin/`:
- `npx vitest run __tests__/conventions-vara.test.js` → PASS
- `npx vitest run __tests__/ct-step-vara-y-telemetria.test.js` → PASS
- `npx vitest run __tests__/run-metrics.test.js` → PASS
- `npx vitest run __tests__/kickoff.test.js` → PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/scripts plugin/agents plugin/skills plugin/__tests__
git commit -m "fix(conventions): la vara no presupone la forma del programa ni son cinco"
```

---

### Task 5: `architecture.md` gana el árbol y la carga de la prueba del tipo nuevo

**Files:**
- Modify: `plugin/conventions/architecture.md`
- Test: `plugin/__tests__/conventions-vara.test.js`

**Interfaces:**
- Consumes: `architecture.md` ya vaciada de bordes (Tarea 3).
- Produces: nada.

- [ ] **Step 1: Escribir los tests que fallan**

```js
describe('architecture.md says where a new thing goes, and makes the layers visible', () => {
  const AFIRMACIONES = {
    'exige que las capas y sus habitantes se vean en el arbol':
      () => expect(Documento.texto('architecture.md')).toContain('the folder is the discriminator, never a suffix on the name'),
    'pone la carga de la prueba en el tipo nuevo, con el metodo como respuesta por defecto':
      () => expect(Documento.texto('architecture.md')).toContain('a method on a type that already exists'),
    'dice que un test no es un consumidor':
      () => expect(Documento.texto('architecture.md')).toContain('a test double is not a consumer'),
    'deja el payload de un solo dueño en el fichero de su dueño':
      () => expect(Documento.texto('architecture.md')).toContain("shares the owner's file"),
    'dice que una clase que nadie instancia es un namespace y eso no le gana un modulo':
      () => expect(Documento.texto('architecture.md')).toContain('A class nobody instantiates is a namespace'),
    'exige un cliente por sistema externo, nunca uno por llamada':
      () => expect(Documento.texto('architecture.md')).toContain('never a client per call'),
    'exige un controlador por endpoint, con su modelo y sus proyecciones dentro':
      () => expect(Documento.texto('architecture.md')).toContain('One controller per endpoint'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`architecture.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Desde `plugin/`: `npx vitest run __tests__/conventions-vara.test.js`
Esperado: FAIL en los siete.

- [ ] **Step 3: Escribir las secciones nuevas de `architecture.md`**

Dos secciones nuevas, y ninguna sustituye a las que ya están:

- Dentro de la sección de las tres capas, un párrafo: las capas y sus habitantes **se ven en el árbol** — una carpeta por capa, y dentro de cada capa una carpeta por clase de habitante (los value objects, los ports, las policies; las acciones y las consultas; los adaptadores y los controladores) — y `the folder is the discriminator, never a suffix on the name`. El nombre de la carpeta raíz y los nombres de fichero son del repositorio, no de esta regla.
- Una sección nueva, `## A new type has the burden of proof`, después de `## One concept per module` (que la complementa: aquélla da el criterio, ésta el orden de respuestas por defecto). Lleva: la respuesta por defecto a comportamiento nuevo es `a method on a type that already exists`; la respuesta por defecto a un tipo nuevo es dentro del módulo que lo consume; gana módulo propio si algo más lo construye, si otro módulo lo consume o si lleva su álgebra propia; y `a test double is not a consumer` y los tests no son una capa. Los cuatro casos cerrados, con el payload que `shares the owner's file`, el modelo de borde que comparte el fichero de su adaptador mientras sea su único consumidor, `A class nobody instantiates is a namespace` (tolerado sólo porque `conventions/style.md` prohíbe las funciones sueltas) y un cliente por sistema externo, `never a client per call`.
- Una sección nueva, `## One controller per endpoint`: la ruta, su modelo de petición con el vocabulario cerrado de resultados y las proyecciones viajan en un módulo; el endpoint siguiente es un fichero nuevo y una línea de montaje; lo que todo endpoint repetiría vive en un solo módulo.
- Añadir a `## Antipatterns`: un sufijo haciendo el trabajo de una carpeta; un tipo nuevo para lo que un método de un tipo existente podía llevar; un módulo cuyo único consumidor es otro módulo, sin segundo constructor ni álgebra propia; el parseo o los rechazos de un segundo endpoint dentro de lo compartido.

- [ ] **Step 4: Correr los tests y verlos pasar**

Desde `plugin/`:
- `npx vitest run __tests__/conventions-vara.test.js` → PASS
- `npx vitest run __tests__/modulos-conformes.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/conventions/architecture.md plugin/__tests__/conventions-vara.test.js
git commit -m "feat(conventions): las capas se ven en el árbol y un tipo nuevo se justifica"
```

---

### Task 6: `testing.md` gana las tres reglas y la barrida de mutación

**Files:**
- Modify: `plugin/conventions/testing.md`
- Test: `plugin/__tests__/conventions-vara.test.js`

**Interfaces:**
- Consumes: `simplicity.md` remite aquí para la doble reparación de una mutación que sobrevive (Tarea 1).
- Produces: nada.

- [ ] **Step 1: Escribir los tests que fallan**

```js
describe('testing.md pins how each layer is measured, and hunts what no test watches', () => {
  const AFIRMACIONES = {
    'el caso de uso es una caja negra y el dominio no tiene tests propios':
      () => expect(Documento.texto('testing.md')).toContain('A use case is a black box'),
    'el adaptador se corta justo antes del sistema externo':
      () => expect(Documento.texto('testing.md')).toContain('cutting right before the external system'),
    'declara la excepcion del adaptador que ES la llamada':
      () => expect(Documento.texto('testing.md')).toContain('an adapter that *is* the call'),
    'la integracion desde el borde cubre solo el camino feliz':
      () => expect(Documento.texto('testing.md')).toContain('covers the happy path, and only that'),
    'el controlador se mide por un servidor de verdad, no llamando al handler':
      () => expect(Documento.texto('testing.md')).toContain('never calling the handler as a function'),
    'un rechazo nunca llega a un doble':
      () => expect(Documento.texto('testing.md')).toContain('A refusal never reaches a double'),
    'las dos causas de fallo de un adaptador se distinguen en sus tests':
      () => expect(Documento.texto('testing.md')).toContain('proves one is not an instance of the other'),
    'exige la barrida de mutacion y dice que caza la linea que nadie mira':
      () => expect(Documento.texto('testing.md')).toContain('hunt **the mutations that leave it green**'),
    'lleva la disciplina del harness: una sustitucion que no encaja falla ruidosa':
      () => expect(Documento.texto('testing.md')).toContain('a silent miss is a green that measured nothing'),
    'lleva la disciplina del harness: el fichero se restaura y se verifica':
      () => expect(Documento.texto('testing.md')).toContain('restored and verified identical afterwards'),
    'da las dos reparaciones posibles de una mutacion que sobrevive':
      () => expect(Documento.texto('testing.md')).toContain('the test nobody wrote, or the line nobody needs'),
    'obliga a declarar lo que se deja sin medir, con su motivo':
      () => expect(Documento.texto('testing.md')).toContain('What stays unmeasured, on purpose'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`testing.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})
```

- [ ] **Step 2: Correr los tests y verlos fallar**

Desde `plugin/`: `npx vitest run __tests__/conventions-vara.test.js`
Esperado: FAIL en los doce.

- [ ] **Step 3: Escribir las secciones nuevas de `testing.md`**

Cuatro secciones nuevas, sin tocar las que ya están:

- `## Three rules, and everything below follows from them`: la lista numerada de tres, con `A use case is a black box` y el dominio sin tests propios; el adaptador probado `cutting right before the external system`, con la excepción de `an adapter that *is* the call` (un repositorio de base de datos, donde una vez doblado el sistema no queda nada que asertar) que corre lo real y es el único que lo hace; y la integración desde el borde que `covers the happy path, and only that`.
- `## How each layer is tested`: la tabla, con una fila por capa. El controlador se mide a través de un servidor escuchando de verdad y un cliente real, `never calling the handler as a function`. La aplicación, por lo que cada port recibió y lo que devolvió, con el orden clavado por los cortes. El dominio, nada. Los adaptadores, la petición literal y el parseo de salida grabada real. Los payloads de borde, leídos por el lector real del otro lado cuando vive en el repositorio. Debajo, `A refusal never reaches a double` y que las dos causas de fallo de cada adaptador se distinguen en sus tests, que `proves one is not an instance of the other`.
- `## The mutation sweep`: mutar el código de producción un cambio a la vez tras cada ronda, correr la suite y `hunt **the mutations that leave it green**`; la disciplina, con `a silent miss is a green that measured nothing`, el fichero `restored and verified identical afterwards` y el árbol comiteado antes; que una mutación que cuelga la suite en vez de hacerla fallar es un hallazgo por sí misma; y las dos reparaciones, `the test nobody wrote, or the line nobody needs`.
- `## What stays unmeasured, on purpose`: los valores de los presupuestos son policy y no mecanismo; una aserción que sólo puede fallar si falla el lenguaje no se escribe; y lo que se deja fuera se declara con su motivo para que nadie lo persiga.
- Añadir a `## Antipatterns`: un test del dominio alcanzable desde la aplicación (ya está); una integración que mide un rechazo; un adaptador cuyos dos fallos no se distinguen; una ronda entregada sin barrida; una mutación superviviente sin decidir cuál de las dos reparaciones le toca.

**Cuidado con la restricción global:** este documento no puede contener `deterministic`, `isolated`, `call count` ni `real behaviour` — el test `none repeats a rule that a rubric item already owns` los prohíbe porque son del ítem `test-desiderata`. Donde haga falta decir eso, se dice con otras palabras.

- [ ] **Step 4: Correr los tests y verlos pasar**

Desde `plugin/`:
- `npx vitest run __tests__/conventions-vara.test.js` → PASS, incluido `none repeats a rule that a rubric item already owns`
- `npx vitest run __tests__/judge-bench.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/conventions/testing.md plugin/__tests__/conventions-vara.test.js
git commit -m "feat(conventions): la vara mide cada capa y exige la barrida de mutación"
```

---

### Task 7: el plan deja de estar invitado a no leer

**Files:**
- Modify: `plugin/scripts/kickoff.js:254`
- Test: `plugin/__tests__/kickoff.test.js:400`

**Interfaces:**
- Consumes: `simplicity.md` y `decisions.md` existen en la vara.
- Produces: nada.

- [ ] **Step 1: Cambiar el test que hoy afirma lo contrario**

El test `no manda leer los cinco documentos antes de planificar` sigue siendo válido en su mitad —no se manda leer los ocho— pero pasa a exigir los dos que un plan no puede no haber abierto. Reemplazarlo por:

```js
it('no manda leer la vara entera, pero nombra los dos que el plan no puede no haber abierto', () => {
  const k = renderKickoff(SLICE, OPTS_CON_VARA)
  expect(k).not.toMatch(/LEE la vara de ct/)
  expect(k).not.toMatch(/los ocho documentos de/)
  expect(k).toContain('simplicity.md')
  expect(k).toContain('decisions.md')
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Desde `plugin/`: `npx vitest run __tests__/kickoff.test.js`
Esperado: FAIL — el kickoff no nombra hoy ninguno de los dos.

- [ ] **Step 3: Cambiar la frase del kickoff**

En `kickoff.js`, dentro de la entrada que hoy dice "No hace falta que abras los cinco documentos ahora", sustituir esa oración por una que nombre los dos y siga sin mandar leer el resto. El argumento, que va en el comentario de encima y no en el prompt: un plan que prescribe un campo, una guarda o un símbolo público sin haber leído `simplicity.md` prescribe lo que el juez marcará después, y el implementador tiene orden de no desviarse del plan.

La frase queda así:

```
Antes de escribir el plan abre dos de ellos, porque el plan decide justo lo que miden: `simplicity.md` (la carga de la prueba está en lo que se añade, y que el plan lo pida no la descarga) y `decisions.md` (dónde vive una decisión, para que no la escribas dos veces). Los demás, el que necesites para decidir algo concreto. Lo que el plan tiene que seleccionar sigue siendo la vara del REPO, en el `Rules to obey:` de §3.
```

- [ ] **Step 4: Correr los tests y verlos pasar**

Desde `plugin/`:
- `npx vitest run __tests__/kickoff.test.js` → PASS, incluido `la orden cae ANTES de la entrada que manda escribir el plan`
- `npx vitest run __tests__/ct-next-conventions.test.js` → PASS. Es el que ejercita el cableado de `conventionsDir` desde `ct-next`, así que es el que caza que la frase nueva llegue con la ruta absoluta interpolada y no con el token sin sustituir.

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/kickoff.js plugin/__tests__/kickoff.test.js
git commit -m "feat(kickoff): el plan abre simplicity y decisions antes de prescribir"
```

---

### Task 8: el juez de slice recibe una sola ruta

**Files:**
- Modify: `plugin/scripts/step-contracts.js:484` (`SLICE_PACKAGE_SECTIONS`)
- Modify: `plugin/scripts/ct-step.mjs:778-797` (`escribirPaqueteDeSlice`)
- Modify: `plugin/agents/ct-slice-judge.md`
- Test: `plugin/__tests__/step-contracts.test.js`

**Interfaces:**
- Consumes: `plugin/conventions/simplicity.md` (Tarea 1) y `PluginYardstick.DIRECTORY`.
- Produces: la sección `Vara` como primera del paquete de slice, antes de `Señal`.

- [ ] **Step 1: Escribir el test que falla**

En `step-contracts.test.js`:

```js
it('el paquete del juez de slice abre con la ruta de simplicity.md, que es la vara de su ítem observabilidad', () => {
  expect(SLICE_PACKAGE_SECTIONS[0]).toBe('Vara')
  expect(SLICE_PACKAGE_SECTIONS).toEqual(['Vara', 'Señal', 'Commits', 'Files changed', 'Diff'])
})
```

Y en el fichero que ya ejercita `escribirPaqueteDeSlice` end to end, un test que lea el paquete escrito y compruebe que su sección `## Vara` contiene la ruta absoluta que acaba en `conventions/simplicity.md`.

- [ ] **Step 2: Correr los tests y verlos fallar**

Desde `plugin/`: `npx vitest run __tests__/step-contracts.test.js`
Esperado: FAIL — hoy `SLICE_PACKAGE_SECTIONS` es `['Señal', 'Commits', 'Files changed', 'Diff']`.

- [ ] **Step 3: Añadir la sección**

- `step-contracts.js`: `export const SLICE_PACKAGE_SECTIONS = ['Vara', 'Señal', 'Commits', 'Files changed', 'Diff']`, con el comentario que diga por qué es una sola ruta y no la vara entera: el juez de slice mide estado final, coherencia y señal, y de la vara sólo le toca la regla de que una traza nombra a su lector.
- `ct-step.mjs`, en `escribirPaqueteDeSlice`: escribir la sección `Vara` primero, con la ruta absoluta de `simplicity.md` construida como `join(PLUGIN_ROOT, PluginYardstick.DIRECTORY, 'simplicity.md')` y una línea que diga que se abre con `Read`. Va delante de `Señal` por el mismo motivo que `Señal` va delante del diff: detrás de un diff `-U10` quedaría enterrada.
- `agents/ct-slice-judge.md`: en el ítem `observabilidad`, decir que la vara de esa pregunta es la sección `Vara` del paquete, y que un hallazgo la cita como cita cualquier documento.

- [ ] **Step 4: Correr los tests y verlos pasar**

Desde `plugin/`:
- `npx vitest run __tests__/step-contracts.test.js` → PASS
- `npx vitest run __tests__/ct-step-vara-y-telemetria.test.js` → PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/scripts/step-contracts.js plugin/scripts/ct-step.mjs plugin/agents/ct-slice-judge.md plugin/__tests__/step-contracts.test.js
git commit -m "feat(slice-judge): la señal se juzga con la regla que nombra a su lector"
```

---

### Task 9: `backend/conventions/` se queda con lo que sólo decide este repositorio

**Files:**
- Create: `backend/conventions/this-repository.md`
- Delete: `backend/conventions/README.md`, `architecture.md`, `domain.md`, `infrastructure.md`, `simplicity.md`, `testing.md`
- Test: `backend/__tests__/conventions-no-restatement.test.js`

**Interfaces:**
- Consumes: los ocho documentos de la vara ya cerrados (Tareas 1-6).
- Produces: nada.

- [ ] **Step 1: Escribir el test que falla**

Vive en `backend/` y no en `plugin/` a propósito: mide `backend/`, y un test del plugin que leyera `backend/` fallaría en una instalación del plugin, donde ese árbol no existe.

**Y sus identificadores van en inglés, sin excepción.** El guardián `backend/__tests__/yardstick.test.js` mide todos los ficheros de código bajo `backend/` —los tests incluidos— y su lista de palabras castellanas contiene `vara`, `texto`, `documento`, `regla` y `ruta`: un test escrito con esos nombres deja el guardián rojo. Los nombres de los `it` van en snake case y en inglés, como el resto de la suite del backend.

```js
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const travellingYardstick = join(backendRoot, '..', 'plugin', 'conventions')
const ownDocument = () => readFileSync(join(backendRoot, 'conventions', 'this-repository.md'), 'utf8')

const RULES_THAT_WENT_UP = [
  'the burden of proof is on what is added',
  'which call breaks without it',
  'makes the name a lie',
  'is data, not an exception',
  'cutting right before the external system',
  'hunt **the mutations that leave it green**',
]

describe('this repository declares only what no other repository inherits', () => {
  it('the_conventions_folder_holds_one_document_and_it_is_this_repository', () => {
    expect(readdirSync(join(backendRoot, 'conventions'))).toEqual(['this-repository.md'])
  })

  it('it_keeps_the_ubiquitous_language_that_no_other_repository_can_inherit', () => {
    for (const term of ['User story', 'Plan issue', 'Plan agent', 'GO', 'Harvest ledger']) {
      expect(ownDocument(), `${term} left the repository with nothing to replace it`).toContain(term)
    }
  })

  it('it_restates_no_rule_the_travelling_yardstick_already_carries', () => {
    for (const rule of RULES_THAT_WENT_UP) {
      expect(ownDocument(), `this-repository.md restates a travelling rule: ${rule}`).not.toContain(rule)
    }
  })

  it('every_rule_it_dropped_is_a_rule_the_travelling_yardstick_now_carries', () => {
    const everyRule = readdirSync(travellingYardstick)
      .map((file) => readFileSync(join(travellingYardstick, file), 'utf8'))
      .join('\n')
    for (const rule of RULES_THAT_WENT_UP) {
      expect(everyRule, `nobody carries this rule any more: ${rule}`).toContain(rule)
    }
  })
})
```

El cuarto test es el que hace que este borrado sea seguro: por cada regla que sale de `backend/`, exige que la vara que viaja la lleve. Si una tarea anterior la redactó con otras palabras, este test cae y dice cuál.

- [ ] **Step 2: Correr el test y verlo fallar**

Desde `backend/`: `npx vitest run __tests__/conventions-no-restatement.test.js`
Esperado: FAIL — la carpeta tiene seis documentos y `this-repository.md` no existe.

- [ ] **Step 3: Escribir `backend/conventions/this-repository.md`**

```markdown
# What only this repository decides

[una línea: lo que rige aquí y no viaja con el plugin; la vara de ct la trae el
programa y su cabecera dice cómo se resuelve el choque]

## Ubiquitous language

[la tabla entera de backend/conventions/domain.md, sin cambios]

## The backend leans on the plugin, never the reverse

[el párrafo de backend/conventions/architecture.md, con la copia declarada
medida por un test que renderiza la salida del propio plugin]

## The layout

[el árbol de backend/conventions/architecture.md, sin las reglas que subieron:
la raíz, los nombres de los ficheros de infraestructura y el patrón de nombre
de un controlador]

## Answering HTTP in this API

[el 400 de toda negativa que juzgó la aplicación, el {code, detail}, la negativa
del protocolo que conserva su status, y el Origin avalado por un Host de
loopback]
```

- [ ] **Step 4: Borrar los seis documentos**

```bash
git rm backend/conventions/README.md backend/conventions/architecture.md backend/conventions/domain.md backend/conventions/infrastructure.md backend/conventions/simplicity.md backend/conventions/testing.md
```

- [ ] **Step 5: Correr los tests y verlos pasar**

Desde `backend/`:
- `npx vitest run __tests__/conventions-no-restatement.test.js` → PASS
- `npx vitest run __tests__/yardstick.test.js` → PASS. Es el guardián del backend, y se corre porque esta tarea cambia qué ficheros hay bajo `backend/`.

- [ ] **Step 6: Commit**

```bash
git add backend/conventions backend/__tests__/conventions-no-restatement.test.js
git commit -m "refactor(backend): lo que era general subió a la vara; aquí queda lo propio"
```

---

## Verificación final

Una sola vez, después de la Tarea 9, y sí la suite entera:

```bash
make test-plugin
make test-backend
```

Esperado: exit 0 en las dos. Son unos seis minutos el plugin.
