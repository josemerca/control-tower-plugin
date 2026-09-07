# Pedir fixes en la pull request — el bucle que faltaba al final del carril web

## 1. Qué se construye, y por qué

Hoy el carril web se queda mudo y ciego en el instante en que empieza la
implementación. `ImplementPlanRoute` mata el vigilante de reviews del plan y
olvida la sesión del stream (`implement-plan-route.js:185-186`); el agente
implementa, abre la pull request, la libera con
`dispatch-check --release --no-watch-merge` y para. A partir de ahí nadie lee
nada y nadie habla con el agente, que sigue vivo en su ventana de cmux.

Consecuencia: si una persona revisa la pull request y pide cambios, ese texto no
llega a ninguna parte. El trabajo se queda ahí, y la única salida es abrir la
ventana del agente y teclearle a mano lo que pone la review.

Se construye el eslabón que falta: un vigilante que lee las reviews de la pull
request y le entrega al agente vivo lo que se le ha pedido, más el cuarto paso
en la interfaz que hace visible en qué punto está la entrega.

**Alcance, cerrado a propósito.** Sólo pedir fixes. No se vigila la integración
continua, no se mergea nada, y no se recoge la cosecha. El bucle empieza cuando
existe la pull request y termina cuando alguien la mergea, sin que este diseño
tenga nada que decir sobre ese merge.

**Lo que no se unifica.** Revisar un plan en un issue y revisar una pull request
al final del desarrollo son dos cosas distintas, con dos señales distintas y dos
encargos distintos. Son dos instancias del mismo bucle, nunca un bucle con un
parámetro que decida cuál de las dos cosas está haciendo.

## 2. Lo que ya existe y no se reinventa

Cuatro piezas del plugin resuelven ya lo que parecía faltar, y este diseño se
apoya en ellas en vez de duplicarlas.

**La señal de que la pull request está lista.** `dispatch-check --release`
mueve el issue de `status:in-progress` a `status:in-review`
(`dispatch-check.mjs:1077`), y lo invoca el propio agente en el instante en que
abre la pull request. La etiqueta es la señal, y no hay que inventar ningún
aviso.

**La arista de vuelta.** `dispatch-check --reopen` hace el camino inverso,
`in-review` a `in-progress`, y nació exactamente para esto
(`dispatch-check.mjs:1163`): *"si rechazas un PR en el gate, ese slice sale del
loop PARA SIEMPRE"*. Su propio mensaje describe el caso de uso literal:
*"CORREGIR ENCIMA (lo normal tras un rechazo de revisión): sigue trabajando en
ese mismo worktree y esa misma rama, sobre el PR que ya existe"*.

**La mecánica del vigilante.** `PlanReviewWatch` no sabe nada de planes: recibe
`asked` y `review` como colaboradores inyectados, y su bucle sólo sondea, evita
repetir lo ya atendido, sobrevive a un fallo del sondeo y muere sin tumbar la
interfaz de programación de aplicaciones. Ese bucle sirve tal cual.

**El transporte hasta el agente.** `CmuxPlanAgents` ya teclea texto en una
sesión viva con `cmux send` más `send-key Enter`.

Lo que no sirve es `ct-watch-merge.mjs`: sondea `--state merged` y entrega
tecleando en una sesión coordinadora de cmux que en el carril web no existe. De
ahí el `--no-watch-merge` del brief.

## 3. Qué cuenta como petición de fix

Las reviews nativas de GitHub, cruzando los dos endpoints que las componen:

```
gh api repos/<owner>/<repo>/pulls/<n>/reviews     -> la review y su cuerpo
gh api repos/<owner>/<repo>/pulls/<n>/comments    -> los comentarios de línea
```

Los comentarios se agrupan por su `pull_request_review_id`, de modo que de un
solo envío salen el texto general y cada comentario con su fichero y su línea.

Una review pide un cambio cuando su estado es `CHANGES_REQUESTED` o `COMMENTED`
**y** trae cuerpo con texto **o** al menos un comentario de línea:

```js
static #asksForAChange(review) {
  if (review.state !== 'CHANGES_REQUESTED' && review.state !== 'COMMENTED') return false
  return review.body.trim().length > 0 || review.comments.length > 0
}
```

La segunda mitad de esa condición no es un adorno. Cuando alguien añade un
comentario de línea suelto, sin abrir una review, GitHub lo envuelve en una
review implícita con estado `COMMENTED` y cuerpo vacío. Sin `|| comments.length`
ese caso se perdería, y es el más frecuente al revisar: comentar una línea y ya.

