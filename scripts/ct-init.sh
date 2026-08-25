#!/usr/bin/env bash
# ct-init: bootstrap de un repo para el loop Control Tower. Idempotente.
set -euo pipefail
TARGET="${1:?uso: ct-init.sh <dir-repo> [--update-slices-contract] [--force]}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shift || true

# F6, menor 6: hasta ahora, cualquier corrección del contrato de el contrato de slices se
# quedaba en el plugin — `ct-init` detecta la sección entre sus marcadores y
# no la toca (correcto por defecto: puede tener ediciones a mano del
# usuario), así que ningún repo ya bootstrapeado la recibía jamás salvo
# copiando y pegando. `--update-slices-contract` es la vía explícita:
#   - NUNCA por defecto (una corrida normal solo AVISA de que la sección es
#     de una versión anterior, y de cómo actualizarla).
#   - Nunca destructiva a ciegas: solo reemplaza la sección si su contenido
#     coincide, byte a byte, con alguna versión que este propio script haya
#     generado (SLICES_PRISTINE_HASHES). Lo que no reconoce NO se pisa: hace
#     falta `--force`, y se avisa al hacerlo.
#     F9: "no lo reconozco" NO es lo mismo que "lo has editado a mano", y el
#     script ya no lo dice como si lo fuera. Un bloque que no está en la lista
#     puede ser una edición del usuario o una versión del contrato cuyo hash
#     este ct-init no lleva registrado, y desde aquí no hay forma de
#     distinguirlas — así que el mensaje ofrece las dos lecturas en vez de
#     elegir la que culpa al usuario. Y "no se ha podido calcular el hash"
#     (máquina sin `shasum` ni `sha256sum`) es un tercer estado con su propio
#     mensaje: ahí no se ha comparado nada.
UPDATE_SLICES_CONTRACT=0
FORCE=0
for opt in "$@"; do
  case "$opt" in
    --update-slices-contract) UPDATE_SLICES_CONTRACT=1 ;;
    --force) FORCE=1 ;;
    *) echo "opción no reconocida: $opt (uso: ct-init.sh <dir-repo> [--update-slices-contract] [--force])" >&2; exit 2 ;;
  esac
done

mkdir -p "$TARGET/.agent"
if [ ! -f "$TARGET/.agent/STATE.md" ]; then
  cp "$HERE/skills/state-template/STATE.template.md" "$TARGET/.agent/STATE.md"
  echo "creado $TARGET/.agent/STATE.md"
elif grep -qE '^[[:space:]]*blocked[[:space:]]*:' "$TARGET/.agent/STATE.md"; then
  echo "STATE.md ya existe, no se pisa"
else
  # F7: un STATE.md anterior al campo `blocked` sigue funcionando (el hook lo
  # lee como NO bloqueado, que es la lectura correcta por defecto), pero quien
  # lo tenga no se enterará nunca de que ahora hay una forma de decir "esto no
  # puede continuar" que no sea escribir prosa en `next_action` — el mismo
  # error que originó todo esto. Se dice UNA vez, aquí, donde se está mirando
  # el repo a propósito. No se toca el fichero: reescribir el STATE.md de un
  # repo vivo desde un scaffolder sería peor que el problema.
  echo "STATE.md ya existe, no se pisa — pero no declara el campo \`blocked\`, así que se lee como NO bloqueado. Si el trabajo de este repo se queda alguna vez bloqueado, añádelo a mano al frontmatter en vez de explicarlo dentro de \`next_action\`: blocked: {reason: \"por qué no se puede continuar\", unblock: \"qué haría falta\"} — el hook de SessionStart lo anuncia y suspende el next_action en toda sesión nueva."
fi

# .agent/conventions.md (§3.3, docs/prompt-juez-lo-que-queda.md): las
# convenciones son una propiedad del REPO, no del epic — antes se re-derivaban
# en el §3 de cada plan de slice, y nada garantizaba que el slice 14 citara las
# mismas rutas que el slice 3. Se siembra aquí, una única vez por repo, con el
# mismo idiom que STATE.md arriba: crea si no existe, no se pisa si existe. La
# confirmación humana es el momento en que alguien corre `/ct-init` —no se
# añade una cuarta puerta a las tres del producto— y `ct-step` la lee directo
# de este fichero en cada task brief, sin ningún agente en medio.
CONVENTIONS_MD="$TARGET/.agent/conventions.md"
if [ ! -f "$CONVENTIONS_MD" ]; then
  cat > "$CONVENTIONS_MD" <<'EOF'
# La vara de este repo — los documentos de reglas del código

<!-- Lo lee ct-step DIRECTO y lo pega en el brief de cada tarea: el
     implementador escribe con esto delante y el juez bloquea citándolo.
     Es una propiedad del REPO, no de ningún epic: se declara UNA vez aquí,
     no en el §3 de cada plan de slice.
     OJO: no es .agent/conventions-ack.md (acuses de señales de colisión de
     protocolo del loop) — este fichero declara CÓMO se escribe código aquí. -->

Rules to obey (una ruta por línea, entre backticks; tiene que poder leerse):

- (ninguna declarada todavía — sustituye esta línea al declarar la primera)

Skills (nombre de skill, no ruta):

- (ninguna)
EOF
  echo "creado $CONVENTIONS_MD"
else
  echo "conventions.md ya existe, no se pisa"
fi

GITIGNORE="$TARGET/.gitignore"
touch "$GITIGNORE"
# Normaliza un salto de línea final ANTES de tocar nada más: si el fichero ya
# tiene contenido pero no termina en `\n` (p.ej.
# `printf 'node_modules/' > .gitignore`, sin salto final), un `>>` de bash
# concatena la línea nueva en la MISMA línea que la última — corrompe la
# regla previa del usuario (`node_modules/` deja de ignorarse, ¡en SU repo,
# no en el nuestro!) y además `.worktrees/` tampoco queda ignorado de verdad,
# que es justo lo que la línea de abajo viene a garantizar. `tail -c1 |
# wc -l` es el idiom robusto para detectar "termina en \n": mirar
# directamente `$(tail -c1 ...)` no sirve porque la sustitución de comandos
# siempre recorta los saltos de línea finales, así que un fichero que SÍ
# termina en \n sería indistinguible de uno vacío.
if [ -s "$GITIGNORE" ] && [ "$(tail -c1 "$GITIGNORE" | wc -l)" -eq 0 ]; then
  echo >> "$GITIGNORE"
fi
# .worktrees/: ct-next.mjs escribe cada
# worktree de slice en <repoRoot>/.worktrees/<n>, dentro del propio checkout.
# Si el repo destino no lo ignora, un `git add -A` en el checkout principal
# se traga un working tree anidado entero, y un `git clean -fdx` destruye
# worktrees vivos. Idempotente: solo añade la línea si no está ya (grep
# exacto de línea completa), igual que el resto de este script no pisa lo
# que ya existe.
if ! grep -qxF '.worktrees/' "$GITIGNORE"; then
  echo '.worktrees/' >> "$GITIGNORE"
  echo "añadido .worktrees/ a $GITIGNORE"
else
  echo ".worktrees/ ya está en $GITIGNORE, no se duplica"
fi

# .agent/SLICE.md (F22): /ct-next siembra el estado del slice ahí, dentro del
# worktree. Ese fichero es estado VIVO Y LOCAL de una sesión despachada, nunca
# producto: si git lo ve, un `git add -A` del agente lo mete en su PR y el
# squash deja main con el estado de un slice —y cualquier sesión nueva del repo
# se hidrata creyendo que ES ese agente—. Pasó tres veces en un periodo de 9
# slices antes de existir esta línea.
#
# /ct-next escribe además la misma regla en .git/info/exclude en cada dispatch,
# para cubrir los repos que no re-corran ct-init. Esta es la vía larga: se
# commitea, la ve quien clone, y explica por qué está.
#
# Idempotente por línea exacta, igual que el bloque de .worktrees/ de arriba.
if ! grep -qxF '.agent/SLICE.md' "$GITIGNORE"; then
  echo '.agent/SLICE.md' >> "$GITIGNORE"
  echo "añadido .agent/SLICE.md a $GITIGNORE"
else
  echo ".agent/SLICE.md ya está en $GITIGNORE, no se duplica"
fi

# D-4 — el estado del run de ct-step, y su carpeta de trabajo (briefs, logs de
# los controles, paquetes de revisión). Mismo motivo que la línea de arriba y
# uno más: estos ficheros son el bucle INTERNO de una slice dentro de su
# worktree y viven menos que el worktree. Lo que vive en GitHub es el estado del
# SLICE, y durante todo el run el issue no cambia de estado.
#
# La carpeta lleva además los diffs de cada tarea, que son el mismo contenido
# que el commit: verlos aparecer como ficheros nuevos en la PR es ruido puro.
for regla in '.agent/run-*.json' '.agent/run-*/'; do
  if ! grep -qxF "$regla" "$GITIGNORE"; then
    echo "$regla" >> "$GITIGNORE"
    echo "añadido $regla a $GITIGNORE"
  else
    echo "$regla ya está en $GITIGNORE, no se duplica"
  fi
done

AGENTS_MD="$TARGET/AGENTS.md"
if [ ! -f "$AGENTS_MD" ]; then
  cat > "$AGENTS_MD" <<'EOF'
# AGENTS.md
<!-- Guía durable del repo (≤150 líneas). Procedimientos → Skills. -->
## Project overview
## Setup commands
## Build, test & lint
## Code style & conventions
## Project layout
## Workflow: 1 issue = 1 slice = 1 session
## Commit & PR rules
## Security & data handling
## Do NOT touch
## Gotchas
## Skills (load on demand)
EOF
  echo "creado $AGENTS_MD"
else
  echo "AGENTS.md ya existe, no se pisa"
fi

