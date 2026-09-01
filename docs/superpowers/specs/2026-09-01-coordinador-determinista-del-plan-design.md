# El coordinador determinista de la sesión de plan

**Fecha:** 2026-09-01
**Rama:** `alcaptar/lanzar_claude`
**Estado:** diseño aprobado en conversación; nada ejecutado todavía
**Alcance:** una sesión de plan a la vez

---

## 1. Qué se construye

Hoy, quien despacha una sesión de slice en Control Tower es **una sesión de
Claude** que ejecuta `/ct-next`. Ese es el coordinador: un agente que reclama el
issue, prepara el espacio de trabajo, compone el texto de arranque y abre la
ventana.

Este diseño lo sustituye por **un caso de uso**. El coordinador deja de ser un
agente y pasa a ser un programa: los mismos pasos, en el mismo orden, sin juicio
por medio. La sesión que escribe el plan sigue siendo un agente, y sigue
viviendo en una ventana de `cmux` donde una persona puede mirarla.

Lo que se gana no es velocidad: es que el arranque deje de depender de que un
agente interprete bien una instrucción.

---

## 2. Lo que se emula, y lo que se recorta

El despacho del plugin son nueve pasos (`plugin/scripts/ct-next.mjs`). Seis se
emulan y tres se recortan.

| | Paso del plugin | Aquí |
|---|---|---|
| 1 | Precondiciones (`cmux` en el PATH) | **se emula** — el adaptador de `cmux` |
| 2 | Selección: qué issue toca | **se recorta** — el ticket lo pide quien llama |
| 3 | Claim: `status:ready` → `status:in-progress` | **se recorta** — no hay concurrencia que arbitrar |
| 4 | `git worktree add -b feat/<n> .worktrees/<n> origin/<base>` (`:3406`) | **se emula** — puerto `Workspace` |
| 5 | Siembra de `.agent/SLICE.md` con el sha del corte (`:3487`) | **se emula** — ver §5.3 |
| 6 | Composición del informe de arranque (`kickoff.js:149`) | **se emula** — con texto propio, ver §5 |
| 7 | Ventana de `cmux` y arranque del agente | **se emula** — puerto `PlanSession` |
| 8 | Verificación del arranque por centinela | **se emula** — dentro del adaptador, §4 |
| 9 | Sorteo del nonce y vigilante del `-OK` | **se recorta** — ver §9.1 |

Los tres recortes son el andamiaje de dos problemas que este backend todavía no
tiene: **varios slices compitiendo** (pasos 2 y 3) y **un agente que no puede
concederse su propio permiso** (paso 9). Añadirlos ahora sería construir la
respuesta antes que la pregunta.

**El paso 4 no se recorta**, y es la pregunta que más se hace. Lo que compra el
worktree es que el agente tenga un sitio propio donde commitear: el plan no es
un texto que enseñe, es un fichero que escribe, valida y commitea, y que viaja
en la pull request. Sin worktree, esa sesión commitea en el checkout principal,
sobre la rama que haya puesta, encima de lo que esté tocando una persona.

---

## 3. La forma

Tres capas, dependencias hacia dentro. La vara es
`plugin/conventions/architecture.md`.

### 3.1 Dominio

No sabe que existen `cmux`, `git` ni los subprocesos.

| Módulo | Qué es |
|---|---|
| `ticket-key.js` | value object. Ya existe |
| `slice-identity.js` | value object: la clave de Jira y el número de issue de GitHub, juntos. Ver §8 |
| `workspace.js` | **puerto**: prepara el espacio aislado y devuelve dónde quedó |
| `workspace-location.js` | value object: la ruta del worktree y el nombre de la rama |
| `plan-briefing.js` | value object: el texto que arranca al agente y el directorio donde corre |
| `plan-session.js` | **puerto**: arranca la sesión. Ya existe, cambia su firma |
| `plan-session-ref.js` | value object: lo que identifica la sesión viva |
| `plan-progress.js` | **puerto**: contesta en qué estado está el plan de una sesión |
| `plan-state.js` | vocabulario cerrado: `writing`, `ready`. Ver §6.4 |
| `exceptions.js` | ya existe; crece con los fallos del espacio de trabajo |

`PlanSession.start(ticket)` se queda corto: no basta con la clave del ticket
para arrancar nada. Pasa a `start(briefing) -> PlanSessionRef`.

### 3.2 Aplicación

`StartPlan` pasa a conducir tres pasos:

```
execute(params) ->
  1. workspace.prepare(identity)      -> WorkspaceLocation
  2. briefing = PlanBriefing.for(identity, location)
  3. planSession.start(briefing)      -> PlanSessionRef
```

