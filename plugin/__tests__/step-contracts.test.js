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
import { createHash } from 'node:crypto'
import {
  readVerdict, readReport, outcomeOfVerdict, commitMessage, findingLocation,
  VERDICT_SCHEMA, REPORT_SCHEMA, IMPLEMENTER_TOOLS, JUDGE_TOOLS, VERDICT_RULES,
  PACKAGE_SECTIONS, RUBRIC_OUTCOMES,
  readSliceVerdict, outcomeOfSliceVerdict, sliceVerdictCommitMessage,
  SLICE_VERDICT_RULES, SLICE_VERDICT_SCHEMA, SLICE_JUDGE_TOOLS, SLICE_PACKAGE_SECTIONS, RECONCILER_TOOLS,
  REVIEW_TOKEN_LABEL, reviewToken, reviewTokenLine, reviewTokenOf,
} from '../scripts/step-contracts.js'
import { findClosingKeywords } from '../scripts/closing-keywords.js'

const AGENTE_JUEZ = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-judge.md')
const AGENTE_JUEZ_DE_SLICE = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-slice-judge.md')
const AGENTE_RECONCILIADOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-reconciler.md')

// La línea `tools:` del frontmatter del reconciliador (Reconciliación de
// ramas, Tarea 9) — mismo patrón que `toolsDelAgente()`/`toolsDelJuezDeSlice()`,
// sobre `agents/ct-reconciler.md`.
const toolsDelReconciliador = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(AGENTE_RECONCILIADOR, 'utf8'))
  return m ? m[1].trim() : null
}

// La línea `tools:` del frontmatter del juez de SLICE — mismo patrón que
// `toolsDelAgente()` para ct-judge.md, sobre el fichero propio de §3.7-B.
const toolsDelJuezDeSlice = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(AGENTE_JUEZ_DE_SLICE, 'utf8'))
  return m ? m[1].trim() : null
}

// Los encabezados de la rúbrica del juez de slice — "### 1. `estado-final` —
// ..." — en el orden en que el agente los recorre. Mismo patrón que
// `reglasDelAgente()`, parametrizado por fichero porque ahora hay DOS agentes
// con esta misma forma de rúbrica.
const reglasDeAgente = (fichero) => {
  const texto = readFileSync(fichero, 'utf8')
  const regex = /^### \d+\.\s+`([a-z-]+)`/gm
  const reglas = []
  let m
  while ((m = regex.exec(texto)) !== null) reglas.push(m[1])
  return reglas
}

// El bloque ```json de "What you write" del juez de slice — mismo patrón que
// `esquemaDelAgente()`, parametrizado por fichero.
const esquemaDeAgente = (fichero) => {
  const texto = readFileSync(fichero, 'utf8')
  const m = /## What you write[\s\S]*?```json\n([\s\S]*?)```/.exec(texto)
  return m ? m[1] : ''
}

// Los encabezados del paquete de revisión que cita "What you are given" del
// juez de slice. Mismo patrón que `seccionesDelPaquete()`, sobre el párrafo
// "The slice review package." en vez de "The review package.".
const seccionesDelPaqueteDeSlice = () => {
  const texto = readFileSync(AGENTE_JUEZ_DE_SLICE, 'utf8')
  const parrafo = /- \*\*The slice review package\.\*\*([\s\S]*?)\n- \*\*The plan/.exec(texto)
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
// La línea `tools:` del frontmatter, que es la que decide de verdad qué puede
// hacer el juez. La constante del módulo es una copia suya.
const toolsDelAgente = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(AGENTE_JUEZ, 'utf8'))
  return m ? m[1].trim() : null
}

const PROMPT_IMPLEMENTADOR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'task-implementer.md')

// El punto 3 del prompt del implementador, aislado hasta el punto 4: es donde
// vive la frase espejo de e473c97 ("Rules to obey... Open both before you
// write"). Se acota porque el prompt YA contenía la palabra "boundary" antes
// de este slice, en el punto "You do not touch files outside the task"
// (frontera del ALCANCE de la tarea, un sujeto ajeno a las boundaries de
// arquitectura) — un match contra el fichero entero pasaría igual con la
// frase espejo borrada.
const punto3DelImplementador = () => {
  const m = /^3\.\s[\s\S]*?(?=^4\.\s)/m.exec(readFileSync(PROMPT_IMPLEMENTADOR, 'utf8'))
  return m ? m[0] : ''
}

const PLANTILLA_PLAN = join(
  dirname(fileURLToPath(import.meta.url)), '..',
  'skills', 'writing-plans-prescriptive', 'plan-template.md',
)
// El `## 3. Reference patterns` de la plantilla del plan: la sección que declara
// qué se admite como vara. Se aísla hasta el siguiente `## ` porque el resto de
// la plantilla también nombra skills y no todas son vara del juez.
const seccion3DeLaPlantilla = () => {
  const m = /^## 3\. Reference patterns$([\s\S]*?)^## /m.exec(readFileSync(PLANTILLA_PLAN, 'utf8'))
  return m ? m[1] : ''
}

// El ítem `patrones` de la rúbrica, aislado hasta el siguiente encabezado: es el
// único sitio donde al juez se le manda abrir la vara del repo.
const item5DeLaRubrica = () => {
  const m = /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(readFileSync(AGENTE_JUEZ, 'utf8'))
  return m ? m[0] : ''
}

// El ítem 5 con los espacios normalizados. El ajuste de línea de Markdown puede
// partir en dos líneas del fichero una frase que en el texto es una sola, así
// que una expresión que busque la frase distintiva contra el crudo se pondría
// roja al reflowear un párrafo sin haber borrado nada. Mismo recurso que
// `seccionesDelPaquete` usa por el mismo motivo.
const item5Normalizado = () => item5DeLaRubrica().replace(/\s+/g, ' ')

// El ítem `test-desiderata`, aislado hasta el siguiente encabezado, con el
// mismo recorte que `item5DeLaRubrica`: es el único sitio donde se le dice al
// juez qué mira en los tests que la tarea ACABA de escribir.
const item9DeLaRubrica = () => {
  const m = /^### 9\. `test-desiderata`[\s\S]*?(?=^### |^## )/m.exec(readFileSync(AGENTE_JUEZ, 'utf8'))
  return m ? m[0] : ''
}

