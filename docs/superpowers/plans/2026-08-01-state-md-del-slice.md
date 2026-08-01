# El estado del slice deja de ser producto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el estado de un slice viva en `.agent/SLICE.md` —ignorado por git, nunca commiteable— y que se refresque en cada turno, de modo que ni contamine `main` ni mienta durante la ejecución.

**Architecture:** Un módulo puro nuevo (`scripts/state-paths.js`) fija los dos paths y la regla de precedencia «si existe `SLICE.md`, ése es el estado». Lo consumen los dos hooks, `ct-next.mjs` y `dispatch-check.mjs`. `ct-next` escribe la regla de ignore en el `info/exclude` del directorio común de git antes de sembrar, siembra en el path nuevo, y **verifica el efecto** con `git status --porcelain` abortando el dispatch si el fichero asoma. `dispatch-check --release` se niega con exit 5 si la rama introduce cualquiera de los dos paths.

**Tech Stack:** Node ≥24, ESM, vitest 4, esbuild (bundlea `hooks/*.js` → `dist/*.js`), bash 3.2 (macOS) para `ct-init.sh`.

**Spec:** `docs/superpowers/specs/2026-08-01-state-md-del-slice-design.md`

## Global Constraints

- **Todo el texto de usuario va en español**, con el registro del resto del plugin: se dice qué pasó, qué NO se ha comprobado, y cuál es el remedio exacto.
- **stdout es el producto; stderr es el diagnóstico** (`aviso:`, `recordatorio:`, `ATENCIÓN:`, y todo aborto). Criterio F16, fijado en `commands/ct-next.md`.
- **Se verifica el EFECTO, nunca el exit code.** Una comprobación que sólo imprime no es una comprobación.
- **Nunca se muta el worktree de un agente vivo.** Ante un worktree del esquema anterior: se avisa, no se migra.
- **`npm test` corre `npm run build` primero**: los hooks se testean desde `dist/`, así que todo cambio en `hooks/` exige rebuild. No editar `dist/` a mano.
- **Node ≥24, ESM.** `scripts/*.js` son módulos importables y testeables sin red; `scripts/*.mjs` son los ejecutables.
- **`ct-init.sh` debe correr en bash 3.2** (el de macOS): sin `declare -A`, sin `${var,,}`, sin arrays asociativos.
- **Orden obligatorio:** la Task 5 (`last_commit` sembrado) **no puede entrar antes que la Task 4**. Sembrar `last_commit` hace que el hook `Stop` obligue al agente a refrescar su estado en cada turno; si el seed todavía escribiera sobre `.agent/STATE.md`, eso multiplicaría la contaminación que este plan viene a eliminar.

---

### Task 1: El módulo de paths y la regla de precedencia

**Files:**
- Create: `scripts/state-paths.js`
- Test: `__tests__/f22-estado-del-slice.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `STATE_REL_PATH: string` (`'.agent/STATE.md'`), `SLICE_REL_PATH: string` (`'.agent/SLICE.md'`), `NEVER_IN_A_SLICE_PR: string[]`, `resolveStatePath(cwd: string) => { path: string|null, kind: 'slice'|'coordinator'|'none' }`.

**Por qué un fichero propio y no `state.js`:** `state.js` ya tiene una constante `STATE_REL_PATH` privada (línea 421), pero pesa 36 KB e importa `yaml`. `dispatch-check.mjs` **no** importa `state.js` hoy (sus imports son `claim.js`, `gh-issues.js`, `argnum.js`); hacerlo sólo por una constante de path le metería `yaml` en el grafo de dependencias sin necesidad. Un módulo sin dependencias que sólo sabe de rutas es el límite correcto.

- [ ] **Step 1: Write the failing test**

Crea `__tests__/f22-estado-del-slice.test.js` con la cabecera de contexto (convención f15…f21) y el primer bloque:

```js
// ============================================================================
// F22 — EL ESTADO DEL SLICE DEJA DE SER PRODUCTO.
//
// El dispatcher sembraba el estado del slice SOBRE `.agent/STATE.md`, que está
// TRACKEADO y es el fichero de la sesión coordinadora. Tres veces en un
// periodo de 9 slices ese fichero entró en un PR; una llegó a `main`, que se
// quedó con `task: <nombre del slice>` y un gate pendiente de un PR ya
// mergeado — cualquier sesión nueva del repo se hidrataba creyendo que era el
// agente de ese slice.
//
// Y el mismo fichero era una foto falsa mientras tanto: 21 horas y 7 commits
// con la semilla intacta (`status: not_started`). La causa NO era que el
// kickoff pidiera actualizarlo al final: el hook `Stop` YA obligaba a
// refrescarlo en cada turno, y estaba desarmado porque la semilla escribía
// `last_commit: ''` — con el campo vacío, `describeStopRelation` devuelve
// `unset` y `classifyStopState` sale en silencio.
//
// Los dos van juntos porque arreglar el segundo empeora el primero: un agente
// obligado a refrescar su estado en cada turno es un agente con más papeletas
// de commitearlo.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STATE_REL_PATH, SLICE_REL_PATH, NEVER_IN_A_SLICE_PR, resolveStatePath } from '../scripts/state-paths.js'

const mkRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-'))
  mkdirSync(join(dir, '.agent'), { recursive: true })
  return dir
}

