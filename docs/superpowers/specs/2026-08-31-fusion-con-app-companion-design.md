# La fusión con la app companion — quien sostiene el terminal es la coordinadora

**Fecha:** 2026-08-31
**Repos:** `josemerca/control-tower-plugin` (este), `multiservicio/pocs.companion`
**Estado:** diseño revisado tras tres jueces adversariales; nada ejecutado todavía
**Alcance del piloto:** **un slice a la vez**

---

## 1. Qué se fusiona, y la tesis

`control-tower-plugin` conduce lo que pasa **dentro** de un slice: el plan
prescriptivo y su contrato mecánico, la máquina de estados tarea a tarea, los
dos jueces declarados sin `Bash`, los controles medidos por programa.

`pocs.companion` es una aplicación de escritorio (Electron, React 19,
TypeScript) que arranca sesiones de Claude Code en pseudo-terminales dentro de
su ventana, las observa con hooks que hacen POST a un servidor local, y registra
los actos humanos.

**La app no aporta una interfaz sobre el loop: aporta el terminal.** Todo lo que
hay en CT de proceso desprendido, centinela y vigilante que sondea GitHub existe
por una única causa — hoy nadie sostiene el terminal del agente. Y como
sostenerlo es lo que define a la coordinadora en el modelo de CT, la
consecuencia es mayor que una simplificación: la app no acompaña a la sesión
coordinadora, **la sustituye**.

Objetivo: de una historia de usuario a un pull request con **dos decisiones
humanas** — el plan y el merge.

---

## 2. La entrada: sin spec, sin congelación, sin tabla, sin groom

### 2.1 CT lo tolera hoy, sin tocar nada

Verificado: `/ct-next` **nunca lee el spec**. Trabaja sólo contra los issues de
GitHub vía `scripts/gh-issue-map.js:783`, y ese mapeo es tolerante:

| Lo que falta | Qué hace `mapGhIssue` |
|---|---|
| El marcador `<!-- ct-order:N -->` | `order: order ?? i.number` (`:845`) |
| La sección `## Dependencias` | `deps: []` — nada que esperar |
| Las labels `area:` / `touches:` | `touches: []` — ninguna colisión detectable |
| La label `type:` | `type: ''` — kickoff sin addendum técnico |
| Las labels `gate:` | `gatesDeclared: false` — cae al defecto (§2.2) |
| El milestone | `NO_MILESTONE_KEY` (`:1016`) |
| `## Señal de observabilidad` | el juez del slice lo mide sin-vara, sin penalizar |

Un issue pelado con una sola label —`status:ready`— es despachable hoy. Un juez
lo ejecutó de punta a punta (`buildDispatchInput` → `selectNext` →
`renderKickoff`): sale seleccionado, con `gates: ['plan']` y un kickoff de 6.564
caracteres.

### 2.2 El gate del plan sobrevive gratis

`scripts/gates.js:136` — `plan` está implicado por defecto en **todo** slice, y
vive fuera de `TYPE_GATES` para no depender de que el `Tipo` exista.
`resolveGatesForAgent` (`gates.js:332`) cae a `gatesForType(type)` cuando el
issue no declara labels `gate:`.

Y la renuncia (`!plan`) viaja en las labels que escribe `/ct-groom`: **sin
groom, renunciar cuesta más que respetarlo** — habría que poner `gate:none` a
mano en cada issue.

### 2.3 Lo que esto SÍ cuesta: el runtime de la app está atado al epic

Esto es lo que la primera versión de este diseño no vio, y es el bloque de
trabajo más grande.

- `src/main/torre/command-runner-v2.ts:550-561` — antes de cualquier `switch`,
  el runtime llama a `loadSpecSource`; si devuelve `null`, **los nueve comandos**
  devuelven error.
- `headless/snapshot/bootstrap.ts:66-76` — `bootstrapEpic` lanza sin
  `milestoneTitle`. Lo invocan `freeze`, `groom`, `promote`, `dispatch`, `merge`,
  `ratificar`, `ratificar-merge`, `liberar`/`abandonar` y `bloquear`.
- `build-promote-dispatch.ts` — `findSliceIssue` busca el issue **dentro del
  milestone**.
- `headless/ledger.ts:18` — `DecisionGate = 'congelar' | 'promover' | 'merge' |
  'cerrar' | 'blocked'`. No hay `plan`. Y el ledger escribe en un issue
  `ct-ledger` **dentro del milestone**.
- Los dos lectores (`state-reader-v2.ts`, `loop-reader.ts`) proyectan issues
  sobre las filas de una tabla congelada y descartan lo que no case. No existe
  ninguna lectura «dame los `status:ready`».
