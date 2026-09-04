# El clon viaja en la petición — la API se arranca en cualquier sitio y gobierna cualquier repo

**Fecha:** 2026-09-03
**Repo:** `josemerca/control-tower-plugin`, directorios `backend/` y `frontend/`
**Estado:** diseño aprobado, nada ejecutado todavía
**Alcance:** el backend deja de leer `process.cwd()`; el front manda la ruta del clon. El plugin no se toca

---

## 1. El problema

La API toma `process.cwd()` como raíz del repo gobernado (`backend/src/infrastructure/ct-api.mjs`,
`CtApi.run`). Antes de cortar el worktree, `GitWorkspace.#confirmRoot` compara el `origin` de esa raíz con
el campo `repo` de la petición y, si no coinciden, lanza `WorkspaceNotPrepared`:

```
/Users/acapdev/orca/workspaces/control-tower-plugin/api_server holds josemerca/control-tower-plugin
and the issue lives in jjponz/repo-pulse: cutting a worktree here would plan one repository inside another
```

Es lo que pasó el 2026-09-03 arrancando la API desde este repo para pedir faena en `jjponz/repo-pulse`: el
issue #41 de repo-pulse nació, fue reclamado, la preparación falló y volvió a `status:ready` sin que nada
más ocurriera. Se reprodujo en pequeño llamando a `prepare()` con las dos raíces: con la de este repo
falla, con el clon de repo-pulse corta. Que el otro ordenador tuviera o no clonado repo-pulse es
irrelevante: el código no busca clones en ninguna parte, sólo mira el directorio donde nació.

La consecuencia de diseño: el campo `repo` de la petición **confirma** el repo, no lo **elige**. La API
gobierna un único repo por proceso, y hay que arrancar un proceso dentro de cada clon.

## 2. Qué se construye

La raíz del clon deja de ser un dato de arranque y pasa a ser un dato de la petición. `POST /start-plan`
recibe `{"id","repo","path"}`: la historia, el repo de GitHub y la ruta absoluta del clon local donde
cortar el worktree. En la petición el campo se llama `path` porque así lo fijó el contrato publicado por
el front; el dominio sigue llamándolo `root`, como se ve en el §4. La API comprueba que esa ruta es un
clon cuyo `origin` es `repo`, y de ahí en adelante todo lo que hoy sabe de la raíz lo saca del worktree
que cortó.

Con eso la API se arranca desde cualquier directorio y cada petición trae su repo.

## 3. Decisiones tomadas y descartadas

**Quién aporta la ruta: el front.** Un campo nuevo en el formulario. Cero configuración en la API, ninguna
convención sobre dónde viven los clones.

| Alternativa | Por qué no |
|---|---|
| Directorio de clones señalado por variable de entorno, la API busca `<dir>/<name>` | Impone una convención de disco que no existe hoy y una variable más que recordar en cada máquina |
| La API clona bajo demanda en su directorio de estado | Duplica repos que el usuario ya tiene y el primer arranque tarda lo que tarde el clon |
| Registro explícito repo → ruta en un fichero | Un fichero más que mantener a mano por máquina |
| `GET /repos` que lista clones y desplegable en el front | Necesita el directorio de clones de la primera alternativa, más una ruta y una pantalla |

**Confirmar el clon antes de abrir el issue.** Hoy `StartPlan` abre y reclama el issue antes de tocar el
disco (`backend/src/application/actions/start-plan.js`), y por eso el #41 quedó huérfano. Se añade un paso
previo `workspace.confirm({ root, repository })`: una ruta equivocada muere en 400 sin dejar rastro en
GitHub, porque es el usuario quien la escribió mal, no el sistema. Es la mejora dirigida al flujo que
este cambio ya toca.

**El registro de clones vive en memoria.** El reloj de cosecha necesita saber qué clones barrer. Los
aprende de las peticiones aceptadas y los guarda en el proceso. Limitación asumida y declarada: tras
reiniciar la API, un worktree cortado antes no se cosecha hasta que alguien pide otro plan en ese clon. Si
el reinicio molesta de verdad, el registro se persiste en el directorio de estado igual que
`DiskGoRegistry`. No se hace ahora.

## 4. Dominio

