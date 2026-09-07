import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

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
  'simplicity.md': 'every diff',
  'decisions.md': 'every diff',
  'testing.md': 'every diff',
  'architecture.md': 'new modules',
  'domain.md': 'every diff',
  'boundaries.md': 'every diff',
}

describe('the documents in conventions/', () => {
  it('ALCANCES nombra exactamente lo que PluginYardstick.FILES declara, ni uno mas ni uno menos', () => {
    expect(Object.keys(ALCANCES).sort()).toEqual([...PluginYardstick.FILES].sort())
  })

  for (const [nombre, alcance] of Object.entries(ALCANCES)) {
    it(`${nombre} declares its scope in the header`, () => {
      const cabecera = Documento.cabeceraDe(nombre)
      expect(cabecera).toContain('Applies to:')
      expect(cabecera).toContain(alcance)
    })

    it(`${nombre} carries rules, not just headings`, () => {
      const sustancia = Documento.texto(nombre)
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
      expect(sustancia.length).toBeGreaterThan(20)
    })
  }

  it('architecture.md closes the hole in the old-module exemption', () => {
    expect(Documento.texto('architecture.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('style.md closes the same hole for its style exemption', () => {
    expect(Documento.texto('style.md')).toContain('a new concept is a new module and is born conforming')
  })

  it('every document it cites by name is a document that exists, so a split never leaves a citation nobody can follow', () => {
    const citada = /`conventions\/([a-z-]+\.md)`/g
    for (const nombre of Object.keys(ALCANCES)) {
      const encontradas = [...Documento.texto(nombre).matchAll(citada)].map((found) => found[1])
      for (const cita of encontradas) {
        expect(Object.keys(ALCANCES), `${nombre} cita conventions/${cita}, que no existe`).toContain(cita)
      }
    }
  })

  it('none repeats a rule that a rubric item already owns', () => {
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

describe('the debt exemption lives in style.md and does NOT reach defects.md', () => {
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

describe('defects.md carries the four defect rules as its own subject, each under its own heading', () => {
  const ENCABEZADOS = [
    '## Closed vocabulary instead of loose strings and booleans',
    '## No raw map as the return value of logic',
    '## Two fields that have to agree',
    '## Errors are named for what happens, not for where',
  ]

  for (const encabezado of ENCABEZADOS) {
    it(`has its own section: ${encabezado}`, () => {
      expect(Documento.texto('defects.md')).toContain(encabezado)
    })
  }

  it('none of the four stayed in style.md when the document was split', () => {
    const estilo = Documento.texto('style.md')
    for (const encabezado of ENCABEZADOS) {
      expect(estilo, `${encabezado} is still in style.md`).not.toContain(encabezado)
    }
  })

  it('closes the gap the judge caught in slice #7: the consumer serializing at the end does NOT exempt the map', () => {
    const seccion = Documento.clausulaDe('defects.md', '## No raw map as the return value of logic')
    expect(seccion).toContain('The boundary is the last step before the wire, and it is one step')
    expect(seccion).toContain('does not make a raw map its legitimate input')
    expect(seccion).toContain('however close to the wire it sits')
  })

  it('names the sentinel value as the second field in disguise, with the empty-message case measured', () => {
    const seccion = Documento.clausulaDe('defects.md', '## Two fields that have to agree')
    expect(seccion).toContain("A sentinel value is that second field wearing the first field's clothes")
    expect(seccion).toContain('The empty string standing for "no message"')
  })
})

describe('testing.md separates "seen to fail for its reason" from the cycle\'s red phase, and declares the asymmetry of who can run it', () => {
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

describe('architecture.md says where a new thing goes, and makes the layers visible', () => {
  const AFIRMACIONES = {
    'exige que las capas y sus habitantes se vean en el arbol':
      () => expect(Documento.texto('architecture.md')).toContain('the folder is the discriminator, never a suffix on the name'),
    'pone la carga de la prueba en el tipo nuevo, con el metodo como respuesta por defecto':
      () => expect(Documento.texto('architecture.md')).toContain('a method on a type that already exists'),
    'dice que un test no es un consumidor':
      () => expect(Documento.texto('architecture.md')).toContain('a test double is not a consumer'),
    'deja el payload de un unico propietario en el fichero de ese propietario':
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

describe('the yardstick names no language and no tool', () => {
  const PROHIBIDOS = [
    /vitest/i, /pytest/i, /jest/i, /execFile/, /\bnpx\b/, /\bnpm\b/, /\bnode\b/i,
    /Object\.freeze/, /\bfetch\b/, /\.m?jsx?\b/, /\.tsx?\b/, /\bnode_modules\b/,
    /\bpython\b/i, /\bjavascript\b/i, /\btypescript\b/i, /\bruby\b/i, /\brust\b/i,
    /\bjava\b/i, /\bkotlin\b/i, /\bswift\b/i, /\bgolang\b/i, /\bphp\b/i, /\bperl\b/i,
    /c\+\+/i, /\bc#/i,
  ]

  for (const nombre of Object.keys(ALCANCES)) {
    for (const prohibido of PROHIBIDOS) {
      it(`${nombre} no nombra ${prohibido}`, () => {
        expect(Documento.texto(nombre)).not.toMatch(prohibido)
      })
    }
  }

  it('cuando se habla de un codigo de salida, se nombra tambien la otra forma del borde', () => {
    for (const nombre of Object.keys(ALCANCES)) {
      const texto = Documento.texto(nombre)
      if (!/exit code/i.test(texto)) continue
      expect(texto, `${nombre} habla de exit code sin nombrar el servicio que atiende`)
        .toContain('a service that answers')
    }
  })

  it('nadie en el plugin sigue diciendo que son cinco', () => {
    const fuentes = ['scripts/run-metrics.js', 'scripts/ct-next.mjs', 'scripts/kickoff.js', 'scripts/ct-step.mjs',
      'agents/ct-reconciler.md', 'skills/writing-plans-prescriptive/SKILL.md']
    for (const ruta of fuentes) {
      const texto = readFileSync(join(root, ruta), 'utf8')
      expect(texto, `${ruta} sigue diciendo cinco`).not.toMatch(/cinco documentos|five documents/i)
    }
  })
})
