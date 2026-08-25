# Decisiones congeladas que llegan al implementador — soporte de primera clase

> 2026-08-18 · continúa el transporte de contexto que abrió F26
> (`## Contexto del epic`). Viene de 0.34.0.
>
> **Fase 1 de 2 — «que las lea».** Este diseño hace que las decisiones
> congeladas del spec **lleguen** al cuerpo del issue como prosa que el agente
> lee. El **cumplimiento** (que un guard verifique que el agente las respetó)
> queda explícitamente fuera (§8) y es una guerra distinta: solo las decisiones
> de ficheros son verificables, y su vehículo ya existe (`Alcance:` en
> `## Contexto del epic`, que `scope.js` comprueba contra el diff del PR).

## 1. Qué se arregla

Una decisión que el epic congela —«iOS 17 mínimo», «se llama Pilares», «la forma
del dato es X»— **no llega hoy al agente que implementa el slice**, salvo que un
humano la copie a mano a `## Contexto del epic`. Auditado sobre el árbol de
0.34.0, canal por canal:

| canal | ¿groom lo hace **automático** desde `## Decisiones congeladas`? | ¿puede una decisión acabar en el issue? |
|---|---|---|
| Proyección directa de la sección | **No** — 0 referencias en `scripts/` a la cabecera | no |
| `## Contexto del epic` | No — `readEpicContext` copia lo que **un humano escribió** ahí | **sí**, verbatim, si el humano la copia |
| Link al spec | N/A — `renderSpecLink` emite un enlace, no inline | accesible a un clic, **no en el cuerpo** |
| `## Contexto heredado` | No — la rellena la sesión coordinadora | sí, si alguien la pega |
| Columnas del slice (Protegido/Dep/Área/Toca) | No — salen de la tabla §9, no de la sección | **sí**, re-codificada (p.ej. `## Out of scope / Protected`) |

Dos hechos se leen de esa tabla:

**Nada en groom lee `## Decisiones congeladas`.** Cero. Todo camino por el que una
decisión aparece hoy en un issue exige que un humano la haya **re-codificado a
mano** en un canal que groom sí lee (`## Contexto del epic`, o una columna de la
tabla §9). No existe ningún transporte automático desde la sección de decisiones.

**Las decisiones se parten en dos según tengan casa o no.** Las de ficheros
(zonas protegidas, dependencias) ya llegan re-codificadas como metadato del
slice; las que no tienen columna (version floor, naming, forma de dato) no
llegan por ningún sitio. Es exactamente el hueco que F26 dejó al cubrir solo el
contexto común del epic: el que teclea el spec congela una decisión y confía en
que alguien se acuerde de copiarla.

## 2. Lo que ya funciona, medido y no deducido

F26 dejó construida **la maquinaria de transporte de una sección del spec al
cuerpo de los N issues del epic, mantenida al día**: `readEpicContext` la lee del
spec por texto de cabecera; `buildIssueBody` la emite; `groomPlan` la lleva en el
plan; `diffIssue`/`buildReconcileBody` la comparan y la reescriben con un splice
acotado; `DUPLICATE_CHECKS` la vigila; `kickoff` la nombra. Es el patrón que
`scope.js` se fía para leer el `Alcance:`.

`## Decisiones congeladas` pide **el mismo trato, palabra por palabra**, que
`## Contexto del epic`: una sección del spec, opcional, localizada por su
cabecera, copiada idéntica a todos los issues del epic, reescrita por
`--reconcile` cuando el spec cambia. **Lo que falta no es maquinaria nueva: es un
segundo cliente de la que ya existe.**

## 3. El diseño: una sección más, con el dueño del epic

`## Decisiones congeladas` es **del spec**, como `## Contexto del epic`: el
plugin la escribe al crear y la reescribe con `--reconcile`. No es como
`## Contexto heredado` (que es de la sesión coordinadora y el plugin no toca).

Se implementa **a imagen y semejanza de `## Contexto del epic`** — mismas
funciones espejo, mismos `reason`, mismo splice, mismos comentarios que explican
el porqué. No se inventa ni una forma nueva. Donde F26 escribió `readEpicContext`,
esto escribe `readFrozenDecisions` con la misma silueta.