**Value object nuevo `CheckoutRoot`** (`backend/src/domain/value-objects/checkout-root.js`). Lleva el
texto de la ruta y valida forma: cadena, ruta absoluta. No valida existencia ni que sea un clon: eso es
git y lo hace infraestructura. Sigue el patrón de `RepositoryName` y `UserStoryKey`: `isWellFormed`,
`EXAMPLE`, `toString`.

**`WorkspaceLocation` gana `root`.** Hoy lleva `path` y `branch`. Con `root`, `undo` sabe desde dónde
correr `git worktree remove` y la cosecha sabe desde dónde correr `dispatch-check`, sin estado global.
`WorktreeListing.surveyOf` ya recibe la raíz y la puede sembrar en cada localización.

**Puerto `Workspace`** (`backend/src/domain/ports/workspace.js`):

- `confirm({ root, repository })`: comprueba que `root` es un clon de `repository`. Sus tres formas de
  fallar —la ruta no responde a git, su `origin` no se puede leer como `owner/name`, o su `origin` es
  otro repo— lanzan todas `CheckoutNotConfirmed`: las tres son la ruta que el usuario escribió, no el
  sistema, quien está mal.
- `prepare({ issue, repository, root })`: lo de hoy con la raíz por parámetro.
- `survey(root)`: lo de hoy con la raíz por parámetro.
- `undo(located)`: sin cambios de firma; lee `located.root`.

**Puerto `Harvest`** (`backend/src/domain/ports/harvest.js`): `collect({ issueNumber, repository, root })`.

## 5. Aplicación

**`StartPlanParams`** lleva `root` (un `CheckoutRoot`). **`StartPlan.execute`** pasa a:

1. `workspace.confirm({ root, repository })`
2. `userStories.detail(story)`
3. `planIssues.open` y `planIssues.claim`
4. `workspace.prepare({ issue, repository, root })`, con la compensación de hoy
5. `planAgents.launch`, con la compensación de hoy
6. `checkouts.remember(root)`

`checkouts` es el puerto nuevo **`CheckoutRegistry`** (`backend/src/domain/ports/checkout-registry.js`)
con `remember(root)` y `known()`. Su adaptador de infraestructura es `MemoryCheckoutRegistry`: un mapa por
texto de ruta, sin duplicados.

**`SurveyWorkspaces.execute(params)`** recibe la raíz en `SurveyWorkspacesParams` y encuesta ese clon. Es
el **`HarvestClock`** quien pregunta al registro qué clones conoce y encuesta cada uno por separado: un clon
que no se puede encuestar deja su línea en stderr y el siguiente se encuesta igual, en vez de que un clon
borrado bloquee la cosecha de todos. **`HarvestDelivery`** pasa `params.prepared.located.root` al `collect`.

## 6. Infraestructura

**`PlanRequest`** (`backend/src/infrastructure/start-plan-route.js`): campo `path` en `KNOWN_FIELDS`
—el contrato del front fija ese nombre en el cable, y `PlanRequest.root` sigue llamando así al valor ya
convertido en `CheckoutRoot`—, resultado `MALFORMED_PATH` y su rechazo 400: `path must be an absolute
path`. `PlanCollapse` mapea `CheckoutNotConfirmed` a 400 con `path must be a git checkout of owner/name`
seguido de lo que dijo git; el resto de fallos de `confirm` que hoy sigue habiendo en la familia
`WorkspaceFailure` (`WorkspaceNotPrepared` por una rama ya ocupada, `WorkspaceNotUnderstood` en otros
puntos) conservan sus estados de antes. La respuesta 202 gana `branch` y `worktree`: los lee de
`started.watch.located.branch` y `.path`, porque el front los pidió para pintarlos y un campo sin lector
no viaja.

**`GitWorkspace`** pierde `root` del constructor. `#repositoryOfRoot(root)` y `#confirmRoot(root,
repository)` se convierten en el `confirm` público, y `prepare` deja de confirmar por su cuenta: la
comprobación ocurre una vez, en la puerta, y `prepare` sólo lo llama código propio que ya confirmó. `pathFor`,
`argvFor` y compañía ya reciben la raíz.

**`DispatchCheckHarvest`** pierde `root` del constructor y corre `dispatch-check` con `cwd: root` del
`collect`.

