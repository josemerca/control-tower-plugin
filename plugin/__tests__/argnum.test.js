// D4, defecto 2: `parseInt(x, 10)` es un parser TOLERANTE — devuelve un
// número DISTINTO del que el usuario escribió, en silencio. Estos casos son
// exactamente los que se colaban antes: cada uno de los `toBe(null)` de abajo
// devolvía un número con `parseInt`, y ese número decidía cuántos agentes se
// lanzaban (`--cap`) o qué issue se reclamaba (`dispatch-check <issue#>`).
import { describe, it, expect } from 'vitest'
import { parseStrictInt } from '../scripts/argnum.js'

describe('parseStrictInt', () => {
  it('acepta enteros escritos en dígitos decimales a secas', () => {
    expect(parseStrictInt('1')).toBe(1)
    expect(parseStrictInt('1000')).toBe(1000)
    expect(parseStrictInt('0')).toBe(0)
    expect(parseStrictInt('007')).toBe(7) // ceros a la izquierda: el valor NO diverge
  })

  // D5, hallazgo I: D4 aceptaba el signo a propósito ("+2" es fielmente 2, no
  // diverge del valor escrito). Pero los TRES call-sites prometen, en el
  // texto de su propio error, "dígitos decimales a secas" / "dígitos a
  // secas" — y "+2" no lo es. El mensaje afirmaba una regla y el código
  // aplicaba otra; se rechaza el signo para que coincidan. Verificado contra
  // el código sin arreglar: estos dos `toBe(null)` daban 2 y -3.
  it('rechaza el signo explícito, aunque el valor no divergiera (el mensaje de error promete "a secas")', () => {
    expect(parseStrictInt('+2')).toBe(null)
    expect(parseStrictInt('-3')).toBe(null)
    expect(parseStrictInt('+0')).toBe(null)
    expect(parseStrictInt('-0')).toBe(null)
  })

  // El contraste con parseInt es el test: lo que sigue NO es una lista de
  // rarezas teóricas, es lo que parseInt convertía en un número plausible.
  const silentlyWrong = {
    '1e3': 1, // el usuario pedía 1000 y recibía 1
    '3perros': 3,
    '2.9': 2,
    ' 3': 3,
    '42x': 42, // dispatch-check: reclamaba el issue 42 sin que nadie lo nombrara
  }
  for (const [raw, whatParseIntGave] of Object.entries(silentlyWrong)) {
    it(`rechaza ${JSON.stringify(raw)} (parseInt daba ${whatParseIntGave} en silencio)`, () => {
      expect(parseInt(raw, 10)).toBe(whatParseIntGave) // el bug, fijado como evidencia
      expect(parseStrictInt(raw)).toBe(null)
    })
  }

  it('rechaza formas que Number() aceptaría cambiando el valor de forma no obvia', () => {
    expect(parseStrictInt('0x10')).toBe(null) // Number → 16
    expect(parseStrictInt('')).toBe(null) // Number → 0
    expect(parseStrictInt('  ')).toBe(null) // Number → 0
    expect(parseStrictInt('1_000')).toBe(null)
    expect(parseStrictInt('Infinity')).toBe(null)
  })

  it('rechaza un entero fuera del rango seguro (redondearía a otro número)', () => {
    expect(parseStrictInt('99999999999999999999')).toBe(null)
  })

  it('rechaza lo que no es una cadena (p.ej. el `true` de un flag sin valor)', () => {
    expect(parseStrictInt(true)).toBe(null)
    expect(parseStrictInt(undefined)).toBe(null)
    expect(parseStrictInt(7)).toBe(null)
  })
})
