// ============================================================================
// F19/H1 — EL CENTINELA DE ARRANQUE: LA ÚNICA PRUEBA DE QUE EL COMANDO CORRIÓ.
//
// EL HALLAZGO DE CAMPO (primer despacho real del loop contra producción).
// `/ct-next --cap 1` salió con exit 0, dijo «lanzados 1/1» y añadió
// «verificado: la sesión cmux está corriendo en ese directorio». El agente
// NUNCA arrancó. Lo que había en la terminal de esa sesión:
//
//     [oh-my-zsh] Would you like to update? [Y/n] laude --dangerously-skip-…
//     zsh: command not found: laude
//
// El shell interactivo imprimió el prompt de actualización de oh-my-zsh
// MIENTRAS llegaba el comando, su `read` de un solo carácter se comió la `c`,
// y `claude` entró como `laude`. Quedó un shell inactivo, en el directorio
// correcto, con el título correcto. Consecuencia medida: el issue quedó en
// `status:in-progress` veinte minutos reclamado por nadie, reteniendo su
// `area:` y el carril serializante `pbxproj` de todo el repo; cero commits en
// la rama, cero PRs.
//
// POR QUÉ LA VERIFICACIÓN ANTERIOR NO PODÍA VERLO. `verifyCmuxLaunch`
// (ct-next.mjs) comprueba que EXISTE una sesión de cmux con el título pedido y
// en el cwd pedido. Existía: la ventana la crea `cmux new-workspace`, que es
// el mismo acto que envía el comando. Se estaba comprobando el CONTINENTE
// —una ventana que el propio dispatcher acaba de abrir— en vez del CONTENIDO
// —que el comando llegara a ejecutarse—. Es el mismo defecto que D5 arregló un
// nivel más arriba (`launchedCount` contaba como éxito lo no verificado),
// reaparecido un nivel más abajo. La segunda capa del engaño, que confundió
// también a los humanos: el `.agent/STATE.md` del worktree aparecía MODIFICADO
// y se leyó como «el agente está trabajando» — era la propia semilla del
// dispatcher. Rastro de la herramienta tomado por prueba del efecto.
//
// POR QUÉ OCURRE, con evidencia y no por suposición. El texto de ayuda que el
// propio binario de cmux instalado en esta máquina lleva embebido dice, para
// `new-workspace` (leído con `strings`, sin ejecutar cmux):
//
//     --command <text>     Send text+Enter to the new workspace after creation
//
// `--command` NO es un exec: son PULSACIONES enviadas al pty recién creado.
// Viajan hacia un shell de login interactivo cuyo arranque puede imprimir
// prompts, pedir confirmaciones y consumir entrada. Cualquier `read` que corra
// en el rc del usuario mientras el texto llega se come parte del comando —
// exactamente lo observado. No hay ninguna forma de que el emisor sepa que eso
// pasó: `new-workspace` ya devolvió 0 mucho antes.
//
// QUÉ SE HACE EN VEZ DE SUPONER. Dos cambios, y el reparto entre ellos es
// deliberado:
//
//  1. SE REDUCE LA SUPERFICIE. Lo que se teclea deja de ser la línea entera de
//     `claude` con el kickoff completo dentro (varios KB de pulsaciones) y pasa
//     a ser UNA línea corta que hace `source` de un script que este fichero
//     genera. El kickoff viaja por disco, escrito por `writeFileSync`, donde
//     ningún prompt puede morderlo. Esto no elimina la carrera con el rc — nada
//     que se teclee puede — pero saca de la línea de fuego todo menos ~70
//     caracteres.
//
//     NO se cambia a un shell no interactivo (`zsh -f -c`, `/bin/sh`), y es una
//     decisión, no una omisión: `claude` puede ser un alias o una función
//     definida en el rc del usuario (ct-next.mjs ya lo dice al buscarlo en el
//     PATH), y un shell sin rc no la encontraría. `source` corre DENTRO del
//     shell que cmux abrió, así que alias, funciones y PATH del usuario siguen
//     valiendo exactamente igual que antes de este cambio.
//
//  2. SE OBSERVA UN EFECTO, NO UNA VENTANA. La PRIMERA cosa que hace el script
//     es escribir un centinela: un fichero que solo puede existir si el
//     comando corrió de verdad. Si la cabecera de la línea se corrompe (el
//     caso vivido), el `source` no se ejecuta, el script no corre, y el
//     centinela NO aparece. El centinela lleva además dos datos que no se
//     pueden obtener desde fuera:
//       - `$PWD` REAL del shell que va a lanzar al agente (no el que cmux dice
//         que tiene la ventana);
//       - si `claude` resuelve EN ESE shell (`command -v`), que es la única
//         forma de saberlo: el PATH del proceso que corre ct-next.mjs no es el
//         del shell de login que abre cmux, y hasta ahora eso solo se podía
//         advertir como «no concluyente».
//
// LO QUE ESTE CENTINELA NO PRUEBA, dicho aquí para que nadie lo lea de más: no
// prueba que el agente esté haciendo algo útil, ni que siga vivo un minuto
// después. Prueba que el comando se ejecutó, en qué directorio, y que el
// binario existía. Es un salto de «hay una ventana abierta» a «la orden llegó
// y se ejecutó», no un salto a «el trabajo está en marcha».
//
// Este fichero es lógica PURA (construir texto, parsear texto) a propósito: el
// IO y la espera viven en ct-next.mjs, y así el formato del centinela se puede
// atacar en un test unitario sin lanzar nada.
// ============================================================================

