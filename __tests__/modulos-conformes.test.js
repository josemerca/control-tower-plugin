import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Los módulos que NACIERON bajo la vara de ct, y a los que por tanto no les
// cubre la exención de deuda declarada de `conventions/style.md`: nacen
// conformes y tienen que seguirlo estando. Nada lo impedía hasta ahora, y se
// notó — `YardstickCitation` pasó dos rondas creciendo dentro de
// `run-metrics.js` como tres constantes sueltas y dos funciones libres, en
// castellano, heredando la exención de un fichero viejo. Esta guarda es lo que
// habría dicho «eso no» la primera vez.
//
// Se comprueban las tres reglas de estilo que son deterministas sobre el texto
// del fichero. La cuarta —el idioma— se comprueba con una LISTA NEGRA y no con
// un diccionario: es una heurística, se declara como tal, y su valor es que
// caza exactamente la deriva que ocurrió.
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

const MODULOS_NACIDOS_CONFORMES = [
  'scripts/plugin-yardstick.js',
  'scripts/yardstick-citation.js',
]

const PALABRAS_CASTELLANAS = [
  'cita', 'citas', 'nombre', 'nombres', 'texto', 'fila', 'filas', 'vara', 'documento', 'documentos',
  'encontrados', 'medir', 'medida', 'paso', 'pasos', 'regla', 'reglas', 'hallazgo', 'hallazgos',
  'intento', 'cuerpo', 'previos', 'comentario', 'comentarios', 'recorrido', 'alcance', 'sujeto',
]

const leer = (ruta) => readFileSync(join(raiz, ruta), 'utf8')

describe('los módulos nacidos bajo la vara siguen naciendo conformes', () => {
  // La lista se comprueba FUERA del bucle, y esto salió mutando: vaciarla dejaba
  // la suite entera en verde, porque un `for` sobre un array vacío no genera
  // ningún test. La guarda se podía desactivar en silencio borrando una línea.
  it('la lista nombra los módulos que no pueden dejar de conformar', () => {
    expect(MODULOS_NACIDOS_CONFORMES).toContain('scripts/plugin-yardstick.js')
    expect(MODULOS_NACIDOS_CONFORMES).toContain('scripts/yardstick-citation.js')
  })

  for (const ruta of MODULOS_NACIDOS_CONFORMES) {
    it(`${ruta} no lleva ni una línea de prosa`, () => {
      const prosa = leer(ruta)
        .split('\n')
        .map((linea, i) => [i + 1, linea.trim()])
        .filter(([, linea]) => linea.startsWith('//') || linea.startsWith('/*') || linea.startsWith('*'))
      expect(prosa, `${ruta} tiene comentarios: ${prosa.map(([n]) => n).join(', ')}`).toEqual([])
    })

    it(`${ruta} no tiene ninguna función suelta a nivel de módulo`, () => {
      const sueltas = leer(ruta)
        .split('\n')
        .map((linea, i) => [i + 1, linea])
        .filter(([, linea]) => /^(?:export\s+)?(?:async\s+)?function\b/.test(linea))
      expect(sueltas, `${ruta} declara funciones a nivel de módulo: ${sueltas.map(([n]) => n).join(', ')}`)
        .toEqual([])
    })

    it(`${ruta} no tiene ninguna constante suelta a nivel de módulo: todo cuelga del tipo`, () => {
      const sueltas = leer(ruta)
        .split('\n')
        .map((linea, i) => [i + 1, linea])
        .filter(([, linea]) => /^(?:export\s+)?(?:const|let|var)\b/.test(linea))
      expect(sueltas, `${ruta} declara constantes a nivel de módulo: ${sueltas.map(([n]) => n).join(', ')}`)
        .toEqual([])
    })

    it(`${ruta} declara sus identificadores en inglés (heurística: lista negra exacta de las palabras que ya se colaron)`, () => {
      const identificadores = [...leer(ruta).matchAll(/\b(?:class|const|let|var|function|static)\s+#?([A-Za-z_$][\w$]*)/g)]
        .map((m) => m[1])
        .concat([...leer(ruta).matchAll(/(?:^|[(,]\s*)([a-z][\w$]*)\s*(?:[),=]|=>)/gm)].map((m) => m[1]))
      // Coincidencia EXACTA y no por prefijo. La primera versión marcaba también
      // los identificadores que EMPIEZAN por una de estas palabras, y señaló
      // `citation` —inglés perfecto— por empezar por `cita`. Una guarda que da
      // falsas alarmas sobre nombres legítimos se acaba borrando, y la deriva
      // que de verdad ocurrió (`nombre`, `cita`, `texto`, `encontrados`) era
      // exacta.
      const castellanas = identificadores.filter((nombre) => PALABRAS_CASTELLANAS.includes(nombre.toLowerCase()))
      expect([...new Set(castellanas)], `${ruta} declara identificadores en castellano`).toEqual([])
    })
  }
})