### 3.1 De dónde sale y cómo viaja

De una sección del spec con la cabecera literal `## Decisiones congeladas`, fuera
de la tabla §9. Se localiza **por texto de cabecera, nunca por número de
sección** — mismo criterio que `readEpicContext` y que `analyzeSlicesTable`.

Se reusa `gh-issue-map.js#extractSectionContent`/`locateSection` sobre el texto
del spec. **No se escribe un segundo escáner de secciones:** el que existe lleva
el endurecimiento de vallas de código, comentarios HTML y cabeceras ATX de F5.

**Si el spec no la trae**, no se emite nada y se avisa una vez por corrida —
mismo trato que `## Contexto del epic` ausente. Un spec sin esta sección es
válido. **Presente pero vacía cuenta como ausente**, con su propio aviso.

### 3.2 La única diferencia con `## Contexto del epic`: se quita la procedencia

La plantilla de decisiones (f32) escribe cada línea con su procedencia:

```
- **D-1 · versión mínima** — iOS 17. *(Procedencia: hablada.)*
```

La procedencia (`hablada | deducida | propuesta`) es **meta para el que congela**,
no para el que ejecuta: al agente le da igual si la decisión se habló o se
dedujo — la tiene que respetar igual. Al proyectar, `readFrozenDecisions` **quita
el sufijo `*(Procedencia: …)*`** de cada línea y deja la decisión limpia:

```
- **D-1 · versión mínima** — iOS 17.
```

Es un `.replace` por línea sobre el contenido de la sección, **no un parser**: no
se clasifica, no se filtra por valor de procedencia, no se juzga nada. La regla
de f32 «una *propuesta* no se congela» es responsabilidad del autor —igual que la
puerta de congelación confía en que no queden `[NEEDS CLARIFICATION]`—; el código
solo limpia el sufijo. Cero juicio humano en el código.

> Consecuencia para reconcile: el texto que viaja es **el ya limpio**. Por eso
> `diffIssue` compara la sección del issue contra el mismo texto limpio
> (`wantedFrozenDecisions`), no contra el crudo del spec: limpio-vs-limpio, sin
> falsos diffs.

**El formato de entrada se fija contra la plantilla real, no contra un ejemplo.**
El sufijo lo escribe `_TEMPLATE-execution-spec.md` (el núcleo, ver §8 y
`commands/ct-groom.md`). Como esa plantilla vive fuera de este árbol, la evidencia
del formato en el repo son las dos líneas de `docs/loop/loop.body.html`:

```
- **D-1 · <título>** — <la decisión>. *(Procedencia: hablada — «cita literal».)*
- **D-2 · <título>** — <la decisión>. *(Procedencia: deducida de D-1.)*
```

El fixture de test copia **estas líneas literales** (con la cita entre comillas y
el guion), no un caso inventado. La cita literal es lo que hace frágil el
recorte: puede llevar paréntesis, comillas o, en el peor caso, envolverse a dos
líneas.

**La limpieza falla de forma observable.** El recorte del sufijo es un `.replace`
best-effort; no pretende cubrir cada variante (`_(…)_` con guion bajo, sin
envolver, envuelto a dos líneas). Lo que **no** puede pasar es que un fallo del
recorte viaje en silencio al cuerpo de los N issues —eso sería exactamente el
«no poder comprobar NO es estar limpio» que `scope.js` prohíbe por doctrina—. Por
eso, **si tras limpiar la palabra `Procedencia` sigue apareciendo** en la sección,
`readFrozenDecisions` **avisa por el mismo canal que los demás guardarraíles**
(warning, nombrando la línea) y proyecta igualmente el texto: el aviso convierte
un fallo mudo en uno que alguien lee. Es una comprobación, no un juicio: no
decide si la decisión es válida, solo si el recorte hizo su trabajo.

### 3.3 La restricción de las cabeceras internas (heredada de §3.3 de F26)

