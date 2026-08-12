# Prompt de arranque — F32, el fork y la congelación

> Escrito al cerrar la sesión del 2026-08-07 que ejecutó el encargo de F31
> («re-revisarlo todo y romperlo donde se pueda»). La auditoría se hizo entera:
> **no tumbó el modelo, lo afinó** — y de paso cerró lo que llevaba tres rondas
> abierto: **el formato del spec ya está definido al 100%** y «el plan» tiene
> sitio (dos sitios). Esta ronda **no mergeó código**: todo lo producido es
> formato, decisiones y un plan de ejecución.
>
> El encargo de F32 es **construir**: el fork de superpowers dentro del plugin,
> la plantilla del execution spec, la comprobación nueva de groom, y el primer
> despacho real midiendo. Las decisiones ya están tomadas — no re-abrirlas sin
> evidencia nueva.
>
> Artefacto visual de la ronda (el ciclo fichero a fichero, versionado):
> https://claude.ai/code/artifact/ea292784-b537-4f5b-92ff-cd1397f75863
> Hay PDF de la foto intermedia en ~/Desktop/control-tower-f31.pdf.
>
> Copiar el bloque `text` del final en la sesión nueva.

---

## 0. Por qué esta ronda es distinta

Las tres rondas anteriores fueron pensar; esta es construir — pero construir
**lo decidido**, no lo que parezca mejor sobre la marcha. José cerró en persona
las dos decisiones de formato que quedaban (§4.4) y la decisión del fork (§5).
La tentación simétrica a la de F31 (que era «tirarse a implementar») es ahora
**re-litigar el diseño mientras se construye**. No. Si algo del diseño se
demuestra imposible al construirlo, se para y se pregunta.

Sigue vigente el doble objetivo: herramienta que José usa de verdad +
comprensión transferible del ciclo agéntico para sus equipos. Y sigue vigente:
si no sale paper, no pasa nada.

**Dato de diseño que lo condiciona todo, dicho por José en esta ronda:**
*«yo no me suelo leer los specs, doy por hecho que lo hablado durante el
brainstorming es ok y va al spec»*. Todo lo de §4.2 (congelación, procedencia)
existe por esa frase. Diseñar siempre para el humano que existe.

---

## 1. Estado exacto al empezar — compruébalo, no te lo creas

```
main                    53470e8   Merge PR #17  (sin cambios desde F31)
plugin                  0.29.0
contrato de slices      v16
suite                   60 ficheros / 1704 tests — NO re-ejecutada en F31: verificar
menoplus                contrato v14 en AGENTS.md:157 → migración a v16 PENDIENTE
```

```bash
cd /Users/jpereag/Documents/control-tower-plugin
git log --oneline -3 && git status --porcelain
grep -m1 'SLICES_CONTRACT_VERSION=' scripts/ct-init.sh
npm test 2>&1 | tail -5
ls -lt ~/.claude*/projects/-Users-jpereag-Documents-control-tower-plugin/*.jsonl | head -3
```

Rutas que F31 corrigió:
- menoplus está en **`/Users/jpereag/Documents/menoplus-app/menoplus`**
  (el path del handoff F31 apuntaba a un directorio vacío).
- superpowers local cacheado es **6.0.3** (F31 citaba 6.2.0):
  `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/`

---

## 2. Correcciones al handoff F31 — miscitas encontradas por la auditoría

Si citas F31, pasa antes por aquí:

1. **Hecho 5, refutado en su forma general.** «Ningún issue de menoplus lleva
   `<!-- ct-order:N -->`» es falso: **#451 y #478 sí lo llevan** (tanda vieja).
   Ninguno de M1.5 lo lleva → groom sí duplicaría el backlog actual. Acotada,
   la conclusión operativa sobrevive.
2. **§6, «lock-based protection» es una miscita invertida.** El paper de state
   management (STORM, 2605.20563, leído entero en F31) defiende concurrencia
   **optimista** (Kung & Robinson), no locks. Y su resultado central es que
   **git-worktree es la peor estrategia medida para trabajo acoplado
   concurrente** (63,8 vs 82,5 de STORM; hasta 18 puntos bajo el agente único).
   CT no compite en ese régimen: los tokens y carriles serializantes existen
   para NO paralelizar lo acoplado, y el worktree aísla la *revisión humana*,
   no la concurrencia. Es una elección de régimen y hay que escribirla así.
   Lo que STORM sí regala: *«scaling is limited more by decomposition quality
   than by STORM itself»* — el cuello de botella medido es la tabla. Y su
   ablación de intent annotations: +19,6 puntos.
