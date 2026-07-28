// Lógica pura de scripts/conventions.js. Los tests de caja negra
// (conventions.test.js, ct-next-conventions.test.js) cubren el caso real de
// punta a punta; estos cubren los bordes que allí no se ven, y en particular
// los DOS errores que esta detección no se puede permitir de forma distinta:
// un falso positivo cuesta una línea de lectura, un falso negativo cuesta un
// deadlock. Por eso hay tests de las dos direcciones, y por eso el umbral se
// inclina siempre hacia avisar.
import { describe, it, expect } from 'vitest'
import { detectConventions, formatFindings, CONTRACT_MARKER_OPEN, CONTRACT_MARKER_CLOSE } from '../scripts/conventions.js'

const ids = (r) => r.map((f) => f.id).sort()
const doc = (content, path = 'AGENTS.md') => ({ path, content })

describe('detectConventions — claim', () => {
  it('un script propio del repo basta, aunque no haya ninguna instrucción escrita', () => {
    const r = detectConventions({ docs: [], files: ['scripts/dispatch-check.sh'] })
    expect(ids(r)).toEqual(['claim'])
  })

  it('una instrucción escrita basta, aunque el script no aparezca en el árbol', () => {
    const r = detectConventions({ docs: [doc('- claim: `bin/dispatch-check <issue>`')], files: [] })
    expect(ids(r)).toEqual(['claim'])
  })

  it('la evidencia documental va PRIMERO: es la orden que el agente despachado obedecerá', () => {
    const r = detectConventions({
      docs: [doc('# A\n- corre `scripts/dispatch-check.sh 42`')],
      files: ['scripts/dispatch-check.sh', 'scripts/tests/dispatch-check.test.sh'],
    })
    expect(r[0].evidence[0].path).toBe('AGENTS.md')
    expect(r[0].evidence[0].line).toBe(2)
  })

  it('un repo sin nada de esto no produce ningún finding', () => {
    const r = detectConventions({ docs: [doc('# A\n## Setup\n- npm ci')], files: ['src/index.js', 'README.md'] })
    expect(r).toEqual([])
  })
})

describe('detectConventions — worktrees', () => {
  it('`git worktree add` con la ruta del loop NO avisa, esté la ruta antes o después de los flags', () => {
    expect(detectConventions({ docs: [doc('git worktree add .worktrees/9 -b feat/9 main')], files: [] })).toEqual([])
    expect(detectConventions({ docs: [doc('git worktree add -b feat/9 .worktrees/9 main')], files: [] })).toEqual([])
  })

  it('`git worktree add` con otra ruta SÍ avisa', () => {
    const r = detectConventions({ docs: [doc('git worktree add .claude/worktrees/<slug> -b <rama> main')], files: [] })
    expect(ids(r)).toEqual(['worktrees'])
  })

  it('un directorio de worktrees propio avisa aunque esté vacío (no hace falta descender a él)', () => {
    const r = detectConventions({ docs: [], files: ['.claude/worktrees/'] })
    expect(ids(r)).toEqual(['worktrees'])
  })

  it('el directorio del PROPIO loop (`.worktrees/`) no es una convención ajena', () => {
    expect(detectConventions({ docs: [], files: ['.worktrees/', '.worktrees/7/README.md'] })).toEqual([])
  })

  it('un hook con "worktree"/"branch" en el nombre avisa: es quien puede tumbar cada despacho', () => {
    const r = detectConventions({ docs: [], files: ['.claude/hooks/menoplus-branch-isolation-guard.sh'] })
    expect(ids(r)).toEqual(['worktrees'])
    // Un hook cualquiera, en cambio, no dice nada del terreno del loop.
    expect(detectConventions({ docs: [], files: ['.claude/hooks/docker-guard.sh'] })).toEqual([])
  })
})

describe('detectConventions — estado', () => {
  it('un STATE.md fuera de .agent/ avisa; el del loop no', () => {
    expect(ids(detectConventions({ docs: [], files: ['docs/STATE.md'] }))).toEqual(['estado'])
    expect(detectConventions({ docs: [], files: ['.agent/STATE.md'] })).toEqual([])
  })
})

describe('detectConventions — el bloque que siembra ct-init no cuenta como convención ajena', () => {
  const own = [
    CONTRACT_MARKER_OPEN,
    '- el claim lo hace `dispatch-check` del plugin',
    '- cada slice va a `.worktrees/<n>`',
    CONTRACT_MARKER_CLOSE,
  ].join('\n')

  it('se poda: si no, la segunda corrida de ct-init se denunciaría a sí misma', () => {
    expect(detectConventions({ docs: [doc(`# A\n${own}\n`)], files: [] })).toEqual([])
  })

  // F14: la instrucción de estos dos fixtures es una INVOCACIÓN
  // (`./scripts/dispatch-check.sh <issue#>`), no la simple mención del nombre
  // del script. Lo que estos tests prueban es la PODA del bloque propio, no la
  // gramática de la regla de claim; con una mención suelta probarían las dos
  // cosas a la vez y el fallo de una sería indistinguible del de la otra.
  it('lo que hay FUERA del bloque sigue contando, y su número de línea es el del fichero real', () => {
    const content = `# A\n${own}\n- claim propio: \`./scripts/dispatch-check.sh <issue#>\`\n`
    const r = detectConventions({ docs: [doc(content)], files: [] })
    expect(ids(r)).toEqual(['claim'])
    // El bloque ocupa las líneas 2..5; la instrucción está en la 6 del fichero
    // ORIGINAL. Citar la línea del texto podado mandaría al humano al sitio
    // equivocado, que es peor que no citar nada.
    expect(r[0].evidence[0].line).toBe(6)
    expect(content.split('\n')[5]).toContain('dispatch-check.sh')
  })

  it('un bloque ABIERTO y sin cerrar no se poda: mejor autodenunciarse que tragarse el resto del fichero', () => {
    // Caso real: ct-init tiene un guardián dedicado a los rastros parciales.
    // Podar "desde la apertura hasta el final" escondería todas las
    // convenciones que vinieran después — un falso negativo, el error caro.
    const content = `# A\n${CONTRACT_MARKER_OPEN}\n- bla\n- claim propio: \`./scripts/dispatch-check.sh <issue#>\`\n`
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['claim'])
  })

  it('CRLF: los marcadores se reconocen igual (un AGENTS.md editado en Windows no rompe la poda)', () => {
    const crlf = `# A\n${own}\n`.split('\n').join('\r\n')
    expect(detectConventions({ docs: [doc(crlf)], files: [] })).toEqual([])
  })
})

describe('formatFindings', () => {
  it('sin findings no imprime NADA (una cadena vacía, no un "todo bien")', () => {
    expect(formatFindings([])).toBe('')
  })

  it('trunca la lista de evidencias pero dice cuántas se ha dejado', () => {
    const files = Array.from({ length: 9 }, (_, i) => `pkg${i}/dispatch-check.sh`)
    const text = formatFindings(detectConventions({ docs: [], files }))
    expect(text).toContain('(+3 más)')
  })

  it('cada finding trae la decisión que hay que tomar, no solo el hallazgo', () => {
    const text = formatFindings(detectConventions({ docs: [], files: ['scripts/dispatch-check.sh'] }))
    expect(text).toMatch(/decisión:/)
    expect(text).toMatch(/Decide cuál manda/)
  })
})
