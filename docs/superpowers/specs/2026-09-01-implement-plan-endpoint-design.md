# El endpoint que implementa el plan — el front da el go, el plugin hace el resto

**Fecha:** 2026-09-01
**Alcance:** primera iteración, un slice a la vez, sin tocar `plugin/`
**Depende de:** la rama `alcaptar/start-plan-crea-el-issue` (el issue de GitHub y `ToolRunner`/`GhCall`)

---

## 1. Qué se decide

`POST /start-plan` crea hoy el issue de GitHub con `gate:plan` y `status:ready`, y abre una workspace
de cmux cuyo `--command` todavía es un `echo`. Este diseño rellena ese hueco y añade el endpoint
siguiente:

| Endpoint | Qué hace | Quién decide |
|---|---|---|
| `POST /start-plan` | Crea el issue y **despacha con `ct-next`**: worktree, rama, cmux, `claude`. El agente escribe el plan prescriptivo, lo publica en el issue y **para** | Nadie |
| `POST /implement-plan` | Publica `-OK <nonce>` en el issue. El vigilante ya lanzado empuja la sesión y la implementación corre hasta el pull request | **El humano, en el front** |

El front es la coordinadora: no hay sesión de agente que coordine nada.

## 2. La tesis: el plugin ya hace el trabajo, y el backend no reimplementa nada

Tres piezas del plugin, verificadas en el código, hacen gratis lo que el diseño de fusión
(`2026-08-31-fusion-con-app-companion-design.md`, §3.1 y §6.1) planeaba construir:

1. **`ct-next` imprime el nonce por stdout.** `go-channel.js:39` emite
   `GO de #N: contesta exactamente \`-OK <nonce>\` en un comentario del issue.` Ese canal existe para
   que lo lea una persona en su terminal; cuando quien invoca `ct-next` es este backend, **el nonce lo
   captura un proceso y no entra en el contexto de ningún agente**. Es la propiedad que §6.1.3 quería
   comprar moviendo el sorteo del nonce, y sale sin mover nada.
2. **El vigilante del go cierra el ciclo solo.** `ct-watch-go.mjs` queda sondeando el issue cada 30 s y,
   al ver el comentario, teclea él la línea en la sesión de cmux (`:214`). El backend **no sostiene
   ningún pseudo-terminal**: el terminal sigue siendo cmux.
3. **El gate lo pone el issue que ya se crea.** `gate:plan` es lo que hace que `ct-next` lance el
   vigilante y que el agente pare a esperar.

**Consecuencia: `--issue N`, `--no-launch`, `--emit json` y el sobre no hacen falta todavía.** Se
quedan para el día que el front quiera el terminal dentro de su ventana en lugar de en cmux.

## 3. La sesión del plan es la sesión de la implementación

Es la misma ventana y el mismo worktree: el agente escribió el plan y está parado ahí dentro esperando
la línea que lo empuja. De ahí dos límites que el endpoint tiene que respetar:

- **Si la ventana se cierra, el go no tiene destinatario.** El vigilante se apaga con exit 4 en cuanto
  cmux le contesta que la sesión no está (`ct-watch-go.mjs:271-274`). El comentario quedaría en el
  issue —`--release` lo honraría después— pero nadie empujaría a nadie.
- **El vigilante caduca a las 8 horas** (`:78`). Agotado, sale con exit 3 y la sesión se queda parada
  en el gate para siempre.

**Decisión: el endpoint no comprueba ninguna de las dos cosas, y la limitación se asume.** El go se
publica siempre; si la ventana ya no está o el vigilante caducó, el comentario queda en el issue sin
empujar a nadie, y quien lo nota es el humano, porque el plan no avanza en el front. Comprobarlo
costaría un puerto, un adaptador y el recorrido de cmux con su guarda de esquema, y lo único que
compraría es un mensaje de error más honesto en un caso que en el piloto —una sesión recién abierta,
un slice a la vez— es raro. Queda apuntado en §6 como la primera deuda a cobrar.

## 4. El contrato

### 4.1 La petición

Los mismos dos campos que `/start-plan`, con la misma validación: `PlanRequest` y `PlanRefusal` se
reutilizan tal cual, porque es la misma pregunta —qué ticket, en qué repositorio— y una segunda copia
de esa validación sería la misma decisión escrita dos veces.

```
POST /implement-plan
Content-Type: application/json

{ "id": "MO_SHOP-42", "repo": "owner/name" }
```

### 4.2 Las respuestas

| Código | Cuándo | Cuerpo |
|---|---|---|
| 202 | El go está publicado | `{ "status": "implementing", "id", "issue", "worktree" }` |
| 404 | No hay despacho para ese ticket: nunca se llamó a `/start-plan`, o el backend se reinició | `{ "error": … }` |
| 503 | `gh` no pudo publicar el comentario | `{ "error": … }` |
| 400/413/415/405 | Lo que ya rechaza `/start-plan`, por las mismas reglas | `{ "error": … }` |

