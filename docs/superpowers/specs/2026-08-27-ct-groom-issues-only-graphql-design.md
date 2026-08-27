# `/ct-groom` en repos grandes: listar issues sin arrastrar los PRs — diseño

> 2026-08-27 · bugfix de disponibilidad. Sale de un caso real: `/ct-groom`
> contra `mo.picking.api` (issue/PR #10446) muere antes de crear nada.

## 1. Qué se arregla

`/ct-groom`, antes de crear o reconciliar nada, lista **todos los issues del
repo** para poder ser idempotente y seguro de re-ejecutar. En un repo grande y
activo esa lectura desborda el buffer del proceso hijo y mata la corrida real
**antes de la primera mutación** (ni milestone ni issues). No es un problema del
spec ni del repo destino: es una limitación del plugin.

Reproducido en `mo.picking.api`: el spec (`sc-1485`) valida y parsea limpio, dos
slices bien formados; el groom en modo real aborta en el listado de issues.

## 2. El diagnóstico, medido

`scripts/ct-groom.mjs` hace (línea ~925):

```
gh api repos/<repo>/issues --method GET -f state=all --paginate --slurp
```

a través de un helper `execFileSync('gh', …, { maxBuffer: 20 MiB })`. Dos hechos
se combinan:

1. **El endpoint REST `/issues` devuelve también los pull requests** (comparten
   namespace en la API v3). `realIssuesOnly` (`gh-issues.js`) los descarta —
   pero **después** de haberlos descargado, con su body completo.
2. Con `state=all` + `--paginate --slurp`, la respuesta entera (issues **y** PRs,
   bodies completos, objeto REST completo) entra en **un único buffer**. En un
   repo con ~10.000 issues+PRs supera los 20 MiB → `ENOBUFS` → el `catch` hace
   `process.exit(1)`.

O sea: la mitad de lo que se descarga (los PRs) es peso muerto que se tira, y aun
así es lo que revienta el buffer.

## 3. Para qué sirve ese listado (lo que NO se puede perder)

Todo cuelga del marcador `<!-- ct-order:N -->` que el plugin escribe en el body
de cada issue que crea. El listado responde «¿qué issues creó un groom anterior y
dónde están?», y con eso da cinco garantías:

1. **Idempotencia** — no recrea un issue que ya existe (match por marcador en el
   epic, `findByMarker`).
2. **Reconciliación** (`--reconcile`) — compara cada slice contra su issue y
   reescribe divergencias.
3. **Huérfanos** — issue con `ct-order:N` cuyo slice ya no está en la tabla §9.
4. **Puerta A** — issue con marcador **sin milestone** que colisiona con la tabla
   de hoy (obliga a mirar fuera del milestone objetivo).
5. **Puerta B** — el mismo epic bajo **otro** milestone/título (obliga a mirar en
   otros milestones); sin ella, recrearía el epic duplicado con exit 0.

**Lo que sí necesita ver:** (a) todos los issues del milestone objetivo, y (b)
todos los issues —de cualquier milestone o sin él— que lleven un marcador. **Lo
que no necesita:** los PRs (se descartan), ni los campos REST que no usa. Los
campos que el pipeline consume son exactamente: `number`, `title`, `body`,
`state` (en minúsculas), `milestone.title`, `labels[].name`.

## 4. La decisión: GraphQL, solo issues, solo los campos que se usan

Se sustituye la llamada REST por la **conexión `issues` de GraphQL**. Es la única
vía que cumple las tres condiciones a la vez (bajar payload, no tocar el buffer,
**comportamiento idéntico**):

- La conexión `issues` de GraphQL **nunca devuelve PRs** → fuera ~50 % del
  payload, sin cambiar el conjunto de issues (los PRs ya se tiraban).
- Se piden **solo** los campos usados → fuera el resto del objeto REST.
- Paginación por cursor real (`--paginate`), **sin** el tope de 1000 de la Search
  API — que truncaría la lista y podría no ver un issue con marcador → duplicado.

Alternativas descartadas y por qué:

| Vía | Por qué no |
|---|---|
| Subir `maxBuffer` | El usuario lo excluye; y un repo mayor vuelve a desbordar (mueve el techo, no baja el payload). |
| Search API (`is:issue`) | Tope duro de 1000 + eventual-consistency → truncaría y crearía duplicados: **cambia el comportamiento**. |
| Scoping por milestone | Sigue incluyendo PRs y pierde la Puerta B: **cambia el comportamiento**. |

El conjunto de issues resultante es **idéntico** al que producía `realIssuesOnly`
sobre el REST; las cinco garantías se mantienen intactas. `realIssuesOnly` se
conserva como red de seguridad (inocua: GraphQL no trae PRs).

## 5. Contrato

- `GROOM_ISSUES_QUERY` (en `gh-issues.js`): query GraphQL, `states:[OPEN,CLOSED]`,
  campos `number title body state milestone{title} labels(first:50){nodes{name}}`,
  con `pageInfo{hasNextPage endCursor}`. **`$endCursor` se declara PRIMERO** en la
  lista de variables:

  ```graphql
  query($endCursor: String, $owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, after: $endCursor, states: [OPEN, CLOSED]) {
        nodes { number title body state milestone { title } labels(first: 50) { nodes { name } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  ```

  Las variables GraphQL se pasan por NOMBRE, no por posición, así que en teoría el
  orden es indiferente; se pone `$endCursor` primero de todos modos porque es la
  forma del ejemplo canónico de `gh` y elimina cualquier duda. Lo que **no** es
  opcional: la variable ha de llamarse exactamente `endCursor` y el `pageInfo` ha
  de estar presente, o `gh api graphql --paginate` devuelve **solo la primera
  página en silencio**. Esa es la trampa real, y la red que la caza es el test
  multipágina del `fake-gh` (§ plan, Slice 3), no la inspección visual.

- `normalizeGraphqlIssues(pages)` (puro): aplana las páginas de `--slurp` y
  devuelve los issues en la **forma REST** que el resto ya espera (`state` en
  minúsculas, `labels` → `[{name}]`, `milestone` → `{title}|null`). Defensivo ante
  la forma de la respuesta vacía: `page?.data?.repository?.issues?.nodes` con
  guarda `Array.isArray`, porque el envoltorio exacto de una respuesta sin issues
  (`[]` vs `[{data:{…nodes:[]}}]` vs `[{}]`) depende de `gh` y se confirma con una
  comprobación manual contra un repo real (§ plan, Slice 1 / verificación).

- `ct-groom.mjs` llama a `gh api graphql --paginate --slurp` con esa query y pasa
  el resultado por `normalizeGraphqlIssues` (+ `realIssuesOnly` de red).

### 5.1 El buffer: claim de medida, no juicio filosófico

«No se sube `maxBuffer`» es un **claim de medida**, no una postura: el fix baja el
payload (fuera los PRs y los campos REST no usados), así que 20 MiB, que antes se
quedaba corto con issues+PRs, ahora sobra para el mismo repo. `GH_MAX_BUFFER` es
un **límite de seguridad** compartido por todas las llamadas `gh()`, no una
feature. El riesgo de desborde no desaparece: se **mueve** de «PRs + bodies de
issues» a «bodies de issues solos a gran escala». Si algún día los bodies
legítimos de los issues de un repo superan 20 MiB, eso es un problema de diseño
aparte (paginar y procesar por páginas sin acumular), no algo que se tape subiendo
el número. El comentario del código debe decir esto explícitamente, no dejar al
implementador adivinando la intención.

### 5.2 Dependencia: versión de `gh`

`gh api graphql --paginate` con paginación por cursor requiere un `gh`
razonablemente reciente (≥ 2.30). El repo ya exige `gh` autenticado; esto entra en
la misma categoría que el chequeo de versión de Node de `ct-init.sh`. Se documenta
como dependencia; un `gh` demasiado viejo haría `--paginate` un no-op silencioso
(otra cara del mismo fallo de «solo la primera página»).

## 6. Lo que esta ronda NO hace

- **No toca `loop-issues.js` (`/ct-next`) ni `ct-status.mjs`**, que tienen el
  mismo patrón de slurp y chocarán igual en repos grandes. Se deja como
  follow-up explícito: el mismo `GROOM_ISSUES_QUERY`/normalizador es reutilizable,
  pero `loop-issues` separa open/closed y merece su propia ronda.
- **No sube el buffer** ni cambia ninguna de las cinco garantías.

## 7. Versión

Patch: bugfix de disponibilidad, sin cambio de contrato observable (mismo output
del groom; solo deja de morir en repos grandes).
