#!/usr/bin/env bash
# ct-init: bootstrap de un repo para el loop Control Tower. Idempotente.
set -euo pipefail
TARGET="${1:?uso: ct-init.sh <dir-repo> [--update-slices-contract] [--force]}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
shift || true

# F6, menor 6: hasta ahora, cualquier corrección del contrato de la §9 se
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

GITIGNORE="$TARGET/.gitignore"
touch "$GITIGNORE"
# Normaliza un salto de línea final ANTES de tocar nada más (bloqueante de la
# re-review): si el fichero ya tiene contenido pero no termina en `\n` (p.ej.
# `printf 'node_modules/' > .gitignore`, sin salto final), un `>>` de bash
# concatena la línea nueva en la MISMA línea que la última — corrompe la
# regla previa del usuario (`node_modules/` deja de ignorarse, ¡en SU repo,
# no en el nuestro!) y además `.worktrees/` tampoco queda ignorado de verdad
# (todo el propósito del finding 6, silenciosamente incumplido). `tail -c1 |
# wc -l` es el idiom robusto para detectar "termina en \n": mirar
# directamente `$(tail -c1 ...)` no sirve porque la sustitución de comandos
# siempre recorta los saltos de línea finales, así que un fichero que SÍ
# termina en \n sería indistinguible de uno vacío.
if [ -s "$GITIGNORE" ] && [ "$(tail -c1 "$GITIGNORE" | wc -l)" -eq 0 ]; then
  echo >> "$GITIGNORE"
fi
# .worktrees/ (fix de la review final, finding 6): ct-next.mjs escribe cada
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

# Sección "Formato de la tabla §9" (F2 — el contrato con /ct-groom): hasta
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
SLICES_HEADING='## Formato de la tabla §9 (contrato con /ct-groom)'
# SLICES_CONTRACT_VERSION (F6): versión del CONTENIDO del bloque. Viaja en una
# línea propia justo detrás del marcador de apertura, no dentro de él: el
# marcador de apertura se mantiene idéntico al de siempre para que un repo
# bootstrapeado antes de F6 (sin línea de versión, "v1") siga reconociéndose
# con los mismos `grep -qxF` de siempre, sin ninguna migración.
SLICES_CONTRACT_VERSION=2
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
5d90ba2f8203469cc1aad5a189b2c25003d5223d13f920e4bbbe9e2320c3e9cb  v2, 134 líneas — 40adf2c (plugin 0.9.0–)
'

