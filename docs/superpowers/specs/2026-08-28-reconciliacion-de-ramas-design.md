# Reconciliación de ramas — diseño

**Estado:** diseñado, sin implementar.

Una rama de slice nace al día y envejece sola. `/ct-next` la corta de
`origin/<base>` recién fetcheado y a partir de ahí **nadie vuelve a mirarla**:
ni mientras el humano tarda en dar el `-OK` del gate `plan`, ni mientras el
agente implementa, ni mientras corren las verificaciones finales. Entretanto
otras slices mergean. Este documento diseña el paso que la pone al día antes de
entregar, y el resolutor que se ocupa del único caso que no es determinista.

## El problema

Hoy el desfase de una rama sólo se descubre **al final**, y de la peor manera:
una pull request cuya rama entra en conflicto con su base queda inmergeable, y
GitHub Actions **no ejecuta un workflow de `pull_request` sobre una pull request
inmergeable** — el evento corre sobre el merge commit, que con conflicto no se
puede construir. Así que una rama atrasada no sólo no se mergea: deja la
integración continua sin arrancar, y el slice se entrega sin que su criterio de
aceptación se haya demostrado nunca.

Está medido en campo, en dos repos distintos:

- `jjponz/rust-monitoring#10`. El worktree salió de un `main` **local** un commit
  por detrás de su remoto, porque otra pull request había mergeado diecinueve
  minutos antes. En cadena: el plan se escribió citando verbatim un `AGENTS.md`
  que ya no era el de la base, la pull request nació en conflicto, y **no arrancó
  ni un check**. El criterio de aceptación del slice era *«la integración continua
  ejecuta los cuatro comandos en cada pull request»*.
- `alcaptar/agentic-skills#333`. *«Relanzó una slice que llevaba un rato parada,
  y la vuelta murió en el push mientras el equipo mergeaba a buen ritmo.»* Nueve
  fusiones de `master` hechas a mano en el historial de ese repo, todas por rama
  atrasada.

El primero ya está cerrado en este plugin (ver abajo). El segundo no.

Y el motivo por el que esto se ataca **ahora** y no cuando aparezca: la avería
escala con la paralelización. Con una slice en vuelo, la base se mueve poco entre
el corte y la entrega. Con `--cap` alto y varias slices mergeando, la ventana se
llena. `agentic-skills` lo dejó escrito como la condición exacta que le haría
reconsiderar su propia decisión de parar: *«esto se reconsidera cuando el
conflicto de contenido deje de ser un caso al mes, y lo que lo cambiaría es
paralelizar de verdad»*.

## Lo que ya existe

**El arranque está resuelto y no se toca.** `scripts/ct-next.mjs:1482`
(`fetchAndVerifyBaseOnRemote`) hace `git fetch origin <base>` con fallo terminal
y corta el worktree de `origin/<base>`, no de la copia local. `kickoff.js:453`
siembra `base_sha:` en `.agent/SLICE.md` con el sha exacto del corte.

**La entrega no tiene nada.** `dispatch-check --release` tiene seis puertas
—fichero de estado (5), contrato del plan (6), run entregado (7), correspondencia
e2e (8), go del gate `plan` (9)— y ninguna mira si `origin/<base>` avanzó.

**La reanudación tampoco.** `run-machine.js` está portado de `state_machine.py`
de `agentic-skills` y su propia cabecera declara que de los siete pasos del
original sobreviven cuatro (hoy seis). El de puesta al día no está. Lo que sí
existe, `stalenessNote` (`ct-next.mjs:566`), mira si hay una sesión viva para un
issue en vuelo — no la edad de la base.

## Lo que se hereda de agentic-skills, y lo que no

`agentic-skills#333` atacó esto entero y cerró **con la mitad entregada y la otra
mitad descartada a propósito**. Ese reparto es la herencia más valiosa de este
diseño, porque está medido:

**Lo que entregó y funciona** (`#334`, `#335`, `#345`, `#379`): la puesta al día
determinista, la CI en conflicto que no cierra el run, la extracción del paso
fuera del conductor, y la lista de ficheros en conflicto publicada en el issue.

**Lo que descartó** (`#336`, `#380`, `#381`): el resolutor con juicio. Coste
**128 USD, dos runs muertos, cero entregado**, sobre una frecuencia real de **dos
conflictos de contenido en 2.498 eventos** de un mes — y uno de los dos fue en una
slice de la propia feature.

