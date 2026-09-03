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
recibe `{"id","repo","root"}`: la historia, el repo de GitHub y la ruta absoluta del clon local donde
cortar el worktree. La API comprueba que esa ruta es un clon cuyo `origin` es `repo`, y de ahí en
adelante todo lo que hoy sabe de la raíz lo saca del worktree que cortó.

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
previo `workspace.confirm({ root, repository })`: una ruta equivocada muere en 503 sin dejar rastro en
GitHub. Es la mejora dirigida al flujo que este cambio ya toca.

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

- `confirm({ root, repository })`: comprueba que `root` es un clon de `repository`. Lanza
  `WorkspaceNotRead` si la ruta no responde a git y `WorkspaceNotPrepared` si el `origin` es otro repo.
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
con `remember(root)` y `known()`. Su adaptador de infraestructura es `MemoryCheckoutRegistry`: un `Set`
por texto de ruta, sin duplicados.

**`SurveyWorkspaces.execute`** recorre `checkouts.known()` y devuelve una encuesta por clon. El
`HarvestClock` barre cada encuesta como hoy barre la única. **`HarvestDelivery`** pasa
`params.prepared.located.root` al `collect`.

## 6. Infraestructura

**`PlanRequest`** (`backend/src/infrastructure/start-plan-route.js`): campo `root` en `KNOWN_FIELDS`,
resultado `MALFORMED_ROOT` y su rechazo 400: `root must be an absolute path to a local clone such as
/Users/you/repos/name`. Los fallos de `confirm` ya están mapeados a 503 en `PlanCollapse`. La respuesta 202
devuelve `root` junto a `id` y `repo`.

**`GitWorkspace`** pierde `root` del constructor. `#repositoryOfRoot(root)` y `#confirmRoot(root,
repository)` se convierten en el `confirm` público. `pathFor`, `argvFor` y compañía ya reciben la raíz.

**`DispatchCheckHarvest`** pierde `root` del constructor y corre `dispatch-check` con `cwd: root` del
`collect`.

**`ct-api.mjs`** deja de leer `process.cwd()`. Construye `MemoryCheckoutRegistry` y se lo da a
`StartPlan` y a `SurveyWorkspaces`. `Invocation` no cambia: el directorio de estado sigue saliendo de
`CLAUDE_CONFIG_DIR`.

**Front** (`frontend/src/app/start-plan/`): campo "Ruta del clon local" en `StartPlanForm`, `root` en
`StartPlan.types.ts`, en el cliente y en `StartPlanMother`. El botón de arrancar sigue deshabilitado hasta
que los tres campos tienen forma. La validación de forma en el front es la misma que en el back: ruta
absoluta.

## 7. Errores

| Situación | Dónde muere | Respuesta |
|---|---|---|
| `root` ausente o no absoluta | `PlanRequest` | 400, antes de tocar nada |
| `root` no responde a `git remote get-url origin` | `confirm` | 503 `WorkspaceNotRead`, sin issue |
| `origin` de `root` es otro repo | `confirm` | 503 `WorkspaceNotPrepared`, sin issue |
| Fallos posteriores | como hoy | como hoy, con las compensaciones de hoy |

## 8. Tests

- `checkout-root.test.js`: formas válidas y rechazadas.
- `plan-request.test.js` y `plan-refusal.test.js`: el campo nuevo, su 400 y que el 202 lo devuelve.
- `git-workspace.test.js`: `confirm` con clon ajeno y con ruta sin git; `prepare` y `survey` con raíz por
  llamada; `undo` desde `located.root`.
- `start-plan.test.js`: `confirm` va antes de `open`; un `confirm` fallido no abre issue; una petición
  aceptada queda en el registro.
- `survey-workspaces.test.js` y `harvest-clock.test.js`: dos clones conocidos producen dos encuestas y se
  cosechan ambos; ninguno conocido no barre nada.
- `dispatch-check-harvest.test.js`: `cwd` es la raíz recibida.
- Front: el botón se habilita con los tres campos y la petición lleva `root`.
- Prueba de punta a punta: API arrancada desde este repo, petición con `repo: jjponz/repo-pulse` y `root:
  /Users/acapdev/repos/repo-pulse`, historia XOP-4909. Es exactamente el caso que hoy peta.

## 9. Lo que este cambio no hace

- No persiste el registro de clones. Declarado en la sección 3.
- No lista clones ni ayuda a elegirlos: la ruta se teclea.
- No toca el plugin: `dispatch-check` ya acepta `--repo` y corre donde le digan.
- No cambia `implement-plan`, `plan-events` ni la vigilancia de cambios: trabajan sobre `located`, que
  ya viene resuelto.