Qué llega y qué no:

| Lo que se hace en GitHub | Qué crea | Llega |
|---|---|---|
| Submit review con texto (Approve, Request changes, Comment) | review con cuerpo | sí |
| Varios comentarios de línea y luego Submit review | review más comentarios agrupados | sí, con fichero y línea |
| Un comentario de línea suelto, sin abrir review | review implícita `COMMENTED` sin cuerpo, con un comentario | sí |
| Comentario en la pestaña Conversation | issue comment en `issues/<n>/comments` | **no** |

`APPROVED`, `DISMISSED` y `PENDING` no piden nada, y una review vacía tampoco.

No se usa ningún token en el cuerpo del comentario. El `-REVIEW` del plan existe
porque un issue no tiene mecanismo de review; una pull request sí, y un revisor
va a usar el botón de siempre.

## 4. Dominio y puertos

### 4.1 Puertos nuevos

Dos colaboradores nuevos, porque son dos herramientas distintas: uno habla con
`gh` y el otro con `node dispatch-check.mjs`. Meter los dos en el mismo puerto
obligaría a un adaptador a invocar dos binarios, y la vara pide un adaptador por
puerto y un cliente por herramienta.

`domain/ports/workbench.js`, la vuelta al banco de trabajo:

```js
export class Workbench {
  async reopen({ issue, repository })   // in-review -> in-progress
}
```

Es el hermano exacto de `Harvest.collect()`, que también es un `dispatch-check`
detrás de un puerto propio.

`domain/ports/pull-requests.js`, un colaborador con dos preguntas:

```js
export class PullRequests {
  async openOf({ issue, repository })            // -> { number, url }, o null
  async fixesAsked({ pullRequest, repository })  // -> ChangeAsked[]
}
```

Se parte en dos métodos porque tienen dos lectores: `openOf` la necesitan el
vigilante y el stream de eventos, `fixesAsked` sólo el vigilante.

`openOf` devuelve la dirección además del número porque el cuarto paso enlaza la
pull request, y `gh pr list --json number,url` la da sin código añadido — contra
transcribir el formato de las direcciones de GitHub.

### 4.2 Métodos nuevos en puertos existentes

La vara dice que la respuesta por defecto a comportamiento nuevo es un método en
un tipo que ya existe:

| Puerto | Método | Su consumidor |
|---|---|---|
| `PlanIssues` | `isInReview({ issue, repository })` | la puerta del vigilante y la política de estado |
| `PlanAgents` | `fix({ agent, issue, repository, changes })` | la acción que entrega el fix |

`isInReview` devuelve un booleano y no la etiqueta, y eso es deliberado: la
cadena `status:in-review` es una constante de `GhPlanIssues`, o sea
infraestructura, y una política de dominio no puede mirarla sin invertir la
dirección de las dependencias. El adaptador es el único que conoce el formato de
la etiqueta y lo traduce a la única pregunta que alguien hace sobre ella.

La alternativa —que el puerto declarase el vocabulario de estados y el adaptador
tradujese a él— añade un catálogo entero para responder a una sola pregunta. Qué
llamada se rompe sin ese catálogo: ninguna.

`fix()` es un método propio y no un parámetro de `review()`: son dos encargos con
dos textos distintos, y ésa es la decisión de no unificar los dos bucles.

### 4.3 Value object extraído

`ChangeAsked { id, text }` vive hoy dentro de `gh-plan-issues.js`, tolerado ahí
mientras ese adaptador sea su único consumidor. Con el adaptador nuevo pasa a
tener dos constructores, que es el caso que `architecture.md` declara para
extraerlo: sale a `domain/value-objects/change-asked.js`.

Su `text` sigue siendo una cadena opaca, y el aplanado de cuerpo más comentarios
de línea lo hace **el adaptador**:

```
varias cosas que arreglar
src/foo.js:42: revienta con []
src/bar.js:17: esto sobra
```

Motivo: componer eso es traducir el formato de GitHub a un valor de dominio, y el
adaptador es quien conoce ese formato. El precio, aceptado, es que el brief no
decide cómo se presentan los comentarios de línea. A cambio, el vigilante y el
brief no cambian de forma.

### 4.4 Política de estado

