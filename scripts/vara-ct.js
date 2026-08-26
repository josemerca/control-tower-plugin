// scripts/vara-ct.js
//
// LA VARA QUE DICTA CT (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md).
// El problema medido: el transporte de la vara del repo funciona, pero `/ct-init`
// siembra la declaración vacía, así que casi todo repo se quedaba `sin-vara` y el
// único ítem de calidad de la rúbrica no tenía nada que citar. Esto trae la vara
// puesta con el plugin.
//
// DOS VARAS, NO UNA. `scripts/vara.js` es el hermano de este fichero y sigue
// transportando la declaración del REPO, que sigue obligando en todo aquello de
// lo que estos cuatro documentos no hablan. La de ct sólo gana donde las dos
// hablan de lo mismo, y esa regla se escribe UNA vez: en la cabecera de aquí
// abajo, que es lo único que sabe que las dos están viajando juntas en un brief y
// lo único del bloque que ningún agente puede quitar.
//
// Y su ausencia falla distinto que la del repo: que falte `.agent/conventions.md`
// es benigno —es el estado normal de casi todo repo—, pero que falte uno de estos
// cuatro es una INSTALACIÓN ROTA del plugin, y por eso existe `faltasDeVara` y
// `ct-step` aborta con ella en la mano en vez de avisar.
//
// Este módulo es lógica pura: no lee disco. Quien hace el IO es
// `scripts/ct-step.mjs`, que resuelve las rutas con `PLUGIN_ROOT`.
//
// OJO, TRAMPA DE NOMBRE: esto NO es `scripts/conventions.js` ni
// `conventions-io.js`. Esos van de COLISIONES DE PROTOCOLO entre el loop y el
// repo destino (claim, worktrees, fichero de estado), con su propio
// `.agent/conventions-ack.md`. No los confundas por el nombre.

// El directorio, relativo a la raíz del PLUGIN.
export const CONVENTIONS_DIR = 'conventions'

// La lista, explícita y no barrida del disco: si se barriera, un fichero borrado
// por accidente reduciría la vara en silencio. Declarada, el borrado es una falta
// que aborta. El orden es el orden en que se pegan.
// `__tests__/vara-ct.test.js` la ata al directorio EN LAS DOS DIRECCIONES.
export const CONVENTIONS_FILES = ['code.md', 'decisions.md', 'architecture.md', 'testing.md']

// faltasDeVara: los nombres de `CONVENTIONS_FILES` que no llegan o llegan en
// blanco. Un documento vacío no es media vara: pone al implementador y al juez a
// medir con nada, y en silencio eso no se distingue de un ítem conforme.
//
// Es el ÚNICO predicado de "la vara está completa": lo consultan tanto el
// llamador, para decidir si aborta, como `seccionDeVaraDeCt`, para negarse a
// componer. Total frente a cualquier entrada: lo que no sea una lista de
// documentos con contenido de texto es una falta, no una excepción.
export function faltasDeVara(documentos) {
  const porNombre = new Map()
  for (const d of Array.isArray(documentos) ? documentos : []) porNombre.set(d?.nombre, d?.contenido)
  return CONVENTIONS_FILES.filter((nombre) => {
    const contenido = porNombre.get(nombre)
    return typeof contenido !== 'string' || contenido.trim() === ''
  })
}

// La cabecera. Los DOS lados del ejemplo son load-bearing: una consigna que sólo
// dice "gana ct" pone al juez a anular la vara del repo entera, naming incluido,
// que es exactamente lo que esta regla no dice. Y el ejemplo va aquí, y no en una
// lista de temas cubiertos al lado de los documentos, porque una lista así
// desactualizada da permiso a lo que la regla prohíbe.
const CABECERA = [
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
  '> castellano **no**, porque `conventions/code.md` exige inglés.',
  '',
]

// seccionDeVaraDeCt: lo que `ct-step.mjs` pega en cada task brief, ANTES de la
// sección de la vara del repo — la cabecera que fija la precedencia se lee antes
// de que llegue la vara sobre la que decide.
//
// Cada documento va bajo un encabezado con SU RUTA porque es lo que el juez tiene
// que poder citar: un hallazgo de ese ítem exige regla + ruta, y sin la ruta
// delante la cita se convierte en "esto se lee mal".
export function seccionDeVaraDeCt(documentos) {
  // Total o explícita, como pide `conventions/architecture.md`: con la vara
  // incompleta esta función NO devuelve una sección a medias, lanza. Una cabecera
  // que anuncia cuatro documentos sin traerlos es una promesa vacía en el prompt
  // de un agente, y en silencio no se distingue de una vara que sí llegó.
  const faltas = faltasDeVara(documentos)
  if (faltas.length) {
    throw new Error(
      `seccionDeVaraDeCt: no se puede componer la vara de ct sin ${faltas.join(', ')}. ` +
        'Quien llama pregunta antes por `faltasDeVara` y decide qué hacer: esta función no compone ' +
        'una cabecera que prometa documentos que no trae.'
    )
  }

  const orden = new Map(CONVENTIONS_FILES.map((n, i) => [n, i]))
  const ordenados = [...(documentos ?? [])]
    .filter((d) => orden.has(d?.nombre))
    .sort((a, b) => orden.get(a.nombre) - orden.get(b.nombre))

  const partes = [...CABECERA]
  for (const d of ordenados) {
    const cuerpo = d.contenido.endsWith('\n') ? d.contenido : `${d.contenido}\n`
    partes.push(`## Vara de ct: ${CONVENTIONS_DIR}/${d.nombre}`, '', cuerpo)
  }
  return partes.join('\n')
}
