# `/ct-groom` issues-only vía GraphQL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `/ct-groom` deje de morir con `ENOBUFS` en repos grandes, listando los issues por GraphQL (solo issues, solo los campos que se usan) en vez del REST que arrastraba todos los PRs. Comportamiento idéntico; solo baja el payload.

**Architecture:** el listado que alimenta idempotencia + huérfanos + Puertas A/B pasa de `gh api repos/<repo>/issues -f state=all --paginate --slurp` (REST, incluye PRs) a la conexión `issues` de GraphQL (nunca PRs). La traducción a la forma REST que el resto del pipeline ya espera vive en una función PURA (`normalizeGraphqlIssues`, en `gh-issues.js`), testeable sin red. `ct-groom.mjs` solo cambia la llamada y el normalizado. El `fake-gh` de los tests gana una rama `graphql` que traduce la misma `FAKE_GH_LIST_SEQUENCE`, filtrando los PRs.

**Tech Stack:** Node ESM, Vitest. Tests puros por import directo; los E2E spawnean `ct-groom.mjs` contra el `fake-gh`.

**Spec:** `docs/superpowers/specs/2026-08-27-ct-groom-issues-only-graphql-design.md`

**Ficheros:** modifica `scripts/gh-issues.js`, `scripts/ct-groom.mjs`, `__tests__/fixtures/fake-gh-bin/gh`, `__tests__/gh-issues.test.js`.

## Global Constraints

- **Comportamiento idéntico**: el conjunto de issues que ve el groom (y por tanto idempotencia, reconciliación, huérfanos y Puertas A/B) no cambia. Solo desaparece el peso muerto (PRs + campos REST no usados).
- **No se sube `maxBuffer`.** El fix baja el payload, no el techo.
- **Campos que el pipeline consume** (contrato del normalizador): `number`, `title`, `body`, `state` en minúsculas, `milestone.title` (o null), `labels` como `[{name}]`.

## Los slices

Tres slices; el 2 y el 3 aterrizan juntos para dejar los E2E en verde (el 3 sirve la nueva llamada en el `fake-gh`, sin la cual los E2E del 2 no pasan).

- **Slice 1 — el lector puro** (`gh-issues.js`): `GROOM_ISSUES_QUERY` + `normalizeGraphqlIssues`. Sin red, sin tocar `ct-groom`. Aislado y testeable.
- **Slice 2 — cablear `ct-groom`**: REST → `gh api graphql`, normalizado, comentario del `maxBuffer`.
- **Slice 3 — `fake-gh` + regresión E2E**: rama `graphql` en el stub que traduce `FAKE_GH_LIST_SEQUENCE` (filtrando PRs) y deja `ct-groom-dryrun`/`ct-groom-reconcile` en verde.

---

## Task 1: `GROOM_ISSUES_QUERY` + `normalizeGraphqlIssues` (gh-issues.js)

**Files:**
- Modify: `scripts/gh-issues.js` (tras `realIssuesOnly`)
- Test: `__tests__/gh-issues.test.js` (añadir)

- [ ] **Step 1: Write the failing test** — un `--paginate --slurp` de GraphQL es un array de páginas `{data:{repository:{issues:{nodes:[…]}}}}`. Afirmar: aplana páginas, baja `state` a minúsculas, `labels.nodes`→`[{name}]`, `milestone`→`{title}|null`; y defensivo (`[]`, sin nodes, `null` → `[]`).
- [ ] **Step 2: Run test to verify it fails** — `normalizeGraphqlIssues is not a function`.
- [ ] **Step 3: Implement** — `GROOM_ISSUES_QUERY` (query con `states:[OPEN,CLOSED]`, campos mínimos, `pageInfo`+`$endCursor`) y `normalizeGraphqlIssues(pages)` puro.
- [ ] **Step 4: Run test to verify it passes.**
- [ ] **Step 5: Commit** — `feat: GROOM_ISSUES_QUERY + normalizeGraphqlIssues (listado de issues sin PRs)`.

## Task 2: cablear `ct-groom.mjs` a GraphQL

**Files:**
- Modify: `scripts/ct-groom.mjs` (import de `gh-issues.js`; llamada ~925; comentario del `maxBuffer` ~702)

- [ ] **Step 1:** añadir `GROOM_ISSUES_QUERY, normalizeGraphqlIssues` al import; quitar `flattenIssuePages` si queda sin uso.
- [ ] **Step 2:** sustituir la llamada REST por `gh api graphql --paginate --slurp -f query=… -f owner=… -f name=…` + `realIssuesOnly(normalizeGraphqlIssues(pages))`.
- [ ] **Step 3:** actualizar el comentario del `maxBuffer` (ya no describe issues+PRs con body completo).
- [ ] **Step 4: Commit** — `fix: ct-groom lista issues por GraphQL (evita ENOBUFS en repos grandes)`.

## Task 3: `fake-gh` graphql + regresión E2E

**Files:**
- Modify: `__tests__/fixtures/fake-gh-bin/gh` (rama nueva para `api graphql`)

- [ ] **Step 1:** añadir una rama `if (argv[0] === 'api' && argv[1] === 'graphql')` que lea `FAKE_GH_LIST_SEQUENCE` (misma secuenciación por contador que la rama REST `issues`), **filtre los items con `pull_request`**, y los emita en forma GraphQL slurp (`[{data:{repository:{issues:{nodes:[…]}}}}]`), mapeando cada issue REST a nodo GraphQL (`state` a mayúsculas, `labels`→`{nodes:[{name}]}`, `milestone`→`{title}`).
- [ ] **Step 2:** correr `ct-groom-dryrun` y `ct-groom-reconcile`; ajustar solo lo que rompa por la forma de la respuesta (no por comportamiento).
- [ ] **Step 3: Commit** — `test: fake-gh sirve el listado de issues por graphql`.

## Task 4: Verificación final

- [ ] **Step 1:** `npm test` — suite completa en verde (salvo el rojo preexistente de `ct-init > SLICES_PRISTINE_HASHES`, ajeno).
- [ ] **Step 2 (opcional, humano):** validación manual contra `mo.picking.api` — `node scripts/ct-groom.mjs <spec> --repo mercadona/mo-picking-api --milestone <epic> --dry-run` ya no aborta en el listado.
- [ ] **Step 3:** bump de versión patch en `package.json` + `.claude-plugin/plugin.json` + `README.md` (el test de manifest exige package.json == plugin.json).

## Follow-up (fuera de esta ronda, ver spec §6)

`loop-issues.js` (`/ct-next`) y `ct-status.mjs` tienen el mismo patrón de slurp y chocarán igual en repos grandes. El `GROOM_ISSUES_QUERY`/normalizador es reutilizable; se aborda en ronda aparte porque `loop-issues` separa open/closed.
