# La primera corrida en un repo ajeno — cinco hallazgos, y los cuatro que `agentic-skills` ya resolvió

> Revisión de campo del trabajo de la rama `d4-conductor-como-programa`, medida
> sobre una corrida que no es nuestra: `jjponz/rust-monitoring`, issue #2, pull
> request #10, mergeada el 19 ago 2026 a las 16:05:41 UTC.
>
> No es una simulación y no es un test. Es la primera vez que `ct-step` conduce
> la implementación de un slice en un repo que no es el del plugin, con un plan
> escrito por su sesión, un gate humano de verdad y una pull request que un
> humano mergeó. Todo lo que sigue está medido sobre ese material.
>
> Este documento **no propone tomar D-4 en upstream**. La corrida se hizo con el
> fork que ya la tomó (`3071d8a`, versión 0.36.1), y la decisión sigue siendo de
> su dueño. Lo que propone son cinco arreglos que valen igual con la sesión
> conduciendo y con un programa conduciendo, porque ninguno de los cinco es
> sobre quién decide la secuencia.

---

## 1. Qué se midió, exactamente

La rama estaba entera cuando corrió: los dos últimos commits —`3071d8a` (el
kickoff enchufa `ct-step`, se borra `d4-sigue-siendo-de-jose.test.js`) y
`590b995` (la review de los cuatro puntos: el reset del índice, el gate del run
en `--release`, el veredicto viajando en la pull request, los docs)— son de las
10:37 y las 14:50 UTC, y el slice arrancó a las 15:31. La corrida no probó una
versión a medias.

El slice es el esqueleto de un port: crear el crate de Rust `mo-monitoring` con
su toolchain fijado, la integración continua que ejecute cuatro comandos en cada
pull request, y `AGENTS.md` documentándolos. Tres tareas, un plan prescriptivo de
246 líneas, gate `plan` con OK humano.

La línea de tiempo entera, en UTC:

| Hora | Qué |
|---|---|
| 15:14 | issue #2 creado por `/ct-groom` |
| 15:31:48 | la sesión publica el plan como comentario del issue (commit `c3c7c75`) |
| 15:33:53 | el humano contesta `ok` — **2 minutos y 5 segundos** sobre 246 líneas |
| 15:39 / 15:42 / 15:54 | las tres tareas, comiteadas por `ct-step commit` |
| 15:54:25 | `c399a1a` — la sesión **corrige el plan ya aprobado** |
| 15:55:22 | pull request #10 |
| 15:57:19 | la sesión avisa: la integración continua no ha arrancado |
| 16:03:31 | `c02baed` — merge de `main` en la rama, resolviendo conflicto |
| 16:03:42 | el check arranca, once segundos después |
| 16:05:41 | mergeada |

Cincuenta y un minutos de punta a punta.

## 2. Lo que quedó demostrado

La fontanería entera cierra sola, en un repo que no es el nuestro y en un
lenguaje que el plugin no conoce: la secuencia por tarea, el brief compuesto
desde el plan, los controles corriendo **antes** del juez, el stageo desde el
informe, el commit compuesto por el programa y validado contra las closing
keywords, el veredicto escrito en `docs/superpowers/verdicts/` y viajando dentro
del commit de su tarea, y `dispatch-check --release` exigiendo el run entregado.

Tres veredictos `PASS` con cero hallazgos, cero descartes, cero vetos, cero
intervenciones a mano en la secuencia.

Y algo que no es del programa y merece constar: **la sesión escribió una pull
request honesta**. Levantó por su cuenta las dos cosas que un revisor tenía que
mirar (el plan corregido después del gate, y el lockfile que la integración
continua no hace valer) y publicó un aviso diciendo que el criterio de
aceptación de la integración continua **no estaba demostrado**. Nada del
programa le obligaba a ninguna de las tres cosas. Ese es exactamente el problema
de las tres: salieron bien porque esa sesión era buena.

## 3. Los cinco hallazgos

### H1 — La costura entre la plantilla del plan y `ct-step controls` deja pasar controles que ninguna implementación puede superar

El plan declaró este control para la tarea 3, y `--check-plan` lo aceptó con
exit 0:

```bash
git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract'   # expected: 0
```

`ct-step controls` puntúa **sólo por código de salida** (`ct-step.mjs:432`).
`grep -c` con cero coincidencias imprime `0` y sale con `1`; con coincidencias
imprime el número y sale con `0`. El control sólo podía ponerse verde en el caso
malo — la sección protegida tocada — y fallaba siempre en el caso bueno. Ninguna
implementación podía superarlo.

Lo grave no es el fallo: es que atravesó las dos puertas que existen para esto.

- **`--check-plan` no lo vio** porque la regla nueva de `plan-contract.js` exige
  que el bloque de comandos **exista**, no que el código de salida de cada
  comando signifique lo que dice su comentario. La regla cerró el agujero de "la
  vara es prosa" y dejó abierto el de "la vara es un comando que mide al revés".
- **El gate humano tampoco**, y no por descuido: 246 líneas en 125 segundos es
  todo lo que una persona puede hacer con un plan de ese tamaño. Un gate cuyo
  material no se puede leer en el tiempo que se le dedica no es un control, es
  una firma.

Y el propio material empuja hacia el error. `plan-template.md` enseña el patrón
`{{command}}   # {{expected: exit 0, N tests}}`, que invita a escribir la
expectativa como un número impreso; y `writing-plans-prescriptive/SKILL.md`
razona en esos términos —"a `grep -c` that should print 2 and prints 3 is a task
whose verification cannot pass"— mientras la máquina, dos capas más abajo, sólo
mira `$?`. La plantilla habla de lo que el comando **imprime** y el ejecutor
decide por lo que **devuelve**.

Se arregló en vuelo (`c399a1a`), reemplazándolo por un predicado:

```bash
test "$(git diff HEAD -- AGENTS.md | grep -c 'ct-init:slices-contract')" -eq 0
```