# emit_slices_contract: el bloque, en un solo sitio (lo usan tanto el camino
# de "no existe, se añade" como el de "--update-slices-contract").
emit_slices_contract() {
  cat <<'EOF'
<!-- ct-init:slices-contract -->
<!-- ct-init:slices-contract-version: 2 -->
## Formato de la tabla §9 (contrato con /ct-groom)
`/ct-groom` lee esta tabla del spec del epic y crea un issue de GitHub por
fila — es la única parte de un spec que un programa parsea. Cabecera exacta,
copiable tal cual:

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|

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
  addendum recibe el agente al despachar (`/ct-next` → `kickoff.js`):
  valores reconocidos hoy son `ui`, `backend`, `infra`, `bugfix` — cada uno
  con su propio addendum (el de `ui`, por ejemplo, impone el gate de
  screenshot obligatorio). Un valor que no sea ninguno de esos NO aborta,
  pero `/ct-groom` avisa por stderr: el agente despachado para ese slice no
  recibirá ningún addendum de tipo, y sin ese aviso pasaría en silencio.
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
  `migration`/`ci`/`pbxproj` en `Toca` son especiales — serializan
  **globalmente**: como mucho un slice con uno de esos tres en vuelo a la
  vez, en todo el repo, sin importar `Área`.

Marcadores de "sin valor" (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`): `–` `-`
`—` `―` `−` `--` o celda vacía — cualquier variante de guion vale.

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
(`ready` → `in-progress` → `in-review`), no el spec — por eso re-groomear
nunca lo compara ni lo revierte.

### Decisiones tuyas que dependen de cómo se invoque `/ct-groom`

- **`--milestone "<título>"`** (por defecto `Epic`): una invocación = un epic
  = un milestone, que `/ct-groom` crea si no existe. Los `#` de esta tabla son
  únicos **dentro de su milestone**, no del repo: dos epics distintos pueden
  usar `#1` sin pisarse. Pero si dos epics comparten milestone (p.ej. ambos
  con el título por defecto `Epic`), sus órdenes chocan y `/ct-next` excluye
  ese epic entero de la selección, avisando. Dale a cada epic su propio
  título de milestone.
- **`--section N`** (por defecto `9`): solo alimenta el enlace al spec que se
  escribe en cada issue (`ruta/al/spec.md#N`). La tabla se localiza por su
  **cabecera** (una fila con columnas `Slice` y `Dep`), no por el número de
  sección — así que si el documento trae ANTES otra tabla con esas dos
  columnas, se groomeará esa. Una sola tabla de slices por spec.
- **`--project <n>`** *(opcional)*: mete cada issue en el Project v2 número
  `n` **del mismo owner que `--repo`** (un project de otro owner no está
  soportado) y le fija el campo de iteración llamado exactamente `Sprint` a la
  iteración vigente hoy. Si no existe ese campo, o ninguna iteración cubre la
  fecha de hoy, `/ct-groom` aborta antes de crear ningún issue (el milestone y
  las labels sí pueden haberse creado ya).

Ejemplo que parsea tal cual (verificado con `ct-groom.mjs --dry-run`):

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|
| 1 | modelo | backend | tabla `medicamentos` | – | AC-1.1 | schema | medicacion | db, migration |
| 2 | api | backend | endpoint `POST /medicamentos` | #1 | AC-2.1 | – | medicacion | api |
| 3 | pantalla | ui | pantalla de alta | #2 | AC-3.1 | – | medicacion | app |

**Arreglar la tabla y volver a groomear NO arregla los issues ya creados.**
Re-ejecutar `/ct-groom` no los duplica (los reconoce por su marcador
`ct-order`), pero tampoco los actualiza: compara título, enlace al spec,
milestone, labels (`type:`/`area:`/`touches:`; `status:` nunca) y las dos
secciones que el dispatcher obedece
(`## Dependencias`, `## Acceptance criteria`) contra lo que la tabla produce
hoy, **reporta** cada diferencia por stderr y sale `3` — pero no escribe nada
salvo que se le pase `--reconcile` (EXPERIMENTAL: ha corrompido bodies reales
en pruebas, revisa el diff del issue después de usarlo). Un issue cuyo slice
ya no está en la tabla se avisa como huérfano y no se toca. Si cambias algo
en una fila ya groomeada, cuenta con revisar ese issue a mano.

Detalle completo (todas las condiciones de abort, columnas opcionales,
avisos no fatales, el reporte de divergencia, sus límites, y `--reconcile`):
`commands/ct-groom.md` en el plugin `control-tower-loop`.

<sub>Esta sección la mantiene `/ct-init` (contrato v2). Si el plugin trae una
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
has_heading=0; has_line "$SLICES_HEADING" "$AGENTS_MD" && has_heading=1 || true
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
    echo "aviso: la sección §9 de $AGENTS_MD es del contrato v$found_version, y este plugin solo llega a la v$SLICES_CONTRACT_VERSION — la sembró una versión más nueva del plugin. No se toca (degradarla sería perder lo que ya tienes). Si /ct-groom no se comporta como describe esa sección, el desactualizado es el plugin: actualízalo." >&2
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
        echo "aviso: la sección §9 de $AGENTS_MD ya declaraba v$found_version pero su contenido no coincidía con el que trae este plugin ($hash_note); se ha reemplazado por el actual porque lo pediste con --force. Si había ediciones tuyas en esa sección, ya no están." >&2
      else
        echo "aviso: la sección §9 de $AGENTS_MD ya declara la v$found_version (la actual), así que no hay actualización de versión que hacer, pero su contenido NO es el que emite este plugin ($hash_note). Puede ser una edición tuya, o una variante distinta que se publicó con el mismo número de versión. No se toca nada; con --force se reemplazaría por el bloque v$SLICES_CONTRACT_VERSION de este plugin." >&2
      fi
    else
      echo "sección §9 ya está en $AGENTS_MD (contrato v$found_version, al día), no se duplica"
    fi
  elif [ "$UPDATE_SLICES_CONTRACT" -eq 1 ]; then
    if [ "$block_status" = pristine ]; then
      replace_slices_block
      echo "sección §9 actualizada en $AGENTS_MD: contrato v$found_version → v$SLICES_CONTRACT_VERSION (estaba sin editar; el resto del fichero no se ha tocado)"
    elif [ "$block_status" = unverifiable ] && [ "$FORCE" -eq 0 ]; then
      # F9: antes esto caía en el "la has editado a mano" de abajo — la
      # acusación más falsa de todas, porque aquí no se ha llegado a comparar
      # nada. Categoría propia, con su propia salida.
      echo "aviso: no se ha podido comprobar si la sección §9 de $AGENTS_MD sigue tal cual la dejó ct-init: esta máquina no tiene ni \`shasum\` ni \`sha256sum\`, y esa comprobación es lo único que impide pisar ediciones tuyas. No se toca nada — el bloque puede estar perfectamente intacto, simplemente no se sabe. Instala uno de los dos (coreutils trae \`sha256sum\`; \`shasum\` viene con perl) y repite, o pasa --force si te consta que esa sección no la has editado." >&2
      exit 3
    elif [ "$FORCE" -eq 1 ]; then
      replace_slices_block
      if [ "$block_status" = unverifiable ]; then
        echo "aviso: la sección §9 de $AGENTS_MD se ha sobrescrito con el contrato v$SLICES_CONTRACT_VERSION porque lo pediste con --force, SIN haber podido comprobar si estaba sin editar (esta máquina no tiene \`shasum\` ni \`sha256sum\`). Si había ediciones tuyas en esa sección, ya no están: recupéralas del control de versiones." >&2
      else
        echo "aviso: la sección §9 de $AGENTS_MD no coincidía con ninguna versión que este ct-init sepa reconocer ($hash_note) y se ha sobrescrito con el contrato v$SLICES_CONTRACT_VERSION porque lo pediste con --force. Si había ediciones tuyas en esa sección, ya no están: recupéralas del control de versiones." >&2
      fi
    else
      # F9: este mensaje decía "la has editado a mano". No lo sabe. Lo único
      # que sabe es que el hash no está en su lista, y esa lista solo cubre
      # los bloques que ESTE ct-init conoce: un bloque sembrado por una
      # versión del plugin que no tiene registrada (pasó con ocho de las nueve
      # variantes del contrato v1) es indistinguible de una edición a mano.
      # No se elige la interpretación que culpa al usuario.
      echo "aviso: la sección §9 de $AGENTS_MD es del contrato v$found_version (el actual es v$SLICES_CONTRACT_VERSION), pero su contenido no coincide con ninguno de los bloques que este ct-init sabe reconocer ($hash_note). Eso puede ser (a) una edición a mano de esa sección, o (b) un bloque intacto sembrado por una versión del plugin cuyo hash este ct-init no lleva registrado — desde aquí NO hay forma de distinguirlas, así que no se toca nada por si es (a). Para salir de dudas, mira el historial de $AGENTS_MD (\`git log -p -- AGENTS.md\`): si esa sección no se ha tocado desde que se creó, es (b) — repórtalo con ese hash para que quede registrado, y mientras tanto pasa --force junto a --update-slices-contract para adoptar el contrato v$SLICES_CONTRACT_VERSION (si SÍ había ediciones tuyas, se pierden)." >&2
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
    echo "aviso: la sección §9 de $AGENTS_MD es del contrato v$found_version, y este plugin trae la v$SLICES_CONTRACT_VERSION — no se toca nada por defecto. $update_note bash $HERE/scripts/ct-init.sh $TARGET --update-slices-contract" >&2
  fi
elif [ "$has_open" -eq 1 ] || [ "$has_close" -eq 1 ] || [ "$has_heading" -eq 1 ]; then
  echo "aviso: $AGENTS_MD parece tener restos parciales de la sección §9 (contrato /ct-groom) — falta el marcador de apertura, el de cierre, o ambos no acompañan al heading; no se añade nada para no duplicar contenido. Revisa $AGENTS_MD a mano: si la sección sigue siendo válida, complétala con '$SLICES_MARKER_OPEN' antes del heading y '$SLICES_MARKER_CLOSE' al final." >&2
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
  echo "añadida sección §9 (contrato /ct-groom v$SLICES_CONTRACT_VERSION) a $AGENTS_MD"
fi
