# La vara la dicta ct — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las convenciones de código las dicte el plugin y no el repo destino: cuatro documentos que viajan con ct, los lee el que planifica y los pega el programa en cada task brief, con la vara del repo retirada entera.

**Architecture:** `conventions/*.md` son ficheros del plugin y `scripts/vara-ct.js` es su transporte: la lista, qué falta, y la sección que se pega con la cabecera que fija la precedencia. `scripts/vara.js` **no se toca**: sigue transportando la declaración del repo, que sigue obligando. `scripts/ct-step.mjs` hace el IO de las dos y pega la de ct primero, abortando si falta alguno de los cuatro. `scripts/kickoff.js` nombra las rutas en el primer acto del slice para que el plan se escriba con la vara de ct delante.

**Tech Stack:** Node ≥ 24, ESM, vitest 4, bash para `ct-init.sh`. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md`

## Global Constraints

- Los cuatro documentos de `conventions/` se escriben **en inglés**: es el idioma de todo el corpus del plugin que llega a un agente (spec §5).
- Cada documento abre con su línea de alcance: `Applies to: **every diff**.` en `code.md`, `decisions.md` y `testing.md`; `Applies to: **new modules**.` en `architecture.md` (spec §5.1–5.4).
- **La vara no repite una regla que la rúbrica ya posee**, porque su propio `decisions.md` lo prohíbe. Los tres solapes identificados y su dueño: un test preexistente debilitado es del ítem `manipulacion-tests`; código que ninguna frase de la tarea pidió es del ítem `alcance`; las tres propiedades de un test nuevo (determinista, aislado, verifica comportamiento real) son del ítem `test-desiderata`. Ninguno de los tres se escribe en `conventions/`.
- **La regla de precedencia se escribe UNA vez**, en la cabecera que pega el programa (`scripts/vara-ct.js`), no en cada documento: cuatro copias de la misma regla es lo que `conventions/decisions.md` prohíbe. Los documentos apuntan a ella; no la repiten.
- **La precedencia se mide por regla, no por tema** (spec §2): una regla del repo que manda lo que un documento de ct prohíbe no aplica; una que habla de algo de lo que ninguno habla obliga entera. Nada de este plan escribe una lista de temas cubiertos.
- **`scripts/vara.js`, `scripts/detect-vara.mjs`, `__tests__/vara.test.js`, `__tests__/vara-candidatos.test.js`, `__tests__/ct-init-conventions-seed.test.js`, `scripts/ct-init.sh`, `commands/ct-init.md`, `skills/writing-plans-prescriptive/plan-template.md` y `scripts/plan-contract.js` NO se tocan.** Todo eso es la vara del repo, que se queda (spec §6.1). Si una tarea te lleva a editarlos, has entendido mal el plan.
- La lista de los cuatro ficheros vive **en el código** (`scripts/vara.js`), no en prosa, y un test la ata al directorio en las dos direcciones.
- Los nueve `VERDICT_RULES` (`scripts/step-contracts.js`) **no cambian**: este plan no añade ítem a la rúbrica, sólo cambia contra qué mide `patrones`.
- Nada de este plan escribe en `.agent/` del repo destino.
- `npm test` (que corre `npm run build` y luego `vitest run`) tiene que quedar verde al final de cada tarea.

## File Structure

| Fichero | Responsabilidad |
|---|---|
| `conventions/code.md` (crear) | Cómo se escribe una línea de código |
| `conventions/decisions.md` (crear) | Dónde vive una decisión y cuántas veces se escribe |
| `conventions/architecture.md` (crear) | Dónde vive cada cosa y qué puede conocer a qué |
| `conventions/testing.md` (crear) | Qué fija un test y contra qué asserta |
| `scripts/vara-ct.js` (crear) | Transporte de la vara de ct: la lista, qué falta, y la sección con la cabecera de precedencia |
| `scripts/ct-step.mjs` (modificar) | El IO de las dos varas: lee, aborta si falta la de ct, pega la de ct y detrás la del repo |
| `scripts/ct-next.mjs` (modificar) | Resuelve la ruta absoluta del directorio de la vara, igual que sus dos hermanas |
| `scripts/kickoff.js` (modificar) | El primer acto nombra la vara de ct, para que el plan se escriba con ella delante |
| `skills/writing-plans-prescriptive/SKILL.md` (modificar) | Lee la vara de ct antes de escribir el plan; su §3 sigue seleccionando la del repo |
| `agents/ct-judge.md` (modificar) | Ítem `patrones` mide las dos varas con la precedencia; pierde `sin-vara` |
| `prompts/task-implementer.md` (modificar) | El mismo texto, para el que escribe |
| `__tests__/conventions-vara.test.js` (crear) | Que los cuatro documentos existan, declaren alcance y cierren el agujero |
| `__tests__/vara-ct.test.js` (crear) | La lista, `faltasDeVara`, la sección, la cabecera de precedencia y los ties |

---

### Task 1: Los cuatro documentos de la vara

**Files:**
- Create: `conventions/code.md`
- Create: `conventions/decisions.md`
- Create: `conventions/architecture.md`
- Create: `conventions/testing.md`
- Test: `__tests__/conventions-vara.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: cuatro ficheros markdown en `conventions/`, cada uno con una línea `Applies to: ` en su cabecera. `conventions/architecture.md` contiene la frase literal `a new concept is a new module and is born conforming`, que es la que cierra el agujero de la exención y que la Task 6 cita desde la rúbrica.

- [ ] **Step 1: Write the failing test**

Crea `__tests__/conventions-vara.test.js`:

```js
// La vara que ct dicta (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md).
// Estos cuatro documentos los pega `ct-step` en cada task brief, así que un
// documento vacío o sin su línea de alcance pone al implementador y al juez a
// medir con nada — el estado que este diseño existe para hacer imposible.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (nombre) => readFileSync(join(root, 'conventions', nombre), 'utf8')

const ALCANCES = {
  'code.md': 'every diff',
  'decisions.md': 'every diff',
  'testing.md': 'every diff',
  'architecture.md': 'new modules',
}

describe('los documentos de conventions/', () => {
  for (const [nombre, alcance] of Object.entries(ALCANCES)) {
    it(`${nombre} declara su alcance en la cabecera`, () => {
      const cabecera = leer(nombre).split('\n').slice(0, 6).join('\n')
      expect(cabecera).toContain('Applies to:')
      expect(cabecera).toContain(alcance)
    })

    it(`${nombre} trae reglas, no sólo encabezados`, () => {
      const sustancia = leer(nombre)
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
      expect(sustancia.length).toBeGreaterThan(20)
    })
  }

  it('architecture.md cierra el agujero de la exención del módulo viejo', () => {
    expect(leer('architecture.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('ninguno repite una regla que ya posee un ítem de la rúbrica', () => {
    const todo = Object.keys(ALCANCES).map(leer).join('\n')
    expect(todo).not.toMatch(/skip|xfail/i)
    expect(todo).not.toMatch(/call count/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/conventions-vara.test.js`
Expected: FAIL — `ENOENT: no such file or directory, open '.../conventions/code.md'`

- [ ] **Step 3: Write `conventions/code.md`**

