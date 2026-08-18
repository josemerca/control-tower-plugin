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

Una línea nueva que **nombra la sección sin interpolar su texto** (mismo criterio
que F21/F26: la prosa es de longitud arbitraria y el kickoff se teclea entero en
un pty). Honesta con el caso «no está / está vacía»: no hay nada que respetar y
se dice, para que el agente no lo busque fuera del issue. El texto deja claro que
son decisiones del epic que este trabajo **debe respetar** (no reinterpretar).

## 5. Lo que hace falta construir

| Pieza | Dónde |
|---|---|
| Constante de cabecera `## Decisiones congeladas` | `scripts/groom.js` |
| `readFrozenDecisions` (espejo de `readEpicContext`) + limpieza de procedencia + guardarraíl de cabeceras internas + `reason` | `scripts/groom.js` (puro), llamado desde `scripts/ct-groom.mjs` |
| Emisión de la sección al crear | `scripts/groom.js#buildIssueBody` (bloque espejo del de epic context) |
| El texto viajando en el plan (`frozenDecisions` + `frozenDecisionsUnknown`) | `scripts/groom.js#groomPlan` |
| Comparación (`frozenDecisionsDiffers`, con rama unknown) | `scripts/reconcile.js#diffIssue` |
| Nota en el informe | `scripts/reconcile.js#formatDrift` |
| Splice + inserción anclada antes de heredado | `scripts/reconcile.js#buildReconcileBody` |
| Duplicados, `machine: false` | `scripts/reconcile.js#DUPLICATE_CHECKS` |
| La línea que nombra la sección | `scripts/kickoff.js#renderKickoff` |
| Wiring: leer del spec, pasar a `groomPlan`, categoría de reporte | `scripts/ct-groom.mjs` |
| Contrato de la sección del spec | `commands/ct-groom.md` |

Todo **aditivo**: constante nueva, función nueva, un parámetro más en firmas
existentes (`buildIssueBody`, `groomPlan`). No se reemplaza ninguna línea de
lógica existente.

## 6. Tests que fijan las propiedades

Espejo de los tests de `## Contexto del epic`, con Vitest y el mismo patrón que
la suite existente (import directo para lo puro; `ct-groom --dry-run` para el E2E):

1. **`readFrozenDecisions` quita la procedencia** de cada línea y conserva la
   decisión; sección ausente → `null`; vacía → `null` (con su reason).
2. **El guardarraíl corta:** una sección con `###` dentro no se emite y el aviso
   nombra la línea.
3. **`buildIssueBody` emite `## Decisiones congeladas`** cuando hay contenido, y
   **no la emite** cuando no lo hay (body idéntico al de hoy sin ella).
4. **E2E `ct-groom --dry-run`:** un spec con la sección → el cuerpo la lleva,
   limpia; sin la sección → el cuerpo no la lleva.
5. **`--reconcile` la reescribe** cuando el spec cambia, y **solo ella**.
6. **La inserción respeta el orden** `epic → decisiones → heredado`, y se rinde
   sin ancla en vez de escribir a ciegas.
7. **Los reason de retirada** distinguen ausente/vacía (retira) de malformada
   (no toca) — regresión directa de la corrección I1 de F26.
8. **No mueve el exit code**, ni divergiendo ni duplicada.
9. **El kickoff nombra la sección** con la cabecera exacta leída de la constante.
10. **El cuerpo con la sección nueva no altera** lo que extraen `extractAc` /
    `extractDepsInSection` / `extractStrayDeps` / `extractSectionContent`.

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

## 8. Lo que esta fase NO hace

**Cumplimiento de ningún tipo.** Nada aquí verifica que el agente respetó una
decisión. `## Decisiones congeladas` en el issue es **prosa que se lee**, el
mismo tier que `## Out of scope / Protected` — una nota, no una valla. `scope.js`
sigue leyendo el alcance solo de `Alcance:` dentro de `## Contexto del epic`, y
no se toca.

**Decidir el canal de las decisiones de ficheros.** La duplicación con Protegido
(§7) y la pregunta «¿el vehículo de una decisión de ficheros es `Alcance:` o esta
sección?» se resuelven en la fase de cumplimiento, no aquí.

**Añadir la sección a una plantilla de spec.** El original no tiene plantilla de
execution-spec; la sección se documenta en `commands/ct-groom.md` (como se
documenta hoy `## Contexto del epic`) y con eso basta para la fase «que las lea».

**Filtrar por procedencia.** El código quita el sufijo; no descarta una
`propuesta` mal metida en la sección. Es responsabilidad del autor, como los
`[NEEDS CLARIFICATION]` de la puerta de congelación. Un guard de eso, si se
quiere, es otra ronda.

## 9. Versión

`0.35.0` — cambio de contrato aditivo: el cuerpo de los issues gana una sección
`## Decisiones congeladas` y el spec gana una sección opcional con esa cabecera.
Nada de lo que hoy funciona deja de funcionar: un spec sin la sección produce los
mismos issues de hoy.
