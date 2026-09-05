export class PluginYardstick {
  static DIRECTORY = 'conventions'

  static FILES = ['defects.md', 'style.md', 'decisions.md', 'architecture.md', 'testing.md']

  // El encabezado con el que la vara por ruta entra en un paquete. Es una
  // constante y no una cadena tecleada dos veces por lo mismo que
  // PACKAGE_SECTIONS: la rúbrica del juez lo cita por su nombre, y un
  // encabezado renombrado aquí lo dejaría señalando una sección que no existe.
  static PATH_SECTION = 'Vara de ct'

  static #PRECEDENCE_HEADER = [
    '> **La vara de ct**, leída del directorio `conventions/` del plugin por el',
    '> programa: ningún agente la escribió en este brief y el plan no puede',
    '> quitarla. Cada documento declara su alcance en su propia cabecera',
    '> (`Applies to:`) y el programa te da SÓLO los que alcanzan a esta tarea:',
    '> `architecture.md` rige los MÓDULOS NUEVOS, así que viaja cuando la tarea',
    '> declara alguna ruta `(create)` y no cuando sólo modifica lo que ya estaba;',
    '> los demás alcanzan a todo diff.',
    '>',
    '> **Tiene preferencia sobre las convenciones de este repo, y la preferencia se',
    '> mide regla a regla, no por tema.** Donde una regla del repo manda hacer algo',
    '> que uno de estos documentos prohíbe, o prohíbe algo que exigen, esa regla del',
    '> repo no aplica. Donde una regla del repo dice algo de lo que ninguno de ellos',
    '> habla, **obliga entera**: esto no anula la vara del repo, resuelve el choque.',
    '>',
    '> El caso que fija la frontera, con sus dos lados: la convención de mayúsculas,',
    '> prefijos o nombres de fichero de este repo **obliga**, porque ninguno de estos',
    '> documentos habla de eso. Su convención de escribir los identificadores en',
    '> castellano **no**, porque `conventions/style.md` exige inglés.',
    '>',
    '> Una convención del repo no tiene por qué estar escrita: puede estar',
    '> automatizada en una herramienta propia —un linter que exige algo, por',
    '> ejemplo— que la verificación de la tarea ejecuta **antes** de que nadie',
    '> juzgue el diff. Esa regla **obliga de todas formas**, aunque uno de estos',
    '> documentos diga otra cosa: seguir a ct y dejar la verificación en rojo no es',
    '> una salida. Un choque real de ese tipo se **declara en el informe**, no se',
    '> resuelve dejando la tarea en rojo.',
  ]

  // La cabecera tal cual entra en un artefacto: separada de lo que venía antes.
  static #headerLines() {
    return ['', '---', '', ...PluginYardstick.#PRECEDENCE_HEADER, '']
  }

  // EL ALCANCE LO DECLARA EL DOCUMENTO, no una tabla de este módulo. Cada
  // documento de `conventions/` abre con una línea `Applies to:` —
  // `architecture.md` dice **new modules**, los otros cuatro **every diff**—
  // y eso es lo que se lee: una tabla aquí sería la misma decisión escrita dos
  // veces (`conventions/decisions.md`), y el día que un documento nuevo
  // declarara su alcance nadie se acordaría de venir a copiarlo.
  //
  // Se normaliza el énfasis y el punto final porque la cabecera se escribe en
  // markdown ("Applies to: **new modules**.") y lo que decide es el texto, no
  // los asteriscos.
  static #SCOPE_LINE = /^Applies to:\s*(.+)$/m

  static #NEW_MODULES = /new modules/i

  static scopeOf(content) {
    const match = PluginYardstick.#SCOPE_LINE.exec(String(content ?? ''))
    if (!match) return null
    const scope = match[1].replace(/[*`]/g, '').replace(/\.\s*$/, '').trim()
    return scope === '' ? null : scope
  }

  // UN DOCUMENTO QUE NO DECLARA ALCANCE VIAJA SIEMPRE. La alternativa
  // —dejarlo fuera— haría que añadir un documento sin cabecera lo dejara mudo
  // en silencio, y este módulo aborta antes que medir contra nada.
  static appliesToTask(document, { creates }) {
    const scope = PluginYardstick.scopeOf(document?.content)
    if (scope === null) return true
    return PluginYardstick.#NEW_MODULES.test(scope) ? Boolean(creates) : true
  }

  // `creates`: si la tarea declara alguna ruta `(create)` en sus **Files:**.
  // Es lo único de la tarea que este módulo necesita saber, y quien lo mide es
  // quien tiene el plan delante (ct-step.mjs).
  static forTask(documents, { creates }) {
    return (Array.isArray(documents) ? documents : [])
      .filter((document) => PluginYardstick.appliesToTask(document, { creates }))
  }

  static missingDocuments(documents) {
    const contentByName = new Map()
    for (const document of Array.isArray(documents) ? documents : []) {
      contentByName.set(document?.name, document?.content)
    }
    return PluginYardstick.FILES.filter((name) => {
      const content = contentByName.get(name)
      return typeof content !== 'string' || content.trim() === ''
    })
  }

  // LO QUE LLEGA YA VIENE FILTRADO POR ALCANCE (`forTask`), así que componer
  // cuatro documentos es el camino normal de una tarea que no crea ningún
  // módulo — no media promesa. Lo que sigue siendo media promesa, y por eso
  // sigue abortando, es un documento que se pide y llega vacío (medir contra
  // nada no se distingue en silencio de medir contra la regla) y una lista sin
  // ningún documento que componer: un encabezado que no lleva nada detrás.
  //
  // Que estén los CINCO en el plugin se comprueba aparte, con
  // `missingDocuments`, y lo hace quien los lee del disco (ct-step.mjs): una
  // instalación rota se aborta antes de filtrar nada.
  static #blankDocuments(documents) {
    return (Array.isArray(documents) ? documents : [])
      .filter((document) => typeof document?.content !== 'string' || document.content.trim() === '')
      .map((document) => document?.name ?? '(sin nombre)')
  }

  // LA CABECERA, EXPORTADA. Es la ÚNICA fuente de la regla de precedencia y de
  // qué documentos alcanzan a qué, y quien la necesita fuera de un brief la
  // pide aquí en vez de volver a escribirla: el kickoff del backend
  // (`backend/src/infrastructure/plan-agent-brief.js`) la escribía por su
  // cuenta y su copia acabó diciendo lo contrario que ésta sobre
  // `architecture.md`. Una regla, un sitio.
  static precedenceHeader() {
    return PluginYardstick.#PRECEDENCE_HEADER.join('\n')
  }

  static #refuse(missing) {
    throw new Error(
      `PluginYardstick.composeSection: cannot compose the ct yardstick without ${missing.join(', ')}. ` +
        'Callers must ask `missingDocuments` first and decide what to do: this method never composes ' +
        'a header that promises documents it does not carry.'
    )
  }

  static #ordered(documents) {
    const blank = PluginYardstick.#blankDocuments(documents)
    if (blank.length) PluginYardstick.#refuse(blank)
    const orderByName = new Map(PluginYardstick.FILES.map((name, index) => [name, index]))
    const orderedDocuments = [...(documents ?? [])]
      .filter((document) => orderByName.has(document?.name))
      .sort((a, b) => orderByName.get(a.name) - orderByName.get(b.name))
    if (orderedDocuments.length === 0) PluginYardstick.#refuse([`any of ${PluginYardstick.FILES.join(', ')}`])
    return orderedDocuments
  }

  static composeSection(documents) {
    const sections = PluginYardstick.#headerLines()
    for (const document of PluginYardstick.#ordered(documents)) {
      const body = document.content.endsWith('\n') ? document.content : `${document.content}\n`
      sections.push(`## Vara de ct: ${PluginYardstick.DIRECTORY}/${document.name}`, '', body)
    }
    return sections.join('\n')
  }

  // LA MISMA VARA, POR RUTA. Quien la recibe así —el juez y el
  // reconciliador— tiene `Read`, que es el mismo criterio con el que ya le
  // llegan el plan y los ficheros que el diff toca: pegarle 24 KB que puede
  // abrir por su cuenta es material fijo delante del diff, no vara que llegue
  // mejor.
  //
  // La CABECERA es la misma —una regla, una fuente— y por eso esto vive aquí
  // y no en quien escribe cada paquete.
  //
  // La ruta la trae cada documento, no se compone aquí: este módulo es puro y
  // no sabe dónde está instalado el plugin.
  static composePathSection(documents) {
    const ordered = PluginYardstick.#ordered(documents)
    const sinRuta = ordered.filter((document) => typeof document.path !== 'string' || document.path.trim() === '')
    if (sinRuta.length) PluginYardstick.#refuse(sinRuta.map((document) => document.name))
    return [
      ...PluginYardstick.#headerLines(),
      `## ${PluginYardstick.PATH_SECTION}`,
      '',
      'No van pegados: ábrelos con `Read`, y cita el documento y la regla de la que hables.',
      '',
      ...ordered.map((document) => `- \`${document.path}\``),
      '',
    ].join('\n')
  }
}