```markdown
# How code is written here

Applies to: **every diff**.

This document is part of ct's yardstick, which travels with the plugin. How it
relates to the conventions of the repository you are working in is stated in the
header of the block that carried it here.

## No prose in the code

No comments and no docstrings. If a piece of code cannot be understood without a
paragraph beside it, the fix is the code: names that say what they do, small
functions with one responsibility, types that make misuse impossible, named
constants instead of literals.

A conditional that needed three lines of explanation is almost always a named
function waiting to be born, and an invariant explained in prose is almost always
a missing test.

## Code is written in English

File and module names, types, functions, methods, variables, parameters,
constants, vocabulary members, errors, test names, and the messages a person
reads. The one exception is a value fixed by an external contract, which keeps
the spelling that contract gives it.

## No free function at module level: every function hangs off a type

Method, class method or static method, the entrypoint included. What was a
handful of private module functions plus a few loose constants is almost always a
type waiting to be born, and naming it is what says whose logic that is.

This is not cosmetic. A handful of loose functions that were really one piece
hides that the piece is missing an argument it needs to do its job. Named, the
absence shows.

## Closed vocabulary instead of loose strings and booleans

A value that classifies something is a member of a closed vocabulary, not a
string compared by hand.

- **An answer carries the vocabulary, not a boolean derived from it.** A boolean
  collapses states that get fixed differently, and its consumer cannot separate
  them again.
- **An absent state is a member of the vocabulary, not an optional.** Declaring
  it inside the vocabulary is what keeps a defensive branch out of every place
  that touches the value.
- **Dispatch over it exhaustively, with no catch-all branch**, so that adding a
  member breaks the build instead of falling silently into the default.

## No raw map as the return value of logic

A map that crosses two of your own functions gets read by key lookup in the
consumer, and there a misspelled key and an absent one are the same thing. A raw
map is a serialization boundary, never the return value of logic.

## Two fields that have to agree

Two fields that have to agree leave the state that must not exist representable;
one field makes it impossible. Where a flag says the same thing as the
non-emptiness of a value, the flag goes and the answer is derived — so a run that
dies halfway cannot resume asserting something it does not have.

## Errors are named for what happens, not for where

A hierarchy only where the consumer needs to tell two cases apart. An error
inherits from the type that fits it, not from the root error type.

## Antipatterns

- A comment or a docstring explaining code that could be renamed. **Rewrite the code.**
- An identifier in a language other than English that is not contract data.
- A function at module level. **Find its type.**
- A string compared by hand where a closed vocabulary belongs.
- A boolean where the consumer needs to tell two states apart.
- An optional standing in for an absent member of a vocabulary.
- A catch-all branch in a dispatch over a closed vocabulary.
- A raw map returned by logic.
- A flag that repeats what another field already says.
```

- [ ] **Step 4: Write `conventions/decisions.md`**

```markdown
# Where a decision lives

Applies to: **every diff**.

A business rule is written **once**, and the first copy is already the defect. No
threshold authorises it, because what breaks is not tidiness, it is coherence.

Two similar pieces of code that drift leave ugly code. Two places that decide the
same thing and drift leave a program that contradicts itself, and the symptom
does not appear where the copy is — it appears where someone believed it.

## The yardstick

**If this decision changed, how many files would have to be touched for the
program to stay coherent?** One, or it is spread.

Ask it about the change, not about the text. Two places that today say the same
thing in different words are already spread, which is why the yardstick cannot be
resemblance: no duplicate detector pairs them.

## What does not count

The idiom of a boundary is not a rule. Checking an exit code in every adapter
that launches a process, or the shape of an envelope in every model that
validates one, is the same sentence, not the same decision, and each place
answers for its own.

The question that separates them: **is there a business change that forces
touching both at once?** If there is not, it is idiom, and the rule of three
applies to it — extract when extracting leaves the place better, and waiting
until then is correct.

## What does not fix it

- **A helper both copies call from where they were.** The decision is still
  spread, now with an indirection in front of it.
- **A field without its question.** Whatever holds the data owns the question. If
  every consumer derives the condition by hand from a field, the rule is spread
  among them even though the field lives in one place: the field is not the
  decision.

## When the copy is unavoidable

The two halves of a contract that crosses a process boundary have to exist twice.
There the copy is **declared and measured with a test that compares the two**, so
that rewriting both passes and touching one fails. What is not acceptable is
leaving it implicit: a copy nobody compares will drift, and the only difference
from the case above is that this one was known.

## Why this is a convention and not a linter

Because this code is written by a harness that **cannot learn**. Every invocation
starts with no memory of the previous ones, so when it needs a rule that already
exists in another file it does not reuse it — it does not know it is there — it
derives it again where it needs it.

What that produces is not literal copies, it is different wordings of the same
decision, and no tool pairs them by shape. The only place it can be caught is
when someone writes the second one, with the question about the change in front
of them.

## Antipatterns

- A business rule written in two places, **even when the two wordings differ**.
- The same partition of a closed vocabulary declared in more than one place. An
  exhaustive dispatch does not protect against this: it forces you to mention a
  new member, not to classify it the same way everywhere.
- A helper both copies call from where they were.
- Something that holds the data and not the question, with every consumer
  formulating it by hand.
- An unavoidable copy of the two halves of a contract with no test comparing them.
```

- [ ] **Step 5: Write `conventions/architecture.md`**