**Este diseño sí construye el resolutor**, y conviene decir por qué eso no
contradice la medición. El fallo de `#336`/`#380` no fue *«resolver conflictos
con un modelo es mala idea»*: fue construir **un cuarto rol de infraestructura
entero** para hacerlo —brief, modelo, adaptador de invocación, telemetría,
contabilidad de gasto, higiene, contador propio— dentro del único paso del
pipeline que deja estado a medias en disco. 43 ficheros, 1.314 líneas. En Control
Tower esa mitad ya está construida: el patrón «el programa prepara un paquete, un
subagente lo trabaja, el programa valida el resultado» es literalmente
`ct-step verdict` + `agents/ct-judge.md`, y `run-metrics.js` ya mide coste por
paso e intento. Lo que aquí cuesta es un fichero de agente y un verbo.

**Cuatro lecciones que no hay que volver a derivar**, todas medidas ejecutando
código:

1. **Merge, nunca rebase.** Reescribir hashes obliga a `--force` sobre una pull
   request ya abierta.
2. **No preguntar si el árbol está limpio antes de fusionar.** `git merge` **sí**
   fusiona con el árbol sucio cuando lo sucio no colisiona con lo que llega, y
   además conserva el trabajo. Preguntar antes tiraría fusiones válidas. Sólo hay
   que clasificar **cuando el merge ya falló**, y se le pregunta al árbol
   (`MERGE_HEAD`), que es robusto frente al idioma y la versión de git, a
   diferencia de parsear `stderr`.
3. **`git merge --autostash` no vale.** No por el stash compartido —usa el ref
   `MERGE_AUTOSTASH`, que es por worktree—, sino porque al reaplicar no garantiza
   que lo staged siga staged, y el índice staged es el producto que el juez lee.
4. **La comprobación que faltaba: tras resolver, que no queden ficheros en estado
   `U`.** Sin ella, un resolutor que no resuelve —no lanza, no ensucia,
   simplemente no arregla— concluye la fusión con los marcadores `<<<<<<<`
   **dentro del commit**, con el árbol limpio y devolviendo `done`. Si el
   conflicto cae en un fichero que los controles no compilan, la pull request se
   abre y la integración continua sale verde.

## Lo que se descartó, y por qué

### Una puerta en `dispatch-check --release` en vez de un paso

Es la opción más barata: un exit code más junto a los seis que ya hay. Y detecta
el desfase perfectamente. Donde se queda corta es en todo lo que viene después:
una puerta no tiene contador de reintentos, ni estado que sobreviva a una
reanudación, ni sitio donde volver a pasar las verificaciones sobre el árbol ya
fusionado. `agentic-skills` descubrió las dos primeras carencias en `#335` (la
cuenta de intentos viaja en el estado persistido) y la tercera en `#345`.

### Reconciliar al final, justo antes de abrir la pull request

Cierra la ventana casi del todo, y es donde `agentic-skills` acabó concluyendo
que el desfase importa (*«el sitio donde el desfase importa y donde el árbol está
limpio por construcción es entre el commit y el push»*). Se descarta porque en
Control Tower entre el último commit y el push corren tres pasos que **verifican**:
`global`, `slice-judge` y `e2e`. Reconciliar después de ellos mete en la pull
request código que nada verificó — exactamente el agujero que el fetch del
arranque existe para cerrar.

### Reconciliar antes de `global` y repetir si la base volvió a moverse

Cierra la ventana del todo. Se descarta por coste: obliga a rehacer `global` y
`e2e` cada vez que la base se mueva, con su propio tope en la máquina, para cubrir
una ventana de minutos.

### Reescribir `base_sha` al nuevo tip de la base

Ver «La referencia de medida» más abajo. Rompería el gate de citas del plan.

### Abortar la fusión y bloquear ante un conflicto de contenido

Es lo que `agentic-skills` mergeó y lo que su medición defiende. Se descarta por
decisión explícita: se quiere que el sistema resuelva y siga, no que pare. La
medición sigue siendo válida como aviso —el caso es raro y el bucle puede no
converger— y por eso el diseño lleva tope de rondas y escalado, no un bucle
abierto.

## El diseño

### La referencia de medida: derivada, no guardada