- `workspace-listing.ts` indexa la pantalla de entrada por fichero de spec
  (`/^([A-Z][A-Z0-9_]*-\d+)\.md$/`).

**La decisión se mantiene** —la entrada es una historia de usuario— y el precio
se acepta: el trabajo de §6.2 crece. La alternativa (conservar el epic) ahorraría
ese bloque pero devolvería a la ruta crítica la deriva del contrato de tabla y la
puesta al día de la app con las columnas, y ataría el piloto a escribir un spec
por historia de usuario.

### 2.4 La deriva del contrato de la tabla, registrada y fuera del camino

Seis transcripciones canónicas de la misma cabecera, dos versiones:

| Fichero | Columnas |
|---|---|
| `templates/_TEMPLATE-execution-spec.md:82` | 10 (declara v18 en `:68`) |
| `commands/ct-groom.md:26` | 11 |
| `scripts/ct-init.sh:550` y `:787` | 11 (siembra **v22**, `ct-init.sh:457`) |
| `docs/loop/control-tower-loop.html:1262` | 10 |
| `docs/loop/loop.body.html:1181` | 10 |
| `scripts/ct-groom.mjs:221` (mensaje de error) | 7 |

Sin groom, ningún programa del piloto parsea una tabla. Queda registrado.

---

## 3. Las tres decisiones

### 3.1 Dónde corta CT — el orden real, verificado en el código

Ocho pasos. El kickoff se compone **antes** del claim, en el preflight
(`ct-next.mjs:2367`), que es lo que permite a `--dry-run` imprimirlo sin mutar
nada. Todo lo que muta ocurre en el bucle de lanzamiento.

| | Qué | Dónde | ¿Quién? |
|---|---|---|---|
| 1 | Precondiciones. Incluida **`cmux` en el PATH, que es de tanda** y aborta antes de reclamar nada | `:2320-2322`, `:2534` | CT |
| 2 | Selección: en vuelo, tokens tomados, dependencias mergeadas, hueco de `--cap` | `:2134` | CT |
| 3 | **Claim** vía `dispatch-check`: `status:ready → in-progress` y toma de tokens. Es el cerrojo, y es lo primero que muta | `:3256` | CT |
| 4 | Worktree y rama: `git worktree add -b feat/<n>` | `:3425` | CT |
| 5 | Exclusión del estado y siembra del `SLICE.md` con el sha real de corte | `:3440`, `:3479` | CT |
| — | **el corte** | | |
| 6 | Lanzamiento: `cmux` abre ventana, sourcea un launcher, teclea `claude "<kickoff>"` | bucle | **la app** |
| 7 | Verificación del arranque esperando el centinela del shell de login | `:3636` | desaparece |
| 8 | Vigilante del go — y **es aquí donde se sortea el nonce** | `:3718` → `:724,747-751` | desaparece |

**Decisión: `ct-next` gana `--issue N`, `--no-launch` y `--emit json`,** y el
sorteo del nonce **sube del paso 8 a antes del paso 6**.

Ese movimiento no es cosmético. `lanzarVigilanteDelGo` (`:724`) es el único sitio
del fichero que llama a `newGoNonce` y `writeGoCommitment`, y se invoca en
`:3718` condicionado a `launchedCount > lanzadosAntesDeVerificar` — es decir,
sólo si `cmux` arrancó y el centinela lo verificó. Con `--no-launch` no correría
nunca: el sobre saldría sin `goNonce` y todo slice moriría al liberar con exit 9.
Y no cambia sólo de sitio, cambia de orden: la app necesita el nonce **antes** de
arrancar el terminal.

Alternativas descartadas:

- **La app teclea `/ct-next` en un pseudo-terminal con la coordinadora.** Cero
  cambios en CT, pero el terminal del implementador lo abre `cmux`, fuera de la
  app: no se puede enseñar el plan ni empujar con un botón sin resucitar el
  vigilante, y el nonce se imprime en la pantalla de un agente — que es lo que
  `CT_GO_CHANNEL=notify` existe para evitar.
- **La app reclama y crea el worktree ella.** Duplica el claim, la resolución de
  la base, la siembra del estado y la exclusión; y se salta el sorteo del nonce.

### 3.2 El gate del plan: la app participa

El ritual existe porque el agente tiene `gh`: todo lo que viva en GitHub lo
puede escribir él, así que un compromiso en una label convertiría el gate en un
juego de una sola jugada. Por eso vive fuera del repo
(`~/.claude/control-tower/go/<owner>__<repo>-<issue>.json`, sólo el sha256) y el
nonce en claro sólo existe en la pantalla de quien despacha.