```markdown
# Where each thing lives

Applies to: **new modules**.

A module that was already there and does not conform is the repository's
**declared debt**: what you add to it follows the style of its host, and that is
not a finding — half a migration reads worse than none.

The hole that exemption opens is closed in the same breath, because otherwise the
cheapest way to dodge this document is to write new code inside an old file: **a
new concept is a new module and is born conforming.** Sheltering under the host's
style covers only what genuinely extends what was already there; placing a new
concept inside an old file to inherit the exemption **is** a finding.

## The three layers, and the direction of dependencies

Infrastructure knows application and domain. Application knows domain. Domain
knows nobody.

- **Domain** — values, ports, policies and errors. No input/output, no knowledge
  of any other layer, and no serialization: translating to the keys of an
  external contract is the boundary's work.
- **Application** — the use cases. They orchestrate; the logic lives in the
  domain and the input/output behind a port.
- **Infrastructure** — adapters, boundary models and entrypoints. The only layer
  that knows there is a subprocess, a filesystem or another service on the other
  side.

## One concept per module

One concept per module, and with it whatever does not exist without it. The
yardstick is deliberately hard: **if you delete the main concept, is the other
type left with no consumer and no meaning of its own?** Only then do they share a
file.

And the other way round: a type with a life of its own is a concept and goes to
its own module, even if today it is only used beside the other one. It has a life
of its own if something else constructs it, if another layer consumes it, or if
it carries its own algebra. Without that half, "does not exist without it"
stretches to justify any grouping by habit.

## The shape of a use case

- Dependencies enter **through the constructor, by name**. It depends on ports,
  never on adapters: a use case does not know there is a subprocess on the other
  side.
- **No suffix on the type**, on its parameters or on its result.
- The main method takes a parameters object and returns a result object, both
  immutable and declared beside it.
- **A configuration value enters as data, not behind a port.** A port whose only
  method returns a constant is indirection; what the object buys is that values
  which have to agree travel together and their coherence can be checked in one
  place.
- **What it does not do**: it does not translate to external formats, it does not
  catch errors to turn them into exit codes, and it does not decide retry or
  budget policy.
- **Mutation and reading are told apart by where they live**, not by a suffix on
  the type. Something that mutates and also returns data is still a mutation:
  what classifies it is that it mutates, not that it answers.

## A policy is the exact rule

The exact rule — which step comes after a result, what counts as exhausted — is a
domain object, not prose and not a conditional inside a use case. Immutable, with
**its configuration injected**, no input/output and knowing nobody.

- **Total or explicit**: an input the policy does not describe **raises** its
  error instead of falling into a catch-all branch, so it shows at the moment
  instead of passing for "nothing happened".
- **It returns the whole effect**, not a boolean and not a map: what comes next
  and the state it leaves travel together. A consumer that had to recompose that
  would have the policy spread again.

## Conducting is not executing

Something that drives a flow end to end **invokes** its steps. Each dispatched
step enters through its own use case, and whoever conducts does not talk to the
ports that step needs to do its work.

The line, so it is not widened by precedent: **if its result projects to an
outcome the flow receives, it is a step.** A prior check — asking whether what a
step will need exists, preparing something before the loop — may still go against
the port from whoever conducts: it is not a step and it has no result the flow
consumes. The yardstick is not the size of the call.

And translating a step's result into the flow's vocabulary is not the conductor's
either: that projection lives on the destination's side, or every new step brings
its own conditional to the conductor and the rule ends up spread among the places
that invoke it.

## Leaving a record is not conducting

Whoever decides the flow does not compose the telemetry. It decides **when** a
record has to be left; **how** it is left is another use case, invoked like any
other. The rule bites once the conductor would have to name telemetry types in
order to build them; while it only passes data to a port, there is nothing to
extract.

## The boundary

- **What comes from outside is validated on entry, with no exceptions and no
  forced cast**: a cast checks nothing, it only silences the type checker.
- **An unknown key is a rejection, not a field to ignore.** It means the other
  side changed shape and our assumptions may be stale.
- **You enter by the contract's name, not by the field's name**, and everything
  the other side sees comes from there: the schema sent to it, the validation of
  what it returns, and what gets emitted.
- **A foreign format with an open vocabulary is validated by projection.** When
  what arrives is not a contract this program defines, rejecting unknown keys
  over the whole object breaks the read with every field the other side adds,
  which is the very job that reader has. Project by hand a structure with exactly
  the keys you consume and validate that, still rejecting the unknown. A key you
  do claim to know that is missing or arrives with the wrong type still breaks.
  And an input that is not the expected format is corruption, not one more
  variant: it raises instead of being swallowed.
- **How tight to validate a field:** what wrong value would pass for good, and
  what decision would be taken with it? If the answer is "none that matters", lax
  is fine.
- **The conversion to the domain lives in the boundary model**, both ways. Never
  a mapping helper in the use case.
- **A validation error does not leave the layer**: it is translated to the domain
  error the entrypoint knows how to map.
- **An adapter is named after its implementation, not after its port**, so the
  pair reads in the name and two implementations fit without renaming anything.
- **An adapter does not decide policy** — retries, budgets, what to do with a
  failure.
- **No call to an external process is launched without a cap, and the adapter
  does not choose the cap**: it arrives through the constructor with no default,
  because applying a cap is this layer's work and deciding which one is policy.
  On exhaustion it fails closed and whatever the process had written is
  discarded: half an answer is not an answer.
- **A non-zero exit code is data, not an exception**: it gets interpreted,
  because the reason is on the diagnostic channel and an exception erases it.
- **A port for a constant value is indirection; an invariant among several values
  asks for an object.**

## The entrypoint

- **It is the only place that assembles the dependency graph**: it picks the
  concrete adapters and injects them. There is no injection container — one
  adapter per port — and the test seam is the constructor.
- **It maps the domain's errors to exit codes**, with the result on the standard
  channel and the diagnosis on the error channel, always separate.
- **One code per decision of whoever invokes, not one per error.** The yardstick
  is what the receiver does differently.

## Antipatterns

- A new concept placed inside a non-conforming old file to inherit its exemption.
- The domain importing from application or from infrastructure.
- A use case importing from infrastructure, or depending on an adapter.
- A use case with a suffix on its type, its parameters or its result.
- A use case that returns a raw map.
- A mapping helper in the use case instead of in the boundary model.
- A conditional in the conductor that translates a step's result.
- A policy that returns a boolean instead of the whole effect.
- A policy with a catch-all branch for an input it does not describe.
- A cast at the boundary.
- A boundary model that ignores unknown keys.
- An adapter that decides policy.
- A call to an external process with no cap, or an adapter that picks its own.
- A validation error leaving the boundary layer.
- A port whose only method returns a constant.
```

- [ ] **Step 6: Write `conventions/testing.md`**

```markdown
# What a test pins

Applies to: **every diff**.

## No prose here either

No comments and no docstrings in a test. **The test's name is the sentence**, and
it says what is guaranteed and why, not which method is called:
`a_finding_without_a_line_leaves_the_key_out_instead_of_emitting_null`, not
`finding_is_serialised`.

Test helpers hang off their test type, like any other function. What several test
types of the same module share lives in a type they inherit from, not in a loose
function and not in a shared module imported from one place only.

## The objects a test needs are built by a mother

A mother gives sensible defaults and lets each test name **only what its case
changes**, which is what makes the assertion readable. Without them the same
object gets copied into two files with different values and neither says why.

Its methods are **named scenarios**, not one builder with everything defaulted,
so the test says which case it is about without reading the arguments.

## What the assertion is on

- **The observable effect**: what the port received, what the use case returned.
- **At a boundary, the literal payload** sent or received, not a model of it
  reimplemented in the test. Comparing against your own model of the format is
  rewriting the mapping and approving it by construction.

## Doubles

- **A double doubles what its name says and nothing more.** If one port serves
  two consumers, the double intercepts one and lets the other through for real.
  One that answered any input with the other's answer would make the test pass or
  fail for the wrong reason.
- **A double of a whole conversation answers by what it is asked, not by order**,
  and **raises when nobody wrote an answer** for a request. That is what makes
  "it does not repeat work already done" checkable: if it repeated, the double
  would not have to answer and the test falls with the request in front of you.
- **Values are not doubled**: real instances.
- **The arrange is not built with the piece under test.** The state an adapter is
  going to read is set up with the real tool, not with the adapter itself.

## What gets tested, and what does not

- **Outside-in, in this order**: first the application layer with the ports
  doubled, then infrastructure. What is inside the domain is covered **along that
  path**, not with tests of its own. The one exception is a value with validation
  of its own that cannot be reached any other way.
- **A test that only checks that a data holder stores what you passed it measures
  the language, not the code.**
- **Before adding a test, check whether the behaviour is already covered.** It
  only goes in if it adds a distinct dimension.
- **A test that launches a real subprocess is marked as such**, so a fast subset
  exists. The marker shortens the loop, not what is required.

## Antipatterns

- A comment or a docstring in a test.
- A test named after the method it calls.
- A test helper at module level, or repeated in two files.
- An object built by hand in the test when a mother exists, or the mother's
  constants duplicated in the test.
- An assertion against a reimplemented model of the format instead of the literal
  payload.
- An arrange built with the piece under test.
- A doubled value.
- A test of the domain reachable from the application layer.
- A test that launches a real subprocess without its marker.
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run __tests__/conventions-vara.test.js`
Expected: PASS (9 tests)

- [ ] **Step 8: Commit**

```bash
git add conventions/code.md conventions/decisions.md conventions/architecture.md conventions/testing.md __tests__/conventions-vara.test.js
git commit -m "feat(vara): los cuatro documentos que ct dicta"
```

---

---

### Task 2: `scripts/vara-ct.js`, el transporte de la vara de ct

**Files:**
- Create: `scripts/vara-ct.js`
- Test: `__tests__/vara-ct.test.js`

**Interfaces:**
- Consumes: los cuatro ficheros de `conventions/` de la Task 1.
- Produces:
  - `export const CONVENTIONS_DIR = 'conventions'` — relativo a la raíz del PLUGIN.
  - `export const CONVENTIONS_FILES = ['code.md', 'decisions.md', 'architecture.md', 'testing.md']` — orden declarado, y es el orden en que se pegan.
  - `export function faltasDeVara(documentos)` — `documentos` es un array de `{ nombre, contenido }`; devuelve los `nombre` de `CONVENTIONS_FILES` cuyo contenido es `null`, `undefined` o sólo espacios, más los que no aparezcan en `documentos`.
  - `export function seccionDeVaraDeCt(documentos)` — la sección markdown que se pega, con la cabecera de precedencia y cada documento bajo `## Vara de ct: conventions/<nombre>`. **Nombre distinto de `seccionDeVara` de `scripts/vara.js` a propósito**: `ct-step` importa las dos.

