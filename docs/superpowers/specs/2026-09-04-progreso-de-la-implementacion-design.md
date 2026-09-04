# El progreso de la implementación — `GET /implement-progress/:issue`

**Fecha:** 2026-09-04
**Repo:** `josemerca/control-tower-plugin`, directorio `backend/`
**Alcance:** un endpoint de lectura, sus piezas y un campo nuevo en el `202` de
`POST /start-plan`. El frontend que lo consume es de otra persona y no entra en
este diseño.

---

## 1. Qué se construye

Hoy la interfaz se queda muda justo después de pulsar «Implementar plan»: el
`202` de `POST /implement-plan` dice que el agente recibió la orden y ahí
termina todo lo que la persona delante sabe. La implementación de una slice
dura horas y no emite nada hacia fuera.

Este endpoint contesta a la pregunta «¿por dónde va?» con el vocabulario que la
propia máquina de estados usa: **qué tarea de cuántas, qué paso de esa tarea, y
cuántos intentos lleva**.

No se le pregunta nada al agente. El progreso ya está escrito en disco.

---

## 2. La fuente, y lo que no dice

`ct-step` persiste el estado del run en
`<root>/.worktrees/<issue>/.agent/run-<issue>.json`
(`plugin/scripts/ct-step.mjs:206`) y lo reescribe en cada transición
(`guardar()`, línea 351). Comprobado contra dos ficheros reales:
`repo-pulse/.worktrees/35` (entregado) y `banco-de-la-puerta` (recién nacido).

De los quince campos que trae, este endpoint usa seis:

| Campo | Para qué |
|---|---|
| `task`, `tasksTotal` | «tarea 3/7» |
| `step` | uno de los ocho de `STEPS` en `plugin/scripts/run-machine.js:41` |
| `controlRetries`, `judgeRetries`, `correctionRetries` | el intento: su suma más uno |
| `discards` | veredictos ilegibles acumulados en el run |
| `closed` | `"delivered"`, y nada más |
| `plan` | ruta del plan relativa al worktree, de donde sale el nombre de la tarea |

### Lo que la fuente NO dice

`ct-step.mjs:1963` persiste `closed` **sólo cuando el run se entrega**:

```js
if (transicion.state === RUN_STATES.DELIVERED) run = { ...run, closed: RUN_STATES.DELIVERED }
```

Los ocho cierres en fallo de `RUN_STATES` — `blocked-controls`, `blocked-judge`,
`blocked-commit`, `blocked-global`, `blocked-slice-judge`, `blocked-reconcile`,
`blocked-e2e`, `aborted-budget` — salen por código de salida y por pantalla, y
no dejan rastro en el fichero. Un run bloqueado se lee exactamente igual que uno
en curso.

**Se podría deducir** comparando los contadores contra `DEFAULT_BUDGETS`.
**No se deduce.** Eso es reimplementar la tabla de decisión fuera de la tabla, y
quedarse desincronizado en la primera vuelta que ajuste un presupuesto. El
endpoint afirma lo que el fichero afirma; un run atascado se ve como un estado
que deja de moverse, no como un estado que miente. Es la regla que este repo ya
tiene escrita para las métricas: un hueco se lee como una afirmación, y la
ausencia se declara en vez de rellenarse.

Quien consuma el endpoint y quiera avisar de un run atascado tendrá que hacerlo
por el tiempo sin cambios, que es un dato que sí tiene.

---

## 3. El contrato

```
GET /implement-progress/:issue?root=<ruta absoluta del checkout>
```

| Código | Cuerpo | Cuándo |
|---|---|---|
| `200` | `{"step":"starting","task":null,"tasks":null,"name":null,"attempt":null,"discards":null}` | el worktree existe y `ct-step` todavía no ha creado el run |
| `200` | `{"step":"judge","task":3,"tasks":7,"name":"el lector del plan","attempt":2,"discards":0}` | un paso de tarea |
| `200` | `{"step":"global","task":null,"tasks":7,"name":null,"attempt":null,"discards":0}` | un paso de slice |
| `200` | `{"step":"delivered","task":null,"tasks":7,"name":null,"attempt":null,"discards":0}` | `closed: "delivered"` |
| `400` | `{"code":"malformed-issue","detail":"the issue is a number such as 42"}` | |
| `400` | `{"code":"malformed-root","detail":"root must be an absolute path such as /Users/you/repos/name"}` | |
| `400` | `{"code":"implementation-progress-not-read","detail":"…"}` | no hay worktree, o el fichero no se pudo leer |
| `400` | `{"code":"implementation-progress-not-understood","detail":"…"}` | el fichero no es el JSON que conocemos |
| `403` | — | origen ajeno, como en las demás rutas |
| `405` | `{"code":"method-not-allowed",…}` | cualquier verbo que no sea `GET` |

