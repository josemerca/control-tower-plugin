// #99 — LOS TEXTOS QUE LEEN LOS AGENTES, ESCRITOS EN POSITIVO.
//
// El obstáculo `negative-bleedthrough` (Kassner & Schütze 2020) dice que
// nombrar lo prohibido activa sus tokens: un texto que enumera lo que no debe
// haber le está enseñando al modelo justo eso. El patrón `point-the-target`
// propone lo contrario — describir el objetivo — y es lo que la reescritura de
// #99 aplicó a las nueve reglas del juez de tarea, a las tres del juez de
// slice, al kickoff y al prompt del implementador.
//
// Este test es lo único que fija el resultado. La reescritura es prosa: nada
// la protege de volver a llenarse de negaciones una ronda tras otra, porque
// cada frase negativa nueva parece inofensiva por separado. Un umbral por
// fichero convierte esa deriva en un fallo de test la primera vez que ocurre.
//
// LOS UMBRALES SON EL RECUENTO MEDIDO MÁS UN MARGEN CORTO. No son un objetivo
// («bajar de 30»): son una barandilla contra la subida. Bajarlos cuando un
// cambio deje el texto más limpio es correcto; subirlos exige que quien lo
// haga escriba por qué esa negación es MECANISMO y no una prohibición al
// modelo — que es la distinción que esta reescritura tuvo que hacer una por
// una.
//
// QUÉ CUENTA COMO NEGACIÓN, y por qué no cuenta todo lo demás:
//   - Se cuentan las cuatro palabras del criterio de #99: `not`, `never`,
//     `cannot`, `no`.
//   - Se descuentan DOS literales que no son prosa: `no-aplica`, que es un
//     miembro del enum `RUBRIC_OUTCOMES` que el juez tiene que escribir con
//     esa ortografía exacta, y `No TDD`, que es el marcador literal de la
//     línea `**TDD:**` del plan. Contarlos obligaría a elegir entre el umbral
//     y el contrato.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderKickoff } from '../scripts/kickoff.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

class ConteoDeNegaciones {
  // Literales de contrato: se descuentan antes de contar (ver cabecera).
  static LITERALES_DE_CONTRATO = [/no-aplica/g, /No TDD/g]

  static PALABRAS_INGLESAS = /\b(not|never|cannot|no)\b/gi

  static PALABRAS_CASTELLANAS = /\b(no|nunca|jamás|tampoco)\b/gi

  static #sinLiterales(texto) {
    let limpio = texto
    for (const literal of ConteoDeNegaciones.LITERALES_DE_CONTRATO) limpio = limpio.replace(literal, ' ')
    return limpio
  }

  static enIngles(texto) {
    return (ConteoDeNegaciones.#sinLiterales(texto).match(ConteoDeNegaciones.PALABRAS_INGLESAS) || []).length
  }

  static enCastellano(texto) {
    return (ConteoDeNegaciones.#sinLiterales(texto).match(ConteoDeNegaciones.PALABRAS_CASTELLANAS) || []).length
  }

  static enMayusculas(texto) {
    return (texto.match(/\b(NO|NUNCA|JAMÁS)\b/g) || []).length
  }
}

// El slice de referencia: uno que declara TODO lo que el kickoff sabe
// renderizar —señal, recorridos e2e, addendum de tipo— para que el conteo
// mida el kickoff más largo que el dispatcher puede llegar a teclear, y no
// una versión corta que esconda las líneas condicionales.
class SliceDeReferencia {
  static conTodoDeclarado() {
    return {
      n: 42,
      name: 'card de resumen',
      ac: ['AC1', 'AC2'],
      type: 'backend',
      senal: 'métrica ct_cards_rendered',
      e2eRuns: ['comprar una cesta'],
      epic: 'epic-1',
    }
  }

  static opciones() {
    return {
      repo: 'o/r',
      dispatchCheckPath: '/x/dispatch-check.mjs',
      ctStepPath: '/x/ct-step.mjs',
      conventionsDir: '/x/plugin/conventions',
      base: 'main',
    }
  }
}

const leer = (...partes) => readFileSync(join(ROOT, ...partes), 'utf8')

// Los umbrales, en un solo sitio, con el recuento del día en que se midieron.
// La columna «medido» es documentación: lo que rompe el test es el umbral.
const UMBRALES = [
  ['agents/ct-judge.md', ['agents', 'ct-judge.md'], 50], // medido: 40 (antes de #99: 151)
  ['agents/ct-slice-judge.md', ['agents', 'ct-slice-judge.md'], 40], // medido: 29 (antes: 88)
  ['prompts/task-implementer.md', ['prompts', 'task-implementer.md'], 25], // medido: 17 (antes: 56)
]

describe('#99 — los textos del juez y del implementador describen el objetivo', () => {
  it.each(UMBRALES)('%s se queda por debajo de su umbral de negaciones', (_, partes, umbral) => {
    expect(ConteoDeNegaciones.enIngles(leer(...partes))).toBeLessThanOrEqual(umbral)
  })

  // La reescritura conserva a propósito las negaciones que son MECANISMO, y
  // este test las nombra para que nadie las tome por deriva y las borre: el
  // campo que el programa escribe, y los dos ítems cuyo vocabulario está
  // cerrado por el esquema.
  it('las negaciones que son mecanismo siguen en pie', () => {
    const juez = leer('agents', 'ct-judge.md')
    expect(juez).toContain('There is no `review_token` for you to write')
    expect(juez).toContain('never `sin-vara`')
    expect(juez).toMatch(/never reports `medium`/)
    expect(leer('agents', 'ct-slice-judge.md')).toContain('There is no `review_token` for you to write')
  })
})

describe('#99 — el kickoff es una secuencia de lo que se hace', () => {
  const kickoff = () => renderKickoff(SliceDeReferencia.conTodoDeclarado(), SliceDeReferencia.opciones())

  // El criterio literal de #99. Las mayúsculas eran el énfasis con el que el
  // kickoff gritaba sus prohibiciones —«NO mergees», «NO crees worktrees», «NO
  // está en este kickoff»— y son también lo que más pesa en el bleedthrough.
  it('ninguna negación en mayúsculas, ni en las líneas de gate', () => {
    expect(ConteoDeNegaciones.enMayusculas(kickoff())).toBe(0)
  })

  it('el kickoff entero se queda por debajo de su umbral de negaciones', () => {
    // medido: 19 (el kickoff más largo, con señal, e2e y los cuatro gates).
    expect(ConteoDeNegaciones.enCastellano(kickoff())).toBeLessThanOrEqual(25)
  })

  // Lo que el kickoff dice AHORA en el sitio donde antes prohibía: la
  // secuencia la dicta la máquina, y cada acto tiene dueño.
  it('la secuencia la dicta ct-step y cada acto dice de quién es', () => {
    const k = kickoff()
    expect(k).toMatch(/la secuencia de la implementación la dicta la máquina/)
    expect(k).toMatch(/quien comitea es ct-step/)
    expect(k).toMatch(/el merge del PR y el arranque del siguiente slice son de la sesión coordinadora/)
  })
})
