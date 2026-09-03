# Pedir cambios al plan — la issue como buzón, y un vigilante que la lee

**Fecha:** 2026-09-03
**Repo:** `josemerca/control-tower-plugin`, directorio `backend/`
**Estado:** diseño aprobado, nada ejecutado todavía
**Se apoya en:** la PR #67 (`alcaptar/claim_y_go`), todavía sin mergear — el claim del issue y el go acuñado por el backend
**Alcance:** solo `backend/`. El front no se toca en esta ronda

---

## 1. El problema

Cuando el plan queda escrito, validado y commiteado, el carril del backend
ofrece **una sola salida**: `POST /implement-plan`, que es el go. No hay forma
de decir «esto está casi, pero cambia esto» sin ir a la ventana de cmux y
teclearlo a mano — o sea, exactamente el trabajo manual que este backend existe
para quitar.

El plugin ya se topó con esto y lo aplazó por escrito. `scripts/ct-watch-go.mjs`,
en su cabecera, entre lo que deliberadamente no tiene:

> NI `-REVIEW`. Mandar una corrección por comentario y que el plan se rehaga es
> otra función; para pedir cambios sigue estando el terminal.

Esto es esa otra función, en el backend.

## 2. Qué se construye

Un comentario en la issue que empiece por `-REVIEW` es una petición de cambios.
Un vigilante que corre dentro del proceso del backend lo ve, y le teclea al
**mismo** agente, en el **mismo** worktree, la orden de rehacer el plan que ya
commiteó. El agente lo rehace, lo revalida, lo recommitea y vuelve a parar.

El sitio no es arbitrario: el plan **ya está en la issue**. Lo publica el paso 9
de `plugin/skills/writing-plans-prescriptive/SKILL.md` («Post the plan as an
issue comment and STOP»), que es la skill que le manda el encargo. Se comenta
donde se lee.

Y con #67 el hilo de la issue queda coherente de punta a punta: el plan lo
publica el agente, el `-REVIEW` lo escribes tú, y el `-OK <nonce>` lo publica el
backend al implementar.

## 3. El disparador: un token exacto

Un comentario cuenta como petición de cambios si **su cuerpo empieza por
`-REVIEW`**. Lo que va detrás es el texto que se le entrega al agente.

**Por qué un token y no «cualquier comentario nuevo».** Porque no hay ninguna
otra forma de distinguirlos. El comentario del plan lo publica el agente con
**el mismo `gh` y el mismo token que tú**: para GitHub, el plan y tu petición los
firma la misma cuenta, así que filtrar por autor no filtra nada. Y el orden no
ayuda: la skill valida (paso 7), commitea (paso 8) y **luego** publica (paso 9),
así que el comentario del plan puede llegar después de que el contrato ya diga
`ready`. Con un token, da igual cuándo llegue.

**Por qué `-REVIEW` y no `-CAMBIOS`.** Para que el hilo hable un solo idioma:
`GhPlanIssues.GO_TOKEN` ya es `-OK` desde #67, y el token vive a su lado.

**La asimetría del error, al contrario que en el `-OK`.** `go-response.js`
argumenta que el `-OK` tiene que ser coincidencia exacta porque un token
reconocido de más **arranca trabajo**. Aquí el reparto es el inverso y más
benigno: un `-REVIEW` de más hace que el agente rehaga un plan que estaba bien
—molesto, reversible, con el plan viejo en el historial de git—; uno de menos te
deja esperando, y lo notas. Por eso basta con `startsWith` y no hace falta ni
nonce, ni ventana de ids previos, ni caja exacta en el resto del cuerpo.

## 4. Dónde vive la vigilancia

**Un bucle dentro del proceso del backend**, arrancado por `POST /start-plan`
junto al `sessions.remember` que ya hace, y parado por `POST /implement-plan`:
implementar es decir «ya no pido más cambios».

