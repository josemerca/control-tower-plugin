# El endpoint que implementa el plan — el front da el go, el plugin hace el resto

**Fecha:** 2026-09-01 (revisado el 2026-09-02 sobre `main`)
**Alcance:** primera iteración, un slice a la vez, sin tocar `plugin/`
**Vara:** `backend/conventions/` entera, más `plugin/conventions/style.md`, `defects.md` y `decisions.md`

---

## 1. Qué se decide

`POST /start-plan` ya lee la historia de usuario con `acli`, crea el issue de GitHub con la forma que
le da el `groom.js` del plugin y devuelve `{ issue, agent }`. Lo que todavía no hace de verdad es
lanzar al agente: `CmuxPlanAgents` abre una pestaña de cmux con un `echo`. Este diseño rellena ese
hueco y añade el endpoint siguiente:

| Endpoint | Qué hace | Quién decide |
|---|---|---|
| `POST /start-plan` | Crea el issue y **despacha con `ct-next`**: worktree, rama, cmux, `claude`. El agente escribe el plan prescriptivo, lo publica en el issue y **para** | Nadie |
| `POST /implement-plan` | Contesta el GO en el issue. El vigilante que `ct-next` dejó sondeando empuja la sesión, y la implementación corre hasta el pull request | **El humano, en el front** |

El front es la coordinadora: no hay sesión de agente que coordine nada.

## 2. La tesis: el plugin ya hace el trabajo

Tres piezas del plugin, verificadas en el código, hacen gratis lo que el diseño de fusión
(`2026-08-31-fusion-con-app-companion-design.md`, §3.1 y §6.1) planeaba construir:

1. **`ct-next` imprime el nonce por stdout.** `go-channel.js:39` emite `GO de #N: contesta exactamente
   \`-OK <nonce>\` en un comentario del issue.` Ese canal existe para que lo lea una persona en su
   terminal; cuando quien invoca `ct-next` es este backend, el nonce lo captura un proceso y **no entra
   en el contexto de ningún agente**. Es lo que §6.1.3 quería comprar moviendo el sorteo del nonce, y
   sale sin mover nada.
2. **El vigilante del go cierra el ciclo solo.** `ct-watch-go.mjs` sondea el issue cada 30 s y, al ver
   el comentario, teclea él la línea en la sesión de cmux (`:214`). El backend **no sostiene ningún
   pseudo-terminal**: el terminal sigue siendo cmux.
3. **El gate lo pone el issue que ya se crea.** Las labels `gate:` que escribe `PlanIssueBody.labels`
   son lo que hace que `ct-next` lance el vigilante y que el agente pare a esperar.

**Consecuencia: `--issue N`, `--no-launch`, `--emit json` y el sobre no hacen falta todavía.** Se
quedan para el día que el front quiera el terminal dentro de su ventana en lugar de en cmux.

## 3. El backend no guarda nada: el front devuelve lo que se le dio

`/start-plan` ya le entrega al front el issue que creó. Con el nonce en esa misma respuesta, el front
puede devolver los dos en `/implement-plan`, y entonces **el backend no necesita recordar ningún
despacho entre las dos llamadas**: ni registro en memoria, ni puerto para guardarlo, ni un 404 cuando
el proceso se reinicia. Los dos endpoints quedan sin estado.

Eso cambia lo que `/start-plan` contesta. Donde hoy devuelve `agent` —el handle que le daba cmux, que
con `ct-next` ya no existe— devuelve el nonce del despacho:

```json
{ "status": "started", "id": "MO_SHOP-42", "repo": "owner/name",
  "issue": { "number": 7, "url": "https://github.com/owner/name/issues/7" },
  "go": "a1b2c3d4" }
```

El worktree no viaja: `ct-next` lo imprime, pero nadie lo consume todavía y un campo que nadie lee es
un campo que hay que mantener.

Que el nonce viaje al front es coherente con el modelo, no una excepción a él: §5.1 del diseño de
fusión ya decía que la coordinadora **se queda el nonce en su proceso**, y la coordinadora es el front.
Lo que la barandilla protege es que el nonce no pase por el contexto del **agente implementador**, que
es quien tiene `gh` en su worktree y el incentivo para autorizarse; el front no es un agente. Y no se
abre una puerta nueva: el servidor solo admite un `Origin` cuando es la página que él mismo sirve,
avalada por un `Host` de loopback (`backend/conventions/infrastructure.md`).