Tres puertos, no una lista que crezca. `application.md` de `agentic-skills` y
`architecture.md` de este repo dicen lo mismo: **conducir no es ejecutar**, y en
cuanto aparezca un cuarto paso cuyo resultado el flujo consuma, cada paso entra
por su propio caso de uso y `StartPlan` sólo los invoca.

Un caso de uso nuevo de sólo lectura, `application/queries/read-plan-progress.js`,
contesta el estado. Vive en `queries/` porque no muta nada.

### 3.3 Infraestructura

| Módulo | Qué es |
|---|---|
| `git-workspace.js` | adaptador de `Workspace`: el `git worktree add -b` |
| `cmux-plan-session.js` | adaptador de `PlanSession`. Ya existe; se le quita el `--command echo` |
| `plan-agent-brief.js` | el texto del agente: qué lee, qué escribe, dónde para |
| `plan-contract-progress.js` | adaptador de `PlanProgress`: el predicado de §6 |
| `api-server.js` | ya existe; gana la ruta de eventos de §7 |

`plan-agent-brief.js` va en infraestructura y no en dominio porque es lo que
define a un agente invocado. Es la misma colocación que
`slice_runner/infrastructure/slice_implementer_brief.py` en `agentic-skills`, y
la convención lo nombra: `{agente}_{rol}.py`.

### 3.4 El flujo de dependencias

```
api-server ──> StartPlan ──> Workspace        <── git-workspace
    │              └──────> PlanSession       <── cmux-plan-session
    │
    └────────> ReadPlanProgress ──> PlanProgress <── plan-contract-progress
```

Nada de `application/` importa de `infrastructure/`. Los adaptadores los
compone `ct-api.mjs`, que es el único sitio que conoce las dos orillas.

---

## 4. El detalle que se queda dentro del adaptador de `cmux`

`cmux new-workspace --command <texto>` **no ejecuta un comando: envía
pulsaciones** al pseudo-terminal recién creado. Lo dice la ayuda embebida en el
binario instalado en esta máquina, y está medido en este repo
(`plugin/scripts/launch-sentinel.js`, cabecera):

> `--command <text>     Send text+Enter to the new workspace after creation`

Esas pulsaciones viajan hacia un shell de login interactivo cuyo arranque puede
imprimir avisos y consumir entrada. La avería que lo destapó: el aviso de
actualización de oh-my-zsh se comió la `c` del comando, quedó
`zsh: command not found: laude`, y el resultado fue una ventana abierta, en el
directorio correcto, con el título correcto y **nada corriendo**.

Por eso el adaptador hace tres cosas que el caso de uso no sabe que existen:

1. **Escribe el informe a disco** y teclea sólo la línea corta que lo carga
   (`. <ruta>`), en vez de teclear varios miles de caracteres.
2. **Escribe un centinela antes de arrancar al agente**: un fichero que sólo
   puede existir si la orden llegó a ejecutarse, y que lleva el `$PWD` real del
   shell y si el binario resolvió en él.
3. **Reenvía la línea** (`cmux send` + `cmux send-key Enter`) si el centinela no
   aparece. Una guarda de idempotencia en el propio script impide que dos
   llegadas arranquen dos agentes.

Nada de esto sube a `application/` ni a `domain/`: es lo que sabe el adaptador
de `cmux` sobre `cmux`, y el día que la sesión deje de vivir en un
pseudo-terminal se va entero con él.

---

## 5. El informe de arranque

### 5.1 Por qué no es `renderKickoff`

El texto del plugin (`plugin/scripts/kickoff.js:149`) le dice al agente que
espere un `-OK <nonce>` para poder seguir, y que sin él `dispatch-check
--release` se negará con exit 9. Como aquí el paso 9 se recorta (§2), **nadie
acuña ese nonce**: reutilizar el texto tal cual le prometería al agente un
permiso que no va a llegar nunca.

Se escribe un texto propio, con los pasos que este diseño sí sostiene.

### 5.2 Qué dice

- Arranque verification-first: confirmar `pwd`, rama, `git log` y baseline
  verde antes de tocar nada.
- Hidratarse del issue de GitHub.
- Leer la vara: los cinco documentos de `plugin/conventions/` más las
  convenciones del repo destino.
- Escribir el plan con `control-tower-loop:writing-plans-prescriptive`.
- Guardarlo como `docs/superpowers/plans/YYYY-MM-DD-issue-<n>-<slug>.md`.
- Validarlo con `node <ruta>/dispatch-check.mjs <n> --repo <o/r> --check-plan`
  hasta exit 0.