Arrancarlo en `start-plan` y no al llegar a `ready` **se lleva por delante toda
la maquinaria de ventanas**: la issue acaba de nacer, así que el conjunto de
comentarios ya atendidos empieza vacío y es correcto sin foto inicial, sin ids
previos y sin relojes. El plugin pagó esa lección entera (`go-response.js`, «la
ventana es el conjunto de comentarios que ya estaban, no una fecha de corte»);
aquí no se paga porque no hay pasado que distinguir.

**El bucle duerme antes del primer sondeo**, y el motivo es que no hay nada que
leer: cuando `start-plan` contesta, el agente acaba de arrancar y el plan no
existe. Quien mide eso es el test del propio vigilante, no el del entrypoint.

Las dos alternativas, y por qué no:

| Alternativa | Por qué no |
|---|---|
| **Dentro del stream de `/plan-events`**: el mismo bucle que sondea el contrato sondea también los comentarios | Vive lo que vive la petición HTTP, y el front cierra el `EventSource` al ver `ready` (`frontend/src/app/plan-events/client.ts:26`), o sea que la vigilancia duraría cero. Serviría solo después de cambiar el front |
| **Un proceso desprendido, como `ct-watch-go`** | Sobrevive al backend, y a cambio saca la vigilancia del hexágono: el proceso hablaría `gh` y `cmux` por su cuenta, sin puerto ni adaptador, sin los dobles de la suite del backend, y creando una segunda verdad sobre el estado del plan |

Lo que se acepta con la elegida: la vigilancia muere con el proceso de la API.

## 5. El estado del plan sigue siendo derivado

**No hay estado nuevo, ni marca, ni política, ni caducidad.** `PlanState` se
queda con `writing` y `ready`.

`plan-contract-progress.js` ya hace el trabajo en su lectura de `git status`: cuando el agente abra el
fichero del plan para rehacerlo, `git status --porcelain -- docs/superpowers/plans`
deja de salir vacío y el estado es `writing`; al recommitear, `ready`. La vuelta
a `writing` durante una revisión **no cuesta una línea de código**.

Lo que sí cambia en `plan-events-route.js`: **muere la maquinaria de finales**
(`#ENDINGS`, `endsAt`, `declaredStates`). Con revisiones, `ready` no es el final
de nada, y un estado terminal que se alcanza varias veces no es un estado
terminal. El bucle se queda en leer, emitir si cambió, dormir; lo único que
termina el stream es desconectarse o un fallo del contrato.

**Y esto no lo necesita la vigilancia, dicho para que nadie lo justifique así
después.** El vigilante recibe el `PlanWatch` por parámetro en `start(watch)` y se
lo queda: no consulta `PlanSessions` nunca, y funcionaría igual con este cambio y
sin él. Quitar el final del stream es la mitad de backend del slice del front —la
única que se puede escribir sin tocar el front— y se hace ahora porque el producto
se está iterando y un endpoint que miente sobre el estado del plan es peor que un
endpoint cuyo consumidor todavía no ha llegado.

## 6. El ciclo, paso a paso

