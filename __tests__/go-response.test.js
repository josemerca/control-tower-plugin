// El "go" del gate `plan`, leído por una máquina (scripts/go-response.js).
//
// Hasta ahora el «ok» que el humano escribía en el issue no lo leía nadie: el
// gate se cerraba de verdad cuando esa persona iba a la ventana de cmux y
// empujaba la sesión a mano. Este módulo es la mitad que decide; la que habla
// con `gh` y con `cmux` es scripts/ct-watch-go.mjs.
import { describe, it, expect } from 'vitest'
import { hasGo, commentIds, GO_TOKEN, matchesGo, goBody, goCommitment, newGoNonce } from '../scripts/go-response.js'

const comentario = (id, body) => ({ id, body })

// F38 — el go ya no es una constante: es `-OK <nonce>`, con un nonce por
// despacho que el agente no puede adivinar. Estos tests fijan el nonce (el azar
// lo pone quien llama, justo para esto) y el `GO` de abajo es el cuerpo exacto
// que una persona teclearía.
const NONCE = newGoNonce(Buffer.from([0x3f, 0x9a, 0x1c, 0x04]))
const HASH = goCommitment(NONCE)
const GO = goBody(NONCE)

describe('el token', () => {
  it('es `-OK`, y se exporta para que no se teclee en cuatro sitios', () => {
    // Lo nombran el que lo busca, los dos textos del gate y estos tests. Es el
    // desacople que este repo ya pagó tres veces, y aquí sería mudo.
    expect(GO_TOKEN).toBe('-OK')
  })
})