La pull request lo señala y pregunta si un cambio así debería volver al gate. La
pregunta correcta es otra: por qué el gate y el validador pueden dar por bueno un
control imposible.

### H2 — El worktree se corta de un `main` local rancio, y la cadena acaba en una pull request sin ningún check

`ct-next.mjs:3418` crea el worktree con `git worktree add -b <rama> <wt>
<resolvedBase>`, donde `resolvedBase` es un **nombre local**:
`verifyBaseExistsLocally` (`ct-next.mjs:1475`) prefiere la rama local y sólo mira
`origin/<base>` cuando la local no existe. No hay `git fetch` en ninguna parte
del despacho.

La base real de `feat/2` fue `55b4870` ("Bootstrap Control Tower loop"), cuando
la pull request #1 —que había reescrito `## Project overview` de `AGENTS.md`— ya
estaba mergeada desde las 15:12 UTC, diecinueve minutos antes de escribirse el
plan. El slice nació sobre un `main` que estaba un commit por detrás de su
remoto.

Dos consecuencias, en cadena.

**El plan nació literal contra un árbol que nadie iba a mergear.** La tarea 3
cita `Current state (AGENTS.md, lines 8-10)` con el texto viejo, y su asunción 6
manda sustituir la frase "Recién creado y vacío", que en `main` ya no existía. La
comprobación de literalidad lee el árbol de trabajo, así que un worktree rancio
produce un plan perfectamente literal y perfectamente obsoleto.

**La pull request quedó en conflicto, y por eso GitHub no arrancó nada.** Sin
poder calcular la referencia de merge de la pull request no hay run que crear, y
el trigger `push` del workflow sólo cubre `main`. Es exactamente lo que midió el
aviso de la sesión: `total_count: 0` en workflows y en check-suites. En cuanto el
conflicto se resolvió (`c02baed`, 16:03:31) el check arrancó once segundos
después y salió verde.

El aviso de la sesión merece las dos notas a la vez. Dijo con precisión que el
criterio de aceptación no estaba demostrado —eso es exactamente lo que hay que
hacer— y atribuyó la causa a "algo de cuenta/organización (minutos,
restricciones de Actions en repos privados)", decidiendo no perseguirla por estar
fuera del alcance del slice. La causa estaba dentro de su alcance y a un `git
merge main` de distancia.

Y `dispatch-check --release`, que desde `590b995` sí exige plan válido (exit 6) y
run entregado (exit 7, `dispatch-check.mjs:544`), no comprueba que la pull
request sea mergeable ni que tenga un check. El gate de integración continua
puede dejar de existir sin que nada del loop lo note.

### H3 — El veredicto que llega a la pull request no se distingue de un juez que no miró

`agents/ct-judge.md` cierra con una instrucción explícita: responder con la ruta,
el veredicto y **los ocho ítems con lo que dio cada uno**, porque "sin esa línea
un PASS con hallazgos vacíos no se distingue de ocho ítems que nadie abrió, que
es el fallo que esta rúbrica existe para acabar".

Esa línea va en la **respuesta conversacional** del subagente. El esquema que
`ct-step verdict` valida y persiste es `{ruling, findings}`, y lo que se escribe
en `docs/superpowers/verdicts/issue-<n>-task-<t>.json` (`ct-step.mjs:611`) es ese
objeto con un envoltorio de identidad. Lo que quedó commiteado en la pull request
son tres ficheros así:

```json
{
  "issue": 2,
  "task": 1,
  "task_name": "Crate `mo-monitoring` con toolchain fijado y smoke test",
  "verdict": { "ruling": "PASS", "findings": [] }
}
```

Es decir: exactamente el artefacto que la propia rúbrica declara indistinguible
de ocho ítems que nadie abrió. El mecanismo que `590b995` construyó para cumplir
el criterio de cierre de F37 —el veredicto viaja en la pull request— transporta
el veredicto sin lo único que lo hace auditable.

### H4 — El canal por el que el implementador avisa muere si nadie lo abre a mano

`prompts/task-implementer.md` ordena obedecer las decisiones cerradas y poner la
discrepancia en el informe: "una decisión cerrada que obedeciste y habrías
discutido, un problema real que deliberadamente no arreglaste". El sitio es el
campo `summary`.

El caso se dio, y era bueno: `Cargo.lock` se commitea con la razón declarada "CI
reproducible", mientras el workflow ejecuta `cargo build` y `cargo test` **sin
`--locked`**, así que el lockfile no se hace valer. Inocuo con cero dependencias,
real con la primera. El implementador de la tarea 2 hizo exactamente lo
prescrito: obedeció la fila de la tabla y lo dijo en su informe.

Y ahí se habría quedado. `ct-step report` no imprime el `summary` —sólo cuenta
ficheros stageados (`ct-step.mjs:391`)—, `ct-judge` tiene orden explícita de
ignorarlo ("the `summary` is evidence for nothing, in either direction"),
`run.lastSummary` no lo consulta ningún verbo, y su único consumidor es la
telemetría, que se escribe fuera del repo. El test del propio repo lo dice sin
rodeos: "el resumen muere en el estado si nadie lo lee". Llegó a la pull request
porque la sesión conductora abrió el fichero del informe por iniciativa propia.

Un canal cuyo contenido depende de que el lector se acuerde de mirarlo no es un
canal.

### H5 — La rúbrica de ocho ítems no tuvo casi nada que morder, así que la corrida validó la fontanería y no el juicio

Es un slice de esqueleto sobre un repo vacío: `## 3. Reference patterns` del plan
dice "N/A" porque no hay código al que parecerse, no hay una sola línea `-` en
ningún fichero de test, y dos de las tres tareas son configuración y
documentación con `**TDD:** No TDD`.

De los ocho ítems, cuatro no tenían sujeto: `patrones` (sin patrón que citar),
`contrato` (sin símbolos), `manipulacion-tests` (sin tests previos) y
`fixture-theater` (dos tareas sin lado de producción). Tres `PASS` con cero
hallazgos era el resultado esperado, no una medida del juez.