// Magia y versión del formato. Van DENTRO del fichero y no implícitas en su
// nombre porque el fichero lo escribe un shell ajeno: si algún día el script
// cambia, un centinela viejo tirado en /tmp tiene que poder reconocerse como
// viejo en vez de parsearse mal en silencio.
export const SENTINEL_MAGIC = 'ct-next-launch'
export const SENTINEL_FORMAT_VERSION = '1'

// Nombres dentro del directorio de arranque de cada slice. Dos ficheros y no
// uno: el script lo escribimos nosotros, el centinela lo escribe el shell —
// confundirlos sería, otra vez, tomar el rastro propio por evidencia ajena.
export const LAUNCHER_FILENAME = 'launch.sh'
export const SENTINEL_FILENAME = 'started'

// buildTypedCommand: lo ÚNICO que se teclea en el pty. `.` y no `source`:
// `source` es un builtin de bash/zsh, `.` es POSIX y funciona en los dos —
// y el shell de login del usuario puede ser cualquiera de ellos.
export function buildTypedCommand(launcherPath, shQuote) {
  return `. ${shQuote(launcherPath)}`
}

// buildLauncherScript: el script que se sourcea. El orden de las líneas ES el
// diseño:
//
//   1. resolver `claude` ANTES de escribir nada (si el centinela se escribiera
//      primero, no podría llevar el dato);
//   2. escribir el centinela — de una sola llamada a `printf`, no varias, para
//      que no pueda quedar a medias;
//   3. y solo entonces lanzar al agente.
//
// El centinela se escribe ANTES de `claude` a propósito: si se escribiera
// después, solo aparecería cuando el agente TERMINARA, que es justo lo que no
// se puede esperar. Lo que se está probando es que la orden se ejecutó, no que
// el agente acabara.
//
// `$PWD` va el ÚLTIMO campo porque es el único que puede contener un tabulador
// (una ruta patológica, pero posible): así el parser puede reunir todo lo que
// venga detrás del tercer tabulador sin partirlo.
//
// ===========================================================================
// F20/H1 — LA GUARDA DE IDEMPOTENCIA, Y POR QUÉ ES LA PIEZA QUE SOSTIENE TODO
// LO DEMÁS.
//
// F20 midió, contra el cmux instalado en esta máquina, lo que F19 solo pudo
// razonar: `--command` teclea, `--layout` con una superficie `command`
// TAMBIÉN teclea (medido: el texto sale ECOADO en el prompt de la propia
// sesión, y el proceso cuelga de un `-/bin/zsh` de login; y además `--cwd` se
// ignora en ese modo), y no existe ninguna vía de exec en esa versión. O sea:
// el tecleo no se puede quitar, así que hay que poder REPETIRLO.
//
// Repetir el tecleo sin una guarda sería peor que el problema: dos líneas que
// SÍ lleguen arrancan DOS agentes sobre el mismo worktree. La guarda hace que
// el segundo sourceo sea un no-op observable — y puede hacerlo porque el
// centinela se escribe ANTES de lanzar al agente: si existe, el agente ya
// arrancó (o está arrancando) y no hay nada que repetir.
//
// El caso que esto cubre de verdad, y que se reprodujo en el laboratorio: el
// primer tecleo llega tarde (shell lento) y el dispatcher ya ha reenviado la
// línea. Las dos llegan. Sin guarda: dos `claude`. Con guarda: uno.
//
// `[ -e ]` y no `[ -f ]`: lo que importa es que la ruta esté ocupada, no de
// qué tipo es. Un `-f` dejaría pasar el relanzamiento si alguien pusiera ahí
// un directorio o un symlink roto.
// ===========================================================================
export function buildLauncherScript({ sentinelPath, agentCommand, issue, worktree }, shQuote) {
  const q = shQuote
  return `#!/bin/sh
# Generado por /ct-next (plugin control-tower-loop) para el issue #${issue}.
# NO lo edites: se reescribe en cada despacho. Ver scripts/launch-sentinel.js.
#
# Este script se SOURCEA en el shell de login que abre cmux (nunca se ejecuta
# como subproceso), para que los alias, funciones y PATH del usuario —de donde
# puede salir el propio \`claude\`— sigan valiendo.
#
# Se puede sourcear MÁS DE UNA VEZ: /ct-next reenvía la línea si el centinela
# no aparece (el pty se la puede comer). La guarda de abajo hace que solo el
# primer sourceo que llegue lance al agente.
#
# Worktree esperado: ${worktree}
if [ -e ${q(sentinelPath)} ]; then
  printf '%s\\n' 'ct-next: el agente de #${issue} ya arrancó (centinela presente); este sourceo NO relanza nada.'
else
  if command -v claude >/dev/null 2>&1; then ct_next_claude=ok; else ct_next_claude=missing; fi
  printf '%s\\t%s\\t%s\\t%s\\n' ${q(SENTINEL_MAGIC)} ${q(SENTINEL_FORMAT_VERSION)} "$ct_next_claude" "$PWD" > ${q(sentinelPath)}
  unset ct_next_claude
${agentCommand}
fi
`
}