`locateSection` termina una sección en **cualquier** cabecera ATX (incluidas
`###`). Como esta sección **sí se splicea** con `--reconcile`, no puede llevar
subcabeceras dentro: un splice dejaría el resto huérfano.

**Guardarraíl:** si el texto del spec trae una cabecera ATX dentro de
`## Decisiones congeladas`, `/ct-groom` **no la emite** y lo dice, nombrando la
línea ofensora. No aborta la corrida: la sección es opcional. Mismo criterio,
misma implementación que el guardarraíl de `## Contexto del epic`. Las decisiones
son bullets (`- **D-N · …** — …`), no necesitan cabeceras dentro.

### 3.4 Posición en el cuerpo

Pegada al contexto del epic —ambas son nivel-epic, del spec, reconciliadas— y
**antes** del contexto heredado:

```
enlace al spec → Descripción → Contexto del epic → Decisiones congeladas
              → Contexto heredado → Acceptance criteria → Dependencias
              → Gates → Out of scope / Protected
```

El contrato de orden pasa a ser `epic → decisiones → heredado → criterios`. Es
contexto para interpretar los AC; leerlo después es leerlo tarde.

### 3.5 El consumidor: llegar al issue no es llegar al plan del slice

El issue **no es** el punto donde una decisión se convierte en código: eso pasa
cuando el agente escribe el plan del slice con `writing-plans-prescriptive`. Y ese
agente trabaja contra una **lista blanca cerrada** —`skills/writing-plans-prescriptive/SKILL.md`
enumera lo único de lo que «is allowed to plan from» (AC, Out of scope/Protected,
Contexto del epic, Contexto heredado, Dependencias) y le prohíbe expresamente ir
al spec («The execution spec itself is out of reach on purpose»)—. Proyectar la
sección al body **sin tocar esa lista** entrega transporte sin destinatario: la
decisión llega al issue y muere ahí, porque el agente ni la tiene enumerada ni
puede ir a buscarla.

Cerrar el hueco en esta fase cuesta **tres ediciones de texto, cero código de
verificación**:

1. **La lista blanca de la skill** (`SKILL.md`) gana `## Decisiones congeladas`
   como entrada permitida del plan.
2. **La enumeración del kickoff** (`kickoff.js`, la línea que lista «sus AC,
   "Protegido" y "Contexto del epic"» como entrada de la skill) gana la sección
   —lo que se enumera se lee; lo que se deja a «ya lo verá» compite con el resto
   del cuerpo, como dice el propio comentario de `kickoff.js`—.
3. **El destino explícito:** el kickoff instruye al agente a volcar cada decisión
   congelada en **`## 2. Closed decisions`** del plan del slice —la sección que el
   contrato de plan (`plan-contract.js`) ya exige y que `dispatch-check --check-plan`
   valida—. Es su casa natural: existe, está machine-checked, y la decisión del
   epic aterriza donde el `--release` la busca.

Esto es **prosa dirigida al agente**, no un guard que compruebe que obedeció. El
guard machine-checked (que `## 2. Closed decisions` contenga cada `D-N` del issue)
es deseable pero es **fase 2** (§8): añade contrato nuevo y desborda «que las
lea». El vocabulario de procedencia de `## 9. Assumptions` (`issue / epic context
/ repo convention / your call`) queda como referencia para el agente al volcar,
no como algo que esta fase valide.

## 4. Contrato

### 4.1 Cabecera

Una constante exportada desde `groom.js`, junto a `EPIC_CONTEXT_HEADING` y por el
mismo motivo: la nombran el que escribe, el que compara y sus tests.

- `## Decisiones congeladas`

La cabecera es **la misma en el spec y en el issue**: una sola cadena que aprender.

### 4.2 `/ct-groom` al crear un issue

- Emite `## Decisiones congeladas` con el texto del spec **ya sin procedencia**,
  **solo si** el spec trae la sección y pasa el guardarraíl de §3.3.

### 4.3 `/ct-groom --reconcile` sobre un issue existente

