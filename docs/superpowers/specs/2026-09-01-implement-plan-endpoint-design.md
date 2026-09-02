# El endpoint que implementa el plan — una línea a la sesión, y manda ct-step

**Fecha:** 2026-09-01 (reescrito el 2026-09-02 sobre el coordinador determinista)
**Alcance:** el endpoint que reanuda al agente parado en el gate del plan
**Vara:** `backend/conventions/` entera, más `plugin/conventions/style.md`, `defects.md` y `decisions.md`

---

## 1. Qué cambió, y por qué este diseño se reescribió entero

La primera versión de este documento daba por hecho que el backend despacharía llamando a
`ct-next.mjs` y que el permiso del gate viajaría como el nonce que ese programa imprime. La rama del
**coordinador determinista** (merge `ce0d615`) tomó el camino contrario y ya está en `main`: el backend
hace el despacho él mismo, y **no hay nonce en ninguna parte**.

Lo que `POST /start-plan` hace hoy, verificado en el código:

1. `acli` → la historia de usuario; `gh` → el issue con `gate:plan` y `status:ready`.
2. `git-workspace.prepare` → el worktree cortado de `origin/<base>`, con `.agent/SLICE.md` sembrado por
   el propio `renderState` del plugin y su exclusión escrita donde git la lee.
3. `CmuxPlanAgents.launch` → escribe un launcher, abre la pestaña de cmux, teclea la orden y
   **verifica el efecto con el centinela**, reenviando la línea si el shell se la comió.
4. Responde `202 { status, id, repo, issue: { number, url }, agent }`, donde `agent` es el handle de la
   pestaña, y recuerda un `PlanWatch`.
5. `GET /plan-events/:issue` emite `writing` → `ready` cuando `dispatch-check --check-plan` da 0 **y** el
   plan está commiteado.

Y el encargo (`PlanAgentBrief.errandFor`) termina: *«Y entonces PARA. No implementes nada, no abras
pull request, no mergees, no crees worktrees nuevos.»*

**Consecuencia para este endpoint: el agente no espera un permiso en GitHub, espera una línea en su
terminal.** No hay vigilante sondeando el issue, así que un comentario `-OK` no movería a nadie.
Contestar el GO en el issue queda fuera de este diseño, y con él el nonce, el value object que lo
llevaba y el método que lo publicaba.

## 2. La tesis: mantener el flujo del plugin no cuesta nada

`ct-step` es el tramo interno de una slice en el plugin —`next` → implementador con TDD → `report` →
`controls` medidos por programa → juez adversarial sin `Bash` → `verdict` → `commit`, tarea a tarea, con
el sitio en `.agent/run-<issue>.json`— y **corre tal cual sobre lo que el backend ya prepara**. Sus
precondiciones son tres (`plugin/scripts/ct-step.mjs:176-192`):

| Lo que exige | Quién lo puso ya |
|---|---|
| Estar dentro de un repositorio git | El worktree de `git-workspace` |
| **`.agent/SLICE.md`** — su único portazo: «esto no es el worktree de un slice» | La semilla de `git-workspace` |
| Un plan **ejecutable** y **commiteado** | El encargo del plan, medido por `dispatch-check --check-plan` |

No pide claim, ni labels, ni nonce, ni que nadie haya pasado por `ct-next`. Así que reanudar al agente
diciéndole que obedezca a `ct-step` **no añade ni un programa que el backend tenga que invocar**: la
secuencia entera la decide `run-machine.js` dentro de esa sesión.

El único punto donde el flujo del plugin topa con el permiso que aquí no existe es
`dispatch-check --release`, que se niega sin un go registrado (exit 9). Queda fuera: este endpoint
entrega la implementación, no el pull request.

## 3. El contrato

### 3.1 La petición

```
POST /implement-plan
Content-Type: application/json

{ "id": "XOP-4909", "repo": "jjponz/repo-pulse", "issue": 33 }
```

Los tres los tiene el front sin guardar nada nuevo: `id` y `repo` son los que envió a `/start-plan`, y
`issue` el que esa respuesta le devolvió. **El backend no recuerda el despacho**, y no puede: el
registro de sesiones olvida el `watch` en cuanto emite el desenlace, o sea justo cuando el plan está
`ready` y una persona pulsa el botón.

`id` y `repo` se validan con los value objects que ya existen. `issue` se valida en el modelo de
petición del controlador, como ya hace `EventsRequest` con el número que llega en su ruta; no gana un
value object porque no hay una segunda pregunta que hacerle.

**No se comprueba que el plan esté listo.** El front habilita su botón con el `ready` del canal de
eventos, y volver a medir lo que el propio flujo ya garantiza es complejidad sin problema que resolver.

