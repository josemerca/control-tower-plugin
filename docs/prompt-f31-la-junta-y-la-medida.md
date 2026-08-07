# Prompt de arranque — F31, la junta y la medida

> Escrito al cerrar una sesión larga del 2026-08-06/07 que mergeó **F29** (PR #16,
> 0.28.0) y **F30** (PR #17, 0.29.0, contrato v16) y que, sobre todo, **cambió el
> planteamiento del proyecto**: dejó de ser «arreglar el plugin» y pasó a ser
> «entender cómo debe funcionar el ciclo de desarrollo con agentes, con el plugin
> como instrumento».
>
> Esta ronda **no trae tareas de código pendientes**. Trae un modelo conceptual,
> una revisión de literatura con tres papers leídos enteros, y una propuesta.
> El encargo de la sesión nueva es **re-revisarlo todo y romperlo donde se pueda**.
>
> Copiar el bloque `text` del final en la sesión nueva.

---

## 0. Por qué esta ronda es distinta

José es CTO de Mercadona Tech. Este proyecto tiene **doble objetivo declarado**:
una herramienta que él usa de verdad, y comprensión transferible del ciclo de
desarrollo agéntico para definírselo después a sus equipos. Explícitamente:
*«no siempre me interesa lo más barato y rápido sino también entender todos los
pros y contras y comprender a fondo cada opción y el porqué de las decisiones»*.

Y explícitamente también: **si al final no sale paper, no pasa nada**, siempre
que salga una herramienta que resuelva el problema analizado.

Consecuencia para quien recoja esto: **no optimices por entregar rápido.** La
tentación de esta ronda es construir; el valor está en no construir hasta que el
modelo esté claro. José paró la sesión anterior dos veces con «te tiras todo el
rato a la implementación, ¿podemos seguir pensando?».

---

## 1. Estado exacto al empezar — compruébalo, no te lo creas

```
main                    53470e8   Merge PR #17
plugin                  0.29.0
contrato de slices      v16
suite                   60 ficheros, 1704 tests
scope user / project    0.29.0 los dos (menoplus)
```

Comandos:

```bash
cd /Users/jpereag/Documents/control-tower-plugin
git log --oneline -3 && git status --porcelain
grep -m1 'SLICES_CONTRACT_VERSION=' scripts/ct-init.sh
npm test 2>&1 | tail -5
```

**Otras sesiones vivas en este checkout** (lección 9 de F28 — un working tree,
una sesión):

```bash
ls -lt ~/.claude*/projects/-Users-jpereag-Documents-control-tower-plugin/*.jsonl | head -3
```

---

## 2. Lo que se mergeó en esta ronda

**F29 · PR #16 · 0.28.0 — el agente se teclea con el wrapper de su cuenta.**
`/ct-next` tecleaba la constante `claude`. Medido contra el `.zshrc` real: era
una **función de shell** que preguntaba «¿Qué cuenta? 1/2» sin mirar
`CLAUDE_CONFIG_DIR` y que además lo pisaba. Un shell de login la resuelve antes
que el PATH, así que el agente se quedaba en el `read` — y `/ct-next` lo daba por
**lanzado con exit 0**, porque el centinela se escribe antes de invocar al agente
y `command -v` devuelve 0 para una función. Ahora el binario sale de la cuenta
resuelta (`personalBin`/`workBin`, por defecto `claude-personal`/`claude-work`).
No se clavó `claude-personal` a propósito: habría arrancado un repo de
`mercadona/*` con la cuenta personal mientras el dispatcher imprimía «(trabajo)».

**F30 · PR #17 · 0.29.0 · contrato v16 — la sección deja de llamarse «tabla §9».**
El número era un fósil: groom localiza la tabla por sus columnas `Slice`+`Dep`, y
`--section N` lleva obsoleto varias rondas. Ahora es «tabla de slices».
`SLICES_HEADING_LEGACY` reconoce el heading viejo y nunca lo emite — sin eso, un
`AGENTS.md` con el heading antiguo y sin marcadores recibiría una **segunda copia
entera** de la sección (verificado rompiendo la tolerancia a propósito: 2
headings).

Hash v16 añadido a la lista: `bb8e3298…`, 540 líneas, calculado sobre el bloque
**realmente emitido** por una corrida sobre un repo temporal, no sobre el fuente.

---

## 3. Hechos medidos sobre el plugin — no re-derivar, sí re-verificar

Todos comprobados en esta ronda leyendo código o ejecutando. Si alguno resulta
falso, es un hallazgo y hay que decirlo.

| # | Hecho | Dónde |
|---|---|---|
| 1 | El plugin **no menciona `writing-plans` ni `docs/superpowers/plans/`** en ningún sitio | `grep -rn` en `commands/`, `scripts/kickoff.js` |
| 2 | El kickoff nombra **un solo skill**: `subagent-driven-development` | `scripts/kickoff.js:236` |
| 3 | Ese skill arranca con el rombo `"Have implementation plan?"` y sus 3 scripts exigen `PLAN_FILE` | `superpowers/6.2.0/skills/subagent-driven-development/SKILL.md` |
| 4 | menoplus tiene **178 planes** (el más reciente de hoy) y **1 solo workspace SDD** | `docs/superpowers/plans/`, `.superpowers/sdd/` |
| 5 | **Ningún issue de menoplus lleva `<!-- ct-order:N -->`** → groom los duplicaría | comprobado en #563, #564, #598, #574 |
| 6 | Pero `order: order ?? i.number` → **`/ct-next` SÍ puede despachar issues hechos a mano** | `scripts/gh-issue-map.js:781` |
| 7 | Sin label `status:` → se resuelve como `backlog` → invisible para el dispatcher | `gh-issue-map.js:698` |
| 8 | Los gates `visual`/`apply` **no bloquean el merge** | `commands/ct-groom.md` |
| 9 | menoplus está en contrato **v14** → saltará a v16 en una sola migración | `AGENTS.md:157` |
| 10 | Vocabulario de labels: 13 `area:`, 7 `touches:`, 5 `status:`. **Faltan** `type:infra`, `type:bugfix`, `gate:apply`, `gate:none` | `gh label list` |
| 11 | M1.5: **#567 está `status:blocked`**; **#566 no es código** (activar una fuente en App Store Connect). Despachables reales: **#563, #564, #565** | `gh issue list` |

---

## 4. El modelo conceptual al que se llegó

### 4.1 El spec es el registro de un JOIN

No falta un formato de spec: falta reconocer que hay una **operación** con dos
entradas.

```
decisiones de producto  ×  topología del código  →  el join  →  la tabla de slices
```

`Área`, `Toca`, `Dep` y el troceado **no salen del núcleo de decisiones**, porque
no son decisiones de producto: son hechos de un repositorio concreto en un
momento concreto. Ningún núcleo puede contenerlos y ninguna herramienta de
producto puede generarlos. Por eso el paso no desaparece aunque se quite el
documento intermedio.

Criterio derivado, que es la respuesta a «¿qué formato tiene el spec?»:

> **El spec contiene exactamente el resultado del join. Ni más ni menos.**
> Lo anterior es el núcleo. Lo posterior es el código. Lo que no es ninguna de
> las dos cosas es prosa.

Probado contra casos: «slice 3 toca `db, migration` porque la hipótesis exige
backfill» → dentro. «Arquitectura hexagonal del proyecto» → fuera, es `AGENTS.md`.
«Por qué Postgres y no DynamoDB» → fuera, es el núcleo. «Invariante: iOS 17
mínimo» → dentro.

### 4.2 Gemba y Control Tower son las dos mitades de una tubería

`/Users/jpereag/Documents/gemba/app` — app interna de Mercadona, en producción.

Pipeline en `lib/ai/skills/pipeline/stations.ts`, seis paradas:
`entender → validar → decidir → diseñar → especificar → handoff`,
y la última tiene `doneSignal: {kind:"artifact", categories:["eng-handoff"]}`.

**Gemba termina exactamente donde empieza Control Tower.**

Dos propiedades de su diseño que importan:

- **El estado de cada parada es derivado, no declarado** — se calcula mirando si
  existe el artefacto. Misma doctrina que el centinela de `/ct-next`.
- **El núcleo de decisiones es datos, no prosa** (JSONB vivo, 5 bloques con
  `interviewPrompt` cada uno), y PRFAQ / six-pager / one-pager / user-story /
  eng-handoff son **renders** de él.

Los cinco bloques: `problema`, `job_objetivo`, `solucion`, `scope_experimento`,
`metricas_objetivo`. Y `scope_experimento` contiene *«hipótesis clave, lo más
pequeño que la testea, señal de éxito, anti-señal, **anti-scope**, restricciones»*
— que mapea sobre la tabla: `anti_scope` **es** la columna `Protegido`.

Con un comentario en `canvas.ts` que vale su peso: *«anti_scope arranca vacío — el
seed NO lo inventa»*.

### 4.3 Colisión de nombres entre los dos repos

- **gemba**: `handoff` es la **salida** hacia ingeniería.
- **menoplus**, `_TEMPLATE-execution-spec.md`: *«Handoff origen: [ruta al handoff
  de diseño]»*, y el documento se titula *Execution spec (CONGELADA)*. El handoff
  es la **entrada**.

Es el mismo artefacto visto desde los dos lados de la mesa. Por eso ninguno tenía
formato: cada lado asumía que era problema del otro.

Y la plantilla de menoplus **ya es el join escrito**, sin llamarlo así:
`## Decisiones congeladas` y `## Invariantes` vienen del núcleo; `## Slices
verticales` y `## Gates humanos` ya son topología.

### 4.4 Las tres conexiones rotas

Ninguna es un documento. Son juntas entre piezas que ya funcionan.

1. **núcleo → tabla** — hoy lo cubre un spec en prosa escrito a mano, sin formato.
2. **el plan del slice** — los scripts de SDD lo exigen y nadie lo escribe.
3. **la arista de vuelta** — hay emisor (`blocked: {reason, unblock}`) y **no hay
   receptor**: muere en el `SLICE.md` de un worktree que además está en
   `.gitignore`.

### 4.5 Los invariantes, con estado de evidencia

| # | Invariante | Estado |
|---|---|---|
| 1 | Nada se afirma sin comprobarlo por efecto | **comprobado muchas veces**, rompiendo la implementación |
| 2 | Un agente puede abrir decisiones, **nunca cerrarlas** | enunciado y construido, **sin ejercitar en campo** |
| 3 | La coordinación se hace antes, no después | correcto, pero el claim **no es atómico** (doble claim reproducido) |
| 4 | El estado vive donde todos lo ven y nadie puede mentirle | construido, **poco tensionado** (nunca desde dos máquinas) |
| 5 | Un artefacto mixto necesita borde declarado, y la herramienta se rinde antes que cruzarlo | comprobado por las malas (5 rondas corrompiendo bodies) |
| 6 | Las decisiones son datos; los documentos son renders | probado en gemba, **cero presencia en Control Tower** |
| 7 | Una comprobación que no puede detener la acción siguiente es decoración | **contradicción interna, ver abajo** |
| 8 | El recurso escaso es la atención humana | **hipótesis** — y la literatura la respalda, ver §5 |

**Sobre el 7 hay una contradicción que hay que resolver:** los gates `visual` y
`apply` son decoración según la propia definición del repo — el loop los escribe
y los enseña, y no impiden mergear. La puerta de closing keywords sí es puerta
(emite `deny`). Propuesta de reescritura: *toda comprobación que la máquina puede
hacer y no detiene nada es decoración; las que dependen de juicio humano no son
comprobaciones, son puntos de espera*. Son dos cosas y hoy comparten nombre.

### 4.6 El grano del slice: no es disyuntiva, son capas

`writing-plans` define una tarea como *«la unidad más pequeña que un revisor podría
rechazar mientras aprueba a su vecina»* — grano de **revisión**.
`scope_experimento` de gemba dice *«lo más pequeño que testea la hipótesis»* —
grano de **aprendizaje**.

No compiten: **el núcleo decide el borde exterior (el experimento); la tabla corta
ese experimento en piezas revisables.** Cada uno donde tiene la información.

Consecuencia incómoda: **los milestones actuales de menoplus no son experimentos**,
son agrupaciones temáticas. Sin hipótesis, el troceado interior no tiene contra
qué justificarse — que es probablemente por qué la tabla se siente arbitraria de
escribir.

---

## 5. La literatura — qué se leyó de verdad

**Distinguir tres niveles de confianza.** Lo que sigue es lo que se leyó entero,
lo que se leyó a medias, y lo que sólo se buscó.

### 5.1 Leídos ENTEROS

**Frattini et al., *Requirements Quality Research: a harmonized Theory, Evaluation,
and Roadmap*** ([2309.10355](https://arxiv.org/pdf/2309.10355), 27 pp.)

Define la **Requirements Quality Theory (RQT)**:
`Entity → Entity-Fact → Impact → Activity-Fact → Cost/Resource`, con
**Context Factors** modulando el impacto. Y define **Agent** como *«cualquier
persona, grupo de personas o **automatismo**»* — un agente LLM ya cabe.

Censo sobre 57 publicaciones:

| Concepto | Reportado |
|---|---|
| Entity, Factor | 57/57, pero **42% con la entidad definida implícitamente** |
| Impact | 40/57 — 17 no reportan ninguno |
| Evidencia del impacto | **hipotetizada 47,5%**, inductiva 27,5%, referenciada 25% |
| Agents | 14/57 |
| Activities | 40/57, **92% elicitadas ad hoc** |
| **Attributes** | **8/57 (14%)** |
| Context factors | 14/57 — **cero publicaciones reportan influencia de herramientas** |
| **Cost / Resource** | 15,8% / 8,8%, *«nunca determinados empíricamente»* |

Frase clave: *«omitir los atributos cuantificables de las actividades impide la
evaluación empírica del impacto de un factor de calidad porque omite **el
instrumento de medida de la variable dependiente**»*.

Roadmap §5.3 pide formular el impacto como **problema de regresión con análisis
bayesiano, «dados datos suficientes»**. §5.4: no existe colección unificada de
factores de contexto. §5.5: impacto económico, alta prioridad. §5.6: herramienta
(`github.com/JulianFrattini/rqt-tool`).

**ClarifyGPT** ([2310.10996](https://arxiv.org/pdf/2310.10996), FSE 2024, 21 pp.)

Cuatro etapas: generación de entradas de test (semillas por LLM + mutación
type-aware estilo fuzzing) → **code consistency check** (muestrear *n* soluciones,
ejecutar, comparar salidas; distintas = ambiguo) → preguntas dirigidas →
regeneración.

Resultados: GPT-4 con feedback humano 70,96 → 80,80 en MBPP-sanitized (+13,87%),
media +15,35%. Con feedback simulado +11,52%. 140 de 427 problemas identificados
como ambiguos (~⅓), 2,85 preguntas de media.

**Tamaño medio del requisito: 14,5 palabras en MBPP-sanitized, 67,7 en HumanEval.**

**Su limitación §6.2, textual**: *«ClarifyGPT no es adecuado para generar código con
entradas complejas (p. ej. imagen o fichero). Además, para código que no devuelve
valores de salida… puede estar sujeto a limitaciones»*. Los prompts exigen *«una
firma de función y un docstring»*.

Amenazas: fuga de datos (benchmarks públicos, posiblemente en el preentrenamiento)
y fidelidad de la simulación de usuario.

**POSTCONDBENCH** ([2605.03356](https://arxiv.org/pdf/2605.03356), 30 pp.)

Benchmark de 420 tareas (210 Python + 210 Java) de 121 repos. Completitud por
**discriminación de defectos**: un conjunto de postcondiciones es *bug-complete*
si es correcto y **mata todos los mutantes** (del código).

- **De 10.000 repos, sólo 941 (9,4%)** pudieron montarse automáticamente.
- Comp@1: GPT-5 0,255; Claude-4.5 0,207. Corr@1 0,483 / 0,629. La brecha no cierra
  muestreando (@5: 0,802/0,446).
- **Dependencias**: Comp@1 0,090 → 0,035 en Python (**2,6× peor**).
- **Longitud**: 0,296 → 0,205 → 0,149 al crecer LoC.
- Incompletitud: **78% valor de retorno infra-especificado**.
- **Apéndice F.1 (crítico)**: false discovery rate por familia de mutación,
  **0,08–0,31**. Excluir la familia LLM sube Comp@1 de Claude-4.5 de 0,2068 a
  **0,2944** — 42% de inflación. *La métrica es estable dentro de una familia y
  NO entre familias.*
- **Apéndice G**: reference-free **a nivel de especificación**, no de
  implementación. Siguen exigiendo código ejecutable y tests con ≥90% cobertura.
- **Apéndice H**: 29,3% de métodos Python filtrados. Categorías: iterator (18),
  timeout (17), concurrencia (13), entidades de lenguaje (8), **ordinary — logging,
  imprimir, enviar email (9)**, error especificado (5), otros (17). Java añade
  **random related**. Sobre *ordinary*: *«no puede ser capturada por el marco de
  especificación»*.
- **Apéndice A**: justifican mutantes frente a bugs reales porque un bug real viene
  con **una sola** versión defectuosa — necesitan volumen de variantes.

### 5.2 Leídos A MEDIAS

**Farrag, *The Productivity-Reliability Paradox*** ([2605.01160](https://arxiv.org/pdf/2605.01160)),
págs. 1-21 de 30. **Faltan discusión, amenazas a la validez y agenda.**

Preprint de un solo autor, University of East London, sin revisión por pares.
Revisión multivocal de 67 fuentes (29 revisadas por pares, 18 preprints, 12
informes de industria, 8 literatura gris), enero 2022 – abril 2026. Admite no
haber tenido revisores independientes para el cribado.

Tesis: *«specification discipline, not model capability, is the binding constraint
on AI-assisted software dependability»*.

| Estudio | N | Hallazgo | Tier |
|---|---|---|---|
| METR (Becker 2025) | 16 devs OSS, 246 tareas | **19% más lentos**, habiendo predicho +24% | 2 — «el más riguroso» |
| Faros AI 2025 | 10.000+ devs, 1.255 equipos | +21% tareas, **+98% PRs**, **+91% tiempo de revisión**, +154% tamaño de PR, +9% bugs, **DORA plano** | 3 |
| DORA 2024 | ~3.000 | +25% adopción ↔ **−7,2% estabilidad** | 3 |
| GitHub (Peng 2023) | 95 | +55% velocidad | 3 — **conflicto de interés declarado** |

Tres variables moderadoras: **nivel de abstracción** (la IA falla en lo
arquitectónico), **madurez del código** (*«el impuesto de verificación puede
exceder el ahorro»*; 4,3 min/sugerencia para un senior vs 1,2 para un junior),
**experiencia** (Anthropic 2026: −17% en comprensión al delegar).

Cuatro mecanismos de gobernanza por intensidad: revisión posterior → spec en
lenguaje natural → **contrato ejecutable** → gobernanza constitucional. Y la guía
de decisión, con el remate: *«el nivel de gobernanza debe variar **dentro** de un
mismo sprint según las características de la tarea, no aplicarse uniformemente»*.

Piloto de Spec Kit: 14 ingenieros, 3 proyectos, 4 meses, **retrospectivo y sin
grupo de control**. Lead time 8-12 → 6-9 días; hotfixes 3-5 → 1-2; rollbacks 2-4 →
0-1; churn 12-18% → 6-10%. **Coste: 45-90 min de spec por feature mediana.** Y:
*«Spec Kit no eliminó la paradoja. Desplazó su localización»*.

Y una idea que no teníamos: **el spec como compresión de contexto** — *«representaciones
comprimidas del contexto del proyecto que compensan la memoria finita de la IA»*.

**Alenezi, *SDD as the Foundation of AI-Native Enterprise SE***
([2607.16680](https://arxiv.org/pdf/2607.16680)), sólo abstract e introducción.
SGRM: specs como contratos de cuatro componentes. Tres niveles de rigor:
spec-first, spec-anchored, spec-as-source. Evaluado contra **ISO/IEC 25010**.
Las cifras de **73% menos defectos de seguridad y 50% menos time-to-market** son
**de segunda mano dentro de ese paper y NO se han rastreado**.

### 5.3 Sólo buscado, NO leído

Spec Kit, Kiro, OpenSpec, GSD, nWave; los nueve orquestadores de Augment Code
(contenido comercial); el paper taxonómico [2606.04967](https://arxiv.org/pdf/2606.04967)
y el de state management [2605.20563](https://arxiv.org/pdf/2605.20563) — **estos
dos se citaron a partir de resúmenes automáticos, no de lectura**; Property-Based
Mutation Testing (Bartocci, [2301.13615](https://arxiv.org/abs/2301.13615));
requirements smells; ISO/IEC/IEEE 29148.

**De 29148 sólo está verificado** que separa la calidad de **un requisito** de la
del **conjunto** (individual: *appropriate* — evita detalles de implementación —,
*conforming*; conjunto: completo, consistente, factible, **asequible**, **acotado**).
Los nueve términos exactos **no se han visto**: el estándar es de pago.

**EARS**: Rolls-Royce Aero Engines 2009, RE'09, Alistair Mavin. Creado analizando
regulación de aeronavegabilidad para el control de un motor a reacción. Diseñado
para comunicación **humano a humano bajo revisión de seguridad**. Que «desambigüe
pero no denote» no es una limitación: es su especificación de diseño.

---

## 6. Dónde está el proyecto frente al SOTA

**Por delante** (y la literatura lo confirma sin conocerlo): el paper de state
management concluye que hace falta *work claiming*, *lock-based protection*,
*pre-coordination superior a resolución posterior* y *visibilidad centralizada* —
que es el claim por labels, los tokens de área y GitHub como almacén. De nueve
orquestadores, **uno solo** tiene grafo de dependencias, **ninguno** sincroniza
estado entre máquinas, y sobre resolución de conflictos el artículo responde
*«nothing here»*.

Únicos, no vistos en ningún sitio: la distinción **cap / tokens** (`--release`
suelta la plaza pero no el área hasta el merge), la **semántica de fallo honesta**
(centinela, `1` que no degrada a `0`, lecturas comparadas contra `totalCount`), y
el **`doneSignal` derivado** de gemba.

**Por detrás**: el formato del spec; **cero verificación automática antes del PR**
(Copilot coding agent tiene auto-revisión del diff + CodeQL + secret scanning en
GA); el claim sin compare-and-swap; y —sólo si el objetivo fueran equipos— que la
ejecución dependa de un portátil con cmux.

---

## 7. La propuesta, tal como quedó

### 7.1 La herramienta: un join instrumentado

1. **El contrato del join.** Contenido derivado, no importado. Más dos disciplinas
   robadas: **`[NEEDS CLARIFICATION]` con dientes** (groom se niega si quedan
   pendientes) y **referencia de cada fila a la decisión que la justifica**. El
   enfoque técnico del epic va en `## Contexto del epic`, que **ya viaja a todos
   los issues** y hoy está sin usar para eso.
2. **El registro del slice.** El plan que el agente escribe al arrancar, más lo que
   ocurrió al ejecutarlo.
3. **La arista de vuelta**, con su restricción.

### 7.2 La medida: el plugin ya es un instrumento RQT

Por slice, el loop produce nativamente:

| Concepto RQT | Lo que ya genera |
|---|---|
| Entity | la fila de la tabla — **con alcance explícito** (supera al 42% de la literatura) |
| Agent | el agente, su cuenta, su modelo, su prompt exacto |
| Activity | la implementación, **ejecutada por máquina → instrumentable** |
| Attribute | ¿`blocked`? ¿rondas de revisión? ¿`--reopen`? ¿`--requeue`? tiempo |
| Context Factors | repo, `area:`, `touches:`, `type:`, `gate:`, modelo — **y la herramienta** |
| Cost | tiempo, tokens, rework |

Primera pregunta medible, y **no es la de las trazas**:

> **¿Predicen las propiedades de la fila el coste del slice?**

N pequeña, crece con cada slice, es propia, **no pasa por legal**.

### 7.3 Las trazas, después

Heredan tres problemas sin resolver: **α** (la abstracción de evento de producción
a transición de spec — en hardware es la identidad, aquí no, y es donde vive el
error), el **mutante equivalente** (una traza perturbada que resulta legítima, y la
legitimidad la define la regla no escrita que se intenta descubrir: es circular), y
la **revisión legal**.

Cuando se llegue: **mutar la traza, no el spec** — conserva la discriminación de
defectos que POSTCONDBENCH validó, el apéndice A justifica por qué hace falta
volumen de variantes defectuosas, y una traza real perturbada es un *near-miss*
más realista que cualquier entrada sintética. Con **dos familias de operadores
como mínimo y FDR cruzado reportado** (apéndice F.1), sobre un dominio acotado.

### 7.4 Lo que NO se hace, y por qué

No se adopta ningún formato de spec de la industria: **especifican el núcleo, no el
join**. No se engorda el contrato sin quitar (540 líneas ya). No se construye
`--adopt`, `--check` ni `ct-milestone`. No se unifica la gobernanza: la evidencia
dice **calibrar por tarea**, lo que apunta a extender la columna `Gate`.

---

## 8. Preguntas abiertas

1. **¿Qué contiene exactamente el join** para servir a la vez a un equipo humano y
   a `/ct-groom`?
2. **¿Dónde vive el porqué?** Documento, o referencias de fila a bloque del núcleo.
   El contenido está determinado; la forma del registro no.
3. **¿Merece el punto del diseño su propia puerta?** Kiro tiene una entre requisitos
   y diseño. Nuestras dos puertas están las dos *después* del join.
4. **La contradicción del invariante 7** (§4.5).
5. **¿Los milestones deberían ser experimentos?** (§4.6).

---

## 9. Avisos para quien recoja esto

- **El artefacto visual de la sesión**, con el ciclo completo en 14 pasos, qué
  existe y qué falta: https://claude.ai/code/artifact/f35ad10d-d4ea-4066-88b9-31bdb81cf182
- **Cero slices despachados.** Todo lo anterior es hipótesis hasta que el loop
  corra sobre trabajo real. Y la evidencia dice que el cuadrante de José
  —brownfield, senior, cross-cutting— es el peor. Si el primer despacho real
  demuestra que el loop cuesta más de lo que ahorra, **eso también es un
  resultado** y hay que decirlo.
- **`claude` sigue siendo una función interactiva en el `.zshrc`.** Para cualquier
  invocación no interactiva hay que usar `command claude`. El loop ya está a salvo
  (F29); los scripts y el CI de José, no.
- **Un working tree, una sesión.** Trabajar en worktree aislado, nunca sobre `main`.
- No pasar `--force` ni `--reconcile` sin confirmación explícita.
- José pide **español para la discusión, inglés para código e identificadores**.

---

## 10. Prompt para la sesión nueva

```text
CONTEXTO. Trabajas en el plugin `control-tower-loop`
(/Users/jpereag/Documents/control-tower-plugin), que forma parte de una
investigación más amplia sobre cómo debe ser el ciclo de desarrollo con agentes.

Lee primero, ENTERO, el handoff de esta ronda:
docs/prompt-f31-la-junta-y-la-medida.md

OBJETIVO DE ESTA SESIÓN: re-revisar todo lo que hay ahí y romperlo donde se
pueda. No es una ronda de implementación. La ronda anterior produjo un modelo
conceptual y una revisión de literatura; tu trabajo es auditarlos, no
continuarlos.

CÓMO QUIERO QUE TRABAJES

1. COMPRUÉBALO TODO, NO TE LO CREAS. El handoff marca en su §5 qué se leyó
   entero, qué a medias y qué sólo se buscó. Trata las tres categorías distinto:
   lo que sólo se buscó puede estar mal citado. Dos papers (2606.04967 y
   2605.20563) se citaron desde resúmenes automáticos: si los usas, léelos.

2. Los "hechos medidos" de la §3 son afirmaciones sobre el código, con su
   fichero y su línea. Re-verifica los que sostengan una conclusión. Si alguno
   es falso, es el hallazgo más valioso que puedes traer.

3. ATACA EL MODELO, no lo adornes. Los sitios donde más sospecho:
   - que el spec sea "el registro de un join" (§4.1) — ¿aguanta el criterio
     derivado contra casos que no elegí yo?
   - que el plugin sea ya un instrumento RQT (§7.2) — ¿de verdad están todos
     los conceptos, o estoy forzando el mapeo?
   - la contradicción del invariante 7 (§4.5) y mi propuesta de reescribirlo.
   - "mutar la traza, no el spec" (§7.3) — ¿resuelve de verdad el problema del
     mutante equivalente, o sólo lo mueve?

4. NO PROPONGAS IMPLEMENTAR. Si crees que algo hay que construir, dilo en una
   frase y sigue pensando. La ronda anterior se desvió tres veces hacia
   implementación y hubo que pararla.

5. Señálame explícitamente si algo que proponemos ya está publicado. El riesgo
   mayor de la línea de investigación es reinventar una contribución existente.

RESTRICCIONES
- Worktree aislado, nunca sobre `main`. Un working tree, una sesión.
- `claude` es una función interactiva en el .zshrc: usa `command claude`.
- Español para la discusión, inglés para código e identificadores.
- Franco y directo. Recomendar, no listar opciones exhaustivas. No inventar:
  verificar o preguntar.

Empieza leyendo el handoff y dime, antes de nada, qué tres cosas de ahí te
parecen más frágiles y por qué.
```
