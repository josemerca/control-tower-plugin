# El front, endpoint a endpoint — la ruta local del repo y los artefactos del plan

**Fecha:** 2026-09-04
**Repo:** `josemerca/control-tower-plugin`, directorios `frontend/` y `backend/`
**Estado:** propuesta de contrato — el front no puede mergear hasta que el backend acepte `path`
**Alcance:** un campo nuevo en la petición de `POST /start-plan`, dos campos nuevos en su `202`

---

## 1. Qué se construye, y por qué

El equipo de backend lo pidió así:

> «Para hacer lo del server de la api, lo que me vendría de perlas sería que el
> front me indicase la ruta en disco de donde se tiene la copia local del repo,
> para que sepa dónde crear el worktree y mandangas.»

Hoy el backend no recibe ninguna ruta. Corta el worktree en el `cwd` del
proceso `ct-api` (`backend/src/infrastructure/ct-api.mjs`, `const root =
process.cwd()`), y comprueba que el `origin` de ese directorio coincide con el
`repo` que pide el front (`GitWorkspace`, método privado `#confirmRoot`). Si no
coincide, refusa. Consecuencia: para planificar el repo *X*, hay que arrancar
el backend dentro de un checkout de *X*. Un backend, un repo.

Este slice rompe ese amarre. El front manda la ruta; el backend deja de
depender de su propio `cwd`.

La segunda mitad de la pregunta del backend era ésta:

> «Además me comentabas Pedro que te vendría bien que en algún endpoint te
> devolviese más datos para poder presentarlos en el front, pero ya no recuerdo
> cuáles eran.»

Eran los artefactos del plan. La lista larga vive en
`.backlog/plan-artifact-visibility.md`. De esa lista, este slice pide **dos**:
la **rama** y el **worktree**. Los dos ya están en la mano del backend —viven
en el `PlanWatch` que guarda al arrancar— y hoy no se serializan.

Nada más. Ni el documento del plan, ni su commit, ni las etiquetas de GitHub,
ni un `GET /plans`. Ver §7.

---

## 2. El contrato propuesto para `POST /start-plan`

Fuente de lo vigente: `backend/src/infrastructure/start-plan-route.js` (clases
`PlanRequest` y `PlanRefusal`) y sus tests en
`backend/__tests__/infrastructure/`.

### 2.1 La petición gana un campo

| | Cuerpo |
|---|---|
| Hoy | `{"id":"ABC-123","repo":"owner/name"}` |
| Propuesta | `{"id":"ABC-123","repo":"owner/name","path":"/Users/pedro/code/name"}` |

`path` es la ruta absoluta del checkout local de `repo`. Obligatoria, como los
otros dos campos. El orden de las claves importa para los tests del front, que
comparan el cuerpo literal: `id`, `repo`, `path`.

`PlanRequest.KNOWN_FIELDS` tiene que declarar `path`. Hasta entonces, mandarlo
da `400 unknown field: path`, y por eso el código del front espera.

### 2.2 El `202` gana dos campos

| | Cuerpo |
|---|---|
| Hoy | `{"status":"started","id":"ABC-123","repo":"owner/name","issue":{"number":7,"url":"…"},"agent":"workspace:4"}` |
| Propuesta | lo mismo, más `"branch":"feat/7","worktree":"/Users/pedro/code/name/.worktrees/7"` |

Los dos valores ya existen dentro del backend cuando responde:
`started.watch.located.branch` y `started.watch.located.path`
(`backend/src/domain/value-objects/plan-watch.js` y `workspace-location.js`).
La propuesta es serializarlos donde `StartPlanRoute` ya escribe el `202`, sin
tocar el dominio.

### 2.3 Rechazos nuevos, como propuesta

El texto lo fija el backend; el front pinta lo que llegue, tal cual. Estos son
los dos casos que el front sabe explicar al usuario:

| Código | Cuerpo propuesto | Cuándo |
|---|---|---|
| `400` | `{"error":"path must be an absolute path"}` | la ruta no empieza por `/`, o viene vacía |
| `400` | `{"error":"path must be a git checkout of owner/name"}` | la ruta no existe, no es un repo git, o su `origin` no es `repo` |

El segundo ya lo sabe detectar `GitWorkspace`: lanza `WorkspaceNotPrepared` con
el motivo escrito. Hoy sale como `503` por la tabla de `PlanCollapse`. La
propuesta es que un `path` que el usuario escribió mal sea `400` —error de la
petición— y no `503` —fallo del sistema.

---

## 3. Las decisiones del front

- **Un campo de texto, no un selector de directorios.** El navegador no da la
  ruta absoluta de una carpeta: `<input type="file" webkitdirectory>` entrega
  nombres relativos, sin el prefijo del disco. Un selector de verdad exigiría
  otro endpoint del backend que listase directorios. No se construye.
