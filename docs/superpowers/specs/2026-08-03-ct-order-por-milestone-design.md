# El `ct-order` acotado por milestone en `/ct-groom`

> F23 · 2026-08-03 · cierra el §2 del feedback de campo
> (`menoplus/docs/superpowers/control-tower-loop-feedback-2026-08-01.md`).
> Viene de 0.22.1, tras cerrar F22.

## 1. Qué se arregla

El contrato §9 que `/ct-init` siembra promete:

> «Los `#` de esta tabla son únicos **dentro de su milestone**, no del repo: dos epics distintos pueden usar `#1` sin pisarse.»

Es cierto en `/ct-next` desde D1. Es **falso** en `/ct-groom`: el emparejado por marcador barre el repo entero. Al cerrar esto, la promesa pasa a ser cierta en las dos puntas y el rodeo que hoy rige en menoplus (empezar la tabla §9 en 10 o más, no correr `--reconcile`) se retira.

## 2. El defecto, reproducido

Reproducido con un arnés que llama a los **mismos call-sites** del script (`realIssuesOnly` → `findByMarker` → `diffIssue`/`formatDrift`/`buildReconcileEditArgs`, más el bucle de huérfanos), con 6 issues `#451`–`#456` cerrados en un milestone anterior y `ct-order:1..6`:

| Tabla §9 del spec nuevo | Qué sale hoy |
|---|---|
| `1, 2, 3` | Empareja con `#451`/`#452`/`#453` (cerrados, otro milestone), reporta el milestone distinto como divergencia, **y además** declara huérfanos a `#454`/`#455`/`#456`. Exit 3, cero issues creados |
| `7, 8, 9` | Crea los tres, declara huérfanos los **seis** viejos |

El peligro del `--reconcile` es literal, no hipotético. La línea que emite el preview:

```
--reconcile aplicaría: gh issue edit 451 --title slice nuevo 1 --milestone <el milestone NUEVO>
```

Existe una `nota: el issue está cerrado — revisa antes de aplicar --reconcile`, pero es una nota: no puede detener la acción siguiente, y por tanto es decoración (§7.1 del feedback).

### 2.1 Precisión sobre el diagnóstico del documento

El feedback describe **una** causa. Son **dos** call-sites independientes de la misma propiedad:

- `ct-groom.mjs:627` — `findByMarker(existingIssues, marker)`, el emparejado.
- `ct-groom.mjs:617-623` — `knownOrders`, la detección de huérfanos.

Por eso la cara 1 produce divergencias espurias **y** huérfanos espurios en la misma corrida, cosa que el documento no recoge.

### 2.2 Barrido por propiedad — el radio completo

Consumidores del marcador `ct-order` en todo el repo:

| Sitio | Estado |
|---|---|
| `ct-groom.mjs:619` (huérfanos) | **sin acotar** — entra en F23 |
| `ct-groom.mjs:627` (emparejado) | **sin acotar** — entra en F23 |
| `ct-next.mjs` vía `buildDispatchInput` | ya acotado (D1) |
| `dispatch-check.mjs:299` | pagina issues igual, pero proyecta a `{n, labels}` y **no lee el marcador**. No afectado |
| `groom.js:258` (comentario) | describe la conducta de `buildOrderIndex` **anterior** a D1 («se queda con el último issue visto»). Falso hoy. Entra en F23 |

## 3. Diseño

### 3.1 La llave es el título del milestone, no su número

`epicKeyOf` (`gh-issue-map.js:811`) usa `milestone.number`. `/ct-groom` **no puede**: el fetch de issues está en la línea 600 y `msNumber` no se resuelve hasta la 970.

Mover el fetch detrás de la resolución del milestone está descartado, y no por comodidad: el comentario de `ct-groom.mjs:878-897` documenta que el listado se colocó **deliberadamente delante** porque un abort posterior deja el milestone YA CREADO y las labels YA CREADAS en GitHub — verificado en su día contra el sandbox, con la traza de las llamadas. Reordenar reabriría eso.

El título es una llave legítima aquí: el propio código ya la trata como única en la línea 970 (`allMilestones.find((m) => m.title === milestone)`), que es lo que hace idempotente la creación del milestone.

Divergencia deliberada respecto a `epicKeyOf`, y su porqué: `/ct-next` sólo lee, así que puede permitirse la llave más fuerte; `/ct-groom` **crea**, y para crear sin duplicar necesita decidir antes de conocer el número.

### 3.2 Lógica pura nueva, en `scripts/gh-issues.js`

Ese fichero es, por su propia cabecera, «lógica pura para parsear/filtrar el listado paginado de issues… y buscar el marcador ct-order». Es su sitio.

```js
export function epicTitleOf(rawIssue)           // milestone?.title ?? null
export function partitionByEpic(issues, title)  // { inEpic, sinMilestone, otrosEpics }
```

`findByMarker` **no cambia de firma**. Sigue siendo el `includes` honesto de tres líneas; lo que cambia es la lista que recibe (`inEpic`). Es su único call-site en el repo.