3. **gemba, degradado a ejemplo por José** («era solo contexto orientativo»).
   Y con discrepancias verificadas contra su código: el eng-handoff es un
   empaquetador determinista SIN LLM y sin estructura estable (secciones por
   recencia); `user-story` no es render puro (lleva RAG); `decidir` señala done
   por `kind:"nucleo"`, no por artefacto. Si algún día se consume, consumir el
   núcleo tipado, nunca el bundle.
4. **«Fase 3 PR conformance gate»** prometido en `commands/ct-next.md:58` como
   backstop del `--release` **no existe en el repo**. Deuda documentada
   apuntando a código que no está.
5. **Telemetría: cero persistente, confirmado por barrido de escrituras.**
   Los únicos destinos de escritura del plugin: `info/exclude`, la semilla de
   `SLICE.md`, el launcher en `$TMPDIR`. `docs/medicion-slices.md` es manual,
   2 filas, la columna clave en «no medido». El timeline de GitHub, en cambio,
   ya registra cada transición de label con timestamp — **la mitad del
   instrumento existe sin cosechar**.

---

## 3. Lo leído en F31 — censo actualizado

**Enteros esta ronda:** Macedo, *From Prompt to Process* (2606.04967, 17 pp.;
autor único, COI declarado con Reversa, scoring de un evaluador — taxonomía de
6 dimensiones, censo de 6 frameworks, agenda de investigación cuya tabla 7
publica como ABIERTA la pregunta que nuestra medida responde) y Liu et al.,
*Multi-agent Collaboration with State Management* (STORM, 2605.20563, 19 pp.).
Con esto, los dos papers que F31 citaba desde resúmenes automáticos quedan
leídos.

**Fuentes primarias nuevas:** plantillas reales de Spec Kit (spec/plan/tasks),
docs de Kiro (EARS, puertas de aprobación entre fases), README de OpenSpec
(specs vivos vs changes archivables — valida AGENTS.md-vivo vs
execution-spec-congelada), y el repo de **Spec Kitty** (README +
docs/status-model.md): flujo `spec → plan → tasks → next → review → accept →
merge`, event log append-only con 9 lanes (incluye `claimed` y `blocked`),
worktrees, `retrospective.yaml`. 1.490★, activo, **641 issues abiertos**,
creado 2025-10. **Es el vecino publicado más próximo a CT.** Decisión tomada:
no migrar — su estado lo emite el propio agente (`agent status emit --to done`
posible), sin multi-máquina real, sin cap/tokens, sin wrapper de cuenta.
Cantera sí: su `retrospective.yaml` ≈ nuestro desenlace del slice (A2); su
lane `blocked` valida A3.

**Skills locales leídos enteros:** writing-plans, subagent-driven-development,
brainstorming, dispatching-parallel-agents (6.0.3).

**Pendiente, prioridad baja:** Farrag pp. 22–30 (amenazas y agenda), Piskala
(2602.00180), Sengupta (2605.25665), ISO 29148 (de pago). Los estudios de la
tabla de Farrag (METR, Faros, DORA, Peng) siguen conocidos solo de segunda
mano.

---

## 4. Lo CERRADO en F31 — no re-abrir sin evidencia

### 4.1 D1: el formato del execution spec

Un fichero por epic: `docs/superpowers/specs/YYYY-MM-DD-<tema>-execution.md`,
trackeado, `DRAFT → CONGELADA`, archivado al cerrar el epic. Corrección al
modelo de F31 §4.1: el spec **no** es «exactamente el join, ni más ni menos» —
es **el registro del join Y de sus entradas comprimidas**; el criterio de qué
entra es «lo que el ejecutor necesita y no puede derivar» (la compresión de
contexto de Farrag).