describe('qué cuenta como go', () => {
  const nuevo = (body) => hasGo([comentario('IC_nuevo', body)], new Set(), HASH)

  it('un comentario que es exactamente el token y el nonce de este despacho', () => {
    expect(nuevo(GO)).toBe(true)
  })

  it('con espacios o saltos alrededor sigue contando: eso lo pone el editor, no la persona', () => {
    expect(nuevo(`  ${GO}\n`)).toBe(true)
  })

  it('el nonce en mayúsculas cuenta: es hex reteclado de una pantalla', () => {
    // No abre nada de más —sigue haciendo falta el nonce— y evita el peor rato
    // posible, que es teclear el permiso correcto y que no pase nada.
    expect(nuevo(`${GO_TOKEN} ${NONCE.toUpperCase()}`)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // F38 — EL TOKEN DESNUDO YA NO ES UN GO. Es el corazón de la ronda: un `-OK`
  // sin nonce lo puede escribir el propio agente con `gh` en un comando, dentro
  // de su repertorio normal y con una traza indistinguible de la legítima.
  // -------------------------------------------------------------------------
  it('el token DESNUDO no es un go: es lo único que el agente sabría escribir', () => {
    expect(nuevo(GO_TOKEN)).toBe(false)
  })

  it('otro nonce tampoco, ni uno de otro despacho', () => {
    expect(nuevo(`${GO_TOKEN} deadbeef`)).toBe(false)
    expect(nuevo(goBody(newGoNonce(Buffer.from([1, 2, 3, 4]))))).toBe(false)
  })

  it('sin compromiso NADA cuenta, ni el go correcto: no hay camino de vuelta al token fijo', () => {
    // Un fallback al `-OK` de ayer sería una puerta que se abre OMITIENDO un
    // argumento (o borrando un fichero), o sea justo lo que esta ronda quita
    // del repertorio del agente.
    expect(hasGo([comentario('IC_nuevo', GO)], new Set())).toBe(false)
    expect(hasGo([comentario('IC_nuevo', GO)], new Set(), '')).toBe(false)
    expect(hasGo([comentario('IC_nuevo', GO)], new Set(), 'no-es-un-sha')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // EL MODO DE FALLO NO ES SIMÉTRICO, y es todo el argumento de la
  // coincidencia exacta. Un token no reconocido te deja esperando y lo notas.
  // Un token reconocido de más ARRANCA EL TRABAJO — y «-OK pero cambia el
  // nombre» arrancaría justo lo que la persona quería frenar.
  // -------------------------------------------------------------------------
  it('el go con algo detrás NO es un go: ante la duda no se arranca', () => {
    expect(nuevo(`${GO} pero cambia el nombre`)).toBe(false)
    expect(nuevo('-OK pero cambia el nombre')).toBe(false)
  })

  it('un comentario que sólo contiene el go dentro de una frase tampoco', () => {
    expect(nuevo(`me parece ${GO}`)).toBe(false)
  })

  it('prosa normal no es un go, y no hay tercera categoría que aprender', () => {
    expect(nuevo('ok, adelante')).toBe(false)
    expect(nuevo('lgtm')).toBe(false)
  })

  it('un cuerpo que no es texto no revienta ni cuenta', () => {
    expect(hasGo([{ id: 'IC_x', body: null }, { id: 'IC_y' }], new Set(), HASH)).toBe(false)
  })

  it('sin comentarios no hay go', () => {
    expect(hasGo([], new Set(), HASH)).toBe(false)
    expect(hasGo(null, new Set(), HASH)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// EL COMPROMISO. Lo que se guarda en cualquier sitio que el agente pueda leer
// —el argv del vigilante, que `ps` enseña; el registro en disco; el mensaje de
// la puerta 9— es el sha256 del nonce, nunca el nonce. Un hash ahí no le sirve
// de nada a quien lo lee.
// ---------------------------------------------------------------------------
describe('el compromiso', () => {
  it('es un sha256 hex y no contiene el nonce', () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/)
    expect(HASH).not.toContain(NONCE)
  })

  it('no depende de la caja del nonce, porque el matcher tampoco', () => {
    expect(goCommitment(NONCE.toUpperCase())).toBe(HASH)
  })

  it('el nonce son 8 caracteres hex —32 bits— a partir de los bytes que da quien llama', () => {
    // 4 hex serían 65.536 intentos, y «65.536 intentos no se pueden esconder»
    // es una apuesta a que alguien esté mirando el issue, no una barandilla.
    expect(NONCE).toBe('3f9a1c04')
    expect(GO).toBe('-OK 3f9a1c04')
  })

  it('matchesGo es la MISMA función para el vigilante y para --release', () => {
    // Dos expresiones distintas para lo mismo darían el peor síntoma posible:
    // el trabajo arranca con un go que luego no libera.
    expect(matchesGo(GO, HASH)).toBe(true)
    expect(matchesGo(GO_TOKEN, HASH)).toBe(false)
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
    const viejos = [comentario('IC_viejo', GO)]
    expect(hasGo(viejos, commentIds(viejos), HASH)).toBe(false)
  })

  it('y uno nuevo sí, con el viejo delante', () => {
    const viejos = [comentario('IC_viejo', GO)]
    const ahora = [...viejos, comentario('IC_nuevo', GO)]
    expect(hasGo(ahora, commentIds(viejos), HASH)).toBe(true)
  })

  it('no interviene ningún reloj: el mismo comentario decide igual con cualquier fecha', () => {
    // La regresión que este test impide es volver a cortar por tiempo. Los dos
    // comentarios llevan fechas absurdas en direcciones opuestas y no cambia
    // nada, porque nadie las mira.
    const viejos = [{ id: 'IC_viejo', body: GO, createdAt: '2099-01-01T00:00:00Z' }]
    const ahora = [...viejos, { id: 'IC_nuevo', body: GO, createdAt: '1999-01-01T00:00:00Z' }]
    expect(hasGo(ahora, commentIds(viejos), HASH)).toBe(true)
    expect(hasGo(viejos, commentIds(viejos), HASH)).toBe(false)
  })

  it('acepta la foto como lista además de como conjunto', () => {
    expect(hasGo([comentario('IC_a', GO)], ['IC_a'], HASH)).toBe(false)
  })

  // F38 — LA VENTANA YA NO ES LA ÚNICA QUE SOSTIENE ESTO. Un go de un despacho
  // anterior lleva OTRO nonce, así que no encaja ni sin ventana — que es
  // exactamente por lo que `--release` puede mirar el issue entero.
  it('un go heredado de otro despacho no encaja ni mirando todo el issue', () => {
    const otroDespacho = goBody(newGoNonce(Buffer.from([9, 9, 9, 9])))
    expect(hasGo([comentario('IC_viejo', otroDespacho)], new Set(), HASH)).toBe(false)
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