Una fusión rompe el cálculo del diff del slice, y esto es lo primero que hay que
resolver porque condiciona todo lo demás.

`origin/main` está en **B** cuando arranca el slice. El agente comitea **S1** y
**S2**. El equipo mergea **C** y **D**.

```
A ── B ── C ── D            origin/main
      \
       S1 ── S2             feat/42   (HEAD)
```

`dispatch-check` mide con `git diff <base_sha>...HEAD` (`:603`). Los tres puntos
significan *«desde el antepasado común de B y HEAD, hasta HEAD»*, y ese
antepasado es B, así que el diff sale `B → S2`: sólo el trabajo del slice.

Tras fusionar:

```
A ── B ── C ── D            origin/main
      \         \
       S1 ── S2 ── M        feat/42   (HEAD = M, la fusión)
```

El antepasado común de B y M **sigue siendo B**, así que el diff pasa a ser
`B → M` = S1 + S2 **+ C + D**. Rompe tres cosas: la puerta de ficheros de estado
(exit 5) escanea trabajo ajeno, el contrato del plan (exit 6) ve decenas de
ficheros que el plan no nombra, y el juez de slice juzgaría código que el slice no
escribió. Y `ct-step.mjs:222` cuenta `git rev-list --count <baseSha>..HEAD` para
cruzar el estado con los commits reales: pasaría de 2 a 5, no cuadraría con «dos
tareas comiteadas», y **todo verbo moriría en PRECONDITION**.

La referencia correcta tras fusionar es **D**. Y D no se guarda en ningún sitio,
porque git ya la sabe:

```
git merge-base HEAD origin/<base>
```

- Rama sin fusionar → **B**. Igual que hoy.
- Rama fusionada → **D**, porque D es padre del commit de fusión.
- La base avanzó a D' después de reconciliar → sigue dando **D**, que es lo
  correcto.

Tres propiedades que esto tiene y que un campo guardado no tendría:

1. **Cero campos nuevos.** `.agent/SLICE.md` no se toca.
2. **Arregla un agujero que ya existe hoy.** Si alguien fusiona `main` en la rama
   a mano —desde la interfaz de GitHub— el diff del release ya se contamina hoy,
   en silencio. Con `merge-base` deja de pasar, venga la fusión de donde venga.
3. **No es manipulable por el agente.** `.agent/SLICE.md` es *agent-reachable*, y
   el propio `dispatch-check:543` ya desconfía de un `base:` igual a HEAD por eso.
   Un `merge-base` sale de la historia de git.

**`base_sha` se queda intacto y sigue teniendo consumidores.** No es un campo
muerto: `readFileAtBase()` (`dispatch-check.mjs:623`, invocada en `:738`) hace
`git show <base_sha>:<fichero>` para validar que los ficheros que el plan **cita**
no son inventados, y ahí la referencia buena es **B**, no D. El plan se escribió
después del corte y antes de implementar, citando los ficheros como estaban en B;
validar esas citas contra D acusaría al plan de citar de memoria porque otra pull
request tocó el fichero entremedias. Que es el mismo falso positivo que `base_sha`
se creó para cerrar en `jjponz/rust-monitoring#10`, reintroducido por la puerta de
atrás. `ct-harvest` también quiere B, para medir la latencia real del slice.

Los consumidores no quieren lo mismo:

| Consumidor | Referencia | Por qué |
|---|---|---|
| Puerta de ficheros de estado (exit 5) | `merge-base` | el diff no debe incluir lo que trajo la fusión |
| Contrato del plan, ficheros aportados (exit 6) | `merge-base` | lo mismo |
| `ct-step`, cuenta de commits | `merge-base` | si no, PRECONDITION y el run se atasca |
| Validación de citas del plan | `base_sha` | el plan se escribió contra B |
| `ct-harvest`, latencia y coste | `base_sha` | de dónde nació el slice |

Para `ct-step`, además, `--no-merges` deja la cuenta exactamente como hoy:
`git rev-list --count <merge-base>..HEAD --no-merges` excluye el commit de fusión,
así que **la tabla de la máquina no cambia**.

### El paso `reconcile`

Entra en `run-machine.js` entre el `commit` de la última tarea y `global`. Es un
paso de slice, no de tarea, como `global`, `slice-judge` y `e2e`.