```markdown
# <Epic> — Execution spec (CONGELADA)
Handoff origen · Fecha de congelación · Estado: DRAFT | CONGELADA

## Hipótesis del experimento          [OBLIGATORIA — decisión de José 2026-08-07:
                                       sin apuesta falsable no es un epic y no entra
                                       por groom. Mantenimiento/bugfixes → issues
                                       sueltos (el dispatcher los soporta:
                                       gh-issue-map.js order ?? i.number)]
## Decisiones congeladas (D-1, D-2…)  [cada una con PROCEDENCIA:
                                       hablada | deducida | propuesta.
                                       Una «propuesta» NO se congela: se pregunta
                                       o baja a Decisiones aparcadas]
## Enfoque técnico                    [el plan del EPIC (D2) — de aquí salen
                                       Área/Toca/Dep. Es el plan.md/design.md de
                                       la industria, dentro del spec]
## Contexto del epic                  [lo que VIAJA al agente — los invariantes
                                       van DENTRO (fusión confirmada: es el único
                                       tubo; groom solo copia esta sección)]
## Tabla de slices                    [contrato v16 INTACTO]
## Decisiones aparcadas (BLOCKED)     [huecos no hablados + destino futuro de A3]
## Registro de cierre (evidencia)     [cierre de gates — A5, hoy lector humano]
```

**Las 4 reglas de celda (van en PLANTILLA, no en contrato — decisión José):**
1. **Clarificado = convergencia** (ClarifyGPT): una fila está lista cuando dos
   lecturas independientes convergen en el mismo desenlace. `[NEEDS
   CLARIFICATION]` admitido en DRAFT; congelar con uno pendiente es inválido.
2. **Acepta = postcondiciones** (POSTCONDBENCH: 78% de la incompletitud es
   resultado infra-especificado): cada criterio afirma el estado observable
   resultante, no la acción. EARS desambigua; el test 1:1 denota.
3. **Gate = residuo de los AC** (POSTCONDBENCH ap. H: ~29% inespecificable):
   lo observable sin test 1:1 va al Gate. El default por Tipo baja a heurística.
4. **Dep declara interfaz** (STORM: solape↔reviews rechazadas r=0,78;
   POSTCONDBENCH: 2,6× peor con deps): la Entrega de una fila con Dep nombra
   qué consume del anterior. **La más importante de las cuatro.**

**Groom gana UNA comprobación** (la única línea de código nueva de todo el
diseño): exit 2 si el spec tiene `[NEEDS CLARIFICATION` pendientes **o** si
`## Hipótesis` falta o está vacía. Dos greps en la pasada que groom ya hace.
La *calidad* de la hipótesis la juzga José en la congelación; groom solo mira
presencia.

### 4.2 La puerta de congelación y la procedencia (resuelve la D5 de F31)

José no lee los specs → el que escribe el spec (la sesión coordinadora) podría
**cerrar decisiones con firma ajena** — invariante 2 roto en silencio («lavado
de decisiones»). Respuesta en dos piezas:

- **Procedencia por decisión**: `hablada` (con la frase si se puede) /
  `deducida` / `propuesta`. Regla dura: una `propuesta` no se congela.
  Los huecos no se rellenan: se preguntan o se aparcan.
- **La puerta de congelación**: José lee **quince líneas** — hipótesis +
  D-1…D-n a una línea con procedencia + anti-scope — y su OK muta
  `DRAFT → CONGELADA`. Es su ÚNICA lectura del ciclo, por diseño. Sin OK no
  hay groom. Con esto el ciclo tiene **tres puertas humanas**: congelación
  (nueva), ready, merge.

### 4.3 D2: «el plan» son dos planes

- **Plan del epic** = `## Enfoque técnico`. PREVIO a la tabla; entrada del
  join. Industria unánime (Spec Kit plan.md, Kiro design.md, Spec Kitty).
- **Plan del slice**: POSTERIOR a la tabla; lo escribe **el agente despachado
  al arrancar**, contra el código real, **con writing-plans usando el issue
  como spec** (el issue trae AC EARS + Protegido + Contexto del epic: es
  exactamente la entrada que writing-plans pide). Se guarda en
  `docs/superpowers/plans/` y viaja commiteado en el PR — la convención de
  los 178 planes de menoplus continúa, uno por slice, escrito en el momento
  correcto. Con el plan escrito, **SDD reengancha entero** (su rombo «Have
  implementation plan?» encuentra el plan): subagente por task + spec-review +
  code-review + TDD.

