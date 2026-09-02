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

La deuda ya estaba declarada (diseño de implement-plan, §5.2 y §5.3). Este documento la cobra, y va **antes**
de la cosecha: cosechar sobre un issue que GitHub cree en cola sería construir sobre el estado equivocado.

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
agente. Se conserva lo que importa —el nonce nunca pasa por el contexto del agente— y no se construye un
verificador independiente, que el plugin tampoco tiene (diseño de la fusión, §8.2). No se hace por
seguridad: se hace para que el flujo de la app hable el mismo idioma que el plugin en GitHub.

Si el paso 2 o el 3 fallan, la persona vuelve a pulsar: el nuevo `mint` sobreescribe el hash y el
comentario anterior deja de encajar. Es el comportamiento de `ct-go.mjs` («el anterior ya no vale»).

### 2.3 Sin importar nada nuevo del plugin

Decisión de quien mantiene el backend: lo que haga falta se escribe en `backend/`, no se importa de
`plugin/scripts/`. Las importaciones que ya existen no se tocan.

El formato del registro y del comentario los lee otro programa del mismo repositorio, así que aplica la
regla de `backend/conventions/testing.md` para payloads de frontera: **lo que escribe el backend se alimenta
al lector real del plugin en un test de contrato** —`readGoCommitment` de `go-registry.js` y `matchesGo`
de `go-response.js`— y el test falla el día que uno de los dos cambie. Los tests importan al plugin; el
código de producción, no.

### 2.4 El vigilante del merge se deja correr

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

### 4.1 Dominio

- **`PlanGo`**, value object: el nonce, ocho caracteres hexadecimales en minúscula. Guarda esa forma y
  nada más. No calcula el hash ni compone el comentario: esos son formatos de frontera y viven con el
  adaptador que los escribe (`backend/conventions/architecture.md`: «el payload que sólo su dueño
  construye comparte el fichero del dueño»).
- **`GoRegistry`**, puerto nuevo con un método: `mint({ issue, repository })` → `PlanGo`. El colaborador
  es nuevo —el registro que `dispatch-check` lee— y un puerto corta por quién está enfrente.
- **`PlanIssues`** gana tres métodos, porque el colaborador es el mismo: `claim({ issue, repository })`,
  `requeue({ issue, repository })` y `answerGo({ issue, repository, go })`.
- **Excepciones**: `PlanIssueNotClaimed` y `PlanGoNotAnswered` bajo `PlanIssueFailure`; `GoFailure` con
  `GoNotRecorded`. `requeue` no tiene excepción propia: sólo se llama en compensación y su fallo se avisa
  por stderr y se traga, como hoy el `undo` del worktree.

### 4.2 Aplicación

**`StartPlan.execute`**, en este orden:

```
detail → open → claim → prepare → launch
```

Compensación: si `prepare` falla, `requeue`. Si `launch` falla, `undo` del worktree y `requeue`. Si
`claim` falla, nada que deshacer: el issue está en `ready` sin worktree, igual que hoy cuando falla
`prepare`.

**`ImplementPlan.execute`**, tres pasos:

```
goRegistry.mint → planIssues.answerGo → planAgents.resume
```

Sin compensación: volver a pulsar reemite el go (§2.2). Gana el puerto `goRegistry` y `planIssues` en su
constructor.

### 4.3 Infraestructura

- **`disk-go-registry.js`**: adaptador de `GoRegistry`. Recibe inyectados `random(bytes)` (para que el
  test fije el nonce), `write(path, text)` y la raíz del estado de Control Tower. Dentro, el modelo de
  frontera `GoCommitmentFile`, dueño del formato:
  - ruta: `<configDir ?? ~/.claude>/control-tower/go/<owner>__<name>-<n>.json`, donde `/` del repo pasa a
    `__` y todo lo que no sea `[A-Za-z0-9._-]` a `_`;
  - contenido: `JSON.stringify({ repo, issue, commitment }, null, 2)` más salto de línea;
  - `commitment`: sha256 hexadecimal del nonce en minúscula;
  - permisos: directorio `0700`, fichero `0600`, como el plugin.
- **`gh-plan-issues.js`**: `claim` → `gh issue edit <n> --repo <r> --add-label status:in-progress
  --remove-label status:ready`; `requeue` → lo simétrico; `answerGo` → `gh issue comment <n> --repo <r>
  --body "-OK <nonce>"`. El texto del comentario lo compone `GoComment` dentro de este fichero. Ninguna de
  las tres es `safeToRepeat`: son escrituras. `claim` y `requeue` siembran la label que falte con la misma
  vuelta que ya da `open` (`Gh.labelMissingIn` → `label create --force` → reintento), y sólo si la label es
  nuestra: `gh issue edit --add-label` falla igual que `issue create` cuando la label no existe en el repo.
- **`plan-agent-brief.js`**: el encargo de implementación pierde las dos frases de la prohibición y gana
  «al entregar, libera con `node <dispatch-check> <n> --repo <r> --release` y PARA». La ruta de
  `dispatch-check` ya está en el constructor.
- **`start-plan-route.js` / `implement-plan-route.js`**: las proyecciones de colapso ganan sus causas
  nuevas, todas a 503. Los tests de exhaustividad que ya existen son los que obligan a añadirlas.
- **`ct-api.mjs`**: monta `DiskGoRegistry` con `randomBytes`, la escritura con permisos y
  `CLAUDE_CONFIG_DIR ?? ~/.claude`, y se lo pasa a `ImplementPlan` junto con el `GhPlanIssues` que ya
  construye para `StartPlan`.

---

## 5. Tests

Los tres tipos que `backend/conventions/testing.md` manda, y ninguno más:

- **Casos de uso, outside-in**: `StartPlan` pide `claim` antes de `prepare` y `requeue` cuando `prepare` o
  `launch` fallan; cuando `claim` falla, `prepare` nunca fue preguntado. `ImplementPlan` pide `mint`,
  luego `answerGo` con el `PlanGo` que `mint` devolvió, luego `resume`; cuando `answerGo` falla, `resume`
  nunca fue preguntado.
- **Adaptadores, cortando antes de la herramienta**: el argv literal de `claim`, `requeue` y `answerGo`;
  la ruta y el texto literal que escribe `DiskGoRegistry` con un `random` fijado.
- **Frontera con el plugin**: el texto que escribe `GoCommitmentFile` se lee con `readGoCommitment` y el
  comentario de `GoComment` se comprueba con `matchesGo` contra ese `commitment`. Un segundo caso: un
  nonce distinto **no** encaja.
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
coordinadora; comprobar que la pestaña siga viva; y qué hacer con el vigilante del merge (§2.4).
