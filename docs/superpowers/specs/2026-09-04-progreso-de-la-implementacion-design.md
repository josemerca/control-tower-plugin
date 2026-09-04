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

Este endpoint contesta a la pregunta «¿por dónde va?»: **qué tarea de cuántas,
qué paso de esa tarea, y cuántos intentos lleva**.

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
| `200` | `{"step":"starting","task":null,"total_tasks":null,"name":null,"attempt":null,"discards":null}` | el worktree existe y `ct-step` todavía no ha creado el run |
| `200` | `{"step":"judging-task","task":3,"total_tasks":7,"name":"el lector del plan","attempt":2,"discards":0}` | un paso de tarea |
| `200` | `{"step":"verifying-slice","task":null,"total_tasks":7,"name":null,"attempt":null,"discards":0}` | un paso de slice |
| `200` | `{"step":"delivered","task":null,"total_tasks":7,"name":null,"attempt":null,"discards":0}` | `closed: "delivered"` |
| `400` | `{"code":"malformed-issue","detail":"the issue to read is a number such as 42"}` | el issue de la ruta no es un número |
| `400` | `{"code":"malformed-root","detail":"root is an absolute path such as /Users/you/repos/name"}` | falta `root` o no es absoluto |
| `400` | `{"code":"implementation-progress-not-read","detail":"…"}` | no hay worktree ahí, o el fichero no se deja leer, o no es el JSON que conocemos |
| `403` | — | origen ajeno; lo pone el middleware compartido, no esta ruta |

Tres códigos y ni uno más. El recorte está razonado en el §4.

### Cuándo se dan de verdad

`implementation-progress-not-read` es el que va a saltar en producción, y por un
camino que el consumidor tiene que conocer: **cuando la slice se mergea, su
worktree se borra**, y a partir de ese momento un sondeo que siga vivo deja de
recibir `delivered` y empieza a recibir este `400`. No es un fallo del backend —
el sitio donde vivía la respuesta ya no está. Quien sondee debería parar en
`delivered`, que es el estado final y no cambia nunca a otra cosa.

Los otros dos son guardas de puerta y sólo los provoca un cliente que se
equivoca. `malformed-root` tiene un camino concreto y previsible: hoy el `202`
de `POST /start-plan` **no** devuelve la raíz del checkout, así que hasta que
ese campo exista cualquier consumidor que intente reengancharse sin haberla
guardado llamará sin `root`. `malformed-issue` sólo se alcanza a mano.

Que sean improbables no los hace prescindibles: `simplicity.md` pone la guarda
en la puerta por la que el valor entra de fuera, y esta ruta es esa puerta sea
quien sea el cliente de hoy. Lo que sí desaconseja es la guarda *de más*, y por
eso el catálogo son tres y no cinco.

### Los diez pasos

Cinco ocurren **una vez por tarea**, tres **una vez por slice** —cuando ya no
queda ninguna tarea por comitear— y dos son los bordes del run.

| `step` | `STEPS` | Qué está pasando |
|---|---|---|
| `starting` | — | El worktree existe pero `ct-step` aún no ha creado el run |
| `implementing` | `implement` | Un subagente implementador está escribiendo la tarea |
| `verifying-task` | `controls` | El programa ejecuta los comandos de verificación que **esa tarea** declaró en el plan, y comprueba que los tests que prometió existen |
| `judging-task` | `judge` | Un subagente `ct-judge` juzga la tarea contra su plan, sin shell, para no poder convencerse a sí mismo de que está verde |
| `committing` | `commit` | El programa comitea la tarea. Comitea él y no el implementador, para que un veto no deje rastro que deshacer |
| `reconciling` | `reconcile` | El worktree se pone al día con su rama base. Va antes de la verificación de slice para que ésta mida el árbol que se va a entregar y no uno que se quedó atrás |
| `verifying-slice` | `global` | El programa ejecuta el bloque `## 8. Global verification` del plan: la verificación de **la slice entera**, una sola vez, sobre el árbol con las N tareas ya comiteadas. Existe porque el paso por tarea sólo mide el bloque de cada tarea por separado, y antes esto no lo corría nadie |
| `judging-slice` | `slice-judge` | Un juez mira la slice **entera**: si las tareas juntas entregan lo que el plan prometía y si son coherentes entre sí. Ningún juez por tarea mira eso |
| `verifying-journeys` | `e2e` | Los recorridos punta a punta, y sólo si la slice declara alguno. Es el único paso condicional |
| `delivered` | — | El run cerró bien |

---

## 4. Las decisiones

