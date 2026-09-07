# El documento del loop — fuente y derivados

Documento de referencia del ciclo de desarrollo de Control Tower: los 16 pasos,
las 3 puertas humanas, la máquina de estados de un slice, y el formato exacto de
los 11 artefactos que viajan entre pasos.

## Los ficheros

| Fichero | Qué es | ¿Se edita a mano? |
|---|---|---|
| `loop.body.html` | **La fuente.** Fragmento HTML (sin `<html>`/`<head>`/`<body>`) — es también lo que se publica como Artifact, y por eso no puede traerlos | **sí, es el único que se edita** |
| `build.mjs` | El generador de los dos derivados | sí |
| `control-tower-loop.html` | Derivado: página autocontenida, un solo fichero, sin dependencias de red | **no** — se regenera |
| `control-tower-loop.pdf` | Derivado: 29 páginas A4, para compartir e imprimir | **no** — se regenera |

Los derivados están **trackeados**, mismo criterio que `dist/` en este repo:
todo cambio en `loop.body.html` tiene que llevarlos reconstruidos **en el mismo
commit**, o se distribuye una versión vieja mientras la fuente ya dice otra cosa.

## Reconstruir

```bash
node docs/loop/build.mjs          # HTML + PDF   (~14 s)
node docs/loop/build.mjs --html   # sólo HTML    (no necesita navegador)
```

El PDF se imprime con Chrome/Brave/Chromium/Edge en headless. Si no hay ninguno
instalado, el HTML sí se genera y el script lo dice — no emite un PDF a medias.

**Por qué el script espera al fichero y no al navegador:** medido en esta
máquina, `--print-to-pdf` deja el PDF completo en disco a los ~2 s pero el
proceso sigue vivo dos minutos largos (despierta el updater, que hereda los
descriptores). Esperar la salida del proceso daba un `ETIMEDOUT` sobre un PDF
perfectamente escrito — un fallo reportado sobre un éxito. Ahora se sondea el
tamaño del fichero hasta que deja de crecer, y entonces se mata al navegador.

La hoja de impresión vive en `build.mjs`, no en la fuente: la fuente se publica
como página web y no se imprime nunca, así que mezclarlas obligaría a leer
reglas de paginación a quien sólo edita contenido.

## El Artifact

La misma fuente está publicada como página privada en claude.ai:

<https://claude.ai/code/artifact/d06f6ba2-d67a-4c23-a113-15c782690759>

Para actualizarla sin cambiar la URL, hay que publicar **pasando esa URL**
explícitamente: publicar sin ella crea un artifact nuevo en vez de actualizar el
que ya se ha compartido.

## Las referencias por comando

Desde la sub-issue #93 cada `plugin/commands/*.md` se queda con lo que el modelo
necesita al invocar el comando —la invocación, una tabla de códigos de salida y
un enlace aquí— y la prosa larga (los mecanismos, sus límites y la historia de
las decisiones, rondas F5…F38) vive en este directorio, un fichero por comando,
movida íntegra y sin resumir:

| Comando | Referencia |
|---|---|
| `/ct-init` | [`ct-init.md`](ct-init.md) |
| `/ct-groom` | [`ct-groom.md`](ct-groom.md) |
| `/ct-next` | [`ct-next.md`](ct-next.md) |
| `/ct-status` | [`ct-status.md`](ct-status.md) |
| `/ct-harvest` | [`ct-harvest.md`](ct-harvest.md) |

Son documentos de este repo, no del plugin: no se distribuyen ni se cargan en el
contexto de ninguna sesión. `__tests__/ct-init.test.js` lee `ct-groom.md` para
comprobar que la regla de la columna `Señal` dice lo mismo aquí, en el contrato
sembrado y en el juez de slice.

## Procedencia del contenido

Cada formato de la página sale de la fuente que lo emite, no de una descripción
de segunda mano:

- los `commands/*.md` y, desde #93, sus referencias largas en este directorio
  (`ct-init`, `ct-groom`, `ct-next`, `ct-status`, `ct-harvest`);
- los skills forkados de `skills/` (`brainstorming`, `writing-plans`,
  `finishing-a-development-branch`, `subagent-driven-development`) y `skills/FORK.md`;
- `scripts/groom.js` — `buildIssueTitle`, `buildLabels`, `buildIssueBody`;
- `scripts/kickoff.js` — `renderKickoff`, `buildStateSeed`, `ADDENDA`;
- `scripts/ct-init.sh` — el contrato de la tabla de slices (v16 cuando se
  escribió el documento; desde #93 se siembra en
  `docs/superpowers/CONTRATO-SLICES.md` del repo destino, no en `AGENTS.md`);
- `skills/state-template/STATE.template.md`;
- `hooks/hooks.json`;
- `templates/_TEMPLATE-execution-spec.md` — la plantilla del execution spec.
  Ya viaja con el plugin: `ct-init` la siembra en
  `docs/superpowers/specs/_TEMPLATE-execution-spec.md` del repo destino, que es
  donde `skills/brainstorming/SKILL.md` la busca. Antes vivía suelta en
  menoplus, y el paso 8 del brainstorming se quedaba sin fuente en cualquier
  otro repo.

**Al cambiar cualquiera de esas fuentes, este documento queda desactualizado y
nada lo comprueba.** No hay test que lo vigile; es un documento, no código.
