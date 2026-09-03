---
description: Cosecha del epic — el coste real de cada slice, sacado del timeline de GitHub. Cero campos manuales. Sólo lee de GitHub; con --bq carga la cosecha en BigQuery.
---
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --repo "<owner/repo>" --milestone "<título del epic>" [--json] [--bq <proyecto:dataset.tabla>]
```

Responde: **¿cuánto costó cada slice de este epic, según lo que GitHub ya escribió solo?** Una fila por slice con `ready→claim`, `claim→release`, `release→merge`, reopens, requeues, episodios `blocked` y tamaño del PR.

**Se cosecha, no se captura.** Cero campos manuales, ni uno. Todo sale del timeline que GitHub escribe cada vez que el loop mueve una label. El único dato a mano de la medida —los **minutos de intervención humana**— vive en el desenlace del epic y este comando **no lo pide a propósito**: en cuanto un cosechador admite un campo manual se convierte en un formulario, y un formulario es exactamente cómo murió `docs/medicion-slices.md` (2 filas, la columna clave en «no medido»).

**Se escribió después del primer despacho real, no antes.** Las decisiones de `scripts/harvest.js` salen de haber cosechado a mano el epic `#602` de menoplus (2026-08-12/13). Ninguna se dedujo en el vacío, y las dos que más importan salieron de datos que un fixture inventado no habría tenido.

**No muta nada.** Ni labels, ni issues, ni PRs. Igual que `/ct-status`.

## Las tres decisiones que gobiernan la cosecha

**1 · La escalera se deriva sólo de los `labeled`.** El par (`unlabeled` del estado viejo, `labeled` del nuevo) llega **empatado al segundo**, y el orden entre ambos **no es estable entre issues**: en el `#659` el `labeled status:ready` precede a su `unlabeled status:backlog`; en el `#660`, minutos después y por la misma API, el orden es el contrario. Leer los `unlabeled` para decidir «de qué estado salgo» inyecta ruido puro en la variable dependiente.

La excepción —que no es excepción— es `status:blocked`: la escalera es una **máquina de estados**, donde cada `labeled` marca la entrada a un peldaño y el `unlabeled` sobra; `blocked` es un **intervalo**, y el final de un intervalo sólo lo marca la retirada del label.

**2 · Una fase que no ocurrió vale `null`, jamás `0`.** Un slice que nunca llegó a `in-review` no tardó cero segundos en llegar: **no llegó**. Con la N pequeña que esta medida va a tener siempre, un cero inventado mueve la media más que el dato real al que sustituye. En la tabla se imprime `—`.

**3 · Quién cerró el issue lo dice GitHub, no una heurística.** La primera versión deducía el PR escaneando los `cross-referenced` y quedándose con el último mergeado. Contra el epic real ató el `#659` al PR `#665` y el `#660` al `#666`, cuando los buenos eran el `#663` y el `#665` — porque cada PR de un slice cita al anterior, así que el issue viejo acumula referencias de PRs **posteriores** y «el último mergeado» premia justo a los equivocados. **La tabla salía verde y mentía.** Hoy se lee `closedByPullRequestsReferences`, que es el campo que GitHub publica para esto.

## Se reporta por familia, nunca agregado

Regla de honestidad del §6 del pre-registro, heredada de la lección del FDR 0,08–0,31 de POSTCONDBENCH: el resumen se agrupa por `Tipo` y **cada familia enseña su N**. Por debajo de N=3 la línea lo dice en voz alta (`← N insuficiente: describe, no promedia`) en vez de imprimir una media que se leerá como si significara algo.

Por el mismo motivo `type` y `gate` viajan **dentro de cada fila**, también en `--json`: si la familia no viaja con el dato, el agregado deshonesto es el camino de menor resistencia para quien lea la cosecha.

## La telemetría del juez, por slice

