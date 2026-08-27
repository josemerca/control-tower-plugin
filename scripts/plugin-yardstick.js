export class PluginYardstick {
  static DIRECTORY = 'conventions'

  static FILES = ['defects.md', 'style.md', 'decisions.md', 'architecture.md', 'testing.md']

  static #PRECEDENCE_HEADER = [
    '',
    '---',
    '',
    '> **La vara de ct**, leída del directorio `conventions/` del plugin por el',
    '> programa: ningún agente la escribió en este brief y el plan no puede',
    '> quitarla. Cada documento declara su alcance en su propia cabecera.',
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
    '',
  ]

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

  static composeSection(documents) {
    const missing = PluginYardstick.missingDocuments(documents)
    if (missing.length) {
      throw new Error(
        `PluginYardstick.composeSection: cannot compose the ct yardstick without ${missing.join(', ')}. ` +
          'Callers must ask `missingDocuments` first and decide what to do: this method never composes ' +
          'a header that promises documents it does not carry.'
      )
    }

    const orderByName = new Map(PluginYardstick.FILES.map((name, index) => [name, index]))
    const orderedDocuments = [...(documents ?? [])]
      .filter((document) => orderByName.has(document?.name))
      .sort((a, b) => orderByName.get(a.name) - orderByName.get(b.name))

    const sections = [...PluginYardstick.#PRECEDENCE_HEADER]
    for (const document of orderedDocuments) {
      const body = document.content.endsWith('\n') ? document.content : `${document.content}\n`
      sections.push(`## Vara de ct: ${PluginYardstick.DIRECTORY}/${document.name}`, '', body)
    }
    return sections.join('\n')
  }
}