// La lista de identificadores que el bullet `rule` de "What you write" le
// enseña al juez. Es una TERCERA copia de VERDICT_RULES —después del array y de
// los encabezados— y la que no rompe nada al quedarse corta: un identificador
// que no aparece ahí es un ítem que el juez recorre pero del que nunca se
// atreve a emitir un hallazgo.
const identificadoresQueElJuezPuedeEscribir = () => {
  const m = /- `rule` is one of the[\s\S]*?(?=\n- `path`)/.exec(readFileSync(AGENTE_JUEZ, 'utf8'))
  return m ? m[0].replace(/\s+/g, ' ') : ''
}

// El punto 1 del prompt del implementador (la carga de la skill de TDD),
// aislado hasta el punto 2: es donde vive la frase espejo de este ítem.
const punto1DelImplementador = () => {
  const m = /^1\.\s[\s\S]*?(?=^2\.\s)/m.exec(readFileSync(PROMPT_IMPLEMENTADOR, 'utf8'))
  return m ? m[0] : ''
}

// Los encabezados de la rúbrica — "### 1. `objetivo` — ..." — en el
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

// El paseo por la rúbrica tal y como el esquema lo exige: todos los ítems, cada
// uno exactamente una vez, cada uno con lo que dio. Se construye desde
// VERDICT_RULES y no desde una lista a mano por la misma razón por la que el
// esquema tampoco duplica la lista: dos copias de los identificadores
// divergen, y el test que las ataba dejaría de mirarlos todos.
const recorridoCompleto = () => VERDICT_RULES.map((rule) => ({ rule, result: 'sin hallazgos', outcome: 'conforme' }))