Además del coste, la cosecha lee lo que la propia slice dejó commiteado en `docs/superpowers/metrics/issue-<n>.jsonl` y saca, **por slice**, cuántos ítems de la rúbrica volvieron **`sin-vara`** (el juez tenía sujeto que mirar y no tenía con qué medirlo), **cuántos hallazgos hubo por regla** y las dos mitades de la columna **`vara ct`**: cuántos de sus documentos llegaron a citarse en el recorrido de la rúbrica, y cuántos hallazgos los citan. Hasta ahora la primera de estas columnas viajaba en la pull request y **no la leía nadie**: el número existía en disco y había que abrir los `jsonl` a mano.

**Las dos mitades de `vara ct` se leen juntas, y en ese orden.** `5 docs · 0 hallazgos` slice tras slice es el caso a vigilar: o el código conformaba de verdad, o la vara se está nombrando de adorno — y con una sola cifra esas dos lecturas son el mismo número. No son dos columnas que tengan que sumar lo mismo: miden el insumo (llegó y se usó) y el efecto (cazó algo).

Sustituyen a `patrones-ct`, que contaba sólo hallazgos del ítem `patrones` con el argumento de que es el único que mide contra las varas. El run del slice #7 de `rust-monitoring` lo refutó midiendo: la vara de ct salió citada dos veces bajo `decisiones-cerradas`, y la regla de mutación de `conventions/testing.md` se contestó bajo `test-desiderata`. Un hallazgo que la vara produjo y que se archivó en otro ítem era invisible, así que la columna medía **dónde se archivó** el hallazgo y no **qué lo produjo**.

La cita se detecta de **dos** formas. Por la FORMA de la ruta (`conventions/<algo>.md`, sin barra ni letra delante), que no depende de los nombres de hoy: un documento renombrado o uno nuevo también cuenta — así se contó `defects.md` el día que se partió `code.md`, sin tocar nada de esto. Y por el NOMBRE a secas (`style.md`), contra `PluginYardstick.FILES`, porque un nombre sin prefijo no tiene forma que lo delate y la única lista buena es la que define qué documentos viajan.

La segunda entró midiendo: en el slice #8 de `rust-monitoring` el juez de la tarea 5 discutió los cinco documentos por su nombre a secas y la columna contó **cero**. Medía la forma de la cita y no el uso.

En las dos formas, el `docs/conventions/style.md` de la vara del REPO —que contiene las dos subcadenas— nunca cuenta como ct: ni `conventions/` ni el nombre pueden venir precedidos de una barra.

La misma telemetría trae además, por cada intento del paso `implement`, si la vara de ct **llegó** al brief de la tarea y **cuánto pesó**: cuántas cabeceras `## Vara de ct: conventions/` trae el brief que quedó en disco (`brief_vara_ct_docs`) y su tamaño en bytes (`brief_bytes`). Es lo que cierra una desviación silenciosa: hoy el plugin aborta si los documentos faltan del PLUGIN, pero nada comprobaba que el brief se los hubiera LLEVADO — si `escribirBrief` se rompe, todo sigue en verde y el juez mide en silencio sólo contra la vara del repo. La columna `brief` de la tabla suma los dos números de todos los intentos de `implement` que el slice dejó escritos (`N docs · M B`).

Se lee de GitHub, como todo lo demás: no hay checkout que suponer.

**Cinco cosas que este bloque nunca hace pasar por un cero:**

- **`(sin telemetría)`** — ese slice no tiene fichero: nadie midió.
- **`—` en `sin-vara`** — el slice tiene fichero, pero ningún veredicto traía la columna (telemetría anterior a `rubric_sin_vara`). La celda enseña además cuántos veredictos son «sin columna».
- **`—` en `vara ct`** — el slice tiene fichero, pero ningún veredicto traía las columnas `rubric_vara_ct_docs`/`findings_vara_ct` (telemetría anterior a esta medida, o de la `findings_patrones_vara_ct` que sustituyeron). Es una tolerancia INDEPENDIENTE de la de `sin-vara`: una fila puede traer una columna y no la otra, cada una con su propia fecha de nacimiento en la telemetría. Se exigen las dos mitades para imprimir la celda: media celda invitaría a leer el hueco como un cero.
- **`—` en `brief`** — el slice tiene fichero, pero ningún intento de `implement` traía `brief_vara_ct_docs`/`brief_bytes` (telemetría anterior a esta medida, o un intento en el que el brief no se pudo leer en su momento). Un cero aquí afirmaría un brief sin vara que nadie pudo medir.
- **no se pudo listar el directorio** — no se imprime ni un número, y se dice. **No baja el exit a `1`**: la causa casi siempre es que ese repo no tiene telemetría, y un `1` permanente en esos epics enseñaría a ignorar el exit code. Un **fichero** que el listado sí nombraba y no se pudo leer sí es una cosecha incompleta: motivo y exit `1`.