### 3.2 Las respuestas

| Código | Cuándo |
|---|---|
| 202 | La línea está entregada: `{ "status": "implementing", "id", "repo", "issue" }` |
| 400 | Cuerpo que no es objeto JSON, campo desconocido, o `id` / `repo` / `issue` malformados |
| 413 | Cuerpo de más de 8192 bytes |
| 503 | `cmux` se negó a escribir en la pestaña; reintentar puede funcionar |
| 405 | Cualquier método que no sea `POST` |

**No hay 502**: de `cmux send` no se lee nada, se comprueba su código de salida. Sin contrato de
lectura no hay contrato que romper, y por eso la familia de fallos de esta operación tiene **una sola
causa** donde las otras del backend tienen dos. Se declara aquí para que no se lea como una familia a
medio escribir.

**Un 202 no promete que el agente haya obedecido**, solo que los dos comandos devolvieron 0. Es la
misma honestidad que el vigilante del plugin se impone: no hay centinela para el reanudado, y afirmar
más sería afirmar lo que no se midió. Quien lo nota es el humano, mirando la pestaña.

## 4. Las piezas

Ninguna es un tipo nuevo del dominio: la operación cae entera en colaboradores que ya existen.

- **`PlanAgents` gana `resume({ story, issue, repository })`.** Un puerto corta por quién está
  enfrente, nunca por paso del flujo (`backend/conventions/domain.md`), y enfrente sigue estando
  quien planifica. El puerto que lo lanzó es el que lo reanuda.
- **`PlanAgentBrief` gana el segundo encargo** y una tercera ruta absoluta en su constructor
  (`ctStep`), que `PluginTree` resuelve al lado del `dispatchCheck` que ya resuelve. El encargo lo
  compone quien lanza al agente y no el caso de uso — decisión ya tomada en `ce63453`.
- **`CmuxPlanAgents.resume`** manda el encargo con `sendArgvFor` y `enterArgvFor`, **que ya existen**
  porque el reenvío del arranque los usa, sobre el nombre que compone `nameFor(story)` — la misma
  función que nombró la pestaña al crearla, así que no hay segunda copia que divergir.
- **`ImplementPlan`** en `application/actions/`, con su `Params`. Un puerto, un paso, sin `Result`.
- **`implement-plan-route.js`**, con su modelo de petición, su vocabulario cerrado y sus proyecciones,
  más una línea de montaje en `api-server.js`.

### 4.1 El encargo cabe en una línea, y no es un gusto

`cmux send` teclea lo que reciba y `send-key Enter` lo ejecuta: un salto de línea dentro del texto
ejecutaría la orden a medias. El vigilante del plugin manda una sola línea por este motivo exacto
(`ct-watch-go.mjs:159`), y este encargo hace lo mismo — a diferencia del encargo del plan, que viaja
como argumento de `claude` y puede tener nueve líneas.

Dice tres cosas: que el gate del plan quedó cerrado por una persona, que la conducción es de
`ct-step next --plan <el plan que commiteó> --issue <n>` y que obedezca hasta que el run quede
entregado, y que **pare ahí**: sin pull request, sin merge, sin worktrees nuevos.

## 5. Las deudas, declaradas

1. **Nadie comprueba que la pestaña siga viva.** Si se cerró, los dos comandos fallan y el 503 lo
   dice, que es el caso fácil; si la pestaña vive pero el agente murió dentro, la línea se escribe en
   un shell y el 202 miente. Cobrarlo pide el recorrido de cmux con su guarda de esquema
   (`plugin/scripts/cmux.js#findWorkspaceByTitle`) y un vocabulario de tres miembros: está, no está, no
   se pudo saber.
2. **El pull request no lo abre nadie.** El encargo para al entregar el run, porque `--release` exige
   un go que este flujo no acuña. Cerrarlo es la decisión de si el segundo permiso humano vive en un
   botón o en el merge de GitHub, y no es de este endpoint.
3. **El residuo del 413.** `api-server.js` sigue proyectando el cuerpo demasiado grande con el
   vocabulario de `start-plan-route.js` (`PlanRefusal.of(PlanRequest.tooLarge())`), así que la última
   red del servidor conoce el modelo de petición de un endpoint concreto — con tres endpoints
   montados, ya son dos los que no son suyos. `Refusal` ya bajó a `http.js`; esto es lo que quedó.

## 6. Lo que queda fuera

Contestar el GO en el issue y el nonce entero; `ct-next` y su sobre; comprobar la pestaña; el pull
request y `--release`; y cualquier cambio en `plugin/`.