## 4. El contrato

### 4.1 La petición

```
POST /implement-plan
Content-Type: application/json

{ "repo": "owner/name", "issue": 7, "go": "a1b2c3d4" }
```

Los tres campos se validan antes de llegar al caso de uso, y los tres por el mismo motivo: acaban
dentro de un argv de `gh`. `repo` ya tiene su value object (`RepositoryName`); `issue` y `go` son el
value object nuevo de §5.1.

### 4.2 Las respuestas

| Código | Cuándo |
|---|---|
| 202 | El GO está contestado: `{ "status": "implementing", "repo", "issue" }` |
| 400 | Cuerpo que no es un objeto JSON, campo desconocido, o `repo` / `issue` / `go` malformados |
| 413 | Cuerpo de más de 8192 bytes |
| 503 | `gh` se negó a comentar; reintentar puede funcionar |
| 405 | Cualquier método que no sea `POST` |

**No hay 502 en este endpoint**, y es una decisión, no un olvido: 502 significa «la herramienta
contestó algo que no sabemos leer», y de `gh issue comment` no se lee nada — se comprueba su código de
salida y se descarta su salida. Sin contrato de lectura no hay contrato que romper. Por el mismo
motivo la familia de excepciones del GO tiene **una sola causa** donde las otras tres del backend
tienen dos (`backend/conventions/domain.md`), y eso se declara aquí para que no se lea como una
familia a medio escribir.

**Tampoco se devuelve el título de la sesión de cmux, porque el backend no lo tiene.** `ct-next` lo
calcula (`dispatch.js#cmuxSessionName`) y nombra la ventana con él, pero **no lo imprime**: de su
stdout solo salen el número del issue, el worktree (`lanzado #<n> en <ruta>`) y el nonce. Componerlo
por nuestra cuenta exigiría reconstruir el nombre de la slice con las reglas de `mapGhIssue`, que es
la copia que el propio plugin documenta como la que rompe la entrega del go cuando difiere en un
espacio.

## 5. Las piezas

### 5.1 Dominio

- **`Go`** — value object nuevo, en `domain/value-objects/go.js`: el issue donde se contesta y el
  nonce que lo cierra, con sus dos guardas (un issue numerado desde uno, un nonce de ocho hex). Es el
  término que el glosario ya tiene —*el `-OK <nonce>` del humano en el issue que libera al agente*— y
  se gana su módulo porque lo construyen dos sitios (la ruta al recibirlo, el adaptador de `ct-next`
  al leer el stdout) y lo consume un tercero.
- **`PlanIssues` gana un método**, no aparece un puerto nuevo: `answerGo({ go, repository })`. El
  colaborador al otro lado sigue siendo el mismo —los issues de GitHub—, y `domain.md` lo dice con
  esas palabras: un puerto corta por quién está enfrente, nunca por paso del flujo.
- **`PlanAgents.launch` devuelve `Go`** en lugar del handle de cmux. Lo que el dominio necesita saber
  de un agente lanzado es con qué permiso queda pendiente, y el handle era el nombre que le daba cmux
  — el defecto que `domain.md` documenta haber tenido que renombrar ya dos veces.
- **`GoNotAnswered`**, bajo una `GoFailure` que cuelga de `PlanFailure`.

### 5.2 Aplicación

`ImplementPlan`, en `application/actions/implement-plan.js`, con sus `Params` y `Result` congelados en
el mismo módulo: recibe el `Go` y el `RepositoryName`, se lo pasa a `planIssues.answerGo` y devuelve
lo que el front necesita para pintar el resultado. Un solo puerto y un solo paso.

Llamarlo dos veces publica dos comentarios idénticos y no rompe nada: el vigilante consume el primero
que ve y se apaga con exit 0, y `--release` sigue encontrando un go válido. No se añade idempotencia
que nadie ha pedido.

### 5.3 Infraestructura