Y la incoherencia del `--locked` tampoco era suya: es una contradicción **del
plan**, y el ítem `decisiones-cerradas` le manda obedecer las filas, no
auditarlas — "reopening one is the failure this item names". Correcto por diseño,
y deja a la vista que una decisión cerrada mal razonada no tiene ningún control
detrás salvo el humano de la pull request.

## 4. Lo que la corrida no probó

El veto del juez y el reintento con `lastFindings`. Los descartes por esquema. El
tope en dinero y `total_cost_usd` (no hay llamadas headless con `ct-step`). La
reanudación tras muerte del programa. Y todo lo que la rúbrica mira cuando hay
código previo.

Dos datos de forma, además:

- De las 332 líneas añadidas por la pull request, **273 (82%) son artefactos de
  proceso**: el plan (246) y los tres veredictos (27). El producto son 59 líneas.
  Es el precio del contrato de F37 y está bien pagado, pero un revisor humano
  abre esa pull request y lo primero que ve es el plan.
- El único test del slice es `assert_eq!(env!("CARGO_PKG_NAME"),
  "mo-monitoring")`: una garantía del sistema de construcción, no del producto.
  Está razonado en la asunción 4 del plan (que `cargo test` con cero tests no
  prueba que el harness corra) y es defendible, pero el epic estrena su convención
  de tests con un test que no puede fallar por una causa de producto.
- `.agent/STATE.md` de `main` sigue diciendo `next_action: correr /ct-groom` y
  "el código del crate aún no existe" después del merge. Nada del loop fuerza
  refrescarlo al cerrar un slice.

## 5. Lo que `agentic-skills` ya resolvió

Cuatro de los cinco hallazgos tienen respuesta construida en
`~/repos/agentic-skills`, el loop en Python del que este plugin porta la forma y
las decisiones. Los mecanismos son distintos, y las diferencias son el material
útil: no se trata de copiar código —el diseño de D-4 ya declara que no se porta
código— sino de saber qué propiedad hace falta.

| Hallazgo | En `agentic-skills` | Diferencia de mecanismo |
|---|---|---|
| H1 controles con la semántica al revés | Resuelto de raíz | La vara la declara el **repo**, no el plan |
| H2 base rancia, conflicto, sin checks | Resuelto en las dos mitades | Se corta de `origin/<base>`, y "sin checks" es un estado con nombre |
| H3 el paseo por la rúbrica no viaja | **No resuelto tampoco** | Mismo esquema, misma pérdida |
| H4 el aviso del implementador muere | Resuelto | `left_out` es un campo del esquema con destino escrito |
| H5 rúbrica sin sujeto | Resuelto a medias | Vara declarada por el repo, y el insumo vacío se declara |

### 5.1 H1 — la vara la declara el repo antes de empezar, no el plan por tarea

En `agentic-skills` los controles no se escriben por tarea: se declaran **una vez
por repositorio** en el cuerpo del issue padre, bajo `## Controles`, como pares
`- <nombre>: <comando>` que `ParentBody._controls` parsea
(`infrastructure/parent_body.py:75`). Una persona los confirma antes de que corra
el primer slice, y en tiempo de ejecución sólo se leen. `Controls` admite además
una exención reservada explícita (`- ninguno: <motivo>`), y declarar comandos y
exención a la vez es un error de parseo, no un empate silencioso.

El ejecutor decide igual por código de salida —`LocalControlRunner.run` mapea
`output.code == 0` a `GREEN` y cualquier otra cosa a `RED`—, así que el problema
técnico es idéntico. Lo que desaparece es la **superficie**: no hay un comando
nuevo por tarea escrito por un agente, así que no hay un sitio donde inyectar un
control imposible. Si los cuatro comandos del repo estuvieran mal, se descubriría
en el primer slice y para todos, no en el tercero de este.

Y la lección exacta de H1 ya está escrita ahí, dirigida a otro lector:
`slice_implementer_brief.py:50-54` advierte al implementador de que **por una
tubería el código de salida que ves es el del último tramo, no el del comando**,
con `make check 2>&1 | tail -80` como ejemplo. El fallo de la corrida fue `git
diff ... | grep -c ...`: la misma trampa, en el mismo sitio de la tubería. Está
avisado quien **lee** resultados y no quien **declara** la vara.

Lo que se sigue para este plugin: la vara por tarea es más precisa que la vara
por repo —permite exigir "esta tarea añadió este test", que es lo que caza el
caso del §11.bis del spec de D-4— y esa precisión hay que conservarla. Lo que hay
que traer no es la declaración por repo, es la desconfianza: un comando escrito
por un agente para una sola tarea necesita un validador que compruebe que su
código de salida puede ser cero, y `plan-contract` es el sitio.