Las líneas ilegibles de un `jsonl` se cuentan y se dicen; no tiran el fichero ni cambian el exit — una fila corrupta de hace tres semanas no se arregla repitiendo el comando.

## A BigQuery, con la CLI de `bq`

`--bq <proyecto:dataset.tabla>` carga la cosecha en esa tabla al terminar, con el `bq` que ya tienes autenticado (como `gh`): `bq load` de un NDJSON, una fila por slice y cosecha, con `harvest_id` y `harvested_at`. Cada corrida se **añade** como una foto; nada se sobrescribe. El esquema viaja en el plugin, la tabla se crea en la primera carga si no existe y una columna nueva de una versión posterior se añade sola (`ALLOW_FIELD_ADDITION`). El dataset y sus permisos son de quien posee el proyecto, no del comando.

**Solo se carga una cosecha completa.** Con lecturas sin completar no se invoca `bq`: la cosecha se rehace desde GitHub, así que no se pierde nada. Todo `—` del informe llega como `NULL`, nunca como `0`. Si `bq` falla, el motivo trae el código, el diagnóstico, el directorio con los ficheros y el comando exacto para reintentar a mano. Todo lo de BigQuery va por stderr: stdout sigue siendo la tabla o el JSON. Sin el flag, nada cambia.

Este comando carga un epic entero a posteriori. La carga de cada slice al recogerlo la hace la cosecha automática: `dispatch-check <n> --repo <o/r> --collect --bq <tabla>`, que el backend invoca cada minuto cuando arranca con `CT_HARVEST_BQ_TABLE`.

## Los códigos de salida

| Código | Significa | Qué hacer |
|---|---|---|
| `0` | cosecha completa | leer la tabla |
| `1` | **no se pudo completar**: falló una lectura de `gh` o la carga en BigQuery | mirar los motivos de stderr, arreglar y repetir — lo impreso es sólo lo que sí se sabe |
| `2` | argumentos mal | corregir la invocación |

**El `1` nunca se degrada a `0`**, la misma regla que `/ct-status` y `/ct-groom`. Una cosecha parcial **no es un epic barato**: una tabla con huecos que se lea como «este slice no tuvo review», cuando lo que pasó es que falló la lectura, es un dato inventado entrando por la puerta de atrás en un pre-registro que prohíbe exactamente eso. **Un timeline que no se pudo leer no produce una fila de ceros: produce un motivo y ninguna fila.**

## Detalles

- **`*` en `release→merge`** marca que esa celda se midió contra el **cierre del issue** y no contra el merge de un PR. Va en la propia celda, no en una nota al pie: una nota al pie no viaja cuando alguien copia la tabla.
- **Dos PRs cerrando un mismo issue** se dice en voz alta como motivo (y baja el exit a `1`) en vez de elegir uno en silencio.
- **`--json`** emite `{repo, milestone, filas, motivos, telemetry}` con los segundos en crudo, para pegarlo en el desenlace del epic sin traducir. La quinta clave es la lectura del DIRECTORIO de telemetría (`{dir, status: ok|no-leido, why}`), distinta del `telemetry` que cada fila lleva dentro.
- **`--json`** lleva la telemetría de cada slice DENTRO de su fila (`telemetry.status`: `ok` / `sin-fichero` / `no-leido`), por el mismo motivo por el que `type` y `gate` viajan dentro.
- El formato de duración (`1m03`, `2h06m17`, `9h41m23`) es el mismo con el que se escribió a mano el desenlace del despacho 1, para poder comparar tabla cosechada y tabla escrita sin convertir nada.
