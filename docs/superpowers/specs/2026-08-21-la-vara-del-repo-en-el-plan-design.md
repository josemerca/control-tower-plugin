# La vara del repo, por el embudo del plan — §3 deja de ser sólo ficheros a imitar

> Diseño de la segunda mitad de H5 del informe de la corrida en repo ajeno
> (`2026-08-20-la-primera-corrida-en-un-repo-ajeno-design.md`, §5.5). La primera
> mitad se construyó en `1422c67`: `outcome: sin-vara` y `evidence`.
>
> El problema que cierra: **el juez no puede producir un hallazgo de calidad
> porque no tiene contra qué medir.** No es un juez perezoso — es una rúbrica sin
> vara de código.

---

## 1. El problema, medido

`agents/ct-judge.md` recorre ocho ítems. Repartidos por lo que miden de verdad:

| Ítems | Qué miden |
|---|---|
| `objetivo`, `asercion-tdd`, `contrato`, `decisiones-cerradas`, `alcance` | Conformidad con el plan (5 de 8) |
| `manipulacion-tests`, `fixture-theater` | Fraude del implementador (2 de 8) |
| `patrones` | Calidad — con dos candados |

Los candados de `patrones` son literales en el fichero: *"the idiom of the files
the plan names — **never your own preferences**"* y *"If the plan names no
pattern for the code in question, this item has nothing to compare and
**produces no finding**"*.

O sea que el único ítem de calidad depende de que el plan haya encontrado código
parecido, y tiene prohibido aportar criterio. La rúbrica es **estructuralmente
incapaz** de producir un hallazgo de calidad.

Medido en la corrida de `jjponz/rust-monitoring` run-4, tarea 2 — un slice con
código real, símbolos reales y concurrencia real (`RwLock<HashMap<String,
Registered>>` con double-checked locking). El veredicto fue `PASS` sin hallazgos,
y el recorrido que lo acompaña es un trabajo riguroso: comprueba que `new_gauge`
usa `Opts::new(&gauge.name, …)`, que el test asserta `len() == 15` con
`le="+Inf"` en el índice 14, que el `format!` casa carácter a carácter con el
texto prescrito. Todo eso es conformidad con el plan.

Lo que nadie le pidió mirar: si ese patrón de concurrencia es el que el repo
prescribe, si los errores se propagan como manda el repo, si el adaptador
respeta sus boundaries. **El juez hizo su trabajo exactamente como está
escrito.**

## 2. Por dónde no puede entrar la vara

La cadena entera, verificada:

```
spec (repo destino) ── `## Contexto del epic`
   │  /ct-groom  lo copia IDÉNTICO al cuerpo de todos los issues del epic
   ▼
issue de GitHub
   │  /ct-next  reclama, crea el worktree, imprime el kickoff
   │  kickoff.js:244 → "Lee las secciones '## Contexto del epic' y
   │                    '## Contexto heredado' del issue"
   ▼
sesión del slice ── escribe el plan con writing-plans-prescriptive
   │  la skill: "the issue is the frozen spec … the 'Contexto del epic'
   │  sections". Y: "The execution spec itself is out of reach on purpose"
   ▼
plan commiteado ── gate `plan` humano
   │  ct-step SÓLO LEE EL PLAN: usa `git` y `sh`, nunca `gh`
   │  (ct-step.mjs:58,129,633). No puede ver el cuerpo del issue.
   ▼
task-brief ── extrae CUATRO secciones + la tarea
   ▼
implementador  y  juez
```

El embudo está en `ct-step`. Todo lo que el juez sabe viene del plan, y del plan
sólo las cuatro secciones que `task-brief` copia: `### Desired end state`,
`### Out of scope`, `## 2. Closed decisions` y `## 3. Reference patterns`.

Y el detalle que lo remata: **la plantilla del plan ya conoce el concepto.**
`## 9. Assumptions` exige que cada ambigüedad resuelta declare su procedencia, y
una de las cuatro posibles es literalmente `repo convention`. Pero §9 es una de
las cinco secciones que `task-brief` **no** copia. El único sitio del plan donde
hoy se escribe "esto lo decidí por una convención del repo" es precisamente el
que no llega ni al implementador ni al juez.

