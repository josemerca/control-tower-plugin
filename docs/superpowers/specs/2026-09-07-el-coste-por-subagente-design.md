# El coste real por subagente — qué exporta de verdad Claude Code, y dónde está el enganche

**Fecha:** 2026-09-07
**Repo:** `josemerca/control-tower-plugin`
**Issue:** #110, que continúa #92 (los bytes del material fijo) y apunta a F38
**Estado:** investigación cerrada con medida; **una decisión de arquitectura sin tomar** (§7)
**Alcance:** ningún código. Este documento sustituye una suposición por una medida y deja la decisión donde estaba.

> **Nota de publicación.** Este repositorio es público. El endpoint del colector
> que la organización impone por managed settings remotos aparecía aquí literal
> y se ha **redactado**: el hecho de que exista esa política es parte del
> hallazgo, la dirección concreta de una máquina interna no. Quien necesite el
> valor lo tiene en su propio log de depuración, con
> `CLAUDE_CODE_ENABLE_TELEMETRY=1` y el flag de trazas a consola.

---

## 0. Cómo se ha medido, para que se pueda repetir

Todo lo que aquí se marca **verificado** sale de una de estas dos fuentes, sobre
la versión instalada `2.1.261` (`claude --version`; binario Mach-O arm64 en
`~/.local/share/claude/versions/2.1.261`, `GIT_SHA 1349cf9c`,
`BUILD_TIME 2026-09-04T16:49:50Z`):

1. **Las cadenas del binario.** `strings -a` sobre el ejecutable devuelve el
   bundle JavaScript legible: los nombres de las métricas, las funciones que las
   emiten y las que componen sus atributos. Se cita la función por su nombre
   minificado, que es lo que hay.
