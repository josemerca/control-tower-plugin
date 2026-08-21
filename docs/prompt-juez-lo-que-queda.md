# Prompt de arranque — el juez: lo que queda

> Escrito el 2026-08-21 al cerrar las dos mitades de H5 sobre
> `d4-conductor-como-programa`. **No reclama número de ronda**: es el handoff de
> un trabajo que salió de una sospecha de campo ("el juez no saca hallazgos en
> ningún run") y no de un spec congelado.
>
> Lo entregado son dos commits: `1422c67` y `e473c97`. La versión del plugin va
> por `0.39.0`.
>
> **El titular: el juez ya puede medir calidad y ya puede decir que no pudo.**
> Antes no podía ninguna de las dos cosas, y las dos fallaban en silencio.
>
> **El titular incómodo: hay un defecto vivo que introduje yo** — §3 admite
> declarar una skill como vara y el juez no tiene la herramienta para abrirla.
> Está en el §3.1 de abajo y es lo primero que hay que arreglar.
>
> Copiar el bloque `text` del final en la sesión nueva.

---

## 0. El problema del que salió todo

Varios runs sobre esta rama devolvían `PASS` sin hallazgos, y dos personas
mirando veredictos a mano no sabían si el juez no encontraba nada o si no tenía
con qué buscar.

Diagnóstico, medido sobre `jjponz/rust-monitoring` run-4 tarea 2 (un slice con
código real: `RwLock<HashMap<String, Registered>>` con double-checked locking):

De los ocho ítems de `agents/ct-judge.md`, **cinco son conformidad con el plan**
(`objetivo`, `asercion-tdd`, `contrato`, `decisiones-cerradas`, `alcance`), **dos
son fraude del implementador** (`manipulacion-tests`, `fixture-theater`) y **uno
era de calidad** (`patrones`) con dos candados literales en el fichero: *"never
your own preferences"* y *"if the plan names no pattern […] produces no
finding"*.

La rúbrica era **estructuralmente incapaz** de producir un hallazgo de calidad.
Aquel `PASS` auditó carácter a carácter que el `format!` casaba con el texto
prescrito, y nadie le pidió mirar si el patrón de concurrencia era el que el repo
prescribe. **El juez hizo su trabajo exactamente como estaba escrito.**

## 1. Lo entregado, para que no se rehaga

### `1422c67` — el juez dice si pudo medir, y el hallazgo trae su cita

- **`outcome` en cada paso del recorrido de la rúbrica.** Enum cerrado de tres en
  `scripts/step-contracts.js#RUBRIC_OUTCOMES`: `conforme`, `no-aplica` (el ítem
  no tiene sujeto — no hay tests previos, no hay símbolos, la tarea es prosa) y
  `sin-vara` (tiene sujeto, pero el insumo con el que medirlo no llegó). Antes,
  dentro de "se miró" colapsaban dos cosas y una era un agujero: `patrones: N/A`
  se leía igual que `patrones: conforme`.
- **`rubric_sin_vara`** en `scripts/run-metrics.js#verdictMeasures`. Es la única
  clase que se cuenta: `conforme` y `no-aplica` son la rúbrica funcionando.
- **`evidence` obligatorio en cada hallazgo**, en las tres severidades. La cita
  literal, distinta de `what` (narra) y de `where` (ubica). La rúbrica ya exigía
  citar antes de bloquear, pero en prosa.
- **`### Desired end state` viaja en el brief**, bajo su PROPIA línea que dice
  que **no es vara**: no amplía el `**Files:**` de la tarea. Darle autoridad
  sería una licencia para ensanchar el alcance, y hay un test que fija la
  separación (`__tests__/task-brief.test.js`, el test de las dos autoridades).

### `e473c97` — §3 deja de ser ficheros a imitar y pasa a ser la vara del repo

- **`## 3. Reference patterns` con dos listas**: `Files to imitate:` y `Rules to
  obey:` (`skills/writing-plans-prescriptive/plan-template.md`).
- **La skill manda buscar la vara escrita** del repo — `AGENTS.md`, `CLAUDE.md`,
  `CONTRIBUTING`, `docs/conventions/`, `.claude/skills` — y citarla por ruta.
- **Regla `reference-paths`** en `scripts/plan-contract.js`: toda ruta que §3
  nombre tiene que poder leerse. Es la regla de literalidad aplicada a la otra
  clase de cita. **Acotada a §3** a propósito: en §4 hay rutas que la slice va a
  crear.
- **`patrones` sin candados**: abre los documentos de reglas y mide contra ellos.
  El candado se mantiene donde servía — lo que no se puede pinchar a una frase de
  un documento que el plan nombra no es hallazgo.
- **`prompts/task-implementer.md`**: la misma vara del lado del que escribe.

### Por qué por el plan y no por un fichero nuevo

Dos restricciones que conviene no volver a descubrir:

1. **`ct-step` no habla con `gh`.** Sólo `git` y `sh`
   (`ct-step.mjs:58,129,633`). No puede leer el cuerpo del issue, así que el
   `## Contexto del epic` llega al agente que escribe el plan y de ahí al juez
   sólo lo que ese agente copie.
2. **`plan-contract.js:201` exige el ORDEN de las nueve secciones.** Una sección
   nueva entre §3 y §4 obliga a renumerar §4–§9 en la plantilla, en
   `PLAN_SECTIONS` y en cada plan ya escrito que se revalide.

Y una tercera cosa que hace el problema más pequeño de lo que parece: **al juez no
hay que darle el contenido de las convenciones, sólo el puntero.** Ya tiene
`Read`, `Grep` y `Glob`.

El diseño completo está en
`docs/superpowers/specs/2026-08-21-la-vara-del-repo-en-el-plan-design.md`.

---

## 2. Cómo verificar que esto funciona (aún no se sabe)

**Nada de lo entregado se ha visto en campo.** La verificación es una corrida
sobre un repo que **sí tenga convenciones escritas** — este repo no las tiene, y
`rust-monitoring` tampoco tenía gran cosa. Dos números lo dicen todo:

- **`rubric_sin_vara`** en `docs/superpowers/metrics/issue-<n>.jsonl`. Si sale
  alto en un repo que sí tiene convenciones, la vara no está llegando.
- **hallazgos con `rule: patrones`** en los veredictos de
  `docs/superpowers/verdicts/`. Si sale cero en un slice con código real y
  convenciones declaradas, el ítem sigue sin morder y hay que averiguar por qué.

Y un tercero, de riesgo (ver §3.2): **`discards`**, que `ct-step` imprime al
cerrar cada paso.

---

## 3. Lo que queda pendiente

Ordenado por lo que yo abordaría primero. El §3.1 es un defecto, no una mejora.

### 3.1 DEFECTO VIVO — §3 admite una skill como vara y el juez no puede abrirla

**Lo introduje en `e473c97` y hay que arreglarlo antes de cualquier otra cosa.**

`plan-template.md` dice que `Rules to obey:` admite *"any skill the issue's
'Contexto del epic' names (a skill is not a path and is not checked on disk)"*, y
`agents/ct-judge.md` ítem 5 dice *"and any skill named there — open them and read
the rules"*.

Pero el frontmatter del juez es `tools: Read, Grep, Glob, Write`. **No tiene
`Skill`.** Un nombre de skill como `backend-engineering:backend-best-practices`
no lo puede resolver: no es una ruta que `Read` pueda abrir.

Dos arreglos posibles, y hay que elegir:

- **Darle `Skill` al juez.** Es lo que hace `agentic-skills`
  (`slice_verifier_judge.py`: `TOOLS = ("Read", "Grep", "Glob", "Skill")`), y
  además desbloquea el ítem `test-desiderata` del §3.5. **Ojo**: `JUDGE_TOOLS` en
  `scripts/step-contracts.js` es una **copia** de esa línea del frontmatter, y
  las ata `__tests__/step-contracts.test.js` ("la constante no puede divergir del
  agente que se despacha"). Hay que cambiar las dos.
- **Quitar las skills de §3.** Más simple, y coherente con que `reference-paths`
  sólo comprueba ficheros. El coste: la vara secundaria (una skill de buenas
  prácticas) deja de poder declararse.

Mi recomendación es la primera, porque la segunda cierra la puerta a los dos
ítems que faltan del §3.5 y del §3.9.

### 3.2 RIESGO INTRODUCIDO — dos motivos nuevos de descarte, nunca vistos en campo

`readVerdict` ahora descarta el veredicto al que le falte `outcome` (o lo traiga
inventado) y al hallazgo que no traiga `evidence`. Son dos formas nuevas de que
un juez correcto pierda el viaje.

La mecánica exacta, verificada:

- Un descarte **no gasta reintento de juez**: `run-machine.js:163` hace
  `abierto(run, { step: STEPS.JUDGE, discards: run.discards + 1 })` y vuelve a
  preguntar. El razonamiento es correcto (no se tocó el código).
- Está acotado por `MAX_DISCARDS = 6` (`ct-step.mjs:85`), y al sexto el run
  **muere** con `EXIT.NO_VERDICT` (`ct-step.mjs:747-749`).

O sea: un juez que sistemáticamente se olvide de un campo quema seis llamadas y
mata el run. Y el informe de campo anterior dice explícitamente que *"lo que la
corrida no probó"* incluye *"los descartes por esquema"*.

Lo que ya lo protege: `__tests__/step-contracts.test.js` ata el bloque `json` de
ejemplo de `ct-judge.md` al validador (`esquemaDelAgente()`, con tests que exigen
que `"outcome"` y `"evidence"` aparezcan ahí). O sea que al juez **se le enseñan**
los campos. Lo que nadie prueba es que los rellene.

**Qué hacer**: mirar `discards` en las primeras corridas reales. Si sube, el
arreglo **no** es relajar el esquema — es hacer los campos más difíciles de
olvidar.

### 3.3 Las convenciones se re-declaran en el plan de cada slice

El plan es por slice, así que §3 se escribe de nuevo en cada uno. En un epic de
veinte slices son las mismas cuatro rutas escritas veinte veces, y **nada
garantiza que el slice 14 cite las mismas que el slice 3**. Es trabajo re-derivado
y es una inconsistencia posible en la vara misma.

El arreglo considerado y aplazado: **un fichero por repo que `ct-step` lea
directo**, sin agente en medio. Las convenciones son una propiedad del repo, no
del epic.

Decisiones abiertas, ninguna tomada:

- **Qué ruta.** Una sección en `AGENTS.md` (que `ct-init` ya escribe) o un
  `.agent/conventions.md` (bajo el directorio que el loop ya ocupa).
- **Quién lo siembra.** `scripts/ct-init.sh` ya escribe `.agent/STATE.md` y el
  bloque de contrato en `AGENTS.md`; es el sitio natural.
- **Quién lo confirma.** La promesa del producto son **tres puertas humanas por
  epic**, así que no cabe una cuarta. `/ct-init` lo corre una persona: ése podría
  ser el momento.
- **Cómo se compone con §3.** El fichero declara las del repo y §3 cita las que
  aplican a este slice, o el fichero gana y §3 se queda sólo con los exemplars.

**Trampa a evitar**: `scripts/conventions.js` (785 líneas) **no** va de esto. Va
de colisiones de protocolo entre el loop y el repo destino (claim, worktrees,
estado). No lo reutilices por el nombre.

Alternativa barata mientras tanto: un aviso de divergencia estilo `--reconcile`
que compare §3 entre los planes de un mismo epic. No está diseñado.

### 3.4 `rubric_sin_vara` no lo lee nadie

`verdictMeasures` lo emite y `ct-step commit` lo stagea, así que el número viaja
en la pull request. Pero **`scripts/ct-harvest.mjs` tiene cero referencias a
`superpowers/metrics`** (verificado), y `ct-status` tampoco.

O sea: la columna existe en disco y nada la agrega. El diseño de la ronda
anterior lo aplazó a propósito — *"leerlo, agregarlo y presentarlo es alcance de
la ronda de la medida"* — así que esto no es deuda nueva, pero **sin esto el §2
se hace a ojo**, abriendo ficheros `jsonl` a mano.

Lo mínimo útil: que `/ct-harvest` lea el `jsonl` del epic y saque, por slice,
cuántos ítems volvieron `sin-vara` y cuántos hallazgos hubo por regla.

### 3.5 `test-desiderata` no existe como ítem, y hoy es imposible

`agentic-skills` tiene un ítem 8 que corre la skill `test-desiderata` sobre **los
tests nuevos** de la slice, bloqueando sólo ante violaciones graves (no
determinista, no aislado, test que no verifica comportamiento real) y avisando sin
bloquear en las menores.

Aquí no existe, y **no se puede añadir hasta resolver el §3.1**: hace falta
`Skill` en las herramientas del juez.

Nota importante de su rúbrica, que evita un error de diseño: ese ítem **no cubre
los tests preexistentes degradados** — eso es del ítem `manipulacion-tests` y ya
está contado. Un assert relajado en un test que ya existía es *un* defecto, no
dos.

### 3.6 `boundaries` no existe como ítem — y la decisión sigue abierta

`agentic-skills` tiene un ítem 3: núcleo sin infraestructura, inyección de
dependencias correcta, objetos de frontera (Pydantic) en las boundaries.

Aquí la decisión que **quedó sin tomar** es si `boundaries` (y el `test-desiderata`
del §3.5) entran como **ítems propios** o se **absorben dentro de `patrones`**:

- **Ítem propio**: se recorre siempre, sale nombrado en el paseo, y la telemetría
  lo cuenta por regla. Pero `ct-judge.md` crece, y el argumento de este repo es
  que *"todo lo que se añade a ese fichero compite por la atención del juez"* (§7
  paso 3 del diseño anterior).
- **Absorbido**: rúbrica corta, pero si las convenciones del repo no dicen nada de
  boundaries, nadie los mira nunca.

Mecánica de añadir un ítem, para que no sorprenda: se toca `VERDICT_RULES` en
`scripts/step-contracts.js`, y el test `reglasDelAgente()` ata ese array a los
encabezados `### N. \`regla\`` de `ct-judge.md` — hay que cambiar los dos. El
`minItems`/`maxItems` del esquema sale de `VERDICT_RULES.length`, así que ése se
ajusta solo.

### 3.7 Nadie juzga el slice entero, y `## 8. Global verification` no se ejecuta

`ct-judge` juzga **una tarea**. `agentic-skills` juzga la slice completa de una
vez.

Consecuencia: la coherencia entre tareas no tiene juez. La tarea 3 deshaciendo lo
que estableció la tarea 1, o las tres tareas juntas no entregando el
`### Desired end state`, no lo mira nadie. Que el fin del slice viaje ahora en el
brief (`1422c67`) ayuda a la **lectura** de cada tarea, pero el juicio sigue
siendo por tarea.

Y hay un agujero concreto al lado: **`ct-step` nunca ejecuta `## 8. Global
verification`** — cero referencias en `ct-step.mjs` y en `plan-tasks.js`. El plan
declara la validación de punta a punta para cuando todas las tareas estén
comiteadas, y ningún programa la corre. `ct-step controls` corre el bloque
`**Verification:**` **de cada tarea**, y nada más.

### 3.8 Una decisión cerrada mal razonada no tiene ningún control detrás

`decisiones-cerradas` manda obedecer las filas, no auditarlas: *"reopening one is
the failure this item names"*. Es correcto por diseño — un humano las cerró en un
gate — pero deja el hueco que el informe de campo anterior ya nombró: *"una
decisión cerrada mal razonada no tiene ningún control detrás salvo el humano de la
pull request"*.

El caso real fue la incoherencia del `--locked` en `rust-monitoring`: una
contradicción **del plan**, que el juez obedeció correctamente.

### 3.9 `observabilidad` necesita un prerrequisito que no existe

`agentic-skills` tiene un ítem 9 que comprueba que la señal declarada por la slice
**pueda cumplirse** mirando el diff: que lo que la señal promete lo emita código
de producción, que esté instrumentado con la librería del repo, que los labels no
metan alta cardinalidad.

Aquí **no se puede portar todavía**: Control Tower **no tiene el concepto de
señal**. La tabla de slices se localiza por sus columnas `Slice` + `Dep`
(`scripts/slices.js:326`) y no hay ninguna columna de señal; `agentic-skills` la
declara por slice en su spec (`SENAL`, con exención razonada admitida).

O sea que esto no es un ítem de rúbrica: es un cambio en el contrato de la tabla
de slices, y por tanto en `/ct-groom`, en el cuerpo del issue y en la plantilla
del spec. Bastante más trabajo que el ítem.

### 3.10 `rollout` — el patrón de entrega

El ítem 2 de `agentic-skills`, y el que su propia rúbrica describe como *"el check
que un verificador que solo mira la implementación deja pasar"*: no basta con que
el patrón elegido esté bien ejecutado y sea coherente consigo mismo — hay que
comprobar que **es el patrón que la convención del repo prescribe para este tipo
de cambio**.

Su disparador general: si el cambio toca la firma, el constructor o el contrato
público de una acción, la convención suele exigir expand-contract o duplicar la
acción; si sólo cambia lógica interna, basta gatear en el método.

**Esto sí es posible ahora**, y antes no lo era: depende de que haya convenciones
declaradas, que es justo lo que `e473c97` habilita. Puede empezar absorbido en
`patrones` (§3.6).

### 3.11 El gate `plan` es ahora load-bearing para la calidad del código

Esto no es una tarea, es una consecuencia que hay que tener presente.

H1 del informe anterior lo midió: **246 líneas aprobadas en 125 segundos**, y su
conclusión fue que *"un gate cuyo material no se puede leer en el tiempo que se le
dedica no es un control, es una firma"*.

`e473c97` hace que §3 sea la vara de calidad del código, y §3 se aprueba en ese
gate. O sea que **acabamos de apoyar la calidad del código en una firma**.

Lo que lo mitiga a medias: `reference-paths` demuestra que las rutas existen. Lo
que nadie demuestra es que sean los documentos **correctos** ni que estén
**completos** — ver §3.12.

### 3.12 Sin barrido de candidatos: se caza la invención, no la omisión

`reference-paths` prueba que lo que §3 citó existe. **No prueba que §3 citara todo
lo relevante.** Un agente que ignore un `docs/conventions/` que sí está en el repo
pasa el validador limpio.

`agentic-skills` lo cubre con `skills/slice-runner/scripts/discover_conventions.py`:
barrido determinista y offline que **propone candidatos** (`CLAUDE.md`,
`AGENTS.md`, `CONTRIBUTING`, directorios que casen `convention|rules`, skills de
proyecto bajo `.claude/skills`) para que el agente filtre y el humano confirme. Su
comentario de cabecera nombra la causa raíz que corrige: *"evitar que el agente
invente rutas o asuma una ubicación fija"*.

Aquí se aplazó a propósito. Es la asimetría que queda: sabemos que no se lo
inventó, no sabemos si se lo dejó.

### 3.13 `where` sigue siendo una cadena

El hallazgo lleva `what`, `where` (`"path:line"`) y `evidence`. El `Finding` de
`agentic-skills` tiene `path` y `line` **separados**.

Menor, y ya aplazado explícitamente en el §5.3 del diseño anterior. Lo que impide:
que la telemetría agregue hallazgos por fichero.

---

## 4. Decisiones cerradas — NO reabrir sin leer el porqué

- **No vuelve el `kind` (`production`/`test`) por ruta.** Se construyó y se quitó
  (`f8ec2a9`, documentado en `5fcb691`). La etiqueta la producía el agente al que
  se juzga, nadie la verificaba, y cuando venía mal **no degradaba el juicio: lo
  desactivaba** — un test mal etiquetado como producción dejaba de ser mirado por
  el ítem que busca tests debilitados. Consecuencia: **el ítem 7 de
  `agentic-skills` no se puede portar verbatim**, porque cruza el diff con una
  etiqueta que aquí ya no existe a propósito. La versión de `ct-judge` (que el
  juez decida por lectura qué es producción) es la buena.
- **No se exige un mínimo de documentos de reglas en §3.** El caso que lo decidió
  es este repo: no tiene `AGENTS.md`, ni `CLAUDE.md`, ni `docs/conventions/`. Un
  validador que exija una vara que el repo no tiene es el guard imposible de F14
  — el que sólo se satisface inventándose el documento. La propiedad que F14 dejó
  escrita es que *desde cualquier estado que el detector señale existe un camino
  que lo deja verde sin empeorar el repo*. La ausencia no se prohíbe: se mide con
  `sin-vara`.
- **El juez no juzga la precedencia test-implementación.** Una tarea es un commit
  y no está escrito cuando el juez mira, así que no es observable. Lo garantiza
  en origen el implementador con la skill de TDD.
- **El juez no juzga la higiene del diff ni el mensaje de commit.** Los compone y
  los valida el programa.
- **El juez no re-ejecuta ni re-deriva los controles.** No tiene shell, y se lo
  quita la declaración del agente, no una promesa en el prompt.
- **`### Desired end state` no es vara.** Viaja para situar la tarea, y tiene su
  propia línea diciendo que no amplía el `**Files:**`. Darle autoridad debilita
  `alcance`. Hay un test que lo fija.

## 5. Un test que falla y no es de esto

`__tests__/ct-init.test.js > SLICES_PRISTINE_HASHES no registra hashes de bloques
que no existieron nunca`. Falla en árbol limpio desde antes de este trabajo
(verificado con `git stash` sobre `63261d8`). El hash `4d6eebf4…` está registrado
en `SLICES_PRISTINE_HASHES` sin corresponder a ningún bloque histórico ni al del
árbol. Decisión humana explícita de dejarlo estar; merece su propio diagnóstico.

El resto de la suite: **2157 de 2158 en verde**.

---

## 6. Bloque para pegar en la sesión nueva

```text
Trabajo sobre control-tower-plugin, rama d4-conductor-como-programa
(worktree en /Users/acapdev/repos/control-tower-plugin).

Contexto: acabo de cerrar las dos mitades de H5 del juez, en los commits
1422c67 y e473c97 (plugin 0.39.0). Lee estos tres ficheros antes de proponer
nada:

  1. docs/prompt-juez-lo-que-queda.md   <- el handoff, empieza por aquí
  2. docs/superpowers/specs/2026-08-21-la-vara-del-repo-en-el-plan-design.md
  3. docs/superpowers/specs/2026-08-20-la-primera-corrida-en-un-repo-ajeno-design.md

Resumen de dónde estamos: el juez (agents/ct-judge.md) recorre ocho ítems y
hasta ahora era estructuralmente incapaz de producir un hallazgo de calidad,
porque su único ítem de calidad (`patrones`) tenía prohibido aportar criterio y
dependía de que el plan encontrara código parecido. Ahora `## 3. Reference
patterns` del plan es la vara del repo (dos listas: ficheros a imitar y
documentos de reglas), plan-contract comprueba que esas rutas existan
(regla `reference-paths`), y cada paso del recorrido declara si pudo medir
(`outcome`: conforme / no-aplica / sin-vara) con `rubric_sin_vara` en la
telemetría.

Lo primero que hay que hacer es el §3.1 del handoff: un defecto que dejé vivo.
§3 admite declarar una skill como vara y el juez no tiene la herramienta `Skill`
para abrirla. Hay que decidir entre darle `Skill` (recomendado, y desbloquea
test-desiderata) o quitar las skills de §3.

Lo segundo, por valor: §3.3 (las convenciones se re-declaran en cada plan) y
§3.4 (nadie lee rubric_sin_vara). El §3.2 es un riesgo a vigilar en campo, no
una tarea.

Convenciones de trabajo de este repo: no tiene AGENTS.md ni docs/conventions/
(lo cual es, en sí, el agujero del §3.11). La vara es el estilo del código:
comentario de cabecera largo en castellano explicando el POR QUÉ y la medición
de campo que lo motivó, tests en __tests__/*.test.js con vitest, `npm test`
corre build + suite. Ojo: scripts/conventions.js NO va de convenciones de
código, va de colisiones de protocolo del loop; no lo reutilices por el nombre.

Y un test que ya falla y se deja estar a propósito:
ct-init.test.js > SLICES_PRISTINE_HASHES. No lo arregles.
```