// Slice 11 — a estos tests no les importa CUÁL token trae el veredicto, sólo
// que readVerdict lo exige y lo conserva: un hex de 64 cualquiera basta, y no
// se teclea dos veces por el mismo motivo que recorridoCompleto no se teclea.
const TOKEN = 'a'.repeat(64)

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

  it('el juez puede cargar skills: la vara secundaria que §3 admite no es una ruta', () => {
    // El defecto §3.1 del handoff. `Rules to obey:` admitía declarar una skill y
    // la rúbrica mandaba abrirla, pero el frontmatter era `Read, Grep, Glob,
    // Write`: un nombre de skill no es una ruta que `Read` pueda abrir, y
    // `plan-contract` no lo comprueba en disco a propósito. La vara secundaria
    // era inalcanzable en silencio — el juez habría dicho `conforme` sobre un
    // documento que nunca abrió.
    expect(toolsDelAgente()).toMatch(/\bSkill\b/)
    expect(JUDGE_TOOLS).toMatch(/\bSkill\b/)
  })

  it('nadie puede admitir una skill como vara sin darle al juez con qué abrirla', () => {
    // Las tres puntas del defecto, atadas: la plantilla del plan la admite, la
    // rúbrica manda abrirla, el frontmatter la concede. La primera vez se
    // hicieron dos de tres y nada se enteró. Si alguien toma más adelante la
    // opción B del §3.1 (quitar las skills de §3), este test se pone rojo y le
    // obliga a quitarla de los tres sitios, no de uno.
    expect(seccion3DeLaPlantilla()).toMatch(/skill/i)
    expect(item5DeLaRubrica()).toMatch(/skill/i)
    expect(toolsDelAgente()).toMatch(/\bSkill\b/)
  })

  it('boundaries se mide dentro de patrones: el ítem 5 dirige la mirada a imports e inyección', () => {
    // §3.6 del handoff, cerrado como ABSORBIDO. La pregunta dirigida: cuando un
    // documento de reglas habla de fronteras, los renglones del diff que
    // contestan son sus imports, sus constructores y sus firmas. Sin esta
    // dirección, el juez audita texto literal y no mira la arquitectura
    // (medido en rust-monitoring run-4 tarea 2).
    expect(item5DeLaRubrica()).toMatch(/boundar/i)
    expect(item5DeLaRubrica()).toMatch(/import/i)
    expect(item5DeLaRubrica()).toMatch(/inject/i)
  })

  it('boundaries no es un noveno ítem: la decisión del §3.6 queda fijada', () => {
    // Ítem propio solo cuando el par sujeto+vara es nuevo. La vara de boundaries
    // son los Rules to obey que patrones ya abre: un encabezado propio solo
    // duplicaría el sin-vara en repos sin convención de arquitectura.
    expect(VERDICT_RULES).not.toContain('boundaries')
    expect(reglasDelAgente()).not.toContain('boundaries')
  })

  it('la vara de boundaries es la misma a los dos lados: el implementador la lee antes de escribir', () => {
    // La propiedad de e473c97: el juez no es una sorpresa porque implementador y
    // juez miden con el mismo texto. Se exige la frase distintiva (no sólo
    // /boundar/i) dentro del punto 3 aislado: el fichero ya traía "boundary" en
    // otro punto y otro sujeto antes de este slice, así que un match flojo
    // contra el fichero entero no detectaría que esta frase se borre.
    expect(punto3DelImplementador()).toMatch(/rules speak about boundaries/i)
  })

  it('el patrón de entrega se mide dentro de patrones: el ítem 5 pregunta si es EL patrón que la convención prescribe', () => {
    // §3.10 del handoff, y lo que su propia rúbrica llama «el check que un
    // verificador que solo mira la implementación deja pasar»: el patrón puede
    // estar bien ejecutado y ser coherente consigo mismo y aun así no ser el
    // que el repo prescribe para ESTE tipo de cambio. Sin la pregunta dirigida
    // el juez compara idiomas y la de la entrega no la abre nadie. Se exigen
    // también las palabras del disparador —firma, constructor, contrato
    // público— porque son las que le dicen dónde mirar en el diff.
    const item = item5Normalizado()
    expect(item).toMatch(/well executed and coherent with itself/i)
    expect(item).toMatch(/expand-contract/)
    expect(item).toMatch(/signature, a constructor or a public contract/i)
  })

  it('rollout no es un décimo ítem: la decisión del §3.6 queda fijada también para el patrón de entrega', () => {
    // Misma regla que cerró `boundaries`: ítem propio sólo cuando el par
    // sujeto+vara es nuevo. La vara del patrón de entrega son los mismos
    // `Rules to obey:` que `patrones` ya abre, así que un encabezado propio no
    // compraría vigilancia: duplicaría el `sin-vara` en todo repo que no
    // escriba cómo entrega.
    expect(VERDICT_RULES).not.toContain('rollout')
    expect(reglasDelAgente()).not.toContain('rollout')
  })

  it('la vara del patrón de entrega es la misma a los dos lados: el implementador la lee antes de escribir', () => {
    // La propiedad de e473c97 otra vez: el juez no es una sorpresa porque los
    // dos miden con el mismo texto. Se busca la frase distintiva dentro del
    // punto 3 aislado y con los espacios normalizados, no un match flojo
    // contra el fichero entero.
    const punto3 = punto3DelImplementador().replace(/\s+/g, ' ')
    expect(punto3).toMatch(/how a change of this kind must reach production/i)
    expect(punto3).toMatch(/expand-contract/)
  })

  it('test-desiderata es el noveno ítem, y va detrás de alcance', () => {
    // El §3.6 lo cerró como ítem PROPIO (a diferencia de boundaries y rollout,
    // absorbidos en patrones): sujeto nuevo (los tests que la tarea acaba de
    // escribir) y vara nueva (propiedades del test, no convenciones del repo).
    // La POSICIÓN también es decisión: el orden del array es el orden del paseo,
    // e intercalarlo renumeraría seis encabezados sin cambiar nada medible.
    expect(VERDICT_RULES.at(-1)).toBe('test-desiderata')
    expect(reglasDelAgente().at(-1)).toBe('test-desiderata')
  })

  it('el ítem 9 nombra las tres violaciones que bloquean, y descarta el medium', () => {
    const item = item9DeLaRubrica()
    expect(item).toMatch(/determinis/i)
    expect(item).toMatch(/isolat/i)
    expect(item).toMatch(/real behaviour/i)
    expect(item).toMatch(/never reports `medium`/i)
  })

  it('el ítem 9 juzga los tests nuevos y devuelve los preexistentes a manipulacion-tests', () => {
    // El §3.5 del handoff: un assert relajado en un test que YA existía es un
    // defecto y no dos. Sin la frase, los dos ítems se solapan y el conteo por
    // regla que lee la telemetría cuenta doble el mismo hallazgo.
    expect(item9DeLaRubrica()).toMatch(/manipulacion-tests/)
  })

  it('el ítem 9 mide con la misma skill que el implementador tenía orden de seguir', () => {
    // El juez corre en el worktree del REPO DESTINO: skills/ del plugin no es
    // una ruta que `Read` alcance ahí, y por eso este ítem era imposible antes
    // del Slice 1. Y es la MISMA copia que el prompt del implementador nombra:
    // un juez que bloquea con un texto que el implementador no recibió es una
    // sorpresa, que es justo lo que el espejo de e473c97 existe para impedir.
    expect(item9DeLaRubrica()).toMatch(/control-tower-loop:test-driven-development/)
    expect(readFileSync(PROMPT_IMPLEMENTADOR, 'utf8')).toMatch(/control-tower-loop:test-driven-development/)
    expect(toolsDelAgente()).toMatch(/\bSkill\b/)
  })

  it('la lista de identificadores que el juez puede escribir no se queda corta', () => {
    // Los encabezados ya están atados; esta lista no lo estaba. Un identificador
    // ausente aquí no rompe ningún esquema: sólo hace que el juez recorra el
    // ítem y no se atreva a emitir un hallazgo suyo, porque el fichero le dice
    // que ese `rule` no es de los válidos.
    const lista = identificadoresQueElJuezPuedeEscribir()
    for (const regla of VERDICT_RULES) expect(lista).toContain(`\`${regla}\``)
  })

  it('la vara de los tests nuevos es la misma a los dos lados: el implementador la lee antes de escribir', () => {
    const punto1 = punto1DelImplementador()
    expect(punto1).toMatch(/determinis/i)
    expect(punto1).toMatch(/isolat/i)
    expect(punto1).toMatch(/real behaviour/i)
  })

  it('VERDICT_RULES no puede divergir de los encabezados de la rúbrica', () => {
    // Renombrar una regla en el código sin tocar el agente (o al revés) no
    // rompe ningún esquema: sólo hace que un veredicto con ese `rule` se
    // descarte en cada ejecución. Este test es lo que lo convierte en un
    // fallo de test en vez de en un fallo silencioso en producción.
    expect(VERDICT_RULES).toEqual(reglasDelAgente())
  })

  it('la rúbrica le enseña al juez el campo del recorrido en vez de pedírselo en prosa', () => {
    // El paseo por los ítems se pedía en prosa, al final del fichero, y
    // se pedía para la RESPUESTA del subagente — que no se persiste. Ahora es
    // un campo del veredicto, así que el bloque que el juez copia tiene que
    // mostrarlo: un validador que exige lo que el agente no ve descarta todos
    // los veredictos de la corrida sin que ninguno sea culpa del juez.
    expect(esquemaDelAgente()).toMatch(/"rubric"/)
    expect(esquemaDelAgente()).toMatch(/"result"/)
  })

  it('la rúbrica le enseña al juez los dos campos nuevos, o no puede acertar ni por casualidad', () => {
    // Mismo argumento que el test de arriba, aplicado a `outcome` y a
    // `evidence`: el validador los exige, así que el bloque que el juez copia
    // tiene que mostrarlos. Un campo que sólo vive en el validador descarta
    // todos los veredictos de la corrida sin que ninguno sea culpa del juez.
    expect(esquemaDelAgente()).toMatch(/"outcome"/)
    expect(esquemaDelAgente()).toMatch(/"evidence"/)
  })

  it('la rúbrica le enseña al juez los dos campos de la ubicación, y ya no el campo viejo', () => {
    // Mismo argumento que `outcome` y `evidence`: un campo obligatorio que sólo
    // vive en el validador descarta todos los veredictos de la corrida sin que
    // ninguno sea culpa del juez. Y el `not`: un ejemplo que enseñe también el
    // `where` viejo es un juez que rellena el viejo, no trae `path`, y quema
    // MAX_DISCARDS con un veredicto correcto dentro.
    expect(esquemaDelAgente()).toMatch(/"path"/)
    expect(esquemaDelAgente()).toMatch(/"line"/)
    expect(esquemaDelAgente()).not.toMatch(/"where"/)
  })

  it('los tres valores de outcome están en la rúbrica, escritos igual que en el enum', () => {
    // El enum es cerrado y el juez sólo puede escribir lo que la rúbrica le
    // enseña. Si el código renombra `sin-vara` y el fichero sigue diciendo lo
    // de antes, el juez escribe el valor viejo y el veredicto se descarta.
    const texto = readFileSync(AGENTE_JUEZ, 'utf8')
    for (const valor of RUBRIC_OUTCOMES) expect(texto).toContain(valor)
  })

  // Slice 11 — el campo obligatorio tiene que estar en lo que el juez lee: un
  // campo que sólo vive en el validador descarta la corrida entera sin que
  // ninguno de los veredictos sea culpa del juez.
  it('el bloque json de ct-judge.md enseña review_token: un campo que sólo vive en el validador descarta la corrida entera', () => {
    expect(esquemaDelAgente()).toMatch(/"review_token"/)
  })

  it('la rúbrica del juez dice de DÓNDE se copia el token, con la etiqueta exacta del paquete', () => {
    expect(readFileSync(AGENTE_JUEZ, 'utf8')).toContain(`${REVIEW_TOKEN_LABEL}:`)
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

// ---------------------------------------------------------------------------
// EL JUEZ DE SLICE (§3.7-B del handoff): material propio,
// `agents/ct-slice-judge.md`, con su propia rúbrica de DOS ítems. Mismos
// patrones de test que ya atan al juez de tarea, aplicados al fichero nuevo.
// ---------------------------------------------------------------------------
describe('el juez de slice (§3.7-B)', () => {
  it('SLICE_VERDICT_RULES son los tres encabezados de la rúbrica de ct-slice-judge.md', () => {
    expect(SLICE_VERDICT_RULES).toEqual(reglasDeAgente(AGENTE_JUEZ_DE_SLICE))
    // Slice 10: `observabilidad` es el tercer ítem — las tres comprobaciones
    // del §3.9 contra el diff acumulado, la señal DE LA SLICE como sujeto.
    expect(SLICE_VERDICT_RULES).toEqual(['estado-final', 'coherencia', 'observabilidad'])
  })

  // El orden del array ES el orden del recorrido y los encabezados están
  // atados por test — intercalarlo renumeraría los encabezados de
  // ct-slice-judge.md sin medir nada distinto (el mismo argumento con el que
  // `test-desiderata` entró noveno en el juez de tarea).
  it('observabilidad es el tercero y último: entra detrás, nunca intercalado', () => {
    expect(SLICE_VERDICT_RULES.at(-1)).toBe('observabilidad')
    expect(SLICE_VERDICT_RULES.slice(0, 2)).toEqual(['estado-final', 'coherencia'])
  })

  // La TERCERA copia de los identificadores (después del array y de los
  // encabezados): la lista que el bullet `rule` de "What you write" le enseña
  // al juez — un identificador que no aparece ahí es un ítem que el juez
  // recorre pero del que nunca se atreve a emitir un hallazgo. Mismo motivo
  // que `identificadoresQueElJuezPuedeEscribir` en el juez de tarea.
  it('el bullet de rule de ct-slice-judge.md nombra los tres identificadores', () => {
    const texto = readFileSync(AGENTE_JUEZ_DE_SLICE, 'utf8')
    const m = /- `rule` is one of the[\s\S]*?(?=\n- `path`)/.exec(texto)
    const bullet = m ? m[0].replace(/\s+/g, ' ') : ''
    for (const rule of SLICE_VERDICT_RULES) {
      expect(bullet).toContain(`\`${rule}\``)
    }
  })

  // La telemetría (`findings_by_rule`) cuenta hallazgos por NOMBRE de regla y
  // `aggregateVerdictMeasures` funde tal cual todo lo que trae `ruling`: un
  // nombre compartido entre los dos jueces haría indistinguibles sus cuentas.
  it('observabilidad no choca con ninguna regla del juez de tarea', () => {
    expect(VERDICT_RULES).not.toContain('observabilidad')
    // Disjunción completa: ningún identificador vive en las dos rúbricas.
    expect(SLICE_VERDICT_RULES.filter((r) => VERDICT_RULES.includes(r))).toEqual([])
  })

  it('el juez de slice no tiene shell ni Edit', () => {
    expect(toolsDelJuezDeSlice()).not.toMatch(/Bash|Edit/)
    expect(SLICE_JUDGE_TOOLS).not.toMatch(/Bash|Edit/)
  })

  it('SLICE_JUDGE_TOOLS no puede divergir del agente que se despacha', () => {
    expect(SLICE_JUDGE_TOOLS).toBe(toolsDelJuezDeSlice())
  })

  it('el juez de slice puede escribir su veredicto: es el canal por el que contesta', () => {
    expect(toolsDelJuezDeSlice()).toMatch(/Write/)
  })

  it('el bloque ```json de ct-slice-judge.md enseña rubric, outcome, evidence y path', () => {
    const esquema = esquemaDeAgente(AGENTE_JUEZ_DE_SLICE)
    expect(esquema).toMatch(/"rubric"/)
    expect(esquema).toMatch(/"outcome"/)
    expect(esquema).toMatch(/"evidence"/)
    expect(esquema).toMatch(/"path"/)
  })

  it('el bloque json de ct-slice-judge.md enseña review_token, y su rúbrica nombra la etiqueta', () => {
    expect(esquemaDeAgente(AGENTE_JUEZ_DE_SLICE)).toMatch(/"review_token"/)
    expect(readFileSync(AGENTE_JUEZ_DE_SLICE, 'utf8')).toContain(`${REVIEW_TOKEN_LABEL}:`)
  })

  it('SLICE_PACKAGE_SECTIONS abre con Señal y no puede divergir de la rúbrica', () => {
    expect(SLICE_PACKAGE_SECTIONS).toEqual(seccionesDelPaqueteDeSlice())
    // Slice 10: `Señal` PRIMERA, porque es la vara del ítem `observabilidad`
    // — detrás del diff -U10 quedaría enterrada. La atadura de arriba obliga
    // a que paquete y agente cambien en la MISMA tarea.
    expect(SLICE_PACKAGE_SECTIONS).toEqual(['Señal', 'Commits', 'Files changed', 'Diff'])
  })

  it('el esquema del recorrido de slice no duplica los identificadores: los toma de SLICE_VERDICT_RULES', () => {
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.items.properties.rule.enum).toBe(SLICE_VERDICT_RULES)
  })

  it('el esquema de slice pide el recorrido entero: tres ítems, ni uno más ni uno menos', () => {
    // Slice 10: el esquema deriva de SLICE_VERDICT_RULES.length — sube a 3
    // solo, sin tocar schemaFor ni readSliceVerdict.
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.minItems).toBe(3)
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.maxItems).toBe(3)
  })

  const recorridoDeSlice = () => SLICE_VERDICT_RULES.map((rule) => ({ rule, result: `mirado: ${rule}`, outcome: 'conforme' }))

  it('readSliceVerdict acepta un recorrido de dos ítems válido', () => {
    const r = readSliceVerdict({ ruling: 'PASS', rubric: recorridoDeSlice(), findings: [], review_token: TOKEN })
    expect(r.verdict).toEqual({ ruling: 'PASS', rubric: recorridoDeSlice(), findings: [], review_token: TOKEN })
  })

  // Slice 11: mismo campo, mismo validador — `readSliceVerdict` es
  // `readVerdict` con otra rúbrica dentro, así que el token se exige igual.
  it('el juez de slice valida el mismo campo, con el mismo readVerdict', () => {
    expect(readSliceVerdict({ ruling: 'PASS', rubric: recorridoDeSlice(), findings: [] }).verdict).toBeUndefined()
  })

  it('readSliceVerdict descarta un veredicto con una regla de TAREA (p. ej. "alcance")', () => {
    const r = readSliceVerdict({
      ruling: 'FAIL',
      rubric: recorridoDeSlice(),
      findings: [{ rule: 'alcance', severity: 'high', what: 'x', path: 'y', evidence: 'z' }],
    })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/regla desconocida/)
  })

  it('readSliceVerdict descarta un PASS con un hallazgo high, igual que el veredicto de tarea', () => {
    const r = readSliceVerdict({
      ruling: 'PASS',
      rubric: recorridoDeSlice(),
      findings: [{ rule: 'coherencia', severity: 'high', what: 'x', path: 'y', evidence: 'z' }],
    })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/contradice la rúbrica/)
  })

  it('readSliceVerdict descarta un recorrido incompleto: la rúbrica son 3 ítems', () => {
    const r = readSliceVerdict({ ruling: 'PASS', rubric: [recorridoDeSlice()[0]], findings: [] })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/coherencia/)
    expect(r.why).toContain('3 ítems')
  })

  // El mensaje de recorrido incompleto deriva de `rules` y nombra lo que
  // falta: un juez de slice que conteste el recorrido viejo de dos ítems se
  // descarta con el nombre del tercero en el texto que lee para reintentar.
  it('un recorrido de slice sin observabilidad se descarta nombrándolo', () => {
    const soloDos = recorridoDeSlice().filter((p) => p.rule !== 'observabilidad')
    const r = readSliceVerdict({ ruling: 'PASS', rubric: soloDos, findings: [] })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/observabilidad/)
  })

  it('readVerdict (el de TAREA) sigue exigiendo el recorrido de nueve: no hay regresión', () => {
    const completo = VERDICT_RULES.map((rule) => ({ rule, result: 'ok', outcome: 'conforme' }))
    expect(readVerdict({ ruling: 'PASS', rubric: completo, findings: [], review_token: TOKEN }).verdict).toBeDefined()
    // El mismo recorrido de DOS ítems no basta para un veredicto de TAREA.
    expect(readVerdict({ ruling: 'PASS', rubric: recorridoDeSlice(), findings: [] }).verdict).toBeUndefined()
  })

  it('outcomeOfSliceVerdict: FAIL es siempre failed', () => {
    expect(outcomeOfSliceVerdict({ ruling: 'FAIL', findings: [] })).toBe('failed')
  })

  it('outcomeOfSliceVerdict: PASS con un medium sigue siendo done — no hay vuelta pagada', () => {
    expect(outcomeOfSliceVerdict({ ruling: 'PASS', findings: [{ severity: 'medium' }] })).toBe('done')
  })

  it('outcomeOfSliceVerdict: PASS limpio es done', () => {
    expect(outcomeOfSliceVerdict({ ruling: 'PASS', findings: [] })).toBe('done')
  })

  it('sliceVerdictCommitMessage lleva el issue, Co-Authored-By, y ninguna closing keyword', () => {
    const msg = sliceVerdictCommitMessage({ issue: 42, tasksTotal: 3 })
    expect(msg).toContain('(#42)')
    expect(msg).toContain('Co-Authored-By: Claude <noreply@anthropic.com>')
    expect(findClosingKeywords(msg)).toEqual([])
  })

  // El ítem `observabilidad` aislado — misma regex con la que vara.test.js
  // aísla el ítem 5 del juez de tarea: el encabezado exacto hasta el siguiente
  // `###` o `##` (aquí, `## What you do not judge`).
  const itemObservabilidad = () => {
    const texto = readFileSync(AGENTE_JUEZ_DE_SLICE, 'utf8')
    const m = /^### 3\. `observabilidad`[\s\S]*?(?=^### |^## )/m.exec(texto)
    return m ? m[0] : ''
  }

  // El hallazgo MEDIO del review de la PR #36: la frase del contrato la leía un
  // humano en el groom y nadie más. Esto ata la mitad que faltaba — el criterio
  // se mide en tiempo de juicio, y con las palabras del contrato.
  it('el ítem observabilidad mide la señal redundante con la regla del contrato', () => {
    const item = itemObservabilidad()
    expect(item).not.toBe('')
    const norm = item.replace(/\s+/g, ' ')
    expect(norm).toContain('se puede comprobar corriendo los tests, es un criterio de aceptación, no una señal')
    expect(norm).toContain('`señal redundante`')
    // Las dos condiciones del disparo, las dos dentro del ítem: el test del
    // diff acumulado, y que la celda no nombre nada que se lea en producción.
    expect(norm).toMatch(/test of the accumulated diff/)
    expect(norm).toMatch(/no metric, no log line, no event/)
  })

  // El número que el ítem promete tiene que cuadrar con lo que lista. Si alguien
  // añade un cuarto check bloqueante, este test cae y le obliga a actualizar la
  // promesa — que es lo que no pasó con «three checks» cuando entró la frase.
  it('el ítem promete tres checks y lista tres: el smell no es un cuarto bullet', () => {
    const item = itemObservabilidad()
    expect(item.match(/^- \*\*/gm)).toHaveLength(3)
    const norm = item.replace(/\s+/g, ' ')
    expect(norm).toContain('three checks, and only these three')
    expect(norm).toContain('one smell')
  })

  // El vocabulario NO crece: es un finding, no un outcome nuevo. Un `low` que
  // se convirtiera en «redundante» rompería el enum cerrado del esquema y con
  // él `rubric_sin_vara`, que es lo único que hoy dice si hubo vara.
  it('la señal redundante es un finding, no un outcome nuevo: el ítem sigue conforme', () => {
    expect(itemObservabilidad().replace(/\s+/g, ' ')).toContain('still `conforme`')
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.items.properties.outcome.enum).toBe(RUBRIC_OUTCOMES)
    for (const valor of RUBRIC_OUTCOMES) expect(itemObservabilidad()).toContain(valor)
  })

  // La calibración de severidades del ítem nombra el caso: un juez que sólo lea
  // ese párrafo no puede convertirlo en un veto ni en un round trip pagado.
  it('la severidad del smell vive también en «Severity, decided here»', () => {
    const sev = /\*\*Severity, decided here:\*\*[\s\S]*?(?=\n\n)/.exec(itemObservabilidad())
    expect(sev).not.toBeNull()
    expect(sev[0].replace(/\s+/g, ' ')).toContain('restated an acceptance criterion is `low`')
  })
})