2. **Tres corridas reales** de `claude -p` con exportadores de consola
   (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_TRACES_EXPORTER=console`,
   `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`), una de ellas despachando un
   subagente con la herramienta `Task`. La telemetría impresa se pega abajo
   recortada.

Lo que se marca **inferido** es lectura de código sin corrida que lo confirme, y
se dice cada vez.

No se ha montado ningún colector, no se ha añadido ninguna dependencia y no se
ha tocado la configuración del usuario en `~/.claude`.

---

## 1. La conclusión, primero

La issue #110 daba por hecho que la dimensión que falta viaja en la métrica de
tokens. **No viaja.** Pero la conclusión práctica es mejor que la de la issue, no
peor: para atribuir tokens a un subagente **no hace falta ningún colector**,
porque Claude Code ya escribe el `agent_id` y el consumo de cada subagente en
disco, en el propio proyecto del usuario.

| pregunta de la issue | respuesta medida |
|---|---|
| ¿`claude_code.token.usage` viaja con `agent_id`? | **No.** Sus atributos son otros (§2.1) |
| ¿algo lleva `agent_id`? | **Sí**, el *span* `claude_code.llm_request`, tras un flag beta (§2.3) |
| ¿algo lleva el dinero? | **Sí**, el evento de log `claude_code.api_request` — y **no** lleva `agent_id` (§2.2) |
| ¿puede `ct-step` conocer el `agent_id` del subagente que despacha? | **No** (§4) |
| ¿hay algún enganche determinista? | **Sí, dos**, y ninguno es `ct-step` (§4.2, §4.3) |

---

## 2. Qué exporta de verdad la 2.1.261

Son **tres canales distintos**, con tres puertas distintas y tres contenidos
distintos. Mezclarlos es de donde salió la suposición de la issue.

### 2.1 Métricas — no llevan `agent_id`, y para un plugin de terceros tampoco llevan quién

Las diez métricas que declara el binario (verificado, cadenas literales):

```
claude_code.session.count      claude_code.cost.usage
claude_code.lines_of_code.count claude_code.token.usage
claude_code.pull_request.count  claude_code.code_edit_tool.decision
claude_code.commit.count        claude_code.active_time.total
```

`claude_code.cost.usage` **sí existe y sí lleva dinero**. Las dos, coste y
tokens, se emiten en la misma función (`Y9`) y con **el mismo objeto de
atributos**:

```js
N = { model, ...speed, ...query_source, ...effort, ...R4(o, lE(...)) }
yDn()?.add(e, N)                                   // claude_code.cost.usage (USD)
grt()?.add(t.input_tokens,  {...N, type:"input"})  // claude_code.token.usage
grt()?.add(t.output_tokens, {...N, type:"output"}) // ídem, y cacheRead / cacheCreation
```

Ahí no hay `agent_id` por ningún lado. Lo único que se acerca es `R4`, que compone
la **atribución por nombre**:

```js
function R4(e,t){ ... return { ...r&&{"agent.name":r}, ...o&&{"skill.name":o},
  ...d&&{"plugin.name":d}, ...E&&{"marketplace.name":E}, ... } }
```

Y esa atribución **se redacta para lo que no es de primera parte**. En `REr`, el
nombre del agente sólo sobrevive si viene de `agent:builtin:` o si su plugin está
en la lista de plugins de primera parte; si no, se sustituye por una constante:

```js
var xMt = "custom", $S = "third-party", iye = "custom";
// ...
if (r !== undefined) if (e?.startsWith("agent:builtin:")) I.attributionAgent = r;
else { let D = d !== undefined && E.has(d); I.attributionAgent = D ? r : xMt }
```

Consecuencia para este repo, que es lo que importa: las llamadas de `ct-judge`,
`ct-slice-judge`, `ct-reconciler` y del implementador **no se distinguen entre sí
en las métricas**. Todas salen con `agent.name: "custom"` y `plugin.name:
"third-party"`. No es que falte el `agent_id`: es que falta hasta el papel.

Verificado por lectura del binario; **no** confirmado con una corrida, porque en
esta máquina las métricas no se pueden desviar a consola (§5.1).

### 2.2 Eventos de log — llevan el dinero, no llevan el agente

El evento `claude_code.api_request` es el único sitio de toda la telemetría
donde el dinero viaja por llamada (verificado, cadena literal del binario):

```js
bo("api_request", { model, input_tokens, output_tokens, cache_read_tokens,
  cache_creation_tokens, cost_usd: Cn, cost_usd_micros: Math.round(Cn*1e6),
  duration_ms, request_id, client_request_id, speed, query_source,
  ...effort && {effort}, ...Dn && R4(V, Dn) }, gn)
```

El tercer argumento `gn` es el `agentContext` del subagente — pero el compositor
de eventos sólo saca de él el flujo de trabajo, nada del agente:

```js
function WQe(e){ if(!e||!KC(e)||!e.workflowRunId) return {};
  return { "workflow.run_id": e.workflowRunId, ...e.workflowName&&{"workflow.name":e.workflowName} } }
```

Los atributos comunes que sí lleva todo evento (función `LAe`) son
`user.id`, `session.id`, `organization.id`, `app.version`, `terminal.type` y las
`OTEL_RESOURCE_ATTRIBUTES` — la misma `session.id` para el hilo principal y para
todos sus subagentes, que es exactamente el motivo por el que la columna
`session` se retiró de `run-metrics.js` y no un motivo nuevo.

Un cabo suelto que sí es útil: cada evento se emite **con el contexto de traza
activo** (`let d = G(); ... {...d && {context:d}}`), y el binario documenta
`prompt.id` como clave de unión explícita: «*Same value emitted on OpenTelemetry
events as the `prompt.id` attribute, so hook output can be joined to OTel events
at prompt grain*». Es decir: si además se exportan trazas, un colector podría
unir el dinero del evento con el `agent_id` del span por `trace_id`/`span_id`.
**Inferido** — no se ha comprobado que el span activo en el instante del evento
sea el `llm_request` de esa misma llamada.

### 2.3 Trazas — aquí sí está `agent_id`, y aquí no está el dinero

Verificado con corrida. Ejecutando un `claude -p` que despacha un subagente
`general-purpose`, el span de la llamada del subagente sale así (recortado):

```
name: "claude_code.llm_request"
attributes: {
  "session.id": "1c5a19ea-86ec-447f-93e2-2bdcda29ddc5",
  "span.type": "llm_request", model: "claude-haiku-4-5-20251001",
  "llm_request.context": "tool",
  agent_id: "abdeeb75153bc9ee9",
  duration_ms: 1391, input_tokens: 10, output_tokens: 52,
  cache_read_tokens: 0, cache_creation_tokens: 22271,
  request_id: "req_011Ceop2j9cgRuPEw4Pa2R2Z", ttft_ms: 921, ...
}
```

Los `llm_request` del hilo principal, en la misma corrida, **no traen
`agent_id`**: el atributo sólo se pone cuando hay contexto de subagente
(`if (t.agentId) D.setAttribute("agent_id", t.agentId)`), y `parent_agent_id`
sólo cuando el subagente cuelga de otro subagente.

Tres cosas que hay que decir de este canal:

1. **Está detrás de un flag beta.** La puerta es
   `KE() = jun() || rw()`, y `jun()` lee
   `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA` / `ENABLE_ENHANCED_TELEMETRY_BETA`.
   `rw()` es el camino interno de Anthropic (exige `BETA_TRACING_ENDPOINT` y un
   gate remoto). Sin ese flag no hay spans, y con él es una beta sin contrato de
   estabilidad.
2. **No lleva dinero.** Lleva tokens por tipo. El dinero hay que ponerlo (§6.1).
3. **`claude_code.subagent.spawn` no existe en la práctica.** El nombre está en
   el binario y su emisor también, pero empieza así:
   `function zIt(e){ if(!j9()) return; ... }` con `function j9(){ return !1 }`,
   una constante. En la 2.1.261 **ese span no se emite nunca**, y en la corrida
   con subagente no apareció, como esperaba la lectura. Quien lea la issue #110
   y vaya a buscarlo, que no lo busque.

El span `claude_code.tool` del despacho sí sale, y trae `tool_name: "Agent"`,
`subagent_type: "general-purpose"` y `tool_use_id`, pero **no** el `agent_id` del
subagente que va a nacer: el contexto de agente de ese span es el del hilo que
llama.

---

## 3. El hallazgo que cambia la pregunta: no hace falta colector para los tokens

En la misma corrida, Claude Code dejó esto en disco sin que nadie se lo pidiera:

```
~/.claude/projects/<slug-del-cwd>/<session-id>/subagents/
  agent-abdeeb75153bc9ee9.jsonl
  agent-abdeeb75153bc9ee9.meta.json
```

El nombre del fichero **es el `agent_id`**, el mismo que llevaba el span. El
`.meta.json` completo:

```json
{"agentType":"general-purpose","description":"Prueba simple de agent",
 "toolUseId":"toolu_01FXmF2iG3sFjy4LCRupx9Jr","spawnDepth":1}
```

Y cada línea del `jsonl` trae `agentId`, `promptId`, `sessionId`, y las
asistentes traen su `usage`, con **los mismos números que el span**:

```json
"usage":{"input_tokens":10,"cache_creation_input_tokens":22271,
         "cache_read_input_tokens":0,"output_tokens":52,
         "output_tokens_details":{"thinking_tokens":43}}
```

Verificado, las dos cifras cotejadas entre el span y el fichero.

Lo que este fichero **no** trae es dinero: se buscó `cost` y no hay ninguno.
Tokens sí, USD no.

De aquí sale la afirmación del §1: la atribución de **tokens** por subagente es
alcanzable hoy, sin colector, sin flag beta y sin red, leyendo un fichero que ya
existe. Lo que hace falta para convertirlo en dinero es un precio (§6.1), y eso
no lo da ninguna telemetría.

---

## 4. El enganche determinista: `ct-step` no puede, y hay que decirlo

### 4.1 Por qué no puede

`ct-step next` **imprime instrucciones**; no lanza nada. Quien invoca la
herramienta `Task` es la sesión coordinadora, y el `agent_id` lo asigna Claude
Code al crear el subagente, que es **después** de que `ct-step` haya terminado y
salido. Cuando el programa vuelve a correr (`ct-step report`, `ct-step verdict`)
lo hace en otro proceso, lanzado otra vez por la sesión y no por el subagente.

Se comprobaron las dos salidas posibles y las dos están cerradas:

- **Por entorno.** No existe ninguna variable que exponga el identificador del
  agente a un proceso hijo. La lista de variables que Claude Code inyecta
  contiene `CLAUDE_EFFORT`, `CLAUDE_SESSION_ID`, `CLAUDE_PID`, `TRACEPARENT` y
  `CLAUDE_CODE_INVOKED_SKILLS`; `CLAUDE_AGENT_ID` **no aparece en el binario**
  (cero coincidencias). Verificado.
- **Por el hook que ya hay.** `hooks/dispatch-guard.js` es un `PreToolUse` sobre
  `Task`, y corre **antes** del despacho: en ese instante el subagente todavía no
  existe. El campo `agent_id` de la entrada de un hook, dice el propio binario,
  «*Present only when the hook fires from within a subagent... Absent for the
  main thread*»: identifica al agente **desde el que** se dispara el hook, no al
  que se va a despachar. Verificado por documentación embebida; no medido.

**Así que no: `ct-step` no puede escribir el `agent_id` en la fila que ya
escribe.** Inventar ahí un mecanismo sería inventar un dato.

### 4.2 Lo que sí puede: un hook `SubagentStop`, hermano exacto del que ya existe

La 2.1.261 declara dos eventos de hook para subagentes (verificado, texto del
binario):

| evento | cuándo | entrada JSON |
|---|---|---|
| `SubagentStart` | al arrancar un subagente | `agent_id`, `agent_type` |
| `SubagentStop` | justo antes de que el subagente concluya | `agent_id`, `agent_type`, `agent_transcript_path` |

`SubagentStop` trae **las dos mitades a la vez**: el identificador y la ruta del
transcript del §3, que es donde están los tokens. Y el molde ya está escrito en
este repo: `hooks/dispatch-guard.js` localiza el run leyendo el único
`.agent/run-<issue>.json` del `cwd` que le llega en la entrada del hook, que es
exactamente lo que haría falta para saber a qué tarea, paso e intento pertenece
ese subagente.

Los contras, que no son cero:

- **Dispara para todos los subagentes**, no sólo para los del loop. Una sesión
  que despache algo por su cuenta dejaría una fila que no es del run.
- **La correspondencia con el intento es por estado, no por identidad.** El hook
  lee el paso e intento vigentes del run en el momento en que el subagente
  termina. Es determinista mientras no haya dos subagentes del loop en vuelo a la
  vez —hoy no los hay—, pero es una invariante nueva que nadie está midiendo.
- **Un hook más es tiempo en cada cierre de subagente**, y la única razón para
  aceptarlo es que sin él esta medida no existe.

### 4.3 La alternativa sin hook: leer el directorio al cerrar el paso

`ct-step` no sabe el `agent_id`, pero **sabe cuándo empezó y cuándo acabó el
paso**, y el directorio `subagents/` de la sesión está ordenado por tiempo de
modificación. Un `ct-step` que, al escribir la fila, mirase ese directorio podría
recoger el transcript del subagente que acaba de cerrarse.

Es la vía por tiempo que la issue llama frágil, y lo es: depende de conocer la
`session.id` de la coordinadora (que el programa hoy no conoce, §2.2) y de que no
haya despachos ajenos en la ventana. **Se descarta**, y se deja escrita para que
no se vuelva a proponer sin sus contras.

---

## 5. Dónde vive el colector — con un hallazgo que estrecha la pregunta

### 5.1 Ya hay uno, y no es de este proyecto

Al intentar volcar métricas y logs a consola para medirlos, la corrida los mandó
a otro sitio. El log de depuración, literal:

```
[3P telemetry] Waiting for remote managed settings fetch before telemetry init
[3P telemetry] Remote managed settings fetch settled, initializing telemetry
[3P telemetry] isTelemetryEnabled=true (CLAUDE_CODE_ENABLE_TELEMETRY=1)
[3P telemetry] getOtlpReaders: types=["otlp"], interval=60000, protocol=http/json,
               endpoint=https://<colector de la organización, redactado>
[3P telemetry] getOtlpLogExporters: types=["otlp"], ...
[3P telemetry] First logs export: SUCCESS
[3P telemetry] First metrics export: SUCCESS
```

Es decir: **la organización ya impone, por managed settings remotos, un colector
OTel corporativo**, y las métricas y los eventos de log de Claude Code ya viajan
ahí. No hay nada de eso en `~/.claude/settings.json` ni en
`/Library/Application Support/ClaudeCode/managed-settings.json`: llega de la
política remota de la cuenta. Verificado.

Tres consecuencias:

1. El `cost_usd` del §2.2 **ya se está exportando** hoy, para todas las llamadas,
   con `session.id` y sin `agent_id`.
2. Las **trazas** no van ahí: `OTEL_TRACES_EXPORTER` no lo impone la política, y
   es justo el canal que lleva el `agent_id`.
3. Cualquier variable `OTEL_*` que este proyecto ponga para métricas o logs
   compite con esa política y probablemente pierde. **Que este loop configure la
   telemetría global del usuario deja de ser una opción tranquila.**

### 5.2 Las opciones, con sus contras

| opción | qué da | contras |
|---|---|---|
| **A. Ningún colector.** El hook `SubagentStop` lee el transcript del §3 y `ct-step` escribe tokens por papel en la fila que ya escribe | tokens por subagente, por tarea y por intento; sin red, sin flag beta, sin dependencias | no da dinero sin una tabla de precios propia (§6.1); un hook nuevo (§4.2) |
| **B. El colector de empresa** (el colector de la organización) | `cost_usd` real por llamada, ya exportándose | no lleva `agent_id` ni el papel (`agent.name: "custom"`); no es de este proyecto, y consultarlo es un acceso que hoy el loop no tiene; agrega por `session.id`, que es la misma para todos los papeles |
| **C. Colector propio** (fichero o proceso local, con trazas activadas) | `agent_id` + tokens + posible unión con el dinero por `trace_id` (§2.2, inferido) | infraestructura nueva; exige el flag beta `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, sin contrato de estabilidad; y para métricas/logs choca con la política remota (§5.1) |

**Recomendación: A**, y B como control cruzado cuando alguien quiera comprobar
que la suma de los papeles cuadra con el gasto de la sesión. C sólo si algún día
se necesita el árbol `parent_agent_id` de subagentes anidados, que este loop hoy
no tiene.

---

## 6. Qué haría falta para cerrar el tope de dinero por slice de F38

F38 pedía «presupuesto **en dinero** por slice con corte duro, y gasto desglosado
por papel» (`docs/convergencia-tres-loops.md:103-107`). Piezas que faltan, en
orden:

### 6.1 Un precio, que ninguna telemetría local da

Ni el span, ni el transcript, ni el evento de log que llega al colector de
empresa le ponen precio a los tokens de un subagente. Hace falta una tabla
`modelo → (input, output, cacheRead, cacheCreation)` **dentro del repo**, con
fecha, y la fila de telemetría tendría que guardar **con qué tabla se valoró**,
por el mismo argumento por el que ya guarda `plugin_version`: un precio que
cambia hace incomparables dos runs, y sin el dato la diferencia se lee como ruido.

Esa tabla es una decisión de mantenimiento —quién la actualiza y cada cuánto—, no
un detalle de implementación.

### 6.2 Columnas nuevas en la fila, con el precedente de la tanda 1

La tanda 1 metió `agent_bytes`, `skill_bytes` y `package_bytes` con un patrón que
esta medida debe copiar tal cual: medida pura en `run-metrics.js`, agregador
hermano que la lee (`aggregateRoleBytesMeasures`), y columna `NULLABLE` en
`harvest-table.js` proyectada con `#whenTelemetryMeasured`, de modo que una fila
vieja sale `null` y **nunca `0`**. Las candidatas serían `agent_id`,
`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens` y
—sólo si §6.1 se resuelve— `cost_usd` y `price_table`.

### 6.3 El corte, que ya está construido y no tiene quien lo alimente

`run-machine.js` ya sabe cortar por dinero:

```js
// El dinero corta por encima de todo. Da igual en qué paso esté el run: si el
// tope está agotado, la llamada siguiente no se lanza.
if (outcome === OUTCOMES.OVER_BUDGET) return cerrado(run, RUN_STATES.ABORTED_BUDGET)
```

`OUTCOMES.OVER_BUDGET` y `RUN_STATES.ABORTED_BUDGET` existen; `DEFAULT_BUDGETS`
sólo tiene contadores de reintentos. **La máquina no necesita cambiar para que
haya tope de dinero**: necesita que alguien le pase ese resultado, y eso exige
§6.1 y §6.2 antes.

---

## 7. La decisión que queda, y de quién es

Una sola, y es del mantenedor:

> **¿Se acepta un hook `SubagentStop` en el plugin como fuente de la atribución
> por subagente (opción A), o se prefiere que el gasto se lea del colector de
> empresa que ya existe (opción B) aunque no distinga los papeles?**

Va con dos preguntas menores que dependen de la primera:

- Si A: **quién mantiene la tabla de precios** de §6.1, y con qué cadencia.
- Si A: qué se hace con los subagentes que la sesión despacha **fuera** del loop
  (§4.2, primer contra): ¿se descartan por no coincidir el paso, o se anotan
  aparte?

Este documento no las decide.

---

## 8. Lo que este trabajo NO ha hecho, a propósito

- **No hay código.** El único enganche determinista posible (§4.2) es un hook
  nuevo que dispara en todos los subagentes de la sesión y cuya correspondencia
  con el intento descansa en una invariante que hoy nadie mide. Eso es una
  decisión de arquitectura, no una implementación de bajo riesgo, y la frontera
  del encargo la deja fuera.
- **No se ha montado ningún colector**, no se ha añadido ninguna dependencia y no
  se ha tocado `~/.claude`.
- **No se ha medido** si el evento `api_request` cae dentro del span
  `llm_request` de su propia llamada (§2.2). Es lo único que decidiría si la
  opción C puede juntar el dinero con el `agent_id` sin recalcular precios.
- **No se ha medido** el contenido de las métricas con una corrida, porque en
  esta máquina la política remota impone el destino (§5.1). Lo del §2.1 es
  lectura del binario.
