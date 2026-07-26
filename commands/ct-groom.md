---
description: Groom de un epic — spec §9 → GitHub (Milestone + issues + labels + Project v2 + Sprint)
---
Corre el groom sobre el spec del epic. Primero en seco para revisar el plan:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --section 9 --dry-run
```
Revisa el JSON. Si está bien, ejecútalo de verdad (añade `--project <n>` para el Project v2):
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --project <n>
```
Es idempotente: re-ejecutarlo no duplica milestone ni issues (marca cada issue con `<!-- ct-order:N -->`). **Pero "no duplica" NO significa "converge"**: idempotencia solo por existencia (F5). Si arreglas un título, un label o el milestone en la tabla §9 y vuelves a correr, `/ct-groom` no toca el issue ya creado — reporta la diferencia, no la aplica sola. Ver "Re-ejecutar no converge solo" más abajo.

Los issues se crean en `status:backlog`, nunca `status:ready` — es una gate humana deliberada: un humano tiene que promoverlos a `status:ready` (a mano, o editando el label) antes de que `/ct-next` los considere despachables. Si `/ct-next` responde "No hay slices despachables" justo después de un groom, es casi seguro que sea esto.

El título del issue sale de `Slice` (`#N <Slice>`), NO de `Entrega`: `Slice` es el nombre corto de la fila, `Entrega` es opcional y se convierte en la sección "Descripción" del cuerpo. Ese mismo título es lo que `/ct-next` reinyecta al despachar (primera línea del kickoff del agente, nombre del workspace cmux) — por eso `Slice` debe ser corto y legible, no una frase. `Tipo` decide, además de la label `type:<valor>`, qué addendum recibe el agente al despachar (`ui`/`backend`/`infra`/`bugfix`, ver `scripts/kickoff.js#ADDENDA`) — un valor que no sea ninguno de esos no aborta, pero avisa por stderr (el agente despachado para ese slice no recibirá ningún addendum de tipo).

La tabla §9 del spec admite dos columnas opcionales, `Área` y `Toca` (acepta también `Area` sin tilde), con valores separados por coma. "Sin valor" se puede escribir como `–`, `-`, `—`, `−`, `--` o celda vacía (cualquier variante de guion/dash es válida — un editor de texto o un móvil con autocorrección puede sustituir una por otra sin que lo notes; todas significan "ninguno" en `Dep`/`Acepta`/`Área`/`Toca`):
```
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |
|---|-------|------|---------|-----|--------|-----------|------|------|
| 1 | modelo | backend | tabla users | – | AC-1.1 | schema | api | db, migration |
| 2 | api | backend | endpoint | #1 | AC-2.1 | – | api | – |
```
`/ct-groom` traduce cada valor en labels `area:<x>`/`touches:<y>` sobre el issue — son las mismas que `claim.js#tokensOf` y `dispatch.js#SERIALIZING_TOUCHES` usan para detectar colisión y forzar serialización. Si un slice no declara `Área`/`Toca` (o el spec ni siquiera trae esas columnas), no se emite ninguna label de ese tipo y la maquinaria de colisión/serialización queda inerte para ese slice, igual que antes.

### La tabla se valida entera antes de tocar GitHub

`/ct-groom` (también bajo `--dry-run`: un dry-run que valida menos que la corrida real es una trampa) revisa la tabla §9 completa y **aborta con exit distinto de 0**, sin crear nada, si:

- no encuentra ninguna tabla §9, o encuentra tabla(s) pero ninguna cabecera con columnas `Slice` y `Dep`;
- falta la columna de cabecera `#`;
- hay una interrupción (línea en blanco, o cualquier línea sin `|`) a mitad del bloque de la tabla — debe ser un único bloque markdown contiguo, sin huecos entre filas;
- el `#` de alguna fila no es un entero a secas: `1`, `2`… — nunca `S1` ni `**1**` (negrita/backticks/prefijos de letra no se toleran aquí, a propósito);
- alguna fila tiene menos o más celdas que la cabecera (revisa un `|` sin escapar dentro de una celda), o la celda `Slice` está vacía, trae un marcador de "sin valor", o solo trae una referencia `#N` sin ningún nombre alrededor (de ahí sale el título del issue — ver arriba);
- `Dep` tiene contenido que no es reconocible como `#N` (p.ej. `S1` en vez de `#1`) — si de verdad no hay dependencias, escribe `–`;
- una referencia de `Dep` apunta a un `#` que no existe en la tabla, o al propio slice (auto-referencia: un slice nunca depende de sí mismo).