# Sección "Formato de la tabla de slices" (F2 — el contrato con /ct-groom): hasta
# ahora ese contrato (qué columnas exige, qué marcadores de "sin valor"
# acepta, qué genera cada una) solo vivía en commands/ct-groom.md — un
# fichero que lee quien EJECUTA groom, nunca quien ESCRIBE el spec, casi
# siempre en otra sesión y otro repo. Se siembra aquí, en el AGENTS.md del
# repo destino, que sí lee quien redacta specs.
#
# MISMO bloque para los dos casos (fichero recién creado arriba, o ya
# existente sin la sección) — un único `if`, sin duplicar la plantilla en dos
# sitios que puedan divergir con el tiempo. Detección: un comentario HTML
# greppable (`<!-- ct-init:slices-contract -->`), el mismo idiom que
# `<!-- ct-order:N -->` en groom.js — no se renderiza, no colisiona con
# encabezados de usuario. `grep -qxF` (línea completa, no substring) en vez
# de `grep -qF`: reduce (que no elimina del todo — un fence de código con la
# línea pegada tal cual seguiría dando falso positivo, caso rebuscado que no
# merece más esfuerzo) el riesgo de que el marcador citado dentro de un
# bloque de código ajeno (indentado, o parte de una línea más larga) cuente
# como "ya está".
#
# Review de F2, punto 2: comprobar SOLO el marcador de apertura no basta —
# si alguien borra el de apertura pero deja el heading/cuerpo/cierre (o
# viceversa), `grep -qF` del que falta no encuentra nada, el script cree que
# la sección no está, y AÑADE UNA SEGUNDA COPIA ENTERA en silencio: dos
# headings, un marcador huérfano, exit 0. Se comprueban los TRES rastros
# (apertura, cierre, heading) por separado:
#   - apertura Y cierre presentes → sección completa, no se toca (caso normal).
#   - CUALQUIER rastro parcial (uno o dos de los tres, pero no los tres) →
#     no es seguro decidir por el usuario qué pasó aquí; se avisa por stderr
#     y no se añade nada — mejor un AGENTS.md que el usuario entiende y tiene
#     que arreglar a mano que una sección duplicada en silencio.
#   - ningún rastro → se añade la sección completa (caso "no existe todavía").
SLICES_MARKER_OPEN='<!-- ct-init:slices-contract -->'
SLICES_MARKER_CLOSE='<!-- /ct-init:slices-contract -->'
SLICES_HEADING='## Formato de la tabla de slices (contrato con /ct-groom)'
# F30 — el heading VIEJO se sigue reconociendo, y nunca se emite.
#
# Hasta la v15 la sección se llamaba «tabla de slices». El número era un fósil: nunca
# localizó nada (`/ct-groom` encuentra la tabla por sus columnas `Slice`+`Dep`,
# y el flag `--section N` está obsoleto y se ignora), y arrastraba la idea
# falsa de que la tabla es el apartado noveno de un documento grande.
#
# Cambiar el heading a secas tendría un filo: la detección de una sección
# COMPLETA sólo mira los dos marcadores, así que ahí no pasa nada — pero la
# rama de "restos parciales" sí mira el heading, y un AGENTS.md con el heading
# viejo y sin marcadores dejaría de reconocerse y recibiría una SEGUNDA copia
# entera de la sección. Es exactamente el fallo que la review de F2 documentó
# y cerró. Mismo remedio que ya usan SLICES_PRISTINE_HASHES (se añade, nunca
# se reemplaza) y las dos formas literales de `## Acceptance criteria` en
# reconcile.js: un conjunto CERRADO de headings reconocidos, uno solo emitido.
SLICES_HEADING_LEGACY='## Formato de la tabla §9 (contrato con /ct-groom)'
# SLICES_CONTRACT_VERSION (F6): versión del CONTENIDO del bloque. Viaja en una
# línea propia justo detrás del marcador de apertura, no dentro de él: el
# marcador de apertura se mantiene idéntico al de siempre para que un repo
# bootstrapeado antes de F6 (sin línea de versión, "v1") siga reconociéndose
# con los mismos `grep -qxF` de siempre, sin ninguna migración.
# F10 sube de 3 a 4. El número NO mide el tamaño del cambio: mide "¿el texto
# que tiene este repo es el que shippea este plugin?", y es la ÚNICA palanca
# que hace que un contrato corregido llegue a un repo ya bootstrapeado.
# Comprobado ejecutándolo antes de decidir: con un repo sembrado por el v3 de
# F11 (bloque intacto, hash registrado), dejar el número en 3 hace que TANTO la
# corrida normal COMO `--update-slices-contract` respondan "contrato v3, al
# día" — `found_version -eq SLICES_CONTRACT_VERSION` y `block_status=pristine`,
# así que ni siquiera entra en la rama de "el contenido no es el mío". No hay
# NINGÚN camino por el que ese repo reciba el texto nuevo: se queda para
# siempre diciendo que `--section` alimenta el ancla del enlace (un flag que
# ahora se ignora) y sin la línea de "empuja el spec antes de groomear", que es
# lo que decide si sus issues nacen con enlace o sin él. Con 4, ese mismo repo
# recibe el aviso de desactualizado y `--update-slices-contract` lo reemplaza
# limpiamente, sin `--force` y sin acusar a nadie — que es exactamente el
# mecanismo que F9 construyó.
#
# F18 sube de 7 a 8. Lo que cambia no es redacción: el v7 DABA POR IMPOSIBLE
# algo que ocurre solo, y CALLABA dos estados en los que el loop se atasca sin
# decir nada. Un repo bootstrapeado con el v7 no puede deducir ninguna:
#   - el v7 decía que cerrar un issue como *completed* sin haber mergeado nada
#     "no se detecta — haría falta cruzar el grafo de PRs" y que era "un caso
#     que requiere una acción errónea deliberada". Las dos mitades eran falsas
#     y las dos están medidas, no supuestas: GitHub aplica las closing keywords
#     de CUALQUIER mensaje de commit que llegue a la rama por defecto (un
#     commit de DOCUMENTACIÓN que solo MENCIONABA `Closes #451`, entrecomillado,
#     cerró ese issue en un repo de producción), y una sola query GraphQL con
#     alias resuelve 97 issues en 2,8 s. Un repo con el v7 sigue creyendo que
#     hace falta mala intención, que es justo lo que impide sospechar del
#     accidente cuando ocurre;
#   - el v7 no decía en ninguna parte que un issue CERRADO que conserva su
#     label `status:` desaparece del dispatcher (solo barre abiertos). La tasa
#     medida es 10 de 99 cerrados. Sin esto, la reacción natural a "mi slice ya
#     no sale" es buscar el fallo en el dispatcher;
#   - ni que un agente que se declara BLOQUEADO deja su claim puesto para
#     siempre, sin ninguna transición del loop que lo suelte. Es un deadlock
#     con nombre propio y el v7 lo dejaba sin nombrar;
#   - y una cuarta, encontrada aplicando al resto del texto la misma lente que
#     falsificó la primera: el v7 decía que la causa "al PR le faltaba el
#     `Closes #N`" "solo aparece con PRs abiertos a mano, o si alguien edita
#     el cuerpo después", porque el kickoff lo pide. El kickoff es un PROMPT,
#     no un gate — el propio v7 lo admite dos párrafos más abajo ("lo que el
#     kickoff no puede garantizar es que el agente obedezca"). La causa más
#     probable faltaba de la lista, y era justo la que un diagnóstico honesto
#     tiene que mirar primero.
#
# F17 sube de 6 a 7. Las dos cosas que cambian son hechos nuevos sobre el
# CIERRE del issue, y un repo bootstrapeado con el v6 no puede deducir ninguna:
#   - el kickoff ahora exige `Closes #N` en el cuerpo del PR (antes no pedía
#     nada, y por eso el estado "PR mergeado, issue abierto" era el resultado
#     NORMAL de un slice bien hecho: tokens retenidos para siempre y ningún
#     dependiente desbloqueado). La enumeración de "qué recibe el agente
#     despachado" se lo callaba, así que describía un kickoff que ya no existe;
#   - el v6 atribuía ese estado a UNA sola causa ("al PR le faltaba `Closes
#     #N`"). Hay una segunda, verificada contra un repo real: un PR que SÍ
#     lleva su `Closes #N` pero se mergea en una rama que no es la por defecto
#     tampoco cierra el issue. Es la que engaña — miras el PR, ves el `Closes`,
#     y descartas el diagnóstico bueno. Con `--base <otra-rama>`, cerrar el
#     issue al mergear es un paso a mano SIEMPRE.
#
# F15 sube de 5 a 6, y por el mismo motivo que F13: el texto v5 DESCRIBE MAL
# dos cosas que un repo bootstrapeado no puede corregir por su cuenta.
#   - decía que `--reopen` deja el slice en `status:ready` ("vuelve a ser
#     despachable"). Ya no: lo deja en `status:in-progress`, porque `ready` no
#     retiene tokens y ese trabajo sigue sin mergear. Un repo con el v5 seguiría
#     esperando que /ct-next lo despachara solo, y encima creyendo que su área
#     quedó libre;
#   - no decía NADA sobre en qué orden /ct-groom valida y muta. Dos lecturas
#     independientes del v5 dedujeron —correctamente, entonces— que un abort
#     podía dejar milestone y labels a medias. Eso YA no es cierto (se arregló
#     el orden), pero el silencio hacía que la deducción correcta fuera la que
#     asusta, y ahora la garantía existe y hay que decirla.
#
# F13 subió de 4 a 5, y el bump era OBLIGATORIO allí más que en ninguna ronda
# anterior: lo que cambia no es redacción, es que el texto v4 PROMETÍA
# garantías que el código no da. Decía que migration/ci/pbxproj serializan "en
# todo el repo" (el código solo mira issues de este repo con status:
# in-progress/in-review — todo lo que va por fuera del flujo de issues es
# invisible), que "merge-after significa MERGEADO" (el código mira cómo se
# cerró el issue, que no es lo mismo en ninguna de las dos direcciones), y no
# decía en absoluto que un PR rechazado dejaba su slice fuera del loop para
# siempre. Un repo bootstrapeado con el v4 se queda con esas tres cosas hasta
# que este número suba; es la única palanca que existe para llegar hasta él.
#
# F22 sube de 10 a 11 por la MISMA razón que F13, y con el mismo agravante: el
# v10 no describía mal el flujo, describía mal DÓNDE escribe el agente. Decía
# que el estado del slice vive en el `.agent/STATE.md` de su worktree y que
# `/ct-next` lo lee de ahí. Las dos mitades son falsas desde F22: la semilla va
# a `.agent/SLICE.md` (ignorado) y el dispatcher se NIEGA a leer el STATE.md
# del worktree, porque ése es el de la coordinadora congelado en la base. Y
# esto no es un comentario obsoleto: es una INSTRUCCIÓN a un agente. Un slice
# que siga el AGENTS.md de su repo en vez de su kickoff escribiría su
# `blocked:` en el fichero que nadie lee —el claim se queda colgado para
# siempre, que es justo el fallo F18 que este loop ya arregló una vez— y, si
# llega a commitearlo, la puerta de `--release` lo rechaza con exit 5. Un repo
# bootstrapeado con el v10 se queda con esa instrucción falsa hasta que este
# número suba.
#
# F23 sube de 11 a 12 por la MISMA razón que F13 y F22: el v11 no describía
# mal el flujo, PROMETÍA una comparación que el código ya no puede hacer.
# Decía que re-groomear compara "título, enlace al spec, milestone, labels…"
# contra la tabla de hoy. Desde que el emparejado por `ct-order` está acotado
# al milestone de la corrida, un issue emparejado tiene siempre ese milestone
# por construcción: la divergencia de milestone es inalcanzable desde
# /ct-groom. Quien leyera el v11 deducía "si muevo un issue de milestone y
# vuelvo a correr, me lo reporta", y lo que obtiene hoy es o un exit 1 de una
# de las dos puertas, o un issue nuevo (un epic duplicado, si el enlace al
# spec tampoco casa). Un repo bootstrapeado con el v11 se queda con esa
# promesa falsa hasta que este número suba.
#
# F27 sube de 12 a 13, y por el mismo criterio de siempre: el v12 no describe mal
# el flujo, CALLA dos cosas que ahora existen. (a) No dice que las comprobaciones
# previas al merge tienen que ser puertas — la regla más útil del periodo de
# campo, que salió de un merge que entró con la comprobación imprimiendo `1`.
# (b) Dice «cuidado con escribir esas keywords en cualquier commit» como si nada
# protegiera, cuando el plugin ya bloquea el caso mayoritario, y no dice cuáles
# son los cuatro que se le escapan. Un repo con el v12 no puede deducir ninguna
# de las dos, y la segunda es peor que el silencio: lee «vigila tú» donde ya hay
# una puerta, y no sabe dónde NO la hay.
#
# F27 sube de 13 a 14 por el mismo criterio, sobre su propio texto: el v13
# PROMETÍA una cobertura que el código no da, y CALLABA dos puntos ciegos
# reales. Decía que el plugin bloquea el commit «en un repo que tenga esta
# sección en su AGENTS.md», como si bastara con el repo. Falso: la puerta la
# trae la SESIÓN de Claude (el hook lo pone el plugin cargado, no el repo), y
# un agente despachado arranca con su propia cuenta (`CLAUDE_CONFIG_DIR`) —
# si esa cuenta no tiene el plugin instalado, no hay puerta, aunque el repo
# lleve la sección entera. Un repo con el v13 lee «con esta sección basta» y
# no tiene forma de sospechar que la cobertura depende de dónde arrancó el
# agente. Y el v13 enumeraba cuatro puntos ciegos —sin `-m`, `-F`, `--amend
# --no-edit`, fuera de Claude— pero no los otros dos, medidos con el mismo
# parser: un commit que **apunta a otro repo** (`git -C <ruta> commit`,
# `cd <ruta> && git commit`, que la puerta comprueba contra el repo de la
# SESIÓN y no contra `<ruta>`) y una invocación **envuelta** (`sudo git
# commit`, `env FOO=1 git commit`, `command git commit`, donde `git` deja de
# ser el primer token y el parser no reconoce el commit). Un repo con el v13
# se queda creyendo que esos dos casos SÍ están cubiertos, hasta que este
# número suba.
#
# Slice 10 (juez-lo-que-queda) sube de 18 a 19: el v18 no puede deducir que la
# columna `Señal` existe (la señal de observabilidad que el slice promete, y
# que el juez de slice mide contra el diff acumulado con su ítem
# `observabilidad`), ni que una exención se escribe `N/A — <razón>` (y que sin
# razón el groom aborta), ni que una celda sin valor se mide como `sin-vara`
# en la telemetría del epic. Un repo con el v18 declararía señales en prosa
# del spec —invisibles para el agente y para el juez— o no las declararía
# nunca, sin saber que la cuenta de sin-vara lo está midiendo.
#
# Slice 4 (apuntes de Capde) sube de 19 a 20: el v19 describe la columna
# `Señal` pero no dice cuándo vale algo. Un repo con el v19 puede declarar
# como señal una paráfrasis de un criterio de aceptación —el modo de fallo
# observado en una corrida real— y entonces el ítem `observabilidad` del juez
# de slice mide lo que `estado-final` ya midió: la columna se rellena, el
# juez la puntúa, y nadie aprende nada de lo que va a pasar en producción.
# El v20 lo dice: la señal no es un criterio de aceptación más.
SLICES_CONTRACT_VERSION=20
SLICES_VERSION_LINE_RE='<!-- ct-init:slices-contract-version: [0-9]\{1,\} -->'
# SLICES_PRISTINE_HASHES: sha256 del bloque COMPLETO (marcador de apertura a
# marcador de cierre, ambos incluidos) tal cual lo emitió cada versión de este
# script. Es lo que permite distinguir "sin tocar pero desactualizada" de
# "editada a mano" sin guardar el texto histórico entero: si el bloque que hay
# en el AGENTS.md coincide con alguno de estos, nadie lo ha tocado y se puede
# reemplazar sin perder nada.
#
# F9: hasta ahora aquí había DOS hashes — el del bloque actual y el de la
# última variante anterior. Pero el contenido del bloque cambió NUEVE veces
# distintas siendo nominalmente "v1" (la línea de versión no existía hasta
# F6), así que ocho de esas nueve variantes eran irreconocibles: un repo
# bootstrapeado con el plugin 0.5.1, con el bloque intacto byte a byte, recibía
# un "la has editado a mano" y `--update-slices-contract` se negaba a
# actualizarlo. Se registran TODAS.
#
# Criterio (F9): un hash por cada bloque DISTINTO que haya emitido cualquier
# commit alcanzable desde `main`, no solo los que coinciden con un bump de
# versión del plugin. Dos razones, ambas comprobadas en este repo:
#   - el repo no tiene tags: un plugin de Claude Code se instala clonando un
#     ref de git, así que cualquier commit de main pudo ser el HEAD que
#     alguien instaló — "solo las versiones publicadas" no describe nada real
#     aquí;
#   - de todas formas no bastaría: CINCO bloques distintos convivieron bajo el
#     mismo `plugin.json` 0.6.0, y dos commits (9c6c8cf y d4a5ca8) emiten el
#     MISMO bloque bajo versiones distintas. La correspondencia
#     versión-publicada ↔ contenido del bloque no existe.
# La lista se deriva del historial (ver el test "todo bloque que ct-init emitió
# alguna vez está registrado"), no de memoria.
#
# Un bloque puede existir de verdad y NO estar en la historia de main: la PR
# #27 traía DOS bumps (v16→v17 en 743fe3f y v17→v18 en a11fd76) y aterrizó
# como squash (529d2f4), así que el bloque v17 —publicado en el ref desde el
# que se abrió la PR, y por tanto instalable— no lo reproduce ningún commit
# alcanzable. Su entrada de aquí sigue siendo correcta y necesaria: es lo
# único que permite a un repo con el v17 intacto actualizarse sin --force.
# Los bloques en esa situación viven como fixture en __tests__/fixtures/ y se
# declaran en BLOQUES_HUERFANOS (__tests__/ct-init.test.js), que es lo que
# los tests de autovigilancia unen al historial de git.
#
# Formato: un hash por línea, seguido de la procedencia (solo el primer campo
# se compara). Al cambiar el bloque hay que AÑADIR el hash nuevo — nunca
# sustituir uno viejo: sin él, los repos sembrados con esa variante vuelven a
# ser irreconocibles. Los dos tests de autovigilancia del final de
# __tests__/ct-init.test.js fallan si se olvida cualquiera de las dos cosas.
SLICES_PRISTINE_HASHES='
fcbc6afa3d90780dd05f9b3c62d8512ad8a0dda98bd2b6087a293088fcdb87b4  v1, 47 líneas — 9c6c8cf/d4a5ca8 (plugin 0.3.0–0.4.0)
7170dd1d5fedbe5482dd74ebe4ed8fdf989e7fd44eed65e7ffdb6614e7b2662a  v1, 57 líneas — 2faa2a8 (plugin 0.5.0)
53bd74b26ee8b331ad7d3e224dd81f0b7e51931ac751f5bfe019d19fe45e815c  v1, 60 líneas — 3475033 (plugin 0.5.1)
8c02c9e458589f1acabd48697d6a207e7308a9af80a5dfa3c7f944504f3e6a57  v1, 68 líneas — 896de17 (plugin 0.6.0)
f6da7d5dcc4ae0c2a0c71990ac9a71fe8092af0b71440c2ea946f1514377216f  v1, 70 líneas — 1ae5eee (plugin 0.6.0)
9628a6dc082694506dfb0911d5309308e82078b2bb62a28671ebef344a562932  v1, 73 líneas — 7ef5f4f (plugin 0.6.0)
c90554b809bc6af4f50613e75f160b0b0859ffce3412aeb44d10bef2d9da3e0a  v1, 77 líneas — 2b633ed (plugin 0.6.0)
7de20667a7c30a869cfcc1e56577de90e3214c4356c48ded040bf4dc0977159e  v1, 87 líneas — b968286 (plugin 0.6.0–0.8.0)
5d90ba2f8203469cc1aad5a189b2c25003d5223d13f920e4bbbe9e2320c3e9cb  v2, 134 líneas — 40adf2c (plugin 0.9.0–0.10.0)
8aaa19edfc9b57419972c509f4b558c6084d2a691592561a2b3d180ae59cfcc8  v3, 213 líneas — F11 (sección "Qué hace /ct-next con esto")
02247741819714164c8f45fbc42dcf26d11c7df58df6b81fae040b038fcf93c4  v4, 221 líneas — F10 (--section obsoleto, enlace al spec verificado)
cd59702d2c5d3a73b67ad235908b83bdc42c9da41996b14a33fba0749e359961  v5, 289 líneas — F13 (in-review retiene tokens, --reopen, alcance real de la serialización)
8de58db92770e9b8737280e024f0a7dae199b4a0dca2b7a535e631637c824fea  v6, 364 líneas — F15 (--reopen va a in-progress, --requeue, garantías de orden de /ct-groom)
8730d7be044a7ba8009d263947c57c56eb6558639cc506d22c460fcc6f9bacb9  v7, 385 líneas — F17 (el kickoff pide Closes #N; las DOS causas de "PR mergeado, issue abierto")
cef9a97a07edc8c403a37ffc846df74422c4d7d1d5aad02d90001a477b2ef811  v8, 419 líneas — F18 (el cierre accidental por commit; el residuo de labels sobre cerrados; el claim bloqueado; la causa que el kickoff no garantiza)
0050a5b1a216063a58beabb1237d08b0753f5390a3c82edcf8ae5c3526491485  v9, 427 líneas — F20 (las DOS sesiones por repo y su campo `role`: coordinadora vs. despachada)
ca63463cecb38df02011c5d079fd278488aa560bfb4ab5d0c7e95531d51e82e9  v10, 482 líneas — F21 (la columna Gate: el gate humano deja de ser un efecto colateral del Tipo)
6b799d34aa589c52cded8801aed641807e3d6591ae372fdd9973d6ebbb1d4d3d  v11, 493 líneas — F22 (el estado del slice vive en .agent/SLICE.md, ignorado; el STATE.md del worktree es el de la coordinadora y no se lee)
f1e9f868952d34a80bc7d15b50c0fce99cf375ebd3b1a76a37c6fdfa7b83e035  v12, 505 líneas — F23 (el milestone ya no puede divergir: el emparejado por ct-order está acotado al epic de la corrida)
8ffbc5d943295835c0cf0dbfd20941b280b99b997124b0337d88da6bf267a086  v13, 521 líneas — F27 (las comprobaciones previas al merge son puertas; la puerta de closing keywords y sus límites)
3896ed5610c6967510d6ad0ef83a18ef5eb6244a2015fd9af3b813bc8ba177b0  v14, 534 líneas — F27 (la puerta es propiedad de la sesión con el plugin cargado, no sólo del repo; con -C/cd a otro repo juzga el repo equivocado, no es ciega, y sus invocaciones envueltas sí lo son)
82a0391f7bffdd86a9b6506fa8db5c8866003129e2065b28a5e3bbe228a1a400  v15, 540 líneas — F28 (la puerta cubre lo que ejecuta Claude por su tool Bash, nunca lo que teclea el humano: ni su terminal ni el prefijo ! de la propia sesión)
bb8e3298fe9b587b929ab58fbf96f76909463a1cea292fa110878d4ba293f38e  v16, 540 líneas — F30 (la sección deja de llamarse "tabla §9" y pasa a "tabla de slices": el número era un fósil, groom localiza la tabla por sus columnas Slice+Dep y --section está obsoleto)
4d6eebf4ea94b7197879d30293dc4719d82399b7feeb7711829c28a1dcaa7f1c  v17, 543 líneas — F-jjponz-1 (el gate `plan` entra en el vocabulario: revisión humana del plan del slice antes de implementar, siempre opt-in)
9a45d3acdc0d5a776affb390ba890b90b86d77e2a5712626a839a93d7462bfba  v18, 544 líneas — F-jjponz-2 (el gate `plan` pasa a estar implicado por defecto en TODO slice; renuncia por fila con `!plan`)
9cdc355576fd1e7bbf69771a8c597c236f33ba31e37c32d998d3282a76e20f77  v19, 562 líneas — Slice 10 juez-lo-que-queda (la columna Señal: la señal de observabilidad por slice, con exención razonada N/A — <razón>)
40440bc510e0832695cbd73bc5912cb5bba8c16d89cb0cde0249b64b043dbafe  v20, 575 líneas — Slice 4 apuntes de Capde (la señal no es un criterio de aceptación más: promete lo que se verá en producción, que los criterios funcionales no cubren)
'

# emit_slices_contract: el bloque, en un solo sitio (lo usan tanto el camino
# de "no existe, se añade" como el de "--update-slices-contract").
emit_slices_contract() {
  cat <<'EOF'
<!-- ct-init:slices-contract -->
<!-- ct-init:slices-contract-version: 20 -->
## Formato de la tabla de slices (contrato con /ct-groom)
`/ct-groom` lee esta tabla del spec del epic y crea un issue de GitHub por
fila — es la única parte de un spec que un programa parsea. Cabecera exacta,
copiable tal cual:

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|

> **Lo que escribas fuera de la tabla de slices no llega al agente.** El agente que
> implementa un slice no recibe el spec: recibe un prompt de arranque y el
> CUERPO DEL ISSUE, y el cuerpo del issue se construye con estas columnas y
> nada más. Una exigencia escrita en otra sección del spec ("§10", "REGLA
> #-2", un párrafo de introducción) es invisible para él por muy contundente
> que esté redactada. Si algo tiene que cumplirlo el agente, tiene que caber
> en una de estas columnas — y si no cabe en ninguna, no cuentes con que se
> cumpla.

- **`#`** *(obligatoria)*: entero puro (`1`, `2`…) → orden del slice y target
  de `Dep`. Nunca `S1` ni `**1**` (negrita/prefijo): la fila entera se
  descarta.
- **Slice** *(obligatoria)*: nombre corto de la fila — alimenta el TÍTULO del
  issue (`#N <Slice>`). Vacía, con marcador de "sin valor", o que solo trae
  una referencia `#N` sin ningún nombre alrededor → fila descartada (mismo
  trato que antes tenía una `Entrega` vacía). Si la celda ya trae una
  referencia `#N` (p.ej. un issue creado a mano antes de correr
  `/ct-groom`), esa referencia se extrae aparte y NO aparece en el título.
  Ese mismo título es lo que `/ct-next` reinyecta al despachar: la primera
  línea del kickoff del agente y el nombre del workspace cmux salen de aquí
  — por eso conviene que sea corto y legible, no una frase.
- **Tipo** *(opcional)*: label `type:<valor>` del issue. Además decide qué
  **recordatorio técnico** (*addendum*) recibe el agente al despachar
  (`/ct-next` → `kickoff.js`): valores reconocidos hoy son `ui`, `backend`,
  `infra`, `bugfix`. Un valor que no sea ninguno de esos NO aborta, pero
  `/ct-groom` avisa por stderr: el agente despachado para ese slice no
  recibirá ningún addendum de tipo, y sin ese aviso pasaría en silencio.
  `Tipo` decide también los gates **por defecto** (ver `Gate`, justo debajo),
  pero ya no los decide en exclusiva: hasta el contrato v9 eran la misma
  columna, y un slice `backend` que necesitaba revisión visual no tenía forma
  de pedirla.
- **Gate** *(opcional)*: qué **gates humanos** hay que cerrar antes de mergear
  este slice — el otro eje, separado del `Tipo`. Vocabulario cerrado:
  - `visual` — un humano tiene que VER el cambio: captura/vídeo del
    antes/después en el PR;
  - `apply` — nada se aplica contra un entorno real hasta que un humano
    revise el plan/dry-run;
  - `plan` — antes de implementar, un humano revisa el PLAN del slice: el
    agente lo publica como comentario del issue y se detiene hasta el OK.
    Está implicado **por defecto en todos los slices**, venga el `Tipo` que
    venga; se renuncia por fila con `!plan` (y la renuncia se anuncia).

  **No hace falta escribir nada en el caso normal**: `Tipo: ui` implica
  `visual`, `Tipo: infra` implica `apply`, y **todo slice** lleva `plan` de
  serie. La columna sirve para las dos desviaciones:
  - **añadir** un gate que el `Tipo` no implica — `Tipo: backend` +
    `Gate: visual` (el caso real: una migración con backfill que mueve una
    barra de progreso muy visible). `/ct-groom` lo **anuncia por stderr**:
    llevas un gate que no viene de tu tipo;
  - **renunciar** a uno que sí implica, con un `!` delante: `!visual` sobre un
    `Tipo: ui` que de verdad no cambia nada visible. También se anuncia, y en
    voz más alta: quitar un gate nunca es silencioso. (El `!` y no un `-`
    porque `-` ya significa "sin valor" en todas las demás columnas.)

  Celda vacía o con marcador de "sin valor" (`–`) significa *no he declarado
  nada*, **no** "renuncio a todo". Un valor que no esté en el vocabulario
  **aborta** (a diferencia de `Tipo`): un gate desconocido no produciría label,
  ni instrucción al agente, ni línea en el issue — sería un gate que solo
  existe en el spec, que es justo lo que esta columna viene a impedir.

  A dónde llega: cada gate resuelto se escribe como label **`gate:<token>`** del
  issue (y **`gate:none`** cuando no hay ninguno — el silencio no puede
  significar a la vez "sin gates" y "issue anterior a los gates"), como sección
  **`## Gates`** del cuerpo del issue, y como instrucción explícita en el
  prompt del agente. Por eso sobrevive a un redespacho y a un `--reopen`: se
  lee del issue, no del spec.
- **Entrega** *(opcional)*: texto de qué entrega el slice → sección
  "Descripción" del cuerpo del issue. Ya NO alimenta el título (eso lo hace
  `Slice`, ver arriba).
- **Dep**: `#N` (varias, separadas por coma) apuntando a otro `#` de esta
  misma tabla, o marcador de "sin valor" si no depende de nada. `S1` no
  sirve — usa `#1`. Alimenta el grafo `merge-after` que respeta `/ct-next`.
  En el cuerpo del issue aparece como ``merge-after `#N` `` (entre backticks,
  a propósito: un `#N` desnudo lo convertiría GitHub en un enlace al issue
  número N de este repo, que no tiene nada que ver). Ese `#N` **siempre es el
  `#` de esta tabla — el ORDEN del slice, nunca un número de issue**;
  `/ct-next` lo traduce por el marcador `ct-order` que cada issue lleva al
  final.
- **Acepta** *(opcional)*: criterios de aceptación separados por coma →
  sección "Acceptance criteria" del issue, uno por línea. **La coma separa
  SIEMPRE**: un criterio en EARS ("Cuando caduca el token, el sistema pide
  login") se partiría en dos criterios a medias. Si el tuyo lleva coma,
  escápala como `\,` (`Cuando caduca el token\, el sistema pide login`) o
  reformula sin ella. Solo la secuencia exacta `\,` es un escape — una barra
  invertida suelta se conserva tal cual.
- **Protegido** *(opcional)*: qué queda fuera de alcance → sección "Out of
  scope / Protected" del issue. Texto libre de una sola pieza: aquí la coma
  **no** separa nada, escribe con normalidad.
- **Área / Toca** *(opcionales, separadas por coma)*: tokens → labels
  `area:<x>` / `touches:<y>`. Misma clave que usan la detección de colisión
  (`claim.js#tokensOf`) y la serialización (`dispatch.js#SERIALIZING_TOUCHES`):
  reutiliza el vocabulario de labels que ya exista en este repo, no inventes
  uno nuevo por spec. Para ver cuál existe: `gh label list --repo
  <owner/repo>` (y `/ct-groom` te dice, al correr, qué labels ha creado
  NUEVAS y cuáles ha reutilizado — si aparece una nueva que esperabas
  reutilizar, es que has escrito un sinónimo). Un token no puede contener
  comas: se descartan al normalizar, aquí `\,` no sirve de nada.
  `migration`/`ci`/`pbxproj` en `Toca` son especiales — serializan entre sí:
  como mucho un slice con uno de esos tres sin mergear a la vez, sin importar
  `Área`. El alcance real de ese "global" está más abajo, en "Qué hace
  `/ct-next` con esto": es global **al flujo de issues de este repo**, que no
  es lo mismo que global al repo.
- **Señal** *(opcional)*: la SEÑAL DE OBSERVABILIDAD que este slice
  promete — qué métrica, log o evento tiene que emitir su código de
  producción (p.ej. "métrica `backfill_progress` con label `estado`").

  NO ES UN CRITERIO DE ACEPTACIÓN MÁS. Los criterios de `Acepta` son
  funcionales: dicen qué tiene que hacer el código para que el slice
  esté hecho, y el juez ya los mide en su ítem `estado-final`. La
  señal promete otra cosa: QUÉ SE VA A VER EN PRODUCCIÓN cuando el
  slice esté desplegado — la métrica, el log o el evento por el que
  alguien sabrá, sin leer el diff, si esto está funcionando. Una señal
  que repite un criterio de aceptación con otras palabras deja al ítem
  `observabilidad` midiendo lo que `estado-final` ya midió: no añade
  ninguna información. Regla práctica: si lo que escribes se puede
  comprobar corriendo los tests, es un criterio de aceptación, no una
  señal.

  Texto libre de una sola pieza, como `Protegido`: la coma no separa
  nada. Llega como sección `## Señal de observabilidad` del cuerpo del
  issue, viaja al `.agent/SLICE.md` del worktree en el despacho, y el
  JUEZ DE SLICE la mide contra el diff acumulado (ítem `observabilidad`):
  que lo prometido lo emita código de producción, instrumentado como ya
  instrumenta este repo, sin labels de cardinalidad ilimitada. Si el
  slice no tiene nada observable que prometer, se declara la EXENCIÓN
  RAZONADA: `N/A — <razón>` (el mismo idioma que la Global verification
  de un plan). Una exención SIN razón **aborta**: una exención que nadie
  puede leer es una señal sin declarar disfrazada de decisión. Celda
  vacía o con marcador de "sin valor" significa *no lo he pensado* — no
  es una exención: el juez lo mide como `sin-vara`, y esa cuenta viaja en
  la telemetría del epic.

Marcadores de "sin valor" (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`/`Gate`/`Señal`):
`–` `-` `—` `―` `−` `--` o celda vacía — cualquier variante de guion vale.

### Lo que crea `/ct-groom` NO es despachable todavía

Todos los issues nacen con **`status:backlog`**, y `/ct-next` solo despacha
`status:ready`. Promoverlos es un paso **humano y deliberado** — es el gate
del loop: tú decides qué entra en vuelo y cuándo, el groom nunca lo hace por
ti. Si `/ct-next` responde "no hay slices despachables" justo después de
groomear un epic entero, es esto:

```
gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog
```

`/ct-groom` recuerda al terminar cuántos issues del epic siguen en backlog.
De ahí en adelante el label `status:` lo mueven `/ct-next` y el flujo
(`ready` → `in-progress` → `in-review`, y de vuelta a `ready` si la revisión
rechaza el PR — ver "Rechazar un PR" más abajo), no el spec — por eso
re-groomear nunca lo compara ni lo revierte.

### Decisiones tuyas que dependen de cómo se invoque `/ct-groom`

- **`--milestone "<título>"`** (por defecto `Epic`): una invocación = un epic
  = un milestone, que `/ct-groom` crea si no existe. Los `#` de esta tabla son
  únicos **dentro de su milestone**, no del repo: dos epics distintos pueden
  usar `#1` sin pisarse. Pero si dos epics comparten milestone (p.ej. ambos
  con el título por defecto `Epic`), sus órdenes chocan y `/ct-next` excluye
  ese epic entero de la selección, avisando. Dale a cada epic su propio
  título de milestone.
- **`--section N`**: OBSOLETO, se acepta y se ignora (avisando). Nunca decidió
  qué se groomeaba: la tabla se localiza por su **cabecera** (una fila con
  columnas `Slice` y `Dep`), no por ningún número de sección — así que si el
  documento trae ANTES otra tabla con esas dos columnas, se groomeará esa. Una
  sola tabla de slices por spec. Lo único que hacía `--section` era componer el
  ancla del enlace al spec como `#N`, un ancla que en GitHub no existe.
- **El enlace al spec** que se escribe en cada issue sale ahora del encabezado
  real bajo el que pongas la tabla (`## 9. Slices` → `…/blob/<rama por
  defecto>/ruta/al/spec.md#9-slices`), y se **verifica** contra GitHub antes de
  escribirlo. Consecuencia para ti: **empuja el spec antes de groomear**. Si el
  fichero no está publicado en la rama por defecto, los issues nacen con una
  referencia de texto sin enlace (diciendo por qué), y `/ct-groom` no lo corrige
  en corridas posteriores sin `--reconcile`.
- **`--project <n>`** *(opcional)*: mete cada issue en el Project v2 número
  `n` **del mismo owner que `--repo`** (un project de otro owner no está
  soportado) y le fija el campo de iteración llamado exactamente `Sprint` a la
  iteración vigente hoy. Si no existe ese campo, o ninguna iteración cubre la
  fecha de hoy, `/ct-groom` aborta **sin haber creado nada** — ni milestone, ni
  labels, ni issues. (Hasta el contrato v5 esto no era cierto: el project se
  validaba después del milestone y de las labels, y un abort las dejaba
  creadas.)

#### Qué garantiza `/ct-groom` sobre lo que ya ha tocado cuando falla

Esto importa porque la respuesta natural —"un abort a mitad deja el repo a
medias"— asusta y lleva a limpiar a mano cosas que no hay que limpiar.

- **Todo lo que `/ct-groom` LEE ocurre antes de todo lo que ESCRIBE.** Las
  validaciones —argumentos, tabla de slices, spec y su enlace, listado de issues, de
  labels y de milestones, y (con `--project`) el campo `Sprint` con su
  iteración vigente— van **todas** por delante de la primera mutación. Si
  aborta por cualquiera de ellas, **no ha creado nada**.
- **Lo que NO se promete: no hay transacción.** Una vez empieza a escribir, el
  orden es milestone → labels → issues → alta en el Project. Un fallo *ahí* en
  medio (red, rate limit, auth caída, un Ctrl-C) deja creado lo anterior. No
  hay rollback y no se finge que lo haya.
- **De eso se sale volviendo a correr, no limpiando a mano.** `/ct-groom` es
  idempotente por construcción: el milestone se reutiliza por título, de las
  labels solo se crean las que faltan (las que ya existían **no** se tocan,
  ni su color ni su descripción), los issues se reconocen por su marcador
  `ct-order` y no se duplican, y un issue que quedó fuera del Project se
  detecta y se añade en la siguiente corrida.
- **Sin `--reconcile`, un issue que ya existe NUNCA se edita.** Las
  divergencias se reportan y se sale `3`; nada se escribe.
- **`--dry-run` no muta nada, nunca** — ni siquiera crea el milestone.

Ejemplo que parsea tal cual (verificado con `ct-groom.mjs --dry-run`):

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|
| 1 | modelo | backend | tabla `medicamentos` | – | AC-1.1 | schema | medicacion | db, migration | – | – |
| 2 | barra | backend | backfill con progreso visible | #1 | AC-2.1 | – | medicacion | db, migration | visual | métrica `backfill_progress` con label `estado` |
| 3 | pantalla | ui | pantalla de alta | #2 | AC-3.1 | – | medicacion | app | – | N/A — pantalla sin telemetría nueva que prometer |

(La fila 2 es el caso que la columna `Gate` existe para cubrir: es `backend`
por dentro y lo más visible del epic por fuera. La fila 3 no declara nada y
recibe su gate `visual` igualmente, por ser `Tipo: ui`. La fila 2 declara
además su señal de observabilidad y la fila 3 se exime con razón — con la
fila 1, las tres formas de la columna `Señal` en un mismo ejemplo.)

**Arreglar la tabla y volver a groomear NO arregla los issues ya creados.**
Re-ejecutar `/ct-groom` no los duplica (los reconoce por su marcador
`ct-order`), pero tampoco los actualiza: compara título, enlace al spec,
labels (`type:`/`area:`/`touches:`/`gate:`; `status:` nunca) y las
dos secciones que el dispatcher obedece
(`## Dependencias`, `## Acceptance criteria`) contra lo que la tabla produce
hoy, **reporta** cada diferencia por stderr y sale `3` — pero no escribe nada
salvo que se le pase `--reconcile` (EXPERIMENTAL: ha corrompido bodies reales
en pruebas, revisa el diff del issue después de usarlo). Un issue cuyo slice
ya no está en la tabla se avisa como huérfano y no se toca. Si cambias algo
en una fila ya groomeada, cuenta con revisar ese issue a mano.

**El milestone NO está en esa lista, y no es un olvido.** Un groom sólo mira
los issues del milestone que le has pasado, así que un issue emparejado tiene
siempre, por construcción, ese mismo milestone: la divergencia de milestone es
inalcanzable desde `/ct-groom` y nunca la vas a ver reportada. Si mueves un
issue de milestone en GitHub y vuelves a correr, lo que obtienes no es un
aviso de divergencia: según a dónde lo hayas movido, o se ignora por ser de
otro epic, o `/ct-groom` se para en seco con **exit 1** sin crear ni modificar
nada, o crea un issue nuevo para ese slice avisando de que puede estar
duplicándolo. Consecuencia práctica de ese mismo alcance: **la tabla de slices de
cada spec puede empezar en `1`** sin pisar los issues de un epic anterior.
Ver "El alcance de un groom es su epic, no el repo" en `commands/ct-groom.md`.

Detalle completo (todas las condiciones de abort, columnas opcionales,
avisos no fatales, el reporte de divergencia, sus límites, y `--reconcile`):
`commands/ct-groom.md` en el plugin `control-tower-loop`.

### Qué hace `/ct-next` con esto

Lo de abajo NO es la referencia de invocación (esa es `commands/ct-next.md` en
el plugin): es lo que cambia cómo escribes la tabla y cómo convives con el
loop una vez hay slices en vuelo.

- **`Área`/`Toca` no avisan: BLOQUEAN.** Un slice que comparta **un solo
  token** con un issue en `status:in-progress` **o `status:in-review`**
  no se despacha — `/ct-next` lo salta y prueba el siguiente candidato; si no
  queda ninguno, no lanza nada y dice contra qué issue chocó y en qué estado.
  Elegir los tokens **es** elegir qué puede volar en paralelo: dos slices con
  un token en común quedan serializados aunque toquen ficheros distintos.
- **Un token se retiene hasta el MERGE, no hasta que el agente pare.** El
  agente libera su claim al abrir el PR (`in-progress` → `in-review`), y eso
  suelta el **cap** — pero no los tokens: hasta que el PR se mergea y el
  issue se cierra, `main` todavía no contiene ese trabajo, así que un vecino
  de área ramificaría de una base incompleta. Consecuencia al diseñar la
  tabla: **un PR sin mergear frena a sus vecinos de área**, no solo a sus
  dependientes. Dos slices que comparten token no se solapan ni "un poquito".
  Y si `/ct-next` te dice que choca con un `status:in-review`, esperar no
  sirve de nada: ahí no hay ningún agente. Mergea el PR — o, si el PR ya se
  mergeó y el issue sigue abierto, ciérralo **como *completed***
  (`gh issue close <n> --reason completed`).
- **"PR mergeado, issue abierto" tiene DOS causas, y la segunda engaña.** Es
  el estado que tapa un carril para siempre, así que conviene saber
  diagnosticarlo entero:
  - al PR le faltaba el `Closes #N` en el cuerpo. El kickoff que `/ct-next`
    le da a cada agente lo pide explícitamente, pero el kickoff es un
    PROMPT, no un gate: **la causa más probable de este caso es simplemente
    que el agente no lo puso** (además de un PR abierto a mano, o un cuerpo
    editado después). Nada del loop lo comprueba;
  - el PR SÍ llevaba su `Closes #N`, pero se mergeó en una rama que **no es
    la rama por defecto** del repo. GitHub **solo cierra el issue cuando el
    PR entra en la rama por defecto** — verificado contra un repo real, no
    deducido de la documentación. Es el caso que engaña: miras el PR, ves el
    `Closes #N` ahí puesto, y descartas el diagnóstico correcto.
  Consecuencia operativa: si despachas con `/ct-next --base <otra-rama>`,
  **cerrar cada issue al mergear su PR es un paso a mano, siempre** — el
  `Closes #N` no lo va a hacer por ti. `/ct-next` lo avisa por stderr cada vez
  que le pasas `--base`.
- **`migration`/`ci`/`pbxproj` serializan además GLOBALMENTE, con un alcance
  concreto.** Son dos reglas distintas actuando a la vez: la de arriba
  compara tokens, esta no. Un slice con `Toca: migration` y otro con
  `Toca: ci` **no comparten ningún token** y aun así no pueden estar sin
  mergear a la vez, sin importar `Área`. **Qué significa "global" de verdad:
  `/ct-next` solo mira issues de ESTE repo con `status:in-progress` o
  `status:in-review`.** Todo lo que va por fuera del flujo de issues es
  INVISIBLE para esta regla: otra rama, otro track de trabajo, un humano
  editando la misma migración a mano, un repo distinto. La serialización es
  global **al flujo de issues de este repo**, no al repositorio ni al
  proyecto. Si tienes trabajo en paralelo fuera del loop, esta garantía no lo
  cubre y no hay nada en el plugin que pueda cubrirlo.
- **`merge-after` se comprueba mirando CÓMO se cerró el issue.** Una
  dependencia cuenta como satisfecha si su issue está **cerrado como
  *completed*** — que es lo que GitHub hace al mergear un PR con `Closes #N`.
  Un PR aprobado, un PR abierto o un issue en `status:in-review` no
  desbloquean nada. Las dos trampas de esa aproximación, dichas sin adornos:
  - un issue cerrado como ***not planned*** (lo correcto para un slice
    descartado) **no** satisface la dep y deja a sus dependientes esperando
    para siempre. `/ct-next` lo nombra al explicar el bloqueo: si ves eso,
    quita el `merge-after` de la sección `## Dependencias` del dependiente, o
    reabre el issue y ciérralo como *completed* si su trabajo sí se hizo;
  - un issue cerrado como ***completed*** sin que se haya mergeado nada **sí**
    satisface la dep, y el dependiente saldrá sobre trabajo que no existe.
    **Esto no requiere que nadie se equivoque a propósito**: GitHub aplica las
    *closing keywords* de **cualquier mensaje de commit** que llegue a la rama
    por defecto, y **las comillas no protegen**. En un repo real, un commit de
    **documentación** que solo MENCIONABA la cadena `Closes #451` —dentro de
    una frase que explicaba que el kickoff no la llevaba— cerró ese issue como
    *completed*.
    `/ct-next` **avisa** (no bloquea) cuando una dependencia ya satisfecha
    consta cerrada por un **commit suelto** que no pertenece a ningún PR
    mergeado. Lo que **no** exige es que el cierre venga de un PR: cerrar el
    issue a mano es la práctica mayoritaria (medido: 86 de 97 cierres
    *completed* de un repo real no tienen ningún PR detrás) y además es un paso
    **prescrito** aquí mismo cuando se despacha con `--base <otra-rama>`.
    Cuidado con escribir esas keywords en cualquier commit, aunque sea
    entrecomillándolas. El plugin **bloquea** el commit cuando la keyword viaja
    en el mensaje (`-m`) de un `git commit` lanzado desde **una sesión de
    Claude que tenga este plugin cargado**, contra un repo que tenga esta
    sección en su `AGENTS.md`. Es una propiedad de la SESIÓN, no sólo del
    repo: un agente despachado arranca con su propia cuenta
    (`CLAUDE_CONFIG_DIR`, ver `resolveAccount` en `scripts/dispatch.js`), así
    que sólo lleva la puerta si el plugin está instalado también ahí.
    Y la regla que resume qué queda fuera, porque una lista de excepciones
    envejece peor que el principio del que salen: **la puerta engancha en el
    tool `Bash`, así que cubre lo que ejecuta CLAUDE, nunca lo que tecleas
    TÚ**. Ni en tu terminal, ni con el prefijo `!` dentro de la propia sesión
    de Claude: un `!` no pasa por el tool, así que ningún hook lo ve. Medido
    en un repo gobernado, con el MISMO mensaje: bloqueado desde el tool
    `Bash`, limpio con `!`. Lo que además **no ve**, y por tanto sigue siendo
    tuyo: un `git commit` **sin** `-m` (el mensaje lo pone el editor), un
    `-F <fichero>` y un `--amend --no-edit`; ni una invocación
    **envuelta**, donde `git` deja de ser el primer token — `sudo git
    commit`, `env FOO=1 git commit`, `command git commit`. Con `git -C
    <ruta> commit -m ...` o `cd <ruta> && git commit -m ...` el problema no
    es que no la vea: la puerta decide sobre el repo del directorio de LA
    SESIÓN, nunca sobre el que señala `<ruta>`, y eso corta en los dos
    sentidos — puede bloquear un commit dirigido a un repo que no gobierna
    (sesión dentro de uno gobernado, `<ruta>` fuera) y no proteger uno
    dirigido a un repo que sí gobierna (sesión fuera, `<ruta>` dentro). Para
    lo que se escape sigue estando el aviso de `/ct-next` de aquí arriba: eso
    caza el EFECTO, la puerta caza la CAUSA, y ninguno de los dos lo caza
    todo.
  Al diseñar la tabla: el slice del que dependen muchos es el **cuello de
  botella** del epic entero — nada detrás de él avanza hasta que ESE se
  mergee. Si quieres una ventana de paralelismo, tiene que salir de la
  columna `Dep`.
- **Un issue CERRADO que conserva su label `status:` no existe para
  `/ct-next`.** El dispatcher solo barre issues **abiertos**. Un cerrado con
  `status:ready` todavía puesta se cae de la cola de despacho, y hasta ahora
  se caía **sin una palabra**: la corrida siguiente pasaba al siguiente
  `status:ready` del repo y explicaba con detalle por qué *ése* no era
  despachable, sin mencionar el que había desaparecido. Ahora sale un aviso
  agregado —uno solo, con los números agrupados por estado— porque **cerrar el
  issue y quitarle su label son dos actos distintos y nada comprueba el
  segundo**: la tasa medida en un repo real es de **10 cerrados con label viva
  de cada 99**. Un `status:in-review` sobre un issue cerrado NO es anomalía:
  es el final normal de un slice, y nada le quita esa label al cerrar.
- **Un slice BLOQUEADO retiene su claim, y no hay transición que lo suelte.**
  Si el agente marca `blocked: {reason, unblock}` en el `.agent/SLICE.md` de su
  worktree y para —que es lo que el kickoff le pide—, su issue se queda en
  `status:in-progress` **reteniendo tokens y una plaza de `--cap`**
  indefinidamente: la detección de claims rancios no lo ve (el worktree y la
  rama SÍ existen), `--requeue` se niega precisamente por eso, y `--release`
  mentiría (no hay PR). `/ct-next` **lee** ese `SLICE.md` (antes de F22 era el
  `.agent/STATE.md` del worktree; hoy ése es el de la coordinadora y **no** se
  lee) y lo dice con su motivo, pero **no lo arregla**: sacarlo de ahí es una
  decisión tuya (desbloquearlo, o abandonarlo borrando worktree y rama antes
  de `--requeue`).
- **Una invocación despacha `--cap` slices; por defecto es 1.** Y el cap es
  **global al repo, no por invocación**: cuenta también lo que ya está en
  vuelo (`status:in-progress`), así que un segundo `/ct-next --cap 1` con algo
  corriendo no lanza nada — y lo dice. Un `status:in-review` **no** ocupa cap
  (no hay ningún agente corriendo ahí), aunque sí retenga sus tokens: son dos
  contabilidades distintas. Un slice reabierto con `--reopen` vuelve a
  `in-progress` y por tanto **sí** ocupa cap: esta vez hay alguien
  rehaciéndolo. Aprovechar una ventana de paralelismo es un acto
  explícito: `/ct-next --cap 2` (o más).
- **Las dos garantías de arriba valen para UN dispatcher a la vez.** El claim
  es un label de GitHub, sin compare-and-swap: está reproducido y verificado
  que dos `/ct-next` lanzados casi a la vez contra el mismo repo pueden
  reclamar el mismo token compartido y arrancar los dos, saltándose tanto la
  regla de colisión como el cap. No hay espera ni reintento que cierre ese
  hueco hoy. **La mitigación es operativa: no lances dos dispatchers a la vez
  sobre el mismo repo.** (Detalle y evidencia: `commands/ct-next.md`.)
- **`/ct-next` no acota por epic.** Acepta `--repo`, `--cap`, `--base` y
  `--dry-run`; **no hay `--milestone`**. Barre todos los issues abiertos del
  repo y elige por el `#` más bajo de la tabla, venga del epic que venga (ese
  `#` sí se resuelve dentro de su propio milestone para traducir `Dep`, pero
  la SELECCIÓN no se acota). Con dos epics vivos, el `#1` del segundo le gana
  al `#3` del primero — y si los dos tienen un `#1` despachable, **cuál sale
  primero no está definido**: depende del orden en que GitHub devuelva los
  issues. La palanca para decidir qué epic avanza es la que ya tienes:
  promover a `status:ready` solo los slices que quieras en vuelo.
- **Hace falta `cmux`.** Es un gestor de workspaces de terminal, externo al
  plugin: cada slice se lanza como `cmux new-workspace` (un worktree + una
  sesión de `claude`). Si `cmux` no está en el PATH, **ningún** slice puede
  lanzarse — `/ct-next` aborta en las precondiciones, antes de reclamar nada.
  `/ct-groom` y `/ct-init` no lo necesitan: es requisito solo del dispatch.
- **Interrupción y reanudación.** Un Ctrl-C (SIGINT/SIGTERM) a media corrida
  revierte a `status:ready` el claim que hubiera quedado a medias antes de
  salir. Re-invocar `/ct-next` es **idempotente** por construcción: un slice
  ya despachado está en `status:in-progress`, así que ya no es `status:ready`
  y no se vuelve a elegir (aunque sigue ocupando cap). Cada slice usa la rama
  `feat/<n>` y el worktree `.worktrees/<n>` (`<n>` = número de ISSUE, no el
  `#` de la tabla); si alguno de los dos ya existe de una corrida anterior,
  `/ct-next` se niega a despachar ese slice **antes** de reclamarlo e imprime
  el comando de limpieza exacto.
- **Un claim es un label, sin heartbeat: nada lo caduca.** Si un slice muere
  (sesión cerrada, máquina apagada, un agente que nunca ejecutó su
  `--release`), su `status:in-progress` se queda puesto y bloquea
  indefinidamente a todos los que compartan sus tokens, hasta que alguien lo
  revierta **a mano**:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` es la versión **comprobada** de la edición a mano: se niega si
  el worktree `.worktrees/<n>` o la rama `feat/<n>` siguen existiendo, porque
  entonces el trabajo de ese slice sigue vivo sin mergear y soltar sus tokens
  dejaría salir a un vecino sobre una base que no lo contiene. Si de verdad
  quieres saltarte esa comprobación (sabes que ese trabajo no importa y
  prefieres conservar el worktree), la edición cruda sigue estando y no
  comprueba nada:

  ```
  gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:in-progress
  ```

  `/ct-next` ayuda hasta donde puede: si un `status:in-progress` no tiene ni
  worktree, ni rama, ni sesión de cmux **en esta máquina**, lo dice — tanto
  si bloquea por token compartido como si solo está ocupando el `--cap`. Pero
  no puede afirmar que esté abandonado (pudo reclamarse desde otro sitio), y
  **solo se entera quien esté corriendo `/ct-next` en ese momento**: no hay
  ningún demonio vigilando claims entre invocaciones. Comprueba antes de
  romper un claim ajeno. (Esta comprobación NO se hace sobre un
  `status:in-review`: ahí no tener sesión abierta es lo normal, no una
  anomalía — lo que bloquea es el PR sin mergear, no un claim muerto.)

### Rechazar un PR en el gate, sin sacar el slice del loop

`status:in-review` **no** es un estado terminal, pero salir de él es un acto
deliberado tuyo: no hay ninguna transición automática de vuelta. El ciclo
completo de un slice, con quién mueve cada arista:

```
backlog --(tú)--> ready --(/ct-next)--> in-progress --(--release)--> in-review
                    ^                        ^                          |
                    |                        +-------(--reopen)---------+
                    +---------(--requeue)----+
```

Si rechazas el PR de un slice, devuélvelo al banco de trabajo con

```
node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --reopen
```

que lo mueve `in-review` → **`in-progress`** —el inverso exacto de
`--release`— **solo si de verdad está en `in-review`** (si no, se niega sin
tocar ninguna label). Que quede en `in-progress` y no en `ready` **no es un
detalle**: su trabajo sigue existiendo sin mergear en `feat/<n>`, así que
**sigue reteniendo sus tokens** de `Área`/`Toca` hasta el merge. Reabrir **no
desbloquea a sus vecinos** — solo dice quién lo está rehaciendo. Y ocupa una
plaza de `--cap`, porque esta vez sí hay alguien trabajándolo.

No borra nada del disco: te dice qué queda de la vuelta anterior (el worktree
`.worktrees/<n>` y la rama `feat/<n>`) y te deja elegir entre dos caminos
excluyentes:

- **corregir encima** de lo que ya hay — lo normal tras un rechazo: sigues en
  ese mismo worktree y ese mismo PR, y **no** invocas `/ct-next` para ese
  slice (se negaría, precisamente porque el worktree y la rama existen).
  Cuando vuelva a estar listo, repites el `--release`;
- **empezar de cero** — borras worktree y rama (comprueba antes que no
  pierdes trabajo sin pushear), cierras su PR, y **solo entonces** lo
  devuelves a la cola:

  ```
  node <plugin>/scripts/dispatch-check.mjs <n> --repo <owner/repo> --requeue
  ```

  `--requeue` mueve `in-progress` → `ready`, y es la ÚNICA transición que
  suelta tokens sin un merge, así que **comprueba antes de declararlo**: exige
  que en esta máquina no quede ni `.worktrees/<n>` ni `feat/<n>`, y se niega
  también si no ha podido mirarlo (no se declara ausente lo que no se ha
  visto). Lo que **no** puede comprobar y te dice cada vez: la rama en el
  remoto y el PR abierto. Si siguen ahí, ese trabajo sigue sin mergear y ya no
  hay nadie reteniendo su área.

`--requeue` sirve además para el otro caso de siempre: **romper un claim
muerto** (un `status:in-progress` cuyo agente ya no existe). Es la versión
comprobada del `gh issue edit` a mano que aparece más arriba.

Sin estas dos aristas, un PR rechazado dejaba su slice fuera del loop **para
siempre**, y con él todo lo que dependiera de él: `/ct-next` solo despacha
`status:ready`.
- **Cada slice en vuelo tiene SU `.agent/SLICE.md`**: el de su worktree
  (`.worktrees/<n>/.agent/SLICE.md`), sembrado al despachar (antes de F22 la
  semilla iba al `.agent/STATE.md` del worktree — un fichero TRACKEADO, y por
  eso los PRs de slice acababan llevándose el estado a `main`). Dos slices a
  la vez no se pisan ese fichero, y ninguno toca ningún `.agent/STATE.md`: ni
  el del checkout principal ni el que su propio worktree hereda de la base,
  que se queda a cero diff. `.agent/SLICE.md` está **ignorado** por dos vías:
  el `.gitignore` del repo (lo añade `/ct-init`) y el `info/exclude` del
  directorio común de git (lo escribe `/ct-next` en cada despacho, y desde ahí
  cubre a todos los worktrees). Así no entra en ningún commit — y `--release`
  se niega si la rama introduce cualquiera de los dos ficheros de estado.
- **Dos sesiones por repo, con papeles OPUESTOS, y cada una lo lleva escrito
  en su fichero de estado (campo `role`): el `.agent/STATE.md` del checkout
  principal, el `.agent/SLICE.md` de cada worktree.** La del **checkout
  principal** es la *coordinadora*: groomea, despacha con `/ct-next`, revisa y
  mergea. La de cada `.worktrees/<n>` es la *despachada*: implementa ese slice
  y **para** — no mergea, no despacha el siguiente. Antes ese reparto solo
  existía dentro del kickoff que recibía una de las dos, así que se perdía en
  cuanto esa sesión se re-hidrataba de su fichero de estado. Ningún código lo
  comprueba: es información para el agente que lo lee.
- **Qué recibe el agente despachado**: un prompt de arranque (*kickoff*) con
  el nombre del slice, el número de issue, los criterios de la sección
  "Acceptance criteria", el aviso de leer la sección "Out of scope /
  Protected", el addendum técnico de su `Tipo`, **sus gates humanos** (los de
  la columna `Gate`, o los que implique su `Tipo`), la rama base contra la que
  tiene que abrir el PR, la orden de poner **`Closes #N` en el cuerpo de ese
  PR** (con el porqué: sin ese cierre, el slice retiene sus tokens para
  siempre y no desbloquea a sus dependientes) y el comando literal para
  liberar el claim al terminar; más el `.agent/SLICE.md` sembrado en su
  worktree (que repite su `role` y sus gates, para sobrevivir a un `/clear`;
  antes de F22 esa semilla iba al `.agent/STATE.md`, que es el de la
  coordinadora) y lo que el propio repo le dé al arrancar (`AGENTS.md`,
  `CLAUDE.md`, hooks). **No recibe el
  spec**: se hidrata del issue. **Lo que no llegó al cuerpo del issue no llega
  al agente.** Ninguna exigencia que le hagas desde otra sección del spec —una
  §10, una "REGLA #-2", un párrafo de introducción— le va a llegar, por muy
  contundente que esté redactada. Lo que el kickoff **no** puede garantizar es que el agente
  obedezca: si un PR aparece sin su `Closes #N`, el loop no lo detecta — lo
  verás como un `status:in-review` que no se despeja. Lo mismo vale para los
  gates: el loop los **escribe y los enseña** (kickoff, label `gate:`, sección
  `## Gates` del issue), pero **no impide mergear** un PR con su gate sin
  cerrar. El que cierra el gate eres tú.
  **Y por eso tus comprobaciones previas al merge tienen que ser PUERTAS.**
  Verifica el EFECTO, nunca el exit code: si el resultado de una comprobación no
  puede detener el merge, no es una comprobación, es decoración. En campo, una
  comprobación de contaminación del estado imprimió `1` y el merge entró igual —
  hubo que arreglar la rama por defecto a posteriori—; la misma comprobación,
  convertida en puerta, paró el siguiente. Vale para todo lo que mires antes de
  mergear, no sólo para los gates: si lo compruebas a mano, que el resultado
  mande.

<sub>Esta sección la mantiene `/ct-init` (contrato v20). Si el plugin trae una
versión más nueva, `/ct-init` lo avisa al correr; para adoptarla:
`bash <plugin>/scripts/ct-init.sh <dir-repo> --update-slices-contract`, que
solo la reemplaza si no la has editado a mano.</sub>
<!-- /ct-init:slices-contract -->
EOF
}

# sha256_of: hash del fichero, con el binario que haya (macOS trae `shasum`,
# la mayoría de Linux `sha256sum`). Si no hay ninguno, devuelve vacío y quien
# llama trata el bloque como "no verificable" — nunca como "intacto".
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else echo ''; fi
}

# F9, caso que no estaba contemplado: un AGENTS.md con saltos de línea CRLF
# (repo editado en Windows, fichero pasado por una herramienta que los
# convierte, `core.autocrlf`…) llevaba un `\r` pegado al final de CADA línea,
# incluidos los marcadores. `grep -qxF '<!-- ct-init:slices-contract -->'` no
# encontraba NI el marcador de apertura, NI el de cierre, NI el heading, así
# que el script concluía "esta sección no existe todavía" y AÑADÍA una segunda
# copia entera de las 134 líneas al final del fichero — en silencio, exit 0, y
# saltándose de paso el guardián de rastro parcial de d4a5ca8, que existe
# justo para que eso no pueda pasar. Todas las comparaciones de línea de aquí
# en adelante ignoran un `\r` final.
#
# has_line: ¿está esa línea EXACTA en el fichero, con o sin `\r` al final?
# Con awk y no con `grep -qE '…\r?$'` porque el texto buscado es literal y
# alguno lleva paréntesis (el heading), que en una ERE significarían otra cosa;
# y no con `tr -d '\r' | grep -qxF` para no meter una dependencia nueva: si
# faltara `tr`, esto respondería "no está" y volveríamos a duplicar la sección.
has_line() {
  awk -v want="$1" '
    { line = $0; sub(/\r$/, "", line) }
    line == want { found = 1; exit }
    END { exit !found }
  ' "$2"
}

# extract_slices_block: el bloque tal cual está HOY en el AGENTS.md, del
# marcador de apertura al de cierre, ambos incluidos. Se imprime NORMALIZADO
# (sin `\r`): así el hash de un bloque intacto pero con saltos CRLF coincide
# con el registrado — que es la verdad ("nadie ha tocado este texto") en vez de
# un "no lo reconozco" motivado por los saltos de línea.
extract_slices_block() {
  awk -v om="$SLICES_MARKER_OPEN" -v cm="$SLICES_MARKER_CLOSE" '
    { line = $0; sub(/\r$/, "", line) }
    line == om { f = 1 }
    f { print line }
    f && line == cm { exit }
  ' "$1"
}

# slices_block_is_crlf: ¿el bloque presente usa CRLF? Decide con qué saltos se
# reescribe, para no dejar un fichero con la mitad de las líneas en un formato
# y la mitad en otro.
slices_block_is_crlf() {
  awk -v om="$SLICES_MARKER_OPEN" -v cm="$SLICES_MARKER_CLOSE" '
    { line = $0; sub(/\r$/, "", line) }
    line == om { f = 1 }
    f && line != $0 { crlf = 1 }
    f && line == cm { exit }
    END { exit !crlf }
  ' "$1"
}

# replace_slices_block: sustituye el bloque entero (marcadores incluidos) por
# la versión actual, dejando intacto TODO lo que haya antes y después — el
# AGENTS.md del usuario no se regenera, solo se empalma esta sección.
replace_slices_block() {
  local newblock outfile
  newblock="$(mktemp)"; outfile="$(mktemp)"
  if slices_block_is_crlf "$AGENTS_MD"; then
    emit_slices_contract | awk '{ printf "%s\r\n", $0 }' > "$newblock"
  else
    emit_slices_contract > "$newblock"
  fi
  awk -v nf="$newblock" -v om="$SLICES_MARKER_OPEN" -v cm="$SLICES_MARKER_CLOSE" '
    { line = $0; sub(/\r$/, "", line) }
    line == om && !done { inb = 1; while ((getline l < nf) > 0) print l; close(nf); done = 1; next }
    inb && line == cm { inb = 0; next }
    inb { next }
    { print }
  ' "$AGENTS_MD" > "$outfile"
  mv "$outfile" "$AGENTS_MD"
  rm -f "$newblock"
}

# slices_block_hash: sha256 del bloque presente, o vacío si esta máquina no
# tiene con qué calcularlo. Se guarda en una global porque los mensajes lo
# citan: un hash que no reconocemos es justo el dato que hace falta para
# registrarlo (y para que quien lo reporte no tenga que explicar nada más).
SLICES_BLOCK_HASH=''
compute_slices_block_hash() {
  local blockfile
  blockfile="$(mktemp)"
  extract_slices_block "$AGENTS_MD" > "$blockfile"
  SLICES_BLOCK_HASH="$(sha256_of "$blockfile")"
  rm -f "$blockfile"
}

# slices_block_status: `pristine` | `unknown` | `unverifiable`. Tres estados,
# no dos (F9): "no coincide con ningún hash conocido" y "no se ha podido
# calcular el hash" son cosas distintas, y colapsarlas en un solo `return 1`
# era lo que hacía que una máquina sin `shasum` ni `sha256sum` acusara al
# usuario de haber editado una sección que estaba intacta.
# Lee SLICES_BLOCK_HASH; hay que llamar antes a compute_slices_block_hash
# desde el shell padre (esta se usa dentro de `$(...)`, y lo que asignara ahí
# se quedaría en la subshell).
slices_block_status() {
  if [ -z "$SLICES_BLOCK_HASH" ]; then echo unverifiable; return; fi
  # Un hash por línea, con la procedencia detrás: solo se compara el campo 1.
  if printf '%s\n' "$SLICES_PRISTINE_HASHES" |
     awk -v h="$SLICES_BLOCK_HASH" '$1 == h { found = 1 } END { exit !found }'; then
    echo pristine
  else
    echo unknown
  fi
}

has_open=0; has_line "$SLICES_MARKER_OPEN" "$AGENTS_MD" && has_open=1 || true
has_close=0; has_line "$SLICES_MARKER_CLOSE" "$AGENTS_MD" && has_close=1 || true
has_heading=0
has_line "$SLICES_HEADING" "$AGENTS_MD" && has_heading=1 || true
# F30: el heading viejo cuenta como rastro. Si no, un AGENTS.md con la sección
# de antes del renombrado y sin marcadores dejaría de reconocerse y recibiría
# una segunda copia entera (el fallo que cerró la review de F2).
has_line "$SLICES_HEADING_LEGACY" "$AGENTS_MD" && has_heading=1 || true
if [ "$has_open" -eq 1 ] && [ "$has_close" -eq 1 ]; then
  # F6, menor 6: hasta ahora esto era un "ya está, no se duplica" a secas —
  # que es exactamente lo que hacía invisible que la sección presente pudiera
  # ser de una versión anterior del contrato.
  # F9: la versión se lee del BLOQUE, no del fichero entero. Con `grep` sobre
  # todo el AGENTS.md, cualquier línea de versión citada más arriba (el propio
  # marcador copiado en una nota, un ejemplo dentro de un fence) ganaba por
  # `head -n1` y el script anunciaba "contrato vNN, al día" sobre un bloque que
  # ni siquiera había mirado — callándose el aviso que le tocaba dar.
  found_version="$(extract_slices_block "$AGENTS_MD" | grep -o "$SLICES_VERSION_LINE_RE" | head -n1 | grep -o '[0-9]\{1,\}' || true)"
  [ -z "$found_version" ] && found_version=1 # sin línea de versión = el contrato original (pre-F6)
  compute_slices_block_hash
  block_status="$(slices_block_status)"
  # `hash: …` para los mensajes que hablan de un bloque no reconocido: es el
  # único dato con el que quien lo reporte puede conseguir que se registre.
  hash_note="hash del bloque presente: ${SLICES_BLOCK_HASH:-no calculable en esta máquina}"
  if [ "$found_version" -gt "$SLICES_CONTRACT_VERSION" ]; then
    # F9: esto antes caía en el "al día" de abajo. No es al día: el bloque es
    # de un plugin MÁS NUEVO que el que lo está mirando, así que describe un
    # contrato que este ct-init/ct-groom puede no cumplir. Decirlo.
    echo "aviso: la sección del contrato de slices de $AGENTS_MD es del contrato v$found_version, y este plugin solo llega a la v$SLICES_CONTRACT_VERSION — la sembró una versión más nueva del plugin. No se toca (degradarla sería perder lo que ya tienes). Si /ct-groom no se comporta como describe esa sección, el desactualizado es el plugin: actualízalo." >&2
  elif [ "$found_version" -eq "$SLICES_CONTRACT_VERSION" ]; then
    if [ "$UPDATE_SLICES_CONTRACT" -eq 1 ] && [ "$block_status" = unknown ]; then
      # Se pidió sincronizar y el número de versión ya es el actual, pero el
      # contenido no es el que emite este plugin. No es "al día" a secas: el
      # número coincide y el texto no. Pasó de verdad — el contenido del
      # bloque cambió nueve veces bajo el mismo "v1". (Con el hash sin poder
      # calcular no se entra aquí: no habría nada que actualizar de todos
      # modos, y afirmar que el contenido difiere sería inventárselo.)
      if [ "$FORCE" -eq 1 ]; then
        replace_slices_block
        echo "aviso: la sección del contrato de slices de $AGENTS_MD ya declaraba v$found_version pero su contenido no coincidía con el que trae este plugin ($hash_note); se ha reemplazado por el actual porque lo pediste con --force. Si había ediciones tuyas en esa sección, ya no están." >&2
      else
        echo "aviso: la sección del contrato de slices de $AGENTS_MD ya declara la v$found_version (la actual), así que no hay actualización de versión que hacer, pero su contenido NO es el que emite este plugin ($hash_note). Puede ser una edición tuya, o una variante distinta que se publicó con el mismo número de versión. No se toca nada; con --force se reemplazaría por el bloque v$SLICES_CONTRACT_VERSION de este plugin." >&2
      fi
    else
      echo "sección del contrato de slices ya está en $AGENTS_MD (contrato v$found_version, al día), no se duplica"
    fi
  elif [ "$UPDATE_SLICES_CONTRACT" -eq 1 ]; then
    if [ "$block_status" = pristine ]; then
      replace_slices_block
      echo "sección del contrato de slices actualizada en $AGENTS_MD: contrato v$found_version → v$SLICES_CONTRACT_VERSION (estaba sin editar; el resto del fichero no se ha tocado)"
    elif [ "$block_status" = unverifiable ] && [ "$FORCE" -eq 0 ]; then
      # F9: antes esto caía en el "la has editado a mano" de abajo — la
      # acusación más falsa de todas, porque aquí no se ha llegado a comparar
      # nada. Categoría propia, con su propia salida.
      echo "aviso: no se ha podido comprobar si la sección del contrato de slices de $AGENTS_MD sigue tal cual la dejó ct-init: esta máquina no tiene ni \`shasum\` ni \`sha256sum\`, y esa comprobación es lo único que impide pisar ediciones tuyas. No se toca nada — el bloque puede estar perfectamente intacto, simplemente no se sabe. Instala uno de los dos (coreutils trae \`sha256sum\`; \`shasum\` viene con perl) y repite, o pasa --force si te consta que esa sección no la has editado." >&2
      exit 3
    elif [ "$FORCE" -eq 1 ]; then
      replace_slices_block
      if [ "$block_status" = unverifiable ]; then
        echo "aviso: la sección del contrato de slices de $AGENTS_MD se ha sobrescrito con el contrato v$SLICES_CONTRACT_VERSION porque lo pediste con --force, SIN haber podido comprobar si estaba sin editar (esta máquina no tiene \`shasum\` ni \`sha256sum\`). Si había ediciones tuyas en esa sección, ya no están: recupéralas del control de versiones." >&2
      else
        echo "aviso: la sección del contrato de slices de $AGENTS_MD no coincidía con ninguna versión que este ct-init sepa reconocer ($hash_note) y se ha sobrescrito con el contrato v$SLICES_CONTRACT_VERSION porque lo pediste con --force. Si había ediciones tuyas en esa sección, ya no están: recupéralas del control de versiones." >&2
      fi
    else
      # F9: este mensaje decía "la has editado a mano". No lo sabe. Lo único
      # que sabe es que el hash no está en su lista, y esa lista solo cubre
      # los bloques que ESTE ct-init conoce: un bloque sembrado por una
      # versión del plugin que no tiene registrada (pasó con ocho de las nueve
      # variantes del contrato v1) es indistinguible de una edición a mano.
      # No se elige la interpretación que culpa al usuario.
      echo "aviso: la sección del contrato de slices de $AGENTS_MD es del contrato v$found_version (el actual es v$SLICES_CONTRACT_VERSION), pero su contenido no coincide con ninguno de los bloques que este ct-init sabe reconocer ($hash_note). Eso puede ser (a) una edición a mano de esa sección, o (b) un bloque intacto sembrado por una versión del plugin cuyo hash este ct-init no lleva registrado — desde aquí NO hay forma de distinguirlas, así que no se toca nada por si es (a). Para salir de dudas, mira el historial de $AGENTS_MD (\`git log -p -- AGENTS.md\`): si esa sección no se ha tocado desde que se creó, es (b) — repórtalo con ese hash para que quede registrado, y mientras tanto pasa --force junto a --update-slices-contract para adoptar el contrato v$SLICES_CONTRACT_VERSION (si SÍ había ediciones tuyas, se pierden)." >&2
      exit 3
    fi
  else
    # Corrida normal (sin el flag): solo se avisa. F9 — el estado del bloque ya
    # está calculado, así que el aviso puede decir si actualizar es seguro en
    # vez de dejar al usuario con el "podrías tenerla editada a mano" genérico.
    case "$block_status" in
      pristine) update_note="Está exactamente como la dejó ct-init, así que actualizarla no pierde nada:" ;;
      unverifiable) update_note="No se ha podido comprobar si está sin editar (esta máquina no tiene ni \`shasum\` ni \`sha256sum\`), así que la actualización se negará hasta que lo instales:" ;;
      *) update_note="Su contenido no coincide con ningún bloque que este ct-init reconozca ($hash_note) — puede ser una edición tuya o una versión que no tiene registrada, así que la actualización se negará sin --force:" ;;
    esac
    echo "aviso: la sección del contrato de slices de $AGENTS_MD es del contrato v$found_version, y este plugin trae la v$SLICES_CONTRACT_VERSION — no se toca nada por defecto. $update_note bash $HERE/scripts/ct-init.sh $TARGET --update-slices-contract" >&2
  fi
