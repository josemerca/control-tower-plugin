# El claim y el go en el backend — que GitHub vea el slice igual que si lo hubiera despachado `/ct-next`

**Fecha:** 2026-09-02
**Alcance:** `POST /start-plan` reclama el issue; `POST /implement-plan` acuña el go y el agente libera con `--release`
**Nace de:** la rama `alcaptar/implement_plan`, porque cambia el encargo que esa rama introduce
**Vara:** `backend/conventions/` entera, más `plugin/conventions/style.md`, `defects.md`, `decisions.md` y `testing.md`

---

## 1. El problema: el flujo de la app deja el issue en un estado que el plugin no reconoce

El backend crea el issue con `status:ready` y ya no lo toca. El encargo de implementación le prohíbe al
agente ejecutar `dispatch-check --release`, porque saldría por exit 9: no hay go registrado. Consecuencia,
medida contra lo que cada programa del plugin lee de GitHub:

| Programa | Qué ve | Qué hace con ello |
|---|---|---|
| `/ct-next` | un issue `ready` con un agente trabajando dentro | lo selecciona; se niega al ver `.worktrees/<n>`, pero con un mensaje que habla de residuo, no de un slice en marcha |
| `/ct-status` | un issue `ready` con una pull request abierta | lo enseña como listo para despachar |
| `/ct-harvest` | ningún `labeled status:in-progress` ni `status:in-review` | `ready→claim` y `claim→release` a `null`: la medida del coste del slice sale vacía |
| `dispatch-check --release` | sin registro del go, issue fuera de `in-progress` | exit 9 |

Y con `--release` prohibido se pierden sus otras cuatro puertas: plan válido commiteado, run entregado, rama
sin `.agent/STATE.md`, recorridos e2e cubiertos.

