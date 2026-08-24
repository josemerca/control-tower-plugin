// El "go" del gate `plan`, leído por una máquina (scripts/go-response.js).
//
// Hasta ahora el «ok» que el humano escribía en el issue no lo leía nadie: el
// gate se cerraba de verdad cuando esa persona iba a la ventana de cmux y
// empujaba la sesión a mano. Este módulo es la mitad que decide; la que habla
// con `gh` y con `cmux` es scripts/ct-watch-go.mjs.
import { describe, it, expect } from 'vitest'
import { hasGo, commentIds, GO_TOKEN } from '../scripts/go-response.js'

const comentario = (id, body) => ({ id, body })

describe('el token', () => {
  it('es `-OK`, y se exporta para que no se teclee en cuatro sitios', () => {
    // Lo nombran el que lo busca, los dos textos del gate y estos tests. Es el
    // desacople que este repo ya pagó tres veces, y aquí sería mudo.
    expect(GO_TOKEN).toBe('-OK')
  })
})

describe('qué cuenta como go', () => {
  const nuevo = (body) => hasGo([comentario('IC_nuevo', body)], new Set())

  it('un comentario que es exactamente el token', () => {
    expect(nuevo(GO_TOKEN)).toBe(true)
  })

  it('con espacios o saltos alrededor sigue contando: eso lo pone el editor, no la persona', () => {
    expect(nuevo(`  ${GO_TOKEN}\n`)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // EL MODO DE FALLO NO ES SIMÉTRICO, y es todo el argumento de la
  // coincidencia exacta. Un token no reconocido te deja esperando y lo notas.
  // Un token reconocido de más ARRANCA EL TRABAJO — y «-OK pero cambia el
  // nombre» arrancaría justo lo que la persona quería frenar.
  // -------------------------------------------------------------------------
  it('el token con algo detrás NO es un go: ante la duda no se arranca', () => {
    expect(nuevo('-OK pero cambia el nombre')).toBe(false)
  })

  it('un comentario que sólo contiene el token dentro de una frase tampoco', () => {
    expect(nuevo('me parece -OK')).toBe(false)
  })

  it('prosa normal no es un go, y no hay tercera categoría que aprender', () => {
    expect(nuevo('ok, adelante')).toBe(false)
    expect(nuevo('lgtm')).toBe(false)
  })

  it('un cuerpo que no es texto no revienta ni cuenta', () => {
    expect(hasGo([{ id: 'IC_x', body: null }, { id: 'IC_y' }], new Set())).toBe(false)
  })

  it('sin comentarios no hay go', () => {
    expect(hasGo([], new Set())).toBe(false)
    expect(hasGo(null, new Set())).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LA VENTANA. Su razón de ser: un `-OK` de un despacho ANTERIOR del mismo issue
// no puede arrancar nada. Sin ella, redespachar un slice cuyo issue ya llevaba
// un go heredaría ese go y el gate se saltaría EN SILENCIO — el peor de los
// fallos posibles aquí.
//
// Y es por IDENTIFICADOR, no por fecha, porque la primera versión cortaba por
// tiempo y estaba rota: `createdAt` lo pone el servidor de GitHub y el corte lo
// ponía `Date.now()` de la máquina. Dos relojes. Con el local atrasado, un go
// heredado entraba en la ventana; con el local adelantado, un go legítimo
// quedaba fuera para siempre. Lo cazó una revisión adversarial.
// ---------------------------------------------------------------------------
describe('la ventana: sólo lo que no estaba en la foto inicial', () => {
  it('un go que ya estaba no arranca nada', () => {
    const viejos = [comentario('IC_viejo', GO_TOKEN)]
    expect(hasGo(viejos, commentIds(viejos))).toBe(false)
  })

  it('y uno nuevo sí, con el viejo delante', () => {
    const viejos = [comentario('IC_viejo', GO_TOKEN)]
    const ahora = [...viejos, comentario('IC_nuevo', GO_TOKEN)]
    expect(hasGo(ahora, commentIds(viejos))).toBe(true)
  })

  it('no interviene ningún reloj: el mismo comentario decide igual con cualquier fecha', () => {
    // La regresión que este test impide es volver a cortar por tiempo. Los dos
    // comentarios llevan fechas absurdas en direcciones opuestas y no cambia
    // nada, porque nadie las mira.
    const viejos = [{ id: 'IC_viejo', body: GO_TOKEN, createdAt: '2099-01-01T00:00:00Z' }]
    const ahora = [...viejos, { id: 'IC_nuevo', body: GO_TOKEN, createdAt: '1999-01-01T00:00:00Z' }]
    expect(hasGo(ahora, commentIds(viejos))).toBe(true)
    expect(hasGo(viejos, commentIds(viejos))).toBe(false)
  })

  it('acepta la foto como lista además de como conjunto', () => {
    expect(hasGo([comentario('IC_a', GO_TOKEN)], ['IC_a'])).toBe(false)
  })
})

describe('la foto inicial', () => {
  it('son los identificadores de lo que ya había', () => {
    expect(commentIds([comentario('IC_a', 'x'), comentario('IC_b', 'y')])).toEqual(new Set(['IC_a', 'IC_b']))
  })

  it('un comentario sin identificador legible NO entra en la foto', () => {
    // Así, si apareciera luego, contaría como nuevo. Es el lado prudente: el
    // coste de contarlo de más es esperar (el token tiene que ser exacto de
    // todas formas); el de contarlo de menos sería honrar un go viejo.
    expect(commentIds([{ body: 'x' }, { id: '', body: 'y' }, { id: 42, body: 'z' }])).toEqual(new Set())
  })

  it('sin comentarios la foto está vacía', () => {
    expect(commentIds(null)).toEqual(new Set())
    expect(commentIds([])).toEqual(new Set())
  })
})
