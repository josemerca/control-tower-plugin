# #5 — UI: shell y pulso contra la API del #4

> **This plan is written to be executed by task-scoped subagents with zero context and no
> authority to decide.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it must honour and the exact commands that verify it — not the
> bodies: those you write test-first. Do not improvise on names, signatures, constants or test
> names: they are decided here. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

`web/` es hoy el esqueleto del #1: `web/src/App.tsx` renderiza `<h1>Repo Pulse</h1>`,
`web/src/App.test.tsx` comprueba que el export es una función, `web/vite.config.ts` solo trae
el plugin de React y no hay entorno DOM de test ni proxy hacia el server. El #4 ya sirve
`GET /api/repos` y `GET /api/repos/:id/summary?window=` en `127.0.0.1:3000`. Este slice monta
el shell de React contra esos dos endpoints: cabecera (selector de repo + ventana), bloque
Pulso con overlay del periodo anterior y panel Tendencia + KPIs, con los textos y la
composición de `docs/design/repo-pulse-mockup.html`.

### Desired end state

- Cambiar la ventana en la cabecera repinta Pulso, Tendencia y KPIs sin recargar la página.
- Con ventana `all` el panel de Tendencia declara «ventana completa: no hay comparable».
- La cabecera enseña el último commit y la fecha de traída del clon cuando existen.
- `web/` tiene entorno DOM de test (jsdom + Testing Library) y proxy de `/api` en dev.

### Out of scope

