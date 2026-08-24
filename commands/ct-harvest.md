---
description: Cosecha del epic — el coste real de cada slice, sacado del timeline de GitHub. Cero campos manuales. Sólo lee.
---
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --repo "<owner/repo>" --milestone "<título del epic>" [--json]
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

Además del coste, la cosecha lee lo que la propia slice dejó commiteado en `docs/superpowers/metrics/issue-<n>.jsonl` y saca, **por slice**, cuántos ítems de la rúbrica volvieron **`sin-vara`** (el juez tenía sujeto que mirar y no tenía con qué medirlo) y **cuántos hallazgos hubo por regla**. Hasta ahora esa columna viajaba en la pull request y **no la leía nadie**: el número existía en disco y había que abrir los `jsonl` a mano.

Se lee de GitHub, como todo lo demás: no hay checkout que suponer.

**Tres cosas que este bloque nunca hace pasar por un cero:**

- **`(sin telemetría)`** — ese slice no tiene fichero: nadie midió.
- **`—` en `sin-vara`** — el slice tiene fichero, pero ningún veredicto traía la columna (telemetría anterior a `rubric_sin_vara`). La celda enseña además cuántos veredictos son «sin columna».
- **no se pudo listar el directorio** — no se imprime ni un número, y se dice. **No baja el exit a `1`**: la causa casi siempre es que ese repo no tiene telemetría, y un `1` permanente en esos epics enseñaría a ignorar el exit code. Un **fichero** que el listado sí nombraba y no se pudo leer sí es una cosecha incompleta: motivo y exit `1`.

Las líneas ilegibles de un `jsonl` se cuentan y se dicen; no tiran el fichero ni cambian el exit — una fila corrupta de hace tres semanas no se arregla repitiendo el comando.

## Los códigos de salida

| Código | Significa | Qué hacer |
|---|---|---|
| `0` | cosecha completa | leer la tabla |
| `1` | **no se pudo completar**: falló una lectura de `gh` | mirar los motivos de stderr, arreglar y repetir — lo impreso es sólo lo que sí se sabe |
| `2` | argumentos mal | corregir la invocación |

**El `1` nunca se degrada a `0`**, la misma regla que `/ct-status` y `/ct-groom`. Una cosecha parcial **no es un epic barato**: una tabla con huecos que se lea como «este slice no tuvo review», cuando lo que pasó es que falló la lectura, es un dato inventado entrando por la puerta de atrás en un pre-registro que prohíbe exactamente eso. **Un timeline que no se pudo leer no produce una fila de ceros: produce un motivo y ninguna fila.**

## Detalles

- **`*` en `release→merge`** marca que esa celda se midió contra el **cierre del issue** y no contra el merge de un PR. Va en la propia celda, no en una nota al pie: una nota al pie no viaja cuando alguien copia la tabla.
- **Dos PRs cerrando un mismo issue** se dice en voz alta como motivo (y baja el exit a `1`) en vez de elegir uno en silencio.
- **`--json`** emite `{repo, milestone, filas, motivos, telemetry}` con los segundos en crudo, para pegarlo en el desenlace del epic sin traducir. La quinta clave es la lectura del DIRECTORIO de telemetría (`{dir, status: ok|no-leido, why}`), distinta del `telemetry` que cada fila lleva dentro.
- **`--json`** lleva la telemetría de cada slice DENTRO de su fila (`telemetry.status`: `ok` / `sin-fichero` / `no-leido`), por el mismo motivo por el que `type` y `gate` viajan dentro.
- El formato de duración (`1m03`, `2h06m17`, `9h41m23`) es el mismo con el que se escribió a mano el desenlace del despacho 1, para poder comparar tabla cosechada y tabla escrita sin convertir nada.
