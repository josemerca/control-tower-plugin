---
description: Informe de estado del loop — qué está en vuelo, qué ha entregado y qué es residuo. Sólo lee.
---
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-status.mjs --repo "<owner/repo>"
```

Se ejecuta desde el checkout del repo que se mira (también desde dentro de un `.worktrees/<n>`). **No muta nada**: nombra lo que encuentra y el remedio; borrar es decisión tuya. El informe va por stdout; los `aviso:` por stderr. Transmítelo tal cual, bloque a bloque (`EN VUELO`, `ENTREGADO, ESPERANDO MERGE`, `ENTREGADO, SIN COSECHAR`, `RESIDUO`), con la coletilla de cada línea: «sin señal de vida» es local a esta máquina y nunca acusa cuando no ha podido comprobar.

| Exit | Significa | Qué hacer |
|---|---|---|
| `0` | Nada que revisar: nada en vuelo sin señales de vida, ningún residuo, ninguna lectura a medias | nada |
| `3` | Hay algo que revisar: residuo, un claim sin proceso vivo, labels huérfanas, entregas sin cosechar | leer los bloques del informe |
| `1` | **No se pudo comprobar**: falló una lectura de `gh`, de los procesos o del disco, o el checkout no habla del mismo repo que `--repo` | mirar los `aviso:`, arreglar la causa y repetir — lo impreso es sólo lo que sí se sabe |

El `1` nunca se degrada a `0`: precedencia `1` > `3` > `0`.

Referencia completa —qué significa cada bloque y cada coletilla, y por qué—: `docs/loop/ct-status.md` en el repo del plugin.