`## Contexto del epic` tampoco sirve como está: es prosa libre de contexto de
negocio y dependencias, la misma para todos los slices, y tiene prohibido llevar
subcabeceras `###` porque truncan la sección. No admite estructura.

## 3. Las tres formas de cruzar el embudo, y la elegida

`ct-step` sólo puede leer dos cosas: el plan y los ficheros del repo.

| Forma | Coste |
|---|---|
| **Por el plan** | Un agente escribe la vara |
| **Por un fichero del repo** que `ct-step` lea | Artefacto nuevo, y decidir quién lo siembra y lo confirma |
| **Los dos** | Las dos piezas |

**Se toma la primera**, y con una precisión que la abarata mucho: **no una
sección nueva.** `plan-contract.js:201` exige el ORDEN de las nueve secciones,
así que una sección entre §3 y §4 obliga a renumerar §4–§9 en la plantilla, en
`PLAN_SECTIONS` y en cada plan ya escrito que se revalide.

En vez de eso, **`## 3. Reference patterns` deja de significar sólo "ficheros a
imitar" y pasa a ser la vara del repo para este slice**, con dos clases de
entrada dentro: ficheros a imitar y documentos de reglas que obedecer.

| Pieza | Qué hay que tocar |
|---|---|
| Renumerar §4–§9 | Nada: no hay sección nueva |
| `task-brief` | Nada: ya copia §3 |
| Que §3 exista | Nada: `plan-contract` ya la exige |
| Gate humano | Nada: el gate `plan` ya cubre §3 |
| `ct-judge` | Quitarle los dos candados a `patrones`, que ya apunta a §3 |

Y una observación que hace el problema más pequeño de lo que parecía: **al juez
no hay que darle el contenido de las convenciones, sólo el puntero.** Ya tiene
`Read`, `Grep` y `Glob` — abre los documentos él. Lo que cruza el embudo es una
lista de rutas y la orden de medir contra ellas.

## 4. El punto débil, cerrado con el idioma que el repo ya tiene

La objeción real a "por el plan" es que un agente escribe la vara y nada
comprueba que exista. Puede inventarse `docs/conventions/domain.md`.

Se cierra con la **regla de literalidad**, que este repo ya aplica: hoy
`plan-contract` exige que todo `Current state` citado exista verbatim en el repo.
La misma regla, acotada a §3: **toda ruta que §3 nombre tiene que existir.**

Un token entre comillas invertidas se trata como ruta sólo si contiene una barra
o acaba en `.md`, `.txt`, `.rst` o `.adoc`:

- `` `docs/conventions/infrastructure.md` `` → ruta, tiene que existir
- `` `AGENTS.md` `` → ruta, tiene que existir
- `` `test(...)` ``, `` `describe` `` → no son ruta
- `` `backend-engineering:backend-best-practices` `` → no lleva barra: es una
  skill, y su existencia no se comprueba en disco

Acotada a §3 a propósito: en el resto del plan hay rutas que se van a crear y que
por definición no existen todavía.

Así, el agente propone, la máquina comprueba que las rutas son reales, y el
humano firma en el gate que ya firmaba. Es la siguiente de la serie que abrió
`5b97fdd` y siguió el paso 2 de la ronda anterior: aquella cerró "la vara es
prosa", la otra "la vara mide al revés", y ésta cierra "la vara no existe".

## 5. La decisión que más se va a discutir: no se exige un mínimo

`plan-contract` **no** exige que §3 nombre al menos un documento de reglas.

El caso que lo decide es este repo: `control-tower-plugin` no tiene `AGENTS.md`,
ni `CLAUDE.md`, ni `docs/conventions/`, y `.claude/` está vacío. Un validador que
exigiera una vara que el repo no tiene es el guard imposible de F14 otra vez —
el que sólo se satisface inventándose un documento, que es peor que no tenerlo.
La propiedad que F14 dejó escrita es que *desde cualquier estado que el detector
señale existe un camino que lo deja verde sin empeorar el repo*, y exigir un
mínimo la rompe.

