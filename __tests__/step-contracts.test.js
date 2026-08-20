// Lo que cruza la frontera entre la sesión y sus subagentes
// (scripts/step-contracts.js): qué se acepta como respuesta y qué escribe el
// plugin.
//
// El argv de `claude -p` ya no está: se fue con el conductor-programa (D-4
// aplazada). Lo que queda es el esquema, que con un subagente al otro lado
// importa MÁS y no menos — antes lo imponía el binario, ahora lo impone esta
// validación.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readVerdict, readReport, outcomeOfVerdict, commitMessage,
  VERDICT_SCHEMA, REPORT_SCHEMA, IMPLEMENTER_TOOLS, JUDGE_TOOLS, VERDICT_RULES,
  PACKAGE_SECTIONS,
} from '../scripts/step-contracts.js'

const AGENTE_JUEZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-judge.md')
// La línea `tools:` del frontmatter, que es la que decide de verdad qué puede
// hacer el juez. La constante del módulo es una copia suya.
const toolsDelAgente = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(AGENTE_JUEZ, 'utf8'))
  return m ? m[1].trim() : null
}

// Los ocho encabezados de la rúbrica — "### 1. `objetivo` — ..." — en el
// orden en que el agente los recorre. VERDICT_RULES es una copia suya: este
// repo ya sufrió el mismo desacople con JUDGE_TOOLS (divergió del frontmatter
// del agente y la constante se quedó atrás), y aquí el riesgo es peor porque
// no hay ningún error de esquema que lo delate — un `rule` renombrado en el
// código no rompe ct-judge.md, sólo hace que TODO veredicto que use ese `rule`
// se descarte en tiempo de ejecución hasta que el run se agota.
const reglasDelAgente = () => {
  const texto = readFileSync(AGENTE_JUEZ, 'utf8')
  const regex = /^### \d+\.\s+`([a-z-]+)`/gm
  const reglas = []
  let m
  while ((m = regex.exec(texto)) !== null) reglas.push(m[1])
  return reglas
}

// El esquema que la rúbrica le ENSEÑA al juez: el bloque ```json de "What you
// write", que es lo único que el agente lee para saber qué forma tiene el
// fichero que escribe. Si el validador exige un campo que ese bloque no
// muestra, el juez no puede acertar ni por casualidad y cada veredicto se
// descarta hasta que el run se agota — el mismo desacople de JUDGE_TOOLS y
// VERDICT_RULES, con la factura pagada en round trips.
const esquemaDelAgente = () => {
  const texto = readFileSync(AGENTE_JUEZ, 'utf8')
  const m = /## What you write[\s\S]*?```json\n([\s\S]*?)```/.exec(texto)
  return m ? m[1] : ''
}

// El paseo por la rúbrica tal y como el esquema lo exige: los ocho ítems, cada
// uno exactamente una vez, cada uno con lo que dio. Se construye desde
// VERDICT_RULES y no desde una lista a mano por la misma razón por la que el
// esquema tampoco duplica la lista: dos copias de los ocho identificadores
// divergen, y el test que las ataba dejaría de mirar los ocho.
const recorridoCompleto = () => VERDICT_RULES.map((rule) => ({ rule, result: 'sin hallazgos' }))