elif [ "$has_open" -eq 1 ] || [ "$has_close" -eq 1 ] || [ "$has_heading" -eq 1 ]; then
  echo "aviso: $AGENTS_MD parece tener restos parciales de la sección del contrato de slices (contrato /ct-groom) — falta el marcador de apertura, el de cierre, o ambos no acompañan al heading; no se añade nada para no duplicar contenido. Revisa $AGENTS_MD a mano: si la sección sigue siendo válida, complétala con '$SLICES_MARKER_OPEN' antes del heading y '$SLICES_MARKER_CLOSE' al final." >&2
else
  # Mismo idiom que el bloque de .gitignore de arriba (y el mismo bug que
  # evita: un `.gitignore`/`AGENTS.md` con contenido que NO termina en `\n`
  # haría que un `>>` crudo fusionara nuestra primera línea con la última
  # línea del usuario, corrompiéndola).
  if [ -s "$AGENTS_MD" ] && [ "$(tail -c1 "$AGENTS_MD" | wc -l)" -eq 0 ]; then
    echo >> "$AGENTS_MD"
  fi
  echo >> "$AGENTS_MD"
  emit_slices_contract >> "$AGENTS_MD"
  echo "añadida sección del contrato de slices (contrato /ct-groom v$SLICES_CONTRACT_VERSION) a $AGENTS_MD"
