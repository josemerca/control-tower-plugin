// ============================================================================
// GO-RESPONSE — el "go" del gate `plan`, leído por una máquina.
//
// EL DEFECTO QUE CIERRA. El gate `plan` (scripts/gates.js) le dice al agente:
// «publícalo como comentario del issue y PARA — no implementes nada hasta que un
// humano conteste». El humano contestaba en GitHub… y NADIE LO LEÍA: ni un
// fichero de este plugin leía comentarios de issue. Así que el «ok» de GitHub no
// tenía ninguna consecuencia mecánica —era un registro— y el go que de verdad
// reanudaba el trabajo era el que la persona teclaba a mano en la sesión de
// cmux. Dos veces el mismo permiso, y el que contaba no era el que queda
// escrito.
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
// ---------------------------------------------------------------------------
// LA VENTANA ES EL CONJUNTO DE COMENTARIOS QUE YA ESTABAN, NO UNA FECHA DE
// CORTE. Y esto es una corrección, no una preferencia.
//
// La primera versión cortaba por tiempo: valían los comentarios cuyo `createdAt`
// fuera posterior al arranque del vigilante. Parecía limpio y estaba roto, y lo
// cazó una revisión adversarial: `createdAt` lo pone el servidor de GitHub y el
// instante de corte lo ponía `Date.now()` de esta máquina. Son DOS RELOJES. Con
// el local atrasado quince minutos, un `-OK` heredado de un despacho anterior
// entraba en la ventana y saltaba el gate EN SILENCIO —justo lo que la ventana
// existía para impedir—; con el local adelantado, un `-OK` legítimo escrito en
// los primeros minutos quedaba fuera y no volvía a entrar nunca, porque su
// `createdAt` no cambia de un sondeo al siguiente.
//
// Ahora la ventana son IDENTIFICADORES: el vigilante fotografía los `id` de los
// comentarios que había al arrancar (`gh` los da: `IC_kwDO…`), y cuenta como
// respuesta cualquier comentario cuyo `id` no estuviera en esa foto. No hay
// ningún reloj implicado, ni el de GitHub ni el nuestro, así que no hay deriva
// que pueda romperlo. Y es más simple: se fue el `Date.parse` entero.
//
// La propiedad que la ventana sostiene sigue siendo la misma, y es la que
// importa: un `-OK` de un despacho ANTERIOR del mismo issue no arranca nada.
// Sin ella, redespachar un slice cuyo issue ya tenía un go heredaría ese go y
// saltaría el gate sin que nadie se enterara.
// ---------------------------------------------------------------------------
//
// Módulo PURO: no habla con `gh`, no mira el reloj (ya no hay reloj), no lanza
// procesos. Recibe los comentarios y la foto inicial, y contesta. Quien hace la
// entrada y salida es scripts/ct-watch-go.mjs.
// ============================================================================

// El token, exacto y en una sola línea. Se exporta porque lo nombran el que lo
// busca (este módulo), los dos textos que lo explican al agente y al humano
// (gates.js) y sus tests: una cadena tecleada en cuatro sitios acaba
// divergiendo en uno, que es el desacople que este repo ya pagó con
// JUDGE_TOOLS, VERDICT_RULES y PACKAGE_SECTIONS. Y aquí el fallo sería mudo: se
// renombra el token, los textos siguen diciendo lo de antes, la persona escribe
// lo que le dijeron y el trabajo no arranca nunca sin que nada falle.
export const GO_TOKEN = '-OK'

// Los `id` de los comentarios que ya estaban. Un comentario sin `id` legible NO
// entra en la foto: así, si apareciera luego, contaría como nuevo — que es el
// lado prudente aquí, porque el efecto de contarlo de más es esperar (el token
// tiene que ser exacto de todas formas), y el de contarlo de menos sería honrar
// un go viejo.
export function commentIds(comentarios) {
  const ids = new Set()
  for (const c of comentarios || []) {
    if (typeof c?.id === 'string' && c.id !== '') ids.add(c.id)
  }
  return ids
}

// ¿Hay un go entre los comentarios que NO estaban en la foto inicial?
//
// Se recorre AL REVÉS y se contesta con el primero que se reconoce, o sea el
// último de la lista. Hoy sólo hay una respuesta reconocible, así que esto da lo
// mismo que buscar «alguno» — y no implementa ningún «me arrepiento»: un `-OK`
// seguido de «espera, no» sigue siendo un go, porque lo único que este módulo
// reconoce es el token. Se recorre así porque es lo que sigue siendo correcto el
// día que haya una segunda respuesta, y porque el coste es cero.
export function hasGo(comentarios, idsPrevios) {
  const previos = idsPrevios instanceof Set ? idsPrevios : new Set(idsPrevios || [])
  for (const comentario of [...(comentarios || [])].reverse()) {
    const id = typeof comentario?.id === 'string' ? comentario.id : ''
    if (id !== '' && previos.has(id)) continue
    if (String(comentario?.body ?? '').trim() === GO_TOKEN) return true
  }
  return false
}
