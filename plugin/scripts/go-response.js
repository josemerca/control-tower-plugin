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
//
// `node:crypto` no rompe esa pureza: `createHash` es una función determinista
// del argumento, sin disco, sin red y sin reloj — lo mismo que un `String.trim`
// más caro. Lo que este módulo sigue NO haciendo es generar el azar: el nonce
// entra por parámetro (`newGoNonce` recibe los bytes), justo para que un test
// pueda fijarlo y para que el único sitio que llama a `randomBytes` sea el
// proceso que lo va a imprimir en la pantalla del humano.
// ============================================================================
//
// ---------------------------------------------------------------------------
// F38 — EL GO QUE EL AGENTE NO PUEDE ESCRIBIR.
//
// EL DEFECTO QUE CIERRA. Este mismo mecanismo, tal como salió de la #32, le dio
// consecuencia mecánica a un comentario de GitHub… y el agente tiene `gh`. Lo
// dijo su propio límite en commands/ct-next.md: «no impide que el propio agente
// escriba `-OK` en su propio issue — tiene `gh`, así que puede». Con el gate
// `plan` implicado por defecto en TODO slice (gates.js#gatesForType), eso no es
// un agujero pendiente: es el agujero de hoy. Y es peor que no tener puerta,
// porque deja el REGISTRO de que hubo revisión humana donde no la hubo.
//
// LA FORMA. El go deja de ser una constante y pasa a ser una constante MÁS UN
// NONCE POR DESPACHO. La coordinadora sortea el nonce al despachar y lo imprime
// SÓLO en la pantalla de quien despacha; lo que queda escrito en cualquier sitio
// que el agente pueda leer es su sha256 (el «compromiso»). El humano contesta
// `-OK <nonce>`; quien verifica hashea lo que lee y compara.
//
// POR QUÉ ESTO CIERRA ALGO DE VERDAD, y qué no cierra. El agente ya no puede
// FABRICAR el go: no puede adivinar 32 bits que no están en su contexto, ni en
// el kickoff, ni en el issue, ni en su worktree, ni en el log del vigilante.
// Falsificarlo deja de ser «un `gh issue comment` en mi propio issue» —un
// comando que el agente ya sabe correr, dentro de su repertorio normal, y que
// deja una traza indistinguible de la legítima— y pasa a exigir manipular el
// estado privado de la coordinadora fuera del repo, o leer el pane de otra
// sesión. Esa es la línea DETRÁS DE LA QUE YA ESTÁN todos los demás gates de
// este repo: ninguno sobrevive a un agente que reescribe el plugin que lo
// juzga. Lo que este cambio hace es sacar el go de la lista de cosas que se
// saltan sin salirse del guion.
//
// Y lo que NO cierra, dicho aquí y en el README: el agente corre con el MISMO
// uid que la coordinadora en la MISMA máquina. Nada de esto es criptografía
// contra un adversario, es una puerta que ya no se abre por accidente ni de
// paso. El cierre de verdad exige que el go lo verifique algo que no corra bajo
// ese uid —CI, u otra identidad—, y eso está nombrado y sin construir.
//
// DE PROPINA, SE VA UNA PIEZA: el nonce es por despacho, así que un `-OK` de un
// despacho anterior YA NO ENCAJA por construcción. La foto de ids (la ventana)
// sigue estando porque protege al vigilante de otra cosa —contar como respuesta
// algo que ya estaba— pero la propiedad que la justificaba («un go heredado no
// arranca nada») ahora la sostiene el propio nonce, y por eso la puerta del
// `--release`, que mira el issue entero sin ventana, es segura.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'

// El token, exacto y en una sola línea. Se exporta porque lo nombran el que lo
// busca (este módulo), los dos textos que lo explican al agente y al humano
// (gates.js) y sus tests: una cadena tecleada en cuatro sitios acaba
// divergiendo en uno, que es el desacople que este repo ya pagó con
// JUDGE_TOOLS, VERDICT_RULES y PACKAGE_SECTIONS. Y aquí el fallo sería mudo: se
// renombra el token, los textos siguen diciendo lo de antes, la persona escribe
// lo que le dijeron y el trabajo no arranca nunca sin que nada falle.
export const GO_TOKEN = '-OK'