`epicTitleOf` devuelve `null` para `milestone: null`, `milestone: {}` o milestone sin título — mismo criterio de "no revientes, cae en el bucket" que `epicKeyOf`/`NO_MILESTONE_KEY`.

### 3.3 Dos puertas, un solo exit

Ambas se computan **justo tras el fetch (~617), antes de toda mutación** — la primera mutación del script es la creación del milestone en la 970.

**Puerta A — sin milestone.** Un issue sin milestone que lleva `ct-order:N` con N en la tabla §9 de hoy. No hay forma de saber si es de este epic (alguien le quitó el milestone a mano, o se borró el milestone en GitHub) o de otro. Se rehúsa actuar.

**Puerta B — epic renombrado.** Un issue en **otro** milestone con `ct-order:N`, N en la tabla de hoy, **y el mismo destino de spec**.

Esta puerta cubre un riesgo que **introduce el propio arreglo** y que no está en el feedback: al acotar por título, si el título pedido no casa con el que tienen los issues (epic renombrado en GitHub, o errata en `--milestone`), `/ct-groom` ve cero issues en su epic y **recrea el epic entero duplicado** en un milestone nuevo, con exit 0. Hoy eso no pasa porque el emparejado es global. Es exactamente la clase de error del §7.1: un comando que no da error y no hace lo que parece.

La señal existe y es barata: todo issue groomeado lleva su enlace al spec en el body (`groom.js:148` `renderSpecLink`, leído por `extractSpecLink`). Mismo orden + mismo spec = el mismo epic bajo otro título. Spec distinto = epic distinto reusando números, que es **el caso que este arreglo viene a habilitar** y no dispara nada.

**Cómo se compara el spec.** Sólo el destino, la parte tras `Spec: `, no la línea entera. La línea empieza por `> Slice \`#N\` del epic. Spec: ` y ese prefijo cambió de formato en F6 (`#N` → `` `#N` ``, ver `SPEC_LINK_PREFIXES`), así que comparar entero daría falsos negativos sobre issues viejos.

**El fallo en abierto, con su precio dicho entero.** Si el destino falta en cualquiera de los dos lados, o difiere, la puerta **no dispara**. Las dos formas reales de que eso pase para el mismo documento son (a) issues groomeados **antes de F10**, con el enlace en la forma relativa vieja, y (b) la forma degradada `— sin enlace: <motivo>`, emitida cuando el spec no estaba publicado al groomear. La causa que se citaba aquí antes —«dos costumbres de invocación, relativa vs. absoluta»— **la eliminó F10**: la línea ya no se compone de `argv`, sino de la ruta dentro del repo, el remoto y la rama por defecto.

Y el falso negativo **no devuelve el comportamiento de hoy**: con `inEpic` vacío, esa corrida recrea el epic entero duplicado con exit 0, mientras que el emparejado global lo encontraba por marcador y salía 3 sin crear nada. Es un riesgo **aceptado** —un falso positivo pararía en seco el caso normal que este arreglo viene a habilitar, dos epics distintos reusando números—, no una degradación benigna. Por eso cada descarte de ese cubo emite un **aviso no bloqueante** por stderr (§3.4).

**Un solo exit.** Las dos puertas se calculan enteras, se reportan **todos** los hallazgos, y se sale una sola vez. Convención ya establecida en este repo (§5 del feedback, «los N bloqueantes nombrados de una vez»): el defecto no era la incompletitud sino la conjunción — nombrar uno decía «quita ése y sale» y era falso.

**Código de salida: 1**, por precedente. `ct-groom.mjs:943` ya usa 1 para «leí un estado inconsistente, NO continúo». `2` es validación de argv/spec. `3` es «hubo divergencia pero el trabajo se hizo», y aquí no se hace nada.

**Bajo `--dry-run` también aborta**, igual que los fallos de fetch de 604/615. Un preview que calla que la corrida real se pararía informa menos que la corrida real, que es justo la trampa que F5 cerró.

### 3.4 Emparejado, huérfanos y aviso

- Emparejado: `findByMarker(inEpic, marker)`.
- Huérfanos: sólo sobre `inEpic`. Un issue de otro epic deja de ser asunto de esta corrida.
- **Aviso informativo, no bloqueante (puerta A):** issues sin milestone con `ct-order` que **no** colisiona con la tabla de hoy se nombran por stderr. Replica el criterio de `NO_MILESTONE_KEY`: bucket compartido con aviso, nunca invisible.
- **Aviso informativo, no bloqueante (puerta B):** un issue de otro milestone con `ct-order:N`, N en la tabla de hoy, cuyo destino de spec **no casa** con el nuestro (por diferir o por faltar en cualquiera de los dos lados) se descartaba en silencio — y es exactamente el cubo del que sale un epic duplicado con exit 0 (§3.3). Se nombra por stderr, con su milestone real y la advertencia de que, si es el mismo epic renombrado, esto lo va a duplicar. **No** cambia cuándo dispara la puerta ni el código de salida.
  - **Acotado a lo que de verdad puede duplicarse:** sólo si el slice **no tiene ya issue en el epic de la corrida** (mismo predicado que el emparejado, `findByMarker(inEpic, marker)`). La duplicación exige creación; si el slice ya está emparejado, la creación se salta y el aviso saldría en cada corrida sin describir ninguna pérdida ni admitir remedio. Es el criterio que este mismo fichero ya aplica en `backlogPendingCount` al filtrar los issues cerrados: *un aviso que no se puede satisfacer es un aviso que enseña a ignorar los demás*.
  - **Se emite después del exit de los bloqueos:** el aviso afirma que este groom va a crear ese slice, y una corrida que se para en seco no crea nada. La corrida siguiente, ya sin bloqueo, lo vuelve a calcular igual.