- [ ] **Step 1: Write the failing test**

Crea `__tests__/vara-ct.test.js`:

```js
// La vara la dicta ct (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md).
// Este módulo transporta la vara del PLUGIN. Su hermano `scripts/vara.js`
// transporta la declaración del REPO y no se toca: son dos varas, y la de ct
// tiene preferencia donde las dos hablan de lo mismo.
//
// OJO, TRAMPA DE NOMBRE: ni esto ni `vara.js` son `scripts/conventions.js`, que
// va de colisiones de protocolo entre el loop y el repo destino.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONVENTIONS_DIR, CONVENTIONS_FILES, faltasDeVara, seccionDeVaraDeCt } from '../scripts/vara-ct.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = (contenido) => CONVENTIONS_FILES.map((nombre) => ({ nombre, contenido }))

describe('CONVENTIONS_FILES', () => {
  it('declara los cuatro documentos de la vara', () => {
    expect(CONVENTIONS_FILES).toEqual(['code.md', 'decisions.md', 'architecture.md', 'testing.md'])
  })

  it('todo lo declarado existe en el directorio', () => {
    const enDisco = readdirSync(join(root, CONVENTIONS_DIR))
    for (const nombre of CONVENTIONS_FILES) expect(enDisco).toContain(nombre)
  })

  it('todo .md del directorio está declarado: un documento sin declarar no viaja', () => {
    const enDisco = readdirSync(join(root, CONVENTIONS_DIR)).filter((f) => f.endsWith('.md'))
    expect([...enDisco].sort()).toEqual([...CONVENTIONS_FILES].sort())
  })
})

describe('faltasDeVara', () => {
  it('con los cuatro llenos, no falta nada', () => {
    expect(faltasDeVara(docs('# x\nregla\n'))).toEqual([])
  })

  it('nombra el que llega en blanco: una vara vacía no es una vara', () => {
    const documentos = docs('# x\nregla\n')
    documentos[1] = { nombre: documentos[1].nombre, contenido: '  \n\n' }
    expect(faltasDeVara(documentos)).toEqual(['decisions.md'])
  })

  it('nombra el que llega nulo', () => {
    const documentos = docs('# x\nregla\n')
    documentos[0] = { nombre: documentos[0].nombre, contenido: null }
    expect(faltasDeVara(documentos)).toEqual(['code.md'])
  })

  it('nombra el que no aparece en la lista recibida', () => {
    expect(faltasDeVara(docs('# x\nregla\n').slice(0, 2))).toEqual(['architecture.md', 'testing.md'])
  })

  it('sin nada recibido, faltan los cuatro', () => {
    expect(faltasDeVara([])).toEqual([...CONVENTIONS_FILES])
  })
})

describe('seccionDeVaraDeCt', () => {
  const seccion = seccionDeVaraDeCt([
    { nombre: 'code.md', contenido: '# How code is written here\nno prose\n' },
    { nombre: 'decisions.md', contenido: '# Where a decision lives\nonce\n' },
    { nombre: 'architecture.md', contenido: '# Where each thing lives\nthree layers\n' },
    { nombre: 'testing.md', contenido: '# What a test pins\nthe name is the sentence\n' },
  ])

  it('dice que la escribió el programa y que el plan no puede quitarla', () => {
    expect(seccion).toContain('conventions/')
    expect(seccion).toContain('ningún agente')
  })

  it('pega cada documento bajo un encabezado con su ruta, para que el juez pueda citarla', () => {
    for (const nombre of CONVENTIONS_FILES) {
      expect(seccion).toContain(`## Vara de ct: conventions/${nombre}`)
    }
  })

  it('pega el contenido verbatim', () => {
    expect(seccion).toContain('# How code is written here\nno prose')
    expect(seccion).toContain('the name is the sentence')
  })

  it('respeta el orden declarado', () => {
    const posiciones = CONVENTIONS_FILES.map((n) => seccion.indexOf(`conventions/${n}`))
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b))
  })
})

// ---------------------------------------------------------------------------
// La cabecera de precedencia: es el ÚNICO sitio donde esa regla se escribe, y
// tiene que traer los DOS lados. Una consigna que sólo dice "gana ct" pone al
// juez a anular la vara del repo entera, incluido el naming del que ct no habla.
// ---------------------------------------------------------------------------
describe('la cabecera fija la precedencia, con sus dos lados', () => {
  const cabecera = () => seccionDeVaraDeCt(docs('# x\nregla\n')).split('## Vara de ct:')[0]

  it('dice que la de ct tiene preferencia', () => {
    expect(cabecera()).toMatch(/preferencia/i)
  })

  it('dice que se mide regla a regla y no por tema', () => {
    expect(cabecera()).toMatch(/regla a regla/i)
    expect(cabecera()).toMatch(/no por tema/i)
  })

  it('dice que una regla del repo de la que ct no habla OBLIGA', () => {
    expect(cabecera()).toMatch(/obliga entera/i)
  })

  it('trae el caso del naming con sus dos lados, que es lo que hace operativa la regla', () => {
    const c = cabecera()
    expect(c).toMatch(/mayúsculas/i)
    expect(c).toContain('castellano')
    expect(c).toContain('conventions/code.md')
  })
})

// ---------------------------------------------------------------------------
// Ties: la lista no puede divergir de los textos que la enseñan.
// ---------------------------------------------------------------------------
describe('los textos que enseñan la vara de ct la nombran', () => {
  const leer = (...partes) => readFileSync(join(root, ...partes), 'utf8')

  it('scripts/ct-step.mjs es quien la lee del disco', () => {
    expect(leer('scripts', 'ct-step.mjs')).toContain('vara-ct.js')
  })

  it('scripts/kickoff.js la nombra en el primer acto del slice', () => {
    expect(leer('scripts', 'kickoff.js')).toContain(CONVENTIONS_DIR)
  })

  it('prompts/task-implementer.md la nombra', () => {
    expect(leer('prompts', 'task-implementer.md')).toContain(`${CONVENTIONS_DIR}/`)
  })

  it('skills/writing-plans-prescriptive/SKILL.md la nombra', () => {
    expect(leer('skills', 'writing-plans-prescriptive', 'SKILL.md')).toContain(`${CONVENTIONS_DIR}/`)
  })

  it('agents/ct-judge.md la nombra DENTRO del ítem `patrones`', () => {
    const texto = leer('agents', 'ct-judge.md')
    const m = /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(texto)
    expect(m).not.toBeNull()
    expect(m[0]).toContain(`${CONVENTIONS_DIR}/`)
  })
})

