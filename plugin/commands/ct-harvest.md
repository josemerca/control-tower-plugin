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

Además del coste, la cosecha lee lo que la propia slice dejó commiteado en `docs/superpowers/metrics/issue-<n>.jsonl` y saca, **por slice**, cuántos ítems de la rúbrica volvieron **`sin-vara`** (el juez tenía sujeto que mirar y no tenía con qué medirlo), **cuántos hallazgos hubo por regla**, **cómo se reparten esos hallazgos por severidad** (`alta/media/baja`), **cuántos de los veredictos fueron un veto** y las dos mitades de la columna **`vara ct`**: cuántos de sus documentos llegaron a citarse en el recorrido de la rúbrica, y cuántos hallazgos los citan. Hasta ahora la primera de estas columnas viajaba en la pull request y **no la leía nadie**: el número existía en disco y había que abrir los `jsonl` a mano.

**La severidad dice si el hallazgo dolió, y `findings_by_rule` no lo dice.** Tres hallazgos de `alcance` pueden ser tres vetos o tres notas al margen, y la columna por regla los cuenta igual. El reparto va en una sola celda y en el orden en que se decide: una **alta** VETA —el contrato del veredicto no admite un `PASS` con una alta, así que una alta implica `FAIL`—, una **media** compra una vuelta pagada al implementador, una **baja** sólo se anota. Al lado, la celda de `Veredictos` anota **cuántos de ellos fueron un veto**: `verdicts` dice cuántas veces se juzgó, y esa nota cuántas veces el juez paró. Un slice limpio no anota nada.

Las dos medidas llevan viviendo en cada fila de `issue-<n>.jsonl` desde que existe `verdictMeasures` —`findings_high`, `findings_medium`, `findings_low` y `ruling`—, y el agregado las tiraba: estaban en disco y no las leía nadie, exactamente el mismo hueco que tuvo `rubric_sin_vara` antes de que esta tabla existiera.

**Las dos mitades de `vara ct` se leen juntas, y en ese orden.** `5 docs · 0 hallazgos` slice tras slice es el caso a vigilar: o el código conformaba de verdad, o la vara se está nombrando de adorno — y con una sola cifra esas dos lecturas son el mismo número. No son dos columnas que tengan que sumar lo mismo: miden el insumo (llegó y se usó) y el efecto (cazó algo).

Sustituyen a `patrones-ct`, que contaba sólo hallazgos del ítem `patrones` con el argumento de que es el único que mide contra las varas. El run del slice #7 de `rust-monitoring` lo refutó midiendo: la vara de ct salió citada dos veces bajo `decisiones-cerradas`, y la regla de mutación de `conventions/testing.md` se contestó bajo `test-desiderata`. Un hallazgo que la vara produjo y que se archivó en otro ítem era invisible, así que la columna medía **dónde se archivó** el hallazgo y no **qué lo produjo**.

La cita se detecta de **dos** formas. Por la FORMA de la ruta (`conventions/<algo>.md`, sin barra ni letra delante), que no depende de los nombres de hoy: un documento renombrado o uno nuevo también cuenta — así se contó `defects.md` el día que se partió `code.md`, sin tocar nada de esto. Y por el NOMBRE a secas (`style.md`), contra `PluginYardstick.FILES`, porque un nombre sin prefijo no tiene forma que lo delate y la única lista buena es la que define qué documentos viajan.

La segunda entró midiendo: en el slice #8 de `rust-monitoring` el juez de la tarea 5 discutió los cinco documentos por su nombre a secas y la columna contó **cero**. Medía la forma de la cita y no el uso.

En las dos formas, el `docs/conventions/style.md` de la vara del REPO —que contiene las dos subcadenas— nunca cuenta como ct: ni `conventions/` ni el nombre pueden venir precedidos de una barra.

La misma telemetría trae además, por cada intento del paso `implement`, si la vara de ct **llegó** al brief de la tarea y **cuánto pesó**: cuántas cabeceras `## Vara de ct: conventions/` trae el brief que quedó en disco (`brief_vara_ct_docs`) y su tamaño en bytes (`brief_bytes`). Es lo que cierra una desviación silenciosa: hoy el plugin aborta si los documentos faltan del PLUGIN, pero nada comprobaba que el brief se los hubiera LLEVADO — si `escribirBrief` se rompe, todo sigue en verde y el juez mide en silencio sólo contra la vara del repo. La columna `brief` de la tabla suma los dos números de todos los intentos de `implement` que el slice dejó escritos (`N docs · M B`).

Y trae, por cada papel que el loop **despacha a un subagente** —el implementador, el juez de tarea, el juez de slice y el reconciliador—, **cuánto material leyó**: el tamaño del fichero del agente o del prompt que se le entregó (`agent_bytes`), la suma de los `SKILL.md` y sus referencias que ese texto le **ordena cargar** (`skill_bytes`, `0` cuando no le ordena ninguna, que es una medida y no una ausencia) y el del brief o paquete de revisión o reconciliación que recibió (`package_bytes`). Los tres se miden sobre el fichero que hay **en disco** en el momento de escribir la fila, nunca sobre lo que el programa pretendía escribir. La columna `bytes por papel` de la tabla los suma sobre todos los papeles del slice (`agente N B · skills M B · paquete P B`).

Sin ellos, «este cambio ahorra 85K tokens de material fijo por slice» es una opinión: `brief_bytes` medía **una** de las cuatro llamadas al modelo, y la mitad fija del contexto —el agente y sus skills— no estaba en ninguna columna. La comparación se hace sumando `brief_bytes + agent_bytes + skill_bytes` antes y después.

