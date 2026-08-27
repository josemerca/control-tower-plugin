// La telemetría del conductor (scripts/run-metrics.js y su escritura en
// ct-run.mjs): una fila por intento de un paso de una tarea.
//
// Dos propiedades mandan aquí, y las dos son de las que se rompen en silencio:
// que la identidad esté COMPLETA —un hueco en una métrica se lee como un cero, y
// un cero es una afirmación— y que un fallo al escribirla NO cambie lo que hace
// el run. Un programa que muere porque no pudo escribir su propia métrica ha
// convertido el termómetro en parte del motor.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  metricRow, metricLine, metricsPath, planSha256, verdictMeasures, IDENTITY_FIELDS, aggregateVerdictMeasures,
  metricsRepoRelPath, METRICS_REPO_DIR, citaVaraDeCt, briefVaraCtMeasures, aggregateBriefMeasures,
} from '../scripts/run-metrics.js'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'ct-step.mjs')
const F = '```'
const AHORA = '2026-08-18T10:00:00.000Z'

const IDENT = {
  repo: 'josemerca/control-tower-plugin', epic: '12', issue: 7,
  plan: 'plan.md', plan_sha256: 'abc', task: 2, task_name: 'la segunda',
  tasks_total: 8, step: 'judge', attempt: 3,
  plugin_version: '0.36.1', actor: 'alcaptar',
}