### 3.5 Lo que queda muerto y se documenta, no se borra

Con el emparejado acotado, un issue emparejado **siempre** tiene el milestone pedido: `diff.milestone` es estructuralmente inalcanzable desde `/ct-groom`, y con él la rama de `buildReconcileEditArgs` que emite `--milestone`.

**El peligro del `--reconcile` desaparece por construcción, no por una nota que pide revisar.**

El código **no se borra**: `reconcile.js` es puro, compartido y testeado, y esa comparación sigue siendo la reparación correcta para cualquier caller que le pase un issue de otro alcance. Se documenta por qué ya no puede dispararse desde este call-site.

### 3.6 El comentario obsoleto de `groom.js:258`

Afirma que `buildOrderIndex` «se queda con el ÚLTIMO issue visto para un orden repetido». Era cierto antes de D1; hoy gana el primero y la colisión excluye el epic afectado. En este repo los comentarios son documentación con carga estructural: un comentario que nombra una conducta que el código ya no tiene es deuda, y cae dentro del radio de este arreglo.

## 4. Tests

El arnés ya existe: `__tests__/fixtures/fake-gh-bin` con overrides permite fabricar el listado de issues, así que las dos caras se cubren **end-to-end**, no sólo por unidad.

**Unitarios** (`gh-issues.test.js`):
- `epicTitleOf`: título presente, `milestone: null`, `milestone: {}`, entrada vacía.
- `partitionByEpic`: reparto en los tres cubos, lista vacía, `undefined`.

**Regresión de las dos caras** (`ct-groom-dryrun.test.js`), con 6 issues cerrados de otro milestone y `ct-order:1..6`:
- tabla `1,2,3` → crea 3, **cero** divergencias, **cero** huérfanos, exit 0.
- tabla `7,8,9` → crea 3, **cero** huérfanos.

**Las puertas:**
- Puerta A sola: exit 1, nombra los issues, no muta nada.
- Puerta B sola: exit 1, nombra el issue y su milestone real.
- **Las dos a la vez:** una sola corrida reporta los hallazgos de ambas y sale una sola vez.
- Bajo `--dry-run` las puertas también abortan.

**Lo que debe seguir funcionando:**
- Aviso no bloqueante: issue sin milestone con `ct-order` que no colisiona → se nombra, exit no cambia.
- Huérfano legítimo: issue **del epic actual** con orden fuera de la tabla → sigue avisando, sigue saliendo 3.
- Puerta B no dispara cuando el enlace al spec difiere (epic distinto reusando números): el caso que el arreglo habilita.

## 5. Documentación y retirada del rodeo

- `commands/ct-groom.md`: sección nueva sobre el alcance por epic y las dos puertas, con su remediación.
- Retirar la restricción «tabla §9 empieza en 10 o más, no se usa `--reconcile`» de los **dos** sitios donde está escrita: el §8 del documento de feedback de menoplus, y el spec de producto del 2026-07-31 del mismo repo.
- La memoria `ct-order-global-menoplus.md` queda obsoleta al cerrar esto.

## 6. Qué NO entra

- No se toca nada del §5 del feedback.
- No se toca `/ct-next`: ya está acotado desde D1.
- No se cambia el formato del marcador `ct-order`. Codificar el epic dentro del marcador ya se descartó en D1 con argumento (sería la misma información que el milestone ya provee, exigiendo reescribir issues ya groomeados o mantener dos formatos en paralelo indefinidamente) y ese argumento sigue en pie aquí.
- No se borra `diff.milestone` ni su rama en `buildReconcileEditArgs` (ver §3.5).
- No entran §3.1, §3.2 ni §4 del feedback: van después, en ese orden.

## 7. Recordatorios de método para la ejecución

- **`dist/` está trackeado** y `hooks/hooks.json` ejecuta `dist/`, no `hooks/`. `npm test` corre `npm run build` antes, así que la suite queda verde con un `dist` commiteado obsoleto. F23 no debería tocar `hooks/` — si lo toca, el bundle reconstruido va en el **mismo** commit.
- **Auditar por propiedad, nunca por lista.** El barrido del §2.2 es el punto de partida, no el final: cualquier tarea que enumere ficheros debe además barrer por la propiedad y enumerar lo que encuentre.
- **Verificar el efecto, nunca el exit code.** Una comprobación que no puede detener la acción siguiente es decoración — es la razón de que A y B sean puertas y no avisos.
- **Nunca nombrar un fichero, función o conducta que no se haya leído.**