describe('la vara del repo sigue en pie', () => {
  it('scripts/vara.js sigue transportando `.agent/conventions.md`', async () => {
    const vara = await import('../scripts/vara.js')
    expect(vara.CONVENTIONS_FILE).toBe('.agent/conventions.md')
    expect(typeof vara.seccionDeVara).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/vara-ct.test.js`
Expected: FAIL — `Cannot find module '../scripts/vara-ct.js'`. Los cinco ties de `ct-step.mjs`, `kickoff.js`, `task-implementer.md` y `SKILL.md` también fallarán y los arreglan las tareas 3, 4 y 5: deja esos rojos y sigue.

- [ ] **Step 3: Crea `scripts/vara-ct.js`**

```js
// scripts/vara-ct.js
//
// LA VARA QUE DICTA CT (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md).
// El problema medido: el transporte de la vara del repo funciona, pero `/ct-init`
// siembra la declaración vacía, así que casi todo repo se quedaba `sin-vara` y el
// único ítem de calidad de la rúbrica no tenía nada que citar. Esto trae la vara
// puesta con el plugin.
//
// DOS VARAS, NO UNA. `scripts/vara.js` es el hermano de este fichero y sigue
// transportando la declaración del REPO, que sigue obligando en todo aquello de
// lo que estos cuatro documentos no hablan. La de ct sólo gana donde las dos
// hablan de lo mismo, y esa regla se escribe UNA vez: en la cabecera de aquí
// abajo, que es lo único que sabe que las dos están viajando juntas en un brief y
// lo único del bloque que ningún agente puede quitar.
//
// Y su ausencia falla distinto que la del repo: que falte `.agent/conventions.md`
// es benigno —es el estado normal de casi todo repo—, pero que falte uno de estos
// cuatro es una INSTALACIÓN ROTA del plugin, y por eso existe `faltasDeVara` y
// `ct-step` aborta con ella en la mano en vez de avisar.
//
// Este módulo es lógica pura: no lee disco. Quien hace el IO es
// `scripts/ct-step.mjs`, que resuelve las rutas con `PLUGIN_ROOT`.
//
// OJO, TRAMPA DE NOMBRE: esto NO es `scripts/conventions.js` ni
// `conventions-io.js`. Esos van de COLISIONES DE PROTOCOLO entre el loop y el
// repo destino (claim, worktrees, fichero de estado), con su propio
// `.agent/conventions-ack.md`. No los confundas por el nombre.

// El directorio, relativo a la raíz del PLUGIN.
export const CONVENTIONS_DIR = 'conventions'

// La lista, explícita y no barrida del disco: si se barriera, un fichero borrado
// por accidente reduciría la vara en silencio. Declarada, el borrado es una falta
// que aborta. El orden es el orden en que se pegan.
// `__tests__/vara-ct.test.js` la ata al directorio EN LAS DOS DIRECCIONES.
export const CONVENTIONS_FILES = ['code.md', 'decisions.md', 'architecture.md', 'testing.md']

// faltasDeVara: los nombres de `CONVENTIONS_FILES` que no llegan o llegan en
// blanco. Un documento vacío no es media vara: pone al implementador y al juez a
// medir con nada, y en silencio eso no se distingue de un ítem conforme.
export function faltasDeVara(documentos) {
  const porNombre = new Map()
  for (const d of documentos ?? []) porNombre.set(d?.nombre, d?.contenido)
  return CONVENTIONS_FILES.filter((nombre) => {
    const contenido = porNombre.get(nombre)
    return contenido == null || String(contenido).trim() === ''
  })
}

// La cabecera. Los DOS lados del ejemplo son load-bearing: una consigna que sólo
// dice "gana ct" pone al juez a anular la vara del repo entera, naming incluido,
// que es exactamente lo que esta regla no dice. Y el ejemplo va aquí, y no en una
// lista de temas cubiertos al lado de los documentos, porque una lista así
// desactualizada da permiso a lo que la regla prohíbe.
const CABECERA = [
  '',
  '---',
  '',
  '> **La vara de ct**, leída del directorio `conventions/` del plugin por el',
  '> programa: ningún agente la escribió en este brief y el plan no puede',
  '> quitarla. Cada documento declara su alcance en su propia cabecera.',
  '>',
  '> **Tiene preferencia sobre las convenciones de este repo, y la preferencia se',
  '> mide regla a regla, no por tema.** Donde una regla del repo manda hacer algo',
  '> que uno de estos documentos prohíbe, o prohíbe algo que exigen, esa regla del',
  '> repo no aplica. Donde una regla del repo dice algo de lo que ninguno de ellos',
  '> habla, **obliga entera**: esto no anula la vara del repo, resuelve el choque.',
  '>',
  '> El caso que fija la frontera, con sus dos lados: la convención de mayúsculas,',
  '> prefijos o nombres de fichero de este repo **obliga**, porque ninguno de estos',
  '> documentos habla de eso. Su convención de escribir los identificadores en',
  '> castellano **no**, porque `conventions/code.md` exige inglés.',
  '',
]

// seccionDeVaraDeCt: lo que `ct-step.mjs` pega en cada task brief, ANTES de la
// sección de la vara del repo — la cabecera que fija la precedencia se lee antes
// de que llegue la vara sobre la que decide.
//
// Cada documento va bajo un encabezado con SU RUTA porque es lo que el juez tiene
// que poder citar: un hallazgo de ese ítem exige regla + ruta, y sin la ruta
// delante la cita se convierte en "esto se lee mal".
export function seccionDeVaraDeCt(documentos) {
  const orden = new Map(CONVENTIONS_FILES.map((n, i) => [n, i]))
  const ordenados = [...(documentos ?? [])]
    .filter((d) => orden.has(d?.nombre))
    .sort((a, b) => orden.get(a.nombre) - orden.get(b.nombre))

  const partes = [...CABECERA]
  for (const d of ordenados) {
    const cuerpo = d.contenido.endsWith('\n') ? d.contenido : `${d.contenido}\n`
    partes.push(`## Vara de ct: ${CONVENTIONS_DIR}/${d.nombre}`, '', cuerpo)
  }
  return partes.join('\n')
}
```

- [ ] **Step 4: Run test to verify the module's own tests pass**

Run: `npx vitest run __tests__/vara-ct.test.js -t 'CONVENTIONS_FILES'`, luego `-t 'faltasDeVara'`, `-t 'seccionDeVaraDeCt'`, `-t 'la cabecera fija'`, `-t 'la vara del repo sigue'`
Expected: PASS en los cinco. Los ties siguen rojos hasta las tareas 3, 4 y 5.

- [ ] **Step 5: Commit**

```bash
git add scripts/vara-ct.js __tests__/vara-ct.test.js
git commit -m "feat(vara): el transporte de la vara que trae el plugin"
```

---

### Task 3: `ct-step` pega las dos varas, la de ct primero

**Files:**
- Modify: `scripts/ct-step.mjs` (el import de la línea 63 y la función `escribirBrief`)
- Test: `__tests__/ct-step.test.js`

**Interfaces:**
- Consumes: `CONVENTIONS_DIR`, `CONVENTIONS_FILES`, `faltasDeVara` y `seccionDeVaraDeCt` de la Task 2; `CONVENTIONS_FILE` y `seccionDeVara` de `scripts/vara.js`, que **no cambian**; `PLUGIN_ROOT`, ya declarado en `scripts/ct-step.mjs:82`; `EXIT.PRECONDITION` (8).
- Produces: cada task brief termina con la vara de ct —los cuatro documentos en orden, detrás de su cabecera de precedencia— y, si el repo tiene declaración, la del repo detrás. Si falta uno de los cuatro, el proceso sale con `EXIT.PRECONDITION` nombrando los que faltan.

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/ct-step.test.js`, junto al `describe('la vara del repo viaja en el brief, sin agente en medio', ...)` que **se queda tal cual**:

```js
// La vara la dicta ct (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md).
// La vara de ct viaja SIEMPRE, va DELANTE de la del repo —su cabecera fija la
// precedencia y hay que leerla antes de que llegue la vara sobre la que decide— y
// que falte es una instalación rota, no un estado del repo: se aborta.
describe('la vara de ct viaja en el brief, y va delante de la del repo', () => {
  const briefDeLaUno = () => readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')

  it('el brief termina con los cuatro documentos, DETRÁS de la tarea', () => {
    ct('next')
    const brief = briefDeLaUno()
    expect(brief).toMatch(/\*\*La vara de ct\*\*/)
    for (const nombre of CONVENTIONS_FILES) {
      expect(brief).toContain(`## Vara de ct: conventions/${nombre}`)
    }
    expect(brief.indexOf('Task 1')).toBeLessThan(brief.indexOf('La vara de ct'))
  })

  it('pega el contenido real de los documentos, no un resumen', () => {
    ct('next')
    const codeMd = readFileSync(join(PLUGIN_ROOT_TEST, 'conventions', 'code.md'), 'utf8')
    expect(briefDeLaUno()).toContain(codeMd.trim())
  })

  it('con declaración del repo, la de ct va PRIMERO', () => {
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'conventions.md'), '# La vara del repo\n\n- `AGENTS.md`\n')
    ct('next')
    const brief = briefDeLaUno()
    expect(brief.indexOf('La vara de ct')).toBeLessThan(brief.indexOf('leída directo de `.agent/conventions.md`'))
  })

  it('sin declaración del repo, la de ct viaja igual: son dos varas independientes', () => {
    ct('next')
    const brief = briefDeLaUno()
    expect(brief).toContain('## Vara de ct: conventions/code.md')
    expect(brief).not.toMatch(/leída directo de `\.agent\/conventions\.md`/)
  })

  it('sin el directorio de la vara, aborta nombrando lo que falta y no entrega brief', () => {
    // Un plugin FALSO: se copian `scripts/` y `skills/` y se omite `conventions/`,
    // que es exactamente el estado de una instalación rota. `PLUGIN_ROOT` sale de
    // la ubicación del propio script, así que copiarlo es la única forma de moverlo.
    const fake = mkdtempSync(join(tmpdir(), 'ct-plugin-roto-'))
    cpSync(join(PLUGIN_ROOT_TEST, 'scripts'), join(fake, 'scripts'), { recursive: true })
    cpSync(join(PLUGIN_ROOT_TEST, 'skills'), join(fake, 'skills'), { recursive: true })
    const r = spawnSync('node', [join(fake, 'scripts', 'ct-step.mjs'), 'next', '--plan', 'plan.md', '--issue', '7'], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(repo, '.telemetria') },
    })
    expect(r.status).toBe(8)
    expect(r.stderr).toMatch(/code\.md/)
    expect(r.stderr).toMatch(/instalación/)
    expect(existsSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'))).toBe(false)
    rmSync(fake, { recursive: true, force: true })
  })
})
```

Añade a la cabecera de ese fichero de test lo que le falte: `cpSync`, `mkdtempSync`, `rmSync`, `existsSync` de `node:fs`, `tmpdir` de `node:os`, `CONVENTIONS_FILES` de `../scripts/vara-ct.js`, y

```js
const PLUGIN_ROOT_TEST = join(dirname(fileURLToPath(import.meta.url)), '..')
```

`ct()` y `repo` ya existen en el fichero; `ct()` usa `spawnSync` y devuelve `{ status, stdout, stderr }` sin lanzar, así que el último test no necesita `try/catch`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/ct-step.test.js -t 'la vara de ct viaja'`
Expected: FAIL — el brief no contiene `**La vara de ct**`.