- Se compara y **se reescribe**, con el mismo splice acotado de
  `## Contexto del epic`. Si la cabecera no existe en el issue (uno anterior a
  esta ronda), se inserta entera. **Ancla de inserción:** justo **antes de
  `## Contexto heredado`** (para respetar el orden de §3.4), con AC como respaldo
  si esa sección no existe. Sin ninguna de las dos anclas, se rinde sin escribir
  nada — misma forma que la inserción de `## Contexto del epic`.

> **Nota de orden (a resolver en el plan).** `## Contexto del epic` y
> `## Decisiones congeladas` comparten ancla de inserción (`## Contexto
> heredado`). El plan debe fijar que, cuando ambas se insertan en un issue
> viejo, el orden resultante sea `epic → decisiones → heredado` y no se pisen. La
> forma más simple: anclar decisiones **después** de la cabecera de contexto del
> epic si existe, cayendo a «antes de heredado» si no.

- Los 4 `reason` de retirada se heredan tal cual de `readEpicContext`
  (ausente/vacía autorizan a retirar; malformada/truncada **no** autorizan nada
  y dejan el cuerpo como está). Es la corrección I1 de F26: sin separar esos
  motivos, un `###` de más en el spec borraría las decisiones de los N issues en
  el `--reconcile` siguiente.

### 4.4 Códigos de salida

**No cuenta jamás para el `3`.** Ni divergencia ni duplicado. Mismo criterio que
`## Contexto del epic`/Descripción/Protegido: anclar el exit code a esto haría
que todo issue groomeado antes de esta ronda saliera `3` en cada corrida hasta
reescribir su cuerpo a mano, y eso entrena a ignorar el resto del informe. Se
reporta como `nota:`. Se añade a `DUPLICATE_CHECKS` con `machine: false`.

### 4.5 El kickoff

Dos cosas, no una (ver §3.5):

1. **La sección se enumera como entrada del plan**, junto a AC/Protegido/Contexto
   del epic, en la línea del kickoff que describe la entrada de
   `writing-plans-prescriptive`. No basta con un «léela también» aparte: lo que se
   enumera como entrada se usa; lo que se nombra al margen compite con el resto del
   cuerpo.
2. **El kickoff nombra el destino:** el agente vuelca cada decisión congelada en
   `## 2. Closed decisions` del plan del slice, y las **debe respetar** (no
   reinterpretar).

Se **nombra la sección sin interpolar su texto** (mismo criterio que F21/F26: la
prosa es de longitud arbitraria y el kickoff se teclea entero en un pty). Honesto
con el caso «no está / está vacía»: no hay nada que respetar y se dice, para que
el agente no lo busque fuera del issue.

Y la **lista blanca de `writing-plans-prescriptive/SKILL.md`** gana la sección
como entrada permitida: sin eso, el kickoff nombra algo que la skill declara
fuera de alcance, y las dos fuentes se contradicen.

## 5. Lo que hace falta construir

| Pieza | Dónde |
|---|---|
| `readSpecSection(specMd, heading, { strip })` — el lector puro extraído (localiza, guardarraíles, `reason`), con `readEpicContext` reescrito encima como una línea | `scripts/groom.js` (ver I1 en §7) |
| Constante de cabecera `## Decisiones congeladas` | `scripts/groom.js` |
| `readFrozenDecisions` = `readSpecSection(…, { strip: PROCEDENCIA_SUFFIX_RE })` + aviso observable si sobrevive `Procedencia` | `scripts/groom.js` (puro), llamado desde `scripts/ct-groom.mjs` |
| Emisión de la sección al crear | `scripts/groom.js#buildIssueBody` (bloque espejo del de epic context) |
| El texto viajando en el plan (`frozenDecisions` + `frozenDecisionsUnknown`) | `scripts/groom.js#groomPlan` |
| Comparación (`frozenDecisionsDiffers`, con rama unknown) | `scripts/reconcile.js#diffIssue` |
| Nota en el informe | `scripts/reconcile.js#formatDrift` |
| Splice + inserción anclada antes de heredado | `scripts/reconcile.js#buildReconcileBody` |
| Duplicados, `machine: false` | `scripts/reconcile.js#DUPLICATE_CHECKS` |
| **Enumerar la sección como entrada del plan + nombrar el destino `## 2. Closed decisions`** | `scripts/kickoff.js#renderKickoff` |
| **La sección en la lista blanca de entradas del plan** (B1) | `skills/writing-plans-prescriptive/SKILL.md` |
| Wiring: leer del spec, pasar a `groomPlan`, categoría de reporte | `scripts/ct-groom.mjs` |
| Contrato de la sección del spec (referenciando la plantilla real) | `commands/ct-groom.md` |
| **Corregir la anotación «LO ÚNICO QUE VIAJA AL AGENTE»** (P2) | `docs/loop/loop.body.html`, `docs/loop/control-tower-loop.html` |