Va **antes** de `global` para que todo lo que verifica mida el árbol que la pull
request va a llevar de verdad, y para que el juez de slice juzgue el diff real. Y
va **justo después de un commit**, lo que da gratis la precondición que
`agentic-skills` identificó como la causa de sus tres hallazgos altos: el árbol
está limpio por construcción.

Un solo verbo, idempotente. `MERGE_HEAD` decide qué mitad ejecuta, así que no hay
contador que sincronizar ni verbo que se pueda invocar fuera de orden.

```
ct-step reconcile
│
├─ SIN MERGE_HEAD → primera mitad
│    git fetch origin <base>
│    git rev-list --count HEAD..origin/<base>
│    ├─ 0  → nada que fusionar. Avanza a global. Cero commits, cero coste.
│           (Aquí cae también la rama ya fusionada por otro: es donde se
│            hace la validación post-hoc de los «Límites declarados»)
│    └─ >0 → git merge --no-edit origin/<base>
│         ├─ ok        → avanza a global
│         ├─ conflicto (MERGE_HEAD presente) → NO aborta. Escribe el paquete
│         │              del reconciler y pide dispatcharlo. Exit propio
│         └─ falla SIN dejar MERGE_HEAD → no es conflicto de contenido: es el
│                       árbol sucio, o git negándose. Escala al agente del
│                       slice, que es de quien es esa basura y tiene Bash
│
└─ CON MERGE_HEAD → segunda mitad, validación determinista
     1. lista = git diff --name-only --diff-filter=U
     2. ¿algún fichero modificado en el árbol FUERA de lista? → ronda descartada
     3. ¿marcadores <<<<<<< ======= >>>>>>> en algún fichero de lista?
                                                            → ronda descartada
     4. git add <lista>          ← el programa, nunca el agente
     5. ¿queda algún fichero en U?                          → ronda descartada
     6. git commit --no-edit. Avanza a global
```

**Una ronda descartada no para el run.** Restaura los marcadores con
`git checkout --merge -- <ficheros>` —el merge sigue vivo, no se pierde nada—,
mete el motivo del descarte en el paquete (*«dejaste marcadores en `foo.py`»*,
*«tocaste `bar.py`, que no estaba en conflicto»*) y se vuelve a pedir la
resolución. Es el mismo mecanismo que `ct-step` ya usa con el implementador
(`MAX_DISCARDS = 6`).

`Budgets` gana `reconcileRetries: 2`, junto a `controlRetries`, `judgeRetries` y
`correctionRetries`. `RUN_STATES` gana `BLOCKED_RECONCILE`, hermano de
`BLOCKED_CONTROLS` y compañía.

### El resolutor

`agents/ct-reconciler.md`, hermano de los dos jueces con la simetría invertida.
Los jueces llevan `Read, Grep, Glob, Write` y **no** llevan Bash para que no
puedan convencerse de que los tests pasan. El reconciler lleva
`Read, Grep, Glob, Edit` y no lleva **ni Bash ni Write**: no puede `git add`, no
puede commitear, no puede abortar la fusión, no puede crear ficheros. Sólo puede
editar los que ya existen.

Eso convierte la higiene de una comprobación en una propiedad: **git no considera
resuelto un fichero hasta que alguien hace `git add`**, y el único que puede
hacerlo es el programa, que sólo conoce la lista de ficheros en conflicto. Es
imposible que se stagee algo de fuera.

**El paquete** lo escribe el programa en `.agent/run-<issue>/`, mismo patrón que
los briefs de los jueces:

- Los ficheros en conflicto (los lee del árbol, con los marcadores puestos).
- **El log de los commits entre B y D**, con sus mensajes. Sin esto resuelve a
  ciegas: ve dos textos que chocan y no sabe qué intención tenía el otro lado. Es
  lo primero que mira un humano, y es lo que `agentic-skills` nunca llegó a
  pasarle a su resolutor.
- El `### Desired end state` del plan, para saber qué defiende su lado.
- La vara: los cinco documentos de `conventions/` más `.agent/conventions.md`,
  pegados por el programa igual que en los briefs de los jueces.

**La instrucción que define el rol:** conserva las dos intenciones, no elijas un
lado por defecto, no toques nada que no sea un fichero en conflicto, y **si no
sabes resolverlo, dilo en vez de inventar**.