1. `POST /start-plan` → issue creada, reclamada a `status:in-progress` (#67),
   worktree cortado, agente lanzado, sesión recordada, **vigilancia arrancada**.
2. El agente escribe el plan, lo valida, lo commitea y lo publica en la issue.
   El stream va diciendo `writing` y luego `ready`.
3. Comentas `-REVIEW añade el caso de la issue sin descripción` en la issue.
4. El vigilante lo ve en su sondeo, apunta el id del comentario como atendido, y
   ejecuta `ReviewPlan`: el agente recibe la orden de rehacer el plan con ese
   texto.
5. El agente reescribe el plan → el contrato dice `writing` → lo recommitea →
   `ready`. Puedes volver a 3 tantas veces como quieras.
6. `POST /implement-plan` → el go se acuña y se comenta (#67), el agente
   implementa, **la vigilancia muere** y la sesión se olvida.

## 7. Lo que se toca

### 7.1 Dominio

| Fichero | Qué |
|---|---|
| `domain/ports/plan-issues.js` | quinto método: `changesAsked({ issue, repository })`. El puerto ya es *el colaborador que es la issue* desde #67 (`open`, `claim`, `requeue`, `answerGo`), y `conventions/domain.md` manda que un paso nuevo contra un colaborador que ya existe sea **un método más**, nunca un puerto nuevo |
| `domain/ports/plan-agents.js` | tercer método: `review({ agent, issue, repository, changes })`, hermano de `launch` y `resume` |
| `domain/value-objects/plan-watch.js` | la watch lleva también el `agent` |
| `infrastructure/gh-plan-issues.js` | `ChangeAsked`, la petición con su `id` y su `text`, congelada, dentro del módulo del adaptador junto a `PlanIssueBody` |
| `domain/exceptions.js` | una familia propia, `PlanChangesFailure`, con `PlanChangesNotRead` y `PlanChangesNotUnderstood`: las dos causas que `conventions/domain.md` exige separar — el comando falló, y contestó algo que no sabemos leer |

**Por qué familia propia y no dentro de `PlanIssueFailure`.** Lo dicta un test
que ya existe: `__tests__/infrastructure/plan-refusal.test.js` exige que **toda**
excepción bajo `PlanFailure` tenga un status declarado en la proyección HTTP de
`start-plan`, y excluye a mano una sola cosa —`PlanProgressFailure`— con este
motivo escrito: «a failure of watching a plan has no status here because it
travels down the stream that is already open». Un fallo del sondeo de las
peticiones está en el mismo caso y peor: no hay ni stream por el que viaje, va a
`stderr`. Metido en `PlanIssueFailure` habría que declararle un status en
`PlanCollapse` para que ese test siguiera verde, y esa proyección sería código
muerto — exactamente el argumento con el que #67 decidió que `requeue` avise en
vez de lanzar. Con familia propia, la exclusión se escribe como la que ya está.

**Por qué la petición tiene nombre y el `agent` no lleva guarda.** Son las dos
caras de la misma regla, y las dos se decidieron mirándola. `ChangeAsked` existe
porque un `{ id, text }` crudo cruzaría tres módulos y el último **decide** con él
—`attended.has(change.id)`, y el `text` que se le teclea al agente—, y eso es el
defecto que `plugin/conventions/defects.md` nombra: «a module that receives a map
and still decides anything with it […] is logic reading a map by key lookup». Con
una clase, un campo mal escrito no es un campo ausente. El `agent`, en cambio, no
lleva guarda porque **no cruza ninguna frontera de entrada**: lo produce
`CmuxPlanAgents#open` con la expresión `/^OK\s+(workspace:\d+)\s*$/m`, que ya lo
restringe más de lo que una guarda podría. Y no se apoya en el argumento del argv:
el handle sí acaba en un argv (`cmux-plan-agents.js:46`), así que ése diría lo
contrario.

**Por qué el agente entra en la watch.** La watch es la única memoria del backend
entre peticiones: `StartPlan` la construye con `issue`, `located` y `repository`,
y `GET /plan-events/:issue` la usa para saber en qué directorio correr
`dispatch-check` y `git status`, datos que la petición HTTP no trae. El vigilante
corre **sin el front** y necesita, en ese mismo contexto, a quién entregarle los
cambios; hoy el handle del agente solo vive en la memoria del navegador y vuelve
en el cuerpo de `POST /implement-plan`. La watch pasa a decir «esta issue, este
worktree, este repo, y este agente escribiéndolo», que es lo que ya era en todo
menos en el último campo.

**`changesAsked` no sabe qué se ha atendido ya.** Devuelve todo lo que encuentra;
la memoria de lo atendido vive en el vigilante. Pasarle los ids vistos metería
estado en la frontera con `gh`, que tiene que seguir siendo un lector sin
memoria, igual que `open` y `claim`.

**`review` reusa `PlanAgentNotResumed`.** No se acuña una excepción nueva: el
fallo es idéntico (`cmux send` o `send-key` devolvió distinto de 0), se repara en
el mismo sitio, y `CmuxPlanAgents#type` ya la lanza. Una excepción por método
sería un nombre nuevo para la misma causa.

### 7.2 Aplicación

| Fichero | Qué |
|---|---|
| `application/actions/review-plan.js` | **nuevo.** `ReviewPlanParams { agent, issue, repository, changes }` y `ReviewPlan.execute` → `planAgents.review(params)`. Del tamaño que tenía `ImplementPlan` antes de #67 |
| `application/queries/read-changes-asked.js` | **nuevo.** `ReadChangesAskedParams { issue, repository }`, `ReadChangesAskedResult { changes }`, `execute` → `planIssues.changesAsked(...)`. Gemelo de `ReadPlanProgress` |
| `application/actions/start-plan.js` | una línea: el agente entra en la `PlanWatch` que ya construye |

**Por qué existe la query y no se llama al puerto desde el bucle.** Porque
ninguna otra pieza de `infrastructure/` llama a un puerto del dominio: `PlanEvents`
recibe de `ct-api.mjs` una función que atraviesa la aplicación
(`read: (session) => readPlanProgress.execute(...)`). El vigilante recibe dos, del
mismo modo. La query es un paso a través, igual que `ReadPlanProgress` es un paso
a través de `planProgress.of`.

### 7.3 Infraestructura

| Fichero | Qué |
|---|---|
| `infrastructure/plan-review-watch.js` | **nuevo.** El bucle: `start(watch)` y `stop(issueNumber)`, el tick inyectado, el conjunto de ids atendidos por issue, y un `try/catch` que escribe el fallo en `stderr` y sigue en el siguiente tick |
| `infrastructure/gh-plan-issues.js` | `changesAsked`: `gh issue view <n> --repo <o/r> --json comments`, `CHANGES_TOKEN = '-REVIEW'` al lado de `GO_TOKEN`, la clase `ChangeAsked`, y una línea en `PlanIssueBody.of()` que le dice al humano cómo se piden cambios |
| `infrastructure/cmux-plan-agents.js` | `review`: dos líneas reusando el `#type` de `resume` |
| `infrastructure/plan-agent-brief.js` | `reviewErrandFor({ issueNumber, repository, changes })`, hermano de `implementationErrandFor` |
| `infrastructure/plan-events-route.js` | muere `#ENDINGS`, `endsAt` y `declaredStates`; el bucle se queda en leer, emitir si cambió, dormir |
| `infrastructure/start-plan-route.js` | arranca la vigilancia junto al `sessions.remember` |
| `infrastructure/implement-plan-route.js` | la para y olvida la sesión, después del `202` |
| `infrastructure/api-server.js` | recibe la vigilancia y la pasa a esas dos rutas al montarlas |
| `infrastructure/ct-api.mjs` | el cableado, aprovechando que #67 ya construye `planIssues` una vez y lo comparte. Un `#SECONDS_BETWEEN_ASKS = 30` junto a los que ya hay |

**El registro de atendidos es del vigilante, no de `PlanSessions`.** Dos
registros con la misma clave y vidas distintas: `PlanSessions` es la memoria que
las rutas comparten, y los ids atendidos son estado interno de un bucle. Fundirlos
haría que olvidar una sesión borrase el rastro de lo ya despachado.

**El tick, 30 s.** El mismo de `ct-watch-go`, y su coste sale de la medida escrita
allí: 8 horas a un sondeo cada 30 s son ~960 llamadas por slice, o sea ~120 a la
hora, contra un límite de 5000. El sondeo del contrato se queda en 2 s: son dos
cosas distintas y `git status` es local.

**Lo que no se copia de `ct-watch-go` es su plazo**, y eso tiene consecuencia. Allí
el tick de 30 s viene emparejado con un `DEFAULT_TIMEOUT_MS` de 8 horas; aquí no hay
plazo, así que una vigilancia que nadie levanta con `/implement-plan` sondea mientras
viva el proceso, y el coste crece con cada plan arrancado en esa sesión. Está en §9.

### 7.4 El encargo, y una trampa del pty

`reviewErrandFor` dice, en una sola línea: que un humano ha pedido cambios en el
plan del issue N, cuáles, que lo rehaga sin implementar nada, que lo revalide con
`node <dispatch-check> N --repo <owner/name> --check-plan` hasta exit 0, que lo
recommitee, **que publique el plan rehecho como comentario del issue**, y que pare
otra vez —sin pull request y sin worktrees nuevos.

**Republicar no es un adorno: sin eso el ciclo solo funciona una vez.** El plan lo
puso en la issue el paso 9 de la skill, y `--check-plan` es read-only y no habla con
GitHub. Si el agente rehace el plan y no lo republica, en el hilo se queda el plan
viejo, y para escribir el segundo `-REVIEW` habría que irse al worktree a leer el
fichero con git — el trabajo manual que §1 dice que este backend existe para quitar.
Es la misma cláusula que el encargo original ya obedece, escrita también aquí.

**En una sola línea, y esto no es estilo.** El encargo se entrega con
`cmux send --workspace <handle> <texto>`, o sea **tecleándolo en un pty**: un
salto de línea ahí es un Enter, y enviaría media orden. `implementationErrandFor`
ya se une con espacios por eso mismo. Y como el texto de la petición **lo escribe
una persona en un comentario de GitHub**, viene con saltos de línea de verdad:
hay que aplanarlo antes de interpolarlo. Es la única transformación que sufre lo
que escribiste.

## 8. Lo que se descarta por no resolver nada de hoy

- **Un estado `revising`, o una marca de «revisión en vuelo».** Existía para
  tapar la ventana de segundos entre despachar la petición y el primer guardado
  del agente, en la que el contrato todavía dice `ready`. Tapar eso pide
  recordar algo que el disco no sabe, y con ello una forma de dejar de
  recordarlo cuando el agente no toca el plan: una política con su presupuesto
  para una ventana de segundos.
- **Caducidad, plazo o reintentos de la vigilancia.** Happy path.
- **Comprobar que detrás del token hay texto.** Un `-REVIEW` pelado le pide al
  agente un cambio vacío; el coste es un turno del agente contestando que no hay
  nada que cambiar, no un estado inconsistente.
- **Mover labels.** El claim de #67 pone `status:in-progress` en `start-plan` y
  ahí se queda mientras el plan se escribe y se rehace: pedir cambios no cambia
  el estado del slice, que sigue en marcha.
- **Contestar en la issue explicando el formato**, como hace `ct-watch-go` con
  `GO_FORMAT_REPLY`. Allí hace falta porque el `-OK` lleva un nonce que se
  teclea mal; aquí el token es una palabra y equivocarse no bloquea nada.
- **Nada más que la petición en sí.** No hay envoltorio, ni metadatos del
  comentario, ni autor: de los once campos que `gh` imprime por comentario se leen
  dos. Lo que sí tiene nombre es la petición, y no por si acaso: ver §7.1.
- **Importar nada nuevo del plugin.** El lector de comentarios se escribe propio
  en `backend/`. Nada del plugin lee `-REVIEW`, así que no hay copia que medir
  con un test de contrato: el token es nuestro y de nadie más.

## 9. Límites declarados

- **Entre que comentas y el agente guarda el fichero, el estado dice `ready`.**
  Si pulsas «Implementar» en ese hueco, implementa el plan viejo.
- **El front no se enterará de la vuelta a `writing`**, porque cierra el
  `EventSource` en cuanto ve `ready`. El backend ya sirve la verdad; consumirla
  es el slice del front, y hasta entonces el botón «Implementar» sigue visible
  mientras el plan se rehace.
- **Si el agente no toca el plan** —decide que no hay nada que cambiar, se muere
  su sesión de cmux, se le acaba el contexto—, nadie avisa: el estado se queda en
  `ready` como si la petición no hubiera existido.
- **La vigilancia vive con el proceso de la API.** Si se reinicia, se va, y las
  peticiones escritas mientras estaba caída no se atienden nunca: los
  comentarios que había al arrancar no se leen hacia atrás.
- **Nada impide pedir cambios mientras el plan todavía se escribe.** El token
  cuenta desde el primer sondeo; lo que llega, se entrega.
- **Una vigilancia que nadie levanta sondea para siempre.** No hay plazo, a
  diferencia de `ct-watch-go`: si arrancas cinco planes y de tres te olvidas, esas
  tres siguen preguntándole a `gh` mientras viva el proceso, y el coste crece con
  cada plan de la sesión. Lo que las apaga es `/implement-plan` o cerrar la API.
- **Una entrega que falla pierde la petición.** El `id` se apunta como atendido
  antes de teclearle al agente, así que un `cmux send` que falla deja el motivo en
  `stderr` y nadie vuelve a intentarlo. Es lo contrario de repetir el mismo párrafo
  cada treinta segundos, y es la mitad que se eligió.
- **El `agent` pasa a estar en dos sitios.** La watch ya sabe qué agente escribe
  cada plan, y `POST /implement-plan` sigue exigiéndolo en el cuerpo sin que nadie
  compruebe que coinciden. Con el front de hoy manda el del cuerpo y no hay fallo
  posible; unificarlos es del slice del front, que es quien lo manda.
- **El cuerpo de la issue sigue diciendo del `-OK` algo que en este carril no es
  verdad.** La sección de gates que renderiza el plugin habla de un nonce que
  «/ct-next imprimió al despachar» y de un vigilante lanzado por una coordinadora;
  aquí el go lo acuña el botón de implementar. Este slice añade su línea del
  `-REVIEW` al lado y no toca esa: es deuda de antes, y arreglarla es tocar el
  contrato con el plugin.

## 10. Cómo se mide

Según `backend/conventions/testing.md`, y sin salirse:

| Qué | Dónde se corta | La afirmación |
|---|---|---|
| `ReviewPlan` | `planAgents` doblado por constructor | qué recibió el puerto |
| `ReadChangesAsked` | `planIssues` doblado por constructor | qué recibió y qué devolvió |
| `StartPlan` | los cuatro puertos ya doblados | que la watch que devuelve lleva el agente |
| `GhPlanIssues.changesAsked` | `gh` como conversación guionizada | el **argv literal**, el parseo de una **salida real** de `gh issue view --json comments`, y que las dos causas de fallo se distinguen (`PlanChangesNotRead` no es `PlanChangesNotUnderstood`) |
| `CmuxPlanAgents.review` | `cmux` como conversación guionizada | el argv literal de `send` y `send-key`, y que el encargo va en **una sola línea** aunque la petición traiga saltos |
| `PlanAgentBrief.reviewErrandFor` | nada | el texto, y que aplana lo que escribió la persona |
| `PlanReviewWatch` | las dos funciones inyectadas y el `sleep` | que despacha una petición nueva, que **no** despacha dos veces la misma, que `stop` corta el bucle, y que un fallo del sondeo no lo mata |
| `plan-events-route` | como hoy | que `ready` **ya no** termina el stream, y que el estado vuelve a `writing` cuando el contrato lo dice |
| `PlanIssueBody.of` | nada | que el cuerpo de la issue nombra el token con el que se piden cambios |
| Entrypoint | proceso real | lo que ya cubre y nada más: `backend/conventions/testing.md` dice que del entrypoint no se mide nada más arrancándolo, y su único test de `start-plan` muere en `acli` con un `503` sin llegar a arrancar ninguna vigilancia |

Y la suite entera del backend verde (`make test-backend`), que incluye
`backend/__tests__/yardstick.test.js` — la vara que mide cada fichero nuevo bajo
`backend/` por el hecho de existir en el disco, sin que nadie lo liste.