Casi todo **aditivo**: constante nueva, función nueva, un parámetro más en firmas
existentes (`buildIssueBody`, `groomPlan`), dos ediciones de texto (SKILL.md y la
enumeración del kickoff). La **única** reescritura de lógica existente es extraer
`readSpecSection` y reexpresar `readEpicContext` sobre él (I1): es un refactor de
bajo riesgo —`readEpicContext` ya tiene sus 5 tests, que quedan verdes sin
tocarlos— y elimina el clon del lector antes de crearlo.

## 6. Tests que fijan las propiedades

Espejo de los tests de `## Contexto del epic`, con Vitest y el mismo patrón que
la suite existente (import directo para lo puro; `ct-groom --dry-run` para el E2E):

1. **`readFrozenDecisions` quita la procedencia** de cada línea (fixture con el
   formato **literal de la plantilla**, `*(Procedencia: hablada — «cita literal».)*`,
   copiado de `docs/loop/loop.body.html`) y conserva la decisión; sección ausente
   → `null`; vacía → `null` (con su reason).
2. **El guardarraíl corta y el aviso nombra la línea:** una sección con `###`
   dentro no se emite, `reason === malformada`, **y el warning contiene la línea
   ofensora** (no solo el reason — I3.2).
3. **`buildIssueBody` emite `## Decisiones congeladas`** cuando hay contenido, y
   **no la emite** cuando no lo hay (body idéntico al de hoy sin ella).
4. **E2E `ct-groom --dry-run`:** un spec con la sección → el cuerpo la lleva,
   limpia; sin la sección → el cuerpo no la lleva.
5. **`--reconcile` la reescribe** cuando el spec cambia, **y solo ella**: el test
   afirma que la sección nueva cambia **y que el resto del body es byte-idéntico**
   (AC, gates, protegido, marcador `ct-order`) — no basta con comprobar el texto
   nuevo (I3.5).
6. **La inserción respeta el orden** `epic → decisiones → heredado`, **y se rinde
   sin ancla** en vez de escribir a ciegas: test explícito del caso «no hay
   `## Contexto heredado` ni `## Acceptance criteria`» → `body: null` +
   `unresolvedFrozenDecisions === 'sin-ancla'` (I3.6).
7. **Los reason de retirada** distinguen ausente/vacía (retira) de malformada
   (no toca) — regresión directa de la corrección I1 de F26.
8. **No mueve el exit code**, ni divergiendo ni duplicada: se comprueba el **exit
   real de `ct-groom --reconcile`** (E2E) y no solo `formatDrift` — que el `nota:`
   no suba el código a `3` (I3.8).
9. **El kickoff enumera la sección** como entrada del plan, usando la **constante**
   `FROZEN_DECISIONS_HEADING` (no el literal — que es justo lo que la constante
   existe para evitar, §4.1), y nombra el destino `## 2. Closed decisions` (I3.9,
   B1).
10. **Contenido HOSTIL: lo que la máquina decide no se envenena.** El test mete en
    la prosa de una decisión las cadenas peligrosas —incluida `ct-order:99 -->`
    **con su cierre** (el caso que una regex laxa casaría), más `merge-after #7`,
    `AC-1.1`, `closes #3`— y afirma, extractor por extractor:
    - `extractOrder` devuelve el orden REAL del slice, **no** el `99` de la prosa
      (fix P1: anclado a la línea completa `<!-- ct-order:N -->`). **Este es el que
      protege el dispatch.**
    - `extractAc` y `extractDepsInSection` (que leen sus propias secciones) quedan
      intactos.
    - `extractStrayDeps` **sí** recoge el `#7` de la prosa: es ruido conocido y
      aceptado (§7), no mueve el exit code. El test fija ese comportamiento REAL,
      no uno aspiracional — no se afirma una limpieza que no existe.