**El contrato tiene vocabulario propio, y no es el interno de la máquina.** Los
nombres de `STEPS` son los de quien escribió la tabla de decisión, y dos de
ellos no se explican solos fuera de ella: `global` no dice que sea la
verificación de la slice entera, y `controls` no dice que sea la de una tarea.
El contrato los nombra por lo que está pasando, en pares simétricos —
`verifying-task` / `verifying-slice`, `judging-task` / `judging-slice` — y el
mapa vive en un sitio, sujeto por el test de contrato del §6: el día que la
máquina estrene un noveno paso, el mapa no lo cubre y el test cae.

**El castellano no lo pone el backend.** El vocabulario del contrato es inglés,
como el resto del backend; el castellano lo pone quien dibuja, que es donde ya
vive todo el castellano de este producto.

**Tres campos hablan de una tarea y dos del run, y sólo se rellenan cuando
dicen la verdad.** `task`, `name` y `attempt` describen una tarea concreta, así
que valen `null` en todo lo que no es un paso de tarea: en `starting`, en los
tres pasos de slice y en `delivered`. `total_tasks` y `discards` son del run entero y
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

**Tres códigos de error, no cinco.** La pregunta de `simplicity.md` — *¿qué
llamada se rompe sin esto? Nómbrala* — aplicada a un borrador que tenía cinco:

- `malformed-issue` y `malformed-root` **se quedan**. Los dos valores entran de
  fuera por la puerta de esta ruta, y `simplicity.md` pone ahí la guarda: sin
  ellas, un `issue` no numérico deriva una ruta `…/run-NaN.json` y el fallo se
  cuenta como «no se pudo leer ese fichero», que es un mensaje específico,
  seguro y falso. `plan-events` tiene esos dos mismos rechazos por la misma
  razón.
- `implementation-progress-not-understood` **se va**, fundido en `not-read`.
  Nadie distingue las dos: quien consuma el endpoint enseña el `detail` y hace
  lo mismo con cualquiera de ellas, y ninguna llamada se rompe si sólo hay una.
  El precedente manda en la misma dirección — el adaptador hermano de la fase de
  plan, que además lanza procesos, tiene una sola `PlanProgressNotRead`. La
  regla de `testing.md` que separa `NotRead` de `NotUnderstood` es para el
  adaptador que habla con una herramienta que puede negarse o contestar basura;
  aquí la herramienta es leer un fichero.
- `405 method-not-allowed` **se va**. Lo había puesto por simetría con
  `start-plan` e `implement-plan`, y era falso: `refuseOtherMethods` sólo lo
  declaran las rutas POST, y `PlanEventsRoute` —la única GET del backend— no lo
  tiene. Un POST aquí cae en `Failures.nothingMatched` como cae hoy en
  `plan-events`.

---

## 5. Las piezas

```
domain/exceptions.js                      + ImplementationProgressFailure
                                          + ImplementationProgressNotRead
domain/ports/implementation-progress.js     ImplementationProgress.of({ root, issue })
domain/value-objects/implementation-state.js
                                            ImplementationState, el vocabulario de los diez
                                            pasos y el mapa desde el de la máquina
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

El vocabulario de los diez pasos y el mapa desde `STEPS` viven dentro de
`implementation-state.js` y no en un módulo propio: nadie los construye por su
cuenta y su único consumidor es el valor que los usa.

---

## 6. Tests

Según `backend/conventions/testing.md`, sin excepciones:

- **Controlador** — servidor escuchando y `fetch`, aserción sobre el estado y el
  cuerpo JSON literal de cada una de las respuestas de la tabla del §3. Cada
  rechazo prueba además que la query no llegó a consultarse.
- **Query** — el puerto doblado por constructor; se afirma qué recibió y qué
  devolvió.
- **Adaptador** — transcripciones literales: los dos run-file reales localizados
  en el §2, no formas inventadas. Sus tres fallos (el directorio que no está, el
  fichero que no se deja leer, el JSON a medias) comparten tipo y se distinguen
  por el `detail`, que es lo único que alguien lee.
- **Contrato con el escritor** — `run-machine.js` es puro y sin un solo import,
  así que el test puede construir runs con el `newRun` y el `after` **reales**
  del plugin, serializarlos como hace `ct-step`, y comprobar que nuestro lector
  los entiende. El mismo test afirma que el mapa del §3 cubre `STEPS` entero: el
  día que el plugin añada un noveno paso, este test cae en vez de que el
  endpoint conteste un `step` que nadie sabe dibujar. Es la regla de
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