### El escalado

Agotadas las `reconcileRetries`, la última bala la tiene **el agente del slice**:
es el único que conoce el trabajo que está en su lado del conflicto, y sí tiene
Bash. El programa no invoca modelos, así que esto es un exit code y un mensaje que
dice qué pasó y qué se espera. Si el agente del slice tampoco puede, entonces sí
`BLOCKED_RECONCILE`, con la lista de ficheros, y lo resuelve una persona con un
merge de una línea.

**El programa no necesita saber quién resolvió.** El agente del slice, al
terminar, vuelve a llamar a `ct-step reconcile` y pasa por las mismas tres
validaciones. No hay camino privilegiado.

El árbol sucio va por aquí directamente, sin pasar por el reconciler: no es un
conflicto de contenido y el reconciler no pinta nada resolviéndolo.

### El coste

Sale gratis. `run-metrics.js` escribe **una fila por intento de un paso**, con
`step`, `attempt`, `plan_sha256`, `plugin_version` y `actor`. Como `reconcile` es
un paso, sus rondas se miden solas: basta con que el verbo escriba su fila como
los demás. Sin eso, lo que cuesta resolver conflictos quedaría dentro del saco de
otro paso, y la pregunta *«¿valió la pena automatizar esto?»* no se podría
contestar con datos — que es exactamente lo que le permitió a `agentic-skills`
parar a tiempo.

## Cómo se escribe esto

La vara del repo son los cinco documentos de `conventions/`. No es decoración:
es lo que el juez de cada tarea aplica, y traducirla a esta feature cambia
dónde vive el código.

### Módulo nuevo, no un verbo más dentro de `ct-step.mjs`

`style.md` y `architecture.md` conceden a un módulo que ya estaba una **deuda
declarada**: lo que le añades sigue el estilo de su anfitrión, y eso no es un
hallazgo. Y cierran el hueco en la misma frase:

> *a new concept is a new module and is born conforming* … *placing a new
> concept inside an old file to inherit the exemption **is** a finding.*

La lógica de la reconciliación es un concepto nuevo. Así que **nace conforme**:
en inglés, sin un solo comentario, con todo colgando de un tipo y sin funciones
sueltas a nivel de módulo. Lo que se queda en `ct-step.mjs` es el cableado del
verbo, que sí extiende lo que había y hereda la exención. Igual el cambio de
`dispatch-check.mjs`.

**La exención acaba en `defects.md`**, cuyas reglas atan en todo diff, módulo
viejo o nuevo — porque ninguna es cuestión de cómo se lee el código.

### La referencia de medida está *spread*, y hay que resolverlo

`decisions.md` da una vara concreta: *«si esta decisión cambiara, ¿cuántos
ficheros habría que tocar para que el programa siga siendo coherente? Uno, o
está esparcida.»*

La referencia de medida (`merge-base HEAD origin/<base>`) la consumirían tres
sitios: las dos puertas de `dispatch-check` y la cuenta de commits de `ct-step`.
Si mañana se cambia —incorporar un `reconciled_sha`, pasar a `--first-parent`—
hay que tocar los tres **a la vez** o el programa se contradice: la puerta mide
una cosa y el paso otra. La pregunta que separa decisión de idioma
(*«¿hay un cambio de negocio que obligue a tocar los dos a la vez?»*) sale que
sí. **Es una decisión, y va en un módulo propio que los tres consuman.**

Lo mismo, por el mismo motivo, con otras dos: **la clasificación del fallo del
merge** (¿quedó `MERGE_HEAD`?) y **la lista de ficheros en conflicto**, que
calculan la primera mitad para el paquete y la segunda para validar y para el
`git add`.

Y `decisions.md` añade una que muerde aquí: *«a field without its question.
Whatever holds the data owns the question.»* El vocabulario de desenlace trae
la pregunta —¿esto avanza el flujo, pide otra ronda, escala?—; no la derivan
sus consumidores a mano.

**Aviso de nombre:** `scripts/reconcile.js` ya existe y es otra cosa — la
reconciliación de *issues* de `/ct-groom`. El módulo nuevo no puede llamarse
así.

### El desenlace es un vocabulario cerrado, y su despacho es exhaustivo