// Los encabezados del paquete de revisión que cita el párrafo "The review
// package." de "What you are given" — el único sitio de la rúbrica que habla
// del paquete que escribe `escribirPaquete`. Se aísla ese párrafo antes de
// buscar, porque el resto del fichero también cita encabezados entre
// comillas invertidas (los del BRIEF: `## 2. Closed decisions`, `### Out of
// scope`...) y esos no son de este paquete. Los espacios se normalizan porque
// el ajuste de línea de Markdown puede partir una comilla invertida en dos
// líneas del fichero sin partir el texto que representa. El párrafo nombra
// cada encabezado al presentarlo y puede volver a nombrarlo después (para
// explicar de dónde sale la lista); una repetición no añade una segunda
// entrada, sólo cuenta la primera mención de cada uno.
const seccionesDelPaquete = () => {
  const texto = readFileSync(AGENTE_JUEZ, 'utf8')
  const parrafo = /- \*\*The review package\.\*\*([\s\S]*?)\n- \*\*The task brief/.exec(texto)
  if (!parrafo) return []
  const normalizado = parrafo[1].replace(/\s+/g, ' ')
  const regex = /`## ([^`]+)`/g
  const secciones = []
  let m
  while ((m = regex.exec(normalizado)) !== null) {
    const seccion = m[1].trim()
    if (!secciones.includes(seccion)) secciones.push(seccion)
  }
  return secciones
}

describe('quién puede qué', () => {
  it('el juez no tiene shell, y quien se lo quita es la declaración del agente', () => {
    // Antes se lo quitaba el binario con --tools; ahora lo declara
    // agents/ct-judge.md. La propiedad es la misma: estructural, no una promesa
    // dentro del prompt. Por eso se mira el FICHERO y no sólo la constante.
    expect(toolsDelAgente()).not.toMatch(/Bash|Edit/)
    expect(JUDGE_TOOLS).not.toMatch(/Bash|Edit/)
    expect(IMPLEMENTER_TOOLS).toMatch(/Bash/)
  })

  it('la constante no puede divergir del agente que se despacha', () => {
    // Divergieron: al darle `Write` al juez —sin él no puede entregar su
    // veredicto y el paso no cierra nunca— la constante se quedó atrás, y
    // `ct-step next` pasó a anunciar unas herramientas que no eran las del juez
    // real. Un módulo puro no puede leer el fichero, así que lo que impide que
    // vuelva a pasar es este test y no el código.
    expect(JUDGE_TOOLS).toBe(toolsDelAgente())
  })

  it('el juez puede escribir su veredicto: es el canal por el que contesta', () => {
    expect(toolsDelAgente()).toMatch(/Write/)
  })

  it('el implementador puede cargar skills: sin ella no puede seguir su propia rúbrica', () => {
    expect(IMPLEMENTER_TOOLS).toMatch(/\bSkill\b/)
  })

  it('VERDICT_RULES no puede divergir de los ocho encabezados de la rúbrica', () => {
    // Renombrar una regla en el código sin tocar el agente (o al revés) no
    // rompe ningún esquema: sólo hace que un veredicto con ese `rule` se
    // descarte en cada ejecución. Este test es lo que lo convierte en un
    // fallo de test en vez de en un fallo silencioso en producción.
    expect(VERDICT_RULES).toEqual(reglasDelAgente())
  })

  it('la rúbrica le enseña al juez el campo del recorrido en vez de pedírselo en prosa', () => {
    // El paseo por los ocho ítems se pedía en prosa, al final del fichero, y
    // se pedía para la RESPUESTA del subagente — que no se persiste. Ahora es
    // un campo del veredicto, así que el bloque que el juez copia tiene que
    // mostrarlo: un validador que exige lo que el agente no ve descarta todos
    // los veredictos de la corrida sin que ninguno sea culpa del juez.
    expect(esquemaDelAgente()).toMatch(/"rubric"/)
    expect(esquemaDelAgente()).toMatch(/"result"/)
  })

  it('PACKAGE_SECTIONS no puede divergir de los encabezados que la rúbrica cita por su nombre', () => {
    // El mismo fallo que ya tuvieron JUDGE_TOOLS y VERDICT_RULES, con un
    // agravante: aquí ni siquiera hay un esquema que descarte nada. Si
    // `escribirPaquete` renombra un encabezado sin tocar la rúbrica, el juez
    // sigue recibiendo instrucciones para leer una sección que no existe, y
    // nada se entera salvo este test.
    expect(PACKAGE_SECTIONS).toEqual(seccionesDelPaquete())
  })
})

describe('el veredicto', () => {
  const v = (ruling, findings = [], rubric = recorridoCompleto()) => readVerdict({ ruling, rubric, findings })

  it('un PASA limpio se lee y vale', () => {
    expect(v('PASS').verdict).toEqual({ ruling: 'PASS', rubric: recorridoCompleto(), findings: [] })
  })

  it.each([
    ['sin structured_output', null, /no devolvió structured_output/],
    ['con un ruling inventado', { ruling: 'MAYBE', findings: [] }, /ruling desconocido/],
    ['con findings que no es lista', { ruling: 'PASS', findings: 'ninguno' }, /no es una lista/],
    ['con una severidad inventada', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'catastrophic', what: 'x', where: 'y' }] }, /severidad desconocida/],
    ['con un hallazgo mudo', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'high', what: '', where: 'y' }] }, /no dice qué o dónde/],
    // Sin fijar este caso, una regresión que cambiara la condición a
    // `f.rule && !VERDICT_RULES.includes(f.rule)` dejaría pasar en silencio
    // un hallazgo sin `rule` — sólo cazaría la regla INVENTADA, no la AUSENTE.
    ['con un hallazgo sin rule', { ruling: 'FAIL', findings: [{ severity: 'high', what: 'x', where: 'y' }] }, /regla desconocida/],
  ])('se descarta %s', (_caso, structured, motivo) => {
    const r = readVerdict(structured)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(motivo)
  })

  it('un PASS con un hallazgo grave se descarta: se contradice a sí mismo', () => {
    // No se interpreta hacia el lado prudente. Un juez que no se entiende a sí
    // mismo no ha juzgado, y volver a preguntar cuesta menos que decidir por él.
    const r = v('PASS', [{ rule: 'contrato', severity: 'high', what: 'sql injection', where: 'db.js:10' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/contradice la rúbrica/)
  })

  it('el hallazgo nombra la regla que incumple', () => {
    const r = v('FAIL', [{ rule: 'manipulacion-tests', severity: 'high', what: 'debilitó una aserción', where: 'a.test.js:12' }])
    expect(r.verdict.findings[0].rule).toBe('manipulacion-tests')
  })

  it('una regla fuera del enum descarta el veredicto', () => {
    // El mismo criterio que ya aplica a un ruling inventado: una regla que no
    // está en VERDICT_RULES no es un hallazgo sin justificar, es un dato que no
    // se entiende — se descarta y se vuelve a preguntar, no es un error.
    const r = v('FAIL', [{ rule: 'me-lo-invento', severity: 'high', what: 'x', where: 'y' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/regla desconocida/)
    expect(VERDICT_RULES).not.toContain('me-lo-invento')
  })

  // -------------------------------------------------------------------------
  // EL PASEO POR LA RÚBRICA, medido en jjponz/rust-monitoring#10: los tres
  // veredictos que viajaron commiteados en aquella pull request eran
  // `{"ruling": "PASS", "findings": []}` — exactamente el artefacto que la
  // propia rúbrica declara indistinguible de ocho ítems que nadie abrió. La
  // rúbrica pedía el paseo, pero lo pedía en PROSA y para la respuesta
  // conversacional del subagente, que no se persiste: nada la capturaba, y el
  // esquema que se validaba y viajaba era sólo `{ruling, findings}`.
  //
  // Y en aquel slice el PASS vacío era el resultado CORRECTO: cuatro de los
  // ocho ítems no tenían sujeto (un esqueleto sobre un repo vacío, sin
  // patrones que citar, sin tests previos, sin contratos). Eso es lo que
  // duele: era correcto y nadie podía saberlo leyendo el fichero. Por eso el
  // recorrido no es un campo informativo — es la diferencia entre "no
  // aplicaba" y "no se miró", y la carga la lleva el esquema, no la prosa.
  // -------------------------------------------------------------------------
  it('el veredicto trae el paseo por los ocho ítems, y viaja dentro de él', () => {
    const r = v('PASS')
    expect(r.verdict.rubric.map((paso) => paso.rule)).toEqual(VERDICT_RULES)
  })

  it('se descarta el veredicto que no trae el recorrido: es el fichero de la corrida de campo', () => {
    // El payload literal de rust-monitoring#10. Hoy se aceptaba; que se
    // descarte es todo el arreglo.
    const r = readVerdict({ ruling: 'PASS', findings: [] })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/recorrido de la rúbrica/)
  })

  it('se descarta un recorrido que nombra un ítem que no es de la rúbrica', () => {
    // Mismo criterio que un `rule` inventado en un hallazgo: un ítem que no
    // está en VERDICT_RULES no es un paseo laxo, es un dato que no se
    // entiende. Se vuelve a preguntar.
    const recorrido = [...recorridoCompleto().slice(1), { rule: 'me-lo-invento', result: 'bien' }]
    const r = v('PASS', [], recorrido)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/ítem desconocido/)
  })

  it('se descarta un recorrido que repite un ítem: nueve pasos no son ocho ítems', () => {
    // Nueve entradas con los ocho identificadores presentes: sin la
    // comprobación de repetidos, un recuento por conjunto daría los ocho por
    // recorridos y el duplicado pasaría. Es el mismo criterio que readReport
    // aplica a una ruta declarada dos veces.
    const r = v('PASS', [], [...recorridoCompleto(), { rule: 'alcance', result: 'otra vez' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/repite/)
  })

  it('se descarta un recorrido incompleto, y el motivo dice qué ítem falta', () => {
    // Sin nombrar el ítem que falta, el descarte cuesta un round trip y el
    // juez no sabe por dónde volver.
    const r = v('PASS', [], recorridoCompleto().filter((paso) => paso.rule !== 'fixture-theater'))
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/fixture-theater/)
  })

  it('se descarta el ítem que se nombra pero no dice lo que dio: un texto vacío es el ítem sin abrir otra vez', () => {
    // Ocho identificadores sin resultado son el mismo artefacto que el PASS
    // con hallazgos vacíos, sólo que más largo.
    const recorrido = recorridoCompleto().map((paso) => (paso.rule === 'patrones' ? { rule: 'patrones', result: '   ' } : paso))
    const r = v('PASS', [], recorrido)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/patrones/)
  })
})

describe('de veredicto a resultado de la tabla', () => {
  const o = (ruling, findings = []) => outcomeOfVerdict({ ruling, findings })

  it('FAIL es un veto', () => {
    expect(o('FAIL', [{ severity: 'high', what: 'x', where: 'y' }])).toBe('failed')
  })

  it('PASS limpio entrega', () => {
    expect(o('PASS')).toBe('done')
  })

  it('PASS con hallazgos sólo de severidad baja entrega igual', () => {
    // Si cada nimiedad volviera al implementador, el bucle no terminaría nunca.
    expect(o('PASS', [{ severity: 'low', what: 'nombre mejorable', where: 'a.js' }])).toBe('done')
  })

  it('PASS con un hallazgo medio es un refunfuño: corrige, pero no bloquea', () => {
    expect(o('PASS', [{ severity: 'medium', what: 'falta un caso', where: 'a.test.js' }])).toBe('corrections-ordered')
  })
})

describe('el informe del implementador', () => {
  it('trae las rutas que tocó, que es lo que el programa stagea', () => {
    const paths = ['src/a.js', 'src/a.test.js']
    expect(readReport({ paths, summary: 'hecho' }).report.paths).toHaveLength(2)
  })

  it.each([
    ['una ruta absoluta', ['/etc/passwd']],
    ['una ruta que se sale del worktree', ['../otro-repo/secreto.txt']],
  ])('rechaza %s: la lista la escribe un modelo, no es un dato de confianza', (_caso, paths) => {
    const r = readReport({ paths, summary: 'hecho' })
    expect(r.report).toBeUndefined()
    expect(r.why).toMatch(/fuera del worktree/)
  })

  it('un informe sin rutas se descarta en vez de commitear el índice a ciegas', () => {
    expect(readReport({ summary: 'ya está' }).why).toMatch(/rutas tocadas/)
  })

  it('rechaza la misma ruta declarada dos veces: es un informe que no se entiende a sí mismo', () => {
    const paths = ['src/a.js', 'src/a.js']
    const r = readReport({ paths, summary: 'hecho' })
    expect(r.report).toBeUndefined()
    expect(r.why).toMatch(/misma ruta/)
  })

  it('el esquema del informe pide rutas y resumen, y nada más', () => {
    expect(REPORT_SCHEMA.required).toEqual(['paths', 'summary'])
    expect(REPORT_SCHEMA.additionalProperties).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// REPORT_SCHEMA y VERDICT_SCHEMA se exportan, pero nada los ejecuta: quien
// valida de verdad es readReport/readVerdict, escritos a mano más arriba en
// step-contracts.js. Sin este test, los dos esquemas pueden divergir del
// validador en silencio — ninguna suite se entera hasta que alguien lee el
// esquema, se cree lo que dice, y descubre que no es lo que se exige.
//
// Lo que SÍ se ata aquí: el REQUIRED que cada esquema declara (en la raíz y
// en cada item de array) es exactamente lo que el validador exige — quitar
// cualquiera de esos campos de un payload por lo demás válido lo descarta.
//
// Lo que NO se ata, y hay que decirlo: los dos esquemas declaran
// `additionalProperties: false`, tanto en el objeto raíz como en cada item de
// paths/findings, y ni readReport ni readVerdict comprueban de verdad que no
// sobre una propiedad — un campo de más pasa hoy sin que ninguno de los dos
// se entere. Cerrar ese hueco es cambiar el validador, no añadir un test, y
// no es parte de este arreglo.
// ---------------------------------------------------------------------------
describe('los esquemas declarados, atados a lo que valida de verdad', () => {
  const informeValido = () => ({
    paths: ['src/a.js'],
    summary: 'hecho',
  })
  const veredictoValido = () => ({
    ruling: 'FAIL',
    rubric: recorridoCompleto(),
    findings: [{ rule: 'contrato', severity: 'high', what: 'x', where: 'y' }],
  })

  it.each(REPORT_SCHEMA.required)('readReport exige "%s", como declara REPORT_SCHEMA.required', (campo) => {
    const payload = informeValido()
    delete payload[campo]
    expect(readReport(payload).report).toBeUndefined()
  })

  it('cada ruta de paths es una cadena, como declara el esquema del item', () => {
    expect(REPORT_SCHEMA.properties.paths.items).toEqual({ type: 'string' })
  })

  it.each(VERDICT_SCHEMA.required)('readVerdict exige "%s", como declara VERDICT_SCHEMA.required', (campo) => {
    const payload = veredictoValido()
    delete payload[campo]
    expect(readVerdict(payload).verdict).toBeUndefined()
  })

  it.each(VERDICT_SCHEMA.properties.findings.items.required)('cada hallazgo exige "%s", como declara el esquema del item', (campo) => {
    const payload = veredictoValido()
    delete payload.findings[0][campo]
    expect(readVerdict(payload).verdict).toBeUndefined()
  })

  it.each(VERDICT_SCHEMA.properties.rubric.items.required)('cada paso del recorrido exige "%s", como declara el esquema del item', (campo) => {
    const payload = veredictoValido()
    delete payload.rubric[0][campo]
    expect(readVerdict(payload).verdict).toBeUndefined()
  })

  it('el esquema del recorrido no duplica los ocho identificadores: los toma de VERDICT_RULES', () => {
    // Identidad y no igualdad a propósito. Una segunda lista con los mismos
    // ocho valores pasaría un toEqual y divergiría en el primer renombrado,
    // que es el fallo que este fichero ya caza dos veces (JUDGE_TOOLS y
    // VERDICT_RULES contra ct-judge.md).
    expect(VERDICT_SCHEMA.properties.rubric.items.properties.rule.enum).toBe(VERDICT_RULES)
  })

  it('el esquema pide el recorrido entero: ni un paso más, ni uno menos', () => {
    expect(VERDICT_SCHEMA.properties.rubric.minItems).toBe(VERDICT_RULES.length)
    expect(VERDICT_SCHEMA.properties.rubric.maxItems).toBe(VERDICT_RULES.length)
  })
})

// ---------------------------------------------------------------------------
// El mensaje de commit. El hook `commit-keyword-guard` es un PreToolUse sobre
// la herramienta Bash de una SESIÓN: un `git commit` lanzado por un programa no
// pasa por esa puerta, así que el programa se mira su propio mensaje.
// ---------------------------------------------------------------------------
describe('el mensaje que compone el programa', () => {
  const msg = (name) => commitMessage({ issue: 42, task: 2, tasksTotal: 8, name })

  it('nombra la tarea, el issue y por dónde va la slice', () => {
    expect(msg('el cliente tipado de la API').split('\n')[0])
      .toBe('el cliente tipado de la API (#42, tarea 2/8)')
  })

  it('NUNCA lleva una closing keyword, aunque el nombre de la tarea la traiga', () => {
    // El nombre viene del plan, o sea de un agente. En F27 un commit de
    // documentación que MENCIONABA "Closes #451" cerró ese issue.
    const m = msg('fixes #451 el parseo del carrito')
    expect(m).not.toMatch(/\bfixes\s*#\d+/i)
    expect(m).toContain('fixes issue 451')
  })

  it.each(['closes #1', 'resolved #99', 'Fixed #7'])('desactiva también "%s"', (nombre) => {
    expect(() => msg(nombre)).not.toThrow()
    expect(msg(nombre)).not.toMatch(/#\d+\b(?!, tarea)/)
  })

  it('el issue del propio slice viaja como referencia, no como orden de cierre', () => {
    expect(msg('una tarea')).toContain('(#42, tarea 2/8)')
  })
})