// EL CUERPO EXACTO que cuenta como go para un despacho concreto. Una sola
// función lo forma, por el mismo motivo por el que GO_TOKEN se exporta: la
// pantalla que se lo dicta al humano y el matcher que lo reconoce no pueden
// divergir en un espacio.
export function goBody(nonce) {
  return `${GO_TOKEN} ${nonce}`
}

// EL COMPROMISO. sha256 del nonce en minúsculas — del NONCE y no del cuerpo
// entero, para que el matcher pueda exigir `-OK` literal (mayúsculas incluidas,
// como hasta hoy) y a la vez tolerar que el nonce se reteclee en mayúsculas.
//
// Se guarda el hash y nunca el nonce porque el compromiso SÍ vive en sitios que
// el agente lee: el argv del vigilante (`ps` lo enseña), su fichero de registro,
// el mensaje de la puerta 9. Un hash ahí no le sirve de nada a quien lo lee.
export function goCommitment(nonce) {
  return createHash('sha256').update(String(nonce).toLowerCase(), 'utf8').digest('hex')
}

// EL NONCE, a partir de bytes que pone quien llama. 8 caracteres hex = 32 bits.
//
// Por qué 32 y no 16: un nonce de 4 hex son 65.536 intentos, y «65.536 intentos
// son imposibles de esconder» no es una barandilla, es una apuesta a que
// alguien esté mirando los comentarios del issue. Cuestan lo mismo de teclear.
// Y por qué no 64: esto lo copia una persona de una pantalla a un comentario, y
// una barandilla que se hace incómoda se desactiva sola en dos semanas.
export function newGoNonce(bytes) {
  return Buffer.from(bytes).toString('hex').toLowerCase()
}

// EL MATCHER, en una sola función porque son DOS los que preguntan y con
// criterios distintos de ventana: el vigilante (sólo comentarios nuevos) y
// `dispatch-check --release` (el issue entero, sin ventana). Si cada uno
// escribiera su propia expresión, el día que divergieran el síntoma sería que
// el trabajo arranca y luego no se puede entregar.
//
// `-OK` es LITERAL y case-sensitive, igual que antes. El nonce se compara por
// hash tras bajarlo a minúsculas: aceptar `-OK 3F9A1C04` no abre nada (sigue
// haciendo falta el nonce) y evita el peor rato de todos, que es teclear el
// permiso correcto y que no pase nada.
//
// Sin compromiso legible NO HAY GO. Ni siquiera el `-OK` desnudo de ayer: un
// camino de vuelta al token fijo sería un camino que se activa BORRANDO un
// fichero, o sea exactamente lo que esta ronda quita del repertorio del agente.
export function matchesGo(body, commitment) {
  if (typeof commitment !== 'string' || !/^[0-9a-f]{64}$/.test(commitment)) return false
  const m = /^-OK[ \t]+([0-9a-fA-F]{2,64})$/.exec(String(body ?? '').trim())
  if (!m) return false
  return goCommitment(m[1]) === commitment
}

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