**El modelo de dos niveles, que lo ordena todo:** CT ES el patrón de SDD un
nivel por encima (tabla=plan file, ct-next=coordinador, sesión
despachada=implementador, review humano del PR=two-stage review). Nivel epic:
CT. Nivel slice: superpowers entero. Evidencia de campo de que la composición
es natural: el transcript de `menoplus--worktrees-451` (28-jul) muestra a un
subagente de un slice despachado por CT corriendo `test-driven-development` —
pasó solo, sin que nadie lo diseñara.

### 4.4 Las dos decisiones que José cerró en persona (2026-08-07)

1. **Hipótesis: obligatoria siempre.** Consecuencias asumidas: la guardia
   contra hipótesis de relleno es José en la congelación; A4 pierde la
   comparación con/sin hipótesis; el trabajo sin apuesta va fuera del ciclo
   de epics.
2. **Reglas de celda: plantilla + `[NEEDS CLARIFICATION]` con dientes en
   groom** (la comprobación de §4.1). El resto de validación es humana
   (congelación, review). Escalera: si el despacho 1+ muestra violación
   sistemática de una regla, esa asciende — probablemente la 4, única
   mecanizable de verdad.

---

## 5. La decisión del FORK — tomada, con datos

**Decisión: los skills de superpowers se forkan DENTRO de control-tower-loop y
superpowers se desinstala.** José la empujó dos veces contra mis reservas; al
descomponer mi «sí pero luego», no aguantaba: de las 3 costuras a reescribir,
2 no aprenden nada del despacho 1, y **el despacho 1 debe medir el sistema
definitivo, no un andamio** de guardas de prosa que íbamos a tirar.

**Barrido de uso real** (2.704 transcripts, 3 configs, invocaciones del tool
Skill — no menciones): TDD 308 (125 en 14 días) · SDD 112/20 proyectos ·
writing-plans 97 · brainstorming 82 · systematic-debugging 45 ·
finishing-a-development-branch 40 · verification-before-completion 35 ·
receiving-code-review 32 · using-git-worktrees 22 · executing-plans 11 ·
writing-skills 1 · **dispatching-parallel-agents 0 y requesting-code-review 0**.

**Alcance del fork:** los 11 usados (incluir writing-skills: mantiene el fork).
Descartar `dispatching-parallel-agents` (su hueco lo ocupa CT entre slices con
aislamiento real, y dentro del slice el diseño es secuencial a propósito — es
además el patrón post-hoc que STORM midió como frágil) y `frontend-design`
(2 usos; existe standalone).

**Las 3 costuras a reescribir:**
1. `brainstorming`: su estado terminal («invoke writing-plans, do NOT invoke
   any other skill») pasa a → **escribe el execution spec con la plantilla y
   pide la congelación**. Su «User Review Gate» queda superseded por la
   congelación. Su design doc commiteado
   (`docs/superpowers/specs/YYYY-MM-DD-<tema>-design.md`) se conserva: **es el
   `Handoff origen:` del spec** y refuerza la procedencia (decisiones
   aprobadas sección a sección). Tras la congelación es historia: nadie lo
   edita.
2. `subagent-driven-development`: la rama «no plan → brainstorm first» pasa a
   → **«escribe el plan ahora con writing-plans, scoped al issue»**.
3. `finishing-a-development-branch`: la rama de merge, en repos gobernados,
   pasa a → **PR + `--release` + PARAR** (el merge es humano).

**Detalles de ejecución:** verificar licencia antes de copiar; anotar versión
origen (6.0.3) en el fork para cherry-picks futuros; namespace
`control-tower-loop:*` (los hábitos de tecleo de José cambian una vez — no
clonar el nombre «superpowers»); el kickoff pasa a citar los skills propios;
desinstalar superpowers al final y smoke-testear el ciclo completo.

---

## 6. Pre-registro de la medida (A4) — CONGELADO antes del despacho 1

Definiciones fijadas AHORA para no contarnos una historia a posteriori (el
fallo del piloto de Spec Kit que Farrag documenta: retrospectivo, sin control).
Unidad de análisis: el slice.