- [ ] **Step 3: Añade el import en `scripts/ct-step.mjs`**

Debajo del import existente de la línea 63, que **no se toca**:

```js
import { CONVENTIONS_FILE, seccionDeVara } from './vara.js'
import { CONVENTIONS_DIR, CONVENTIONS_FILES, faltasDeVara, seccionDeVaraDeCt } from './vara-ct.js'
```

- [ ] **Step 4: Añade la vara de ct dentro de `escribirBrief`, ANTES del bloque de la del repo**

Justo después del `try/catch` del `execFileSync` de `task-brief` y **antes** del comentario `// §3.3: la vara del repo cruza el embudo AQUÍ`, inserta:

```js
  // La vara de CT: viaja siempre, va primero, y su ausencia NO es un estado del
  // repo sino una instalación rota del plugin — de ahí que se aborte en vez de
  // avisar, que es lo contrario de lo que se hace con la del repo justo debajo.
  // Un brief sin ella deja al implementador y al juez midiendo con nada, y en
  // silencio eso no se distingue de un ítem conforme.
  const deCt = CONVENTIONS_FILES.map((nombre) => {
    try {
      return { nombre, contenido: readFileSync(join(PLUGIN_ROOT, CONVENTIONS_DIR, nombre), 'utf8') }
    } catch {
      return { nombre, contenido: null }
    }
  })
  const faltas = faltasDeVara(deCt)
  if (faltas.length) {
    die(`la vara de ct no se puede leer: falta o está vacío ${faltas.join(', ')} en ${join(PLUGIN_ROOT, CONVENTIONS_DIR)}. Es una instalación del plugin incompleta, no una propiedad de este repo: sin esos documentos el implementador escribe y el juez bloquea sin nada contra qué medir, y eso no se distingue en silencio de un diff conforme. Reinstala el plugin.`, EXIT.PRECONDITION)
  }
  appendFileSync(brief, seccionDeVaraDeCt(deCt))
```

El bloque de la vara del repo que viene detrás **no se modifica**: sigue leyendo `.agent/conventions.md`, sigue avisando por stderr si no se puede leer y sigue sin escribir nada cuando el repo no declara nada.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/ct-step.test.js __tests__/vara-ct.test.js`
Expected: PASS en `ct-step.test.js` entero (los tres tests viejos de la vara del repo incluidos, que no se han tocado) y el tie de `ct-step.mjs` en verde.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-step.mjs __tests__/ct-step.test.js
git commit -m "feat(vara): ct-step pega la vara de ct delante de la del repo"
```

---

### Task 4: la vara de ct llega al que escribe el plan

**Files:**
- Modify: `scripts/ct-next.mjs` (junto a `dispatchCheckPath` y `ctStepPath`, líneas 44-48)
- Modify: `scripts/kickoff.js` (firma de `renderKickoff`, línea 149; el primer acto, línea 231)
- Modify: `skills/writing-plans-prescriptive/SKILL.md` (el apartado `## What a code block carries`, líneas 45-62)
- Test: `__tests__/kickoff.test.js`

**Interfaces:**
- Consumes: `CONVENTIONS_DIR` de la Task 2.
- Produces: `renderKickoff(slice, { repo, dispatchCheckPath, ctStepPath, conventionsDir, base })` — un parámetro nuevo, `conventionsDir`, ruta absoluta resuelta en `ct-next.mjs` igual que sus dos hermanas. El primer acto la nombra, así que el plan se escribe con la vara de ct delante.
- **No toca** `plan-template.md` ni `scripts/plan-contract.js`: §3 sigue seleccionando la vara del repo y `reference-paths` sigue midiéndola igual.

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/kickoff.test.js`:

```js
// La vara la dicta ct (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md, §7):
// el brief se construye DESPUÉS del plan, así que pegar la vara de ct sólo ahí
// deja al implementador entre dos vetos — obedecer `**Files:**` y que el juez le
// bloquee la forma, o construir la forma y que el control de alcance le vete por
// tocar rutas que el plan no declaró. Son tres consumidores, no dos. (La del
// REPO ya llegaba: la skill manda arrancar de `.agent/conventions.md`.)
describe('el primer acto nombra la vara de ct', () => {
  const OPTS_CON_VARA = {
    repo: 'o/r',
    dispatchCheckPath: '/x/dispatch-check.mjs',
    ctStepPath: '/x/ct-step.mjs',
    conventionsDir: '/plugin/conventions',
  }

  it('manda leerla, y la nombra por su ruta absoluta', () => {
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k).toContain('/plugin/conventions')
  })

  it('la orden está en el tramo del plan, no perdida al final', () => {
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k.indexOf('/plugin/conventions')).toBeLessThan(k.indexOf('Con el plan commiteado'))
  })

  it('dice que tiene preferencia sobre las convenciones del repo', () => {
    expect(renderKickoff(SLICE, OPTS_CON_VARA)).toMatch(/preferencia/i)
  })
})
```

`SLICE` es la constante que ese fichero ya declara en su línea 8.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/kickoff.test.js -t 'nombra la vara de ct'`
Expected: FAIL — el kickoff no interpola `conventionsDir`.

- [ ] **Step 3: Resuelve la ruta en `scripts/ct-next.mjs`**