describe('la identidad de la fila', () => {
  it('lleva los doce campos del diseño, ni uno menos', () => {
    const fila = metricRow(IDENT, {}, { now: AHORA })
    expect(IDENTITY_FIELDS).toHaveLength(12)
    for (const campo of IDENTITY_FIELDS) expect(fila).toHaveProperty(campo)
    expect(fila.written_at).toBe(AHORA)
  })

  it('un issue sin milestone se anota "(sin milestone)", nunca vacío', () => {
    for (const vacio of [null, undefined, '']) {
      expect(metricRow({ ...IDENT, epic: vacio }, {}, { now: AHORA }).epic).toBe('(sin milestone)')
    }
  })

  // EL MISMO ARGUMENTO QUE `plan_sha256`, APLICADO AL LOOP EN VEZ DE AL PLAN: un
  // plan se reescribe y entonces dos runs contra dos versiones del mismo fichero
  // son indistinguibles justo donde más se van a mirar. `ct-step` también se
  // reescribe —y se reescribe más que ningún plan—, así que sin la versión del
  // plugin dos runs contra dos loops distintos se comparan como si fueran el
  // mismo mecanismo. La corrida de campo que motiva esto se hizo con 0.36.1: sin
  // el campo, esa cifra sólo existe en la memoria de quien estaba delante.
  it('la versión del plugin viaja en la fila: un ct-step reescrito hace incomparables dos runs', () => {
    expect(metricRow(IDENT, {}, { now: AHORA }).plugin_version).toBe('0.36.1')
    expect(IDENTITY_FIELDS).toContain('plugin_version')
  })

  // HOY DA IGUAL Y VA A DEJAR DE DAR IGUAL. Cada fila vive en el disco de quien
  // la escribió, así que el actor es implícito; en cuanto las filas viajen
  // dentro de la pull request, en un mismo fichero se mezclarán filas de dos
  // máquinas distintas y sin actor no se sabrá de quién es el coste — que es
  // justo el dato por el que se mira este fichero.
  it('el actor viaja en la fila: en cuanto las filas se mezclen, el coste tiene dueño', () => {
    expect(metricRow(IDENT, {}, { now: AHORA }).actor).toBe('alcaptar')
    expect(IDENTITY_FIELDS).toContain('actor')
  })

  // La regla del fichero, aplicada a los dos campos nuevos: la ausencia se
  // DECLARA. Un `null` en una columna por la que se agrupa (¿qué versión?, ¿de
  // quién?) se lee como un valor más y funde en un mismo grupo las filas que no
  // lo traían con las que lo traían vacío. El centinela mantiene el tipo de la
  // columna y dice en voz alta que ahí no había dato, igual que `epic` lleva
  // años diciendo `(sin milestone)`.
  it('sin versión y sin actor se declara la ausencia, no se deja el hueco', () => {
    for (const vacio of [null, undefined, '']) {
      const fila = metricRow({ ...IDENT, plugin_version: vacio, actor: vacio }, {}, { now: AHORA })
      expect(fila.plugin_version).toBe('(sin versión)')
      expect(fila.actor).toBe('(sin actor)')
    }
  })

  // EL MÓDULO SIGUE SIENDO PURO, y estos dos campos son justo los que invitan a
  // romperlo: la versión está en el package.json del plugin y el actor está en
  // el entorno, a una línea de distancia. Si los buscara él, la fila diría quién
  // ESCRIBE la métrica en vez de quién corrió el paso, y el módulo dejaría de
  // ser testeable sin montar un disco.
  it('no va a buscar el actor al entorno: el valor llega DENTRO de la identidad', () => {
    const previo = process.env.USER
    process.env.USER = 'un-actor-del-entorno'
    try {
      const { plugin_version: version, actor } = metricRow({ ...IDENT, plugin_version: null, actor: null }, {}, { now: AHORA })
      expect(actor).toBe('(sin actor)')
      expect(version).toBe('(sin versión)')
    } finally {
      if (previo === undefined) delete process.env.USER
      else process.env.USER = previo
    }
  })

  // `session` SE FUE, y no por limpieza: prometía una dimensión que el mecanismo
  // no puede dar. Con `ct-step` las llamadas al modelo son subagentes de la
  // sesión y no hay identificador de conversación que recoger, así que su único
  // escritor la pasaba `null` a pelo y la columna era nula en TODAS las filas.
  // Una columna siempre nula enseña a saltársela, y la de al lado se salta
  // detrás. Vuelve el día que haya algo que meter dentro.
  it('`session` ya no es un campo: una columna siempre nula enseña a ignorar el fichero', () => {
    expect(IDENTITY_FIELDS).not.toContain('session')
    expect(metricRow({ ...IDENT, session: 'sesion-1' }, {}, { now: AHORA })).not.toHaveProperty('session')
  })

  it('el intento es una dimensión de la fila, no un contador agregado', () => {
    // Es lo que permite medir cuántas veces vetó el juez y cuántas vueltas
    // costó cada tarea, que es el dato que decide si esto merece la pena.
    const vueltas = [1, 2, 3].map((attempt) => metricRow({ ...IDENT, attempt }, {}, { now: AHORA }))
    expect(vueltas.map((f) => f.attempt)).toEqual([1, 2, 3])
  })

  it('las medidas viajan aparte de la identidad y no pueden pisarla', () => {
    const fila = metricRow(IDENT, { cost_usd: 0.03, outcome: 'done' }, { now: AHORA })
    expect(fila.cost_usd).toBe(0.03)
    expect(fila.issue).toBe(7)
  })

  it('cada fila es una línea de JSON, que es lo que hace el fichero append-only', () => {
    const linea = metricLine(metricRow(IDENT, {}, { now: AHORA }))
    expect(linea.endsWith('\n')).toBe(true)
    expect(JSON.parse(linea).step).toBe('judge')
  })
})

describe('el plan se reescribe, y por eso el issue no basta como identidad', () => {
  it('dos versiones del mismo fichero dan hashes distintos', () => {
    expect(planSha256('### Task 1 — a')).not.toBe(planSha256('### Task 1 — b'))
  })

  it('el mismo contenido da el mismo hash, que es lo que permite comparar runs', () => {
    expect(planSha256('igual')).toBe(planSha256('igual'))
  })
})

describe('dónde se escribe', () => {
  it('fuera del repo, para que ningún git add de la slice la meta en la PR', () => {
    const p = metricsPath('ct-step', { home: '/casa' })
    expect(p).toBe('/casa/.claude/control-tower/log/ct-step.jsonl')
  })

  it('bajo CLAUDE_CONFIG_DIR cuando lo hay, que es donde vive el estado de esa cuenta', () => {
    expect(metricsPath('ct-step', { configDir: '/casa/.claude-work' }))
      .toBe('/casa/.claude-work/control-tower/log/ct-step.jsonl')
  })
})

