---
description: Groom de un epic — spec §9 → GitHub (Milestone + issues + labels + Project v2 + Sprint)
---
Corre el groom sobre el spec del epic. Primero en seco para revisar el plan:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --dry-run
```
Revisa el JSON. Si está bien, ejecútalo de verdad (añade `--project <n>` para el Project v2):
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --project <n>
```
Es idempotente: re-ejecutarlo no duplica milestone ni issues (marca cada issue con `<!-- ct-order:N -->`). **Pero "no duplica" NO significa "converge"**: idempotencia solo por existencia (F5). Si arreglas un título o un label en la tabla §9 y vuelves a correr, `/ct-groom` no toca el issue ya creado — reporta la diferencia, no la aplica sola. Ver "Re-ejecutar no converge solo" más abajo. (El **milestone** no está en la tabla §9 ni se compara: ver "El alcance de un groom es su epic, no el repo".)

Los issues se crean en `status:backlog`, nunca `status:ready` — es una gate humana deliberada: un humano tiene que promoverlos a `status:ready` (`gh issue edit <n> --repo <owner/repo> --add-label status:ready --remove-label status:backlog`) antes de que `/ct-next` los considere despachables. Si `/ct-next` responde "No hay slices despachables" justo después de un groom, es casi seguro que sea esto. Al terminar, `/ct-groom` recuerda por stderr cuántos issues del epic siguen en `status:backlog` (contando también los que ya existían: el criterio es el estado real, no "acabo de crear algo"); un epic ya promovido entero, o cerrado, no genera ningún recordatorio.

Las **labels** que el plan necesita se crean solo si no existen ya en el repo — antes se llamaba a `gh label create --force` para todas en cada corrida, y `--force` reescribe (color y descripción incluidos) una label existente. `/ct-groom` nombra por stderr las que ha creado **nuevas** y, junto a ellas, las que ha **reutilizado**; si no crea ninguna, no dice nada. Ese aviso es la forma de detectar que un spec ha inventado un sinónimo (`area:hoy` frente a `area:today`) en vez de reutilizar el vocabulario del repo — que es lo único que hace funcionar la detección de colisión. Para ver el vocabulario existente antes de escribir el spec: `gh label list --repo <owner/repo>`.

