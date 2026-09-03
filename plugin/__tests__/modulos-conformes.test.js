import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

class NacidosConformes {
  static RUTAS = [
    'scripts/plugin-yardstick.js',
    'scripts/yardstick-citation.js',
    '__tests__/plugin-yardstick.test.js',
    '__tests__/yardstick-citation.test.js',
    '__tests__/conventions-vara.test.js',
    'scripts/branch-reconciliation.js',
    'scripts/reconcile-outcome.js',
    '__tests__/modulos-conformes.test.js',
    '__tests__/branch-reconciliation.test.js',
    '__tests__/branch-reconciliation-real-git.test.js',
    '__tests__/branch-reconciliation-real-git-produccion.test.js',
    '__tests__/branch-reconciliation-base-ilegible.test.js',
    '__tests__/reconcile-outcome.test.js',
    '__tests__/seccion-del-plan.test.js',
    '__tests__/frontera-de-distribucion.test.js',
    'scripts/slice-collection.js',
    '__tests__/slice-collection.test.js',
    'scripts/slice-collector.js',
    '__tests__/slice-collector.test.js',
    'scripts/harvest-table.js',
    '__tests__/harvest-table.test.js',
    'scripts/bigquery-load.js',
    '__tests__/bigquery-load.test.js',
    '__tests__/fixtures/fake-bq-bin/bq',
    '__tests__/ct-harvest-bq.test.js',
  ]

  static PALABRAS_CASTELLANAS = [
    'cita', 'citas', 'nombre', 'nombres', 'texto', 'fila', 'filas', 'vara', 'documento', 'documentos',
    'encontrados', 'medir', 'medida', 'paso', 'pasos', 'regla', 'reglas', 'hallazgo', 'hallazgos',
    'intento', 'cuerpo', 'previos', 'comentario', 'comentarios', 'recorrido', 'alcance', 'sujeto',
  ]

  static #numeradas(ruta) {
    return readFileSync(join(raiz, ruta), 'utf8')
      .split('\n')
      .map((linea, indice) => [indice + 1, linea])
  }

  static prosaEn(ruta) {
    return NacidosConformes.#numeradas(ruta)
      .filter(([, linea]) => /^\s*(?:\/\/|\/\*|\*)/.test(linea))
      .map(([numero]) => numero)
  }

  static funcionesSueltasEn(ruta) {
    return NacidosConformes.#numeradas(ruta)
      .filter(([, linea]) => /^(?:export\s+)?(?:async\s+)?function\b/.test(linea))
      .map(([numero]) => numero)
  }

  static funcionesSueltasDisfrazadasEn(ruta) {
    return NacidosConformes.#numeradas(ruta)
      .filter(([, linea]) => /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:\(|async\s*\(|function\b)/.test(linea))
      .map(([numero]) => numero)
  }

  static identificadoresCastellanosEn(ruta) {
    const fuente = readFileSync(join(raiz, ruta), 'utf8')
    const declarados = [...fuente.matchAll(/\b(?:class|const|let|var|function|static)\s+#?([A-Za-z_$][\w$]*)/g)]
      .map((encaje) => encaje[1])
    return [...new Set(declarados.filter((identificador) =>
      NacidosConformes.PALABRAS_CASTELLANAS.includes(identificador.toLowerCase())
    ))]
  }

  static #cadenasDeTestEn(ruta) {
    return NacidosConformes.#numeradas(ruta)
      .map(([numero, linea]) => [numero, linea.match(/^\s*(?:describe|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/)])
      .filter(([, encaje]) => encaje)
      .map(([numero, encaje]) => [numero, encaje[2].replace(/\$\{[^}]*\}/g, ' ')])
  }

  static #letraNoAsciiEn(cadena) {
    return [...cadena].some((caracter) => {
      if (caracter.codePointAt(0) <= 127) return false
      if (caracter === '¿' || caracter === '¡') return true
      return /\p{L}/u.test(caracter)
    })
  }

  static noAsciiEnTestsDe(ruta) {
    return NacidosConformes.#cadenasDeTestEn(ruta)
      .filter(([, cadena]) => NacidosConformes.#letraNoAsciiEn(cadena))
      .map(([numero]) => numero)
  }

  static palabrasCastellanasEnTestsDe(ruta) {
    return NacidosConformes.#cadenasDeTestEn(ruta)
      .filter(([, cadena]) => cadena.split(/[^A-Za-z]+/).some((palabra) =>
        NacidosConformes.PALABRAS_CASTELLANAS.includes(palabra.toLowerCase())
      ))
      .map(([numero]) => numero)
  }
}

describe('modules born under the yardstick keep being born conforming', () => {
  it('measures only the THREE rules of style.md and not a fourth invented one: that document does not forbid a loose constant, only a loose function', () => {
    expect(NacidosConformes.prosaEn('scripts/yardstick-citation.js')).toEqual([])
    expect(NacidosConformes.funcionesSueltasEn('scripts/yardstick-citation.js')).toEqual([])
    expect(NacidosConformes.funcionesSueltasDisfrazadasEn('scripts/yardstick-citation.js')).toEqual([])
  })

  it('the list names both modules and names ITSELF: a guard blind to its own file once left 21 comments inside it', () => {
    expect(NacidosConformes.RUTAS).toContain('scripts/plugin-yardstick.js')
    expect(NacidosConformes.RUTAS).toContain('scripts/yardstick-citation.js')
    expect(NacidosConformes.RUTAS).toContain('__tests__/modulos-conformes.test.js')
  })

  for (const ruta of NacidosConformes.RUTAS) {
    it(`${ruta} does not carry a single line of prose`, () => {
      expect(NacidosConformes.prosaEn(ruta), `${ruta} has comments on those lines`).toEqual([])
    })

    it(`${ruta} does not declare any loose function at module level`, () => {
      expect(NacidosConformes.funcionesSueltasEn(ruta), `${ruta} declares loose functions on those lines`)
        .toEqual([])
    })

    it(`${ruta} does not sneak in a loose module-level function disguised as an arrow constant`, () => {
      expect(NacidosConformes.funcionesSueltasDisfrazadasEn(ruta), `${ruta} declares loose arrow functions`)
        .toEqual([])
    })
  }
})

describe('the language of identifiers, by an EXACT block list', () => {
  for (const ruta of ['scripts/plugin-yardstick.js', 'scripts/yardstick-citation.js']) {
    it(`${ruta} does not declare identifiers in Spanish`, () => {
      expect(NacidosConformes.identificadoresCastellanosEn(ruta)).toEqual([])
    })
  }

  it('the match is exact and not by prefix: by prefix it flagged `citation`, which is perfect English', () => {
    expect(NacidosConformes.PALABRAS_CASTELLANAS).toContain('cita')
    expect(NacidosConformes.identificadoresCastellanosEn('scripts/yardstick-citation.js')).toEqual([])
  })
})

describe('the language of test names, by two mechanical checks: no non-ASCII letters, and the same EXACT block list', () => {
  for (const ruta of NacidosConformes.RUTAS) {
    it(`${ruta} carries no describe or it with a non-ASCII letter`, () => {
      expect(NacidosConformes.noAsciiEnTestsDe(ruta), `${ruta} has a non-ASCII test name on those lines`).toEqual([])
    })

    it(`${ruta} carries no describe or it with a word from the Spanish block list`, () => {
      expect(NacidosConformes.palabrasCastellanasEnTestsDe(ruta), `${ruta} has a Spanish test name on those lines`)
        .toEqual([])
    })
  }
})