**`ct-api.mjs`** deja de leer `process.cwd()`. Construye `MemoryCheckoutRegistry` y se lo da a
`StartPlan` y al `HarvestClock`. `Invocation` no cambia: el directorio de estado sigue saliendo de
`CLAUDE_CONFIG_DIR`.

**Front** (`frontend/src/app/start-plan/`): campo "Ruta del clon local" en `StartPlanForm`, `root` en
`StartPlan.types.ts`, en el cliente y en `StartPlanMother`. El botón de arrancar sigue deshabilitado hasta
que los tres campos tienen forma. La validación de forma en el front es la misma que en el back: ruta
absoluta, sin segmentos vacíos ni barra final, porque `git worktree list` imprime rutas normalizadas y una
raíz con barra final haría que la encuesta no reconociera nunca sus propios worktrees.

## 7. Errores

| Situación | Dónde muere | Respuesta |
|---|---|---|
| `path` ausente o no absoluta | `PlanRequest` | 400 `path must be an absolute path`, antes de tocar nada |
| `path` no responde a `git remote get-url origin` | `confirm` | 400 `CheckoutNotConfirmed`, sin issue |
| `origin` de `path` no se puede leer como `owner/name` | `confirm` | 400 `CheckoutNotConfirmed`, sin issue |
| `origin` de `path` es otro repo | `confirm` | 400 `CheckoutNotConfirmed`, sin issue |
| Fallos posteriores | como hoy | como hoy, con las compensaciones de hoy |

Los tres primeros fallos de `confirm` responden con `path must be a git checkout of owner/name` seguido
de lo que dijo git, porque las tres son la ruta que escribió el usuario, no el sistema. `confirm` ya no
produce un 503: esa respuesta queda para lo que sí es el sistema fallando (un tool que se puede
reintentar), y `survey` —que comparte con `confirm` el método privado que lee el remoto— sigue lanzando
`WorkspaceNotRead`/`WorkspaceNotUnderstood`, porque una cosecha que no puede leer un clon tiene que
seguir reintentando, no convertirse en un error de petición.

## 8. Tests

Siguen `backend/conventions/testing.md`: el dominio no tiene tests propios, se cubre desde la petición y
desde el caso de uso.

- `plan-request.test.js` y `api-server.test.js`: el campo nuevo, las formas rechazadas y su 400 literal, que
  una petición rechazada no llega al caso de uso, y que la raíz aceptada llega al caso de uso como valor.
- `start-plan.test.js`: `confirm` va antes de leer la historia; un `confirm` fallido no lee nada ni abre issue;
  `prepare` recibe la raíz; una petición que arranca queda en el registro y una que falla no.
- `git-workspace.test.js`: `confirm` con clon ajeno, con ruta sin git y con las dos formas de remoto;
  `prepare` ya no pregunta por el remoto; `survey` y `undo` con la raíz que reciben; `located.root`.
- `memory-checkout-registry.test.js`: nada conocido al arrancar; la misma raíz dos veces se conoce una.
- `survey-workspaces.test.js`: la raíz de los parámetros es la que se encuesta.
- `harvest-clock.test.js`: dos clones conocidos se encuestan y cosechan ambos; uno que no se puede encuestar
  deja su línea y el siguiente se encuesta; ninguno conocido sólo duerme.
- `harvest-delivery.test.js` y `dispatch-check-harvest.test.js`: `collect` recibe la raíz del worktree y
  `dispatch-check` corre con ese `cwd`.
- `ct-api-real-process.test.js`: la petición entera llega a git primero, con una raíz que no existe.
- Front: el botón se habilita con los tres campos y la petición lleva `path`.
- Prueba de punta a punta a mano: API arrancada desde este repo, petición con `repo: jjponz/repo-pulse` y
  `path: /Users/acapdev/repos/repo-pulse`, historia XOP-4909. Es exactamente el caso que hoy peta.

## 9. Lo que este cambio no hace

- No persiste el registro de clones. Declarado en la sección 3.
- No lista clones ni ayuda a elegirlos: la ruta se teclea.
- No toca el plugin: `dispatch-check` ya acepta `--repo` y corre donde le digan.
- No cambia `implement-plan`, `plan-events` ni la vigilancia de cambios: trabajan sobre `located`, que
  ya viene resuelto.