`defects.md` lo pide sin exención: *«a value that classifies something is a
member of a closed vocabulary»*, *«an answer carries the vocabulary, not a
boolean derived from it»*, y despacho **sin rama por omisión**. `architecture.md`
lo repite para las políticas: *«it returns the whole effect, not a boolean and
not a map»*.

De este diseño salen seis estados que se arreglan distinto: nada que fusionar,
fusionó limpio, conflicto de contenido, el merge falló sin dejar `MERGE_HEAD`,
resolución validada, y ronda descartada. Un booleano los colapsa; una ronda
descartada además lleva **su motivo**, que es parte del efecto y no un campo
aparte.

Sobre el despacho exhaustivo hay que ser concretos, porque esto es JavaScript y
no hay `mypy` que ponga rojo el `match`. La convención lo contempla: *«where it
does not [fail at compile time], in the test that covers that dispatch»*. Así
que **un test recorre todos los miembros del vocabulario y falla si alguno cae
en una rama por omisión.** Y no es teórico: el juez de `agentic-skills` levantó
exactamente este hallazgo (`f2`, medium) sobre este mismo código, avisando de
que el miembro que añadirían las slices siguientes caería en «seguir
conduciendo» sin que nada se quejara. Aquí ese miembro es el que añade el
resolutor.

### La política vive en `run-machine.js`, no en el verbo

`architecture.md`: *«la regla exacta —qué paso viene después de un resultado,
qué cuenta como agotado— es un objeto de dominio, no prosa y no un condicional
dentro de un caso de uso»*. Y *«conducir no es ejecutar: si su resultado se
proyecta a un desenlace que el flujo recibe, es un paso»* — el de `reconcile` se
proyecta, luego es un paso, que es la decisión ya tomada por otra vía.

Consecuencia: la decisión de **otra ronda / escalar al agente del slice /
bloquear** no es un `if` en el verbo. Va en `run-machine.js`, que ya es
literalmente eso — *«PURO: ni un import, ni una lectura, ni un reloj»*.

Y la proyección del vocabulario de reconcile al `OUTCOMES` del flujo **vive del
lado del destino**, no en `ct-step`: *«translating a step's result into the
flow's vocabulary is not the conductor's either, or every new step brings its
own conditional to the conductor»*. Que es, palabra por palabra, el issue `#345`
de `agentic-skills`.

### Dos reglas de frontera que este paso incumpliría por descuido

- *«No call to an external process is launched without a cap, and the adapter
  does not choose the cap: it arrives through the constructor with no default.»*
  El helper `git` de `ct-step.mjs` lleva `timeout: 120_000` escrito a mano
  (`:157`). El módulo nuevo no puede: el tope entra por constructor.
- *«A non-zero exit code is data, not an exception: it gets interpreted, because
  the reason is on the diagnostic channel and an exception erases it.»* El
  código de salida de `git merge` se interpreta —limpio, conflicto, otra cosa—,
  no se convierte en excepción. Es exactamente la clasificación por `MERGE_HEAD`,
  y la convención explica por qué esa es la forma correcta y no un rodeo.

### Los tests

`testing.md` fija cuatro cosas que aquí no son opcionales:

- **Outside-in, en este orden**: primero la capa de aplicación con los puertos
  doblados, luego infraestructura. Lo del dominio se cubre por ese camino.
- **El arrange no se construye con la pieza bajo prueba.** El repositorio git
  del escenario se monta con `git` de verdad, nunca llamando al propio módulo
  que se está midiendo. Este es el hallazgo `f1` —severidad **alta**— que el
  juez de `agentic-skills` levantó sobre exactamente estos tests: montaban la
  rama del escenario con el mismo adaptador bajo prueba, así que un cambio en
  otro método lo habría roto por el arrange, o —peor— habría medido otro
  escenario en silencio.
- **Un test que lanza un subproceso real va marcado como tal**, para que exista
  un subconjunto rápido. Los de `git` lo son todos.
- **Una aserción no está terminada hasta que se la ha visto fallar por el motivo
  que dice su nombre.** Rompe a mano lo único que protege —quita el marcador de
  conflicto del fichero, invierte la condición—, compruébala roja, restaura.
  Muerde especialmente en las aserciones sobre texto, que aquí son casi todas:
  «no quedan marcadores `<<<<<<<`» pasa en verde por motivos que no son el suyo
  con una facilidad desagradable.