describe('F22 — precedencia de lectura del estado', () => {
  it('con los DOS ficheros, gana SLICE.md: es el estado del slice, no el de la coordinadora', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    writeFileSync(join(dir, SLICE_REL_PATH), 'slice')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('slice')
    expect(r.path).toBe(join(dir, SLICE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin SLICE.md cae a STATE.md — el checkout de la coordinadora, y los worktrees del esquema anterior', () => {
    const dir = mkRepo()
    writeFileSync(join(dir, STATE_REL_PATH), 'coordinadora')
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('coordinator')
    expect(r.path).toBe(join(dir, STATE_REL_PATH))
    rmSync(dir, { recursive: true, force: true })
  })

  it('sin ninguno de los dos devuelve path null, y no inventa una ruta que no existe', () => {
    const dir = mkRepo()
    const r = resolveStatePath(dir)
    expect(r.kind).toBe('none')
    expect(r.path).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('los paths que un PR de slice no puede introducir son EXACTAMENTE esos dos, no `.agent/` entero', () => {
    expect(NEVER_IN_A_SLICE_PR).toEqual([STATE_REL_PATH, SLICE_REL_PATH])
    expect(NEVER_IN_A_SLICE_PR).not.toContain('.agent/conventions-ack.md')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: FAIL — `Failed to resolve import "../scripts/state-paths.js"`.

- [ ] **Step 3: Write minimal implementation**

Crea `scripts/state-paths.js`:

```js
// ============================================================================
// F22 — DÓNDE VIVE EL ESTADO DE UNA SESIÓN, Y POR QUÉ SON DOS FICHEROS.
//
// El worktree de un slice tiene DOS ficheros de estado:
//
//   .agent/STATE.md  TRACKEADO. El de la sesión coordinadora, tal como venía
//                    en la base desde la que se cortó el worktree. A CERO
//                    DIFF: el dispatcher ya no lo toca.
//   .agent/SLICE.md  IGNORADO. El estado del slice, sembrado por /ct-next.
//
// La precedencia de abajo es carga estructural, no comodidad. Sin ella, un
// agente que se re-hidrata tras un /clear leería el STATE.md trackeado del
// worktree —que no es su semilla sino el estado de la COORDINADORA congelado
// en la base: el epic, no el slice— y se hidrataría creyendo que es la
// coordinadora. Es el mismo defecto que esta ronda arregla, con el vector
// invertido.
//
// Y la presencia del fichero ES la señal de "estoy en un worktree de slice":
// no hace falta una variable de entorno, ni mirar si el cwd cuelga de
// .worktrees/, ni preguntarle a git si esto es un worktree enlazado. Un
// worktree de slice siempre tiene SLICE.md porque lo siembra el dispatcher; el
// checkout de la coordinadora no lo tiene nunca.
//
// MÓDULO PROPIO Y SIN DEPENDENCIAS, a propósito: lo consumen los dos hooks
// (que se bundlean a dist/), ct-next.mjs y dispatch-check.mjs. Este último NO
// importa state.js, y hacerlo sólo por una constante de path le metería `yaml`
// en el grafo de dependencias a cambio de nada.
// ============================================================================
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const STATE_REL_PATH = '.agent/STATE.md'
export const SLICE_REL_PATH = '.agent/SLICE.md'

// Los dos paths que el PR de un slice no puede introducir NUNCA. NO es
// `.agent/` entero: `conventions-ack.md` vive ahí y es un registro de
// decisiones que sí puede cambiar legítimamente dentro de un slice.
export const NEVER_IN_A_SLICE_PR = [STATE_REL_PATH, SLICE_REL_PATH]

/**
 * @param {string} cwd
 * @returns {{ path: string|null, kind: 'slice'|'coordinator'|'none' }}
 */
export function resolveStatePath(cwd) {
  const slice = join(cwd, SLICE_REL_PATH)
  if (existsSync(slice)) return { path: slice, kind: 'slice' }
  const state = join(cwd, STATE_REL_PATH)
  if (existsSync(state)) return { path: state, kind: 'coordinator' }
  return { path: null, kind: 'none' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/state-paths.js __tests__/f22-estado-del-slice.test.js
git commit -m "F22: el estado del slice tiene su propio path, y una regla de precedencia"
```

---

### Task 2: Los dos hooks leen por precedencia

**Files:**
- Modify: `hooks/session-start.js:1-13`
- Modify: `hooks/stop.js:1-13`
- Test: `__tests__/f22-estado-del-slice.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `resolveStatePath` de Task 1.
- Produces: nada nuevo. Los hooks siguen emitiendo el mismo JSON por stdout.

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/f22-estado-del-slice.test.js`. Necesita estos imports adicionales arriba del fichero:

```js
import { execFileSync, spawnSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const stopHook = join(here, '..', 'dist', 'stop.js')
const sessionStartHook = join(here, '..', 'dist', 'session-start.js')

// Un repo git de verdad con un commit: los hooks corren `git rev-parse HEAD` y
// `git log`, así que un directorio pelado no ejercita el camino real.
const mkGitRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f22-git-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '.')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, 'f.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-qm', 'base')
  return dir
}

const runHook = (hookPath, cwd, extra = {}) => {
  const r = spawnSync('node', [hookPath], {
    input: JSON.stringify({ cwd, stop_hook_active: false, ...extra }),
    encoding: 'utf8',
  })
  return r.stdout ? JSON.parse(r.stdout) : null
}
```

Y el bloque:

```js
describe('F22 — los hooks leen por precedencia', () => {
  it('SessionStart se hidrata del SLICE.md cuando existe, no del STATE.md de la coordinadora', () => {
    const dir = mkGitRepo()
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic de la coordinadora\nstatus: in_progress\n---\n# c\n')
    writeFileSync(join(dir, SLICE_REL_PATH), '---\ntask: el slice despachado\nstatus: not_started\n---\n# s\n')
    const out = runHook(sessionStartHook, dir)
    const ctx = out.hookSpecificOutput.additionalContext
    expect(ctx).toContain('el slice despachado')
    expect(ctx).not.toContain('el epic de la coordinadora')
    rmSync(dir, { recursive: true, force: true })
  })

  it('SessionStart cae al STATE.md sin SLICE.md — el checkout de la coordinadora sigue igual que antes', () => {
    const dir = mkGitRepo()
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic de la coordinadora\nstatus: in_progress\n---\n# c\n')
    const out = runHook(sessionStartHook, dir)
    expect(out.hookSpecificOutput.additionalContext).toContain('el epic de la coordinadora')
    rmSync(dir, { recursive: true, force: true })
  })

  it('Stop mide la frescura del SLICE.md, no la del STATE.md de la coordinadora', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const base = git('rev-parse', 'HEAD').trim()
    // El STATE.md de la coordinadora apunta a HEAD: si el hook lo leyera a él,
    // la relación sería `same` y no bloquearía nunca.
    writeFileSync(join(dir, STATE_REL_PATH), `---\ntask: coordinadora\nlast_commit: ${base}\n---\n# c\n`)
    writeFileSync(join(dir, SLICE_REL_PATH), `---\ntask: slice\nlast_commit: ${base}\n---\n# s\n`)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('se ha quedado atrás')
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: FAIL en los tres nuevos — los hooks leen `.agent/STATE.md` incondicionalmente, así que el primero encuentra «el epic de la coordinadora» en el contexto y el tercero no bloquea.

- [ ] **Step 3: Write minimal implementation**

En `hooks/session-start.js`, sustituye las líneas 1-13 por:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { composeHydration } from '../scripts/state.js'
import { resolveStatePath } from '../scripts/state-paths.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
// F22: en el worktree de un slice hay DOS ficheros de estado y sólo uno habla
// de este trabajo. Ver scripts/state-paths.js para por qué la precedencia es
// carga estructural.
const { path: statePath } = resolveStatePath(cwd)

if (statePath) {
  const stateText = readFileSync(statePath, 'utf8')
```

(El resto del fichero, de `let gitLog = ''` en adelante, no cambia. `existsSync` y `join` dejan de usarse: quedan fuera de los imports.)

En `hooks/stop.js`, sustituye las líneas 1-13 por:

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { parseStateSafe, describeStopRelation, classifyStopState } from '../scripts/state.js'
import { resolveStatePath } from '../scripts/state-paths.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
// F22: misma precedencia que en session-start.js. En un worktree de slice esto
// resuelve a .agent/SLICE.md, que es el fichero cuya frescura importa.
const { path: statePath } = resolveStatePath(cwd)

if (!statePath) process.exit(0)
```

(El resto no cambia, salvo que el `readFileSync(statePath, 'utf8')` de más abajo ya apunta al fichero correcto sin tocarlo.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx vitest run __tests__/f22-estado-del-slice.test.js __tests__/stop.test.js __tests__/session-start.test.js __tests__/bundle.test.js`
Expected: PASS. `bundle.test.js` confirma que el bundle sigue importando sólo builtins `node:*`.

- [ ] **Step 5: Commit**

```bash
git add hooks/session-start.js hooks/stop.js __tests__/f22-estado-del-slice.test.js
git commit -m "F22: los hooks leen el estado del slice, no el de la coordinadora"
```

---

### Task 3: `ct-next` hace invisible el fichero antes de sembrarlo

**Files:**
- Modify: `scripts/ct-next.mjs` (import en línea 17-22; función nueva junto a `cleanupOrphanedWorktree`, línea ~2844)
- Test: `__tests__/f22-estado-del-slice.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `SLICE_REL_PATH` de Task 1.
- Produces: `excludeContentWith(current: string, rule: string) => { content: string, added: boolean }` en `scripts/state-paths.js`; `ensureSliceIgnored() => { ok: true, added: boolean, path: string } | { ok: false, why: string }` en `ct-next.mjs`, consumida por Task 4.

**Por qué la lógica de contenido va en un módulo aparte:** `ct-next.mjs` es un ejecutable — importarlo desde un test lo **ejecutaría**. La decisión de «¿ya está la regla? ¿hace falta un salto de línea antes?» es pura y es la parte que puede tener bugs, así que vive en `state-paths.js` y se testea como unidad. En `ct-next.mjs` sólo queda la parte que toca disco y llama a git.

- [ ] **Step 1: Write the failing test**

Añade a `__tests__/f22-estado-del-slice.test.js`. Primero los tests de la unidad pura, que es donde vive la idempotencia:

```js
import { excludeContentWith } from '../scripts/state-paths.js'

describe('F22 — la regla de exclude es idempotente y no corrompe lo que ya hay', () => {
  it('la añade cuando no está', () => {
    const r = excludeContentWith('# comentario\n', '.agent/SLICE.md')
    expect(r.added).toBe(true)
    expect(r.content).toBe('# comentario\n.agent/SLICE.md\n')
  })

  it('NO la duplica en la segunda pasada — dos dispatches dejan una sola línea', () => {
    const once = excludeContentWith('', '.agent/SLICE.md')
    const twice = excludeContentWith(once.content, '.agent/SLICE.md')
    expect(twice.added).toBe(false)
    expect(twice.content).toBe(once.content)
    expect(twice.content.split('\n').filter((l) => l === '.agent/SLICE.md')).toHaveLength(1)
  })

  it('normaliza el salto final: sin él, el append pegaría la regla a la última línea del usuario y corrompería LAS DOS', () => {
    const r = excludeContentWith('*.tmp', '.agent/SLICE.md')
    expect(r.content).toBe('*.tmp\n.agent/SLICE.md\n')
    expect(r.content).not.toContain('*.tmp.agent')
  })

  it('reconoce la regla aunque venga con espacios alrededor', () => {
    expect(excludeContentWith('  .agent/SLICE.md  \n', '.agent/SLICE.md').added).toBe(false)
  })
})
```

Y los de caracterización de git, que fijan la premisa sobre la que se construye todo:

```js
describe('F22 — la regla de ignore va al directorio COMÚN de git', () => {
  it('el info/exclude que ve un worktree es el del checkout principal, no uno propio', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: join(dir, '.worktrees', '1'), encoding: 'utf8',
    }).trim()
    // Devuelve el .git del checkout principal: UNA escritura cubre a la
    // coordinadora y a todos los worktrees, presentes y futuros.
    expect(common).toContain(dir)
    expect(common).not.toContain('.worktrees')
    rmSync(dir, { recursive: true, force: true })
  })

  it('una regla en info/exclude SÍ oculta el fichero nuevo, y sobrevive a git add -A', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    mkdirSync(join(wt, '.agent'), { recursive: true })
    writeFileSync(join(wt, SLICE_REL_PATH), 'estado del slice')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    execFileSync('git', ['add', '-A'], { cwd: wt })
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: FAIL los cuatro de `excludeContentWith` (`does not provide an export named 'excludeContentWith'`). Los dos de caracterización de git PASAN ya: no son código nuestro, confirman la premisa. **Si alguno de esos dos falla, PARA** — la premisa del diseño es falsa en esta versión de git y hay que revisar el spec antes de seguir.

- [ ] **Step 3: Write the pure function**

Añade a `scripts/state-paths.js`:

```js
/**
 * Añade `rule` al contenido de un fichero de exclusión, una sola vez.
 *
 * Idempotente por línea exacta (comparando sin espacios alrededor), mismo
 * criterio que el bloque de `.worktrees/` de ct-init.sh. Y normaliza el salto
 * de línea final ANTES de concatenar: si el fichero existe y no termina en
 * `\n`, un append pegaría la regla nueva a la última línea del usuario y
 * corrompería las dos —la regla previa dejaría de aplicarse y la nuestra
 * tampoco existiría—. Es el mismo bug que ct-init.sh evita en el `.gitignore`.
 *
 * @param {string} current
 * @param {string} rule
 * @returns {{ content: string, added: boolean }}
 */
export function excludeContentWith(current, rule) {
  const text = current || ''
  if (text.split('\n').some((l) => l.trim() === rule)) return { content: text, added: false }
  const sep = text === '' || text.endsWith('\n') ? '' : '\n'
  return { content: `${text}${sep}${rule}\n`, added: true }
}
```

- [ ] **Step 4: Write the ct-next side**

En `scripts/ct-next.mjs`, añade `isAbsolute` al import de `node:path` (línea 7):

```js
import { dirname, join, isAbsolute, delimiter as pathDelimiter } from 'node:path'
```

Añade el import del módulo nuevo junto al de `state.js` (línea 17):

```js
import { SLICE_REL_PATH, excludeContentWith } from './state-paths.js'
```

Y añade la función justo antes de `cleanupOrphanedWorktree` (línea ~2844):

```js
// ============================================================================
// F22 — LA REGLA QUE HACE INVISIBLE EL ESTADO DEL SLICE.
//
// Va al directorio COMÚN de git, no al `.git` del worktree — que ni siquiera
// es un directorio: en un worktree enlazado `.git` es un FICHERO que apunta a
// `<principal>/.git/worktrees/<n>`. `git rev-parse --git-common-dir` devuelve
// el `.git` del checkout principal, así que UNA escritura cubre a la
// coordinadora y a todos los worktrees, presentes y futuros. Y como
// `info/exclude` no se commitea jamás, esta regla no puede acabar dentro de un
// PR — que es exactamente el fallo que esta ronda arregla.
//
// POR QUÉ NO BASTA EL .gitignore. `ct-init` sí añade la línea al `.gitignore`
// del repo (la vía larga, commiteada y compartida), pero eso sólo protege a
// los repos que lo re-corran Y sólo desde que ese commit llegue a la base
// desde la que se corta el worktree. Esta escritura es la red que hace que lo
// otro no sea un requisito previo.
//
// POR QUÉ NO SIRVE PARA `.agent/STATE.md`, y conviene que quede escrito: NINGUNA
// regla de ignore afecta a un fichero ya TRACKEADO. Funciona aquí, y sólo
// aquí, porque `.agent/SLICE.md` nace sin trackear y nunca se trackea.
//
// Idempotente por línea exacta, mismo criterio que el bloque de `.worktrees/`
// de ct-init.sh: se añade sólo si no está ya.
// ============================================================================
function ensureSliceIgnored() {
  let commonDir
  try {
    commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    }).trim()
  } catch (e) {
    return { ok: false, why: `no se pudo localizar el directorio común de git (\`git rev-parse --git-common-dir\`): ${e.message}` }
  }
  if (!commonDir) return { ok: false, why: '`git rev-parse --git-common-dir` no devolvió ninguna ruta' }
  const base = isAbsolute(commonDir) ? commonDir : join(repoRoot, commonDir)
  const excludePath = join(base, 'info', 'exclude')
  try {
    mkdirSync(join(base, 'info'), { recursive: true })
    let current = ''
    try { current = readFileSync(excludePath, 'utf8') } catch { current = '' }
    const next = excludeContentWith(current, SLICE_REL_PATH)
    if (!next.added) return { ok: true, added: false, path: excludePath }
    writeFileSync(excludePath, next.content)
    return { ok: true, added: true, path: excludePath }
  } catch (e) {
    return { ok: false, why: `no se pudo escribir ${excludePath}: ${e.message}` }
  }
}
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, con los cuatro tests nuevos de `excludeContentWith` en verde. `ensureSliceIgnored` todavía no se llama desde ningún sitio; esto verifica que `ct-next.mjs` sigue parseando y que nada se ha roto.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-next.mjs __tests__/f22-estado-del-slice.test.js
git commit -m "F22: la regla de ignore del estado del slice, en el directorio comun de git"
```

---

### Task 4: `ct-next` siembra en `SLICE.md` y verifica el efecto

**Files:**
- Modify: `scripts/ct-next.mjs:3148` (línea del `--dry-run`), `scripts/ct-next.mjs:3424-3429` (el seed)
- Test: `__tests__/f22-estado-del-slice.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `SLICE_REL_PATH` (Task 1), `ensureSliceIgnored()` (Task 3), `cleanupOrphanedWorktree(s, wt, branch, reason)` (ya existe, `ct-next.mjs:2844`).
- Produces: el worktree sembrado con `.agent/SLICE.md` y con `.agent/STATE.md` a cero diff.

- [ ] **Step 1: Write the failing test**

```js
describe('F22 — el seed no toca el fichero de la coordinadora', () => {
  it('tras sembrar, el STATE.md del worktree queda a CERO DIFF contra la base', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# coordinadora\n')
    git('add', '-A')
    git('commit', '-qm', 'estado de la coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')

    // Lo que hace el dispatcher tras este cambio: regla de ignore, y siembra
    // en SLICE.md sin tocar STATE.md.
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), '---\ntask: el slice\n---\n# slice\n')

    expect(execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    expect(execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: wt, encoding: 'utf8' }).trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('el merge de main que conflictuaba en STATE.md ahora entra limpio', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# v1\n')
    git('add', '-A')
    git('commit', '-qm', 'estado v1')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: wt, encoding: 'utf8' }).trim()
    writeFileSync(join(common, 'info', 'exclude'), `${SLICE_REL_PATH}\n`, { flag: 'a' })
    writeFileSync(join(wt, SLICE_REL_PATH), '---\ntask: el slice\n---\n# slice\n')

    // La coordinadora avanza su estado en main — 44 de cada 1074 commits de
    // main lo hacían en el repo real.
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# v2\n')
    git('add', '-A')
    git('commit', '-qm', 'estado v2')

    const merge = spawnSync('git', ['merge', 'main', '-m', 'merge main'], { cwd: wt, encoding: 'utf8' })
    expect(merge.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: PASS los dos. Son tests de caracterización del comportamiento que el cambio de `ct-next.mjs` produce; fijan la propiedad («cero diff», «el merge entra») antes de tocar el dispatcher, y protegen contra que alguien vuelva a sembrar sobre `STATE.md`.

- [ ] **Step 3: Write the implementation**

En `scripts/ct-next.mjs`, sustituye la línea 3148 (rama `--dry-run`):

```js
    console.log(`seed ${wt}/${SLICE_REL_PATH}:\n${stateSeed}`)
```

Y sustituye el bloque de las líneas 3424-3429 por:

```js
  // F22: la regla de ignore ANTES de sembrar. Si el fichero llegara a existir
  // sin la regla puesta, un `git add -A` del agente ya podría llevárselo.
  const ignored = ensureSliceIgnored()
  if (!ignored.ok) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo garantizar que ${SLICE_REL_PATH} quede fuera de git (${ignored.why}). NO se siembra: un estado de slice que git puede ver acaba dentro del PR y de ahí a main.`)
  }
  try {
    mkdirSync(`${wt}/.agent`, { recursive: true })
    writeFileSync(`${wt}/${SLICE_REL_PATH}`, stateSeed)
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo sembrar ${SLICE_REL_PATH}: ${e.message}`)
  }
  // ==========================================================================
  // F22 — SE VERIFICA EL EFECTO, NO EL EXIT CODE.
  //
  // Las dos escrituras de arriba pueden salir 0 y aun así dejar el fichero
  // VISIBLE para git: un core.excludesFile del usuario con precedencia rara, un
  // `.gitignore` con una negación (`!.agent/*`) que gane a nuestra regla, un
  // repo donde alguien trackeó el path a mano en el pasado. Ninguna de esas se
  // detecta mirando si `writeFileSync` lanzó.
  //
  // La única pregunta que importa es la que git contesta: ¿ve el fichero? Si lo
  // ve, el dispatch NO sigue. Se aborta por la misma vía que cualquier fallo
  // posterior a crear el worktree (revierte el claim, borra rama y directorio),
  // porque despachar un agente que va a contaminar main es peor que no
  // despacharlo.
  // ==========================================================================
  let porcelain = null
  try {
    porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: wt, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
    })
  } catch (e) {
    cleanupOrphanedWorktree(s, wt, branch, `no se pudo COMPROBAR que ${SLICE_REL_PATH} queda fuera de git (\`git status --porcelain\` falló: ${e.message}). No se afirma que esté bien: sin esa comprobación, un estado de slice visible para git acaba en el PR y de ahí a main.`)
  }
  if (porcelain.split('\n').some((l) => l.includes(SLICE_REL_PATH))) {
    cleanupOrphanedWorktree(s, wt, branch, `${SLICE_REL_PATH} SIGUE siendo visible para git en ${wt} después de escribir la regla de ignore en ${ignored.path}. Causas típicas: una negación en el .gitignore del repo que gana a la regla (p. ej. \`!.agent/*\`), un core.excludesFile con precedencia, o que alguien trackeara ese path a mano en el pasado (y ninguna regla de ignore afecta a un fichero ya trackeado: haría falta \`git rm --cached ${SLICE_REL_PATH}\`). No se despacha este slice: su estado acabaría dentro del PR.`)
  }
```

- [ ] **Step 4: Test de la puerta — el aborto REVIERTE el claim**

Este es el test que impide que la verificación de efecto se degrade a decoración. Necesita una corrida **real** de `ct-next.mjs` (no `--dry-run`: bajo `--dry-run` no se crea worktree ni se siembra nada).

Antes de escribirlo, **lee `__tests__/ct-next-launch-verification.test.js`** y copia su montaje: usa `fixtures/fake-gh-bin`, `fixtures/fake-cmux-bin` y `fixtures/fake-claude-bin` en el `PATH`, más `ACCOUNT_ENV` de `fixtures/hermetic-env.js` y el `rmSyncBestEffort` de `fixtures/cleanup.js`. Es el fichero que ya ejercita el camino completo «claim → worktree → seed → lanzamiento».

Con ese montaje, el escenario y las aserciones exactas:

**Escenario:** un repo cuyo `.gitignore` contiene una negación que gana a la regla del exclude, de modo que `git status` sigue viendo el fichero pese a todo:

```
.agent/SLICE.md
!.agent/SLICE.md
```

(Una negación posterior en el `.gitignore` del repo tiene precedencia sobre `info/exclude`. Verifica primero, a mano en un repo de prueba, que con esas dos líneas `git status --porcelain` SÍ muestra el fichero; si tu versión de git no se comporta así, usa en su lugar un `git add -f .agent/SLICE.md` previo, que también lo hace visible por estar ya trackeado.)

**Aserciones, las cuatro:**

```js
expect(r.status).not.toBe(0)                              // no se despacha
expect(r.stderr).toContain('SIGUE siendo visible para git')
expect(existsSync(join(repoRoot, '.worktrees', '1'))).toBe(false)  // worktree limpiado
// y el claim revertido: el fake-gh registra las llamadas; comprueba que se
// pidió devolver el issue a status:ready, con el mismo patrón de aserción
// sobre el log del fake que use ct-next-launch-verification.test.js
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Si `ct-next-dryrun.test.js` falla por la línea `seed …`, actualiza la aserción al path nuevo — es el cambio esperado.

- [ ] **Step 6: Commit**

```bash
git add scripts/ct-next.mjs __tests__/f22-estado-del-slice.test.js
git commit -m "F22: el seed va a SLICE.md, y se comprueba que git no lo ve"
```

---

### Task 5: `last_commit` sembrado con el sha de la base

**⚠️ No empieces esta tarea si la Task 4 no está mergeada.** Ver Global Constraints.

**Files:**
- Modify: `scripts/ct-next.mjs:1605` (tras `verifyBaseExistsLocally`), `scripts/ct-next.mjs:2409` (llamada a `buildStateSeed`)
- Modify: `scripts/kickoff.js:245-290` (`buildStateSeed`)
- Test: `__tests__/f22-estado-del-slice.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `resolvedBase` (ya existe en `ct-next.mjs`).
- Produces: `buildStateSeed(slice, { branch, base, baseSha })` — firma ampliada con un tercer campo opcional `baseSha: string`.

- [ ] **Step 1: Write the failing test**

```js
import { buildStateSeed } from '../scripts/kickoff.js'
import { parseState } from '../scripts/state.js'

describe('F22 — la semilla deja de desarmar el hook de frescura', () => {
  it('siembra last_commit con el sha de la base, no vacío', () => {
    const slice = { n: 7, name: 'un slice', ac: ['AC1'], issue: 42 }
    const seed = buildStateSeed(slice, { branch: 'feat/42', base: 'main', baseSha: 'a'.repeat(40) })
    expect(parseState(seed).meta.last_commit).toBe('a'.repeat(40))
  })

  it('sin baseSha cae a vacío — un sha inventado sería peor que ninguno', () => {
    const slice = { n: 7, name: 'un slice', ac: ['AC1'], issue: 42 }
    const seed = buildStateSeed(slice, { branch: 'feat/42', base: 'main' })
    expect(parseState(seed).meta.last_commit).toBe('')
  })

  it('con la semilla nueva, el hook Stop BLOQUEA el cierre tras un commit de trabajo', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const baseSha = git('rev-parse', 'HEAD').trim()
    const seed = buildStateSeed(
      { n: 1, name: 'slice', ac: ['AC1'], issue: 1 },
      { branch: 'feat/1', base: 'main', baseSha },
    )
    writeFileSync(join(dir, SLICE_REL_PATH), seed)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    const out = runHook(stopHook, dir)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('1 commit')
    rmSync(dir, { recursive: true, force: true })
  })

  it('y con la semilla de HOY (last_commit vacío) NO bloquea — el defecto que esto arregla', () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    const seed = buildStateSeed({ n: 1, name: 'slice', ac: ['AC1'], issue: 1 }, { branch: 'feat/1', base: 'main' })
    writeFileSync(join(dir, SLICE_REL_PATH), seed)
    writeFileSync(join(dir, 'f.txt'), 'trabajo\n')
    git('add', 'f.txt')
    git('commit', '-qm', 'work 1')
    expect(runHook(stopHook, dir)).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: FAIL el primero y el tercero (`last_commit` sale `''`, y el hook no bloquea). El segundo y el cuarto pasan ya — fijan el comportamiento actual como el fallback explícito.

- [ ] **Step 3: Write the implementation**

En `scripts/kickoff.js`, cambia la firma y el campo de `buildStateSeed` (línea 245 y línea 290):

```js
export function buildStateSeed(slice, { branch, base, baseSha = '' }) {
```

```js
      // F22: el sha de la base, NO el nombre de la rama. Con el campo vacío
      // —lo que se sembraba hasta ahora— `describeStopRelation` devuelve
      // `unset` y `classifyStopState` sale en silencio: el hook `Stop` que
      // obliga a refrescar el estado en cada turno quedaba DESARMADO durante
      // toda la vida del slice. Medido en campo: 21 horas y 7 commits con la
      // semilla intacta.
      //
      // Y tiene que ser un SHA, no `main`: un nombre de rama es un blanco
      // móvil, y en cuanto la base avanzara el conteo de "commits por encima
      // de tu last_commit" dejaría de significar nada. Si no se pudo resolver,
      // se siembra vacío a propósito — un sha inventado sería peor que ninguno.
      last_commit: baseSha,
```

En `scripts/ct-next.mjs`, tras la llamada a `verifyBaseExistsLocally(resolvedBase)` (línea 1605), añade:

```js
// F22: se resuelve UNA vez, aquí, donde `verifyBaseExistsLocally` acaba de
// demostrar que la referencia existe. Si aun así fallara, se sigue con cadena
// vacía: la semilla lo trata como "sin last_commit" y el hook calla, que es el
// comportamiento de antes de este cambio — degradar es aceptable, mentir no.
let resolvedBaseSha = ''
try {
  resolvedBaseSha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${resolvedBase}^{commit}`], {
    cwd: repoRoot, encoding: 'utf8', timeout: childTimeoutFor(), killSignal: 'SIGKILL',
  }).trim()
} catch {
  console.error(`aviso: no se pudo resolver "${resolvedBase}" a un sha concreto, así que la semilla del slice irá sin \`last_commit\`. El hook de cierre de turno no podrá avisar al agente de que su estado se ha quedado atrás.`)
}
```

Y en la llamada a `buildStateSeed` (línea 2409):

```js
    stateSeed = buildStateSeed(sliceForKickoff, { branch, base: resolvedBase, baseSha: resolvedBaseSha })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, incluidos `kickoff.test.js` y `f21-gate-y-tipo.test.js`, que llaman a `buildStateSeed` sin `baseSha` — el valor por defecto los mantiene verdes.

- [ ] **Step 5: Commit**

```bash
git add scripts/kickoff.js scripts/ct-next.mjs __tests__/f22-estado-del-slice.test.js
git commit -m "F22: la semilla deja de desarmar el hook que vigila la frescura del estado"
```

---

### Task 6: La lectura de `blocked` mira `SLICE.md`, sin fallback

**Files:**
- Modify: `scripts/ct-next.mjs:1934-1958` (`formatBlockedClaimWarnings`)
- Test: `__tests__/f22-estado-del-slice.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `SLICE_REL_PATH` (Task 1).
- Produces: nada nuevo; cambia el texto de dos avisos.

- [ ] **Step 1: Write the failing test**

`formatBlockedClaimWarnings` no está exportada, así que se testea por su salida observable. Este camino **sí** funciona bajo `--dry-run` (no hace falta corrida real): el aviso se emite al planificar.

Copia el montaje de `__tests__/ct-next-staleness.test.js` — ese fichero ya tiene exactamente lo que hace falta: `runReal(args, envOverrides)`, `makeRepoRoot()`, `fakePath` (con `fixtures/fake-gh-bin` y `fixtures/fake-cmux-bin`), `ACCOUNT_ENV` de `fixtures/hermetic-env.js` y `rmSyncBestEffort` de `fixtures/cleanup.js`. El fixture se pasa por la variable `CT_NEXT_FIXTURE` como JSON y **exige `--dry-run`** (`ct-next.mjs:1279` aborta si falta).

El escenario: un issue en `status:in-progress` cuyo worktree existe, **sin** `SLICE.md`, y cuyo `.agent/STATE.md` declara un `blocked` — que es exactamente lo que hay en un worktree recién cortado de una base cuya coordinadora estaba bloqueada.

```js
describe('F22 — el dispatcher no confunde el blocked de la coordinadora con el del slice', () => {
  it('un worktree del esquema anterior AVISA en vez de leer el STATE.md de la coordinadora', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees', '5', '.agent'), { recursive: true })
    writeFileSync(
      join(repoRoot, '.worktrees', '5', STATE_REL_PATH),
      '---\ntask: el epic de la coordinadora\nblocked:\n  reason: esperando una decisión de producto\n---\n# c\n',
    )
    const fx = JSON.stringify({ issues: [{ n: 5, status: 'in-progress', title: 'slice viejo' }] })
    const r = runReal(['--dry-run'], { CT_NEXT_FIXTURE: fx, CT_NEXT_REPO_ROOT: repoRoot })

    // Dice que NO lo ha comprobado, y nombra el fichero que falta…
    expect(r.stderr).toContain('.agent/SLICE.md')
    expect(r.stderr).toContain('NO se ha comprobado')
    // …y NUNCA afirma que el slice esté bloqueado citando el motivo del epic.
    expect(r.stderr).not.toContain('esperando una decisión de producto')
    expect(r.stdout).not.toContain('esperando una decisión de producto')
  })
})
```

**Dos cosas que hay que confirmar contra `ct-next-staleness.test.js` antes de dar el test por bueno**, porque son detalles del montaje que ese fichero ya resuelve y este plan no debe adivinar: la forma exacta del JSON de `CT_NEXT_FIXTURE` (qué campos lleva cada issue), y cómo se le dice a `ct-next.mjs` cuál es el `repoRoot` — si es por la variable de entorno que aparece arriba o por el `cwd` del `spawnSync`. Usa lo que use ese fichero.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: FAIL — hoy `formatBlockedClaimWarnings` lee `.agent/STATE.md` y reportaría el slice como BLOQUEADO citando el motivo de la coordinadora.

- [ ] **Step 3: Write the implementation**

En `scripts/ct-next.mjs`, dentro de `formatBlockedClaimWarnings`, sustituye las líneas 1938-1939:

```js
    const path = `${repoRoot}/.worktrees/${i.n}/${SLICE_REL_PATH}`
    if (!existsSync(path)) {
      // F22: SIN FALLBACK a `.agent/STATE.md`, y es deliberado. En un worktree
      // sembrado por esta versión, ese fichero es el de la COORDINADORA
      // congelado en la base: su campo `blocked` habla del epic, no de este
      // slice, y leerlo reportaría como bloqueado un slice que no lo está.
      // Un worktree sin SLICE.md es uno del esquema anterior — se dice, no se
      // adivina, mismo criterio que el fallo de lectura de más abajo.
      if (existsSync(`${repoRoot}/.worktrees/${i.n}`)) {
        out.push(`#${i.n} está en status:in-progress y su worktree existe, pero no tiene ${SLICE_REL_PATH}: lo sembró una versión del plugin anterior a F22, cuando el estado del slice vivía en .agent/STATE.md. NO se ha comprobado si ese agente se declaró BLOQUEADO —y su .agent/STATE.md NO se lee a propósito: en un worktree nuevo ese fichero es el de la coordinadora, y su campo \`blocked\` no habla de este slice—. Míralo a mano: \`cat .worktrees/${i.n}/.agent/STATE.md\`.`)
      }
      continue // sin worktree no hay nada que leer; el claim rancio ya lo cubre stalenessNote
    }
```

Y actualiza los dos mensajes de más abajo que nombran el path, para que digan `${SLICE_REL_PATH}` en vez de `.agent/STATE.md` (líneas 1944, 1949 y 1956).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ct-next.mjs __tests__/f22-estado-del-slice.test.js
git commit -m "F22: el blocked del slice se lee de SLICE.md, y un worktree viejo se avisa"
```

---

### Task 7: `ct-init` añade la línea al `.gitignore`

**Files:**
- Modify: `scripts/ct-init.sh:66-80` (junto al bloque de `.worktrees/`)
- Test: `__tests__/f22-estado-del-slice.test.js` (añadir bloque)

**Interfaces:**
- Consumes: nada.
- Produces: la línea `.agent/SLICE.md` en el `.gitignore` del repo destino.

- [ ] **Step 1: Write the failing test**

```js
describe('F22 — ct-init deja la regla commiteada en el .gitignore', () => {
  it('añade .agent/SLICE.md, y no la duplica al re-correrlo', () => {
    const dir = mkGitRepo()
    const initScript = join(here, '..', 'scripts', 'ct-init.sh')
    execFileSync('bash', [initScript, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const first = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(first.split('\n').filter((l) => l.trim() === SLICE_REL_PATH)).toHaveLength(1)
    execFileSync('bash', [initScript, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const second = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(second.split('\n').filter((l) => l.trim() === SLICE_REL_PATH)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

Añade `readFileSync` al import de `node:fs` en la cabecera del fichero de test.

**Nota:** comprueba la firma real de invocación en `__tests__/ct-init.test.js` antes de escribir el `execFileSync` — si ese fichero pasa el target de otra forma (variable de entorno, `cwd`), usa la suya.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: FAIL — el `.gitignore` sólo tiene `.worktrees/`.

- [ ] **Step 3: Write the implementation**

En `scripts/ct-init.sh`, justo después del bloque de `.worktrees/` (tras su `fi`, línea ~80), añade:

```sh
# .agent/SLICE.md (F22): /ct-next siembra el estado del slice ahí, dentro del
# worktree. Ese fichero es estado VIVO Y LOCAL de una sesión despachada, nunca
# producto: si git lo ve, un `git add -A` del agente lo mete en su PR y el
# squash deja main con el estado de un slice —y cualquier sesión nueva del repo
# se hidrata creyendo que ES ese agente—. Pasó tres veces en un periodo de 9
# slices antes de existir esta línea.
#
# /ct-next escribe además la misma regla en .git/info/exclude en cada dispatch,
# para cubrir los repos que no re-corran ct-init. Esta es la vía larga: se
# commitea, la ve quien clone, y explica por qué está.
#
# Idempotente por línea exacta, igual que el bloque de .worktrees/ de arriba.
if ! grep -qxF '.agent/SLICE.md' "$GITIGNORE"; then
  echo '.agent/SLICE.md' >> "$GITIGNORE"
  echo "añadido .agent/SLICE.md a $GITIGNORE"
else
  echo ".agent/SLICE.md ya está en $GITIGNORE, no se duplica"
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS, incluido `ct-init.test.js`. Si ese fichero asevera el contenido exacto del `.gitignore`, actualiza la aserción a las dos líneas.

- [ ] **Step 5: Commit**

```bash
git add scripts/ct-init.sh __tests__/f22-estado-del-slice.test.js
git commit -m "F22: ct-init deja la regla del estado del slice en el .gitignore"
```

---

### Task 8: La puerta del `--release`

**Files:**
- Modify: `scripts/dispatch-check.mjs:23-27` (imports), `scripts/dispatch-check.mjs:50-75` (contrato de exit codes), `scripts/dispatch-check.mjs:331-344` (bloque `release`)
- Test: `__tests__/f22-estado-del-slice.test.js` (añadir bloque)

**Interfaces:**
- Consumes: `NEVER_IN_A_SLICE_PR`, `SLICE_REL_PATH` (Task 1); `dieErr(msg, code)` (ya existe, línea 127).
- Produces: exit code **5** = «la rama introduce un fichero de estado; no se libera».

- [ ] **Step 1: Write the failing test**

```js
describe('F22 — --release se niega si la rama lleva un fichero de estado', () => {
  const dispatchCheck = join(here, '..', 'scripts', 'dispatch-check.mjs')

  const mkSliceWorktree = () => {
    const dir = mkGitRepo()
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    writeFileSync(join(dir, STATE_REL_PATH), '---\ntask: el epic\n---\n# c\n')
    git('add', '-A')
    git('commit', '-qm', 'estado coordinadora')
    git('worktree', 'add', '-q', '-b', 'feat/1', '.worktrees/1', 'HEAD')
    const wt = join(dir, '.worktrees', '1')
    const baseSha = git('rev-parse', 'HEAD').trim()
    writeFileSync(join(wt, SLICE_REL_PATH), `---\ntask: slice\nbase: ${baseSha}\n---\n# s\n`)
    return { dir, wt, git: (...a) => execFileSync('git', a, { cwd: wt, encoding: 'utf8' }) }
  }

  it('exit 5 cuando la rama introduce .agent/STATE.md, y el mensaje da el remedio', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, STATE_REL_PATH), '---\ntask: el slice\n---\n# contaminado\n')
    git('add', '-A')
    git('commit', '-qm', 'work + estado')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(5)
    expect(r.stderr).toContain('.agent/STATE.md')
    expect(r.stderr).toContain('git checkout')
    rmSync(dir, { recursive: true, force: true })
  })

  it('exit 0 con una rama limpia — el caso normal no paga nada', () => {
    const { dir, wt, git } = mkSliceWorktree()
    writeFileSync(join(wt, 'f.txt'), 'trabajo\n')
    git('add', '-A')
    git('commit', '-qm', 'work')
    const r = spawnSync('node', [dispatchCheck, '1', '--repo', 'o/r', '--release', '--dry-run'], {
      cwd: wt, encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f22-estado-del-slice.test.js`
Expected: FAIL el primero — hoy `--release` sale 0 sin mirar el diff.

- [ ] **Step 3: Write the implementation**

En `scripts/dispatch-check.mjs`, amplía el import de `node:fs` (línea 24) y añade el módulo nuevo:

```js
import { writeSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NEVER_IN_A_SLICE_PR, SLICE_REL_PATH } from './state-paths.js'
```

Añade al comentario del contrato de exit codes (tras la entrada del `4 =`, línea ~75):

```js
//   5 = NUEVO (F22) — la rama del slice INTRODUCE un fichero de estado
//       (`.agent/STATE.md` o `.agent/SLICE.md`). No se libera nada: el issue
//       se queda en status:in-progress. Este código NO lo ve nunca
//       ct-next.mjs — `--release` lo invoca el agente al entregar, no el
//       bucle de claim, así que no pasa por classifyClaimOutcome.
```

Y sustituye el bloque `if (release) {` (línea 331) por:

```js
// ============================================================================
// F22 — LA PUERTA: UN SLICE NO ENTREGA CON UN FICHERO DE ESTADO DENTRO.
//
// `.agent/STATE.md` es de la sesión COORDINADORA. Si la rama del slice lo
// introduce, el squash del PR deja main con el estado de un slice: `task:` con
// el nombre del slice, `role: slice-agent` y un gate pendiente de un PR ya
// mergeado. Cualquier sesión nueva del repo se hidrata creyendo que ES ese
// agente. Pasó tres veces en un periodo de 9 slices, y una llegó a main.
//
// SE NIEGA, no avisa. Una comprobación que sólo imprime no es una
// comprobación: si su resultado no puede detener la acción siguiente, es
// decoración — y fue exactamente así como se coló la que llegó a main (imprimió
// `1` y el merge siguió adelante).
//
// LÍMITE, dicho: `--release` lo invoca el agente porque el kickoff se lo pide,
// y el kickoff es un prompt, no un gate. Un agente que no lo llame se salta
// esta puerta — pero entonces su issue se queda en status:in-progress, que sí
// se ve. Esto mueve el caso normal de la retina del humano al loop; no lo
// vuelve hermético.
// ============================================================================
function sliceBaseRef() {
  // El `base` de la semilla es la respuesta correcta: es la referencia real
  // desde la que se cortó este worktree, `--base` incluido. La cadena de
  // fallback cubre los worktrees del esquema anterior (sin SLICE.md).
  try {
    const m = readFileSync(join(process.cwd(), SLICE_REL_PATH), 'utf8').match(/^base:[ \t]*(.+)$/m)
    if (m) {
      const v = m[1].trim().replace(/^['"]|['"]$/g, '')
      if (v) return v
    }
  } catch { /* sin SLICE.md: worktree del esquema anterior, o cwd que no es el worktree */ }
  for (const ref of ['origin/HEAD', 'origin/main', 'main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' })
      return ref
    } catch { /* siguiente */ }
  }
  return ''
}

function stateFilesIntroducedByBranch() {
  const base = sliceBaseRef()
  if (!base) {
    return { known: false, why: 'no se pudo determinar la base de esta rama (ni `base:` en la semilla, ni origin/HEAD, ni main, ni master)' }
  }
  let out = ''
  try {
    out = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
  } catch (e) {
    return { known: false, why: `\`git diff ${base}...HEAD\` falló: ${e.message}` }
  }
  const touched = out.split('\n').map((l) => l.trim()).filter(Boolean)
  return { known: true, base, hits: NEVER_IN_A_SLICE_PR.filter((p) => touched.includes(p)) }
}

if (release) {
  const check = stateFilesIntroducedByBranch()
  if (!check.known) {
    dieErr(`no se puede liberar #${issue}: ${check.why}, así que NO se ha podido comprobar si esta rama introduce un fichero de estado (${NEVER_IN_A_SLICE_PR.join(' o ')}). No se afirma que esté limpia — un fichero de estado en el PR deja main con el estado de un slice tras el squash. Comprueba a mano con \`git diff --name-only <base>...HEAD\` y, si está limpio, vuelve a intentarlo desde un cwd donde la base se resuelva.`, 5)
  }
  if (check.hits.length) {
    const lista = check.hits.join(', ')
    dieErr(`no se libera #${issue}: esta rama INTRODUCE ${lista} respecto a ${check.base}. Ese fichero es el estado de la sesión coordinadora, no producto de este slice: al mergear con squash, main se quedaría con el estado de este slice y cualquier sesión nueva del repo se hidrataría creyendo que es este agente. Restáuralo y vuelve a intentarlo: \`git checkout ${check.base} -- ${lista}\` y commitea (o \`git rm --cached\` si lo añadiste nuevo). El issue sigue en status:in-progress: no se ha movido nada.`, 5)
  }
  if (!dryRun && !fx) {
    const result = setStatus(issue, 'status:in-progress', 'status:in-review')
    if (!result.ok) {
      // --release nunca pasa por classifyClaimOutcome en ct-next.mjs (es un
      // paso posterior, invocado por el propio agente al terminar el
      // slice, no por el bucle de claim) — su exit 1 queda fuera del
      // contrato ensanchado de arriba, sin cambios.
      dieErr(`no se pudo liberar #${issue} a in-review: ${result.error.message}. Sigue en status:in-progress; reintenta el --release.`, 1)
    }
  }
  dieOut(`released #${issue} → in-review`, 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS. Presta atención a `ct-next-exit-code-contract.test.js` y `dispatch-check-dryrun.test.js`: si alguno asevera que `--release --dry-run` sale 0 sin más, ese test corre ahora en un cwd sin base resoluble y sacará 5. Móntale un repo git con `main` o pásale un cwd donde `sliceBaseRef()` resuelva.

- [ ] **Step 5: Commit**

```bash
git add scripts/dispatch-check.mjs __tests__/f22-estado-del-slice.test.js
git commit -m "F22: --release se niega si la rama introduce un fichero de estado"
```

---

### Task 9: Documentación y bump de versión

**Files:**
- Modify: `commands/ct-next.md`
- Modify: `commands/ct-init.md`
- Modify: `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la versión 0.22.0.

- [ ] **Step 1: Escribe la sección de `commands/ct-next.md`**

Añádela después de la sección «Canal de salida (F16)», con este contenido:

```markdown
**El estado del slice no es producto (F22).** El worktree de un slice tiene **dos** ficheros de estado y sólo uno habla de ese trabajo:

| Fichero | Qué es | git |
|---|---|---|
| `.agent/STATE.md` | el de la sesión coordinadora, tal como venía en la base | trackeado, **a cero diff**: el dispatcher no lo toca |
| `.agent/SLICE.md` | el estado del slice | **ignorado**, nunca commiteable |

Todo lector del estado —los dos hooks del plugin y el propio `/ct-next`— aplica la misma regla: **si existe `.agent/SLICE.md`, ése es el estado; si no, `.agent/STATE.md`**. La presencia del fichero es la señal de «estoy en un worktree de slice»; no hay variable de entorno ni detección de rutas.

Para garantizar el «ignorado», `/ct-next` escribe la regla en el `info/exclude` del **directorio común** de git en cada dispatch (una escritura cubre a la coordinadora y a todos los worktrees, y nunca se commitea), y después **verifica el efecto**: si `git status --porcelain` sigue viendo el fichero, el dispatch se aborta y el claim se revierte. `/ct-init` deja además la línea en el `.gitignore` del repo, que es la vía commiteada y compartida.

Y `dispatch-check --release` **se niega con exit 5** si la rama introduce `.agent/STATE.md` o `.agent/SLICE.md`, con el comando exacto para restaurarlo. Es una puerta, no un aviso: una comprobación que sólo imprime no es una comprobación.

**Un worktree sembrado por una versión anterior a F22** no tiene `SLICE.md`. `/ct-next` no lee su `.agent/STATE.md` para detectar bloqueos —en un worktree nuevo ese fichero es el de la coordinadora y su `blocked` no habla del slice—: avisa de que no lo ha comprobado y te pide mirarlo a mano. No se migra nada: mutar el árbol de un agente vivo es peor que el problema.
```

- [ ] **Step 2: Escribe la nota de `commands/ct-init.md`**

Añade, donde el fichero describe lo que `ct-init` deja en el repo:

```markdown
Al `.gitignore` se le añaden **dos** líneas, las dos idempotentes: `.worktrees/` (los worktrees de slice viven dentro del checkout, y sin esa línea un `git add -A` se traga un árbol de trabajo entero) y `.agent/SLICE.md` (el estado de una sesión despachada, que es estado vivo y local, nunca producto — ver F22 en `commands/ct-next.md`).
```

- [ ] **Step 3: Bump de versión**

En `.claude-plugin/plugin.json`, cambia `"version": "0.21.0"` por `"version": "0.22.0"`.

- [ ] **Step 4: Corre la suite entera**

Run: `npm test`
Expected: PASS. `manifest.test.js` valida el `plugin.json`; si asevera la versión, actualízala.

- [ ] **Step 5: Commit**

```bash
git add commands/ct-next.md commands/ct-init.md .claude-plugin/plugin.json
git commit -m "chore: bump a 0.22.0 (F22: el estado del slice deja de ser producto)"
```

---

## Verificación final

Antes de dar el bloque por cerrado, con el plugin instalado desde este checkout:

- [ ] `npm test` en verde, suite entera.
- [ ] En un repo de prueba con `ct-init` corrido: `/ct-next` despacha un slice, y en el worktree resultante `git status --porcelain` sale **vacío** aunque `.agent/SLICE.md` exista y tenga contenido.
- [ ] En ese worktree, un commit de trabajo hace que el cierre de turno quede **bloqueado** por el hook `Stop` con el mensaje de «se ha quedado atrás».
- [ ] Un `git merge main` en ese worktree, con `main` habiendo movido su `.agent/STATE.md`, entra **sin conflicto**.
- [ ] `node scripts/dispatch-check.mjs <n> --repo <o/r> --release --dry-run` desde ese worktree sale **0**; tras commitear un cambio en `.agent/STATE.md`, sale **5**.