fi

# §3.12 (docs/prompt-juez-lo-que-queda.md): `reference-paths` prueba que lo que
# §3 citó EXISTE, pero nada probaba que se citara TODO lo relevante — un
# `docs/conventions/` que sí está en el repo pasaba el validador limpio por
# omisión. Este barrido es determinista y offline y su único producto es una
# LISTA: no escribe en .agent/conventions.md, no declara nada y no añade
# ninguna puerta humana — la confirmación es la que ya existe, la persona que
# está corriendo /ct-init. Va por STDOUT y no por stderr a propósito: no es una
# alarma sobre un conflicto, es material para una decisión, igual que las
# líneas de "creado ...". (Y hay un test que exige que la segunda corrida no
# escriba ningún "aviso" por stderr.)
VARA_STATUS=0
VARA_OUT=''
if command -v node >/dev/null 2>&1; then
  VARA_OUT="$(node "$HERE/scripts/detect-vara.mjs" "$TARGET" 2>/dev/null)" || VARA_STATUS=$?
else
  VARA_STATUS=127
fi
if [ "$VARA_STATUS" -ne 0 ]; then
  echo "no se ha podido barrer este repo en busca de candidatos a la vara (.agent/conventions.md): la comprobación necesita \`node\` y no se ha podido ejecutar (estado $VARA_STATUS). NO lo leas como \"este repo no tiene convenciones escritas\": no se ha mirado." >&2