// EL INTENTO QUE NO ARRANCA NADA, Y POR QUÉ AHORA SE CONTESTA.
//
// La cabecera de este módulo argumenta que no hay categoría de «malformado» a
// propósito: «si escribes algo que no es exactamente `-OK`, no pasa nada, y eso
// es lo que querías», porque un token reconocido de más arrancaría lo que la
// persona quería frenar. Ese argumento SIGUE ENTERO y esto no lo toca: el gate
// se abre sólo con `matchesGo`, y nada de aquí abajo cambia eso.
//
// Lo que el argumento daba por hecho es la otra mitad: «un token que no se
// reconoce te deja esperando, y lo notas: vas a mirar». Medido en
// jjponz/rust-monitoring#7: la persona escribió `-OK` pelado a las 10:50, no
// pasó nada, y el go bueno no llegó hasta las 10:58. Miró, sí — y no tenía nada
// que mirar. El formato está escrito en el CUERPO del issue (scripts/gates.js) y
// quien contesta está leyendo el comentario del plan, que es otro sitio.
//
// Así que lo que falta no es una tercera respuesta de la máquina: es decirle el
// formato a quien ya demostró que lo está intentando. Un intento es un
// comentario nuevo que empieza por el token —en cualquier caja, porque escribir
// `-ok` es justo la clase de error que esto existe para explicar— y que
// `matchesGo` no reconoce.
//
// NO SE DEVUELVE EL CUERPO, sólo el `id`. Un intento puede llevar un nonce mal
// tecleado, y repetirlo en un comentario público publicaría casi todo el
// permiso. Quien conteste explica el formato y no cita lo que se escribió.
// LA TENSIÓN CON `conventions/defects.md`, DECLARADA Y NO RESUELTA EN SILENCIO.
// Su primera regla dice que una respuesta lleva el vocabulario y no un booleano
// derivado de él, y aquí la respuesta al gate son tres estados —no hay nada, hay
// un go, hay un intento que no lo es— servidos por un `hasGo` booleano más este
// identificador anulable. El diseño conforme sería una función con un vocabulario
// cerrado de tres miembros.
//
// No se hace, y el motivo es la mitad de la regla que aquí no se cumple: «un
// booleano colapsa estados que se arreglan distinto, y su consumidor no puede
// volver a separarlos». El consumidor SÍ puede — llama a esta función—, así que
// el daño que la regla nombra no ocurre. Y enfrente hay un coste real: `hasGo`
// es la única puerta del gate, y su estrechez es la propiedad de seguridad que
// la cabecera de este módulo defiende. Fundirla con «explicarle el formato a
// quien se equivocó» acoplaría una decisión de seguridad a una de comodidad, y
// el día que alguien audite qué abre el gate tendría que leer las dos.
//
// Lo que sí se cierra es el estado inválido: un go VÁLIDO no puede salir de aquí
// como intento fallido, porque `matchesGo` lo descarta dentro. Sin eso el
// vigilante entregaría y explicaría a la vez.
export function failedGoAttempt(comentarios, idsPrevios, commitment) {
  const previos = idsPrevios instanceof Set ? idsPrevios : new Set(idsPrevios || [])
  for (const comentario of [...(comentarios || [])].reverse()) {
    const id = typeof comentario?.id === 'string' ? comentario.id : ''
    if (id !== '' && previos.has(id)) continue
    const cuerpo = String(comentario?.body ?? '').trim()
    if (!cuerpo.toUpperCase().startsWith(GO_TOKEN)) continue
    if (matchesGo(cuerpo, commitment)) continue
    return id === '' ? null : id
  }
  return null
}

// El texto con el que se contesta a un intento. Vive aquí y no en el vigilante
// porque es contenido, no entrada y salida, y porque un test tiene que poder
// comprobar que NO lleva el nonce: es lo único que este comentario no puede
// decir, ya que el agente lee el issue.
export const GO_FORMAT_REPLY = [
  `El go de este gate es exactamente \`${GO_TOKEN} <nonce>\`: el token en mayúsculas, un espacio, y el nonce que \`/ct-next\` imprimió al despachar este slice.`,
  '',
  `Lo que se escribió no lo arranca, y eso es deliberado: \`${GO_TOKEN}\` a secas o con cualquier otra cosa detrás no abre el gate, para que un "ok, pero cambia el nombre" no eche a andar justo lo que se quería frenar.`,
  '',
  'El nonce **no está escrito en este issue** a propósito, porque el agente lee el issue: es la parte del permiso que él no puede fabricar. Si se ha perdido, quien despachó lo reemite con `scripts/ct-go.mjs`.',
].join('\n')

// ¿Hay un go entre los comentarios que NO estaban en la foto inicial?
//
// Se recorre AL REVÉS y se contesta con el primero que se reconoce, o sea el
// último de la lista. Hoy sólo hay una respuesta reconocible, así que esto da lo
// mismo que buscar «alguno» — y no implementa ningún «me arrepiento»: un `-OK`
// seguido de «espera, no» sigue siendo un go, porque lo único que este módulo
// reconoce es el token. Se recorre así porque es lo que sigue siendo correcto el
// día que haya una segunda respuesta, y porque el coste es cero.
export function hasGo(comentarios, idsPrevios, commitment) {
  const previos = idsPrevios instanceof Set ? idsPrevios : new Set(idsPrevios || [])
  for (const comentario of [...(comentarios || [])].reverse()) {
    const id = typeof comentario?.id === 'string' ? comentario.id : ''
    if (id !== '' && previos.has(id)) continue
    if (matchesGo(comentario?.body, commitment)) return true
  }
  return false
}
