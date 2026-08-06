#!/usr/bin/env node
// ============================================================================
// commit-keyword-guard.js — LA PUERTA: UN COMMIT NO SE LLEVA POR DELANTE UN
// ISSUE POR MENCIONAR UNA CLOSING KEYWORD.
//
// GitHub cierra un issue con una closing keyword que aparezca en CUALQUIER
// mensaje de commit que llegue a la rama por defecto, y las comillas NO
// protegen. En un repo real, un commit de DOCUMENTACIÓN cuyo cuerpo mencionaba
// `Closes #451` —dentro de una frase que explicaba que el kickoff no la
// llevaba— cerró ese issue. Nadie quiso cerrar nada.
//
// ES UNA PUERTA Y NO UN AVISO, a propósito: una comprobación cuyo resultado no
// puede detener la acción siguiente es decoración. Y no hay caso legítimo que
// se pierda — el contrato del loop manda el cierre al CUERPO DEL PR, nunca a un
// mensaje de commit.
//
// Y SIGUE SIENDO UNA PUERTA BAJO `--dangerously-skip-permissions`, que es el
// flag con el que arrancan TODOS los agentes despachados. Las dos decisiones
// que emite se midieron por EFECTO —un `touch CENTINELA.txt` y después la
// pregunta de si el fichero existe—, no por exit code, y con el
// `permission_mode` que recibe el hook escrito a fichero para no suponerlo a
// partir del flag:
//   `deny` (repo gobernado)     no se creó el centinela  — F27, spec §2.2
//   `ask`  (no se pudo mirar)   no se creó el centinela  — F28, `bypassPermissions`
// El control —el mismo montaje sin ningún hook— SÍ crea el fichero, así que la
// ausencia mide el bloqueo y no un modelo que no lo intentó. La escalada a
// `ask` es lo que sostiene que esta puerta nunca se degrade a silencio, y esa
// propiedad está medida, no supuesta.
//
// Lo que esas dos medidas NO dicen: que la puerta CUBRA a un agente despachado
// sigue dependiendo de que el plugin esté instalado bajo la cuenta con la que
// ese agente arranca (`resolveAccount`, scripts/dispatch.js). Y se midieron en
// `-p`, sin humano a quien preguntar, así que el `ask` se resolvió BLOQUEANDO;
// en una sesión interactiva lo esperable es que pregunte y se quede parada.
// Las dos cosas son «no silencio»; no son la misma cosa.
//
// EL ORDEN DE EVALUACIÓN DE `decidir` NO ES COSMÉTICO. Este hook corre en CADA
// comando Bash de CADA sesión con el plugin cargado. Las dos primeras
// preguntas son parseo puro, sin una sola lectura de disco; sólo el comando que
// ya resultó ser un commit CON keyword paga el I/O de averiguar si el repo está
// gobernado. `decidir` es una función PURA que no toca disco por sí misma —
// el único I/O posible es el que haga el `probe` que recibe, y sólo se le
// llama en ese tercer paso — precisamente para que esta propiedad se pueda
// medir sin trucos de permisos de fichero: un `probe` espía que cuenta sus
// invocaciones basta.
//
// LO QUE NO VE: un `git commit` tecleado fuera de Claude, uno sin `-m` (abre
// el editor), un `-F <fichero>`, un `--amend --no-edit`, `eval "..."`,
// `bash -c "..."` y subshell `( ... )`. Ni una invocación ENVUELTA donde
// `git` deja de ser el primer token — `sudo git commit`, `env FOO=1 git
// commit`, `command git commit` — porque entonces el paso (1) ni siquiera
// reconoce el `git commit` que hay detrás.
//
// CON `-C <ruta>` O `cd <ruta> && git commit` NO HAY CEGUERA, HAY UN REPO
// EQUIVOCADO: el paso (3) juzga el repo del `cwd` de la SESIÓN, nunca el que
// señala `<ruta>`, y eso corta en las dos direcciones — medido en los dos
// sentidos. Con la sesión dentro de un repo gobernado y `<ruta>` apuntando a
// uno que no lo es, `deny` de más sobre un commit que no le compete. Con la
// sesión fuera de todo repo gobernado y `<ruta>` apuntando a uno que sí lo
// es, ninguna protección sobre el commit que sí le competía.
//
// Lo que SÍ ve, y no hay que confundir con lo de arriba: closing-keywords.js
// no interpreta `$(...)` ni backticks, sólo copia caracteres — así que un
// mensaje construido con `-m "$MSG"` (expansión de variable) o
// `-m "$(cat fichero)"` (contenido en disco) es invisible, PERO el heredoc
// citado dentro de las propias comillas del `-m` —
// `-m "$(cat <<'EOF' ... EOF)"`, la forma multilínea por defecto de Claude
// Code— viaja entero, keyword incluida, en el mismo token, y SÍ se ve.
//
// Para todo lo que de verdad se escapa sigue estando el aviso de /ct-next
// sobre issues cerrados por un commit suelto: esto caza la CAUSA, aquello el
// EFECTO, y ninguno de los dos afirma ser completo.
// ============================================================================
import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { extractCommitMessages, findClosingKeywords } from '../scripts/closing-keywords.js'
import { probeGovernedRepo } from '../scripts/governed-repo.js'