elif [ -n "$VARA_OUT" ]; then
  printf '%s\n' "$VARA_OUT"
fi

# F11, parte B: hasta ahora ct-init bootstrapeaba ENCIMA de las convenciones
# que el repo ya tuviera, sin enterarse. El caso real (menoplus): el repo ya
# traía `scripts/dispatch-check.sh` con su línea en AGENTS.md mandando
# ejecutarlo, y una convención `git worktree add .claude/worktrees/<slug>` con
# un hook que la vigila. El plugin trae SU PROPIO dispatch-check.mjs y usa
# `.worktrees/<n>`/`feat/<n>`, y esta sección se escribió al lado de la que ya
# había: el AGENTS.md acabó contradiciéndose en dos sitios, y dos protocolos de
# claim quedaron operando sobre el mismo espacio de labels sin nadie que
# arbitre. Eso no puede volver a pasar EN SILENCIO.
#
# Se AVISA, no se aborta ni se cambia nada: la decisión (cuál de los dos manda)
# es del usuario y no hay ninguna que ct-init pueda tomar por él sin romper algo.
# Por eso también sigue saliendo 0 — el bootstrap ha hecho su trabajo.
#
# La detección vive en node (scripts/conventions.js, lógica pura + tests) y no
# aquí, para que ct-next.mjs pueda usar EXACTAMENTE la misma y los dos avisos no
# puedan divergir. Si node no está, o el escaneo falla, se dice: un silencio
# aquí sería indistinguible de "repo limpio", y ese es justo el falso negativo
# que cuesta un deadlock.
CONV_STATUS=0
CONV_OUT=''
if command -v node >/dev/null 2>&1; then
  CONV_OUT="$(node "$HERE/scripts/detect-conventions.mjs" "$TARGET" 2>/dev/null)" || CONV_STATUS=$?
else
  CONV_STATUS=127
fi
if [ "$CONV_STATUS" -ne 0 ]; then
  echo "aviso: no se ha podido comprobar si este repo ya tiene convenciones propias (claim, worktrees, fichero de estado) que choquen con las del loop — la comprobación necesita \`node\` y no se ha podido ejecutar (estado $CONV_STATUS). NO lo leas como \"no hay ninguna\": no se ha mirado. Si este repo ya traía su propio script de claim o su propia ruta de worktrees, revísalo a mano antes de correr /ct-next." >&2
elif [ -n "$CONV_OUT" ]; then
  printf '%s\n' "$CONV_OUT" >&2
fi
