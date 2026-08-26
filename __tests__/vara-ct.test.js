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

  it('lo que no es una lista de documentos es una falta, no una excepción', () => {
    expect(faltasDeVara({})).toEqual([...CONVENTIONS_FILES])
    expect(faltasDeVara(5)).toEqual([...CONVENTIONS_FILES])
    expect(faltasDeVara(undefined)).toEqual([...CONVENTIONS_FILES])
  })

  it('un contenido que no es texto es una falta, no una excepción', () => {
    const documentos = docs('# x\nregla\n')
    documentos[3] = { nombre: documentos[3].nombre, contenido: 42 }
    expect(faltasDeVara(documentos)).toEqual(['testing.md'])
  })

  it('un elemento nulo dentro de la lista no rompe la cuenta', () => {
    expect(faltasDeVara([null, { nombre: 'code.md', contenido: 'x' }]))
      .toEqual(['decisions.md', 'architecture.md', 'testing.md'])
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

// Lo que este bloque protege no es un caso raro: es que una cabecera que anuncia
// cuatro documentos sin traerlos acabaría en el prompt de un agente, diciéndole
// que tiene una vara que no tiene.
describe('seccionDeVaraDeCt se niega a componer media promesa', () => {
  it('con la lista vacía, lanza en vez de devolver sólo la cabecera', () => {
    expect(() => seccionDeVaraDeCt([])).toThrow(/no se puede componer la vara de ct/)
  })

  it('con sólo nombres desconocidos, lanza: no son documentos de la vara', () => {
    expect(() => seccionDeVaraDeCt([{ nombre: 'otro.md', contenido: 'x' }]))
      .toThrow(/no se puede componer la vara de ct/)
  })

  it('con un documento en blanco, lanza y nombra el que falta', () => {
    const documentos = docs('# x\nregla\n')
    documentos[2] = { nombre: documentos[2].nombre, contenido: '   ' }
    expect(() => seccionDeVaraDeCt(documentos)).toThrow(/architecture\.md/)
  })

  it('con un contenido que no es texto, lanza en vez de reventar por dentro', () => {
    const documentos = docs('# x\nregla\n')
    documentos[0] = { nombre: documentos[0].nombre, contenido: null }
    expect(() => seccionDeVaraDeCt(documentos)).toThrow(/code\.md/)
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

describe('la vara del repo sigue en pie', () => {
  it('scripts/vara.js sigue transportando `.agent/conventions.md`', async () => {
    const vara = await import('../scripts/vara.js')
    expect(vara.CONVENTIONS_FILE).toBe('.agent/conventions.md')
    expect(typeof vara.seccionDeVara).toBe('function')
  })
})

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

  it('los dos llevan ENTERA la frase que cierra la exención del módulo viejo', () => {
    // Sin cortarla por un salto de línea: es carga estructural, la cita
    // `conventions/architecture.md` con esas palabras, y una de las dos rúbricas
    // que la parta deja al implementador y al juez leyendo cosas distintas.
    for (const texto of leerDos()) {
      expect(texto).toContain('a new concept is a new module and is born conforming')
    }
  })
})