`domain/policies/delivery-policy.js`, con la regla y su vocabulario en el mismo
módulo, que es lo que `policies/` es:

```js
export class DeliveryState {
  static IMPLEMENTING = 'implementing'
  static IN_REVIEW = 'in-review'
  static FIXING = 'fixing'
}

export class DeliveryPolicy {
  static of({ pullRequest, inReview }) {
    if (pullRequest === null) return DeliveryState.IMPLEMENTING
    return inReview ? DeliveryState.IN_REVIEW : DeliveryState.FIXING
  }
}
```

Dos ramas y ninguna inalcanzable. La combinación "no hay pull request pero la
etiqueta dice `in-review`" no tiene rama propia porque el código no la alcanza, y
una condición sobre un estado inalcanzable no es una guarda.

Cualquier estado que no sea `in-review` cae en `FIXING`, que es el lado que **no**
entrega — ante duda, no se teclea.

No hay un `deliversFixes()` aparte: la pregunta se hace comparando con
`DeliveryState.IN_REVIEW`, y un segundo método sería una segunda copia de la
misma tabla sin ninguna llamada que se rompa sin él.

Estos estados no entran en `PlanState` (`writing`, `ready`) porque responden a
otra pregunta: `PlanState` sale del contrato del plan más `git status`, y esto de
la etiqueta más la pull request.

### 4.5 Excepciones

Bajo `PlanFailure`, para que el vigilante las trate como recuperables:

```
PullRequestFailure
  PullRequestNotRead          gh falló
  PullRequestNotUnderstood    gh contestó algo que no se sabe leer
WorkbenchFailure
  SliceNotReopened            dispatch-check --reopen no pudo mover la etiqueta
  ReopenNotUnderstood         dispatch-check --reopen salió con un código no declarado
```

El par `NotRead` y `NotUnderstood` no es mimetismo: `testing.md` lo exige —
*"Both failure causes of every adapter are told apart in its tests (…) and the
test proves one is not an instance of the other"*.

## 5. El flujo del vigilante

### 5.1 El vigilante se generaliza

`plan-review-watch.js` pasa a `review-watch.js` y la clase a `ReviewWatch`, con
un `label` inyectado para el prefijo de sus avisos, que hoy está escrito a pelo.
Se instancia dos veces:

| Instancia | `asked` | `review` | `label` |
|---|---|---|---|
| plan | `ReadChangesAsked` | `ReviewPlan` | `plan review watch` |
| pull request | `ReadFixesAsked` | `RequestFixes` | `pull request review watch` |

El bucle no cambia. Su comportamiento ante un fallo de entrega tampoco: un
cambio se marca como atendido antes de entregarse, y una entrega que falló no se
reintenta. Es una decisión tomada, fijada por
`a_delivery_that_failed_is_not_retried_forever_and_says_so`, y se respeta.

### 5.2 El tick

`application/queries/read-fixes-asked.js`:

```js
pullRequest = pullRequests.openOf({ issue, repository })
if (pullRequest === null) return { changes: [] }                  // implementando

inReview = planIssues.isInReview({ issue, repository })
if (DeliveryPolicy.of({ pullRequest, inReview }) !== DeliveryState.IN_REVIEW) {
  return { changes: [] }                                          // ocupado
}

return { changes: pullRequests.fixesAsked({ pullRequest, repository }) }
```

Llamadas a `gh` por tick: una mientras implementa, dos mientras corrige, cuatro
en revisión. El vigilante usa el `sleep` ya inyectado en `ct-api.mjs:206`, así
que hereda el ritmo del bucle del plan y no trae constante nueva.

### 5.3 La puerta

La segunda guarda es la que evita teclearle encima a un agente a media faena. El
ciclo de la etiqueta es exactamente el ciclo de ocupado y libre: el `--reopen` lo
hace el backend al empezar a corregir, y el `--release` lo repite el agente al
acabar. Sólo se entrega con el issue en `in-review`.

Lo que llegue mientras corrige se queda en GitHub y se recoge en la vuelta
siguiente, cuando el agente haya liberado. No se atropella y no se pierde.

### 5.4 La entrega

`application/actions/request-fixes.js`:

```js
await workbench.reopen({ issue, repository })                  // in-review -> in-progress
await planAgents.fix({ agent, issue, repository, changes })    // cmux send + Enter
```

