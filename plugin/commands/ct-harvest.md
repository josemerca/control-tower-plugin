---
description: Cosecha del epic — el coste real de cada slice, sacado del timeline de GitHub. Cero campos manuales. Sólo lee de GitHub; con --bq carga la cosecha en BigQuery.
---
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-harvest.mjs --repo "<owner/repo>" --milestone "<título del epic>" [--json] [--bq <proyecto:dataset.tabla>]
```

Una fila por slice (`ready→claim`, `claim→release`, `release→merge`, reopens, requeues, `blocked`, tamaño del PR) más la telemetría del juez por slice. Todo sale del timeline que GitHub escribe solo; no pide ningún campo a mano. **No muta nada.** Una fase que no ocurrió se imprime `—`, nunca `0`; el resumen va por familia (`Tipo`) y cada familia enseña su N. La tabla o el JSON van por stdout; los motivos y todo lo de BigQuery, por stderr.

| Exit | Significa | Qué hacer |
|---|---|---|
| `0` | Cosecha completa | leer la tabla |
| `1` | **No se pudo completar**: falló una lectura de `gh` o la carga en BigQuery | mirar los motivos de stderr, arreglar y repetir — lo impreso es sólo lo que sí se sabe |
| `2` | Argumentos mal | corregir la invocación |

El `1` nunca se degrada a `0`: un timeline que no se pudo leer produce un motivo y ninguna fila, no una fila de ceros.

Referencia completa —las tres decisiones de la cosecha, cada columna de telemetría, el mapa de celda a columna de BigQuery—: `docs/loop/ct-harvest.md` en el repo del plugin.