Si fallan varias de estas cosas a la vez, se reportan **todas juntas** en la misma ejecución (no hace falta arreglar una, volver a correr, y descubrir la siguiente). Columnas opcionales ausentes (`Tipo`/`Entrega`/`Acepta`/`Protegido`/`Área`/`Toca`) y valores degradados (`Tipo` que no es ninguna key de `ADDENDA`, prefijo en la columna equivocada de Área/Toca, token que normaliza a vacío) no abortan — se avisan por stderr y el groom continúa.

### Re-ejecutar no converge solo — detecta divergencia, no la aplica (F5)

Hasta esta versión, "idempotente" quería decir *existence-only*: si el marcador `<!-- ct-order:N -->` ya aparecía en algún issue, `/ct-groom` imprimía "ya existe, no se duplica" y pasaba al siguiente — sin mirar si el título, las labels o el milestone de ese issue seguían coincidiendo con lo que la tabla §9 produce hoy. Un autor que arreglaba un label o un título mal puesto en el spec y volvía a correr `/ct-groom` no veía ninguna señal de que nada había cambiado.

Ahora, para cada slice cuyo issue ya existe, `/ct-groom` compara:

- **título** (`#N <Slice>`);
- **el enlace al spec** (la línea `> Slice #N del epic. Spec: […]`) — sí es contenido del spec (deriva de `--section` y de la ruta del propio fichero), a diferencia del marcador `ct-order` (bookkeeping nuestro, fuera de toda comparación). Se compara **solo por su ancla `#sección`, nunca por la ruta**: `ct-groom.mjs` renderiza la ruta tal cual la escribas al invocarlo, y comparar la línea entera haría que dos costumbres de invocación del mismo fichero (relativa desde un slash command, absoluta desde un cron, p.ej.) reportaran divergencia — y con `--reconcile`, cada una "corrigiera" la notación de la otra, indefinidamente. A cambio: si el spec se MUEVE a otro fichero sin cambiar el número de sección, `/ct-groom` ya no lo detecta (límite conocido, ver más abajo);
- **milestone** (`--milestone` del spec contra el milestone actual del issue);
- **labels, pero solo los prefijos cuya columna trae la tabla §9**: `type:` (si hay columna `Tipo`), `area:` (si hay columna `Área`), `touches:` (si hay columna `Toca`). Sin la columna correspondiente, el spec no tiene NINGUNA opinión sobre ese prefijo. `status:` queda **fuera de la comparación por completo, siempre** — un humano o `/ct-next` lo mueven después (`backlog` → `ready` → `in-progress` → `in-review`…) como parte normal del flujo;
- **dependencias** (`## Dependencias`, las líneas `merge-after #N`) y **criterios de aceptación** (`## Acceptance criteria`) — datos que el dispatcher obedece de verdad (`merge-after` gatea si un slice se puede despachar; los AC se inyectan literalmente en el prompt del agente). Comparación por conjunto, **solo dentro de la sección reconocida** (ver "Límites conocidos"): un `merge-after #N` (o un AC) escrito en OTRA parte del body — Descripción, una sección nueva a mano — no cuenta como divergencia real, pero **sí se avisa como nota** (el dispatcher lo obedecería igual, aunque `/ct-groom` no pueda tocarlo con seguridad);
- **Descripción y Protegido** también se comparan, pero solo con un **sí/no**, como **nota, no como divergencia** — no cuentan para el código de salida: son prosa que se edita de forma rutinaria, y anclar el exit code a eso lo dejaría en "hay algo que revisar" para siempre.

Una cabecera conocida se reconoce por **igualdad exacta** (no por prefijo) — salvo `## Acceptance criteria`, que tolera exactamente **dos** formas literales (`## Acceptance criteria` y `## Acceptance criteria (EARS, 1:1 con tests)`, las dos cadenas que `buildIssueBody` ha emitido a lo largo de la historia del proyecto). Es un conjunto CERRADO de dos elementos, no un prefijo abierto: un `## Acceptance criteria propuestos por QA (borrador)` escrito por un humano por encima de la sección real NUNCA se confunde con ella (antes sí, con un prefijo abierto — el dispatcher habría inyectado cero criterios reales). Igual de exacto, un `## Dependencias externas (notas del equipo)` NUNCA se confunde con la sección real de dependencias.