describe('el conteo por severidad', () => {
  it('permite leer cuántos vetos hubo sin volver a cargar los hallazgos', () => {
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'contrato', severity: 'high', what: 'a', path: 'x' },
        { rule: 'alcance', severity: 'low', what: 'b', path: 'y' },
        { rule: 'alcance', severity: 'low', what: 'c', path: 'z' },
      ],
    })).toEqual({
      ruling: 'FAIL', findings_total: 3, findings_high: 1, findings_medium: 0, findings_low: 2,
      findings_by_rule: { contrato: 1, alcance: 2 },
      rubric_sin_vara: 0,
      findings_patrones_vara_ct: 0,
    })
  })

  it('cuenta los ítems que el juez recorrió sin nada con lo que medirlos', () => {
    // La columna que convierte H5 de sospecha en dato. Dos personas mirando
    // veredictos a mano no podían saber si el juez no encontraba nada o si no
    // tenía con qué buscar; un run con esta cifra alta es lo segundo.
    expect(verdictMeasures({
      ruling: 'PASS',
      findings: [],
      rubric: [
        { rule: 'objetivo', result: 'está', outcome: 'conforme' },
        { rule: 'patrones', result: 'el plan dice N/A', outcome: 'sin-vara' },
        { rule: 'manipulacion-tests', result: 'no hay tests previos', outcome: 'no-aplica' },
      ],
    }).rubric_sin_vara).toBe(1)
  })

  it('un veredicto sin recorrido cuenta cero, no revienta', () => {
    // `verdictMeasures` mide, y una medida no puede ser el motivo de que un
    // paso no cierre: es el principio que este módulo ya sostiene con el resto
    // de sus campos.
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).rubric_sin_vara).toBe(0)
  })

  it('un PASA limpio cuenta cero de todo, y lo dice', () => {
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).findings_total).toBe(0)
  })

  it('la telemetría del veredicto cuenta por regla', () => {
    // Un contador por regla PRESENTE en el veredicto, no todas a cero: una
    // regla que no aparece no aporta nada a la cuenta.
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'manipulacion-tests', severity: 'high', what: 'a', path: 'x' },
        { rule: 'manipulacion-tests', severity: 'low', what: 'b', path: 'y' },
        { rule: 'alcance', severity: 'low', what: 'c', path: 'z' },
      ],
    }).findings_by_rule).toEqual({ 'manipulacion-tests': 2, alcance: 1 })
  })
})

// ---------------------------------------------------------------------------
// MEDIDA 1: de qué vara salió el hallazgo. Sólo el ítem `patrones` mide contra
// las varas — un hallazgo de `contrato` o `alcance` no es "de la vara del
// repo" por no citar nada, es de otro ítem. El complemento (los de `patrones`
// que NO citan a ct) no vive aquí: se deriva restando de
// `findings_by_rule.patrones`, que ya existe.
// ---------------------------------------------------------------------------
describe('citaVaraDeCt — la forma de la ruta, no la lista de documentos de hoy', () => {
  it('cita la vara de ct cuando "conventions/<algo>.md" no viene precedida de barra ni de letra', () => {
    expect(citaVaraDeCt('`conventions/architecture.md` dice que la conversión vive en el dominio')).toBe(true)
    expect(citaVaraDeCt('(conventions/code.md) exige inglés')).toBe(true)
    expect(citaVaraDeCt('conventions/code.md al principio de la frase')).toBe(true)
  })

  // LA TRAMPA DEL ENCARGO: `docs/conventions/code.md` es la vara DEL REPO — un
  // sitio típico donde vive `.agent/conventions.md` — y contiene la subcadena
  // `conventions/code.md`. Un `includes` a secas la contaría como ct y mediría
  // justo lo contrario de lo que el campo promete.
  it('NO cuenta docs/conventions/code.md: esa cita es de la vara del REPO, no de ct', () => {
    expect(citaVaraDeCt('el fichero `docs/conventions/code.md` dice que se usa camelCase')).toBe(false)
  })

  it('NO cuenta si "conventions/" viene pegada a una palabra', () => {
    expect(citaVaraDeCt('mis_conventions/code.md no es la vara de ct')).toBe(false)
  })

  it('no depende de los cuatro nombres de hoy: un documento nuevo o renombrado también cuenta', () => {
    expect(citaVaraDeCt('conventions/naming.md dice otra cosa')).toBe(true)
  })

  it('un evidence vacío o ausente no cita nada', () => {
    expect(citaVaraDeCt('')).toBe(false)
    expect(citaVaraDeCt(undefined)).toBe(false)
    expect(citaVaraDeCt(null)).toBe(false)
  })
})