**Decisión: la app se queda el nonce y al pulsar GO comenta `-OK <nonce>` en el
issue y escribe en el pseudo-terminal.** `--release` sigue siendo un gate de
verdad (`dispatch-check.mjs:982`, exit 9) y el rastro queda en GitHub.

Renunciar (`!plan`) cuesta más sin groom (§2.2).

**Lo que este diseño NO compra, retractado de la versión anterior:** no es
cierto que el modelo de amenaza mejore. Ver §8.2.

### 3.3 El monorepo: simétrico

> **DIVERGENCIA EJECUTADA (2026-09-01) — esta sección quedó superada por la
> rama `refactor/plugin-a-subdir`.** El reparto de nombres cambió antes de que
> este diseño se ejecutara: `backend/` lo ocupó la API HTTP local (PR #56) y
> **el plugin CT vive en `plugin/`**, no en `backend/` —
> `.claude-plugin/marketplace.json` apunta a `"./plugin"`. Y `frontend/` **no
> entra por `git subtree`**: la decisión es repo único, el front nace aquí y
> `pocs.companion` no se importa con su historia. Lo que sigue abajo describe
> el reparto que NO se hizo; el coste que sí sobrevive intacto es el último
> punto — cada repo gobernado reinstala una vez.

`backend/` es CT (entra con `git mv`), `frontend/` es la app (entra con
`git subtree add --prefix frontend`). Las dos historias se conservan.
`.claude-plugin/marketplace.json` pasa de `"source": "./"` a `"./backend"`.

Coste medido:

- **Los tests apenas se enteran.** Dos ficheros de `__tests__/` usan `../../`
  como ruta real, y ninguno es un `.test.js` (`fixtures/ct-step-harness.js`,
  `fixtures/go-gate.js`); tres tests resuelven la raíz de git. El paquete entero
  se mueve junto, así que las rutas de dentro siguen siendo válidas.
- **La regla del `dist/` viaja intacta**; `hooks/hooks.json` referencia
  `dist/*.js` relativo a la raíz del plugin.
- **`conventionsDir` se resuelve solo** (`ct-next.mjs:53`, relativo al script).
- **Lo que rompe: la instalación.** Editar el manifiesto no basta, el plugin
  corre de una copia en caché. Cada repo gobernado reinstala. Coste de una vez.

Descartadas: **repo nuevo con los dos como subtree** (su motivo —tres colisiones
de fichero— lo resuelven los prefijos) y **asimétrico** (un movimiento y cero
reinstalaciones, pero la asimetría la paga cada lector para siempre).

---

## 4. Los actores

| Actor | Qué es | Qué decide |
|---|---|---|
| **La app** | Un programa. No es una sesión de agente | Nada. Ejecuta actos: reclamar, arrancar, dar el go, mergear |
| **La implementadora** | Claude Code en `.worktrees/<n>`, pestaña de la app | Nada de alcance. Escribe el plan y obedece a `ct-step` |
| **La helper** | Claude Code en el checkout principal, opcional | Nada. Lee y explica; su prompt le prohíbe transiciones y puertas |
| **El humano** | — | Dos veces por slice: el plan y el merge |

### 4.1 La coordinadora se queda sin trabajo

Brainstormear el spec y groomear no existen; despachar, dar el go y mergear
pasan a la app; el informe lo renderiza la app; cosechar son dos comandos de git
que la app enseña. No queda nada que requiera juicio de un agente.

Esto no debilita el modelo de dos sesiones: lo refuerza donde importa. El modelo
existe para que ninguna sesión haga el trabajo de la otra —de ahí que el rol viva
en un campo de fichero y no en un prompt, que se pierde al re-hidratar— y un
programa no puede derivar hacia implementar.

**Corrección respecto de la versión anterior: el `role` de `STATE.md` NO es
vestigial.** `hooks/session-start.js` inyecta el `STATE.md` entero como
`additionalContext` en **toda** sesión del repo y de sus worktrees
(`hooks/hooks.json`, matcher `startup|resume|clear|compact`), y `scripts/state.js:66`
lo dice con esas palabras. El valor sembrado
(`skills/state-template/STATE.template.md:12`) es *«coordinador (checkout
principal): groomeas, despachas con /ct-next, revisas y mergeas»*. La sesión
helper vive en ese checkout: arrancaría con una instrucción inyectada que
contradice su papel. Hace falta una variante de la plantilla, o que la helper no
viva ahí. Es trabajo, está en §6.1.

---

## 5. El flujo

### 5.0 Una vez por repo gobernado

`/ct-init`. Deja `.agent/STATE.md`, el bloque de la vara en `AGENTS.md`,
`.agent/conventions.md`, la plantilla del spec, y **cuatro** reglas en el
`.gitignore` (`.worktrees/`, `.agent/SLICE.md`, `.agent/run-*.json`,
`.agent/run-*/`).

El despacho aborta si `.agent/SLICE.md` se ve en `git status`
(`ct-next.mjs:3522-3526`), pero eso **no depende** de esas líneas: `ct-next`
escribe la misma regla en `.git/info/exclude` en cada despacho (`:2817-2828`).

### 5.1 Lanzar — un botón

1. La app se asegura de que el issue existe con `status:ready` (§6.3) y con la
   sección `## Contexto del epic` que lleva la línea `Alcance:` (§6.4).
2. Ejecuta:

   ```
   node backend/scripts/ct-next.mjs --issue <n> --repo <owner/name> \
        --no-launch --emit json
   ```

3. Arranca el pseudo-terminal con lo que devuelve, y **se queda el nonce en su
   proceso**.

El sobre:

```json
{
  "issue": 47, "order": 47, "repo": "owner/name",
  "branch": "feat/47", "worktree": ".worktrees/47",
  "base": "main", "baseSha": "a1b2c3d",
  "sliceMd": ".worktrees/47/.agent/SLICE.md",
  "gates": ["plan"], "goNonce": "7f3a91c2",
  "agentBin": "claude",
  "abort": ["<comandos exactos para deshacer el claim, el worktree y la rama>"],
  "kickoff": "Estás implementando UN slice…"
}
```

`agentBin` y `abort` no estaban en la versión anterior y hacen falta: ver §6.5.

### 5.2 El plan, y la pausa

El agente confirma `pwd`, rama, `git log` y baseline verde; se hidrata de
`.agent/SLICE.md` y del issue; lee la vara (los cinco documentos de
`backend/conventions/` más la del repo); escribe el plan prescriptivo contra el
código real con `control-tower-loop:writing-plans-prescriptive`; lo valida con
`dispatch-check <n> --repo <r> --check-plan` hasta exit 0; lo commitea; lo
publica como comentario del issue; y **para**.

Las tareas nacen aquí, no en el issue.

La app enseña el plan. **El botón se habilita con `--check-plan` a exit 0 y el
comentario del plan presente, nunca con un `Stop` pelado** — ver §6.5.

Aquí decide el humano por primera vez, y es el único sitio donde se comprueba
que el trabajo planificado es el que pedía la historia de usuario: todos los
jueces de aguas abajo miden contra el plan.

### 5.3 El GO

```
gh issue comment <n> --repo <owner/name> --body "-OK <nonce>"
pty.write("continúa\n")
```

El comentario es lo que convierte el gate en gate, y deja el rastro en GitHub.
El nonce **sí** cruza al issue en este acto: es la única forma de que `--release`
lo pueda comprobar, y es inofensivo porque la puerta ya se abrió.

### 5.4 La implementación

El agente pregunta `ct-step next --plan <plan> --issue <n>` y obedece. Por tarea:
`next` (pedir un paso que no toca se rechaza con exit 9, `ct-step.mjs:101`) →
implementador como subagente con TDD → `report` (valida rutas y stagea) →
`controls` (ejecuta los `**Verification:**` y mide) → `ct-judge` **sin `Bash`** →
`verdict` (contra esquema) → `commit` (comitea el programa). El sitio en el que
va vive en `.agent/run-<n>.json`.

Después: `reconcile` (con `ct-reconciler` sin `Bash` **ni `Write`** si hay
conflicto), `global` (la ejecuta el programa; en rojo no se abre PR),
`slice-verdict` (el juicio del slice entero), y `e2e` sólo si el issue declara
recorridos.

Con el run `delivered`: PR contra la base con `Closes #<n>` en el **cuerpo**, y
`dispatch-check --release`. Ese release cobra las tres deudas: exit 6 sin plan
válido commiteado (`:818`), exit 7 sin run entregado (`:838`), exit 9 sin el go
(`:982`).

### 5.5 El merge

El humano decide por segunda vez. La app mergea; el `Closes #<n>` cierra el
issue, lo que suelta los tokens de área. La cosecha del worktree sigue siendo un
aviso, no un borrado automático.

---

## 6. El trabajo

### 6.1 En CT

1. **`--issue N`** — fuerza un issue sin saltarse ninguna comprobación de
   despachabilidad. Si no lo es, exit distinto de cero y el motivo en prosa, sin
   tocar nada.
2. **`--no-launch --emit json`** — corta tras el paso 5, serializa el sobre. Y
   **tiene que saltarse la precondición de `cmux`** (`:2320-2322`), que es de
   tanda y aborta antes de reclamar: es justo la máquina que esto habilita.
3. **El sorteo del nonce sube del paso 8 a antes del 6** (§3.1).
4. **El sobre como modelo de frontera con un test sobre el payload literal.** Es
   lo único que los dos repos comparten; un objeto literal en el entrypoint
   rompería la app en silencio. `conventions/testing.md`: «*at a boundary, the
   literal payload sent or received, not a model of it reimplemented in the
   test*».
5. **`--release` rechaza un go firmado por la identidad que corre `gh`.** Ya
   tiene el autor en la mano y sólo lo imprime por stderr
   (`dispatch-check.mjs:987`). Y **`ct-go.mjs` se niega a pisar un compromiso que
   no creó él**. Es la mitad barata de §8.2.
6. **`.claude/settings.local.json` a las exclusiones** que escriben `ct-init` y
   `ct-next` (éste ya escribe en `.git/info/exclude` en cada despacho) y a
   `NEVER_IN_A_SLICE_PR` (`state-paths.js:38`). Sin esto, un control del plan de
   la forma `test -z "$(git status --porcelain)"` sale rojo en todo slice — y
   `plan-tasks.js:353` lo recomienda como el predicado correcto.
7. **Una variante de `STATE.template.md`** para un repo cuya coordinadora es la
   app, o que la helper no viva en el checkout principal (§4.1).
8. **`yaml`: comprobar y decidir.** `scripts/state.js:1` lo importa y está sólo
   en `devDependencies`. El plugin instalado tiene `node_modules` con `yaml`,
   `vitest` y `esbuild` en las siete versiones cacheadas — **pero eso es porque
   el caché es copia de un checkout de desarrollo**: `node_modules/` está en
   `.gitignore:1` y `git ls-files | grep -c node_modules` da 0. Queda por
   comprobar qué hace una instalación limpia; si no corre `npm install`, `yaml`
   se mueve.

**Módulos nuevos, nacidos conformes.** El sobre y su proyección son un concepto
nuevo, así que `conventions/architecture.md` y `style.md` aplican: módulo propio,
identificadores en inglés, sin prosa, toda función colgando de un tipo. Y entran
en `NacidosConformes.RUTAS` (`__tests__/modulos-conformes.test.js`), que ya
mantiene la lista blanca y la vigila mecánicamente.

**Lo que NO se refactoriza.** `scripts/` son 60 módulos y 9.914 líneas de código
(59% comentario), con 119 ficheros de test. `architecture.md` declara exención
para lo que ya estaba —«*half a migration reads worse than none*»— y `style.md`
acota la deuda a sus tres reglas. Reestructurar en capas no compra nada para la
fusión. Y ningún test importa `ct-next.mjs`: los ~200 tests de `ct-next-*` lo
tratan como caja negra por subproceso, así que una extracción que preserve
stdout, stderr y exit codes tiene toda esa red de red.

### 6.2 En la app — desatar el runtime del epic

Bloque nuevo, y el mayor.

1. **La guarda del spec pasa de global a por comando** (`command-runner-v2.ts:550-561`).
   `dispatch` y `merge` corren sin spec; `freeze`, `groom` y `promote` lo siguen
   exigiendo y siguen existiendo para cuando haya epic.
2. **Sacar `ensureBootstrap` del camino del piloto** y que `findSliceIssue`
   busque el issue **por número**, no dentro del milestone.
3. **El ledger se queda dormido en el piloto.** No puede registrar el GO —no hay
   puerta `plan` en `DecisionGate` y su soporte es un issue dentro del
   milestone—, y no hace falta: el rastro del GO es el comentario `-OK <nonce>`
   en el issue, público, con fecha de GitHub y atribuido a una cuenta. Extenderlo
   (puerta nueva, transición, checks en el registro, soporte físico nuevo) queda
   fuera del piloto.
4. **Una ruta de lectura «dame los `status:ready`»**, que no existe: los dos
   lectores proyectan sobre filas de tabla congelada.
5. **Una entrada que no indexe por fichero de spec** (`workspace-listing.ts`).
6. **El gate `plan` en el vocabulario de la interfaz**: clave en `GateKeyV2`
   (`shared/torre-v2.ts:91`), `nextGate` (`:128`) y panel.
7. **`blocked:local`**: la app publica esa label automáticamente al recibir un
   `Stop`, el plugin no la tiene en su vocabulario (`groom.js:346-352`: «*SON
   CUATRO, NO SIETE, a propósito*») y `gh-issue-map.js` sólo resuelve el prefijo
   `status:`. Con este diseño esa publicación **siempre falla**, porque pasa por
   el runtime bloqueado: dejaría una línea de error en cada parada del agente.

### 6.3 En la app — el acto de lanzar

1. **Desmontar la cascada de prompts para el prompt del slice.** Sustituir
   `DEFAULT_PROMPTS['fase-slice.md']` no basta: tres niveles por encima lo tapan
   sin avisar (`prompts.ts:244-261`) y el primero es
   `<worktree>/.companion/prompts/` — **dentro del área de trabajo del agente**.
   Cierra de paso el agujero de §8.2.
2. **Dejar de escribir su propio `SLICE.md`** y arreglar su lector. Los dos
   formatos son **incompatibles**: CT escribe `base` = nombre de rama y
   `base_sha` aparte (`kickoff.js:417-419`); la app escribe `base: <sha>`
   (`dispatch-chain.ts:98`) y **lee ese campo como el sha**, consumido por
   `findLocalBaseShaOnDisk`. Con CT sembrando, leería `"main"` como sha, en
   silencio. (Y el fichero tiene **17 campos**, no siete: `task, role, gates,
   senal, e2e, status, branch, base, base_sha, last_commit, epic, github_issue,
   you_are_here, next_action, blocked, verify, tasks` más el cuerpo.)
3. **Ceder la raíz de worktrees**: de `~/.companion/worktrees/<KEY>-s<N>`
   (`workspace.ts:16-18`, fuera del repo) a `.worktrees/<n>` (dentro). **Once
   consumidores de producción**, y dos de ellos —`findLocalBaseShaOnDisk` y
   `findLocalSliceOnDisk`— son los únicos fallbacks durables que hacen que la app
   sobreviva a un reinicio: se reescriben, no se borran. Sale también el parche
   `git checkout -B` de `checkoutBranch`.
4. **Un canal de escritura al pseudo-terminal desde un botón.** El camino
   renderer → main → `node-pty` existe (`preload/index.ts:93` → `index.ts:444` →
   `pty.ts:56`) pero su único emisor es la tecla del humano en xterm; el runtime
   de puertas es headless y no ve los pseudo-terminales. Y **`pty.write` es
   silencioso ante un id desconocido** (`pty.ts:56-58`): la app daría el GO,
   comentaría el nonce y no sabría que nadie lo leyó.

### 6.4 En la app — el issue

1. **Componer el issue desde la historia de usuario** con `## Acceptance criteria
   (EARS, 1:1 con tests)`, `## Out of scope / Protected`, `## Decisiones
   congeladas` y la label `status:ready`. Los encabezados son constantes
   exportadas de `groom.js`; **la app no debe transcribirlos** — lo mínimo es un
   comando de CT que renderice y cree el issue de una fila.
2. **La sección `## Contexto del epic` con una línea `Alcance: <rutas>`.**
   `parseScope` lee del **cuerpo del issue** (`scope-check-cli.js:98`,
   `scope.js:35`), así que con esa sección el gate de alcance sigue funcionando
   **sin cambiar una línea de CT**. Importa: ese guard nació de un incidente
   medido —un agente escribió que un humano le había autorizado, con una sola
   intervención humana real en su transcript— y está fuera de `--release` a
   propósito, porque un guard que ejecuta el sospechoso no es un guard.
3. **`renderSpecLink` no sirve para decir «no hay spec».** Su vocabulario de
   motivos es un conjunto cerrado de seis cadenas (`spec-link.js:114-121`),
   congelado a propósito porque acaban en el cuerpo del issue y la detección de
   divergencia las compararía. O se amplía, o la cabecera cambia.

### 6.5 En la app — recuperación y verificación de arranque

Era el agujero más serio y no estaba en el plan.

1. **No matar al agente al cerrar la ventana.** `index.ts:1124-1128` —
   `window-all-closed` → `ptys.killAll()`.
2. **Persistir lo necesario para reanudar**: el nonce en claro (no está en ningún
   disco; `go-registry.js` sólo guarda el sha256) y el mapeo sesión↔slice (hoy
   `Map`s en memoria).
3. **Asumir el revert que hoy hace `ct-next`.** Ante sus cuatro formas de morir
   —`SIGINT`/`SIGTERM` (`:3036-3037`), `uncaughtException`/`unhandledRejection`
   (`:3097-3098`)— llama a `attemptRevertClaim` (`:2791-2800`) y
   `cleanupOrphanedWorktree` (`:2858-2900`). Con `--no-launch` eso no desaparece
   del fichero: desaparece del camino. De ahí el campo `abort` del sobre.
4. **Clasificar el código de salida del pseudo-terminal.** El centinela comprueba
   `command -v <agentBin>` **dentro** del shell de login, y esa certeza *negativa*
   (`no-claude`) es la que dispara la limpieza en `:3636`. Un hook sólo puede
   decir «arrancó»; su ausencia es indistinguible de «todavía arrancando». De ahí
   el campo `agentBin`. Un exit 127 es la señal.
5. **Fallar ruidosamente si no pudo instalar los hooks.** `index.ts:414` los
   escribe sólo `if (hooksServer.port > 0)`; el camino del despacho (`:795`) no
   tiene guarda. Sin hook no hay verificación de arranque en absoluto.
6. **El botón del GO se gatea con `--check-plan` y el comentario del plan.** El
   hook es genérico para los cuatro eventos y `statusOf` sólo mapea
   `Stop → 'stopped'` (`hook-payload.ts:26-38`): un error, el límite de contexto
   o un muro de permisos habilitan el botón igual que un plan publicado — y el
   primer `Stop` llega mucho antes del plan.

**Nota honesta sobre la red de pruebas:** de los 84 ficheros de producción de la
app, 39 no tienen `.test.ts` hermano, y entre ellos están **todos** los que este
plan manda tocar (`prompts.ts`, `pty.ts`, `hooks-server.ts`, `workspace.ts`,
`loop-reader.ts`, `contracts.ts`, `headless/ledger.ts`, `index.ts`,
`preload/index.ts`, `shared/ipc.ts`). Hay que escribir esa red antes, no después.

### 6.6 Lo que el camino de la app deja de usar

No se borra: sigue sirviendo a quien despache desde una consola. El sorteo del
nonce por pantalla y `ct-watch-go.mjs`; el centinela de arranque;
`ct-watch-merge.mjs`; la ventana de `cmux` y su launcher; y el tramo del spec, la
congelación, la tabla y `/ct-groom`.

---

## 7. Reutilización

**Por proceso hijo, nunca por importación.** La app invoca los ejecutables de CT
y lee su stdout. El motivo es medido: el runtime de CT es síncrono y bloqueante
con esperas de hasta diez minutos (`ct-next.mjs:251`,
`DEFAULT_CHILD_TIMEOUT_MS = 10 * 60 * 1000`), así que importarlo congelaría la
interfaz de Electron. La convención de canal de CT ya sirve a esto: stdout es el
producto, stderr el diagnóstico.

*(Corrección de la versión anterior: «cero llamadas asíncronas» era falso. Hay
dos funciones `async` en `ct-next.mjs` —`:768`, `:831`— y 25 `await`; las
llamadas síncronas de proceso y fichero son 147, no 89. El argumento se sostiene
con el timeout de diez minutos solo.)*

**Lo que la app deja de implementar:** el claim de tokens, la resolución de la
base, la creación del worktree, la siembra del `SLICE.md`, la composición del
kickoff, el sorteo del nonce, la exclusión del estado.

---

## 8. Límites

### 8.1 El claim no es atómico, y el piloto es de uno en uno

Son labels de GitHub sin comparar-y-cambiar; está **reproducido** que dos
despachadores casi simultáneos reclaman el mismo token.

Y hay una razón más fuerte para el uno-en-uno: `--cap` es 1 por defecto
(`ct-next.mjs:1232`) y lo consume `status:in-progress`, que es donde el slice
espera **todas las horas que pase en el gate del plan**. Si se subiera el cap,
con `touches: []` desaparece la detección de colisión y el carril serializante
(`dispatch.js:2`, `SERIALIZING_TOUCHES`): dos slices que añadan cada uno una
migración no producen conflicto textual, así que `reconcile` no ve nada y el
resultado sale roto sin que nada avise.

**Decisión: el piloto es de un slice a la vez, y la interfaz no ofrece lanzar un
segundo mientras el primero espera.**

### 8.2 El go protege del implementador, y la app no está fuera de su alcance

**Retractación.** La versión anterior afirmaba que el modelo de amenaza mejora.
La mitad que es cierta: el nonce deja de pasar por el contexto de cualquier
agente, y eso es una ganancia real. Lo que no es cierto:

- **La potestad de acuñar no se mueve.** `ct-go.mjs` sortea un nonce nuevo,
  sobreescribe el compromiso y lo imprime, sin comprobar quién llama — y el
  mensaje de error de `--release` (`dispatch-check.mjs:982`) **le da al agente el
  comando**, con la ruta del plugin ya interpolada en su propio kickoff.
- **El pseudo-terminal hereda todo el entorno de Electron** (`pty.ts:36-46`), en
  un shell de login con el mismo usuario.
- **El primer nivel de la cascada de prompts está dentro del worktree del
  agente**: quien escriba `.companion/prompts/fase-slice.md` dicta el prompt del
  siguiente despacho.
- **El servidor de hooks no autentica nada** (`hooks-server.ts:41-71`) y el
  agente conoce la URL porque la app se la escribe en su propio worktree
  (`claude-hooks.ts:39`). Un `curl` con `{"hook_event_name":"Stop"}` hace
  aparecer el botón del GO.

§6.1.5, §6.3.1 y §6.5.6 cierran los tres primeros a coste bajo. El cierre
completo sigue exigiendo un verificador que no corra bajo ese usuario:
nombrado y sin construir.

### 8.3 El alcance se comprueba en dos sitios, no en uno

Todos los jueces del slice miden contra el plan, así que la lectura humana del
plan es donde se detecta que el agente entendió otra cosa. El segundo sitio es el
gate de alcance sobre el diff (§6.4.2), que es el único hecho no falsificable del
sistema — y por eso conservarlo no es opcional.

### 8.4 El informe de `e2e` es falsificable

Se valida en la forma, nunca en la verdad. Lo único que lo acota es que el
comando declarado sea reproducible.

---

## 9. Lo que este diseño no hace, a propósito

- No retira el ledger de la app: lo deja dormido hasta que haya epic (§6.2.3).
- No añade salida estructurada a los otros cuatro comandos de CT. El JSON no
  tendría qué transportar: cero identificadores de check en el plugin frente a 94
  en la app, y el plugin no aborta con un código sino con una frase.
- No construye reconciliación de issues, troceo ni alta en el tablero.
- No firma ni notariza la app; el piloto acepta el aviso de macOS.
- No arregla la deriva del contrato de la tabla (§2.4).
- No conserva la sesión coordinadora: es consecuencia de §3.1, no una decisión
  aparte. No se sostiene el terminal desde dos sitios.
- No reestructura `scripts/` en capas (§6.1).

---

## 10. Registro de la auditoría

Este documento se revisó con tres jueces adversariales independientes —hechos
citados, mecanismo del flujo, y lado de la app— cada uno con los repos en disco y
la instrucción de tumbarlo con evidencia. Lo que cambió a raíz de ellos:

| Hallazgo | Efecto |
|---|---|
| El runtime de la app está atado a spec + milestone | §2.3 nueva; §6.2 entero |
| El nonce se acuña en el paso 8, no en el 5 | §3.1 reordenada y renumerada a ocho pasos |
| `cmux` es precondición de tanda y aborta antes del claim | §6.1.2 |
| El agente puede acuñarse el nonce con `ct-go.mjs` | §8.2 retractación; §6.1.5 |
| El entorno heredado, la cascada de prompts y el servidor sin autenticar | §8.2; §6.3.1; §6.5.6 |
| `base` incompatible entre los dos `SLICE.md` | §6.3.2 |
| El `SLICE.md` tiene 17 campos, no siete | §6.3.2 |
| El `role` de `STATE.md` lo inyecta el hook en toda sesión | §4.1; §6.1.7 |
| `scope-check` muere sin `## Contexto del epic` — y lee del issue | §6.4.2 |
| Sin recuperación: la app mata al agente y pierde el nonce | §6.5 |
| El `Stop` no dice por qué paró | §6.5.6 |
| `.claude/settings.local.json` dentro del worktree | §6.1.6 |
| `--cap 1` y el slice aparcado en el gate | §8.1 |
| `ct-init` siembra v22, no v21; seis transcripciones, no tres | §2.4 |
| `renderSpecLink` no puede decir «no hay spec» | §6.4.3 |
| La retractación de `yaml` era propiedad de la máquina, no de la instalación | §6.1.8 |
| «Cero llamadas asíncronas» era falso | §7 |
| 39 módulos de la app sin test, incluidos todos los que se tocan | §6.5 nota |

Lo que resistió: `/ct-next` no lee el spec por ningún camino; un issue pelado con
sólo `status:ready` es despachable, ejecutado de punta a punta; el gate `plan`
sobrevive; ningún test importa `ct-next.mjs`; los exit 6/7/9 de `--release`; y el
corte tras el paso 5 con las dos alternativas descartadas.