El fin de una sección (dónde termina su contenido) también es preciso: cualquier **cabecera ATX real** (`#` a `######`, indentada hasta 3 espacios, seguida de espacio/tabulador o fin de línea — no solo `## ` literal) la termina, y el interior de un **comentario HTML multilínea** (`<!-- … -->` que abre y cierra en líneas distintas) queda completamente invisible para el escáner mientras esté abierto — una cabecera "comentada" ahí dentro (unas deps viejas pospuestas "mientras se decide", p.ej.) nunca se confunde con la sección real, y el comentario sobrevive intacto (con su `-->` de cierre) si `--reconcile` toca la sección que lo contiene.

Por defecto, `/ct-groom` **detecta y reporta, nunca cambia nada** — cada diferencia real sale por stderr como `divergencia: …`; lo informativo (prosa, secciones duplicadas cosméticas, referencias fuera de sección) sale como `nota: …`. Silencio total significa que spec e issue están de acuerdo en todo lo que el spec puede tener opinión. Un **issue cerrado** no se reporta por eso solo; si además diverge en algo, se añade una nota avisando que está cerrado antes de aplicar nada.

Una sección conocida **duplicada** en el body (copiar-pegar, un merge mal resuelto) se avisa siempre — pero con una distinción importante: duplicar `## Dependencias` o `## Acceptance criteria` **SÍ cuenta para el código de salida** (`divergencia:`), aunque el mecanismo por el que cada una importa es distinto:
- **Dependencias**: el dispatcher lee `merge-after #N` escaneando el body ENTERO, sin ninguna noción de sección — dos copias con contenido distinto se **unen** de verdad; el dispatcher obedece la suma de ambas.
- **Acceptance criteria**: el dispatcher SÍ es section-scoped y siempre lee la **primera** aparición — la segunda copia se descarta en silencio. No hay unión, pero descartar en silencio una edición humana real (que quizás aterrizó en la segunda copia tras un merge mal resuelto) es igual de grave: el agente sigue trabajando con criterios que un humano ya corrigió, sin que nada lo avise.

Duplicar `## Descripción`/`## Out of scope / Protected` sigue siendo solo cosmético (`nota:`, no cuenta) — el dispatcher no lee ninguna de las dos.

**Un issue existente cuyo slice ya NO está en la tabla §9** (se borró la fila, pero nadie cerró/renumeró el issue) se reporta como **huérfano** — antes no se mencionaba en absoluto.

**`--reconcile` es EXPERIMENTAL.** Cinco rondas de review, cada una encontrando una forma nueva de corromper un body real (vallas de código con el carácter/longitud de cierre equivocados, comentarios HTML multilínea, encabezados que no son `## ` literal, secciones duplicadas que no se pueden resolver solas), son evidencia de que la mitad de **detección** de esta feature (todo lo de arriba, sin `--reconcile` — nunca escribe nada, segura por construcción) está mejor entendida que la mitad de **aplicación** (sí escribe en datos reales del usuario). En cuanto el flag está presente — con o sin `--dry-run`, antes de cualquier validación o mutación — `/ct-groom` imprime por stderr un aviso explícito de que es experimental, de que ha corrompido bodies en pruebas de varias formas ya arregladas, y de que conviene revisar el diff del issue en GitHub después de cada corrida. Sin `--reconcile`, nada de esto cambia: cero avisos nuevos, mismo comportamiento de siempre.

**`--reconcile`** (opt-in, nunca por defecto — un issue puede haber sido editado a propósito, llevar discusión, o estar cerrado) aplica:

- **título, milestone y labels** con un único `gh issue edit --title … --milestone … --add-label … --remove-label …`; el **enlace al spec** viaja en la MISMA llamada, dentro de `--body` (splice de una sola línea) — pero **solo si el ancla realmente cambió**; una diferencia de notación de ruta nunca dispara una reescritura;
- **dependencias y criterios de aceptación**, en la MISMA llamada, vía `--body`: se reemplaza (o inserta/retira, si toda la sección `## Dependencias` aparece o desaparece) SOLO el rango exacto de esas dos secciones dentro del body existente — nunca se reconstruye el body entero. Si la cabecera de AC no se encuentra (renombrada o borrada a mano), o si Dependencias necesita crearse pero no hay un ancla segura donde insertarla (típicamente, `## Out of scope / Protected` tampoco se localiza — p.ej. por una valla de código sin cerrar delante), `--reconcile` **no inventa dónde escribir ni añade nada a ciegas** — se rinde limpiamente, avisa con precisión (nunca dice "solo prosa" cuando en realidad es AC/deps sin aplicar) y esa divergencia queda contando para el código de salida. (Antes de esto, la rama sin ancla segura insertaba una sección nueva en cada corrida sin ningún límite — verificado que crecía 2, 3, 4 veces en pasadas sucesivas.)
- **Descripción, Protegido, secciones duplicadas y referencias fuera de sección NUNCA se aplican**, ni siquiera con `--reconcile` — o son prosa de longitud arbitraria (un splice no puede garantizar que no se pierda una elaboración humana legítima), o viven en un sitio del body que `--reconcile` no puede tocar con seguridad.
- **Issues huérfanos NUNCA se tocan** — no hay ningún slice en la tabla §9 con el que reconciliarlos.

Un fallo de `gh` aborta con mensaje claro (misma convención que el resto del fichero: nunca se sigue a ciegas con el resto de slices). Editar un issue cerrado no lo reabre, así que `--reconcile` lo actualiza igual.

Todo esto funciona también bajo **`--dry-run`** (con `--repo`; sin él no hay nada contra qué comparar) — con una salvedad importante: **`--dry-run --repo` ya no es offline**. Antes de F5, `--dry-run` nunca tocaba `gh`; ahora, con `--repo`, hace una lectura real (listar issues del repo) para poder comparar — necesita red y autenticación de `gh` válidas contra ese repo, igual que la corrida real. Sin `--repo`, sigue siendo puro (solo imprime el plan). Bajo `--dry-run --repo` obtienes el mismo reporte que la corrida real, y con `--reconcile` además anuncia qué aplicaría (por categoría — título/milestone/enlace-al-spec/labels/dependencias/AC — sin volcar el `--body` reconstruido entero) — pero nunca muta nada.

**Código de salida**: `0` si no hay divergencia real (o si `--reconcile` la resolvió del todo), `2` si la tabla §9 es inválida (como siempre), y **`3`** si queda algo real sin reconciliar — divergencia de título/milestone/enlace/labels/AC/deps, una sección `## Dependencias`/`## Acceptance criteria` duplicada, un gap de `--reconcile` (AC/deps sin sección localizable, o una sección duplicada que `--reconcile` no puede resolver por sí solo — no hay ningún código que decida cuál copia es la correcta), o un issue huérfano. `3` es deliberadamente distinto de `0` y de `2` — un exit no-cero aquí sería tan malo como el silencio que esto corrige, pero en la dirección opuesta. Descripción/Protegido, sus duplicados, y las referencias fuera de sección **nunca** cuentan para el `3` — son notas informativas.

`--dry-run` y la corrida real sin `--reconcile` dan el **mismo `3`** ante la misma divergencia, por paridad (misma condición, misma señal). Ojo si automatizas esto: con `groom --dry-run && groom`, un `3` en el `--dry-run` **corta la cadena** justo cuando hay algo que `--reconcile` podría aplicar — si quieres "revisa, y si hay algo que arreglar, aplícalo", comprueba el código de salida explícitamente en vez de depender de `&&`.

#### Límites conocidos

- Un `merge-after #N` (o un AC) escrito **fuera** de su sección reconocida se avisa como nota, pero `--reconcile` nunca lo toca — el dominio de detección-que-cuenta-para-el-exit-code y el de aplicación son, deliberadamente, el mismo (solo la sección reconocida): escanear todo el body para APLICAR arriesgaría el tipo de corrupción de contenido humano que este diseño evita en otros puntos.
- El enlace al spec se compara solo por su ancla: si el spec se **mueve a otro fichero** sin cambiar el número de sección, `/ct-groom` no lo detecta.
- Una sección conocida **duplicada**: solo la primera aparición se compara y se reconcilia; la segunda copia sobrevive intacta pero huérfana (se avisa, no se corrige sola — y para AC/Dependencias, cuenta para el exit code, ver arriba).