/**
 * decidir: toda la lógica de la puerta, como función PURA.
 *
 * No hace I/O por sí misma, y tampoco lee estado ambiente: el único I/O
 * posible es el que haga `probe` (recibe el `cwd` TAL COMO LLEGÓ en el
 * payload y devuelve `{governed}` o `{error}`), y `probe` sólo se invoca en
 * el paso (3), cuando el comando ya resultó ser un commit CON closing
 * keyword. Esa es la propiedad que le importa a esta puerta, y al ser
 * `decidir` pura se puede comprobar pasándole un `probe` espía, sin
 * necesitar ningún directorio ilegible.
 *
 * Devuelve `null` cuando no hay decisión que emitir, o el objeto de salida
 * completo del hook.
 */
export function decidir(input, probe) {
  if (input?.hook_event_name !== 'PreToolUse') return null
  if (input?.tool_name !== 'Bash') return null
  const command = input?.tool_input?.command
  if (typeof command !== 'string' || !command) return null

  // (1) y (2): parseo puro, cero I/O.
  const mensajes = extractCommitMessages(command)
  if (!mensajes.length) return null
  const hallazgos = mensajes.flatMap(findClosingKeywords)
  if (!hallazgos.length) return null

  // (3): la única lectura de disco, y sólo para un comando que ya es
  // peligroso. `input.cwd` viaja TAL CUAL, sin sustituirlo por el cwd del
  // PROCESO del hook cuando falta: eso contestaría sobre un directorio que
  // quien invocó nunca nombró, y `probeGovernedRepo` ya sabe convertir un
  // cwd ausente/nulo/vacío en `{error}` en vez de inventar una respuesta.
  const sonda = probe(input.cwd)

  const salida = (permissionDecision, permissionDecisionReason) => ({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
  })

  const citado = hallazgos.map((h) => `\`${h.keyword} ${h.ref}\``).join(', ')

  if (sonda.error) {
    return salida('ask', `Este mensaje de commit lleva ${citado}, y NO se ha podido comprobar si el loop Control Tower gobierna los issues de este repo: ${sonda.error}. Si los gobierna, ese commit cerrara ${hallazgos.length > 1 ? 'esos issues' : 'ese issue'} al llegar a la rama por defecto, sin que nadie revise ni mergee nada. Decide tu: reformula la frase para que no lleve la cadena literal, o continua si sabes que este repo no esta gobernado.`)
  }

  if (!sonda.governed) return null

  return salida(
    'deny',
    `Este mensaje de commit lleva ${citado}. GitHub aplica las closing keywords de CUALQUIER mensaje de commit que llegue a la rama por defecto, y LAS COMILLAS NO PROTEGEN: un commit de documentacion que solo MENCIONABA la cadena cerro el issue en un repo real. En este repo el loop Control Tower gobierna los issues, asi que cerrarlo asi lo daria por entregado sin que nadie haya revisado ni mergeado nada, y liberaria sus dependencias sobre trabajo que puede no existir.\n\n` +
    `El cierre del slice va en el CUERPO DEL PR, no en el mensaje del commit.\n\n` +
    `Que hacer: reescribe la frase sin la cadena literal (por ejemplo «el kickoff no lleva la keyword de cierre» en vez de nombrarla). Si de verdad quieres cerrar el issue, hazlo explicito: \`gh issue close <n> --reason completed\`.`,
  )
}

// El cuerpo ejecutable sólo corre cuando el fichero se invoca como script
// (`node hooks/commit-keyword-guard.js`), no cuando un test importa
// `decidir`: un `readFileSync(0, ...)` sin stdin real bloquearía la carga
// del módulo.
//
// `realpathSync` NO es cosmético: `process.argv[1]` conserva la ruta TAL
// COMO SE INVOCÓ, mientras que `import.meta.url` llega con los symlinks YA
// RESUELTOS. Sin resolver también `argv[1]`, invocar este hook a través de
// un symlink de directorio (o siendo el propio fichero un symlink) hace que
// la comparación falle en abierto: el cuerpo no corre, `exit 0`, `stdout`
// vacío — indistinguible de «no había nada que denegar». La guarda
// `process.argv[1] &&` no es defensiva de más: bajo `node -e` ese valor es
// `undefined`, y `realpathSync(undefined)` lanzaría en vez de,
// sencillamente, no ejecutar el cuerpo.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Un stdin que no es JSON no permite saber ni qué comando es. Salir en
  // silencio es lo único honesto: bloquear cada Bash por un fallo de parseo
  // dejaría la sesión inservible por un motivo que no es el de esta puerta.
  let input
  try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }

  const resultado = decidir(input, probeGovernedRepo)
  // El `exit` espera al callback de `write`: sin él, un mensaje grande puede
  // quedar a medio escribir en una tubería (el buffer por defecto de un pipe
  // ronda 64 KB) y el host recibe un JSON cortado que descarta en vez de un
  // `deny` — el mismo silencio que esta puerta existe para evitar.
  if (resultado) process.stdout.write(JSON.stringify(resultado), () => process.exit(0))
  else process.exit(0)
}
