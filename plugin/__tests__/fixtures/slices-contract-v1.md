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
`ct-order`), `/ct-groom` compara título/enlace-al-spec (solo el ancla
`#sección`, nunca la ruta — evita falsas divergencias si invocas el
comando una vez con ruta relativa y otra con absoluta)/milestone/labels
(`type:`/`area:`/`touches:`, cada uno solo si su columna está en la tabla;
`status:` queda fuera adrede) Y las secciones del body que el dispatcher
obedece de verdad (`## Dependencias`, `## Acceptance criteria`, comparadas
solo dentro de su propia cabecera — igualdad exacta; AC tolera exactamente
dos formas literales conocidas, nunca un prefijo abierto) contra lo que la
tabla produce hoy, y **reporta** cualquier diferencia (exit `3` si queda
algo real sin resolver, incluida una de esas dos secciones duplicada) —
nunca la aplica sin que se pida `--reconcile` explícitamente. "No duplica"
no es "converge". Un issue cuyo slice ya no está en la tabla (huérfano) se
avisa, no se toca solo. `--dry-run --repo` ya necesita red/auth de `gh`
(antes era 100% offline).

**`--reconcile` es EXPERIMENTAL**: aplica lo detectado (título/milestone/
labels/enlace-al-spec/AC/dependencias) vía `gh issue edit`, pero varias
rondas de review ya le encontraron formas distintas de corromper un body
real (todas arregladas al encontrarlas) — al usarlo, `/ct-groom` avisa por
stderr antes de tocar nada, y conviene revisar el diff del issue en GitHub
después de cada corrida en vez de confiar a ciegas en el mensaje
"reconciliado". Sin `--reconcile`, nada de esto aplica: detectar y
reportar (el comportamiento por defecto) nunca escribe nada.

Detalle completo (todas las condiciones de abort, columnas opcionales,
avisos no fatales, el reporte de divergencia, sus límites, y `--reconcile`):
`commands/ct-groom.md` en el plugin `control-tower-loop`.
<!-- /ct-init:slices-contract -->
