#!/usr/bin/env bash
# ct-init: bootstrap de un repo para el loop Control Tower. Idempotente.
set -euo pipefail
TARGET="${1:?uso: ct-init.sh <dir-repo>}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$TARGET/.agent"
if [ ! -f "$TARGET/.agent/STATE.md" ]; then
  cp "$HERE/skills/state-template/STATE.template.md" "$TARGET/.agent/STATE.md"
  echo "creado $TARGET/.agent/STATE.md"
else
  echo "STATE.md ya existe, no se pisa"
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
has_open=0; grep -qxF "$SLICES_MARKER_OPEN" "$AGENTS_MD" && has_open=1 || true
has_close=0; grep -qxF "$SLICES_MARKER_CLOSE" "$AGENTS_MD" && has_close=1 || true
has_heading=0; grep -qxF "$SLICES_HEADING" "$AGENTS_MD" && has_heading=1 || true
if [ "$has_open" -eq 1 ] && [ "$has_close" -eq 1 ]; then
  echo "sección §9 ya está en $AGENTS_MD, no se duplica"
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
  cat >> "$AGENTS_MD" <<'EOF'
<!-- ct-init:slices-contract -->
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
- **Acepta** *(opcional)*: criterios de aceptación, coma-separados → sección
  "Acceptance criteria" del issue.
- **Protegido** *(opcional)*: qué queda fuera de alcance → sección "Out of
  scope / Protected" del issue.
- **Área / Toca** *(opcionales, coma-separadas)*: tokens → labels
  `area:<x>` / `touches:<y>`. Misma clave que usan la detección de colisión
  (`claim.js#tokensOf`) y la serialización (`dispatch.js#SERIALIZING_TOUCHES`):
  reutiliza el vocabulario de labels que ya exista en este repo, no inventes
  uno nuevo por spec. `migration`/`ci`/`pbxproj` en `Toca` son especiales —
  serializan **globalmente**: como mucho un slice con uno de esos tres en
  vuelo a la vez, en todo el repo, sin importar `Área`.

Marcadores de "sin valor" (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`): `–` `-`
`—` `―` `−` `--` o celda vacía — cualquier variante de guion vale.

Ejemplo que parsea tal cual (verificado con `ct-groom.mjs --dry-run`):

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|
| 1 | modelo | backend | tabla `medicamentos` | – | AC-1.1 | schema | medicacion | db, migration |
| 2 | api | backend | endpoint `POST /medicamentos` | #1 | AC-2.1 | – | medicacion | api |
| 3 | pantalla | ui | pantalla de alta | #2 | AC-3.1 | – | medicacion | app |

Re-ejecutar `/ct-groom` tras arreglar la tabla **no duplica issues, pero
tampoco los actualiza solo**: si un issue ya existe (por su marcador
`ct-order`), `/ct-groom` compara su título/labels (`type:`/`area:`/`touches:`,
`status:` queda fuera adrede)/milestone contra lo que la tabla produce hoy y
**reporta** cualquier diferencia — nunca la aplica sin que se pida
`--reconcile` explícitamente. "No duplica" no es "converge".

Detalle completo (todas las condiciones de abort, columnas opcionales,
avisos no fatales, el reporte de divergencia y `--reconcile`):
`commands/ct-groom.md` en el plugin `control-tower-loop`.
<!-- /ct-init:slices-contract -->
EOF
  echo "añadida sección §9 (contrato /ct-groom) a $AGENTS_MD"
fi