// ---------------------------------------------------------------------------
// EL RECONCILIADOR (Reconciliación de ramas, Tarea 9): `agents/ct-reconciler.md`.
// A diferencia de los dos jueces de arriba, invierte la asimetría en vez de
// repetirla — `Edit` en vez de `Write`, y ni `Bash` ni `Write` — porque git no
// da un fichero en conflicto por resuelto hasta que alguien lo stagea, y el
// único que puede es el programa (`BranchReconciliation.conclude()`), nunca
// el agente. Este invariante sostiene TODA la higiene del diseño (un
// reconciliador que pudiera stagear o crear ficheros podría esconder una
// resolución mala detrás de un `git status` verde), así que va pinado con las
// AUSENCIAS comprobadas explícitamente y no sólo las presencias.
// ---------------------------------------------------------------------------
describe('el reconciliador (Reconciliación de ramas, Tarea 9)', () => {
  it('declara exactamente Read, Grep, Glob, Edit — ni Bash ni Write', () => {
    expect(toolsDelReconciliador()).toBe('Read, Grep, Glob, Edit')
    expect(toolsDelReconciliador()).not.toMatch(/\bBash\b/)
    expect(toolsDelReconciliador()).not.toMatch(/\bWrite\b/)
  })

  it('la constante RECONCILER_TOOLS no puede divergir del agente que se despacha', () => {
    // Mismo fallo que ya sufrieron JUDGE_TOOLS y SLICE_JUDGE_TOOLS: una
    // constante copiada a mano que se queda atrás del frontmatter real.
    expect(RECONCILER_TOOLS).toBe(toolsDelReconciliador())
    expect(RECONCILER_TOOLS).not.toMatch(/\bBash\b/)
    expect(RECONCILER_TOOLS).not.toMatch(/\bWrite\b/)
  })

  it('el reconciliador puede editar ficheros que ya existen: es el único canal por el que resuelve', () => {
    expect(toolsDelReconciliador()).toMatch(/\bEdit\b/)
  })
})