// parseSentinel: `null` si el contenido no es un centinela de este formato
// (fichero a medio escribir, versión futura, basura) — nunca se adivina. Un
// centinela ilegible NO es un centinela ausente y quien llama tiene que poder
// distinguirlo, así que el `null` viaja acompañado del texto crudo desde
// ct-next.mjs.
export function parseSentinel(text) {
  const line = String(text ?? '').split('\n').find((l) => l.trim().length > 0)
  if (!line) return null
  const parts = line.replace(/\r$/, '').split('\t')
  if (parts.length < 4) return null
  const [magic, version, claude] = parts
  if (magic !== SENTINEL_MAGIC) return null
  if (version !== SENTINEL_FORMAT_VERSION) return null
  if (claude !== 'ok' && claude !== 'missing') return null
  // El resto (pueda llevar tabuladores o no) es la ruta.
  const cwd = parts.slice(3).join('\t')
  if (!cwd) return null
  return { version, claudeResolved: claude === 'ok', cwd }
}

// sameDir: comparación de directorios TOLERANTE a symlinks, y el porqué
// importa: en macOS `/tmp` es un symlink a `/private/tmp` y `$TMPDIR` cuelga
// de `/var/folders/…` (que es `/private/var/folders/…`). El shell fija `$PWD`
// con la ruta LÓGICA por la que entró, así que comparar cadenas a secas
// declararía «directorio equivocado» en despachos perfectamente correctos —
// exactamente la falsa alarma que D5 arregló para el campo `current_directory`
// de cmux, y que no vamos a reintroducir por la puerta de al lado.
//
// `realpathOf` se inyecta (en vez de importar `node:fs` aquí) para que este
// fichero siga siendo puro y testeable sin disco.
export function sameDir(a, b, realpathOf) {
  if (a === b) return true
  if (!a || !b) return false
  const ra = realpathOf(a)
  const rb = realpathOf(b)
  if (ra === null || rb === null) return false
  return ra === rb
}