Junto a `ctStepPath` (línea 48), añade:

```js
// La misma resolución que sus dos hermanas, y por el mismo motivo: el kickoff es
// texto plano y el token ${CLAUDE_PLUGIN_ROOT} no existe ahí. El agente que
// escribe el plan tiene que poder abrir estos cuatro documentos por su ruta.
const conventionsDir = join(dirname(fileURLToPath(import.meta.url)), '..', CONVENTIONS_DIR)
```

Importa `CONVENTIONS_DIR` de `./vara-ct.js` en la cabecera del fichero, y pasa `conventionsDir` en la llamada a `renderKickoff`.

- [ ] **Step 4: Añade el parámetro y la orden en `scripts/kickoff.js`**

Cambia la firma de la línea 149:

```js
export function renderKickoff(slice, { repo, dispatchCheckPath, ctStepPath, conventionsDir, base }) {
```

Y en la lista del primer acto, **delante** de la entrada que empieza por `Primer acto, con el baseline verde: escribe el plan`, mete:

```js
    // §7 del diseño: el plan se escribe ANTES de que ct-step exista en el ciclo,
    // así que si la vara de ct sólo se pegara en el task brief el plan saldría
    // sin ella — y un plan que la ignora deja al implementador entre el veto del
    // juez y el del control de alcance. Aquí es donde alcanza al que planifica.
    // La del REPO ya le llegaba: la skill le manda arrancar de
    // `.agent/conventions.md` y seleccionar en §3.
    `Antes de escribir el plan, LEE la vara de ct: los cuatro documentos de ${conventionsDir} (code.md, decisions.md, architecture.md, testing.md). El programa se los pega al implementador y al juez en cada tarea, así que un plan que no las respete produce tareas que el juez va a bloquear. TIENEN PREFERENCIA sobre las convenciones de este repo, y la preferencia se mide regla a regla: donde una regla del repo manda lo que uno de esos documentos prohíbe, no aplica; donde el repo habla de algo de lo que ninguno habla —mayúsculas, prefijos, nombres de fichero—, obliga entera y la sigues. La vara del repo no desaparece: la sigues seleccionando en el \`Rules to obey:\` de §3 como hasta ahora.`,
    `Y una de ellas decide cómo reparten trabajo tus tareas: \`architecture.md\` rige los MÓDULOS NUEVOS. Un módulo que ya existía y no cumple es deuda declarada del repo —lo que le añadas sigue el estilo de su anfitrión y eso no es hallazgo—, pero un concepto nuevo es un módulo nuevo y nace cumpliendo. De qué lado cae cada cosa lo decides tú al repartir \`**Files:**\` entre \`(create)\` y \`(modify)\`.`,
```

- [ ] **Step 5: Reescribe `## What a code block carries` en `SKILL.md`**

Sustituye el apartado entero (líneas 45-62) por:

```markdown
## What a code block carries

`## 3. Reference patterns` carries this repo's yardstick in two lists, and step 2 of the list at the
end of this skill is where you go and read them. An analogous file shows the shape; a convention
document states the rule, and a rule holds even where no analogous file exists. Start from
`.agent/conventions.md` where the repo declares one: that file is the repo's own declaration,
seeded by `/ct-init` and confirmed by a human, and it is what keeps slice 14 citing the same
yardstick as slice 3. Then look for `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING`, a `docs/conventions/`
directory and the project skills; the issue's "Contexto del epic" may have named them already. List
under `Rules to obey:`, **by path**, the entries that bear on this slice — you are selecting, not
transporting: the program pastes that file into every task brief anyway, so omitting an entry does
not hide it from the judge. If the repo declares none, say so with `N/A — <reason>` rather than
inventing a plausible one: a path that is not in the repo fails the plan.

**There is a second yardstick, and it is not in this section: ct's own.** The four documents of
`conventions/`, whose absolute path the kickoff gives you. Read them before you write the plan.
They travel with the plugin, the program pastes them into every task brief, and **they take
precedence over this repo's** — measured rule by rule, not by topic: where a rule of this repo
requires what one of them forbids, that rule does not apply, and where this repo speaks about
something none of them speaks about, it binds in full. So this section still selects the repo's
rules; what changes is that a plan contradicting ct's produces tasks the judge will block.

One of them bears directly on how you split the work. `conventions/architecture.md` applies to
**new modules**: a module that was already there and does not conform is the repo's declared debt,
what gets added to it follows the style of its host, and that is not a finding — but a new concept
is a new module and is born conforming. Which of the two a piece of work is, is what you decide
when you write `**Files:**` and mark each path `(create)` or `(modify)`.
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run __tests__/kickoff.test.js __tests__/vara-ct.test.js __tests__/vara.test.js`
Expected: PASS en `kickoff.test.js`; en `vara-ct.test.js` los ties de `kickoff.js` y `SKILL.md` pasan a verde y quedan rojos los de `task-implementer.md` y `ct-judge.md`; `vara.test.js` verde y **sin tocar** — su tie de `SKILL.md` sigue pasando porque el apartado nuevo conserva `.agent/conventions.md`.

- [ ] **Step 7: Commit**

```bash
git add scripts/ct-next.mjs scripts/kickoff.js skills/writing-plans-prescriptive/SKILL.md __tests__/kickoff.test.js
git commit -m "feat(vara): el que escribe el plan lee la vara de ct antes"
```

---

### Task 5: las dos rúbricas miden las dos varas, con la precedencia

**Files:**
- Modify: `agents/ct-judge.md` (ítem `### 5. \`patrones\``, líneas 114-177; y la mención de la línea 40 en "What you are given")
- Modify: `prompts/task-implementer.md` (punto 3)
- Test: `__tests__/vara-ct.test.js` (los dos ties que quedaban, más los de abajo)

**Interfaces:**
- Consumes: `conventions/` de la Task 1; la sección que pega la Task 3.
- Produces: el ítem `patrones` mide las dos varas con la precedencia por regla. Pierde el outcome `sin-vara`, que ya no puede ocurrir, y conserva `no-aplica`. Los nueve `VERDICT_RULES` no cambian, y el encabezado del ítem sigue siendo exactamente `### 5. \`patrones\`` porque `__tests__/step-contracts.test.js` lo aísla con esa regex.

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/vara-ct.test.js`:

```js
describe('el ítem `patrones` mide las dos varas', () => {
  const item = () => {
    const texto = readFileSync(join(root, 'agents', 'ct-judge.md'), 'utf8')
    return /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(texto)[0]
  }

  it('nombra las dos: la de ct y la declaración del repo', () => {
    expect(item()).toContain('conventions/')
    expect(item()).toContain('.agent/conventions.md')
  })

  it('dice que la precedencia se mide regla a regla, no por tema', () => {
    expect(item()).toMatch(/rule by rule/i)
  })

  it('dice que una regla del repo de la que ct no habla obliga: no anula al repo', () => {
    expect(item()).toMatch(/binds/i)
  })

  it('declara que ya no puede salir `sin-vara`, en vez de ofrecerlo como salida', () => {
    // El texto TIENE que nombrar `sin-vara` para decir que no aplica aquí, así
    // que un `not.toContain` sería siempre rojo. Lo que se mide es la frase.
    expect(item()).toMatch(/never `sin-vara`/)
    expect(item()).not.toMatch(/count the item `sin-vara`/)
  })

  it('conserva `no-aplica` para un diff sin código que comparar', () => {
    expect(item()).toContain('no-aplica')
  })

  it('nombra los cuatro documentos y manda citar regla y ruta', () => {
    for (const nombre of CONVENTIONS_FILES) expect(item()).toContain(nombre)
    expect(item()).toContain('evidence')
  })

  it('cierra el agujero del módulo viejo con la misma frase que el documento', () => {
    expect(item()).toContain('a new concept is a new module')
  })
})