- **La validación de verdad la hace el backend.** El front confía en el
  usuario. Solo comprueba lo que puede comprobar sin tocar el disco: que la
  ruta no está vacía y empieza por `/`. Eso habilita el botón; el resto lo dice
  el backend con su `400`.

  > **Nota (2026-09-04, tras la #84):** el backend valida la ruta con
  > `CheckoutRoot`, que además rechaza la barra final, los segmentos vacíos y
  > los saltos de línea. `LocalPath` copia esa forma, y normaliza la barra
  > final y los espacios de los extremos antes de mandar: es lo que dan el
  > autocompletado del shell y «Copiar como nombre de ruta» del Finder, y
  > cobrar un `400` por eso sería mentir al usuario. Cierra el punto 8 de la
  > deuda declarada en la #84 por el lado del front.
- **No se recuerda la ruta entre sesiones.** Ni `localStorage` ni un endpoint
  de preferencias. Cuando haya más de un repo en juego, se decide entonces.
- **`path` viaja solo en `/start-plan`.** La propuesta al backend es que lo
  recuerde en el `PlanWatch`, junto a la rama y el worktree que ya guarda. Así
  `POST /implement-plan` no gana campos: sigue con `{agent, issue, repo}`.
- **La rama y el worktree se pintan como texto, no como enlace.** Son rutas
  locales; un `href` no lleva a ninguna parte. Van en `<code>`, como ya van el
  repo y el agente.

---

## 4. La pantalla y la copia

El formulario pasa de dos campos a tres:

| Campo | Label | Ayuda |
|---|---|---|
| ticket | «Clave del ticket» | «Con la forma ABC-123» |
| repo | «Repositorio» | «Con la forma owner/name» |
| ruta | «Ruta local» | «Con la forma /Users/tu-usuario/code/name» |

El botón «Arrancar plan» se habilita solo con los tres campos bien formados.

La línea de hechos de `PlanProgress` crece:

> Issue #7 en `owner/name` · agente `workspace:4` · rama `feat/7` · worktree
> `/Users/pedro/code/name/.worktrees/7`

Un `400` por la ruta se pinta como cualquier otro rechazo: `Banner` de error
con `role=alert` y el texto del backend sin tocar.

---

## 5. Tests

- **`LocalPath`** (`frontend/src/app/start-plan/LocalPath.ts`) es el espejo de
  `RepositoryName`: un `EXAMPLE` y un `isWellFormed`. Se prueba desde la
  pantalla, no en aislamiento, como los otros dos validadores.
- **`StartPlanMother`** gana `PATH`, `BRANCH` y `WORKTREE`; su `REQUEST_BODY`
  pasa a los tres campos; el cuerpo de `started()` gana `branch` y `worktree`;
  y aparece una `malformedPath()` con el literal que acuerde el backend.
- **`helpers.tsx`** gana `typePath`, y su `startPlan` escribe también la ruta.
  Los tests de `plan-events` y de `implement-plan` llaman a ese `startPlan`, así
  que se ponen al día solos.
- **Outside-in desde `Home`**, en `Home.startPlan.test.tsx`: el cuerpo exacto
  con `path`; el botón deshabilitado hasta que la ruta está bien formada; la
  rama y el worktree visibles en el progreso; el `400` de ruta con su texto; y
  los tres campos rellenos después de arrancar.

---

## 6. Desarrollo local

Nada nuevo. `vite.config.ts` ya reenvía `/start-plan` al backend quitando el
`Origin`, y `path` es un campo del cuerpo, no una ruta HTTP.

Con `make run-frontend` la página la sirve el propio backend en el 8787. La
ruta que se escriba en el formulario tiene que ser un checkout del `repo` que
se pida, o el backend refusará.

---

## 7. Lo que queda nombrado para después

- **El resto de artefactos.** El documento del plan
  (`docs/superpowers/plans/…`) y su commit, las etiquetas que el backend siembra
  y las transiciones de estado. La lista completa está en
  `.backlog/plan-artifact-visibility.md`. Entrarán cuando el backend los
  publique, seguramente en las tramas de `/plan-events` y no en el `202`.
- **Reanudar tras recargar la página.** Sigue haciendo falta un `GET /plans`
  que liste los planes vigilados; hoy el registro es en memoria. Ya estaba en el
  §7 de `2026-09-02-frontend-plan-events-design.md`.
- **Un selector de directorios de verdad.** Exigiría un endpoint del backend
  que listase carpetas. No se ve necesario mientras haya un repo por sesión.
- **Recordar la ruta por repositorio.** Cuando la pantalla maneje varios
  repos.
- **Lo del §7 de las tres notas anteriores** sigue en pie: el test de frontera
  con el `ApiServer` real y las librerías de la casa.

---

## 8. Preguntas abiertas para el equipo de backend

1. ¿El `path` **sustituye** al `cwd` del proceso, o el `cwd` sigue siendo el
   valor por defecto cuando la petición no trae `path`? El front prefiere que
   `path` sea obligatorio: un valor por defecto invisible es el problema que
   este slice viene a quitar.
2. ¿Se recuerda el `path` en el `PlanWatch`, para que `POST /implement-plan` no
   tenga que pedirlo otra vez?
3. ¿El `worktree` del `202` sale **absoluto** o relativo al `path`? El front
   prefiere absoluto, para poder copiarlo y pegarlo en una terminal.
4. ¿Un `path` malformado es `400` o `503`? El front prefiere `400`: lo escribió
   el usuario, no lo rompió el sistema.
5. ¿Hay un límite sobre dónde puede estar el checkout? El worktree se corta en
   `<path>/.worktrees/<n>`, dentro del propio checkout, así que el backend
   necesita permiso de escritura ahí.