Dos filas no entran nunca en esa cuenta, y por el mismo motivo por el que un juez descartado no entra en la de veredictos: un veredicto que no se aceptó no juzgó nada, y una ronda de `reconcile` en la que todavía no hay paquete escrito no despachó a nadie. Contarlas metería en el denominador llamadas al modelo que no se hicieron.

Se lee de GitHub, como todo lo demás: no hay checkout que suponer.

**Siete cosas que este bloque nunca hace pasar por un cero:**

- **`(sin telemetría)`** — ese slice no tiene fichero: nadie midió.
- **`—` en `sin-vara`** — el slice tiene fichero, pero ningún veredicto traía la columna (telemetría anterior a `rubric_sin_vara`). La celda enseña además cuántos veredictos son «sin columna».
- **`—` en `alta/media/baja`** — el slice tiene fichero, pero ningún veredicto traía las tres severidades (telemetría anterior a esta medida). `0/0/0` afirmaría un reparto que nadie midió. Las tres se exigen JUNTAS: a una fila a la que le falte una sola se la cuenta vieja entera, porque el reparto sólo se lee sumado y media medida no describe nada.
- **`—` en `vara ct`** — el slice tiene fichero, pero ningún veredicto traía las columnas `rubric_vara_ct_docs`/`findings_vara_ct` (telemetría anterior a esta medida, o de la `findings_patrones_vara_ct` que sustituyeron). Es una tolerancia INDEPENDIENTE de la de `sin-vara`: una fila puede traer una columna y no la otra, cada una con su propia fecha de nacimiento en la telemetría. Se exigen las dos mitades para imprimir la celda: media celda invitaría a leer el hueco como un cero.
- **`—` en `brief`** — el slice tiene fichero, pero ningún intento de `implement` traía `brief_vara_ct_docs`/`brief_bytes` (telemetría anterior a esta medida, o un intento en el que el brief no se pudo leer en su momento). Un cero aquí afirmaría un brief sin vara que nadie pudo medir.
- **`—` en `bytes por papel`** — el slice tiene fichero, pero ningún papel despachado traía `agent_bytes`/`skill_bytes`/`package_bytes` (telemetría anterior a esta medida). Los tres se exigen JUNTOS, como las severidades: la pregunta que motiva la columna es su suma, y media medida no la contesta.
- **no se pudo listar el directorio** — no se imprime ni un número, y se dice. **No baja el exit a `1`**: la causa casi siempre es que ese repo no tiene telemetría, y un `1` permanente en esos epics enseñaría a ignorar el exit code. Un **fichero** que el listado sí nombraba y no se pudo leer sí es una cosecha incompleta: motivo y exit `1`.

Las líneas ilegibles de un `jsonl` se cuentan y se dicen; no tiran el fichero ni cambian el exit — una fila corrupta de hace tres semanas no se arregla repitiendo el comando.

## A BigQuery, con la CLI de `bq`

`--bq <proyecto:dataset.tabla>` carga la cosecha en esa tabla al terminar, con el `bq` que ya tienes autenticado (como `gh`): `bq load` de un NDJSON, una fila por slice y cosecha, con `harvest_id` y `harvested_at`. Cada corrida se **añade** como una foto; nada se sobrescribe. El esquema viaja en el plugin, la tabla se crea en la primera carga si no existe y una columna nueva de una versión posterior se añade sola (`ALLOW_FIELD_ADDITION`). El dataset y sus permisos son de quien posee el proyecto, no del comando.

**Solo se carga una cosecha completa.** Con lecturas sin completar no se invoca `bq`: la cosecha se rehace desde GitHub, así que no se pierde nada. **Ningún `—` del informe llega como `0`: la regla es de la COLUMNA, no de la celda**, y una celda combinada reparte un `NULL` por cada columna que la compone — el mapa está debajo. Si `bq` falla, el motivo trae el código, el diagnóstico, el directorio con los ficheros y el comando exacto para reintentar a mano. Todo lo de BigQuery va por stderr: stdout sigue siendo la tabla o el JSON. Sin el flag, nada cambia.

**De la celda a la columna.** Uno a uno: cada `—` de una fase es `NULL` en su `*_seconds`, y un slice sin PR deja `pr`, `additions`, `deletions`, `changed_files`, `reviews` y `review_comments` en `NULL`; el `*` de `release→merge` no es columna, es `merge_source = 'issue-closed'`. Combinadas, en la telemetría: `Veredictos` son `verdicts`, `verdicts_fail` y `rubric_sin_vara_legacy`; `sin-vara` es `rubric_sin_vara`; `alta/media/baja` son `findings_high`, `findings_medium`, `findings_low` y `findings_severity_legacy`; `Hallazgos por regla` es `findings_by_rule` (registro repetido de `{rule, findings}`, que va `[]` y no `NULL` cuando no hay veredictos o no hay fichero); `vara ct` son `rubric_vara_ct_docs`, `findings_vara_ct`, `rubric_vara_ct_docs_legacy` y `findings_vara_ct_legacy`; `brief` son `brief_vara_ct_docs`, `brief_bytes`, `brief_legacy` y `brief_attempts`; `bytes por papel` son `agent_bytes`, `skill_bytes`, `package_bytes`, `role_bytes_legacy` y `role_bytes_attempts`. Con `telemetry_status` distinto de `ok`, todas las cuentas van `NULL`.

**Media celda puede ser un número y la otra media un `NULL`.** El informe exige las DOS mitades para imprimir `vara ct` o `brief` —el porqué está arriba, en «La telemetría del juez, por slice»—, pero la tabla no las junta: un `—` en `vara ct` puede ser en la fila `rubric_vara_ct_docs` con un número y `findings_vara_ct` en `NULL`, o al revés. Cada columna dice lo que se midió de ella, que es más de lo que decía la celda.

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