- **`ct-next-plan-agents.js`** — el adaptador nuevo de `PlanAgents`, que sustituye a
  `cmux-plan-agents.js`. Invoca `node plugin/scripts/ct-next.mjs --repo <repo> --cap 1` por el tronco
  de `ExternalTool`, y de su stdout compone el `Go`. El modelo de frontera que lee ese stdout vive en
  su fichero mientras sea su único consumidor, como el sobre de `acli` vive en `acli-user-stories.js`.
- **El parseo de ese stdout es la única copia frágil del diseño**, y se paga como manda
  `decisions.md`: **un test de contrato que importa `goDictationLine` de `plugin/scripts/go-channel.js`
  y compara el parser contra la línea que el plugin produce de verdad.** Reescribir las dos mitades
  pasa; tocar una falla.
- **`GhPlanIssues` gana `answerGo`**: `gh issue comment <n> --repo <r> --body <goBody(nonce)>`, con
  `goBody` importado de `plugin/scripts/go-response.js` para que el cuerpo que se publica y el que el
  matcher reconoce no puedan divergir en un espacio. Declarado **no seguro de repetir**
  (`safeToRepeat: false`): es una escritura.
- **`implement-plan-route.js`** — un controlador por endpoint, con su modelo de petición, su
  vocabulario cerrado de desenlaces y sus proyecciones a HTTP dentro, y una línea de montaje en
  `api-server.js`.
- **`Refusal` se muda de `start-plan-route.js` a `http.js`.** Es literalmente «lo que todo endpoint
  repetiría» y hoy vive dentro de un controlador; con el segundo endpoint, importarla de ahí ataría
  los dos controladores entre sí. Lo demás que se parezca entre los dos modelos de petición —los
  desenlaces del cuerpo y sus mensajes— **se queda duplicado a propósito**: es idioma de frontera y no
  una decisión de negocio, así que le aplica la regla de tres y todavía no toca
  (`plugin/conventions/decisions.md`).

## 6. Las deudas, declaradas

1. **Nadie comprueba que la sesión siga viva.** El agente que escribió el plan está parado dentro de
   la ventana de cmux esperando la línea que lo empuja, y hay dos formas de que esa línea no llegue:
   si la ventana se cerró, el vigilante ya se apagó con exit 4 (`ct-watch-go.mjs:271-274`); si pasaron
   más de ocho horas, con exit 3 (`:78`). En los dos casos el GO se publica, el backend responde 202 y
   no empuja a nadie; quien lo nota es el humano, porque el plan no avanza. Cobrarla pide un puerto
   nuevo con un adaptador que importe `findWorkspaceByTitle` de `plugin/scripts/cmux.js` —nunca
   recorriendo cmux por cuenta propia: ese fichero existe porque el recorrido vivía en tres sitios y
   solo uno tenía la guarda de esquema— con un vocabulario cerrado de **tres** miembros (está, no
   está, no se pudo saber), y **el título de la sesión, que hoy `ct-next` no imprime** (§4.2).
2. **`ct-next` elige el issue él**: no acepta `--issue N`. `/start-plan` lo mitiga en este orden —crea
   el issue, corre `ct-next --dry-run`, comprueba que el issue que piensa despachar es el que acaba de
   crear, y solo entonces lo lanza de verdad; si no coincide, no lanza nada y falla con el motivo en
   prosa. Queda una carrera entre las dos invocaciones, benigna con un slice en vuelo (`--cap 1`, y el
   piloto es de uno en uno). La salida limpia es `--issue N`, segunda iteración.
3. **El backend tiene que correr dentro del checkout gobernado.** `ct-next` verifica el remote `origin`
   y aborta si no cuadra con `--repo`. Ese rechazo lo sufre `/start-plan`, no este endpoint, y sale por
   su 503 con el motivo de `ct-next` en prosa. No se añade configuración de rutas: es lo que
   `CmuxPlanAgents` ya asumía con `cwd: process.cwd()`.

## 7. Lo que queda fuera

El sobre y sus flags; comprobar la sesión; sostener el pseudo-terminal desde el backend; empujar la
sesión cuando el vigilante ya murió; y cualquier cambio en `plugin/`.