Y las madres de objetos con **métodos que son escenarios nombrados** — «rama por
detrás de su base», «rama con un conflicto de contenido», «rama ya al día» — no
un constructor con todo por defecto.

## Lo que se toca

| Fichero | Cambio |
|---|---|
| **módulo nuevo** (nombre en inglés; **no** `reconcile.js`, que ya existe para los issues del groom) | la referencia de medida, la clasificación del fallo del merge y la lista de ficheros en conflicto. Nace conforme: inglés, sin comentarios, todo colgando de un tipo, tope por constructor |
| **módulo nuevo** | el vocabulario cerrado de desenlaces y su proyección al `OUTCOMES` del flujo, del lado del destino |
| `scripts/run-machine.js` | paso `reconcile`, `BLOCKED_RECONCILE`, `reconcileRetries: 2`, y la política de ronda/escalado/bloqueo |
| `scripts/ct-step.mjs` | cableado del verbo `reconcile`; `commitsDesde` consume la referencia del módulo nuevo y añade `--no-merges`; lee `base:` de `.agent/SLICE.md` con el `parseStateSafe` que ya usa para `epic:` y `senal:` |
| `scripts/dispatch-check.mjs` | `stateFilesIntroducedByBranch()` (`:552`) y `branchIntroducedFiles()` (`:586`) consumen la referencia del módulo nuevo; `readFileAtBase()` (`:623`) se queda con `base_sha` |

Un detalle de `dispatch-check` que hay que resolver y no es obvio: `merge-base`
necesita el **nombre** de la base (`origin/<base>`), y `sliceBaseRef()` devuelve
hoy un sha, porque prefiere `base_sha:`. Así que hacen falta dos resolutores
donde hoy hay uno: `sliceBaseRef()` se queda como está para las citas del plan, y
nace uno hermano que resuelve el nombre de la rama remota con la cadena de
fallback que ese mismo fichero ya tiene escrita (`base:` → `origin/HEAD` →
`origin/main` → `main` → `master`, `:518`) y de ahí saca el `merge-base`. Si no
resuelve, se cae a `base_sha` y el comportamiento es el de hoy, que es la
degradación correcta: conservadora, nunca silenciosa.
| `scripts/step-contracts.js` | el contrato del paso nuevo |
| `agents/ct-reconciler.md` | nuevo |
| `scripts/kickoff.js` | nombrar el paso donde ya nombra los otros |

`.agent/SLICE.md` no cambia de forma. Ningún estado persistido gana campos
obligatorios, así que un run abierto hoy se sigue leyendo.

## Límites declarados

**Queda una ventana, y no se cubre.** Entre `reconcile` y el `gh pr create` corren
`global`, `slice-judge` y `e2e`. Si la base se mueve ahí, la pull request nace
atrasada — menos que hoy, pero no cero. Decisión explícita: cubrirla obligaría a
rehacer las verificaciones en bucle para ganar minutos.

**El agente del slice puede saltarse la validación.** Tiene Bash, así que podría
hacer `git add` y `git commit` por su cuenta sin volver a llamar a `ct-step
reconcile`. Es el mismo límite que la puerta F22 ya declara para `--release`: *«el
kickoff es un prompt, no un gate»*. Se mitiga barato: cuando `ct-step reconcile`
encuentra que HEAD ya es un commit de fusión y no hay `MERGE_HEAD`, valida
post-hoc que ese commit no trae marcadores. No lo vuelve hermético; mueve el caso
normal de la retina del humano al loop.

**El bucle puede no converger.** Un modelo que no sabe resolver un conflicto
concreto no aprende entre rondas: gasta. En `agentic-skills`,
`abortada:presupuesto` se puso **19 veces en un mes** — su modo de fallo más
frecuente con diferencia, muy por encima del conflicto que este diseño ataca. Por
eso hay tope de rondas y escalado, y no un bucle abierto contra el presupuesto del
slice.

**Sólo se cubre la entrega.** Un slice que se reanuda tras días parados implementa
sobre una base vieja y sólo lo descubre al llegar a `reconcile`, con el trabajo ya
pagado. `agentic-skills#334` cubrió ese momento y luego midió que el sitio bueno
era el otro; aquí se elige el otro directamente. Si la reanudación de slices
parados resulta ser frecuente, este es el primer sitio donde mirar.