`step` toma diez valores: los ocho de `STEPS` tal cual (`implement`, `controls`,
`judge`, `commit`, `reconcile`, `global`, `slice-judge`, `e2e`) más `starting` y
`delivered`, que no son pasos de la máquina sino los dos bordes del run.

---

## 4. Las decisiones

**El backend no traduce.** Emite el vocabulario de la máquina en inglés; el
castellano lo pone quien dibuja, que es donde ya vive todo el castellano de este
producto. Traducir aquí obligaría a mantener dos vocabularios sincronizados con
`run-machine.js` en vez de uno.

**Tres campos hablan de una tarea y dos del run, y sólo se rellenan cuando
dicen la verdad.** `task`, `name` y `attempt` describen una tarea concreta, así
que valen `null` en todo lo que no es un paso de tarea: en `starting`, en los
tres pasos de slice y en `delivered`. `tasks` y `discards` son del run entero y
sólo son `null` mientras el run no existe.

Que `task` desaparezca en los pasos de slice es la misma decisión que `ct-step`
ya toma al medir (`task: esDeSlice ? null : run.task`): en `global`,
`slice-judge` y `e2e` el campo `run.task` se queda clavado en la última tarea, y
atribuirles esa tarea sería una afirmación falsa. El intento va detrás por el
mismo motivo — los tres contadores de reintento se reinician al avanzar de
tarea, así que en un paso de slice lo que quedaría en `attempt` es el intento de
la última tarea, contado sobre un paso que además no tiene reintento propio. Y
en `delivered` no hay ningún paso en curso al que un intento pertenezca.

**La petición no lleva `repo`.** `plan-events` lo pide porque busca una sesión
viva en un mapa indexado por `(repo, issue)`; aquí la ruta del fichero se deriva
de `root` e `issue` y el nombre del repositorio no participa en nada. Pedirlo
para validar que el checkout es el que dice sería una guarda contra un caller
que no existe.

**Sin estado en el servidor.** `root` viaja en la petición igual que `path`
viaja hoy en `POST /start-plan`. Por eso el endpoint contesta igual tras
recargar la página, tras reiniciar el backend, y para una slice que lanzó otra
sesión. `implement-plan-route.js` no se toca: su `sessions.forget` puede
quedarse, porque nada de esto depende de él.

**`POST /start-plan` devuelve un campo más: `root`.** Hoy su `202` lleva
`worktree` (la ruta del worktree) pero no la raíz del checkout, que es lo que
este endpoint pide. Es el valor que el caso de uso ya tiene en
`located.root`.

**El adaptador reutiliza `GitWorkspace.pathFor`.** Dónde vive el worktree de un
issue es una regla que el backend ya conoce porque es quien lo crea. Escribir
una segunda copia de `<root>/.worktrees/<issue>` son dos verdades esperando a
divergir.

**El lector del plan se escribe propio, no se importa del plugin.** El nombre de
la tarea sale de los encabezados `### Task <n> — <nombre>` del fichero que
`run.plan` nombra, leídos fuera de los bloques de código. `extractTasks` valida
además el contrato entero del plan y nada de eso hace falta aquí. La regla del
repo para lo nuevo es implementación propia en `backend/` más un test de
contrato contra el lector real, y ese test está en §6.

**Sin worktree no se contesta `starting`.** Un directorio que no existe y un run
que aún no ha nacido son cosas distintas: la primera es un fallo (`400`) y la
segunda un estado (`200`). El adaptador las separa mirando el directorio antes
que el fichero.

---

## 5. Las piezas

```
domain/exceptions.js                      + ImplementationProgressFailure
                                          + ImplementationProgressNotRead
                                          + ImplementationProgressNotUnderstood
domain/ports/implementation-progress.js     ImplementationProgress.of({ root, issue })
domain/value-objects/implementation-state.js
                                            ImplementationState y su vocabulario de pasos
application/queries/read-implementation-progress.js
                                            ReadImplementationProgress, con Params y Result
infrastructure/run-file-progress.js         el adaptador: el run-file y el lector de
                                            encabezados de plan, que sólo él consume
infrastructure/implement-progress-route.js  la ruta, su modelo de petición y sus
                                            proyecciones de rechazo
infrastructure/start-plan-route.js          un campo más en el 202
infrastructure/api-server.js                la ruta montada
infrastructure/ct-api.mjs                   el grafo
```