- Commitearlo.
- **Parar.** No implementar nada.

Las rutas de `dispatch-check.mjs` se interpolan **absolutas**. El token
`${CLAUDE_PLUGIN_ROOT}` sólo lo sustituye Claude Code al renderizar ficheros de
comando; en un texto plano llegaría literal y produciría un `Cannot find module`
en todos los arranques.

### 5.3 La siembra de `.agent/SLICE.md`

No es opcional, y el motivo no es cosmético. El hook `SessionStart` del plugin
inyecta el fichero de estado en toda sesión del repo, y la precedencia es
`SLICE.md` primero, `STATE.md` después (`plugin/scripts/state-paths.js:58`).
**La presencia del fichero es la señal de "estoy en el worktree de un slice".**

Sin sembrarlo, la sesión de plan cae al `STATE.md` trackeado que venía en la
base — que es el estado de la coordinadora — y arranca creyendo que ella es la
coordinadora. Es exactamente el defecto que F22 arregló, con el vector
invertido.

El fichero tiene que quedar **fuera de la vista de git** antes de escribirse: si
llega a existir sin la regla de exclusión puesta, un `git add -A` del agente se
lo lleva al pull request.

---

## 6. La señal de que el plan está hecho

### 6.1 El predicado

`PlanProgress` contesta con dos hechos, no con uno:

1. **El plan es válido.** `node dispatch-check.mjs <n> --repo <o/r> --check-plan`
   sale con código 0.
2. **El plan está commiteado.** El fichero está en el índice de la rama, no
   sólo en el árbol de trabajo.

Los dos hacen falta porque `--check-plan` es deliberadamente permisivo con el
segundo: su modo es *"el árbol de trabajo, commiteado o no — es el modo de ANTES
de commitear"* (`plugin/scripts/dispatch-check.mjs:718`). Un plan validado y sin
commitear no viaja en el pull request, así que no está hecho.

Lo que hace `--check-plan` es barato y local: lista
`docs/superpowers/plans` con `git ls-files`, busca los ficheros cuyo nombre
lleva el número de issue, y valida cada uno contra el contrato del plan
(`plan-contract.js:525`). **No toca GitHub y no mira etiquetas.**

### 6.2 Por qué el predicado y no el fichero

La alternativa barata es mirar el directorio de planes con `fs.watch`. Se
descarta por dos motivos:

- **El fichero aparece mucho antes de estar terminado.** El agente lo crea y lo
  reescribe varias veces. El primer evento llega en el primer byte, y evitar el
  falso positivo obliga a un *debounce* cuyo valor es una adivinanza.
- **"El fichero existe" no es lo que el sistema acepta como plan hecho.** Si se
  mide un proxy, el backend puede declarar listo un plan que el siguiente paso
  va a rechazar, y esa contradicción la descubre quien usa la aplicación.

Lo que **no** es un motivo para descartarlo, dicho para no venderse de más:
distinguir "ha terminado" de "se ha atascado". Un agente que paró a preguntar
produce el mismo silencio que uno que sigue escribiendo, y eso es cierto
mirando el fichero **y** sondeando el predicado. Esa distinción no la compra
ninguna de las dos: la compra el hook, y el hook queda fuera (§6.3).

### 6.3 Cómo se consulta: sondeo

El backend evalúa el predicado cada pocos segundos mientras haya una sesión
viva. Es la pieza que lleva la verdad y no depende de que nada esté bien
instalado en el worktree del agente.

**Un hook `Stop` que avise por POST queda fuera de este alcance**, decidido en
conversación. Lo que compraría es quitar la latencia del tick, y lo que costaría
está en §9.2. Lo que no compraría es fiabilidad: el `Stop` no significa "el plan
está hecho" sino "el agente ha soltado el control", y de eso hay varios por
sesión — el propio hook del plugin le bloquea el turno en cuanto commitea el
plan, porque `HEAD` se adelanta al `last_commit` de la semilla
(`plugin/scripts/stop.js`), así que el agente actualiza `SLICE.md` y para otra
vez. Dos como mínimo, más los que salgan si pregunta algo o choca con un
permiso.

De ahí el reparto, que es lo que deja la fase 2 barata: **el hook nunca decide,
sólo despierta al predicado.** Cuando se añada, el predicado no cambia y el
frontend tampoco; sólo desaparece el tick.

### 6.4 Los estados

`PlanState` es un vocabulario cerrado:

- `writing` — la sesión vive y el predicado dice que no.
- `ready` — el predicado dice que sí.