describe('el veredicto', () => {
  const v = (ruling, findings = [], rubric = recorridoCompleto()) => readVerdict({ ruling, rubric, findings, review_token: TOKEN })

  it('un PASA limpio se lee y vale', () => {
    expect(v('PASS').verdict).toEqual({ ruling: 'PASS', rubric: recorridoCompleto(), findings: [], review_token: TOKEN })
  })

  it.each([
    ['sin structured_output', null, /no devolvió structured_output/],
    ['con un ruling inventado', { ruling: 'MAYBE', findings: [] }, /ruling desconocido/],
    ['con findings que no es lista', { ruling: 'PASS', findings: 'ninguno' }, /no es una lista/],
    ['con una severidad inventada', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'catastrophic', what: 'x', path: 'y', evidence: 'z' }] }, /severidad desconocida/],
    ['con un hallazgo mudo', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'high', what: '', path: 'y', evidence: 'z' }] }, /no dice qué o dónde/],
    // Sin fijar este caso, una regresión que cambiara la condición a
    // `f.rule && !VERDICT_RULES.includes(f.rule)` dejaría pasar en silencio
    // un hallazgo sin `rule` — sólo cazaría la regla INVENTADA, no la AUSENTE.
    ['con un hallazgo sin rule', { ruling: 'FAIL', findings: [{ severity: 'high', what: 'x', path: 'y', evidence: 'z' }] }, /regla desconocida/],
  ])('se descarta %s', (_caso, structured, motivo) => {
    const r = readVerdict(structured)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(motivo)
  })

  it('un PASS con un hallazgo grave se descarta: se contradice a sí mismo', () => {
    // No se interpreta hacia el lado prudente. Un juez que no se entiende a sí
    // mismo no ha juzgado, y volver a preguntar cuesta menos que decidir por él.
    const r = v('PASS', [{ rule: 'contrato', severity: 'high', what: 'sql injection', path: 'db.js', line: 10, evidence: 'query(`… ${id}`)' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/contradice la rúbrica/)
  })

  it('el hallazgo nombra la regla que incumple', () => {
    const r = v('FAIL', [{ rule: 'manipulacion-tests', severity: 'high', what: 'debilitó una aserción', path: 'a.test.js', line: 12, evidence: '-  expect(x).toBe(3)' }])
    expect(r.verdict.findings[0].rule).toBe('manipulacion-tests')
  })

  it('una regla fuera del enum descarta el veredicto', () => {
    // El mismo criterio que ya aplica a un ruling inventado: una regla que no
    // está en VERDICT_RULES no es un hallazgo sin justificar, es un dato que no
    // se entiende — se descarta y se vuelve a preguntar, no es un error.
    const r = v('FAIL', [{ rule: 'me-lo-invento', severity: 'high', what: 'x', path: 'y', evidence: 'z' }])
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
  it('el veredicto trae el paseo por todos los ítems, y viaja dentro de él', () => {
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
    const recorrido = [...recorridoCompleto().slice(1), { rule: 'me-lo-invento', result: 'bien', outcome: 'conforme' }]
    const r = v('PASS', [], recorrido)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/ítem desconocido/)
  })

  it('se descarta un recorrido que repite un ítem: un paso de más no es un ítem más', () => {
    // Una entrada de más con todos los identificadores presentes: sin la
    // comprobación de repetidos, un recuento por conjunto los daría todos por
    // recorridos y el duplicado pasaría. Es el mismo criterio que readReport
    // aplica a una ruta declarada dos veces.
    const r = v('PASS', [], [...recorridoCompleto(), { rule: 'alcance', result: 'otra vez', outcome: 'conforme' }])
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

  it('el motivo del descarte cuenta los ítems que la rúbrica tiene hoy, no los que tenía', () => {
    // El mensaje decía "ocho" en literal, y el noveno ítem lo convirtió en una
    // mentira dirigida justo al agente que tiene que volver a contestar.
    const r = v('PASS', [], recorridoCompleto().filter((paso) => paso.rule !== 'test-desiderata'))
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/test-desiderata/)
    expect(r.why).toContain(String(VERDICT_RULES.length))
  })

  it('se descarta el ítem que se nombra pero no dice lo que dio: un texto vacío es el ítem sin abrir otra vez', () => {
    // Ocho identificadores sin resultado son el mismo artefacto que el PASS
    // con hallazgos vacíos, sólo que más largo.
    const recorrido = recorridoCompleto().map((paso) => (paso.rule === 'patrones' ? { rule: 'patrones', result: '   ', outcome: 'conforme' } : paso))
    const r = v('PASS', [], recorrido)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/patrones/)
  })

  // -------------------------------------------------------------------------
  // LA VARA VACÍA. El recorrido ya distinguía "no se miró" de "se miró"; dentro
  // de "se miró" seguían colapsando dos cosas distintas, y una es un agujero:
  // un ítem sin SUJETO (no hay tests previos que debilitar) y un ítem sin
  // INSUMO (el plan no nombró ningún patrón). El segundo es un juez que dijo
  // PASS a ciegas, y en prosa se lee igual que el primero. Es la mitad de H5.
  // -------------------------------------------------------------------------
  it('cada paso del recorrido dice de qué clase fue su resultado', () => {
    const r = v('PASS')
    expect(r.verdict.rubric.every((paso) => RUBRIC_OUTCOMES.includes(paso.outcome))).toBe(true)
  })

  it('se descarta el paso que no dice de qué clase fue: es "N/A" indistinguible de "conforme" otra vez', () => {
    const recorrido = recorridoCompleto().map(({ rule, result }) => ({ rule, result }))
    const r = v('PASS', [], recorrido)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/de qué clase/)
  })

  it('se descarta una clase inventada, con el mismo criterio que una regla inventada', () => {
    const recorrido = recorridoCompleto().map((paso) => (paso.rule === 'patrones' ? { ...paso, outcome: 'regular' } : paso))
    const r = v('PASS', [], recorrido)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/patrones/)
    expect(RUBRIC_OUTCOMES).not.toContain('regular')
  })

  it('un ítem sin vara viaja en el veredicto, y no bloquea: lo que hace es dejar de esconderse', () => {
    // El caso de rust-monitoring, ahora legible. `patrones` sin patrón que
    // citar sigue dando un PASS —no es un defecto del implementador—, pero el
    // fichero ya dice que ese ítem se recorrió sin nada con lo que medir.
    const recorrido = recorridoCompleto().map((paso) => (
      paso.rule === 'patrones'
        ? { rule: 'patrones', result: 'el plan dice "N/A": no hay patrón que comparar', outcome: 'sin-vara' }
        : paso))
    const r = v('PASS', [], recorrido)
    expect(r.verdict.ruling).toBe('PASS')
    expect(r.verdict.rubric.find((paso) => paso.rule === 'patrones').outcome).toBe('sin-vara')
  })

  // -------------------------------------------------------------------------
  // LA CITA. La rúbrica ya exigía citar antes de bloquear, pero en PROSA y en
  // un fichero donde compite con ocho ítems que hay que recorrer de verdad. Un
  // campo obligatorio no se olvida.
  // -------------------------------------------------------------------------
  it('se descarta el hallazgo que no cita la evidencia que lo sostiene', () => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'la firma no casa', path: 'a.js', line: 3 }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/evidencia/)
  })

  it('la cita se exige también en un medium: es el que manda al implementador a una vuelta pagada', () => {
    // Un campo obligatorio sólo para `high` se olvida igual que la prosa, y un
    // `medium` sin cita cuesta un viaje de ida y vuelta sin decir qué mirar.
    const r = v('PASS', [{ rule: 'alcance', severity: 'medium', what: 'un helper que nadie pidió', path: 'a.js', line: 9 }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/evidencia/)
  })

  // -------------------------------------------------------------------------
  // LA UBICACIÓN, EN DOS CAMPOS. Era la cadena `"path:line"`, y lo que impedía
  // es agregar: partir por el último `:` una cadena que escribió un modelo es
  // adivinar. §3.13 del handoff.
  // -------------------------------------------------------------------------
  it('el hallazgo ubica en dos campos, y el veredicto los conserva separados', () => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'la firma no casa', path: 'src/db.js', line: 10, evidence: 'function q(id, extra)' }])
    expect(r.verdict.findings[0].path).toBe('src/db.js')
    expect(r.verdict.findings[0].line).toBe(10)
  })

  it('se descarta el hallazgo que no dice en qué fichero está', () => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'la firma no casa', line: 10, evidence: 'z' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/no dice qué o dónde/)
  })

  it.each([
    ['sin línea', {}],
    ['con la línea a null', { line: null }],
  ])('un hallazgo del fichero entero vale %s: la línea no es obligatoria', (_caso, extra) => {
    // Exigir línea siempre sólo compra un número inventado o un descarte más de
    // los seis que matan el run (§3.2 del handoff).
    const r = v('FAIL', [{ rule: 'alcance', severity: 'high', what: 'este fichero no lo pide ninguna frase', path: 'src/de-mas.js', evidence: '**Files:** src/a.js', ...extra }])
    expect(r.verdict.findings[0].path).toBe('src/de-mas.js')
  })

  it.each([
    ['una cadena', '12'],
    ['un rango', '12-18'],
    ['un cero', 0],
    ['un decimal', 3.5],
  ])('se descarta el hallazgo cuya línea es %s: lo que no es número no se agrega', (_caso, line) => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'x', path: 'a.js', line, evidence: 'z' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/línea que no es un número/)
  })

  // -------------------------------------------------------------------------
  // Slice 11 — EL TOKEN DEL PAQUETE. El insumo se ataba (slice 6: un paquete
  // consumido no se puede reutilizar); esto ata el otro sentido: nada ligaba
  // el verdict.json AL paquete. El paquete declara en su cabecera el sha256
  // del diff que capturó; el juez lo copia en `review_token`; y `readVerdict`
  // exige que el campo llegue con forma de sha256 — quién decide si es EL DEL
  // PAQUETE es ct-step.mjs, que es quien tiene git delante.
  // -------------------------------------------------------------------------
  it('el token del paquete es el sha256 del diff que captura, y su línea la escribe el módulo', () => {
    const diff = 'diff --git a/uno.txt b/uno.txt\n@@ -0,0 +1 @@\n+uno\n'
    expect(reviewToken(diff)).toBe(createHash('sha256').update(diff, 'utf8').digest('hex'))
    expect(reviewTokenLine(reviewToken(diff))).toBe(`${REVIEW_TOKEN_LABEL}: ${reviewToken(diff)}`)
  })

  it('el lector del token no puede divergir del escritor: los dos salen de REVIEW_TOKEN_LABEL', () => {
    const t = reviewToken('lo que sea')
    expect(reviewTokenOf(`# Review package\n${reviewTokenLine(t)}\n\n## Diff\n`)).toBe(t)
  })

  it('un paquete sin la línea, o con algo que no es un sha256, no declara ningún token', () => {
    expect(reviewTokenOf('# Review package\n\n## Diff\n')).toBeNull()
    expect(reviewTokenOf('Review token: no-soy-un-sha\n')).toBeNull()
    expect(reviewTokenOf(`Review token: ${'a'.repeat(63)}\n`)).toBeNull()
    expect(reviewTokenOf(null)).toBeNull()
  })

  it('readVerdict exige el review_token, y el motivo nombra la línea de la que se copia', () => {
    const r = readVerdict({ ruling: 'PASS', rubric: recorridoCompleto(), findings: [] })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toContain(REVIEW_TOKEN_LABEL)
    expect(r.why).toContain('review_token')
  })

  it('un review_token que no es un sha256 de 64 hex se descarta', () => {
    for (const malo of ['12', 'a'.repeat(63), 'z'.repeat(64), 123, null, undefined]) {
      expect(readVerdict({ ruling: 'PASS', rubric: recorridoCompleto(), findings: [], review_token: malo }).verdict).toBeUndefined()
    }
  })

  it('un review_token en mayúsculas se acepta y se guarda en minúsculas: copiar un hex no es teclear un permiso', () => {
    // El precedente es matchesGo: el token se compara en minúsculas para que un
    // reformateo no cueste un descarte con el veredicto correcto dentro.
    const r = readVerdict({ ruling: 'PASS', rubric: recorridoCompleto(), findings: [], review_token: 'A'.repeat(64) })
    expect(r.verdict.review_token).toBe('a'.repeat(64))
  })

  it('el review_token viaja DENTRO del veredicto validado: es lo que se comitea y lo que se compara', () => {
    expect(v('PASS').verdict.review_token).toBe(TOKEN)
  })

  it('review_token está en VERDICT_SCHEMA.required, no sólo en el validador', () => {
    expect(VERDICT_SCHEMA.required).toContain('review_token')
    expect(SLICE_VERDICT_SCHEMA.required).toContain('review_token')
  })

  it('la FORMA del token la declara UNA constante: el pattern del esquema y el validador no divergen', () => {
    // Se comprueba por COMPORTAMIENTO y no comparando la constante consigo misma:
    // para cada muestra, lo que el `pattern` del esquema acepta es exactamente lo
    // que `readVerdict` acepta. Si una de las dos copias se cambiara —la más
    // probable, poner el pattern en minúsculas— la muestra en mayúsculas las
    // separa y esto cae.
    const pattern = VERDICT_SCHEMA.properties.review_token.pattern
    expect(SLICE_VERDICT_SCHEMA.properties.review_token.pattern).toBe(pattern)
    const re = new RegExp(pattern)
    for (const muestra of ['a'.repeat(64), 'A'.repeat(64), 'aB3'.repeat(21) + 'f', 'a'.repeat(63),
                           'a'.repeat(65), 'z'.repeat(64), '', `${'a'.repeat(64)}\n`, ` ${'a'.repeat(64)}`]) {
      const loDiceElEsquema = re.test(muestra)
      const loDiceElValidador = readVerdict({ ruling: 'PASS', rubric: recorridoCompleto(), findings: [], review_token: muestra }).verdict !== undefined
      expect(loDiceElValidador, JSON.stringify(muestra)).toBe(loDiceElEsquema)
    }
  })
})

