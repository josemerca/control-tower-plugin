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
- **labels que el spec posee**: `type:`, `area:`, `touches:`. `status:` queda **fuera de la comparación por completo** — el spec solo decide el valor inicial (`status:backlog`, al crear el issue); un humano o `/ct-next` lo mueven después (`backlog` → `ready` → `in-progress` → `in-review`…) como parte normal del flujo, y reportar esos movimientos como "divergencia" sería ruido que entrena a ignorar el resto del reporte. Una label ajena al spec (sin ninguno de esos tres prefijos) tampoco se reporta nunca;
- **milestone** (`--milestone` del spec contra el milestone actual del issue).

El **cuerpo del issue NO se compara**: es, con diferencia, el campo que más edita un humano después de crear el issue (contexto, discusión, notas de progreso), y carga el propio marcador `<!-- ct-order:N -->` — compararlo entero convertiría cada edición legítima en "divergencia".

Por defecto, `/ct-groom` **detecta y reporta, nunca cambia nada** — cada diferencia sale por stderr nombrando el slice, el issue, el campo, el valor actual y el que pide el spec. Silencio (ninguna línea de "divergencia") significa que spec e issues están de acuerdo. Un **issue cerrado** no se reporta por eso solo (el spec no tiene ni debe tener opinión sobre abierto/cerrado); si además diverge en algún campo, se añade una nota avisando que está cerrado antes de aplicar nada.

**`--reconcile`** (opt-in, nunca por defecto — un issue puede haber sido editado a propósito, llevar discusión, o estar cerrado) aplica lo detectado con un único `gh issue edit` por issue (título + milestone + labels a la vez). Un fallo de `gh` aborta con mensaje claro (misma convención que el resto del fichero: nunca se sigue a ciegas con el resto de slices). Editar un issue cerrado no lo reabre, así que `--reconcile` lo actualiza igual.

Todo esto funciona también bajo **`--dry-run`** (con `--repo`; sin él no hay nada contra qué comparar): el mismo reporte, y con `--reconcile` además anuncia qué aplicaría — pero nunca muta nada.

**Código de salida**: `0` si no hay divergencia (o si `--reconcile` la aplicó con éxito), `2` si la tabla §9 es inválida (como siempre), y **`3`** si queda divergencia sin reconciliar. `3` es deliberadamente distinto de `0` (no sería "silencio real") y de `2` (no es que la tabla esté rota) — un exit no-cero aquí sería tan malo como el silencio que esto corrige, pero en la dirección opuesta: entrenaría a cualquier script que solo mire "¿salió con error?" a tratar una divergencia meramente informativa como si el spec estuviera roto.