11. **B2 — fallo de limpieza observable:** una decisión cuyo sufijo NO casa el
    recorte (envuelto a dos líneas, o `_(…)_`) → la sección se proyecta **con un
    warning** que nombra la línea donde sobrevive `Procedencia`. El fallo no es
    mudo.

## 7. Riesgos

**Otro splice de prosa en la parte frágil del plugin.** Mitigación: es la misma
forma exacta que el splice de `## Contexto del epic`, ya probado; el guardarraíl
de §3.3 elimina la única forma conocida de partir un cuerpo; se rinde en vez de
adivinar cuando falta el ancla.

**Dos secciones comparten ancla de inserción.** El orden entre `## Contexto del
epic` y `## Decisiones congeladas` al insertarlas en un issue viejo hay que
fijarlo con un test (§6.6). Es el único punto donde este diseño no es un calco
literal de F26 y merece cuidado.

**Duplicación con `## Out of scope / Protected`.** Una decisión de ficheros
(«no tocar db/schema») puede aparecer a la vez como decisión congelada y como
columna Protegido → el agente la ve dos veces. Es **ruido, no contradicción**, y
se acepta en esta fase. Resolverlo pertenece a la fase de cumplimiento (§8),
donde se decide qué canal manda.

**Un texto de decisiones largo se copia en N issues.** Es el precio de que cada
agente lo tenga delante sin abrir otro fichero. El campo ya lo paga a mano con el
contexto del epic; la diferencia es que las N copias no pueden divergir.

**I2 — prosa del spec por delante del marcador `ct-order`.** `extractOrder`
(`gh-issue-map.js`) hace `body.match(/ct-order:(\d+)/)` sobre el body entero y se
queda con la **primera** aparición; la sección nueva va muy por delante del
marcador real. Una decisión que mencione `ct-order:N` —en un repo que se
auto-groomea y cuyos specs hablan de `ct-order` sin parar, esto no es
hipotético— haría que los N issues leyeran el mismo orden falso,
`buildOrderIndex` colisionaría y el epic entero se caería del despacho, con un
síntoma que no apunta a la causa. Mitigación: es riesgo preexistente de F26, pero
esta ronda lo **duplica**, así que se endurece `extractOrder` para que solo case
el **marcador entero en su línea** (`^<!-- ct-order:N -->$`), no un `ct-order:N`
suelto **ni un `ct-order:N -->` en prosa** (P1 del review: exigir solo el cierre
`-->` no bastaba). El test §6.10 mete justamente `ct-order:99 -->` en la prosa y
afirma que `extractOrder` devuelve el orden real. (El `merge-after #N` en prosa
sí produce `strayDeps` de ruido —no mueve el exit code—; se acepta y el test lo
fija tal cual.)

**B2 — el recorte de procedencia es best-effort sobre un formato externo.** La
regex no cubre cada variante y el formato lo gobierna una plantilla que vive fuera
del árbol. Mitigación: el fixture se fija contra el formato literal de la
plantilla (§3.2), y **el fallo es observable** —si sobrevive `Procedencia`, se
avisa—, en vez de viajar mudo a los N issues.

**I1 — deuda de duplicación.** Sin el refactor, esta ronda clonaría ~52 líneas
del lector y ~65 del bloque de reconcile (la parte más frágil, la que acumula
I1/C2/C3): cada corrección futura de guardarraíl habría que aplicarla dos veces y
los tests de una copia no protegerían a la otra. Mitigación: se extrae
`readSpecSection` (el lector puro, barato y ya cubierto por 5 tests), que borra la
mitad de la duplicación. El bloque de `buildReconcileBody` **sí se duplica** esta
ronda (refactorizarlo es más caro y arriesgado que el lector); a cambio, el test
de paridad de §6 (los escenarios se corren contra las dos secciones) hace que una
divergencia futura salte. **`## Invariantes`** viene del mismo núcleo de la
plantilla (`docs/prompt-f31`) y tiene **exactamente este mismo hueco**: se
reconoce aquí y se deja fuera a propósito (§8) para no clonar por tercera vez sin
decidirlo.