Falta el tercero, `stalled` ("el agente soltó el control y el plan sigue sin
estar"), que es el estado en que una persona tiene que mirar. **No se declara
todavía porque sondeando no es distinguible de `writing`**: sin el hook, un
agente parado y un agente escribiendo producen exactamente la misma respuesta
del predicado. Un miembro que nada puede emitir es una rama muerta en todo
`switch` que lo mencione, y llega con la fase 2.

---

## 7. Del backend al frontend

Server-Sent Events sobre el `express` que ya existe: una ruta `GET` que mantiene
la conexión abierta y emite un evento por cambio de estado.

Se elige sobre WebSocket porque el tráfico es en una sola dirección y el
navegador reconecta solo; y sobre que el frontend sondee, porque duplicaría el
tick que la fase 2 existe para borrar.

**`api-server.js` rechaza hoy toda petición que traiga cabecera `Origin`**
(`Browsers.turnAway`), que es toda petición de un navegador. La ruta de eventos
tiene que quedar fuera de esa guarda, y eso es una decisión con consecuencia de
seguridad, no un detalle: se declara aquí para que no entre de tapadillo.

---

## 8. La costura con la otra rama

El caso de uso que crea el issue de GitHub a partir del ticket de Jira vive en
otra rama. Este diseño depende de su salida en un punto concreto y no negociable:

**El contrato del plan indexa por número de issue.** `--check-plan` exige un
entero >= 1 (`dispatch-check.mjs:189`) y busca ficheros
`YYYY-MM-DD-issue-<n>-<slug>.md`. Una clave de Jira (`ABC-123`) no sirve.

Por eso `SliceIdentity` lleva las dos cosas, y `StartPlanParams` pasa de
`{ ticket }` a `{ identity }`. Es el único cambio de firma en la frontera HTTP,
y hay que acordarlo con la otra rama antes de escribirlo.

Si al integrar resulta que el issue todavía no existe cuando se pide el plan, el
diseño no se sostiene tal cual: habría que crear el issue dentro de este flujo o
cambiar el predicado. Se nombra ahora para que no aparezca al final.

---

## 9. Límites, dichos enteros

### 9.1 Sin nonce, el permiso del plan no es un permiso

El gate `plan` del plugin funciona porque el agente **no puede fabricar** el
`-OK <nonce>`: el nonce se sortea fuera de su alcance y `--release` lo
comprueba. Aquí no hay nonce, así que lo que separa el plan de la
implementación es sólo que el texto del informe le dice al agente que pare.

Un agente que decida seguir, sigue. Para este piloto es aceptable porque no hay
`--release` ni pull request automático detrás; deja de serlo en cuanto los haya.

### 9.2 El coste que traerá el hook, anotado antes de traerlo

No es un límite de lo que se construye ahora — el hook queda fuera (§6.3) — pero
la decisión se registra aquí para que la fase 2 no la re-litigue.

Su configuración vive **dentro del worktree del agente**, y el servidor no
autentica nada: un `curl` con el sobre del `Stop` produce el mismo aviso que el
agente. El predicado limita el daño — un aviso falso no convierte un plan
inexistente en `ready`, sólo provoca una comprobación de más — pero el canal es
falsificable, y ya está anotado como tal en §8.2 del diseño de fusión.

Y si el hook no llega a instalarse, no hay aviso ninguno. Tiene que fallar
ruidosamente al instalarlo, y conservar el tick como red.

### 9.3 El arranque se verifica; el trabajo, no

El centinela prueba que la orden se ejecutó, en qué directorio y que el binario
existía. **No prueba que el agente esté haciendo algo útil ni que siga vivo un
minuto después.** Quien cubre eso es el predicado de §6, y sólo por el lado
positivo: sabe decir que el plan está, no sabe decir que la sesión murió.

### 9.4 Una sesión a la vez

Sin claim no hay arbitraje. Dos peticiones simultáneas para el mismo ticket
producen dos `git worktree add` sobre la misma rama; el segundo falla ruidoso,
que es el lado prudente, pero la interfaz no debe ofrecerlo.

---

## 10. Lo que este diseño no hace, a propósito

- No selecciona qué trabajo toca: el ticket lo pide quien llama.
- No reclama el issue ni retiene tokens de área.
- No sortea el nonce ni levanta el vigilante del `-OK`.
- No conduce la implementación: la sesión escribe el plan y para.
- No abre pull request ni libera nada.
- No instala ningún hook en el worktree: la detección es por sondeo (§6.3).
- No declara el estado `stalled`, que no es observable sin el hook (§6.4).
- No importa código del plugin: lo invoca por subproceso, como manda §7 del
  diseño de fusión.
- No toca el flujo del plugin. `/ct-next` sigue existiendo para quien despache
  desde una consola.