**Y el sitio ya tiene dueño y ya tiene la regla anterior de esta misma serie.**
`scripts/plan-contract.js` es entero de jjponz: lo creó en `529d2f4` (pull
request #27, "literalidad, taxonomía de bloques y gate humano", ya en `main`) y
en esta rama le añadió `5b97fdd`, "la vara de la tarea deja de poder ser prosa" —
la regla `verification-block`, que exige que detrás de `**Verification:**` haya
un bloque cercado y que no esté vacío (`plan-tasks.js:353,355`). Esa regla cerró
el agujero de "la verificación es prosa que nadie puede ejecutar". Lo que H1
enseña es el agujero de al lado, un paso más adelante: la verificación **es** un
comando ejecutable y mide lo contrario de lo que dice medir. La regla que falta es
la siguiente de la serie, en su fichero y en su idioma — no una propuesta
alternativa a lo que hizo.

### 5.2 H2 — la base sale del remoto, siempre, y "sin checks" tiene nombre

Las dos mitades están construidas y son dos mecanismos separados.

**La base.** `GitBranches.create` (`infrastructure/git_branches.py:30`) hace
`git fetch origin` y **después** `git switch -c <rama> origin/<base>`: la rama
nace del remoto, nunca de la copia local, y el fetch no es opcional.
`commits_behind_remote` (línea 37) vuelve a hacer fetch y cuenta
`base..origin/base`, lanzando `UnresolvableBaseError` si la base no resuelve
contra su remoto. Encima de eso hay dos capas de aviso: un precheck que devuelve
`PrecheckOutcome.BASE_NOT_ON_REMOTE` antes de reclamar nada
(`domain/prechecks.py:37`), y un readiness check
(`queries/check_readiness.py:162`) que reporta "base is N commits behind its
remote" con el arreglo escrito al lado: `git -C <worktree> branch -f <base>
origin/<base>`. Es literalmente la situación de la corrida, con su remedio.

**Los checks.** `CiStatus` tiene cinco valores y uno es `NO_CHECKS`, distinto de
`UNKNOWN` (`domain/ci_status.py`). Y cuando la lectura de la integración continua
sale indeterminada, `ReadCiStatus._indeterminate`
(`queries/read_ci_status.py:47`) hace justo lo que la sesión de la corrida no
hizo: **pregunta la mergeabilidad de la pull request**, y si es `CONFLICTING`
devuelve `Outcome.CONFLICTING` en vez de `INDETERMINATE`. El diagnóstico que la
sesión adivinó mal está ahí como una transición.

Eso es posible porque la máquina de `agentic-skills` no acaba en el commit: sus
pasos son `understand`, `implement`, `run-controls`, `verify`,
`open-pull-request`, `await-ci`, `await-merge` (`domain/step.py`). La integración
continua es un paso del loop, así que "no hay checks" y "está en conflicto" son
estados que alguien tiene que resolver. En `ct-step` no hay paso ahí: la máquina
termina en `commit`, la sesión abre la pull request, y lo único que podía notar el
silencio era la prosa de esa sesión.

Lo que se sigue, y sólo eso: **se construye el arreglo de la base y nada más.**
Fetch, y cortar de `origin/<base>`. No necesita ninguna decisión de diseño, y es
la mitad que evita el conflicto — con la que la otra mitad no habría tenido nada
que diagnosticar, porque los checks habrían corrido.

Lo de los checks se deja para más adelante a propósito. Darle a la máquina un
estado para "sin checks" o "en conflicto" es meterle un paso posterior al commit,
y eso es material de D-4 y bastante más trabajo que el resto de este documento
junto. Queda el hecho apuntado en H2 —`--release` libera sin mirar si la pull
request es mergeable— para cuando haya que decidirlo.

### 5.3 H3 — no está resuelto allí tampoco, y conviene decirlo

La rúbrica del verificador de `agentic-skills`
(`infrastructure/slice_verifier_judge.py`) tiene nueve ítems y abre con "recórrela
**entera** y reporta ítem a ítem". Su esquema de salida es
`{ruling, findings}` (`infrastructure/verdict_payload.py`). El paseo por la
rúbrica se pierde por el mismo sitio, con el mismo argumento y con la misma
consecuencia: un `PASS` con `findings: []` no dice qué se miró.

Así que H3 no es una deuda de este plugin frente al otro: es un hueco compartido,
y el primero de los cinco que hay que resolver desde cero. La forma es obvia
—que el esquema lleve el paseo, un objeto por ítem con su resultado, y que un
`PASS` sin los ocho se descarte igual que se descarta un `rule` inventado— y la
diferencia entre pedirlo en prosa y validarlo es exactamente lo que separa este
hallazgo de un aviso.

Dos cosas sí trae `agentic-skills` que valen aquí:

- **`evidence` es un campo obligatorio del hallazgo, distinto de `detail`**
  (`domain/finding.py`). En `ct-judge` la exigencia de citar existe, pero vive en
  prosa ("if you cannot cite it, lower the severity"), y `where` mezcla la cita
  con la ubicación. Un campo obligatorio no se olvida.
- **El insumo que no llega se declara.** La rúbrica ordena reportar un ítem sin
  vara "como sin veredicto por falta de dato, no como conforme y no inventándose
  el criterio", y nombra la causa raíz: verificar con la vara vacía fue lo que
  produjo desviaciones silenciosas de convención
  (`slice_verifier_judge.py:78`). Es la mitad de H5.

### 5.4 H4 — `left_out` es un campo obligatorio, y su destino está escrito en el prompt

El informe del implementador de `agentic-skills` no lleva un `summary` en prosa:
lleva `left_out`, una lista obligatoria de cadenas
(`infrastructure/report_payload.py:22`). Y su recorrido está construido de punta
a punta: `Implementation.left_out` entra en el estado del run como `debt`
(`actions/conduct_slice.py:465`), y el programa lo escribe en el cuerpo de la
pull request bajo `## Deuda aceptada`
(`infrastructure/pull_request_body.py:12,30`), junto con los hallazgos que el juez
dejó pasar sin corregir. Además se cuenta como métrica del slice cerrado
(`domain/closed_slice_record.py`).

Lo que cierra el círculo es que **el implementador sabe dónde acaba lo que
escribe**. Su brief se lo dice: "cada elemento entra en la pull request como
deuda aceptada, así que se escribe como una frase que alguien pueda leer sin el
contexto de esta conversación". Un campo con destino conocido se escribe distinto
que un campo que va a un fichero que nadie promete abrir.

De paso, esto responde a la otra mitad del problema: el cuerpo de la pull request
lo **compone el programa** con secciones fijas —intención, criterios cumplidos,
deuda aceptada, señal a comprobar tras el despliegue, `Closes #N`—, no la prosa
de la sesión. En la corrida las dos advertencias que hacen valiosa esa pull
request existen porque esa sesión decidió escribirlas. Con un cuerpo compuesto,
la deuda declarada aparece siempre.

### 5.5 H5 — la vara existe aunque el repo esté vacío

El ítem 1 de la rúbrica de `agentic-skills` no depende de que el plan encuentre
código parecido: carga **las fuentes de convención que declara el issue padre**
(`- doc: <ruta>` / `- skill: <nombre>` bajo `## Fuentes de convención`, ver
`parent_body.py:_sources`) como vara principal, y una skill de buenas prácticas
como vara secundaria, con las convenciones del repo ganando en conflicto. Un
slice de esqueleto sobre un repo vacío sigue teniendo con qué medirse: las
convenciones existen antes que el código.

En `ct-judge` la vara equivalente es `## 3. Reference patterns` del plan, que
nombra ficheros reales del repo. En un repo sin código dice "N/A" y el ítem se
queda sin sujeto, que es lo que pasó.

Tiene además dos ítems que aquí no existen y que valen la pena como referencia,
no como copia: el **patrón de entrega** (que el patrón elegido sea el que la
convención prescribe para *este tipo* de cambio, no sólo que esté bien
ejecutado) y la **observabilidad** (que la señal declarada por el slice pueda
cumplirse mirando el diff). Los dos son ítems que sólo tienen sentido con
convenciones declaradas por el repo, así que dependen del mismo mecanismo.

### 5.6 Una divergencia deliberada: el `kind` de cada ruta

`agentic-skills` mantiene `PathKind` (`production` / `test`) como campo
obligatorio de cada ruta del informe (`domain/path_kind.py`,
`report_payload.py`), y su ítem 7 lo usa: "cruza la lista de ficheros de la slice
con la etiquetada producción/test".

Esta rama construyó ese campo y **lo quitó** (`f8ec2a9`, documentado en
`5fcb691`), con un argumento que hay que conservar porque es mejor que el campo:
la etiqueta la produce el agente al que se juzga, nadie la verifica, el juez tiene
el diff delante y distingue un test de código de producción sin que se lo digan,
y cuando venía mal **no degradaba el juicio sino que lo desactivaba** — un test
mal etiquetado como producción dejaba de ser mirado justo por el ítem que busca
tests debilitados.

O sea que aquí la divergencia no es una deuda: es una corrección. Y tiene una
consecuencia práctica: **el ítem 7 de `agentic-skills` no se puede portar
verbatim**, porque cruza el diff con una etiqueta que aquí ya no existe a
propósito. La versión de `ct-judge` —que el juez decida por lectura qué es
producción y qué es andamiaje— es la buena.

## 6. Las métricas: lo que se mide hoy, lo que se toca, y por qué tienen que viajar en la pull request

### 6.1 Lo que se escribe hoy, exhaustivo

Una fila por **intento de un paso de una tarea**, en
`~/.claude/control-tower/log/ct-step.jsonl` (o su equivalente bajo
`CLAUDE_CONFIG_DIR`), append-only. La compone `run-metrics.js` y la escribe
`medir()` (`ct-step.mjs:223`), tragándose la excepción a propósito: ninguna
transición depende de la medida.

Doce campos de identidad, iguales en todas las filas:

| Campo | Qué es | Estado |
|---|---|---|
| `repo` | `org/repo` | |
| `epic` | el milestone, o `(sin milestone)` | |
| `issue` | el número del slice, que es la identidad del plan padre | |
| `plan` | la ruta del plan | |
| `plan_sha256` | el hash de su contenido, porque un plan se reescribe | |
| `task` / `task_name` / `tasks_total` | la tarea y su nombre literal del encabezado | |
| `step` | `implement` \| `controls` \| `judge` \| `commit` | `commit` **se retira** (§6.2) |
| `attempt` | la vuelta dentro de esta tarea, como dimensión y no como contador | |
| `session` | la conversación de esa llamada | **retirado** (§6.2) |
| `written_at` | marca de tiempo | |

Y las medidas, que dependen del paso. Esto es todo lo que hay, literalmente:

| Paso | Medidas |
|---|---|
| `implement` | `outcome` (`done`\|`discarded`), `paths` (cuántas rutas), `why` (por qué se descartó), `summary` (la prosa del implementador) |
| `controls` | `outcome` (`done`\|`failed`\|`indeterminate`), `controls_log` (ruta), `commands` (cuántos comandos declaraba la tarea) |
| `judge` | `outcome`, `review_package` (ruta), `ruling`, `findings_total`, `findings_high`, `findings_medium`, `findings_low`, `findings_by_rule` |
| `commit` | `outcome`, `commit` (el sha) — **se retira**, ver §6.2 |

Tres cosas que el §10.1 del diseño de D-4 prometía y no están, todas por el mismo
motivo: con `ct-step` las dos llamadas al modelo son subagentes despachados por la
sesión, no procesos `claude -p`, así que **no hay `total_cost_usd`, ni
`num_turns`, ni duración de la llamada**, y `session` no tiene de dónde salir. Es
el precio declarado de no tomar D-4, y la fila lo lleva como un `null` honesto en
vez de un cero.

### 6.2 Lo que se toca de la medida: dos añadidos y una retirada

**1. La duración de lo que el programa sí ejecuta.** No se puede medir la llamada
al subagente, pero el paso `controls` lo ejecuta el programa entero: su
`duration_ms` es exacto y gratis. Es además el único número de tiempo que no se
puede reconstruir restando `written_at` consecutivos, porque entre dos filas hay
latencia de sesión mezclada con trabajo.

Del paso, y no de cada comando: una duración por comando solo se lee si va con la
identidad del comando al lado, y eso ya es el hueco de "qué control falló", que
está fuera de esta ronda.

**2. Dos campos de identidad que faltan, y uno que hay que decidir.** La corrida
los pide a gritos en cuanto las filas dejen de vivir en una sola máquina:

- **`plugin_version`.** El argumento de `plan_sha256` —"un plan reescrito hace
  incomparables dos runs"— vale igual para el loop: un `ct-step` reescrito hace
  incomparables dos runs, y esta corrida es de 0.36.1. Sale de `package.json`,
  gratis.
- **`actor`.** Hoy irrelevante porque cada fila vive en el disco de quien la
  escribió. En cuanto viajen en el repo, filas de dos máquinas se mezclan en el
  mismo fichero y sin actor no se sabe de quién es el coste. `git config
  user.email` es local y gratis.
- **`session` se quita.** Un campo que siempre es `null` enseña a quien lee el
  fichero a ignorar la columna, y la de al lado se salta detrás. Y su rama en
  `normalizar` era un no-op idéntico al caso genérico: tratamiento especial que
  no hacía nada.

**3. La fila `commit` se retira.** Lleva dos cosas —`outcome: done` y el sha— y
las dos están enteras en `git log`: el sha es el sha, y el hecho de que la tarea
se comiteó es el commit. Una fila que no añade nada a lo que el repositorio ya
guarda es una fila que hay que leer y descartar cada vez.

Y se lleva por delante el único punto feo del §6.3. La fila `commit` era la
excepción a "todo se escribe antes del commit": se escribía *después*, así que
viajaba dentro del commit de la tarea siguiente y la de la última tarea no
viajaba nunca. Sin ella, el fichero del repo contiene en el momento del `git add`
exactamente las filas de esta tarea y de las anteriores, y **no queda ni una fila
fuera de la pull request**. El paso `commit` sigue existiendo en la máquina y
sigue siendo quien stagea el fichero: lo que desaparece es su fila, no el paso.

Consecuencias mecánicas de retirarla, que hay que hacer en el mismo commit: el
dominio de `step` baja a tres valores (`implement`, `controls`, `judge`), la
llamada `medir('commit', ...)` de `verboCommit` se va, y el test de `ct-step` que
afirma la secuencia de filas (`['implement', 'controls', 'judge', 'commit']`)
pasa a afirmar tres. El §10.1 del diseño de D-4 dice cuatro y hay que corregirlo
ahí también.

### 6.3 Que viajen en la pull request, como los veredictos

El §10.5 del diseño de D-4 puso la telemetría **fuera del repo** con un motivo
explícito, copiado de `agentic-skills`: "para que ningún `git add` de la slice se
lleve la telemetría dentro de la pull request".

Esta corrida es la refutación. Las filas de las doce invocaciones de `ct-step`
existen en `~/.claude/control-tower/log/ct-step.jsonl` **de la máquina de quien
despachó el slice**, y en ningún otro sitio. El veredicto del juez viajó y se
puede leer; las métricas del mismo run no. Para un loop que se está evaluando
entre dos personas y dos repositorios, unas métricas que sólo existen en el
portátil del que implementó son unas métricas que no existen.

El motivo original no era malo, era otro: evitar que la telemetría **entre en el
diff por accidente**, arrastrada por un `git add` de la slice. Eso se resuelve
con la misma respuesta que ya se dio al veredicto en `590b995` — que la escriba y
la stagee el programa, en una ruta que el programa decide— y no obliga a
esconderla.

**El diseño, calcado del veredicto:**

- **Ruta:** `docs/superpowers/metrics/issue-<n>.jsonl`, una fila JSON por línea,
  el mismo objeto exacto que ya se escribe en el fichero local. Nada nuevo que
  parsear y ninguna forma nueva que mantener.
- **`medir()` escribe en los dos destinos**, siempre. El local sigue siendo el
  acumulado de la máquina (todos los repos, todos los epics); el del repo es el
  de este slice.
- **El `git add` va en el paso `commit`**, nunca en `medir()`. Y por la misma
  razón que el veredicto, que ya está escrita en el código: si el fichero
  estuviera en el índice cuando corren los controles, `alcanceDeclarado` lo vería
  como una ruta que el plan no declara y vetaría la tarea. Es un artefacto de la
  maquinaria, como el plan y como el veredicto, no alcance del implementador.
- **Las filas de los intentos vetados viajan, y eso es lo que se quiere.** El
  `git reset -q` que `report` hace al empezar cada intento desstagea, no borra
  contenido: las filas del intento que el juez tiró siguen en el fichero y entran
  con el `git add` del commit. El coste de las vueltas es el dato.
- **Y viajan todas, sin excepción**, porque la fila `commit` se retira (§6.2).
  Con los tres pasos que quedan escribiendo antes del commit, el fichero que se
  stagea contiene exactamente las filas de esta tarea y de las anteriores: no
  hay ninguna que se quede fuera de la pull request ni ninguna que llegue
  desplazada al commit siguiente.

**Un efecto lateral que conviene nombrar: esto resuelve H4 de rebote.** La fila
`implement` lleva `summary`, o sea la prosa donde el implementador dice qué
decisión cerrada obedeció a disgusto y qué problema vio y no tocó. Con las filas
en el repo, eso llega a la pull request sin que nadie se acuerde de abrir un
fichero. No sustituye al arreglo de H4 —imprimirlo en su momento sirve para
**actuar**; el jsonl sirve para **auditar**— pero cierra la pérdida.

**Y una regla que hay que arreglar con esto, porque ya está rota.**
`LOOP_ARTIFACT_PATTERNS` (`scripts/scope.js:67`) exime del gate de alcance
`docs/superpowers/plans/**` y `docs/superpowers/specs/**`, y **nada más**.
Comprobado ejecutando `scopeViolations` con un alcance `src/**`:

```
violaciones: [ "docs/superpowers/verdicts/issue-2-task-1.json",
               "docs/superpowers/metrics/issue-2.jsonl" ]
```

O sea que **los veredictos que `590b995` hizo viajar son hoy violaciones de
alcance**: en cualquier epic que declare su línea `Alcance:`, el
`ct-scope-gate` marcará en rojo un fichero que escribió el propio loop. No
estalló en esta corrida por dos casualidades apiladas: el epic de
`rust-monitoring` no declara alcance, y ese repo nunca instaló el gate
(`templates/scope-gate.yml` se instala a mano, en tres pasos que su cabecera
enumera, y `ct-init` no lo vendoriza). Las dos rutas —`verdicts/**` y
`metrics/**`— tienen que entrar en `LOOP_ARTIFACT_PATTERNS` por el mismo motivo
que las otras dos: las escribe el loop, no el agente, así que el gate que juzga
al agente no tiene nada que decir sobre ellas.

## 7. Lo que hace falta construir

Seis pasos, y ninguno con una decisión de diseño pendiente. Los dos primeros
cierran los agujeros por los que pasaron el conflicto y el control imposible; el
tercero y el cuarto recuperan lo que hoy se pierde entre el juez y la pull
request; los dos últimos son la medida.

### Paso 1 — la base sale del remoto (H2, primera mitad) — **HECHO**

`ct-next.mjs`: `git fetch origin <base>` antes de resolver, y `git worktree add
-b <rama> <wt> origin/<base>`. `verifyBaseExistsLocally` pasa a verificar la
referencia remota, con el mensaje de arreglo que ya sabe dar. Un slice no puede
nacer por detrás de su remoto.

Vale por sí solo, no toca ninguna decisión de diseño, y es lo que impide de un
golpe el conflicto, el plan literal contra un árbol obsoleto y la pull request sin
checks.

### Paso 2 — la semántica de los controles se valida (H1) — **HECHO**

`plan-tasks.js` gana la regla `verification-predicate` y `plan-contract.js` la
reenvía junto a `verification-block`, así que sale por la misma violación
(`verification`): para quien arregla el plan las dos son el mismo trabajo, hacer
que la vara mida.

**Lo que la regla mira, y lo que decidió no mirar.** El diseño original decía
"rechazar todo comando cuyo `# expected:` declare un número impreso". Eso se
descartó al implementar: el comentario es prosa libre y `# expected: exit 0, 1
passed` lleva un número dentro, así que ahí empieza a adivinar. Lo que se mira es
el **último tramo de la tubería**, que es lo que decide `$?`, contra una lista
**cerrada** de cuatro entradas cuyo código de salida es demostrablemente
independiente de lo que el plan afirma, cada una con su prueba y su remedio:

| Último tramo | Por qué su exit code no puede afirmarlo |
|---|---|
| `grep -c` (y `-rc`, `--count`) | sale con 0 con una coincidencia y con 1 con ninguna: nunca dice cuántas |
| `wc` | sale con 0 con doce líneas y con doce mil |
| `\| tail`, `\| head` | tira el exit code del comando que importa y deja el de `tail`, que es 0 casi siempre |
| `git status` | sale con 0 con el árbol sucio y con el árbol limpio |

`grep -q` y el `grep` pelado **no** se tocan: ahí el exit code ya es la aserción.
Y ante `&&`, `||` o `;` la regla **no se pronuncia**, porque entonces el exit code
depende de qué llegó a correr: un falso positivo que bloquea un plan correcto en
un gate es peor que el agujero. El parseo respeta comillas y `$(...)` — sin lo
segundo, el propio arreglo (`test "$(… | grep -c …)" -eq 0`) se leería como una
tubería que acaba en `grep -c` y la regla vetaría la corrección en vez del
defecto.

**Medido contra realidad, y esto es lo que hay que retener.** El fixture del plan
real del slice #5 de `repo-pulse` traía un `wc -l AGENTS.md` cuya intención
declarada era "AGENTS.md sigue por debajo de 150 líneas": un control que no puede
fallar nunca. Y el plan de ESTA rama —
`docs/superpowers/plans/2026-08-18-los-dos-agentes-y-la-vara-del-plan.md`, el que
produjo el código que este documento revisa— trae **cinco** controles de la misma
clase, dos de ellos invertidos igual que el de `rust-monitoring`:

```
grep -c 'superpowers:' prompts/task-implementer.md                    # 0
grep -c 'Read, Write, Edit, Grep, Glob, Bash' scripts/ct-step.mjs     # 0
```

Los dos afirman una ausencia, y `grep -c` sale con 1 cuando no encuentra: verdes
exactamente cuando deberían estar rojos. No se corrigen: son el registro de un
plan ya ejecutado, y `checkPlans` solo valida el plan cuyo nombre lleva
`issue-<n>-`, así que no rompen ningún gate. Se dejan escritos aquí porque
convierten H1 de anécdota en patrón: el defecto no vino de una sesión torpe en un
repo ajeno, estaba también en el plan de casa.

La plantilla y `writing-plans-prescriptive/SKILL.md` cambian con la regla, como ya
cambiaron juntas la vez anterior: el `# expected:` pasa a ser el código de salida,
y toda afirmación sobre una cuenta, una línea o una salida se envuelve en `test`.

Es la siguiente regla de la serie que abrió `5b97fdd` en ese mismo fichero, y la
misma clase de arreglo: hacer obligatorio lo que ya se daba por supuesto. Aquella
cerró "la verificación es prosa"; ésta cierra "la verificación es un comando que
mide al revés". Ver §5.1.

### Paso 3 — el paseo por la rúbrica entra en el esquema (H3) — **HECHO**

`step-contracts.js`: el veredicto gana `rubric`, obligatorio — un array de ocho
pasos `{rule, result}`, con el enum del ítem tomado del **mismo array**
`VERDICT_RULES` y no de una copia, porque dos listas de ocho identificadores
divergen al primer renombrado. Se descarta el veredicto al que le falte el campo,
el que nombre un ítem desconocido, el que repita uno, el que no pase por los
ocho, y el que traiga un `result` vacío: ocho identificadores sin resultado son el
mismo artefacto vacío, solo más largo. La comprobación va después del bucle de
`findings` para que los descartes que ya existían conserven su `why`.

`ct-judge.md` documenta el campo y **pierde** el párrafo de siete líneas que pedía
el paseo en prosa: 242 líneas antes, 242 después. Es deliberado — todo lo que se
añade a ese fichero compite por la atención del juez, que tiene ocho ítems que
recorrer de verdad. El porqué largo vive en el comentario de `step-contracts.js`,
que lo leen personas.

**Lo que el orden NO valida, y por qué:** la presencia, la unicidad y la
completitud sí; el orden no. Quemar un viaje de ida y vuelta del juez por el orden
de una lista no compra nada, y el prompt sigue pidiendo el orden de la rúbrica.

**Y lo que la implementación entendió mejor que este spec:** lo grave del caso de
`rust-monitoring` no es que aquel `PASS` vacío estuviera mal. Es que **era
correcto** —cuatro de los ocho ítems no tenían sujeto— y no había forma de saberlo
leyendo el fichero. El recorrido es lo que distingue "no aplicaba, y por esto" de
"no se miró".

Queda fuera partir `where` en cita y ubicación, como hace `Finding` en
`agentic-skills`: no es de este paso.

### Paso 4 — lo que el implementador dejó fuera viaja solo (H4) — **HECHO**

Lo mínimo es una línea: `ct-step report` imprime el `summary`, y `ct-step next`
lo repite en el paso de commit. Lo correcto es lo de `agentic-skills`: que el
esquema del informe lleve una lista de lo dejado fuera en vez de prosa libre, que
el prompt del implementador diga dónde acaba cada elemento, y que `ct-step`
componga con ella el tramo de deuda del cuerpo de la pull request.

### Paso 5 — las métricas viajan en la pull request (§6.3) — **HECHO**

`ct-step.mjs`: `medir()` escribe además en
`docs/superpowers/metrics/issue-<n>.jsonl`, y `commit` la stagea después de los
controles y del juez, exactamente como el veredicto. `scripts/scope.js`:
`LOOP_ARTIFACT_PATTERNS` gana `docs/superpowers/verdicts/**` y
`docs/superpowers/metrics/**` — y esto último **arregla algo que ya está roto
hoy**, con veredictos o sin métricas.

Es la mitad más barata de todo el documento y la que más se nota: sin ella, cada
corrida que hagamos en un repo ajeno vuelve sin datos.

### Paso 6 — dos añadidos a la medida y la retirada de la fila `commit` (§6.2) — **HECHO**

`run-metrics.js` gana `plugin_version` y `actor`, y **`session` se va**. Los dos
nuevos llevan centinela propio —`(sin versión)`, `(sin actor)`— y no `null`, con
un argumento que este spec no traía: por esas dos columnas se **agrupa**, y un
nulo funde en el mismo grupo las filas que no traían el dato con las que lo
traían vacío. El módulo sigue puro: los valores llegan dentro del objeto de
identidad, y `ct-step` los aporta leyendo el manifiesto del plugin y
`git config user.email`.

`session` se retira y no se rellena. Además de valer `null` en todas las filas, su
rama en `normalizar` (`valor ?? null`) era un no-op idéntico al caso genérico: un
campo con tratamiento especial que no hacía nada, fingiendo una semántica que no
tenía. Vuelve el día que una llamada headless devuelva un identificador; añadirlo
cuesta una línea, y prometer una dimensión que el mecanismo no puede dar cuesta la
confianza en el resto de la fila.

`verboControls` emite `duration_ms`. Y `verboCommit` deja de emitir fila: fuera
`medir('commit', ...)`, el dominio de `step` baja a tres valores, y el §10.1 del
diseño de D-4 se corrige donde dice cuatro.

**Y un defecto que apareció al construirlo, en las dos direcciones.** Hacer que la
telemetría viaje abre un camino nuevo por el que podía romperse el principio más
viejo de todo esto ("ninguna transición depende de la medida"): el `git add` del
fichero. Sin `allowFail`, un repo que ignore esa ruta hacía que la excepción
subiera y la tarea se quedara **sin comitear**, con el run atascado. Medido. Y
persiguiéndolo apareció que el `git add` del **veredicto** —código de `590b995`,
anterior a esta ronda— tenía exactamente el mismo defecto: con `docs/` ignorado,
`ct-step verdict` reventaba y dejaba el run en exit 9.

Los dos avisan y siguen, por decisión humana tomada al encontrarlo. Un veredicto
que no puede viajar degrada el criterio de cierre de F37 y hay que verlo —de ahí
el aviso y no el silencio—, pero pararlo no lo arregla: el veredicto sigue
escrito en la carpeta del run, y quien revisa la pull request ve que no está. El
trabajo se comitea; la evidencia de que no viajó se cuenta.

## 8. Lo que esto NO propone

- **No toma D-4 en upstream.** La corrida se midió sobre el fork que ya la tomó,
  y los cinco hallazgos son ciertos con la sesión decidiendo la secuencia y con
  un programa decidiéndola. Ninguno de los cinco pasos de arriba enchufa nada.
- **No porta código de `agentic-skills`.** Lo que se toma son cuatro propiedades
  y una advertencia; los mecanismos son distintos porque las varas son distintas
  (aquí por tarea, allí por repo) y esa diferencia es deliberada en los dos
  sitios.
- **No añade el `kind` de vuelta.** Ver §5.6: quitarlo fue una corrección, y el
  ítem que allí depende de él no se porta.
- **No toca la integración continua, ni el gate que libera.** Ni el paso
  `await-ci` de `agentic-skills`, ni que `--release` pregunte mergeabilidad o
  checks: las dos cosas son un estado posterior al commit, o sea material de D-4
  y más trabajo que todo lo demás junto. Del H2 se construye la mitad de la base
  —que es la que evita el conflicto y con ella los checks corren— y la otra mitad
  queda apuntada como hecho, sin propuesta.
- **No toca `/ct-harvest` ni construye ningún informe.** Las filas del §6 son el
  dato recogido; leerlo, agregarlo y presentarlo es alcance de la ronda de la
  medida. El reloj del gate humano vive en el timeline del issue y es suyo.
- **No juzga la corrida.** El slice está bien entregado, la pull request es más
  honesta que la media, y el humano que la mergeó vio un check verde. Los cinco
  hallazgos son sobre lo que habría pasado con una sesión menos escrupulosa.

## 9. Versión

Este documento no sube versión: no toca código. Los pasos del §7 la subirán
cuando se construyan.