describe('de veredicto a resultado de la tabla', () => {
  const o = (ruling, findings = []) => outcomeOfVerdict({ ruling, findings })

  it('FAIL es un veto', () => {
    expect(o('FAIL', [{ severity: 'high', what: 'x', path: 'y' }])).toBe('failed')
  })

  it('PASS limpio entrega', () => {
    expect(o('PASS')).toBe('done')
  })

  it('PASS con hallazgos sólo de severidad baja entrega igual', () => {
    // Si cada nimiedad volviera al implementador, el bucle no terminaría nunca.
    expect(o('PASS', [{ severity: 'low', what: 'nombre mejorable', path: 'a.js' }])).toBe('done')
  })

  it('PASS con un hallazgo medio es un refunfuño: corrige, pero no bloquea', () => {
    expect(o('PASS', [{ severity: 'medium', what: 'falta un caso', path: 'a.test.js' }])).toBe('corrections-ordered')
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
    findings: [{ rule: 'contrato', severity: 'high', what: 'x', path: 'y', evidence: 'z' }],
    review_token: TOKEN,
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

  it('el esquema del recorrido no duplica los identificadores: los toma de VERDICT_RULES', () => {
    // Identidad y no igualdad a propósito. Una segunda lista con los mismos
    // valores pasaría un toEqual y divergiría en el primer renombrado,
    // que es el fallo que este fichero ya caza dos veces (JUDGE_TOOLS y
    // VERDICT_RULES contra ct-judge.md).
    expect(VERDICT_SCHEMA.properties.rubric.items.properties.rule.enum).toBe(VERDICT_RULES)
  })

  it('el esquema del outcome tampoco duplica sus tres valores: los toma de RUBRIC_OUTCOMES', () => {
    expect(VERDICT_SCHEMA.properties.rubric.items.properties.outcome.enum).toBe(RUBRIC_OUTCOMES)
  })

  it('el esquema pide el recorrido entero: ni un paso más, ni uno menos', () => {
    expect(VERDICT_SCHEMA.properties.rubric.minItems).toBe(VERDICT_RULES.length)
    expect(VERDICT_SCHEMA.properties.rubric.maxItems).toBe(VERDICT_RULES.length)
  })
})

// La ubicación se recompone en un solo sitio: el aviso de corrección la quiere
// de una pieza, y la cosecha la querrá mañana.
describe('la ubicación de un hallazgo, de dos campos a una pieza', () => {
  it('con línea es `path:line`', () => {
    expect(findingLocation({ path: 'src/a.js', line: 4 })).toBe('src/a.js:4')
  })

  it.each([
    ['sin línea', { path: 'src/a.js' }],
    ['con la línea a null', { path: 'src/a.js', line: null }],
  ])('%s es sólo el fichero, que es lo que ese hallazgo dice', (_caso, f) => {
    expect(findingLocation(f)).toBe('src/a.js')
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

