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

  it('code.md cierra el mismo agujero para su exención de estilo', () => {
    expect(leer('code.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('ninguno repite una regla que ya posee un ítem de la rúbrica', () => {
    // Cada grupo es un ítem de la rúbrica del juez que YA posee esa regla. Que
    // uno de estos documentos la repita es un defecto real: `decisions.md`
    // prohíbe escribir una regla dos veces, y el recuento por severidad del
    // veredicto se infla cuando dos ítems cazan el mismo defecto.
    const todo = Object.keys(ALCANCES).map(leer).join('\n')
    for (const [item, terminos] of Object.entries({
      'manipulacion-tests': [/skip/i, /xfail/i, /pre-existing test/i, /flaky/i],
      'test-desiderata': [/deterministic/i, /\bisolated\b/i, /call count/i, /real behaviou?r/i],
      alcance: [/no sentence of the task/i, /speculative/i, /scaffolding/i],
    })) {
      for (const t of terminos) {
        expect(todo, `${item} ya posee esta regla: ${t}`).not.toMatch(t)
      }
    }
  })
})

describe('code.md distingue estilo (exento en módulo viejo) de defecto (nunca exento)', () => {
  const clausula = () =>
    /A module that was already there[\s\S]*?(?=\n## )/.exec(leer('code.md'))[0].replace(/\s+/g, ' ')

  const REGLAS_DE_DEFECTO = [
    /raw map returned as the value of logic/,
    /closed vocabulary collapsed into a loose string or a boolean/,
    /two fields that have to agree instead of one that makes the wrong state impossible/,
    /an error named for where it happens instead of what happens/,
  ]

  const AFIRMACIONES = {
    'acota la deuda a lo que es estilo, no la declara general':
      () => expect(clausula()).toContain("the debt is only as wide as this document's **style** rules"),
    'enumera las tres reglas de estilo exentas: prosa, idioma de los identificadores, función colgada de un tipo':
      () =>
        expect(clausula()).toContain(
          'no prose, the language its identifiers are written in, and that every function hangs off a type'
        ),
    'declara que las reglas de defecto NO tienen la exención':
      () => expect(clausula()).toContain("This document's **defect** rules carry no such exemption"),
    'nombra al menos dos de las cuatro reglas de defecto, para que la declaración tenga sujeto':
      () => {
        const nombradas = REGLAS_DE_DEFECTO.filter((regla) => regla.test(clausula())).length
        expect(nombradas, 'code.md nombra menos de dos reglas de defecto sin exención').toBeGreaterThanOrEqual(2)
      },
    'dice que las reglas de defecto rigen en un módulo viejo igual que en uno nuevo':
      () => expect(clausula()).toContain('those bind on every diff, in a module born today and one that was already there alike'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`code.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

describe('testing.md separa "visto fallar por su motivo" de la fase roja del ciclo, y declara la asimetría de quién puede correrla', () => {
  const clausula = () =>
    /## An assertion is not finished until it has been seen to fail for the reason its name gives[\s\S]*?(?=\n## )/
      .exec(leer('testing.md'))[0]
      .replace(/\s+/g, ' ')

  const AFIRMACIONES = {
    'declara explícitamente que no es la fase roja del ciclo':
      () => expect(clausula(), 'testing.md no dice "This is not the red phase of the cycle"').toContain('This is not the red phase of the cycle'),
    'separa la fase roja (falta el comportamiento) de esto (se rompe lo concreto que el nombre nombra)':
      () =>
        expect(
          clausula(),
          'testing.md no distingue "the behaviour is missing" de "the concrete thing its name promises is broken"'
        ).toContain('This proves a test fails when the concrete thing its name promises is broken.'),
    'dice qué se arregla cuando el nombre promete más de lo que la aserción puede fallar':
      () =>
        expect(
          clausula(),
          'testing.md no dice que casi siempre lo que está mal es la aserción, no el nombre'
        ).toContain('it is almost always the assertion that'),
    'declara que quien escribe la aserción la corre':
      () => expect(clausula(), 'testing.md no dice "Whoever writes the assertion runs it"').toContain('Whoever writes the assertion runs it'),
    'declara que quien juzga no tiene con qué correrla y la aplica leyendo':
      () =>
        expect(
          clausula(),
          'testing.md no dice que quien juzga el diff no tiene con qué correr nada y lo aplica leyendo'
        ).toContain('Whoever judges the diff has nothing to run it'),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(`testing.md ${afirmacion}`, () => {
      comprobar()
    })
  }
})

