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
}

describe('los ficheros nacidos bajo la vara siguen naciendo conformes', () => {
  it('mide sólo las TRES reglas de style.md y no una cuarta inventada: ese documento no prohíbe una constante suelta, sólo una función suelta', () => {
    expect(NacidosConformes.prosaEn('scripts/yardstick-citation.js')).toEqual([])
    expect(NacidosConformes.funcionesSueltasEn('scripts/yardstick-citation.js')).toEqual([])
    expect(NacidosConformes.funcionesSueltasDisfrazadasEn('scripts/yardstick-citation.js')).toEqual([])
  })

  it('la lista nombra los dos módulos y se nombra a SÍ MISMA: una guarda ciega a su propio fichero ya se dejó 21 comentarios dentro', () => {
    expect(NacidosConformes.RUTAS).toContain('scripts/plugin-yardstick.js')
    expect(NacidosConformes.RUTAS).toContain('scripts/yardstick-citation.js')
    expect(NacidosConformes.RUTAS).toContain('__tests__/modulos-conformes.test.js')
  })

  for (const ruta of NacidosConformes.RUTAS) {
    it(`${ruta} no lleva ni una línea de prosa`, () => {
      expect(NacidosConformes.prosaEn(ruta), `${ruta} tiene comentarios en esas líneas`).toEqual([])
    })

    it(`${ruta} no declara ninguna función suelta a nivel de módulo`, () => {
      expect(NacidosConformes.funcionesSueltasEn(ruta), `${ruta} declara funciones sueltas en esas líneas`)
        .toEqual([])
    })

    it(`${ruta} no cuela una función suelta a nivel de módulo disfrazada de constante con una flecha`, () => {
      expect(NacidosConformes.funcionesSueltasDisfrazadasEn(ruta), `${ruta} declara funciones flecha sueltas`)
        .toEqual([])
    })
  }
})

describe('el idioma de los identificadores, por lista negra EXACTA', () => {
  for (const ruta of ['scripts/plugin-yardstick.js', 'scripts/yardstick-citation.js']) {
    it(`${ruta} no declara identificadores en castellano`, () => {
      expect(NacidosConformes.identificadoresCastellanosEn(ruta)).toEqual([])
    })
  }

  it('la coincidencia es exacta y no por prefijo: por prefijo señalaba `citation`, que es inglés perfecto', () => {
    expect(NacidosConformes.PALABRAS_CASTELLANAS).toContain('cita')
    expect(NacidosConformes.identificadoresCastellanosEn('scripts/yardstick-citation.js')).toEqual([])
  })
})