**Variables independientes** (medidas al congelar/groomear, por fila):
nº AC · nº deps · interfaz declarada en Dep (sí/no — compliance regla 4) ·
Protegido presente · nº `[NEEDS CLARIFICATION]` resueltos antes de congelar ·
nº decisiones citadas (D-refs) · mezcla de procedencia · Tipo · Gate ·
huella de tokens (Área+Toca).

**Contexto** (Frattini: cero papers reportan la herramienta): repo, modelo,
cuenta, versión plugin/contrato — y la herramienta misma.

**Dependientes:** del timeline de GitHub HOY (ready→claim, claim→release,
release→merge, reopens, requeues, tamaño de PR, comentarios de review);
de A2/A3 cuando existan (episodios blocked, desviaciones de flujo, tamaño del
plan, **minutos de intervención humana por slice** — un solo campo manual, en
el desenlace, o muere como murió medicion-slices.md); calidad diferida (gate
cerrado con evidencia; retoques post-merge sobre los mismos ficheros en N días).

**Preguntas pre-registradas:**
1. ¿Predicen los atributos de la fila el coste del slice? (RQT con la variable
   independiente que a la literatura le falta)
2. ¿El spec reduce la ambigüedad o la desplaza? (tabla 7 de Macedo / paradoja
   de Farrag — publicada como abierta): clarificaciones resueltas vs reopens.
3. ¿Paga la regla 4? filas Dep-con-interfaz vs Dep-sin, contra reopens/blocked.
4. ¿Dónde se gasta la atención de José? minutos humanos vs duración total
   (invariante 8 en número).
5. **Criterio de muerte** (el de José, medicion-slices.md:5-7, vigente): si el
   loop cuesta más intervención humana de la que ahorra, se dice y se para.

**Reglas de honestidad:** reportar por familia (Tipo), nunca agregado — lección
del FDR 0,08–0,31 de POSTCONDBENCH · predicción de José ANTES de cada epic,
comparada después — lección de METR (+24% percibido vs −19% real) · N pequeña
= generación de hipótesis, no causalidad · **la medida se cosecha, no se
captura** — todo sale de timeline/issue/PR salvo un campo manual.

El script de cosecha (`ct-harvest` o similar) se construye DESPUÉS del
despacho 1, no antes.

---

## 7. Aparcado que sigue aparcado

- **A2 registro del slice**: el plan ya viajará en el PR (writing-plans
  commiteado); queda decidir el desenlace (comentario en el issue es el
  candidato). Desaparcar con la evidencia del despacho 1.
- **A3 arista de vuelta**: `blocked` → label `status:blocked` (existe, inerte)
  + comentario `{reason, unblock}` → «Decisiones aparcadas» del spec.
  El slot existe; nada lo cablea aún.
- **A5 gates con evidencia**: la regla 3 les da al menos derivación honesta
  (gate = residuo de los AC). Cierre con evidencia + hallazgo de /ct-status:
  después.
- **Trazas / α / mutante equivalente**: donde estaba. La crítica de F31 sigue
  en pie: mutar la traza no resuelve el oráculo, lo mueve.
- **Claim sin CAS**: reproducido, documentado, aceptado para un operador.
- **menoplus v14 → v16**: migración de contrato pendiente; hacerla antes del
  primer groom real (`--update-slices-contract`).

---

## 8. Tareas de F32, en orden

1. **Licencia + versión origen** del fork (superpowers 6.0.3).
2. **Fork**: 11 skills → `control-tower-loop:*`, 3 costuras reescritas (§5).
3. **Plantilla** `_TEMPLATE-execution-spec.md` v2 en menoplus: 8 secciones,
   procedencia, las 4 reglas junto a la tabla, instrucción del resumen de
   congelación. (Y de paso: migrar menoplus a contrato v16.)
4. **Groom**: la comprobación exit 2 (dos greps, §4.1) + tests. Único cambio
   de código del plugin. Documentar en `commands/ct-groom.md` sin engordar el
   bloque del contrato — regla vigente: no crecer sin quitar.
