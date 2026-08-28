import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

class Documento {
  static texto(nombre) {
    return readFileSync(join(root, 'conventions', nombre), 'utf8')
  }

  static cabeceraDe(nombre) {
    return Documento.texto(nombre).split('\n').slice(0, 6).join('\n')
  }

  static clausulaDe(nombre, encabezado) {
    return new RegExp(`${encabezado}[\\s\\S]*?(?=\\n## )`)
      .exec(Documento.texto(nombre))[0]
      .replace(/\s+/g, ' ')
  }
}

const ALCANCES = {
  'defects.md': 'every diff',
  'style.md': 'every diff',
  'decisions.md': 'every diff',
  'testing.md': 'every diff',
  'architecture.md': 'new modules',
}

describe('los documentos de conventions/', () => {
  for (const [nombre, alcance] of Object.entries(ALCANCES)) {
    it(`${nombre} declara su alcance en la cabecera`, () => {
      const cabecera = Documento.cabeceraDe(nombre)
      expect(cabecera).toContain('Applies to:')
      expect(cabecera).toContain(alcance)
    })

    it(`${nombre} trae reglas, no sólo encabezados`, () => {
      const sustancia = Documento.texto(nombre)
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
      expect(sustancia.length).toBeGreaterThan(20)
    })
  }

  it('architecture.md cierra el agujero de la exención del módulo viejo', () => {
    expect(Documento.texto('architecture.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('style.md cierra el mismo agujero para su exención de estilo', () => {
    expect(Documento.texto('style.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('ninguno repite una regla que ya posee un ítem de la rúbrica', () => {
    const todo = Object.keys(ALCANCES).map(Documento.texto).join('\n')
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

describe('la exención de deuda vive en style.md y NO alcanza a defects.md', () => {
  const clausulaDeEstilo = () => Documento.clausulaDe('style.md', 'A module that was already there')
  const cabeceraDeDefectos = () =>
    Documento.texto('defects.md').split('\n## ')[0].replace(/\s+/g, ' ')

  const AFIRMACIONES = {
    'style.md acota la deuda a sus tres reglas, no la declara general':
      () => expect(clausulaDeEstilo()).toContain("the debt is exactly as wide as this document's three rules"),
    'style.md enumera las tres reglas exentas: prosa, idioma de los identificadores, función colgada de un tipo':
      () =>
        expect(clausulaDeEstilo()).toContain(
          'no prose, the language its identifiers are written in, and that every function hangs off a type'
        ),
    'style.md dice que su exención TERMINA en defects.md, nombrándolo por su ruta':
      () => {
        expect(clausulaDeEstilo()).toContain('The exemption ends at this document')
        expect(clausulaDeEstilo()).toContain('`conventions/defects.md` bind on every diff')
      },
    'defects.md declara en su LÍNEA DE ALCANCE que no hay exención, no sólo en la prosa':
      () => expect(Documento.cabeceraDe('defects.md')).toContain('with no exemption'),
    'defects.md dice que la exención de style.md se detiene en él':
      () => expect(cabeceraDeDefectos()).toContain('That exemption stops at this document'),
    'defects.md dice que sus reglas rigen en un módulo viejo igual que en uno nuevo':
      () =>
        expect(cabeceraDeDefectos()).toContain(
          'in a module born today and in one that was already there'
        ),
  }

  for (const [afirmacion, comprobar] of Object.entries(AFIRMACIONES)) {
    it(afirmacion, () => {
      comprobar()
    })
  }
})

describe('defects.md lleva las cuatro reglas de defecto como SU asunto, cada una con su encabezado', () => {
  const ENCABEZADOS = [
    '## Closed vocabulary instead of loose strings and booleans',
    '## No raw map as the return value of logic',
    '## Two fields that have to agree',
    '## Errors are named for what happens, not for where',
  ]

  for (const encabezado of ENCABEZADOS) {
    it(`tiene su propia sección: ${encabezado}`, () => {
      expect(Documento.texto('defects.md')).toContain(encabezado)
    })
  }

  it('ninguna de las cuatro se quedó en style.md al partir el documento', () => {
    const estilo = Documento.texto('style.md')
    for (const encabezado of ENCABEZADOS) {
      expect(estilo, `${encabezado} sigue en style.md`).not.toContain(encabezado)
    }
  })

  it('cierra el hueco que el juez tomó en el slice #7: que el consumidor serialice al final NO exime al mapa', () => {
    const seccion = Documento.clausulaDe('defects.md', '## No raw map as the return value of logic')
    expect(seccion).toContain('The boundary is the last step before the wire, and it is one step')
    expect(seccion).toContain('does not make a raw map its legitimate input')
    expect(seccion).toContain('however close to the wire it sits')
  })

  it('nombra el valor centinela como el segundo campo disfrazado, con el caso medido del mensaje vacío', () => {
    const seccion = Documento.clausulaDe('defects.md', '## Two fields that have to agree')
    expect(seccion).toContain("A sentinel value is that second field wearing the first field's clothes")
    expect(seccion).toContain('The empty string standing for "no message"')
  })
})

describe('testing.md separa "visto fallar por su motivo" de la fase roja del ciclo, y declara la asimetría de quién puede correrla', () => {
  const clausula = () => Documento.clausulaDe(
    'testing.md',
    '## An assertion is not finished until it has been seen to fail for the reason its name gives'
  )

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