describe('findings_patrones_vara_ct — sólo los hallazgos del ítem patrones', () => {
  it('cuenta sólo los de patrones que citan la vara de ct, no los de otros ítems', () => {
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'patrones', severity: 'high', what: 'a', path: 'x', evidence: 'conventions/code.md dice inglés' },
        { rule: 'patrones', severity: 'low', what: 'b', path: 'y', evidence: 'se lee mal, sin cita' },
        { rule: 'contrato', severity: 'low', what: 'c', path: 'z', evidence: 'conventions/code.md también aquí' },
      ],
    }).findings_patrones_vara_ct).toBe(1)
  })

  // EL FALSO POSITIVO QUE FIJA EL ENCARGO: un hallazgo de `patrones` que cita
  // `docs/conventions/code.md` (la vara del REPO) no debe contar como ct.
  it('un hallazgo de patrones que cita docs/conventions/ NO cuenta como vara de ct', () => {
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'patrones', severity: 'low', what: 'a', path: 'x', evidence: '`docs/conventions/code.md` pide camelCase' },
      ],
    }).findings_patrones_vara_ct).toBe(0)
  })

  it('un PASS limpio cuenta cero, y el cero es real: sí se midió', () => {
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).findings_patrones_vara_ct).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// EL AGREGADO QUE `/ct-harvest` LEE (§3.4 del handoff). `rubric_sin_vara`
// viajaba en la pull request desde `1422c67` y no lo leía nadie: la columna
// existía en disco y la pregunta —«¿está llegando la vara?»— se contestaba
// abriendo ficheros `jsonl` a mano. Las filas de aquí abajo son realistas
// (identidad completa, como `IDENT`, más las medidas), no `{ruling:'PASS'}` a
// secas: el agregador lee líneas reales, no objetos de prueba idealizados.
// ---------------------------------------------------------------------------
describe('el agregado de lo que el juez dejó escrito (§3.4)', () => {
  const veredicto = (measures) => metricLine(metricRow({ ...IDENT, step: 'judge' }, measures, { now: AHORA }))
  const pasoNoVeredicto = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: AHORA }))

  it('suma los sin-vara de todos los veredictos del fichero: la fila es por intento y agregar es sumar', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_sin_vara: 1 }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
      veredicto({ ruling: 'FAIL', rubric_sin_vara: 2 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.rubricSinVara).toBe(3)
    expect(r.verdicts).toBe(3)
    expect(r.measured).toBe(3)
    expect(r.legacy).toBe(0)
  })

  it('las filas que no son veredicto (implement, controls, commit) no entran en la cuenta', () => {
    const texto = [
      pasoNoVeredicto('implement', { outcome: 'done' }),
      pasoNoVeredicto('controls', { outcome: 'done' }),
      pasoNoVeredicto('commit', { outcome: 'done' }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.verdicts).toBe(1)
    expect(r.rows).toBe(4)
  })

  it('una fila de juez DESCARTADA no es un veredicto: no infla el denominador', () => {
    // ct-step.mjs:652 escribe estas filas SIN ninguna medida de veredicto.
    const texto = metricLine(metricRow({ ...IDENT, step: 'judge' }, { outcome: 'discarded', why: 'sin outcome' }, { now: AHORA }))
    const r = aggregateVerdictMeasures(texto)
    expect(r.verdicts).toBe(0)
  })

  it('una fila anterior a la columna cuenta como vieja y NO como un cero', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_sin_vara: 2 }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
      veredicto({ ruling: 'PASS' }), // esquema viejo: sin rubric_sin_vara
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.measured).toBe(2)
    expect(r.legacy).toBe(1)
  })

  it('si ningún veredicto trae la columna, sin-vara es null y no 0 — un cero afirmaría una medida que no se hizo', () => {
    const texto = [veredicto({ ruling: 'PASS' }), veredicto({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.rubricSinVara).toBeNull()
    expect(r.legacy).toBe(2)
  })

  it('los hallazgos se agregan por regla sumando findings_by_rule de todas las filas', () => {
    const texto = [
      veredicto({ ruling: 'FAIL', findings_by_rule: { patrones: 2, alcance: 1 } }),
      veredicto({ ruling: 'FAIL', findings_by_rule: { patrones: 1 } }),
    ].join('')
    expect(aggregateVerdictMeasures(texto).findingsByRule).toEqual({ patrones: 3, alcance: 1 })
  })

  it('una regla que ya no está en la rúbrica se sigue contando: filtrar contra el enum de hoy borraría historia', () => {
    const texto = veredicto({ ruling: 'FAIL', findings_by_rule: { 'una-regla-retirada': 4 } })
    expect(aggregateVerdictMeasures(texto).findingsByRule).toEqual({ 'una-regla-retirada': 4 })
  })

  it('una línea ilegible se cuenta y no tira el fichero: las buenas se siguen agregando', () => {
    const texto = [veredicto({ ruling: 'PASS', rubric_sin_vara: 1 }), '{no es json\n', veredicto({ ruling: 'PASS', rubric_sin_vara: 1 })].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.malformed).toBe(1)
    expect(r.verdicts).toBe(2)
    expect(r.rubricSinVara).toBe(2)
  })

  it('una línea que es JSON válido pero no un objeto también es ilegible', () => {
    const texto = ['[1,2]', 'null', '"x"'].join('\n') + '\n'
    expect(aggregateVerdictMeasures(texto).malformed).toBe(3)
  })

  it('las líneas vacías y el salto final no son líneas ilegibles', () => {
    const texto = veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }) + '\n\n'
    expect(aggregateVerdictMeasures(texto).malformed).toBe(0)
  })

  it('un rubric_sin_vara que no es un entero no negativo no se suma: se trata como fila vieja', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_sin_vara: '2' }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: -1 }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 1.5 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.measured).toBe(0)
    expect(r.legacy).toBe(3)
    expect(r.rubricSinVara).toBeNull()
  })

  it('un fichero vacío no revienta y no afirma nada', () => {
    for (const vacio of ['', undefined]) {
      const r = aggregateVerdictMeasures(vacio)
      expect(r).toEqual({
        rows: 0, malformed: 0, verdicts: 0, measured: 0, legacy: 0, rubricSinVara: null, findingsByRule: {},
        measuredPatronesVaraCt: 0, legacyPatronesVaraCt: 0, patronesVaraCt: null,
      })
    }
  })

  it('el lector mira exactamente donde el escritor escribe', () => {
    expect(metricsRepoRelPath(7)).toBe('docs/superpowers/metrics/issue-7.jsonl')
    expect(METRICS_REPO_DIR).toBe('docs/superpowers/metrics')
  })

  // MEDIDA 1, calcada de rubric_sin_vara: measured/legacy PROPIOS, y una fila
  // sin la columna nunca cuenta como cero.
  it('suma findings_patrones_vara_ct de todos los veredictos del fichero', () => {
    const texto = [
      veredicto({ ruling: 'PASS', findings_patrones_vara_ct: 1 }),
      veredicto({ ruling: 'PASS', findings_patrones_vara_ct: 0 }),
      veredicto({ ruling: 'FAIL', findings_patrones_vara_ct: 2 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.patronesVaraCt).toBe(3)
    expect(r.measuredPatronesVaraCt).toBe(3)
    expect(r.legacyPatronesVaraCt).toBe(0)
  })

  it('una fila anterior a findings_patrones_vara_ct cuenta como vieja y NO como un cero', () => {
    const texto = [
      veredicto({ ruling: 'PASS', findings_patrones_vara_ct: 2 }),
      veredicto({ ruling: 'PASS' }), // esquema viejo: sin findings_patrones_vara_ct
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.measuredPatronesVaraCt).toBe(1)
    expect(r.legacyPatronesVaraCt).toBe(1)
    expect(r.patronesVaraCt).toBe(2)
  })

  it('si ningún veredicto trae la columna, patronesVaraCt es null y no 0', () => {
    const texto = [veredicto({ ruling: 'PASS' }), veredicto({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.patronesVaraCt).toBeNull()
    expect(r.legacyPatronesVaraCt).toBe(2)
  })

  it('las dos medidas nuevas llevan contadores independientes: una fila puede traer una y no la otra', () => {
    // rubric_sin_vara SÍ, findings_patrones_vara_ct NO: son medidas con fechas
    // de nacimiento distintas en la telemetría.
    const texto = veredicto({ ruling: 'PASS', rubric_sin_vara: 1 })
    const r = aggregateVerdictMeasures(texto)
    expect(r.measured).toBe(1)
    expect(r.legacyPatronesVaraCt).toBe(1)
    expect(r.patronesVaraCt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// MEDIDA 2: si la vara llegó al brief, y cuánto pesó. `briefVaraCtMeasures` es
// PURA (no lee disco: recibe el contenido ya leído) y cuenta cabeceras
// `## Vara de ct: conventions/` — exactamente lo que `seccionDeVaraDeCt`
// (scripts/vara-ct.js) escribe por documento — en vez de comparar contra
// `CONVENTIONS_FILES.length`, para que un quinto documento de mañana también
// cuente sin tocar esta función.
// ---------------------------------------------------------------------------
describe('briefVaraCtMeasures — cuántos documentos trae el brief y cuánto pesa', () => {
  const brief = (docs) => [
    '# Task 1',
    '',
    'texto de la tarea',
    '',
    ...docs.flatMap((d) => [`## Vara de ct: conventions/${d}`, '', 'cuerpo del documento', '']),
  ].join('\n')

  it('cuenta las cuatro cabeceras de hoy', () => {
    const contenido = brief(['code.md', 'decisions.md', 'architecture.md', 'testing.md'])
    expect(briefVaraCtMeasures(contenido).brief_vara_ct_docs).toBe(4)
  })

  it('no depende de los nombres de hoy: un quinto documento también se cuenta', () => {
    const contenido = brief(['code.md', 'decisions.md', 'architecture.md', 'testing.md', 'naming.md'])
    expect(briefVaraCtMeasures(contenido).brief_vara_ct_docs).toBe(5)
  })

  it('un brief sin ninguna cabecera cuenta cero, y es un cero real: sí se pudo medir', () => {
    expect(briefVaraCtMeasures('# Task 1\n\nsin vara de ct por aquí\n').brief_vara_ct_docs).toBe(0)
  })

  it('pesa el brief en bytes, no en caracteres — UTF-8 de verdad', () => {
    const conAcentos = '## Vara de ct: conventions/code.md\ncondición, año, ñ\n'
    const { brief_bytes: bytes } = briefVaraCtMeasures(conAcentos)
    expect(bytes).toBe(Buffer.byteLength(conAcentos, 'utf8'))
    expect(bytes).toBeGreaterThan(conAcentos.length) // los acentos pesan más de 1 byte
  })
})

describe('aggregateBriefMeasures — el lector de lo que el brief midió, hermano de aggregateVerdictMeasures', () => {
  const intento = (measures) => metricLine(metricRow({ ...IDENT, step: 'implement' }, measures, { now: AHORA }))
  const otroPaso = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: AHORA }))

  it('suma docs y bytes de todos los intentos de implement del fichero', () => {
    const texto = [
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 520 }),
    ].join('')
    const r = aggregateBriefMeasures(texto)
    expect(r.briefAttempts).toBe(2)
    expect(r.briefMeasured).toBe(2)
    expect(r.briefLegacy).toBe(0)
    expect(r.briefVaraCtDocs).toBe(8)
    expect(r.briefBytes).toBe(1020)
  })

  // ESTAS FILAS NO LLEVAN `ruling`: es justo por lo que aggregateVerdictMeasures
  // las ignora por diseño (tolerancia nº3 de aquí arriba), y por lo que hace
  // falta un agregador propio y no reutilizar aquél.
  it('las filas de judge/controls/commit no entran en la cuenta de intentos de brief', () => {
    const texto = [
      otroPaso('judge', { ruling: 'PASS', rubric_sin_vara: 0 }),
      otroPaso('controls', { outcome: 'done' }),
      otroPaso('commit', { outcome: 'done' }),
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
    ].join('')
    expect(aggregateBriefMeasures(texto).briefAttempts).toBe(1)
  })

  // LA REGLA DEL FICHERO: una fila sin el campo (telemetría anterior a esta
  // medida, o un intento en el que el brief no se pudo leer) NO cuenta como
  // cero.
  it('una fila anterior a la medida, o con el brief sin leer (null), cuenta como vieja y NO como cero', () => {
    const texto = [
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
      intento({ outcome: 'done' }), // esquema viejo: sin los dos campos
      intento({ outcome: 'discarded', brief_vara_ct_docs: null, brief_bytes: null }), // brief no se pudo leer
    ].join('')
    const r = aggregateBriefMeasures(texto)
    expect(r.briefAttempts).toBe(3)
    expect(r.briefMeasured).toBe(1)
    expect(r.briefLegacy).toBe(2)
    expect(r.briefVaraCtDocs).toBe(4)
  })

  it('si ningún intento trae la columna, briefVaraCtDocs y briefBytes son null y no 0', () => {
    const texto = [intento({ outcome: 'done' }), intento({ outcome: 'discarded' })].join('')
    const r = aggregateBriefMeasures(texto)
    expect(r.briefVaraCtDocs).toBeNull()
    expect(r.briefBytes).toBeNull()
    expect(r.briefLegacy).toBe(2)
  })

  it('un brief con cero documentos (roto de verdad) se suma como el cero que es: no se confunde con "sin medir"', () => {
    const texto = intento({ outcome: 'done', brief_vara_ct_docs: 0, brief_bytes: 40 })
    const r = aggregateBriefMeasures(texto)
    expect(r.briefMeasured).toBe(1)
    expect(r.briefVaraCtDocs).toBe(0)
  })

  it('un fichero vacío no revienta y no afirma nada', () => {
    for (const vacio of ['', undefined]) {
      expect(aggregateBriefMeasures(vacio)).toEqual({
        briefAttempts: 0, briefMeasured: 0, briefLegacy: 0, briefVaraCtDocs: null, briefBytes: null,
      })
    }
  })

  it('una línea ilegible no revienta al agregador', () => {
    const texto = [intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }), '{no es json\n'].join('')
    expect(() => aggregateBriefMeasures(texto)).not.toThrow()
    expect(aggregateBriefMeasures(texto).briefAttempts).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Y contra el oráculo de verdad: que las filas salen, y —lo que de verdad hay
// que fijar— que NO salir no cambia lo que hace el paso. Un programa que muere
// porque no pudo escribir su propia métrica ha convertido el termómetro en parte
// del motor.
// ---------------------------------------------------------------------------
describe('la telemetría de un paso real', () => {
  const PLAN = [
    '# #7 — una tarea',
    '',
    '## 7. Tasks',
    '',
    '### Task 1 — la única',
    '**Objective:** un fichero.',
    '**Files:** `uno.txt`',
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** el fichero está.',
    '',
    F + 'bash',
    'test -f uno.txt',
    F,
    '',
    '## 8. Global verification',
    '',
    'N/A — fixture de telemetría.',
    '',
  ].join('\n')

  let repo, casa

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ct-metrics-'))
    casa = mkdtempSync(join(tmpdir(), 'ct-casa-'))
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    g('init', '-q', '-b', 'main')
    g('config', 'user.email', 't@e.com')
    g('config', 'user.name', 'T')
    g('config', 'commit.gpgsign', 'false')
    g('remote', 'add', 'origin', 'git@github.com:josemerca/control-tower-plugin.git')
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'SLICE.md'), '---\nissue: 7\nepic: 12\n---\n\n# slice\n')
    writeFileSync(join(repo, 'plan.md'), PLAN)
    g('add', '-A')
    g('commit', '-q', '-m', 'base')
    writeFileSync(join(repo, 'uno.txt'), 'uno\n')
    writeFileSync(join(repo, 'report.json'), JSON.stringify({ paths: ['uno.txt'], summary: 'hecho' }))
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(casa, { recursive: true, force: true })
  })

  const ct = (configDir, ...args) => spawnSync('node', [SCRIPT, ...args, '--plan', 'plan.md', '--issue', '7'], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  })

  it('la fila lleva la identidad completa, con el epic sembrado y el hash del plan', () => {
    const r = ct(casa, 'report', 'report.json')
    expect(r.status).toBe(0)
    const filas = readFileSync(join(casa, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas).toHaveLength(1)
    const f = filas[0]
    expect(f.repo).toBe('josemerca/control-tower-plugin')
    expect(f.epic).toBe('12')            // leído del SLICE.md que sembró el despacho
    expect(f.issue).toBe(7)
    expect(f.step).toBe('implement')
    expect(f.attempt).toBe(1)
    expect(f.plan_sha256).toBe(planSha256(PLAN))
    expect(f.written_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('si no se puede escribir, el paso hace lo MISMO y sólo avisa', () => {
    // Un fichero donde debería ir el directorio: mkdir falla con ENOTDIR.
    const bloqueado = join(casa, 'bloqueado')
    writeFileSync(bloqueado, 'no soy un directorio\n')
    const r = ct(bloqueado, 'report', 'report.json')
    expect(r.status).toBe(0)                            // el mismo código que con telemetría
    expect(r.stdout).toMatch(/stageados 1 fichero/)     // y el paso se aplicó igual
    expect(r.stderr).toMatch(/no se pudo escribir la telemetría/)
    // La transición se guardó: la medida no decide nada.
    expect(JSON.parse(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8')).step).toBe('controls')
  })

  // MEDIDA 2 contra el oráculo de verdad: `ct-step next` escribe el brief REAL
  // en disco (con la vara de ct del plugin pegada por `escribirBrief`), y
  // `ct-step report` lo mide leyendo exactamente esa ruta.
  it('si el brief llegó a disco, la fila cuenta sus documentos de vara de ct y su peso', () => {
    const n = ct(casa, 'next')
    expect(n.status).toBe(0)
    const r = ct(casa, 'report', 'report.json')
    expect(r.status).toBe(0)
    const filas = readFileSync(join(casa, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const f = filas[0]
    // Los cuatro documentos de conventions/ del plugin, contados por cabecera:
    // no por comparar contra CONVENTIONS_FILES.length.
    expect(f.brief_vara_ct_docs).toBe(4)
    expect(typeof f.brief_bytes).toBe('number')
    expect(f.brief_bytes).toBeGreaterThan(0)
  })

  // Si nadie llamó a `next`, el brief no existe en disco: los dos campos van a
  // `null`, nunca a `0` — un cero afirmaría un brief sin vara, y lo que pasó es
  // que no se pudo mirar.
  it('si el brief no se puede leer, los dos campos van a null, no a 0', () => {
    const r = ct(casa, 'report', 'report.json')
    expect(r.status).toBe(0)
    const filas = readFileSync(join(casa, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const f = filas[0]
    expect(f.brief_vara_ct_docs).toBeNull()
    expect(f.brief_bytes).toBeNull()
  })
})