Entonces qué impide volver al punto de partida: **la ausencia no se prohíbe, se
mide.** El juez recorre `patrones`, no encuentra documentos de reglas que abrir,
y responde `outcome: sin-vara` — el campo construido en `1422c67`. Eso viaja en
el veredicto y se cuenta en `rubric_sin_vara`.

Un epic cuyos veinte slices salen con `patrones: sin-vara` te dice, en una
columna, que ese repo necesita escribir sus convenciones. Es información que hoy
no existe. Un validador que lo prohibiera daría un plan bloqueado y ninguna
cifra.

Es la misma forma que el resto del loop: la ausencia se declara, no se rellena.

## 6. Las cinco piezas

1. **`skills/writing-plans-prescriptive/plan-template.md`** — §3 con las dos
   clases de entrada.
2. **`skills/writing-plans-prescriptive/SKILL.md`** — que el agente busque los
   documentos de reglas del repo (`AGENTS.md`, `CLAUDE.md`, `docs/conventions/`,
   `CONTRIBUTING`) y los cite, y que el `## Contexto del epic` del issue es donde
   un humano puede haberlos nombrado.
3. **`scripts/plan-contract.js`** — regla nueva `reference-paths`: las rutas que
   §3 nombra existen.
4. **`agents/ct-judge.md`** — `patrones` pierde el *"never your own
   preferences"* para los documentos de reglas y gana la orden de abrirlos y
   medir contra ellos, citando regla y ruta. Sin documentos de reglas, la
   respuesta es `sin-vara`.
5. **`prompts/task-implementer.md`** — la misma frase, para que implementador y
   juez midan con lo mismo. Es la propiedad que hace que el juez no sea una
   sorpresa: la vara del que escribe y la del que bloquea son el mismo texto.

## 7. Lo que esto NO hace

- **No construye ningún script de descubrimiento.** `agentic-skills` tiene
  `discover_conventions.py` porque su skill de spec necesita proponer candidatos
  a un humano. Aquí el agente del plan ya lee el repo, y `plan-contract`
  comprueba que no se lo inventó. Un barrido determinista es la siguiente vuelta,
  no ésta.
- **No crea ningún fichero ni ninguna puerta humana.** El gate `plan` ya cubre §3.
- **No añade un noveno ítem a la rúbrica.** Todo lo que se añade a `ct-judge.md`
  compite por la atención de un juez que tiene ocho ítems que recorrer de verdad,
  y el ítem que hace falta ya existe: sólo estaba maniatado.
- **No resuelve la re-declaración por slice.** El plan es por slice, así que las
  mismas cuatro rutas se escriben veinte veces en un epic de veinte slices, y
  nada garantiza que el slice 14 cite las mismas que el slice 3. El fichero por
  repo lo resolvía de una vez; es el precio de no construir transporte nuevo, y
  se puede corregir más adelante sin deshacer nada de esto.
- **No toca los dos ítems que `agentic-skills` tiene y aquí no existen** (patrón
  de entrega y observabilidad). Los dos dependen de convenciones declaradas por
  el repo, así que dependen de este mecanismo: son material de después, no de
  ahora.

## 8. La tensión que queda viva, y por qué se acepta

El `patrones` de hoy prohíbe criterio propio **a propósito**, y es lo que evita
el veto defensivo: a un verificador al que se le pide encontrar fallos, siempre
encuentra alguno. Devolverle criterio reabre esa puerta.

Lo que la mantiene cerrada es que el criterio queda **anclado a un documento
citable**. No vale "esto me parece feo": tiene que ser "la línea 34 de
`docs/conventions/infrastructure.md` dice X y este diff hace Y". Y el campo
`evidence` que se construyó en `1422c67` es obligatorio en las tres severidades,
así que un hallazgo sin la cita se descarta antes de llegar a nadie.

O sea que las dos mitades de H5 se sostienen mutuamente: la vara sin la cita
sería un juez opinando, y la cita sin la vara era un juez sin nada que citar.