🚫 Los chips «estado de demo» de la maqueta no se implementan. Tampoco los bloques Gente y
Calor (#6) ni las pantallas de estado no feliz — carga diseñada, ventana vacía con CTA,
no-repo, sin commits, banner de desactualizado (#7): mientras no hay datos el cuerpo es un
`Cargando…` mínimo y un error es una línea con su `code`, que el #7 sustituye. Ni el botón
«Traer cambios», ni `GET /heat`, ni `PUT /settings`.

## 2. Closed decisions (do NOT reopen)

| Decision | Value |
|---|---|
| Dev → API | `server.proxy` de `/api` a `http://127.0.0.1:3000` en `web/vite.config.ts`; sin CORS en el server (AGENTS.md, «Decisiones abiertas entre workspaces») |
| Frontera de tipos | `web/` NO importa de `server/`: los tipos del payload se declaran en `web/src/api/types.ts` |
| Entorno de test | Vitest con `environment: 'jsdom'` + `@testing-library/react`; `fetch` se dobla con `vi.stubGlobal`, sin MSW y sin `user-event` (`fireEvent` cubre clic y `change`) |
| Ventana por defecto | `DEFAULT_WINDOW = '12m'`; el selector manda `?window=` siempre |
| Errores | Se distinguen por `code` del sobre `{error:{code,message}}`, nunca por status ni por `message`; un cuerpo que no es el sobre es `internal` |
| Carreras | Un `AbortController` por efecto de summary; la limpieza aborta y el resultado se descarta si `signal.aborted` |
| Fechas | Se formatean con `Intl.DateTimeFormat('es-ES')` y `timeZone: 'UTC'`, como los ISO del server |
| Design system | `web/src/tokens.css` con los tokens de la maqueta, importado en `main.tsx`; los estilos van inline con `var(--…)` — ningún hex nuevo, ningún token de marca cambiado |
| Tipografía | Stack `"Source Serif 4", system-ui, sans-serif` sin `@font-face`: en el repo no hay ficheros de fuente y el server no sale a la red |

## 3. Reference patterns

`server/src/analysis/types.ts` (contratos con JSDoc que explica la decisión, todo en inglés) y
`server/src/api/routes.test.ts` (tests planos con `test(...)`, sin `describe`, imports
explícitos de `vitest`). La composición, los textos y los colores salen de
`docs/design/repo-pulse-mockup.html`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `web/package.json` | modify | Task 1 | prose (config) |
| `web/vite.config.ts` | modify | Task 1 | prose (config) |
| `web/src/testing/setup.ts` | create | Task 1 | prose (config) |
| `web/src/App.test.tsx` | modify | Tasks 1, 5, 6, 7 | Current state |
| `web/src/api/types.ts` | create | Tasks 2, 3, 5, 6, 7 | Contract |
| `web/src/api/client.ts` | create | Task 5 | Contract |
| `web/src/format.ts` | create | Tasks 5, 6, 7 | Contract |
| `web/src/format.test.ts` | create | Task 3 | none (body by TDD) |
| `web/src/tokens.css` | create | Task 4 | Contract |
| `web/src/main.tsx` | modify | Task 4 | Call site |
| `web/src/Header.tsx` | create | Task 5 | Contract |
| `web/src/App.tsx` | modify | Tasks 5, 6, 7 | Current state / Call site |
| `web/src/pulse-points.ts` | create | Task 6 | Contract |
| `web/src/pulse-points.test.ts` | create | Task 6 | none (body by TDD) |
| `web/src/Pulse.tsx` | create | Task 6 | Contract |
| `web/src/TrendPanel.tsx` | create | Task 7 | Contract |
| `AGENTS.md` | modify | Task 8 | Current state / Final text |

## 5. Interfaces

Consumes (del #4, ya en `main`, por HTTP — no por import): `GET /api/repos` →
`{ repos: Clone[] }` con `Clone = { id, name, path, lastCommitAt, fetchedAt, stale }`;
`GET /api/repos/:id/summary?window=` → el `Analysis` plano más `meta`
(`window`, `bucket`, `from`, `to`, `headSha`, `buckets`, `previousWindowBuckets`, `trend`,
`kpis`, `concentration`, `meta`); ventanas `'30d' | '90d' | '12m' | 'all'` con default `'12m'`;
todo fallo llega como `{ error: { code, message } }`.

Produces (para el #6 y el #7):
`web/src/api/types.ts` — `TimeWindow`, `BucketSize`, `ApiErrorCode`, `NotComparableReason`,
`Clone`, `Bucket`, `Trend`, `Kpis`, `Concentration`, `SummaryMeta`, `Summary`, `WINDOWS`,
`DEFAULT_WINDOW`.
`web/src/api/client.ts` — `ApiError`, `fetchRepos(signal?)`, `fetchSummary(id, window, signal?)`.
`web/src/format.ts` — `windowLabel`, `previousWindowLabel`, `bucketNoun`, `formatDay`,
`formatMonth`, `formatEdge`, `relativeDays`, `trendHeadline`, `trendArrow`, `trendSentence`.
`web/src/pulse-points.ts` — `PULSE_WIDTH`, `PULSE_BASELINE`, `PULSE_HEADROOM`, `seriesMax`,
`polylinePoints`, `areaPoints`.
Componentes por defecto: `Header(HeaderProps)`, `Pulse(PulseProps)`, `TrendPanel(TrendPanelProps)`.

## 6. Test strategy

Vitest en jsdom desde la raíz (`npm test`, o `npm test -w web` durante el bucle rojo-verde).
Los módulos puros (`format.ts`, `pulse-points.ts`) se prueban directos. Los componentes se
prueban montando `App` con `@testing-library/react` y `fetch` doblado con `vi.stubGlobal`, que
devuelve los payloads del #4 como objetos literales — nunca contra un server de verdad. La
Task 4 (tokens de marca) no lleva tests: jsdom no computa una hoja de estilos externa y el
commit no añade comportamiento; su prueba es el gate humano `visual`.

## 7. Tasks

### Task 1 — el entorno de test DOM y el proxy de dev

**Objective:** `web/` monta React en jsdom bajo Vitest, y en dev sus `fetch('/api/…')` llegan al server del #4.

**Files:** `web/package.json` (modify), `web/vite.config.ts` (modify), `web/src/testing/setup.ts` (create), `web/src/App.test.tsx` (modify)

Configuración, en prosa:

- `web/package.json`: a `devDependencies` entran `jsdom` `^30.0.1`, `@testing-library/react`
  `^16.3.2` y `@testing-library/dom` `^10.4.1` (peer de la anterior). `npm install` desde la
  raíz actualiza `package-lock.json`, que va en el commit.
- `web/vite.config.ts`: `defineConfig` pasa a importarse de `vitest/config` (es lo que tipa el
  campo `test`); se añade `server: { proxy: { '/api': 'http://127.0.0.1:3000' } }` y
  `test: { environment: 'jsdom', setupFiles: ['./src/testing/setup.ts'] }`. El plugin de React
  se queda como está.
- `web/src/testing/setup.ts`: registra un `afterEach` (importado de `vitest`) que llama a
  `cleanup()` de `@testing-library/react` y a `vi.unstubAllGlobals()`. Hace falta porque
  Vitest corre con `globals: false` y entonces Testing Library no engancha su limpieza sola.

Current state (web/src/App.test.tsx, lines 4-6):

```tsx
test('App exporta un componente de React', () => {
  expect(typeof App).toBe('function')
})
```

**TDD:** `test('renders the app title in a DOM')` — `render(<App />)` y
`expect(screen.getByRole('heading', { name: 'Repo Pulse' })).toBeTruthy()`. En rojo hoy: sin
`environment: 'jsdom'` el render revienta porque no existe `document`.

**Tests:** añade `'renders the app title in a DOM'`; retira a propósito
`'App exporta un componente de React'` — comprobaba el tipo del export, no el DOM, y su nombre
estaba en español (regla boy scout de AGENTS.md).

**Verification:** `npm install` y después:

```bash
npm test -w web   # exit 0, 1 test
npm run build && npm run lint   # exit 0
```

### Task 2 — el cliente tipado de la API

**Objective:** `web/` habla con los dos endpoints del #4 y convierte el sobre de error en un error tipado por `code`.

**Files:** `web/src/api/types.ts` (create), `web/src/api/client.ts` (create), `web/src/api/client.test.ts` (create)

Contract (web/src/api/types.ts):

```ts
export type TimeWindow = '30d' | '90d' | '12m' | 'all'
export type BucketSize = 'day' | 'week' | 'month'
export type ApiErrorCode = 'unknown-repo' | 'not-a-git-repo' | 'invalid-window' | 'invalid-body' | 'not-found' | 'git-failed' | 'internal'
export type NotComparableReason = 'full-window' | 'no-previous-commits'
export interface Clone { id: string; name: string; path: string; lastCommitAt: string | null; fetchedAt: string | null; stale: boolean }
export interface Bucket { start: string; commits: number; authors: number }
export interface Trend { comparable: boolean; percentage: number | null; previousWindowCommits: number | null; reason: NotComparableReason | null }
export interface Kpis { commits: number; activeAuthors: number; filesTouched: number }
export interface Concentration { authors: number; percentage: number }
export interface SummaryMeta { lastCommitAt: string | null; fetchedAt: string | null; stale: boolean }
export interface Summary { window: TimeWindow; bucket: BucketSize; from: string | null; to: string; headSha: string | null; buckets: Bucket[]; previousWindowBuckets: number[] | null; trend: Trend; kpis: Kpis; concentration: Concentration; meta: SummaryMeta }
export const WINDOWS: readonly TimeWindow[]
export const DEFAULT_WINDOW: TimeWindow
```

Contract (web/src/api/client.ts):

```ts
export class ApiError extends Error {
  readonly code: ApiErrorCode
  constructor(code: ApiErrorCode, message: string)
}
export function fetchRepos(signal?: AbortSignal): Promise<Clone[]>
export function fetchSummary(id: string, window: TimeWindow, signal?: AbortSignal): Promise<Summary>
```

`WINDOWS` es `['30d', '90d', '12m', 'all']` y `DEFAULT_WINDOW` es `'12m'`. Las URLs son
`/api/repos` y `` `/api/repos/${encodeURIComponent(id)}/summary?window=${window}` `` — relativas,
que es lo que el proxy de la Task 1 encamina. Una respuesta que no es `ok` se lee como
`{ error: { code, message } }` y se lanza como `ApiError`; si el cuerpo no tiene esa forma, o
la petición falla antes de llegar, el `code` es `'internal'`. El status no se mira nunca.

**TDD:** `test('surfaces the code of the error envelope')` — `fetch` doblado devolviendo 400 con
`{ error: { code: 'invalid-window', message: 'x' } }`; `fetchSummary('r', '30d')` rechaza con un
`ApiError` cuyo `code` es `'invalid-window'`. El borde que pincha: con un cuerpo que no es el
sobre y el mismo 400, el `code` es `'internal'`.

**Tests:** `'lists the clones'`, `'asks the summary for the window it is given'` (la URL lleva
`window=all`), `'surfaces the code of the error envelope'`, `'a body that is not the envelope is internal'`.

**Verification:** `npm test -w web` → exit 0. `npm run build && npm run lint` → exit 0.

```bash
npm test -w web   # exit 0
npm run build && npm run lint   # exit 0
```

### Task 3 — la capa de textos en español

**Objective:** un módulo puro traduce los valores del payload a los textos exactos de la maqueta.

**Files:** `web/src/format.ts` (create), `web/src/format.test.ts` (create)

Contract (web/src/format.ts):

```ts
export function windowLabel(window: TimeWindow): string
export function previousWindowLabel(window: TimeWindow): string
export function bucketNoun(bucket: BucketSize): string
export function formatDay(iso: string): string
export function formatMonth(iso: string): string
export function formatEdge(iso: string | null, window: TimeWindow): string
export function relativeDays(iso: string, now: Date): string
export function trendHeadline(trend: Trend): string
export function trendArrow(trend: Trend): string
export function trendSentence(trend: Trend, commits: number): string
```

Los textos, que son decisión y no deducción (salen de la maqueta):

- `windowLabel`: `'30 días'`, `'90 días'`, `'12 meses'`, `'todo'`.
- `previousWindowLabel`: `'los 30 días anteriores'`, `'los 90 días anteriores'`,
  `'los 12 meses anteriores'` y `'—'` en `all`.
- `bucketNoun`: `'día'`, `'semana'`, `'mes'`.
- `formatDay` = `Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })` → `'13 ago 2026'`;
  `formatMonth` = el mismo sin `day` → `'ago 2026'`.
- `formatEdge`: `null` → `'—'`; `'30d'` y `'90d'` → `formatDay`; `'12m'` y `'all'` → `formatMonth`.
- `relativeDays`: `'hoy'` por debajo de un día, `'hace 1 día'`, y `` `hace ${n} días` ``.
- `trendHeadline`: `'—'` si `comparable` es `false`; si no, el `percentage` con signo explícito
  cuando es positivo (`'+18%'`, `'0%'`, `'-7%'`).
- `trendArrow`: `''` si no es comparable, `'↗'` con `percentage` ≥ 0 y `'↘'` por debajo.
- `trendSentence`: comparable → `` `${previousWindowCommits} commits antes · ${commits} ahora` ``;
  `reason: 'full-window'` → `'ventana completa: no hay comparable'`; `reason: 'no-previous-commits'`
  → `` `0 commits antes · ${commits} ahora — nada que comparar` ``.

**TDD:** `test('the full window declares there is nothing to compare')` —
`trendSentence({ comparable: false, percentage: null, previousWindowCommits: null, reason: 'full-window' }, 0)`
es exactamente `'ventana completa: no hay comparable'`, y con `reason: 'no-previous-commits'` es
la otra frase: son los dos únicos motivos y no dicen lo mismo.

**Tests:** `'the full window declares there is nothing to compare'`,
`'a comparable trend reads previous versus current commits'`,
`'the trend headline only signs the positive'`,
`'window edges are formatted by window, in UTC'` (un ISO de las 23:30 Z no salta de día),
`'a day ago reads hace 1 día'`.

**Verification:** `npm test -w web` → exit 0. `npm run build && npm run lint` → exit 0.

```bash
npm test -w web   # exit 0
npm run build && npm run lint   # exit 0
```

### Task 4 — los tokens del design system

**Objective:** la página toma el fondo, la tinta y la tipografía de la maqueta, sin inventar ningún color.

**Files:** `web/src/tokens.css` (create), `web/src/main.tsx` (modify)

Contract (web/src/tokens.css):

```css
:root {
  --color-bg: #f3f2f2;
  --color-surface: #eae9e9;
  --color-text: #201e1d;
  --color-accent: #0088b0;
  --color-accent-2: #d6006c;
  --color-divider: color-mix(in srgb, #201e1d 16%, transparent);
  --color-neutral-200: #eae7e7;
  --color-neutral-300: #d7d3d3;
  --color-neutral-400: #bab6b6;
  --color-neutral-600: #7d7979;
  --color-neutral-800: #444141;
  --color-accent-200: #cbeeff;
  --color-accent-700: #006786;
  --color-accent-2-700: #aa0b56;
  --font-heading: "Source Serif 4", system-ui, sans-serif;
  --font-heading-weight: 600;
  --font-body: "Source Serif 4", system-ui, sans-serif;
}
```

Esos valores son los de la maqueta: se copian, no se retocan. Debajo del bloque van las reglas
base, también de la maqueta: `*, *::before, *::after { box-sizing: border-box }`;
`html, body` con `margin: 0`, `background: var(--color-bg)`, `color: var(--color-text)`,
`font-family: var(--font-body)`, `font-size: 15px` y `line-height: 1.55`;
`button { font-family: inherit; cursor: pointer }` y `select { font-family: inherit }`.
De aquí en adelante ningún componente escribe un hex: todos usan `var(--…)`.

Call site (web/src/main.tsx):

```tsx
import App from './App'
import './tokens.css'
```

**TDD:** No TDD — son los tokens de marca y una hoja de estilos: jsdom no computa CSS externo,
así que no hay comportamiento que poner en rojo. Lo prueba el gate humano `visual`.

**Tests:** N/A — el commit no añade comportamiento; la suite existente debe seguir verde.

**Verification:** `npm run build -w web` → exit 0 (Vite resuelve el import de CSS).
`npm test && npm run lint` → exit 0.

```bash
npm run build -w web   # exit 0
npm test && npm run lint   # exit 0
```

### Task 5 — la cabecera y el estado del shell

**Objective:** el shell carga clones y summary, y la cabecera enseña repo, ventana, último commit y fecha de traída.

**Files:** `web/src/Header.tsx` (create), `web/src/App.tsx` (modify), `web/src/App.test.tsx` (modify)

Current state (web/src/App.tsx, lines 1-3):

```tsx
export default function App() {
  return <h1>Repo Pulse</h1>
}
```

Contract (web/src/Header.tsx):

```tsx
export interface HeaderProps {
  repos: readonly Clone[]
  repoId: string
  onRepo: (id: string) => void
  window: TimeWindow
  onWindow: (window: TimeWindow) => void
  meta: SummaryMeta | null
  now: Date
}
export default function Header(props: HeaderProps)
```

El estado vive en `App`: `repos`, `repoId`, `window` (arranca en `DEFAULT_WINDOW`), `summary` y
`error`. Un efecto llama a `fetchRepos()` al montar y selecciona el primer clon; otro llama a
`fetchSummary(repoId, window)` cada vez que cambian `repoId` o `window`, con el
`AbortController` de la tabla §2. Sin `summary` el cuerpo es `<p>Cargando…</p>`; con `error`,
`<p role="alert">No se ha podido cargar la información ({code}).</p>` — los dos los sustituye el #7.

La cabecera, según la maqueta: un `<select aria-label="Repositorio">` con una `<option>` por
clon (`value` = `id`, texto = `name`) y al lado el `path` del seleccionado; una fila de
`<button>` por ventana con `windowLabel` y `aria-current` en la activa; la línea
`último commit <strong>{relativeDays(meta.lastCommitAt, now)}</strong> · {formatDay(meta.lastCommitAt)}`,
omitida entera si `lastCommitAt` es `null`; y la nota `Foto local al día · traída {relativeDays(meta.fetchedAt, now)}`
(`Foto local traída …` si `meta.stale`), omitida entera si `fetchedAt` es `null`.

**TDD:** `test('the header shows the last commit and the fetch date')` — con `fetch` doblado,
`(await screen.findByText(/último commit/)).textContent` contiene la fecha formateada del
`lastCommitAt` del payload, y `await screen.findByText(/traída/)` encuentra la nota. El borde:
con `lastCommitAt` y `fetchedAt` a `null` ninguno de los dos textos existe.

**Tests:** añade `'the header shows the last commit and the fetch date'`,
`'without dates the header shows neither'` y `'changing the window asks the API for that window'`
(clic en «todo» → la última URL pedida lleva `window=all`); retira `'renders the app title in a DOM'`,
que apuntaba al stub del #1.

**Verification:** `npm test -w web` → exit 0. `npm run build && npm run lint` → exit 0.

```bash
npm test -w web   # exit 0
npm run build && npm run lint   # exit 0
```

### Task 6 — el bloque Pulso con el overlay del periodo anterior

**Objective:** el Pulso dibuja los commits por cubo con la ventana anterior en gris detrás, a la misma escala.

**Files:** `web/src/pulse-points.ts` (create), `web/src/pulse-points.test.ts` (create), `web/src/Pulse.tsx` (create), `web/src/App.tsx` (modify), `web/src/App.test.tsx` (modify)

Contract (web/src/pulse-points.ts):

```ts
export const PULSE_WIDTH = 600
export const PULSE_BASELINE = 199
export const PULSE_HEADROOM = 6
export function seriesMax(...series: readonly (readonly number[])[]): number
export function polylinePoints(values: readonly number[], max: number): string
export function areaPoints(points: string): string
```

Contract (web/src/Pulse.tsx):

```tsx
export interface PulseProps { summary: Summary }
export default function Pulse(props: PulseProps)
```

La aritmética, que es la de la maqueta: `seriesMax` es `Math.max(1, ...)` sobre todas las
series juntas — las dos comparten escala, que es lo que hace legible el overlay. En
`polylinePoints`, `x = values.length === 1 ? 0 : (i / (values.length - 1)) * PULSE_WIDTH` e
`y = PULSE_BASELINE - (v / max) * (PULSE_BASELINE - PULSE_HEADROOM)`, cada número con
`toFixed(1)`, los pares unidos por espacio y `''` para una serie vacía. `areaPoints(points)` es
`` `0,199 ${points} 600,199` ``.

El SVG: `viewBox="0 0 600 200"`, `preserveAspectRatio="none"`, `role="img"`,
`aria-label="Pulso"`, ancho `100%` y alto `250px`. Se pinta, en orden, la polilínea del periodo
anterior (`var(--color-neutral-400)`, grosor 2, `data-testid="pulse-previous"`, solo si
`previousWindowBuckets` no es `null`), el polígono de área (`var(--color-accent-200)`), la
polilínea actual (`var(--color-accent)`, grosor 2.5, `data-testid="pulse-current"`) y la línea
base; todas con `vector-effect="non-scaling-stroke"`. Encabezan el bloque «Pulso», «¿está vivo?
¿va a más o a menos?» y, a la derecha, `commits por {bucketNoun(bucket)}` más
`` ` · gris = ${previousWindowLabel(window)}` `` solo cuando hay overlay. Al pie,
`formatEdge(from, window)`, `` `${buckets.length} cubos` `` y `formatEdge(to, window)`.

**TDD:** `test('both series share one scale')` — `seriesMax([1, 2], [4])` es `4`, y
`polylinePoints([4], 4)` es `'0.0,6.0'`: el valor máximo toca el techo y no el borde. El borde
que pincha la escala compartida: `polylinePoints([2], seriesMax([2], [4]))` NO es `'0.0,6.0'`.

**Tests:** `'both series share one scale'`, `'a zero series sits on the baseline'`
(`polylinePoints([0, 0], 1)` es `'0.0,199.0 600.0,199.0'`), `'the area closes on the baseline'`,
y en `App.test.tsx`: `'the pulse draws the previous window behind the current one'` y
`'on the full window there is no overlay'` (no hay `pulse-previous`).

**Verification:** `npm test -w web` → exit 0. `npm run build && npm run lint` → exit 0.

```bash
npm test -w web   # exit 0
npm run build && npm run lint   # exit 0
```

### Task 7 — el panel de Tendencia y KPIs

**Objective:** el panel derecho enseña la tendencia y los tres KPIs, y todo el shell se recalcula al cambiar la ventana.

**Files:** `web/src/TrendPanel.tsx` (create), `web/src/App.tsx` (modify), `web/src/App.test.tsx` (modify)

Contract (web/src/TrendPanel.tsx):

```tsx
export interface TrendPanelProps { window: TimeWindow; trend: Trend; kpis: Kpis }
export default function TrendPanel(props: TrendPanelProps)
```

Call site (web/src/App.tsx):

```tsx
<div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 440px', gap: 64, alignItems: 'start' }}>
  <Pulse summary={summary} />
  <TrendPanel window={window} trend={summary.trend} kpis={summary.kpis} />
</div>
```

El panel, según la maqueta: el rótulo en versalitas `tendencia vs {previousWindowLabel(window)}`;
el número grande `trendHeadline(trend)` con `trendArrow(trend)` al lado, en
`var(--color-accent-700)` si `percentage` es ≥ 0, `var(--color-accent-2-700)` si es negativo y
`var(--color-neutral-600)` si no es comparable; debajo, `trendSentence(trend, kpis.commits)`; y
los tres KPIs en fila — `kpis.commits` con «commits», `kpis.activeAuthors` con «autores
activos» y `kpis.filesTouched` con «ficheros tocados». La columna de la derecha queda con hueco
para el bloque Calor del #6.

**TDD:** `test('the full window declares there is nothing to compare')` — montado `App` y hecho
clic en «todo», `await screen.findByText('ventana completa: no hay comparable')` y el número
grande es `'—'`. Es el AC 2, ahora en el DOM.

**Tests:** añade `'the full window declares there is nothing to compare'` y
`'changing the window recomputes pulse, trend and KPIs'` — con dos payloads distintos para
`12m` y `30d`, tras el clic en «30 días» cambian a la vez el atributo `points` de
`pulse-current`, el texto de `trendHeadline` y el KPI de commits, y el nodo del `<select>` de
repo sigue siendo el mismo (no hubo recarga). Es el AC 1.

**Verification:** `npm test -w web` → exit 0. `npm run build && npm run lint` → exit 0.

```bash
npm test -w web   # exit 0
npm run build && npm run lint   # exit 0
```

### Task 8 — AGENTS.md: las dos decisiones abiertas, cerradas

**Objective:** la guía durable deja de anunciar como abiertas dos decisiones que este slice ya cerró.

**Files:** `AGENTS.md` (modify)

Current state (AGENTS.md, lines 93-103):

```md
## Decisiones abiertas entre workspaces (con dueño)
Las creó el esqueleto (#1) y no las cubre el criterio de aceptación de ningún
slice; el dueño las resuelve cuando le toque, en vez de descubrirlas:
- **Cómo llega `web/` al server en dev** — no hay `server.proxy` en
  `web/vite.config.ts` ni CORS en el server, así que hoy un `fetch('/api/…')`
  desde el dev server no llega. Dueño: el primer slice de UI que consuma la
  API. Salida esperada: proxy de `/api` en Vite (no CORS en el server).
- **Frontera `web/` → `server/`** — nada lo impide técnicamente. Regla: `web/`
  NO importa de `server/`; si necesita los tipos del payload, los declara en
  `web/`. Va con lo de arriba: un tipo del server puede arrastrar campos de
  autor hasta el DOM. Dueño: el primer slice de UI.
```

Final text (AGENTS.md):

```md
## Frontera `web/` ↔ `server/`
Las abrió el esqueleto (#1) y las cerró el primer slice de UI (#5):
- **En dev, `web/` llega al server por el proxy** — `web/vite.config.ts` encamina
  `/api` a `http://127.0.0.1:3000`. El server no lleva CORS y no debe llevarlo:
  la foto de los repos locales no sale de `127.0.0.1`.
- **`web/` NO importa de `server/`** — los tipos del payload se declaran en
  `web/src/api/types.ts`. Un tipo importado del server puede arrastrar campos de
  autor hasta el DOM, y eso es justo lo que no puede pasar.
```

**TDD:** No TDD — es documentación: no hay comportamiento que poner en rojo.

**Tests:** N/A — no hay código nuevo; la suite existente debe seguir verde.

**Verification:** `npm test && npm run lint && npm run build` → exit 0, y `AGENTS.md` sigue por
debajo de las 150 líneas que pide su propia cabecera (`wc -l AGENTS.md`).

```bash
npm test && npm run lint && npm run build   # exit 0
test "$(wc -l < AGENTS.md)" -le 150
```

## 8. Global verification

Con las ocho tareas commiteadas, desde la raíz:

```bash
npm run build && npm test && npm run lint   # exit 0
```

La línea base de hoy es 113 tests (112 en `server`, 1 en `web`) y `npm run lint` no imprime
nada. Al cerrar el slice `server` sigue en 112 y `web` sube con los tests de las tareas 1-3 y
5-7. Para el gate humano `visual`: `npm run dev -w server` en una terminal y `npm run dev -w web`
en otra, abrir la URL que imprime Vite, y comprobar las tres cosas — cambiar de ventana repinta
Pulso, Tendencia y KPIs sin recargar; con «todo» el panel dice «ventana completa: no hay
comparable»; y la cabecera enseña el último commit y la fecha de traída.

## 9. Assumptions

1. **Proxy y frontera de tipos** — los cierra AGENTS.md («Decisiones abiertas entre
   workspaces»), que nombra dueño al primer slice de UI y da la salida esperada: proxy en Vite,
   sin CORS, y tipos del payload declarados en `web/`. Provenance: convención del repo.
2. **jsdom + Testing Library, sin `user-event` ni MSW** — los tres AC son clic en un botón,
   `change` en un `<select>` y texto en el DOM; `fireEvent` y `vi.stubGlobal('fetch', …)` los
   cubren sin añadir dos dependencias más. Provenance: propia.
3. **Estados no felices mínimos** — el `Cargando…` y la línea de error existen solo porque el
   componente tiene que renderizar algo antes de los datos; las pantallas diseñadas son el AC
   del #7 y las sustituirán. Provenance: tabla de slices del epic (el #7 las lista).
4. **Fechas en UTC** — el server emite ISO 8601 UTC y sus cubos se cortan en UTC; formatear en
   la zona local desalinearía el pie del Pulso con los cubos y haría los tests dependientes de
   la máquina. Provenance: propia, sobre el contexto del epic.
5. **`relativeDays` con granularidad de día** — la maqueta enseña «hace 20 min» y «hoy, 09:14»
   para la traída, pero la regla de desactualizado del epic es de días y el resto de frases
   también; por debajo de un día se dice «hoy». Provenance: propia.
6. **Tipografía sin `@font-face`** — la maqueta trae «Source Serif 4» empaquetada en woff2; en
   el repo no hay ficheros de fuente y bajarla de un CDN contradice que el server no salga a la
   red, así que queda el stack con `system-ui` de reserva. Provenance: propia, sobre D-11 y la
   nota de red del epic.
7. **`concentration` se declara pero no se pinta** — viene en el payload del #4 y el tipo tiene
   que describirlo entero; quien lo usa es el bloque Gente del #6. Provenance: contexto heredado
   del issue.
8. **Migración** — ninguna: el slice no toca datos persistidos. Forward = mergear; rollback =
   revertir el PR. Sin paso destructivo.
