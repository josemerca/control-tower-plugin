// El "go" del gate `plan`, leído por una máquina (scripts/go-response.js).
//
// Hasta ahora el «ok» que el humano escribía en el issue no lo leía nadie: el
// gate se cerraba de verdad cuando esa persona iba a la ventana de cmux y
// empujaba la sesión a mano. Este módulo es la mitad que decide; la que habla
// con `gh` y con `cmux` es scripts/ct-watch-go.mjs.
import { describe, it, expect } from 'vitest'
import { hasGo, GO_TOKEN } from '../scripts/go-response.js'

// Reloj fijo: este módulo es puro y no mira la hora, así que los tests no
// pueden depender de la de quien los corre.
const ARRANQUE = Date.parse('2026-08-21T10:00:00Z')
const antes = (min) => new Date(ARRANQUE - min * 60_000).toISOString()
const despues = (min) => new Date(ARRANQUE + min * 60_000).toISOString()
const comentario = (body, createdAt) => ({ body, createdAt })

describe('el token', () => {
  it('es `-OK`, y se exporta para que no se teclee en tres sitios', () => {
    // Lo nombran el que lo busca, el que se lo explica al humano y estos
    // tests. Es el desacople que este repo ya pagó tres veces.
    expect(GO_TOKEN).toBe('-OK')
  })
})

describe('qué cuenta como go', () => {
  it('un comentario que es exactamente el token', () => {
    expect(hasGo([comentario(GO_TOKEN, despues(1))], ARRANQUE)).toBe(true)
  })

  it('con espacios o saltos alrededor sigue contando: eso lo pone el editor, no la persona', () => {
    expect(hasGo([comentario(`  ${GO_TOKEN}\n`, despues(1))], ARRANQUE)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // EL MODO DE FALLO NO ES SIMÉTRICO, y es todo el argumento de la
  // coincidencia exacta. Un token no reconocido te deja esperando y lo notas.
  // Un token reconocido de más ARRANCA EL TRABAJO — y «-OK pero cambia el
  // nombre» arrancaría justo lo que la persona quería frenar.
  // -------------------------------------------------------------------------
  it('el token con algo detrás NO es un go: ante la duda no se arranca', () => {
    expect(hasGo([comentario('-OK pero cambia el nombre', despues(1))], ARRANQUE)).toBe(false)
  })

  it('un comentario que sólo contiene el token dentro de una frase tampoco', () => {
    expect(hasGo([comentario('me parece -OK', despues(1))], ARRANQUE)).toBe(false)
  })

  it('prosa normal no es un go, y no hay tercera categoría que aprender', () => {
    expect(hasGo([comentario('ok, adelante', despues(1))], ARRANQUE)).toBe(false)
    expect(hasGo([comentario('lgtm', despues(1))], ARRANQUE)).toBe(false)
  })

  it('sin comentarios no hay go', () => {
    expect(hasGo([], ARRANQUE)).toBe(false)
    expect(hasGo(null, ARRANQUE)).toBe(false)
  })
})

describe('la ventana: sólo lo posterior al arranque del vigilante', () => {
  // Ésta es la propiedad por la que la ventana existe. Sin ella, redespachar
  // un slice cuyo issue ya llevaba un go heredaría ese go y el gate se
  // saltaría EN SILENCIO — el peor de los fallos posibles aquí.
  it('un go de un despacho anterior no arranca nada', () => {
    expect(hasGo([comentario(GO_TOKEN, antes(120))], ARRANQUE)).toBe(false)
  })

  it('y el nuevo sí, con el viejo delante', () => {
    const comentarios = [comentario(GO_TOKEN, antes(120)), comentario(GO_TOKEN, despues(5))]
    expect(hasGo(comentarios, ARRANQUE)).toBe(true)
  })

  it('un comentario cuya fecha no se puede interpretar no cuenta', () => {
    // Mismo criterio que el resto del loop: ante un dato que no se entiende no
    // se decide por él. Y aquí el lado prudente es obvio, porque no contarlo
    // sólo hace esperar.
    expect(hasGo([comentario(GO_TOKEN, 'ayer por la tarde')], ARRANQUE)).toBe(false)
    expect(hasGo([comentario(GO_TOKEN, undefined)], ARRANQUE)).toBe(false)
  })
})