`--reopen` va **antes** de teclear, por la puerta: si tecleáramos primero habría
una ventana en la que el agente ya está corrigiendo con el issue todavía en
`in-review`, y una segunda review entraría encima.

### 5.5 Los adaptadores

`infrastructure/gh-pull-requests.js` implementa el puerto:

```
gh pr list --repo <o/r> --head feat/<n> --state open --json number,url
gh api repos/<o/r>/pulls/<n>/reviews
gh api repos/<o/r>/pulls/<n>/comments
```

`infrastructure/dispatch-check-workbench.js` implementa `Workbench` siguiendo el molde de
`DispatchCheckHarvest`, proyectando cada código declarado y negándose a
interpretar uno que no lo esté:

| Código | Significado | Proyección |
|---|---|---|
| 0 | reabierto | sigue, teclea el encargo |
| 1 | no se pudo escribir la etiqueta, sigue en `in-review` | `SliceNotReopened` |
| 2 | precondición no cumplida, sin mutar nada | `SliceNotReopened` |
| 3 | no se pudo leer el estado, sin mutar nada | `SliceNotReopened` |
| otro | no declarado | `ReopenNotUnderstood` |

El 2 sólo puede llegar por una carrera, porque la puerta ya garantiza el estado.
No se le da trato especial.

### 5.6 El encargo

`PlanAgentBrief` gana `fixErrandFor({ issueNumber, repository, changes })`,
hermano de `reviewErrandFor`:

> Un humano ha revisado la pull request del issue #N y pide estos cambios:
> «…».
> Corrígelos sobre la rama y el worktree que ya tienes, sin rehacer el plan, sin
> crear worktrees nuevos y sin abrir otra pull request: la que hay sigue abierta
> y recoge lo que pushees.
> Cuando lo tengas en verde, vuelve a liberar con
> `node <dispatchCheck> N --repo <o/r> --release --no-watch-merge`, que devuelve
> el issue a revisión.
> Y entonces PARA: no la mergees.

El segundo `--release` pasa la puerta del go (código 9) porque el compromiso del
go no se consume: `go-registry.js` lo escribe y lo lee, y no lo borra en ningún
sitio; el comentario `-OK <nonce>` sigue en el issue. Queda por confirmar con una
corrida real.

## 6. El contrato de eventos y el frontend

### 6.1 Quién contesta al stream

Todo el relevo ocurre en `ImplementPlanRoute.#accept`, donde hoy están las dos
líneas que apagan el sistema:

```js
reviews.stop({ issue: asked.issue, repository: asked.repository })   // se queda
sessions.forget({ issue: asked.issue, repository: asked.repository })  // se va

const delivering = new PlanWatch({ ...watch, delivering: true })
sessions.remember(delivering)
pullRequestReviews.start(delivering)
```

El vigilante del plan muere —su gate ya está cerrado— y en su lugar arranca el de
la pull request, con la misma sesión marcada. El vigilante sondea desde ese
momento aunque la pull request tarde horas en existir: mientras no exista, su
tick es una sola llamada a `gh`.

`PlanWatch` gana el campo `delivering`, cuyo único consumidor es el stream para
elegir lector.

```
delivering === false  ->  ReadPlanProgress      (contrato del plan y git status)
delivering === true   ->  ReadDeliveryProgress  (pull request y etiqueta)
```

Dos lectores que no se conocen. Un lector único que lo compusiera todo tendría
que leer la etiqueta del issue en cada tick durante toda la fase de plan, para
responder a una pregunta que en esa fase no se hace.

`ReadDeliveryProgress` hace las dos mismas lecturas que el tick del vigilante
(`openOf` e `isInReview`) y las pasa por la misma política. Son dos bucles
independientes con su propio ritmo, así que esas lecturas se duplican: dos
llamadas más a `gh` por tick durante la entrega. Se acepta antes que acoplar el
vigilante al stream para ahorrarlas.

### 6.2 El vocabulario del cable

El frame sigue siendo `{ state }` y su vocabulario pasa de dos valores a cinco:

| Estado | De dónde sale | Qué pinta |
|---|---|---|
| `writing` | `PlanState` | Escribiendo el plan… |
| `ready` | `PlanState` | Plan listo |
| `implementing` | `DeliveryState` | Implementando… |
| `in-review` | `DeliveryState` | Pull request N en revisión |
| `fixing` | `DeliveryState` | Corrigiendo lo pedido… |

Los tres estados de entrega llevan además la pull request:

```json
{ "state": "in-review", "pullRequest": { "number": 42, "url": "https://github.com/o/r/pull/42" } }
```

Un fallo de esa lectura sale por el canal de error que el stream ya tiene, con un
código propio, `delivery-progress-not-read`, para que el test de códigos
distintos siga verde.

### 6.3 El cuarto paso

`WorkflowStepName` gana `'review'`:

```
Solicitud       completado
Plan            completado
Implementación  completado      (en cuanto existe la pull request)
Revisión        activo
                Pull request #42 en revisión — enlace
```

Un detalle de montaje: hoy `PlanProgress` monta `usePlanProgress` dentro de sí.
Si el cuarto paso monta el mismo hook salen dos suscripciones al mismo stream, así
que el hook sube a `Home` y el progreso baja a los dos pasos como propiedad: una
suscripción, dos lectores. Sus tests viven todos en `Home.planEvents.test.tsx`.

El botón "Arrancar otro plan" se muda al paso de Revisión, que es donde el
trabajo termina de verdad.

## 7. Tests

Según `backend/conventions/testing.md`, y con la clase fixture de cada fichero
como su mother:

| Fichero | Qué mide | Su mother |
|---|---|---|
| `read-fixes-asked.test.js` | qué recibió cada puerto y qué devolvió; que sin pull request no se pregunta por reviews, y que con el issue en `in-progress` tampoco | `noPullRequestYet()`, `inReview(...)`, `fixing()`, `askedInALineComment()` |
| `request-fixes.test.js` | el orden: cuando el `--reopen` falla, al agente no se le tecleó nada | `reopened()`, `refusingTheReopen(code)` |
| `gh-pull-requests.test.js` | el argv literal y el parseo de salida grabada real | conversación scriptada |
| `dispatch-check-workbench.test.js` | un escenario por código, y que `NotRead` no es instancia de `NotUnderstood` | uno por código |
| `review-watch.test.js` | los de hoy, más que las dos instancias no se pisan | `WatchDouble` |
| `plan-events-route.test.js` | los cinco estados y el frame con la pull request | `PlanEventsMother` |
| `Home.planEvents.test.tsx` | el cuarto paso y una sola suscripción | `PlanEventsMother.ts` |

El dominio no tiene tests propios: `DeliveryPolicy` se mide a través de las dos
queries que la llevan.

**Las transcripciones tienen que ser reales.** `testing.md` pide *"real
transcripts, not invented shapes"*, así que hay que capturar salidas de verdad de
`gh api .../pulls/<n>/reviews` y `.../comments` sobre una pull request real, con
los tres casos que llegan — cuerpo, comentarios agrupados y comentario de línea
suelto.

## 8. Límites conocidos

Tres, escritos para que no se descubran leyendo el código.

**Un reinicio del backend re-teclea las reviews ya atendidas.** La idempotencia
es el conjunto en memoria del vigilante, no un identificador persistido. Es
coherente con que hoy el backend no persista nada: un reinicio se lleva por
delante la sesión, el vigilante y el stream. Persistir sólo esto sería
incoherente.

**Si el `--reopen` funciona y el `cmux send` falla, el bucle queda parado.** El
issue se queda en `in-progress` sin nadie corrigiendo, la puerta no se reabre
porque nadie va a hacer el `--release`, y el cuarto paso pinta "Corrigiendo lo
pedido…" mientras nadie corrige. Se avisa por el canal de error del vigilante,
sin código nuevo. Decisión tomada: no se parchea hasta saber si ocurre.

**Un comentario en la pestaña Conversation no llega.** Sólo cuenta lo que GitHub
modela como review, según la tabla de la sección 3.

## 9. Lo que queda nombrado para después

- **Vigilar la integración continua y el merge.** Fuera de alcance por decisión.
  `AWAIT_CI` y `AWAIT_MERGE` de `slice-runner` son el mapa si algún día se
  construye.
- **La cosecha del carril web.** `ct-watch-merge` la avisa en el carril del
  plugin tecleando en la sesión coordinadora; en el carril web nadie la recoge.
- **Persistir el estado del bucle.** El día que el backend persista sesiones,
  el identificador de la última review atendida va con ellas.
- **Los comentarios sueltos de la conversación.** Si resulta que la gente los
  usa, se añade la lectura de `issues/<n>/comments` y se decide qué distingue un
  comentario que pide un cambio de uno que sólo comenta.