describe('el implementador y el juez leen el mismo texto', () => {
  const leerDos = () => [
    readFileSync(join(root, 'prompts', 'task-implementer.md'), 'utf8'),
    readFileSync(join(root, 'agents', 'ct-judge.md'), 'utf8'),
  ]

  it('los dos nombran los cuatro documentos de ct', () => {
    for (const texto of leerDos()) {
      for (const nombre of CONVENTIONS_FILES) expect(texto).toContain(nombre)
    }
  })

  it('los dos siguen nombrando la declaración del repo: son dos varas', () => {
    for (const texto of leerDos()) expect(texto).toContain('.agent/conventions.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/vara-ct.test.js -t 'patrones'`
Expected: FAIL — el ítem todavía dice `sin-vara` y no nombra `conventions/`.

- [ ] **Step 3: Reescribe el ítem `patrones` de `agents/ct-judge.md`**

Sustituye el ítem entero (de `### 5. \`patrones\`` hasta justo antes de `### 6.`) por:

```markdown
### 5. `patrones` — two yardsticks, and which one wins

**Where to look:** three places, and they are not the same kind of thing.

`## 3. Reference patterns` of the brief names **exemplars**: `Files to imitate:` are real paths a
script already checked exist. Open them and compare them with the code in the diff that plays the
same role. `Rules to obey:` are this repo's written conventions, by path, and any skill named there
— **open them and read the rules that bear on this diff.** A convention document is a path you open
with `Read`; a skill name is not a path and you load it with `Skill`. A skill that does not load is
one yardstick that did not arrive: say so in `result`, and go on with the rest.

**And the brief closes with ct's own yardstick**, pasted there by the program from the plugin's
`conventions/` directory: `code.md`, `decisions.md`, `architecture.md` and `testing.md`. No agent
wrote them into the brief and the plan cannot remove them. You do not open anything to get them;
they are in front of you. The brief may also close with the repo's own declaration, pasted from
`.agent/conventions.md`: the rule documents it names bind exactly as if §3 had named them, and where
the two lists differ the union is the repo's yardstick.

**Which one wins, and this is the part to get right.** ct's four documents take precedence, and the
precedence is measured **rule by rule, not by topic**. Where a rule of this repo requires what one
of those documents forbids, or forbids what they require, that rule of the repo does not apply and
the diff is measured by ct's. Where a rule of this repo speaks about something none of those four
speaks about, **it binds in full** and a diff that breaks it is a finding like any other. Precedence
resolves a clash; it does not delete this repo's yardstick, and reading it as "ct's is the only one"
is the failure to avoid here.

The case that fixes the boundary, with both sides: this repo's convention about casing, prefixes or
file names **binds**, because none of ct's four documents speaks about that. Its convention of
writing identifiers in Spanish does **not**, because `conventions/code.md` requires English. So the
line is not "naming or not": it is whether one of those four documents speaks about it.

**Read each ct document's scope line before you use it.** `code.md`, `decisions.md` and `testing.md`
apply to every diff. `architecture.md` applies to **new modules**: a module that was already there
and does not conform is this repository's declared debt, what the diff adds to it follows the style
of its host, and **that is not a finding**. But the exemption is bounded, and the document says how:
**a new concept is a new module and is born conforming**, so a new concept placed inside an old file
to inherit the exemption **is** a finding. Which of the two a file is, the brief tells you —
`**Files:**` marks each path `(create)` or `(modify)`, and a script already checked those marks
against the previous commit.

**What settles it:** for an exemplar, the idiom of the file the plan names against the idiom of the
diff. For a rule, whether the diff does what the document says — and here you do have a criterion,
because it is written down and you can quote it. Cite the document and the rule in `evidence`: not
"this reads badly" but "`conventions/architecture.md` says the conversion to the domain lives in the
boundary model, and this use case maps it by hand". Anything you cannot pin to a sentence of a
document the brief carries, or to an exemplar the plan names, is **not** this item's business — that
is the difference between a real finding and the defensive veto a verifier asked for defects always
produces.

Where an exemplar and a rule disagree, the rule wins: committed code is circumstance, a written
convention is the rule.

**One defect, one finding.** Three of these rules already have an item of their own, and they are
not yours to report here: a pre-existing test that stopped asserting is item 6, code no sentence of
the task asked for is item 8, and the three properties of a test this task adds are item 9. If what
you see fits one of those, report it there.

**This item is never `sin-vara`.** ct's yardstick travels with the plugin, so it cannot be absent —
if it had been, no brief would have been written at all. A repo that declares nothing of its own is
not an empty yardstick either: ct's still measures the diff. Reserve `no-aplica` for a diff with
nothing to compare: prose, plan text, a document.
```

- [ ] **Step 4: Ajusta "What you are given" en `agents/ct-judge.md`**

La frase de la línea 40 pasa a:

```markdown
  The brief closes with ct's yardstick — the four documents of the plugin's
  `conventions/` directory, pasted by the program, which take precedence over
  this repo's — and then, when the repo declares its conventions, a section the
  program pasted from `.agent/conventions.md`. No agent wrote either into the
  brief and the plan cannot remove them. Both are the rules of item 5.
```

- [ ] **Step 5: Reescribe el punto 3 de `prompts/task-implementer.md`**

Sustituye el punto 3 entero por:

```markdown
3. **The closed decisions are orders, not options.** A human already reviewed
   them at a gate. One you believe is wrong you obey anyway, and then you say so
   in your report: which decision, and what you think it costs. Silence is the
   failure being prevented here, not disagreement — but the place for the
   disagreement is the report, never the diff.

   `## 3. Reference patterns` is this repo's yardstick and names two kinds of
   thing, both real paths: `Files to imitate:`, whose shape you follow instead of
   inventing your own, and `Rules to obey:` — this repo's written conventions.
   **Open both before you write.** When the brief closes with a section pasted
   from `.agent/conventions.md`, those are this repo's declared rule documents:
   open them exactly as you open the ones §3 names.

   **And the brief closes with ct's own yardstick**, four documents the program
   pasted from the plugin's `conventions/` directory: `code.md`, `decisions.md`,
   `architecture.md` and `testing.md`. You do not have to open anything — they
   are in front of you — and the judge that reads your diff is handed the same
   four in the same brief, so a rule you skimmed is a round trip you paid for.

   **They take precedence over this repo's, rule by rule.** Where a rule of this
   repo requires what one of those four forbids, follow ct's. Where this repo
   says something none of the four speaks about — casing, prefixes, file names —
   follow this repo's: precedence resolves a clash, it does not excuse you from
   this repo's conventions.

   **Read each ct document's scope line.** `code.md`, `decisions.md` and
   `testing.md` apply to everything you write. `architecture.md` applies to **new
   modules**: a module that was already there and does not conform is this
   repository's declared debt, so what you add to it follows the style of its
   host and nobody will block you for that. What you may not do is hide a new
   concept inside an old file to inherit the exemption — **a new concept is a new
   module and is born conforming** — and which of the two you are writing is
   already decided for you by the `(create)` and `(modify)` marks of the
   `**Files:**` line.

   Where those rules speak about boundaries — what the core may import, how a
   dependency arrives, what objects may cross — your imports and constructors are
   the lines the judge will read against them. And where they say how a change
   reaches production, that shape is not yours to pick either.
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS entero, salvo el rojo deliberado de `SLICES_PRISTINE_HASHES` en `__tests__/ct-init.test.js` si sigue ahí — **no se toca ni se cuenta**, como dice su propia cabecera.

- [ ] **Step 7: Commit**

```bash
git add agents/ct-judge.md prompts/task-implementer.md __tests__/vara-ct.test.js
git commit -m "feat(vara): el juez y el implementador miden las dos varas"
```