## 8. Lo que esta fase NO hace

**Cumplimiento de ningún tipo.** Nada aquí verifica que el agente respetó una
decisión. `## Decisiones congeladas` en el issue es **prosa que se lee**, el
mismo tier que `## Out of scope / Protected` — una nota, no una valla. `scope.js`
sigue leyendo el alcance solo de `Alcance:` dentro de `## Contexto del epic`, y
no se toca.

**Decidir el canal de las decisiones de ficheros.** La duplicación con Protegido
(§7) y la pregunta «¿el vehículo de una decisión de ficheros es `Alcance:` o esta
sección?» se resuelven en la fase de cumplimiento, no aquí.

**Tocar la plantilla EXTERNA de execution-spec.** El spec **sí** tiene plantilla
—la gobierna `_TEMPLATE-execution-spec.md` (el núcleo, según `commands/ct-groom.md`),
que vive **fuera de este árbol**— y esta sección viene de su núcleo. Esta fase
**no** la edita: se documenta el contrato en `commands/ct-groom.md` (como se
documenta hoy `## Contexto del epic`, referenciando la plantilla, no negándola) y
con eso basta para «que las lea». Mantener esa plantilla al día es de quien la
posee.

> **Lo que sí se corrige (P2), porque es del repo y este cambio lo vuelve
> falso:** los docs `docs/loop/loop.body.html` y `docs/loop/control-tower-loop.html`
> anotan hoy `## Contexto del epic` como «LO ÚNICO QUE VIAJA AL AGENTE». Al añadir
> un segundo canal que también viaja, esa anotación pasa a mentir. Se actualiza a
> «contexto y decisiones congeladas viajan al agente» (o se marca la anotación
> como histórica). No es la plantilla externa: son artefactos versionados aquí, y
> dejar una contradicción dentro del propio repo es justo lo que P2 señala.

**El guard machine-checked del destino.** Que `dispatch-check --check-plan`
verifique que `## 2. Closed decisions` del plan contiene cada `D-N` del issue
—cerrando el bucle de B1 con una máquina en vez de con prosa— es deseable, pero
añade contrato nuevo y desborda «que las lea». Esta fase cierra el consumo con la
whitelist + el kickoff (§3.5); el guard es fase 2.

**`## Invariantes`.** Viene del mismo núcleo de la plantilla y tiene el mismo
hueco que las decisiones congeladas (transporte inexistente hoy). Se reconoce
(§7, I1) y se deja fuera a propósito: la ronda siguiente es este mismo calco, y
merece decidirse —no arrastrarse— junto con qué hacer con la duplicación del
bloque de reconcile.

**Filtrar por procedencia.** El código quita el sufijo; no descarta una
`propuesta` mal metida en la sección. Es responsabilidad del autor, como los
`[NEEDS CLARIFICATION]` de la puerta de congelación. Un guard de eso, si se
quiere, es otra ronda.

## 9. Versión

`0.35.0` — cambio de contrato aditivo en la superficie: el cuerpo de los issues
gana una sección `## Decisiones congeladas`, el spec gana una sección opcional con
esa cabecera, y el plan del slice la recibe como entrada (whitelist + kickoff,
destino `## 2. Closed decisions`). Nada de lo que hoy funciona deja de funcionar:
un spec sin la sección produce los mismos issues de hoy. Internamente hay dos
cambios no-aditivos, ambos de bajo riesgo y cubiertos por tests existentes: se
extrae `readSpecSection` bajo `readEpicContext` (I1) y se ancla `extractOrder` al
marcador cerrado `<!-- ct-order:N -->` (I2, corrige un riesgo preexistente que
esta ronda hace alcanzable).
