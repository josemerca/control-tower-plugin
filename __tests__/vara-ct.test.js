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

describe('la vara del repo sigue en pie', () => {
  it('scripts/vara.js sigue transportando `.agent/conventions.md`', async () => {
    const vara = await import('../scripts/vara.js')
    expect(vara.CONVENTIONS_FILE).toBe('.agent/conventions.md')
    expect(typeof vara.seccionDeVara).toBe('function')
  })
})