**No se devuelve el título de la sesión de cmux, porque el backend no lo tiene.** `ct-next` lo calcula
(`dispatch.js#cmuxSessionName`) y lo usa para nombrar la ventana, pero **no lo imprime**: de su stdout
solo salen el número del issue y el worktree (`lanzado #<n> en <ruta>`) y el nonce. Componerlo por
nuestra cuenta exigiría reconstruir el nombre de la slice con las reglas de `mapGhIssue`, que es la
copia que el propio plugin documenta como la que rompe la entrega del go cuando difiere en un espacio.
El worktree es el dato que sí viaja y sirve para lo mismo: decirle a una persona dónde mirar.

## 5. Las piezas

### 5.1 Dominio

- **`PlanDispatch`** — value object congelado con lo que el despacho produjo: `issue` (número),
  `worktree` (la ruta) y `go` (el nonce). Es lo que las dos llamadas comparten.
- **`Dispatches`** (puerto) — `remember(ticket, repository, dispatch)` y `of(ticket, repository)`.
- **`PlanGate`** (puerto) — `open({ dispatch, repository })`.
- **Excepciones**: `PlanNotDispatched` (404) y `PlanGateNotOpened` (503), bajo el `PlanSessionFailure`
  que ya existe.

### 5.2 Aplicación

`ImplementPlan`, en `application/actions/implement-plan.js`, con sus `Params` y `Result` congelados en
el mismo módulo:

1. pregunta a `dispatches` por el despacho del ticket — sin él, `PlanNotDispatched`;
2. pide a `gate` que lo abra;
3. devuelve el issue y el worktree.

Llamarlo dos veces publica dos comentarios `-OK` idénticos y no rompe nada: el vigilante consume el
primero que ve y se apaga con exit 0, y `--release` sigue encontrando un go válido. No se añade
idempotencia que nadie ha pedido.

### 5.3 Infraestructura

- **`CtNextPlanSession`** — el adaptador nuevo de `PlanSession`, que sustituye el `echo` de
  `CmuxPlanSession`. Invoca `node plugin/scripts/ct-next.mjs --repo <repo> --cap 1` por `ToolRunner`,
  y de su stdout saca el `PlanDispatch`.
- **`CtNextOutput`** — el modelo de frontera que lee ese stdout. Es lo único frágil del diseño (prosa
  castellana de otro programa), y se paga con un **test de contrato que importa `goDictationLine` de
  `plugin/scripts/go-channel.js`** y mide el parser contra la línea que el plugin produce de verdad.
  Una copia inevitable de las dos mitades de un contrato se declara y se mide; lo que no vale es
  dejarla implícita.
- **`GhPlanGate`** — adaptador de `PlanGate`. `gh issue comment <n> --repo <r> --body <goBody(nonce)>`
  por el `GhCall` que ya reintenta, con `goBody` importado de `plugin/scripts/go-response.js` para que
  el cuerpo que se publica y el que el matcher reconoce no puedan divergir en un espacio. El
  comentario **no es seguro de repetir** (`safeToRepeat: false`): un go publicado dos veces no rompe
  nada, pero la regla de esa política ya está escrita y aquí no hay motivo para relajarla.
- **`InMemoryDispatches`** — adaptador de `Dispatches`. Un `Map` en el proceso.
- **`ImplementPlanRoute`** en `api-server.js`, gemela de `StartPlanRoute`.

## 6. Las deudas, declaradas

1. **Nadie comprueba que la sesión siga viva** (§3). Un go publicado sobre una ventana cerrada o un
   vigilante caducado no empuja nada, y el backend responde 202 igualmente. Cobrarla pide dos cosas:
   un puerto `Sessions` con un adaptador que importe `findWorkspaceByTitle` de
   `plugin/scripts/cmux.js` —nunca recorriendo cmux por cuenta propia: ese fichero existe porque el
   recorrido vivía en tres sitios y solo uno tenía la guarda de esquema— con un vocabulario cerrado de
   **tres** miembros (está, no está, no se pudo saber), porque perder el tercero hace que un vigilante
   acuse en falso; y **el título de la sesión, que hoy `ct-next` no imprime** (§4.2), o sea una línea
   más en su stdout.
2. **`ct-next` elige el issue él**: no acepta `--issue N`. `/start-plan` lo mitiga en este orden —crea
   el issue, corre `ct-next --dry-run`, comprueba que el issue que piensa despachar es el que acaba de
   crear y solo entonces lo lanza de verdad; si no coincide, no lanza nada y rechaza. Queda una carrera
   entre las dos invocaciones, benigna con un slice en vuelo (`--cap 1`, y el piloto es de uno en uno).
   La salida limpia es `--issue N`, segunda iteración.
3. **El nonce vive en memoria.** Si el backend se reinicia entre las dos llamadas, el despacho se
   pierde y `/implement-plan` responde 404. El remedio manual existe: `ct-go.mjs` acuña uno nuevo.
4. **El backend tiene que correr dentro del checkout gobernado.** `ct-next` verifica el remote `origin`
   y aborta si no cuadra con `--repo`. Ese rechazo lo sufre **`/start-plan`**, no este endpoint, y sale
   por el 503 que ya tiene, con el motivo de `ct-next` en prosa. No se añade configuración de rutas: es
   lo que `CmuxPlanSession` ya asumía con `cwd: process.cwd()`.

## 7. Lo que queda fuera

El sobre y sus flags; comprobar la sesión; sostener el pseudo-terminal desde el backend; persistir el
nonce en disco; empujar la sesión cuando el vigilante ya murió; y cualquier cambio en `plugin/`.