Es el mismo reparto que la fase de plan ya tiene entre `plan-progress.js`
(puerto), `plan-state.js` (valor), `plan-contract-progress.js` (adaptador) y
`read-plan-progress.js` (query), y por eso no inventa ninguna forma nueva.

El vocabulario de pasos vive dentro de `implementation-state.js` y no en un
módulo propio: nadie lo construye por su cuenta y su único consumidor es el
valor que lo usa.

---

## 6. Tests

Según `backend/conventions/testing.md`, sin excepciones:

- **Controlador** — servidor escuchando y `fetch`, aserción sobre el estado y el
  cuerpo JSON literal de cada una de las respuestas de la tabla del §3. Cada
  rechazo prueba además que la query no llegó a consultarse.
- **Query** — el puerto doblado por constructor; se afirma qué recibió y qué
  devolvió.
- **Adaptador** — transcripciones literales: los dos run-file reales localizados
  en el §2, no formas inventadas. Y las dos causas de fallo separadas, con la
  prueba de que una no es instancia de la otra: el fichero que no se puede leer
  (`NotRead`) y el fichero que no es lo que conocemos (`NotUnderstood`).
- **Contrato con el escritor** — `run-machine.js` es puro y sin un solo import,
  así que el test puede construir runs con el `newRun` y el `after` **reales**
  del plugin, serializarlos como hace `ct-step`, y comprobar que nuestro lector
  los entiende. El mismo test afirma que el vocabulario de pasos cubre `STEPS`
  entero: el día que el plugin añada un noveno paso, este test cae en vez de
  que el endpoint conteste un `step` que nadie sabe dibujar. Es la regla de
  payloads de frontera con el sentido invertido — allí escribimos nosotros y lee
  el plugin; aquí escribe el plugin y leemos nosotros.
- **Entrypoint** — el camino feliz y sólo ése, un proceso real que atiende una
  petición entera.
- **Dominio** — nada propio; queda cubierto por los caminos de arriba.

---

## 7. Lo que se deja fuera, y por qué

**El estado bloqueado.** No es deducible sin reimplementar la tabla. §2.

**Cachear la lectura por `mtime`.** El run-file crece hasta cientos de kilobytes
cuando `lastVerdict` trae las nueve rúbricas enteras, y quien sondee lo va a
leer cada pocos segundos. No entra: no hay un problema medido, y la vara del
backend pone la carga de la prueba en lo que se añade.

**El historial del run.** `docs/superpowers/metrics/issue-<n>.jsonl` tiene una
fila por intento de paso con su marca de tiempo, y con eso se dibuja la línea de
tiempo completa de la slice: cuánto costó cada tarea, cuántos vetos del juez,
cuántos descartes. Es otro endpoint y otra decisión; queda nombrado, no
diseñado.

**El grano fino de qué hace el agente ahora mismo.** Los hooks de Claude Code
(`PostToolUse`, `SubagentStart`, `SubagentStop`) corren también dentro de los
subagentes y llevan `agent_type`, así que un hook del plugin podría anexar
«corriendo `ct-judge`, leyendo `plan-tasks.js`» a un fichero del worktree. Eso
toca el plugin, que está fuera del alcance de esta ronda.

**cmux como fuente.** Se evaluó y se descarta. `cmux events` es un stream NDJSON
con secuencia, replay y reconexión, y todo lo que emite se anexa además a
`~/.cmuxterm/events.jsonl`; pero su catálogo es de ventanas, workspaces, paneles
y notificaciones, y no sabe nada de tareas ni de pasos. `cmux set-progress` y
`cmux set-status` son un canal de reporte hacia su barra lateral, no una fuente
que consultar. `cmux todo` encajaría con la forma del dato, pero su contrato
prohíbe a los agentes tocarlo sin petición explícita de la persona. Y el socket
rechaza a quien no arrancó dentro de cmux (`ERROR: Access denied — only
processes started inside cmux can connect`), lo que ataría el backend a
arrancarse desde dentro o a llevar contraseña.
