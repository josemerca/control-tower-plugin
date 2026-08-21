// ============================================================================
// GO-RESPONSE — el "go" del gate `plan`, leído por una máquina.
//
// EL DEFECTO QUE CIERRA. El gate `plan` (scripts/gates.js) le dice al agente:
// «publícalo como comentario del issue y PARA — no implementes nada hasta que un
// humano responda OK en ese comentario». El humano contesta en GitHub… y NADIE
// LO LEE: ni un fichero de este plugin leía comentarios de issue. Así que el
// «ok» de GitHub no tenía ninguna consecuencia mecánica —era un registro— y el
// go que de verdad reanudaba el trabajo era el que la persona teclaba a mano en
// la sesión de cmux. Dos veces el mismo permiso, y el que contaba no era el que
// queda escrito.
//
// Medido en jjponz/rust-monitoring#2: el plan se publicó a las 15:31:48, el «ok»
// llegó a las 15:33:53, y la primera tarea no apareció comiteada hasta las
// ~15:39 — el hueco es una persona yendo a la ventana a empujar la sesión.
//
// POR QUÉ COINCIDENCIA EXACTA Y NO «CONTIENE OK». Porque el modo de fallo no es
// simétrico. Un token que no se reconoce te deja esperando, y lo notas: vas a
// mirar. Un token reconocido de más ARRANCA EL TRABAJO, y «ok pero cambia el
// nombre» arrancaría exactamente lo que la persona quería frenar. Ante la duda,
// no se arranca: por eso `-OK` con cualquier cosa detrás NO es un go. No hay
// categoría de «malformado» a propósito — sería una tercera respuesta que
// alguien tiene que aprender, y la que existe ya cubre el caso: si escribes algo
// que no es exactamente `-OK`, no pasa nada, y eso es lo que querías.
//
// LA VENTANA ES EL TIEMPO, NO UN MARCADOR. Sólo cuentan los comentarios
// POSTERIORES al arranque del vigilante. `agentic-skills` acota su ventana a los
// comentarios posteriores al del entendimiento, y para eso necesita reconocer
// ese comentario por un marcador que escribe el agente
// (`UnderstandingComment.is_the_understanding`) — o sea que su ventana depende
// del agente al que vigila. Aquí no hace falta: el vigilante sabe cuándo
// arrancó y `gh` da el `createdAt` de cada comentario, así que la ventana sale
// de dos datos que no pasan por ningún agente.
//
// Y da gratis la propiedad que de verdad importa: un `-OK` de un despacho
// ANTERIOR del mismo issue no arranca nada, porque es más viejo que este
// vigilante. Sin ventana, redespachar un slice cuyo issue ya tenía un go
// heredaría ese go y saltaría el gate en silencio.
//
// Módulo PURO: no habla con `gh`, no mira el reloj, no lanza procesos. Recibe
// los comentarios y el instante de corte, y contesta. Quien hace la entrada y
// salida es scripts/ct-watch-go.mjs.
// ============================================================================

// El token, exacto y en una sola línea. Se exporta porque lo nombran el que lo
// busca (este módulo), el que lo explica al humano (gates.js) y sus tests: una
// cadena tecleada en tres sitios acaba divergiendo en uno, que es el desacople
// que este repo ya pagó con JUDGE_TOOLS, VERDICT_RULES y PACKAGE_SECTIONS.
export const GO_TOKEN = '-OK'

// `createdAt` de gh viene en ISO 8601 con Z. Un comentario cuya fecha no se
// puede interpretar NO cuenta: es el mismo criterio que el resto del loop
// —ante un dato que no se entiende no se decide por él—, y aquí el lado
// prudente es claro, porque el que no cuenta sólo hace esperar.
function instanteDe(comentario) {
  const t = Date.parse(comentario?.createdAt ?? '')
  return Number.isNaN(t) ? null : t
}

// ¿Hay un go en esta ventana? `desde` es el instante de arranque del vigilante
// en milisegundos (el mismo reloj que Date.parse devuelve).
//
// Se recorre AL REVÉS y se contesta con el primero que se reconoce, o sea el
// ÚLTIMO en el tiempo: si alguien escribe `-OK` y luego se arrepiente, lo que
// vale es lo último que dijo. (Hoy sólo hay una respuesta reconocible, así que
// recorrer al revés y buscar «alguno» dan lo mismo; se recorre al revés porque
// es lo que sigue siendo correcto el día que haya una segunda respuesta, y
// porque el coste es cero.)
export function hasGo(comentarios, desde) {
  for (const comentario of [...(comentarios || [])].reverse()) {
    const cuando = instanteDe(comentario)
    if (cuando === null || cuando < desde) continue
    if (String(comentario.body ?? '').trim() === GO_TOKEN) return true
  }
  return false
}