Las **dependencias** se escriben en el cuerpo del issue como ``- merge-after `#N` ``, entre backticks: `#N` es el **orden del slice en la tabla §9**, no un número de issue, y sin los backticks GitHub lo convierte en un enlace al issue número N del repo — una dependencia falsa que un humano no tiene forma de detectar (verificado contra la API de GitHub: en el sandbox, `merge-after #2` del slice 3 enlazaba al issue #2, que es el del slice 1). La sección lleva además una línea que lo dice explícitamente. Los issues creados **antes** de este cambio conservan el formato viejo (`merge-after #N`, sin backticks) y se siguen leyendo igual — no se migran solos; solo adoptan el formato nuevo si `--reconcile` ya iba a reescribir esa sección por una divergencia real.

El título del issue sale de `Slice` (`#N <Slice>`), NO de `Entrega`: `Slice` es el nombre corto de la fila, `Entrega` es opcional y se convierte en la sección "Descripción" del cuerpo. Ese mismo título es lo que `/ct-next` reinyecta al despachar (primera línea del kickoff del agente, nombre del workspace cmux) — por eso `Slice` debe ser corto y legible, no una frase. `Tipo` decide, además de la label `type:<valor>`, qué **recordatorio técnico** (*addendum*) recibe el agente al despachar (`ui`/`backend`/`infra`/`bugfix`, ver `scripts/kickoff.js#ADDENDA`) — un valor que no sea ninguno de esos no aborta, pero avisa por stderr (el agente despachado para ese slice no recibirá ningún addendum de tipo). Hasta F21, `Tipo` decidía TAMBIÉN los **gates humanos**, porque el único que existía era media frase dentro del addendum de `ui` ("gate de screenshot obligatorio"); eso ya no es así — ver la columna `Gate`, más abajo.

En la columna `Acepta`, **la coma separa criterios siempre**: un criterio EARS ("Cuando caduca el token, el sistema pide login") se partiría en dos. Se escapa con `\,` (solo esa secuencia exacta; una barra invertida suelta se conserva). `Protegido` no se trocea por comas (texto libre de una pieza), `Dep` extrae sus `#N` con una regex (una coma dentro da igual), y en `Área`/`Toca` la coma separa tokens pero un token nunca puede contenerla (se descarta al normalizar, así que ahí `\,` no sirve de nada).

La tabla §9 del spec admite dos columnas opcionales, `Área` y `Toca` (acepta también `Area` sin tilde), con valores separados por coma. "Sin valor" se puede escribir como `–`, `-`, `—`, `−`, `--` o celda vacía (cualquier variante de guion/dash es válida — un editor de texto o un móvil con autocorrección puede sustituir una por otra sin que lo notes; todas significan "ninguno" en `Dep`/`Acepta`/`Área`/`Toca`/`Gate`):
```
| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |
|---|-------|------|---------|-----|--------|-----------|------|------|------|
| 1 | modelo | backend | tabla users | – | AC-1.1 | schema | api | db, migration | – |
| 2 | api | backend | endpoint | #1 | AC-2.1 | – | api | – | – |
```
### `Gate` — los gates humanos, separados del `Tipo` (F21)

`Gate` *(opcional)* declara qué **gates humanos** hay que cerrar antes de mergear ese slice. Vocabulario **cerrado** (`scripts/gates.js`):

- `visual` — un humano tiene que VER el cambio: captura/vídeo del antes/después en el PR;
- `apply` — nada se aplica contra un entorno real hasta que un humano revise el plan/dry-run.

**El caso por defecto no exige escribir nada**: `Tipo: ui` implica `visual`, `Tipo: infra` implica `apply`. La columna existe para las dos desviaciones, y `/ct-groom` **avisa por stderr en las dos**:

- **añadir** un gate que el `Tipo` no implica (`Tipo: backend` + `Gate: visual`) — el caso real que motivó la columna: una migración con backfill que movía la barra de progreso más visible del epic. Recibía el addendum de backend y ningún gate, y nada lo señalaba;
- **renunciar** a uno que sí implica, con `!` delante (`Gate: !visual` sobre un `Tipo: ui` que de verdad no cambia nada visible). Quitar un gate nunca es silencioso.

Celda vacía o con marcador de "sin valor" significa *no he declarado nada*, **no** "renuncio a todo". Un token fuera del vocabulario, o pedir y renunciar al mismo gate en la misma celda, **abortan** (a diferencia de un `Tipo` desconocido, que solo avisa): un gate que no se puede explicar ni al agente ni a quien revisa sería un gate que solo existe en el spec.

A dónde llega cada gate resuelto: label **`gate:<token>`** del issue (o **`gate:none`** si no hay ninguno — el silencio no puede significar a la vez "sin gates" y "issue anterior a los gates"), sección **`## Gates`** del cuerpo, línea explícita en el kickoff del agente, y campo `gates` de su `.agent/SLICE.md` (F22 — antes era `.agent/STATE.md`, que es el de la coordinadora, no el del slice). Por eso sobrevive a un redespacho, a un `--reopen` y a un `/clear`: `/ct-next` lo lee del **issue**, no del spec. Un issue groomeado antes de F21 (sin ninguna label `gate:`) cae al `Tipo`, así que no pierde el gate que ya tenía.

**El loop escribe y enseña los gates; no impide mergear con uno sin cerrar.** El que los cierra eres tú.

`/ct-groom` traduce cada valor en labels `area:<x>`/`touches:<y>` sobre el issue — son las mismas que `claim.js#tokensOf` y `dispatch.js#SERIALIZING_TOUCHES` usan para detectar colisión y forzar serialización. Si un slice no declara `Área`/`Toca` (o el spec ni siquiera trae esas columnas), no se emite ninguna label de ese tipo y la maquinaria de colisión/serialización queda inerte para ese slice, igual que antes.

### `## Contexto del epic` — sección opcional del spec, fuera de la tabla

Además de la tabla, el spec admite una sección opcional **`## Contexto del epic`** (fuera de la tabla, en cualquier punto del fichero — se localiza **por el texto de su cabecera, no por su número de sección**, mismo criterio con el que la tabla §9 se localiza por sus columnas `Slice`+`Dep`: los números de sección de un spec se mueven en cuanto alguien inserta algo por delante). Su contenido se copia **idéntico al cuerpo de todos los issues del epic**, y `--reconcile` lo mantiene al día si el spec cambia (ver "Re-ejecutar no converge solo", más abajo).

**No puede contener nada que la corte antes de tiempo**: ni subcabeceras de nivel 3 o más (`###`, `####`…) ni un comentario HTML autocontenido (uno que abre y cierra `<!-- … -->` en la misma línea — el mismo criterio de "fin de sección" que ya rige el resto de secciones del cuerpo del issue, ver "El fin de una sección…" más abajo). Esas dos cosas, si aparecen dentro, sí truncan: `/ct-groom` avisa nombrando la línea que corta y **no emite la sección en ningún issue** — mismo trato (avisar y no emitir) que un spec sin la sección o con ella vacía; los tres casos avisan por separado, porque cada uno se arregla de forma distinta. Una cabecera de **nivel 1 o 2** detrás del texto, en cambio, **no** es un problema: es el final normal de la sección (el mismo con el que termina cualquier otra sección del spec) y pasa **en silencio** — sin aviso, con el contexto emitiéndose con normalidad hasta ahí. Usa negritas o listas dentro, nunca cabeceras.

Cada issue recibe además, siempre, una sección **`## Contexto heredado`** vacía (con un placeholder que dice quién la rellena y que nadie se la va a pisar). Ésa la escribe la sesión coordinadora, cuando algo ya mergeado condiciona a ese slice concreto — y `/ct-groom` **no la toca nunca**: ni la compara, ni la reescribe, ni la inserta, ni la borra. Es el sitio para contexto propio de UN slice; `## Contexto del epic`, en cambio, es el mismo texto en todos los issues del epic.

### La tabla se valida entera antes de tocar GitHub

`/ct-groom` (también bajo `--dry-run`: un dry-run que valida menos que la corrida real es una trampa) revisa la tabla §9 completa y **aborta con exit distinto de 0**, sin crear nada, si:

- no encuentra ninguna tabla §9, o encuentra tabla(s) pero ninguna cabecera con columnas `Slice` y `Dep`;
- falta la columna de cabecera `#`;
- hay una interrupción (línea en blanco, o cualquier línea sin `|`) a mitad del bloque de la tabla — debe ser un único bloque markdown contiguo, sin huecos entre filas;
- el `#` de alguna fila no es un entero a secas: `1`, `2`… — nunca `S1` ni `**1**` (negrita/backticks/prefijos de letra no se toleran aquí, a propósito);
- alguna fila tiene menos o más celdas que la cabecera (revisa un `|` sin escapar dentro de una celda), o la celda `Slice` está vacía, trae un marcador de "sin valor", o solo trae una referencia `#N` sin ningún nombre alrededor (de ahí sale el título del issue — ver arriba);
- `Dep` tiene contenido que no es reconocible como `#N` (p.ej. `S1` en vez de `#1`) — si de verdad no hay dependencias, escribe `–`;
- una referencia de `Dep` apunta a un `#` que no existe en la tabla, o al propio slice (auto-referencia: un slice nunca depende de sí mismo).
- un valor de `Gate` no es ningún gate conocido (el mensaje nombra el vocabulario entero y la sintaxis `!` de renuncia);
- una fila pide y renuncia al MISMO gate (`visual, !visual`) — no se elige un ganador en silencio sobre un gate humano.

Si fallan varias de estas cosas a la vez, se reportan **todas juntas** en la misma ejecución (no hace falta arreglar una, volver a correr, y descubrir la siguiente). Columnas opcionales ausentes (`Tipo`/`Entrega`/`Acepta`/`Protegido`/`Área`/`Toca`) y valores degradados (`Tipo` que no es ninguna key de `ADDENDA`, prefijo en la columna equivocada de Área/Toca, token que normaliza a vacío) no abortan — se avisan por stderr y el groom continúa. `Gate` ausente **no avisa siquiera**: su ausencia no degrada nada (los gates se derivan del `Tipo`, como siempre), y un aviso que sale en cada corrida de cada spec sin describir ninguna pérdida es ruido que entrena a ignorar los demás.

### Qué ha tocado `/ct-groom` cuando aborta (F15)

Esto se documenta porque la deducción natural —"si aborta a mitad, me habrá dejado el repo a medias"— asusta, y lleva a limpiar a mano cosas que no hay que limpiar. Lo que se puede afirmar, y lo que no:

- **Todo lo que `/ct-groom` LEE va por delante de todo lo que ESCRIBE.** Validación de argumentos, tabla §9, resolución y verificación del enlace al spec, enumeración de issues, de labels, de milestones y —con `--project`— la introspección del Project v2 (que exige un campo de iteración llamado exactamente `Sprint` y una iteración que cubra hoy). **Si aborta en cualquiera de esos pasos, no ha creado nada**: ni milestone, ni labels, ni issues.
  Hasta F15 esto **no** era cierto para `--project`: `ensureProjectMeta()` era perezosa y el primer punto que la forzaba estaba *después* del milestone y de las labels, así que "el project no tiene campo Sprint" abortaba con el milestone y las labels ya creadas. Verificado por construcción contra el código sin arreglar, con un stub de `gh` que registra cada invocación: el log salía `milestones -f title=Epic`, cuatro `label create`, y solo entonces `project view`. El bloque de project se adelantó entero por delante de la primera mutación.
- **Lo que NO se promete: no hay transacción.** Superada la validación, el orden de escritura es milestone → labels → issues → alta en el Project v2 con su Sprint. Un fallo *ahí* (red, rate limit, auth caída, un Ctrl-C) deja creado lo anterior. No hay rollback, y no se finge que lo haya.
- **De un abort a mitad se sale volviendo a correr, no limpiando a mano.** El milestone se reutiliza por título (se listan todos los estados, para no duplicar uno cerrado); de las labels solo se crean las que faltan, y las que ya existían **no** se tocan (ni color ni descripción); los issues se reconocen por su marcador `<!-- ct-order:N -->` y no se duplican; y un issue que quedó creado pero fuera del Project (interrupción entre las dos llamadas) se detecta con `hasProjectItem` y se añade en la corrida siguiente.
- **La lista de items del Project se lee ENTERA, o se dice que no (F18).** `gh project item-list` es una lectura acotada (`--limit`), y `hasProjectItem` la usa para decidir que un item **no existe**: con el tope alcanzado, un issue que ya estaba en el Project se volvía a añadir — **duplicados, en silencio**. Ahora se compara `items.length` contra el `totalCount` que el propio `gh` devuelve; si el tope recortó, se repite la consulta pidiendo exactamente ese total, y si aun así viene corta se **aborta** en vez de duplicar. Con una versión de `gh` que no exponga `totalCount`, se avisa de que el truncado no se ha podido descartar — nunca se da por completa en silencio. Lo mismo con la introspección de campos del Project (`fields(first: 50)`): si no se han visto todos, el mensaje ya no afirma «este project no tiene un campo Sprint», dice que no se ha podido comprobar.
- **Sin `--reconcile`, un issue que ya existe no se edita nunca.** Las divergencias se reportan por stderr y se sale `3` — no se escribe nada.
- **`--dry-run` no muta nada, nunca** — ni siquiera crea el milestone. Sí hace lecturas (incluidas las dos de la verificación del enlace al spec).

### El alcance de un groom es su epic, no el repo

`/ct-groom` numera los slices `1..N` **por epic** (una invocación = un `--milestone` = un epic) y escribe ese número en `<!-- ct-order:N -->`. El contrato §9 lo dice: *«los `#` de esta tabla son únicos dentro de su milestone, no del repo»*. Desde F23 eso es cierto también aquí — hasta entonces lo era sólo en `/ct-next`, y una tabla §9 nueva empezando en `1,2,3` emparejaba con los issues de un epic anterior y cerrado.

En la práctica: **puedes empezar la tabla §9 de cada spec en `1`**. Dos epics del mismo repo no se pisan.

Un groom sólo mira los issues cuyo milestone es el que le has pasado. Los de otros epics no se emparejan, no se reportan como divergencia y no se declaran huérfanos. «Issue huérfano» pasa a significar lo que dice: un issue **de este epic** cuyo orden ya no está en la tabla §9.

**Consecuencia directa: el milestone ya no puede aparecer como divergencia.** Un issue emparejado tiene siempre, por construcción, el milestone que le has pedido — es la condición para haber entrado en el emparejado. Si cambias el milestone de un issue en GitHub y vuelves a correr, `/ct-groom` **no** te lo reporta: según a dónde lo hayas movido, o lo ignora por ser de otro epic, o se para en seco con **exit 1** (las dos situaciones de abajo), o crea un issue nuevo para ese slice — avisando por stderr de que puede estar duplicándolo. La comparación de milestone sigue existiendo en `scripts/reconcile.js` (módulo puro, usable por otros callers), pero desde `/ct-groom` es inalcanzable.

### Las dos situaciones en las que `/ct-groom` se para en seco

Ambas caen **antes de tocar nada** (antes incluso de crear el milestone), también bajo `--dry-run`, y salen con **exit 1** diciendo `no se ha creado ni modificado nada`. Si coinciden las dos, se reportan las dos y se sale una sola vez.

**1. Un issue sin milestone cuyo `ct-order` colisiona con tu tabla §9.** No hay forma de saber si es de este epic (alguien le quitó el milestone, o se borró el milestone en GitHub) o de otro, y las dos lecturas posibles hacen daño: emparejarlo reescribiría un issue ajeno, ignorarlo crearía un duplicado. Asígnale su milestone y vuelve a correr.

> Un issue sin milestone cuyo `ct-order` **no** colisiona con tu tabla sólo produce un aviso. No bloquea, pero tampoco se calla.

**2. Un slice tuyo que ya tiene issue en otro milestone, apuntando al mismo spec.** Es la firma de un epic renombrado en GitHub, o de una errata en `--milestone`. Sin esta puerta, esa corrida vería cero issues en su epic y recrearía el epic entero duplicado, con exit 0. Si renombraste el epic, usa su título real; si es un epic nuevo de verdad, su tabla §9 no debería apuntar al spec del anterior.

> Un issue de otro milestone que apunta a **otro** spec (o que no lleva enlace al spec con el que compararlo) **no para la corrida**: eso son, normalmente, dos epics legítimos compartiendo números de orden, que es justo lo que este alcance permite. Pero tampoco se descarta en silencio — sale un **aviso** por stderr que lo nombra con su milestone real, porque ése es exactamente el cubo del que saldría un epic duplicado si el enlace no casara sólo porque el issue es viejo (groomeado antes de F10) o porque su enlace quedó degradado a `— sin enlace: <motivo>`. El aviso sale sólo cuando **ese slice todavía no tiene issue en tu epic**, que es la única situación en la que se va a crear uno y, por tanto, en la que puede haber duplicado: si ya lo tiene, no hay nada que duplicar y no hay nada que avisar. No cambia el código de salida, y en una corrida que se para en seco por una de las dos puertas no se emite (ahí no se crea nada).

### Re-ejecutar no converge solo — detecta divergencia, no la aplica (F5)

Hasta esta versión, "idempotente" quería decir *existence-only*: si el marcador `<!-- ct-order:N -->` ya aparecía en algún issue, `/ct-groom` imprimía "ya existe, no se duplica" y pasaba al siguiente — sin mirar si el título o las labels de ese issue seguían coincidiendo con lo que la tabla §9 produce hoy. Un autor que arreglaba un label o un título mal puesto en el spec y volvía a correr `/ct-groom` no veía ninguna señal de que nada había cambiado.

Ahora, para cada slice cuyo issue ya existe, `/ct-groom` compara:

- **título** (`#N <Slice>`);
- **el enlace al spec** (la línea `> Slice #N del epic. Spec: […]`) — sí es contenido del spec, a diferencia del marcador `ct-order` (bookkeeping nuestro, fuera de toda comparación). Se compara **entero**. Antes se comparaba solo por su ancla, porque la línea se componía con la ruta tal cual la escribieras al invocar el comando y dos costumbres de invocación del mismo fichero se habrían "corregido" mutuamente para siempre bajo `--reconcile`; esa causa ya no existe (ver "El enlace al spec" más abajo), y comparar la línea entera detecta además que el spec se ha movido de fichero o apunta a otro repo. Consecuencia inmediata al actualizar: los issues creados con la versión anterior llevan un enlace relativo roto, así que **saldrán reportados como divergencia** — es correcto, ese enlace nunca funcionó;
- **el milestone NO**, desde F23: un issue emparejado tiene siempre el milestone de la corrida (ver "El alcance de un groom es su epic, no el repo"), así que esa divergencia es inalcanzable desde aquí y nunca vas a verla reportada;
- **labels, pero solo los prefijos cuya columna trae la tabla §9**: `type:` (si hay columna `Tipo`), `area:` (si hay columna `Área`), `touches:` (si hay columna `Toca`), `gate:` (si hay columna `Gate` **o** columna `Tipo` — los gates pueden venir de cualquiera de las dos). Sin la columna correspondiente, el spec no tiene NINGUNA opinión sobre ese prefijo. `status:` queda **fuera de la comparación por completo, siempre** — un humano o `/ct-next` lo mueven después (`backlog` → `ready` → `in-progress` → `in-review`…) como parte normal del flujo;
- **dependencias** (`## Dependencias`, las líneas `merge-after #N`) y **criterios de aceptación** (`## Acceptance criteria`) — datos que el dispatcher obedece de verdad (`merge-after` gatea si un slice se puede despachar; los AC se inyectan literalmente en el prompt del agente). Comparación por conjunto, **solo dentro de la sección reconocida** (ver "Límites conocidos"): un `merge-after #N` (o un AC) escrito en OTRA parte del body — Descripción, una sección nueva a mano — no cuenta como divergencia real, pero **sí se avisa como nota** (desde el hardening del dispatch, `/ct-next` tampoco lo obedece — antes de eso el dispatcher SÍ lo hacía aunque `/ct-groom` no pudiera tocarlo con seguridad; ver "Límites conocidos");
- **Descripción y Protegido** también se comparan, pero solo con un **sí/no**, como **nota, no como divergencia** — no cuentan para el código de salida: son prosa que se edita de forma rutinaria, y anclar el exit code a eso lo dejaría en "hay algo que revisar" para siempre;
- **`## Contexto del epic`** se compara y **se reescribe** desde el spec. Se reporta como `nota:` y **nunca** cuenta para el `3` — mismo trato que Descripción/Protegido, aunque a diferencia de ellas sí se reescribe (ver "`--reconcile` aplica", más abajo: la distinción no es de quién es el texto, sino el derecho de un humano a editarlo tras crear el issue). `## Contexto heredado` queda fuera de la comparación **por completo, siempre**: no lo posee el spec, y el plugin no tiene ninguna opinión sobre su contenido.

Una cabecera conocida se reconoce por **igualdad exacta** (no por prefijo) — salvo `## Acceptance criteria`, que tolera exactamente **dos** formas literales (`## Acceptance criteria` y `## Acceptance criteria (EARS, 1:1 con tests)`, las dos cadenas que `buildIssueBody` ha emitido a lo largo de la historia del proyecto). Es un conjunto CERRADO de dos elementos, no un prefijo abierto: un `## Acceptance criteria propuestos por QA (borrador)` escrito por un humano por encima de la sección real NUNCA se confunde con ella (antes sí, con un prefijo abierto — el dispatcher habría inyectado cero criterios reales). Igual de exacto, un `## Dependencias externas (notas del equipo)` NUNCA se confunde con la sección real de dependencias.

El fin de una sección (dónde termina su contenido) también es preciso: cualquier **cabecera ATX real** (`#` a `######`, indentada hasta 3 espacios, seguida de espacio/tabulador o fin de línea — no solo `## ` literal) la termina, y el interior de un **comentario HTML multilínea** (`<!-- … -->` que abre y cierra en líneas distintas) queda completamente invisible para el escáner mientras esté abierto — una cabecera "comentada" ahí dentro (unas deps viejas pospuestas "mientras se decide", p.ej.) nunca se confunde con la sección real, y el comentario sobrevive intacto (con su `-->` de cierre) si `--reconcile` toca la sección que lo contiene.

Por defecto, `/ct-groom` **detecta y reporta, nunca cambia nada** — cada diferencia real sale por stderr como `divergencia: …`; lo informativo (prosa, secciones duplicadas cosméticas, referencias fuera de sección) sale como `nota: …`. Silencio total significa que spec e issue están de acuerdo en todo lo que el spec puede tener opinión. Un **issue cerrado** no se reporta por eso solo; si además diverge en algo, se añade una nota avisando que está cerrado antes de aplicar nada.

Una sección conocida **duplicada** en el body (copiar-pegar, un merge mal resuelto) se avisa siempre — pero con una distinción importante: duplicar `## Dependencias` o `## Acceptance criteria` **SÍ cuenta para el código de salida** (`divergencia:`), aunque el mecanismo por el que cada una importa es distinto:
- **Dependencias** y **Acceptance criteria** se comportan igual desde el hardening del dispatch: el dispatcher es section-scoped en las dos y siempre lee la **primera** aparición — la segunda copia se descarta en silencio. No hay unión, pero descartar en silencio una edición humana real (que quizás aterrizó en la segunda copia tras un merge mal resuelto) es igual de grave: el agente sigue trabajando con criterios/deps que un humano ya corrigió, sin que nada lo avise. (Antes del hardening del dispatch, Dependencias era distinta: el dispatcher leía `merge-after #N` escaneando el body ENTERO, sin noción de sección, y dos copias con contenido distinto se unían de verdad — esa asimetría con AC ya no existe.)

Duplicar `## Descripción`/`## Out of scope / Protected` sigue siendo solo cosmético (`nota:`, no cuenta) — el dispatcher no lee ninguna de las dos.

**Un issue existente cuyo slice ya NO está en la tabla §9** (se borró la fila, pero nadie cerró/renumeró el issue) se reporta como **huérfano** — antes no se mencionaba en absoluto.

**`--reconcile` es EXPERIMENTAL.** Cinco rondas de review, cada una encontrando una forma nueva de corromper un body real (vallas de código con el carácter/longitud de cierre equivocados, comentarios HTML multilínea, encabezados que no son `## ` literal, secciones duplicadas que no se pueden resolver solas), son evidencia de que la mitad de **detección** de esta feature (todo lo de arriba, sin `--reconcile` — nunca escribe nada, segura por construcción) está mejor entendida que la mitad de **aplicación** (sí escribe en datos reales del usuario). En cuanto el flag está presente — con o sin `--dry-run`, antes de cualquier validación o mutación — `/ct-groom` imprime por stderr un aviso explícito de que es experimental, de que ha corrompido bodies en pruebas de varias formas ya arregladas, y de que conviene revisar el diff del issue en GitHub después de cada corrida. Sin `--reconcile`, nada de esto cambia: cero avisos nuevos, mismo comportamiento de siempre.

**`--reconcile`** (opt-in, nunca por defecto — un issue puede haber sido editado a propósito, llevar discusión, o estar cerrado) aplica:

- **título y labels** con un único `gh issue edit --title … --add-label … --remove-label …`; el **enlace al spec** viaja en la MISMA llamada, dentro de `--body` (splice de una sola línea), siempre que la línea difiera en algo. (`--milestone` ya no se emite nunca desde `/ct-groom`: la divergencia que lo activaba es inalcanzable desde F23 — ver arriba.);
- **dependencias y criterios de aceptación**, en la MISMA llamada, vía `--body`: se reemplaza (o inserta/retira, si toda la sección `## Dependencias` aparece o desaparece) SOLO el rango exacto de esas dos secciones dentro del body existente — nunca se reconstruye el body entero. Si la cabecera de AC no se encuentra (renombrada o borrada a mano), o si Dependencias necesita crearse pero no hay un ancla segura donde insertarla (típicamente, `## Out of scope / Protected` tampoco se localiza — p.ej. por una valla de código sin cerrar delante), `--reconcile` **no inventa dónde escribir ni añade nada a ciegas** — se rinde limpiamente, avisa con precisión (nunca dice "solo prosa" cuando en realidad es AC/deps sin aplicar) y esa divergencia queda contando para el código de salida. (Antes de esto, la rama sin ancla segura insertaba una sección nueva en cada corrida sin ningún límite — verificado que crecía 2, 3, 4 veces en pasadas sucesivas.)
- **`## Contexto del epic`**, también vía `--body` (splice quirúrgico de sección, igual que AC/Dependencias): si el spec trae texto y la sección no existe todavía en el issue (uno de antes de esta ronda), se inserta entera justo antes de `## Acceptance criteria` — solo si esa cabecera se localiza; sin ese ancla, no se inventa una posición y la divergencia no se aplica. Si el spec deja de traer la sección, se retira entera. "De quién es el texto" no es lo que distingue esta sección de Descripción/Protegido (las tres las posee el spec) — lo que la distingue es que editarla a mano en un issue suelto es exactamente la divergencia que mantenerla al día existe para eliminar.
- **Descripción, Protegido, el contexto heredado, secciones duplicadas y referencias fuera de sección NUNCA se aplican**, ni siquiera con `--reconcile` — Descripción/Protegido son prosa de longitud arbitraria que un humano edita legítimamente en su issue (un splice no puede garantizar que no se pierda esa elaboración), el contexto heredado no es texto que el spec posea en absoluto, y las duplicadas/fuera-de-sección viven en un sitio del body que `--reconcile` no puede tocar con seguridad.
- **Issues huérfanos NUNCA se tocan** — no hay ningún slice en la tabla §9 con el que reconciliarlos.

Un fallo de `gh` aborta con mensaje claro (misma convención que el resto del fichero: nunca se sigue a ciegas con el resto de slices). Editar un issue cerrado no lo reabre, así que `--reconcile` lo actualiza igual.

Todo esto funciona también bajo **`--dry-run`** (con `--repo`; sin él no hay nada contra qué comparar) — con una salvedad importante: **`--dry-run --repo` ya no es offline**. Antes de F5, `--dry-run` nunca tocaba `gh`; ahora, con `--repo`, hace una lectura real (listar issues del repo) para poder comparar — necesita red y autenticación de `gh` válidas contra ese repo, igual que la corrida real. Sin `--repo`, sigue siendo puro (solo imprime el plan). Bajo `--dry-run --repo` obtienes el mismo reporte que la corrida real, y con `--reconcile` además anuncia qué aplicaría (por categoría — título/enlace-al-spec/labels/dependencias/AC — sin volcar el `--body` reconstruido entero) — pero nunca muta nada.

**Código de salida**: `0` si no hay divergencia real (o si `--reconcile` la resolvió del todo), **`1`** si la corrida se ha detenido en seco —las dos puertas de "El alcance de un groom es su epic" (que caen antes de cualquier mutación y lo dicen: `no se ha creado ni modificado nada`), un fallo de lectura de `gh`, un fallo de escritura a mitad, o algo de `--project` que no se ha podido dar por bueno: una precondición sin cumplir (el project no tiene un campo de iteración `Sprint`, o ninguna iteración cubre hoy) o una de sus lecturas acotadas que no se ha podido descartar incompleta (los campos del project, su lista de items)—, `2` si la tabla §9 es inválida (como siempre), y **`3`** si queda algo real sin reconciliar — divergencia de título/enlace/labels/AC/deps, una sección `## Dependencias`/`## Acceptance criteria` duplicada, un gap de `--reconcile` (AC/deps sin sección localizable, o una sección duplicada que `--reconcile` no puede resolver por sí solo — no hay ningún código que decida cuál copia es la correcta), o un issue huérfano. `3` es deliberadamente distinto de `0` y de `2` — un exit no-cero aquí sería tan malo como el silencio que esto corrige, pero en la dirección opuesta. Descripción/Protegido, sus duplicados, y las referencias fuera de sección **nunca** cuentan para el `3` — son notas informativas.

`--dry-run` y la corrida real sin `--reconcile` dan el **mismo `3`** ante la misma divergencia, por paridad (misma condición, misma señal). Ojo si automatizas esto: con `groom --dry-run && groom`, un `3` en el `--dry-run` **corta la cadena** justo cuando hay algo que `--reconcile` podría aplicar — si quieres "revisa, y si hay algo que arreglar, aplícalo", comprueba el código de salida explícitamente en vez de depender de `&&`.

### El enlace al spec

La primera línea del cuerpo de cada issue es su única trazabilidad hacia la sección que lo originó:

```
> Slice `#1` del epic. Spec: [docs/specs/plan-design.md § 9. Slices](https://github.com/owner/repo/blob/main/docs/specs/plan-design.md#9-slices)
```

Hasta la versión anterior esa línea era `[docs/specs/plan-design.md#9](docs/specs/plan-design.md#9)`, y estaba rota por partida doble (comprobado contra GitHub, no deducido):

- **la ruta relativa no resuelve desde un issue.** GitHub devuelve el href tal cual; en `github.com/owner/repo/issues/N` eso resuelve contra esa URL y da 404. En un fichero del repo funcionaría; en un issue, que es donde vive la línea, no.
- **el ancla no existía.** Se emitía el número de sección (`#9`), pero el ancla que GitHub genera para `## 9. Slices` es `#9-slices`. Aunque el enlace hubiera resuelto, habría caído al principio del documento.

Ahora:

- **la URL es absoluta y apunta a la rama por defecto del repo donde vive el spec** (no a un sha). El spec es un documento vivo y `/ct-groom` lo trata como tal — la detección de divergencia compara cada issue contra la §9 de HOY; un permalink a un sha congelaría el enlace en una versión que puede haber dejado de ser la que la herramienta compara. Tampoco se usa la rama desde la que invocas: eso no es una propiedad del repositorio sino de quién invoca (y una rama de feature se borra al mergear).
- **el ancla sale del texto del encabezado real** bajo el que vive la tabla, con las mismas reglas con las que GitHub genera anclas (minúsculas, espacios a guiones, puntuación fuera, sufijo `-1`/`-2` cuando el mismo texto se repite en el documento). El encabezado no tiene por qué llamarse "9" ni ser el noveno: la tabla se localiza, como siempre, por su cabecera de columnas.
- **se verifica antes de escribirlo.** `/ct-groom` pide a GitHub el fichero renderizado en esa rama y comprueba que el ancla esté de verdad en él. Un enlace absoluto a algo no publicado es el mismo defecto con otra cara.

Cuando la verificación no pasa, **no se escribe un enlace a medias**: la línea queda como referencia de texto, con el motivo dentro, y se avisa por stderr:

```
> Slice `#1` del epic. Spec: `docs/specs/plan-design.md` § `9. Slices` — sin enlace: el spec no está publicado en la rama por defecto del repositorio (owner/repo, rama main)
```

Los motivos posibles: el spec no está en un repo git, queda fuera del árbol del repo, el repo no tiene remoto `origin`, el remoto no es una URL reconocible, no se pudo resolver la rama por defecto, o **el spec todavía no está empujado** (con diferencia el más común: lo escribes, groomeas, y empujas después). Caso intermedio: si el fichero sí está publicado pero el ancla no aparece en la copia publicada (spec editado en local y sin empujar), se enlaza el **fichero** —que sí funciona— sin fragmento, y se avisa.

**Groomea después de empujar el spec.** La idempotencia es solo por existencia: si una corrida real crea los issues con la referencia degradada, la siguiente corrida reporta la divergencia pero no la aplica sin `--reconcile` (EXPERIMENTAL). Un `--dry-run` antes de la corrida real enseña exactamente la misma línea y los mismos avisos.

#### `--section` está obsoleto

`--section N` se acepta todavía (no rompe ninguna invocación existente) pero **se ignora, y se avisa de que se ignora**. Nunca decidió qué se groomeaba —la tabla siempre se ha localizado por su cabecera de columnas `Slice` + `Dep`—; lo único que hacía era componer el ancla `#N` del enlace, que es justo el ancla que no existe. Quítalo de tus invocaciones.

#### Límites conocidos

- Un `merge-after #N` (o un AC) escrito **fuera** de su sección reconocida se avisa como nota, pero `--reconcile` nunca lo toca — el dominio de detección-que-cuenta-para-el-exit-code y el de aplicación son, deliberadamente, el mismo (solo la sección reconocida): escanear todo el body para APLICAR arriesgaría el tipo de corrupción de contenido humano que este diseño evita en otros puntos.
- El enlace apunta a la rama por defecto: si el fichero del spec se **mueve o se renombra** después, el enlace de los issues ya creados muere. `/ct-groom` sí lo **detecta** en la siguiente corrida (compara la línea entera), pero no lo corrige sin `--reconcile`.
- La verificación del enlace añade **dos lecturas** a `gh` (`repo view` y `api …/contents`) en cada corrida, incluidas las de `--dry-run` sin `--repo` — que por eso ya no son 100% offline. Si `gh` no puede responder, el enlace degrada con aviso en vez de abortar el groom.
- Una sección conocida **duplicada**: solo la primera aparición se compara y se reconcilia; la segunda copia sobrevive intacta pero huérfana (se avisa, no se corrige sola — y para AC/Dependencias, cuenta para el exit code, ver arriba).