5. **Kickoff**: citar skills propios; «primer acto: plan con writing-plans
   usando el issue como spec»; prohibiciones explícitas (no worktree nuevo,
   no merge). Y en la plantilla/AGENTS.md nivel epic: tras el design doc del
   brainstorming → execution spec, no writing-plans.
6. **Desinstalar superpowers + smoke test** del ciclo completo en repo de
   juguete: brainstorm → spec → congelación → groom → dispatch.
7. **Despacho 1 real** sobre el siguiente epic de menoplus (con hipótesis; NO
   groomear M1.5, que está hecho a mano y sin `ct-order` — lo duplicaría),
   midiendo desde el primer dato según §6.

Cada tarea en worktree aislado, PR, contrato de siempre. La 2 y la 3 pueden ir
en paralelo; la 6 exige la 2-5 hechas.

---

## 9. Avisos para quien recoja esto

- **José no lee los specs.** Toda puerta que le pongas delante debe caber en
  una pantalla. La congelación son quince líneas, no un documento.
- **No re-litigar lo cerrado** (§4, §5): formato, hipótesis obligatoria,
  reglas en plantilla, fork con su alcance. Si construir algo lo demuestra
  imposible: parar y preguntar, no rediseñar en silencio.
- **`claude` sigue siendo función interactiva en el `.zshrc`** → `command
  claude` para todo lo no interactivo. El loop está a salvo (F29).
- **Un working tree, una sesión. Worktree aislado, nunca sobre `main`.**
- No pasar `--force` ni `--reconcile` sin confirmación explícita.
- Español para la discusión, inglés para código e identificadores.
- El artefacto visual se actualiza por URL (misma URL = misma página):
  https://claude.ai/code/artifact/ea292784-b537-4f5b-92ff-cd1397f75863
- La comparativa SOTA (Spec Kitty/STORM) está en el historial de versiones del
  artefacto y en ~/Desktop/control-tower-f31.pdf.
- Si el despacho 1 demuestra que el loop cuesta más de lo que ahorra, **eso
  también es un resultado** y se escribe.

---

## 10. Prompt para la sesión nueva

```text
CONTEXTO. Trabajas en el plugin `control-tower-loop`
(/Users/jpereag/Documents/control-tower-plugin), parte de una investigación
sobre cómo debe ser el ciclo de desarrollo con agentes.

Lee primero, ENTERO, el handoff de esta ronda:
docs/prompt-f32-el-fork-y-la-congelacion.md

OBJETIVO DE F32: CONSTRUIR lo decidido en F31. Las decisiones de diseño están
tomadas y cerradas (§4 y §5 del handoff): el formato del execution spec, la
puerta de congelación con procedencia, los dos niveles CT/superpowers, y el
fork de los 11 skills dentro del plugin con desinstalación de superpowers.
No re-abras decisiones sin evidencia nueva; si algo resulta imposible al
construirlo, para y pregunta.

TAREAS, EN ORDEN (§8 del handoff, resumen):
1. Licencia + versión origen del fork (superpowers 6.0.3).
2. Fork de los 11 skills a control-tower-loop:* con las 3 costuras reescritas.
3. Plantilla _TEMPLATE-execution-spec.md v2 en menoplus (+ migración v14→v16).
4. Groom: exit 2 si [NEEDS CLARIFICATION pendientes o ## Hipótesis ausente.
5. Kickoff: citar skills propios; plan del slice como primer acto.
6. Desinstalar superpowers + smoke test del ciclo entero.
7. Despacho 1 real midiendo (pre-registro en §6 del handoff — NO cambiar las
   definiciones después de ver datos).

CÓMO TRABAJAR
- Verifica el estado (§1) antes de nada, incluida la suite (no se corrió en F31).
- Worktree aislado, nunca sobre main. Un working tree, una sesión.
- `claude` es función interactiva en el .zshrc: usa `command claude`.
- TDD, PRs pequeños, contrato de siempre. El contrato no crece sin quitar.
- Español para la discusión, inglés para código e identificadores.
- Franco y directo. No inventar: verificar o preguntar.
- José no lee documentos largos: toda puerta humana cabe en una pantalla.

Empieza verificando el estado y dime, antes de tocar nada, tu plan de la
tarea 2 (el fork): qué ficheros copias, qué reescribes en cada costura, y
cómo lo vas a smoke-testear.
```