La deuda se declaró al construir `POST /implement-plan` (PR #66, cuyo diseño no viaja en el repo) y este
documento la cobra. Va **antes** de la cosecha: cosechar sobre un issue que GitHub cree en cola sería
construir sobre el estado equivocado.

---

## 2. Las decisiones

### 2.1 El claim, como en el plugin

`/ct-next` reclama el issue (`status:ready` → `status:in-progress`) como primer acto que muta, antes del
worktree y de la rama; y si muere después, lo devuelve a `ready` (`attemptRevertClaim`). El backend hace lo
mismo y en el mismo orden:

```
historia → issue (nace en status:ready) → CLAIM → worktree → agente
```

Si el worktree o el agente fallan, se deshace el worktree **y se devuelve el issue a `ready`**. Ningún
claim rancio nace del backend.

Descartado: crear el issue directamente en `status:in-progress`. Ahorra una llamada a `gh`, pero el
timeline de GitHub perdería el `labeled status:ready` y el flujo dejaría de ser indistinguible del plugin.
Se decidió pagar la llamada.

### 2.2 El go lo acuña el backend, en la misma petición en que reanuda al agente

El gate `plan` del plugin es un secreto compartido: al despachar se sortea un nonce, se guarda **sólo su
sha256** en `~/.claude/control-tower/go/<owner>__<name>-<n>.json`, la persona contesta `-OK <nonce>` en el
issue, y `--release` comprueba que algún comentario encaja con el hash. El agente no conoce el nonce: no
está en su worktree, ni en el issue antes del go, ni en su contexto.

Aquí la decisión humana es el botón del front. El backend, al recibir `POST /implement-plan`:

1. acuña el nonce y escribe el fichero del registro;
2. comenta `-OK <nonce>` en el issue;
3. teclea el encargo de implementación, que ahora **manda** liberar con `--release`.

El agente, al entregar, ejecuta `--release`: encuentra el hash, encuentra el comentario, mueve el issue a
`status:in-review`. GitHub queda exactamente como lo dejaría un despacho de `/ct-next`.

**Lo que esto no compra, dicho sin adorno.** El nonce en el plugin protege de que el agente se dé el go a sí
mismo. Aquí quien acuña y quien contesta es el mismo programa, con la misma cuenta de `gh` que usa el
agente. Y lo que se conserva hay que decirlo con precisión: el nonce **no pasa por el contexto del agente
antes del go**, que es lo que impide fabricarlo. Después del go sí es legible —está en un comentario del
issue y el agente tiene `gh`—, y da igual: la puerta ya se abrió. No se construye un
verificador independiente, que el plugin tampoco tiene
(`docs/superpowers/specs/2026-08-31-fusion-con-app-companion-design.md`, §8.2). No se hace por
seguridad: se hace para que el flujo de la app hable el mismo idioma que el plugin en GitHub.

Si el paso 2 o el 3 fallan, la persona vuelve a pulsar: el nuevo registro sobreescribe el hash y el
comentario anterior deja de encajar. Es el comportamiento de `ct-go.mjs` («el anterior ya no vale»).

### 2.3 Sin importar nada nuevo del plugin

Decisión de quien mantiene el backend: lo que haga falta se escribe en `backend/`, no se importa de
`plugin/scripts/`. Las importaciones que ya existen no se tocan.

El formato del registro y del comentario los lee otro programa del mismo repositorio, así que aplica la
regla de `backend/conventions/testing.md` para payloads de frontera: **lo que escribe el backend se alimenta
al lector real del plugin en un test de contrato** —`readGoCommitment` de `go-registry.js` y `matchesGo`
de `go-response.js`— y el test falla el día que uno de los dos cambie. Los tests importan al plugin; el
código de producción, no. Es la copia declarada de `plugin/conventions/decisions.md`: las dos mitades de
un contrato que cruza un proceso existen dos veces, medidas por un test que las compara.

### 2.4 Las labels que el backend escribe las siembra el backend

Verificado en `groom.js:326-352`: `gh issue edit --add-label` resuelve el nombre a un id y **falla si la
label no existe en el repo**. `/ct-groom` siembra el vocabulario `status:` entero por eso, pero en el flujo
de la app no hay groom. `open` ya siembra sobre la marcha lo que `issue create` necesita; `claim` hace lo
mismo con `status:in-progress`, con la misma vuelta, y sólo con labels nuestras.

**Y la que escribe el programa que invocamos también.** `--release` escribe `status:in-review` con el
`setStatus` del plugin, que **no** siembra: en un repo que nunca pasó por `/ct-groom` el agente moriría al
liberar con «reintenta más tarde», consejo que no puede funcionar. La primera versión de este diseño lo
dejó fuera con el argumento de que la decisión de sembrar vive donde se escribe la label. Un juez
adversarial lo tumbó, y con razón: **es este slice el que hace que el encargo ordene `--release`**, y quien
crea una precondición la posee. Así que `claim` siembra `status:in-review` antes de reclamar, y si no puede,
**no reclama** — el motivo nombra la label y dice que el release no podrá crearla. Cuesta una llamada
idempotente por despacho y cierra el único agujero que dejaba morir el flujo en su última puerta.

Lo que sigue fuera: sembrar desde dentro del plugin, que es otra decisión y otro slice.

### 2.5 El vigilante del merge se deja correr

`--release` lanza `ct-watch-merge.mjs`, que busca una sesión coordinadora en el checkout principal para
avisarle del merge. En el flujo de la app no la hay: verá el merge, no encontrará a quién decírselo, lo
escribirá en su log y saldrá con 1. Es ruido en `~/.claude/control-tower/log/`, no un fallo. Qué hacer con
él es decisión de la cosecha, no de este slice.

---

## 3. El contrato HTTP

Ninguna petición ni respuesta de éxito cambia. El nonce **no viaja en ninguna respuesta**.

### `POST /start-plan`

Un 503 nuevo: `could not start the plan: gh issue edit failed: …`, cuando el claim no se pudo escribir. El
issue sigue en `status:ready`, no hay worktree.

### `POST /implement-plan`

**Un campo vuelve a la petición: `repo`.** La PR #66 lo recortó de las cinco capas con el argumento medido
de que «su única utilidad era una cláusula del encargo, y `ct-step`, `gh pr create` y el nombre de la
pestaña no lo necesitan». Este slice cambia esa premisa y el campo vuelve con tres consumidores, no con una
frase: el nombre del fichero del registro, el `--repo` de `gh issue comment` y el `--repo` del `--release`
que el encargo ahora manda ejecutar. La petición es `{ agent, issue, repo }`; la respuesta de éxito no
cambia y sigue devolviendo sólo `agent` e `issue`.

Un 400 nuevo: `repo must be a repository such as owner/name`.

Dos 503 nuevos, ambos «la herramienta se negó, reintentar puede funcionar»:

| Causa | Estado del mundo al responder |
|---|---|
| el fichero del registro no se pudo escribir | nada cambió |
| `gh issue comment` falló | el registro tiene un hash que ningún comentario contesta; `--release` saldría por 9 hasta que se vuelva a pulsar |

No hay 502 en ninguna de las tres operaciones: ni el claim, ni el registro, ni el comentario leen nada de
vuelta. Son familias de una sola causa, como `PlanAgentNotResumed`, y se declara aquí para que no se lean
como familias a medio escribir.

---

## 4. Las piezas

Lo mínimo que resuelve §1. Cada tipo nuevo se justifica por `backend/conventions/architecture.md` («un
tipo nuevo tiene la carga de la prueba»); lo que se consideró y no entró está en §4.4.

### 4.1 Dominio

- **`GoRegistry`**, puerto nuevo con un método: `mint({ issueNumber, repository })` → el nonce, una cadena. El
  colaborador es nuevo —el registro en disco que `dispatch-check` lee— y un puerto corta por quién está
  enfrente.
- **`PlanIssues`** gana tres métodos, porque el colaborador es el mismo: `claim({ issue, repository })`,
  `requeue({ issue, repository })` y `answerGo({ issue, repository, nonce })`.
- **Excepciones**: `PlanIssueNotClaimed` y `PlanGoNotAnswered` bajo `PlanIssueFailure`; `GoFailure`
  con `GoNotRecorded`, familia de una causa como ya lo es `PlanProgressFailure`. **`requeue` no
  tiene excepción propia**: sólo se llama compensando un fallo que ya se está reportando, así que
  un tipo nuevo habría que declararlo igualmente en `PlanCollapse` para que el test de
  exhaustividad siguiera verde, y esa proyección sería muerta — un status para un fallo que no
  puede llegar a un cliente. Avisa por el `stderr` inyectado nombrando el comando exacto, como ya
  hace `GitWorkspace`.

### 4.2 Aplicación

**`StartPlan.execute`**, en este orden:

```
detail → open → claim → prepare → launch
```

Compensación: si `prepare` falla, `requeue`. Si `launch` falla, `undo` del worktree y `requeue`. Los dos
se tragan como hoy se traga `undo`. Si `claim` falla, nada que deshacer: el issue está en `ready` sin
worktree, igual que hoy cuando falla `prepare`.

**`ImplementPlan.execute`**, tres pasos:

```
goRegistry.mint → planIssues.answerGo → planAgents.resume
```

Sin compensación: volver a pulsar reemite el go (§2.2). Gana `goRegistry` y `planIssues` en su
constructor.

### 4.3 Infraestructura

- **`disk-go-registry.js`**, módulo nuevo, adaptador de `GoRegistry`. Recibe inyectados `random(bytes)`
  para que el test fije el nonce, `write(path, text)` y la raíz del estado de Control Tower. Sus métodos
  estáticos componen el formato, como `argvFor` en los demás adaptadores:
  - nonce: cuatro bytes aleatorios en hexadecimal minúscula;
  - ruta: `<raíz>/go/<owner>__<name>-<n>.json`, donde `/` del repo pasa a `__`; sin saneador de
    caracteres, porque `RepositoryName` ya restringe la forma;
  - contenido: `JSON.stringify({ repo, issue, commitment }, null, 2)` más salto de línea;
  - `commitment`: sha256 hexadecimal del nonce.
- **`gh-plan-issues.js`**: `claim` → `gh issue edit <n> --repo <r> --add-label status:in-progress
  --remove-label status:ready`; `requeue` → lo simétrico; `answerGo` → `gh issue comment <n> --repo <r>
  --body "-OK <nonce>"`. Ninguna es `safeToRepeat`: son escrituras. `claim` siembra la label que falte
  con la misma vuelta que `open` ya da (`Gh.labelMissingIn` → `label create --force` → reintento), que
  pasa a recibir el argv en vez de componerlo, porque las dos escrituras fallan por la misma causa y se
  arreglan igual. `requeue` no lanza ante un rechazo: escribe en el `stderr` inyectado el
  `gh issue edit … --add-label status:ready --remove-label status:in-progress` que una persona puede
  ejecutar, con la forma que ya usa `GitWorkspace`, que gana ese parámetro en el constructor.
- **`plan-agent-brief.js`**: el encargo de implementación pierde las dos frases de la prohibición y gana
  «al entregar, libera con `node <dispatch-check> <n> --repo <r> --release` y PARA». La ruta de
  `dispatch-check` ya está en el constructor.
- **`start-plan-route.js` / `implement-plan-route.js`**: las proyecciones de colapso ganan sus causas
  nuevas, todas a 503. Los tests de exhaustividad que ya existen son los que obligan a añadirlas.
- **`ct-api.mjs`**: monta `DiskGoRegistry` con `randomBytes`, `Disk.write` y
  `CLAUDE_CONFIG_DIR ?? ~/.claude` como raíz, que es donde `dispatch-check` busca (`controlTowerDir`), y se
  lo pasa a `ImplementPlan` junto con el `GhPlanIssues` que ya construye para `StartPlan`.

### 4.4 Lo que se consideró y no entra

- **Un value object para el nonce.** Lo compone el propio adaptador a partir de bytes aleatorios: no hay
  forma inválida que guardar ni álgebra que ofrecer. Una cadena que viaja de `mint` a `answerGo` basta.
- **Permisos `0700`/`0600` en el registro**, como escribe el plugin. Ningún lector los comprueba y el
  fichero guarda un hash, no el nonce. Exigiría una escritura distinta de `Disk.write` para nada medible.
- **Tipos con nombre para el fichero del registro y el comentario.** Son un template literal y un
  `JSON.stringify`: métodos estáticos del adaptador que los escribe.
- **Sembrar `status:in-review` desde el backend** para que `--release` no muera en un repo sin groom. La
  label la escribe el plugin; sembrarla aquí sería decidir por él (§2.4).

---

## 5. Tests

Los tipos que `backend/conventions/testing.md` manda, y ninguno más:

- **Casos de uso, outside-in**: `StartPlan` pide `claim` antes de `prepare`, y `requeue` cuando `prepare`
  o `launch` fallan; cuando `claim` falla, `prepare` nunca fue preguntado. `ImplementPlan` pide `mint`,
  luego `answerGo` con el nonce que `mint` devolvió, luego `resume`; cuando `answerGo` falla, `resume`
  nunca fue preguntado.
- **Adaptadores, cortando antes de la herramienta**: el argv literal de `claim`, `requeue` y `answerGo`;
  la siembra de `status:in-progress` cuando `gh` dice que falta; la ruta y el texto literal que escribe
  `DiskGoRegistry` con un `random` fijado.
- **Frontera con el plugin**: el texto que escribe `DiskGoRegistry` se lee con `readGoCommitment` y el
  comentario de `answerGo` se comprueba con `matchesGo` contra ese `commitment`.
- **Controladores**: cada causa nueva proyecta al 503 con el cuerpo literal; el catálogo de
  `declaredFailures()` cubre el de `exceptions.js`.
- **Entrypoint**: sin cambios. El camino feliz real ya cubre el montaje; lo nuevo no añade wiring que un
  proceso pueda observar sin `gh`.

---

## 6. Lo que se recupera y lo que queda fuera

Al dejar correr `--release`: el issue pasa por `in-progress` e `in-review`, `/ct-next` no lo redespacha,
`/ct-status` lo enseña bien, `/ct-harvest` mide sus fases, y vuelven las puertas del plan válido, el run
entregado, la rama sin `STATE.md` y los recorridos e2e —que aquí pasan vacíos porque el issue no declara
`## E2E`.

Fuera de este slice: la cosecha (merge, worktree, rama, pestaña); el front; el `STATE.md` de la
coordinadora; comprobar que la pestaña siga viva; la siembra de `status:in-review` en el plugin (§2.4); y
qué hacer con el vigilante del merge (§2.5).
