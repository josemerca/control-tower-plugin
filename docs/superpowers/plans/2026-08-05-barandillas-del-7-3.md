# F27 — Las barandillas del §7.3: implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir una puerta `PreToolUse` que deniega un `git commit` cuyo mensaje lleve una closing keyword en un repo gobernado por el loop, y escribir en el contrato §9 que las comprobaciones previas al merge deben ser puertas.

**Architecture:** Dos módulos nuevos (uno **puro** para el parseo, otro para el I/O del predicado) más un hook fino que sólo cablea y redacta mensajes. El hook se evalúa en un orden que deja el camino común sin una sola lectura de disco. Después, tres cambios de documentación y un barrido de las frases que la propia ronda vuelve falsas.

**Tech Stack:** Node ESM, vitest, esbuild (bundle a `dist/`), bash (el contrato vive en `scripts/ct-init.sh`).

**Spec:** `docs/superpowers/specs/2026-08-05-barandillas-del-7-3-design.md`

## Global Constraints

- **Trabaja en el worktree `.claude/worktrees/f27-barandillas`.** Nunca sobre `main`.
- **Los comentarios y los mensajes al usuario van en castellano**, como todo el repo.
- **Un comentario describe la PROPIEDAD, no cita al vecino ni a una tarea futura.** El fichero se lee solo dentro de seis meses; este plan no estará. No escribas «como se decide en la tarea 5» ni «ver el plan».
- **Los hooks no pueden tener dependencias npm en runtime**: sólo imports `node:*` y módulos del propio repo. `__tests__/bundle.test.js` lo verifica sobre el bundle.
- **Nunca midas a través de una tubería.** `cmd | tail; echo $?` da el código de `tail`. Redirige a fichero y lee el fichero.
- **Después de cada arreglo, barre la zona entera**, no la línea señalada, y comprueba los comentarios que NO tocaste y que tu cambio pueda haber falsificado.
- **Un test que no puede fallar no prueba nada.** En cada test de propiedad: rompe la implementación a propósito, confirma el rojo, deshaz, confirma el verde.
- **Suite completa:** `npx vitest run > /tmp/f27.log 2>&1; echo $?` y lee el fichero.
- **Línea base de la rama:** 57 ficheros, 1595 tests, exit 0.
- **Mensajes de commit**: sin acentos ni caracteres no ASCII en el cuerpo (costumbre del repo), y terminando con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. **Y sin ninguna closing keyword literal**, obviamente.

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `scripts/closing-keywords.js` | **Nuevo, PURO.** Tokenizar una línea de shell por segmentos, reconocer un `git commit`, extraer sus mensajes, encontrar closing keywords. Cero I/O. |
| `scripts/governed-repo.js` | **Nuevo.** Único I/O: subir desde un `cwd` hasta el `.git` y decidir si ese repo lleva el contrato del loop. |
| `hooks/commit-keyword-guard.js` | **Nuevo.** Cableado: stdin → orden de evaluación → decisión JSON. Sin lógica de parseo propia. |
| `scripts/build.mjs` | Añadir el hook a `entryPoints`. |
| `hooks/hooks.json` | Registrar el `PreToolUse`. |
| `dist/commit-keyword-guard.js` | Generado por `npm run build`, commiteado. |
| `scripts/ct-init.sh` | La regla en el contrato §9, versión 12→13, hash nuevo, y el barrido de la advertencia vieja. |
| `commands/ct-status.md` | La regla en el bloque `ENTREGADO, ESPERANDO MERGE`. |
| `.claude-plugin/plugin.json` | `description` + versión 0.26.0. |
| `__tests__/f27-closing-keywords.test.js` | **Nuevo.** Unidad de los dos módulos. |
| `__tests__/f27-commit-keyword-guard.test.js` | **Nuevo.** El hook end-to-end contra `dist/`. |
| `__tests__/hooks-json.test.js` | Hacerlo genérico sobre todos los eventos. |

---

### Task 1: Tokenizar la línea de shell por segmentos

**Files:**
- Create: `scripts/closing-keywords.js`
- Test: `__tests__/f27-closing-keywords.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `tokenizeSegments(command: string): string[][]` — un array de tokens por cada sub-comando independiente.

> **Nota de fichero (no la copies como comentario):** este mismo fichero de test
> acaba usando `afterAll` para limpiar directorios temporales, por eso el import
> de vitest ya lo trae desde el primer paso. Un comentario en el código que
> dijera «se importa para una tarea posterior» sería exactamente lo que estas
> constraints prohíben: dentro de seis meses el plan no está y la frase queda
> huérfana.

Es la pieza que impide el falso positivo caro: si no se corta por separadores, `git commit -m "x" && gh pr create --body "Closes #1"` se lee como un solo comando y la puerta bloquea el camino feliz.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, afterAll } from 'vitest'
import { tokenizeSegments } from '../scripts/closing-keywords.js'

describe('F27 — tokenizeSegments', () => {
  it('separa tokens por espacios', () => {
    expect(tokenizeSegments('git commit -m hola')).toEqual([['git', 'commit', '-m', 'hola']])
  })

  it('respeta comillas dobles y simples como UN token', () => {
    expect(tokenizeSegments('git commit -m "dos palabras"')).toEqual([['git', 'commit', '-m', 'dos palabras']])
    expect(tokenizeSegments("git commit -m 'dos palabras'")).toEqual([['git', 'commit', '-m', 'dos palabras']])
  })

  it('un token vacio entrecomillado sigue siendo un token', () => {
    expect(tokenizeSegments('git commit -m ""')).toEqual([['git', 'commit', '-m', '']])
  })

  // LA propiedad que sostiene toda la ronda: el `gh pr create` del camino feliz
  // vive en su propio segmento y no se mezcla con el del commit.
  it('corta por &&, ||, ; y | en segmentos independientes', () => {
    expect(tokenizeSegments('git commit -m x && gh pr create --body y')).toEqual([
      ['git', 'commit', '-m', 'x'],
      ['gh', 'pr', 'create', '--body', 'y'],
    ])
    expect(tokenizeSegments('a ; b | c || d')).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('corta por salto de linea', () => {
    expect(tokenizeSegments('cd x\ngit commit -m y')).toEqual([['cd', 'x'], ['git', 'commit', '-m', 'y']])
  })

  it('un escape con barra invertida conserva el caracter literal', () => {
    expect(tokenizeSegments('git commit -m a\\ b')).toEqual([['git', 'commit', '-m', 'a b']])
  })

  it('una comilla sin cerrar no lanza: se consume hasta el final', () => {
    expect(() => tokenizeSegments('git commit -m "sin cerrar')).not.toThrow()
  })

  it('entrada no-string devuelve lista vacia', () => {
    expect(tokenizeSegments(undefined)).toEqual([])
    expect(tokenizeSegments(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: FAIL — no existe `scripts/closing-keywords.js`.

- [ ] **Step 3: Write minimal implementation**

Crea `scripts/closing-keywords.js`:

```js
// ============================================================================
// closing-keywords.js — ¿ESTE COMANDO VA A METER UNA CLOSING KEYWORD EN UN
// MENSAJE DE COMMIT?
//
// Módulo PURO: no lee disco, no lanza procesos, no toca la red. Todo lo que
// necesita viaja en la cadena del comando.
//
// Existe porque GitHub cierra un issue con una closing keyword que aparezca en
// CUALQUIER mensaje de commit que llegue a la rama por defecto, y las comillas
// NO protegen: en un repo real, un commit de documentación cuyo cuerpo
// MENCIONABA la cadena `Closes #451` —dentro de una frase que explicaba que el
// kickoff no la llevaba— cerró ese issue.
//
// EL RIESGO CARO DE ESTE MÓDULO NO ES DETECTAR POCO: ES DETECTAR DE MÁS. El
// contrato del loop manda poner el cierre en el CUERPO DEL PR, así que un
// detector que mirase el comando entero bloquearía `gh pr create --body
// "Closes #42"` — es decir, convertiría la barandilla en un ladrillo sobre el
// camino feliz. De ahí que lo primero que hace este módulo sea CORTAR el
// comando en sub-comandos independientes.
// ============================================================================

/**
 * tokenizeSegments: la línea de shell → un array de tokens por cada
 * sub-comando independiente.
 *
 * Corta por `&&`, `||`, `;`, `|`, `&` y salto de línea. El corte es la razón de
 * ser de la función: sin él, `git commit -m x && gh pr create --body y` sería
 * un solo comando y el `--body` contaminaría el registro del commit.
 *
 * Entiende comillas simples (nada se interpreta dentro), comillas dobles (con
 * escapes) y `\` fuera de comillas. Lo que deliberadamente NO entiende, porque
 * no hace falta para decidir y sí complicaría el módulo: sustitución de
 * comandos (`$(…)`, backticks), subshells `( )`, expansión de variables y
 * redirecciones. Un mensaje construido por sustitución de comandos no es
 * visible aquí, y eso está declarado como límite de la puerta.
 */
export function tokenizeSegments(command) {
  const src = typeof command === 'string' ? command : ''
  const segments = []
  let tokens = []
  let cur = ''
  // `has` distingue "token vacío entrecomillado" de "no hay token en curso":
  // sin él, `-m ""` perdería su argumento y el commit parecería no llevar
  // mensaje.
  let has = false
  const pushTok = () => { if (has) { tokens.push(cur); cur = ''; has = false } }
  const pushSeg = () => { pushTok(); if (tokens.length) segments.push(tokens); tokens = [] }

  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { cur += src[i + 1] ?? ''; has = true; i += 2; continue }
    if (c === "'") {
      const end = src.indexOf("'", i + 1)
      // Comilla sin cerrar: se consume el resto en vez de lanzar. Un comando
      // mal formado no es asunto de este módulo, y reventar aquí dejaría al
      // hook sin decisión por un motivo que no es el suyo.
      if (end === -1) { cur += src.slice(i + 1); has = true; break }
      cur += src.slice(i + 1, end); has = true; i = end + 1; continue
    }
    if (c === '"') {
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) { cur += src[i + 1]; i += 2; continue }
        cur += src[i]; i++
      }
      has = true; i++; continue
    }
    if (c === ' ' || c === '\t') { pushTok(); i++; continue }
    if (c === '\n' || c === ';') { pushSeg(); i++; continue }
    if (c === '&' || c === '|') { pushSeg(); i += src[i + 1] === c ? 2 : 1; continue }
    cur += c; has = true; i++
  }
  pushSeg()
  return segments
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verifica que los tests PUEDEN fallar (lección 5)**

Rompe a propósito: en `pushSeg`, cambia `if (tokens.length)` por `if (false)`. Corre el test: tiene que ponerse **rojo**. Deshaz. Vuelve a correr: **verde**.

- [ ] **Step 6: Commit**

```bash
git add scripts/closing-keywords.js __tests__/f27-closing-keywords.test.js
git commit -m "F27: tokenizado por segmentos, que es lo que salva el camino feliz

El kickoff manda poner el cierre en el CUERPO DEL PR, asi que un detector que
mirase el comando entero bloquearia \`gh pr create --body\`. Cortar por &&, ||,
;, | y salto de linea deja cada sub-comando en su propio segmento, y el commit
se registra solo contra el suyo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extraer los mensajes de un `git commit`

**Files:**
- Modify: `scripts/closing-keywords.js`
- Test: `__tests__/f27-closing-keywords.test.js`

**Interfaces:**
- Consumes: `tokenizeSegments`.
- Produces: `extractCommitMessages(command: string): string[]` — sólo los trozos que git va a usar como mensaje.

- [ ] **Step 1: Write the failing test**

Añade al fichero de test:

```js
import { extractCommitMessages } from '../scripts/closing-keywords.js'

describe('F27 — extractCommitMessages', () => {
  it('saca el mensaje de -m con espacio', () => {
    expect(extractCommitMessages('git commit -m "arregla algo"')).toEqual(['arregla algo'])
  })

  it('saca el mensaje de la forma pegada -mX', () => {
    expect(extractCommitMessages('git commit -marregla')).toEqual(['arregla'])
  })

  it('saca el mensaje de --message= y de --message con espacio', () => {
    expect(extractCommitMessages('git commit --message=uno')).toEqual(['uno'])
    expect(extractCommitMessages('git commit --message dos')).toEqual(['dos'])
  })

  it('varios -m se devuelven todos (git los concatena como parrafos)', () => {
    expect(extractCommitMessages('git commit -m titulo -m cuerpo')).toEqual(['titulo', 'cuerpo'])
  })

  it('acepta opciones globales antes del subcomando', () => {
    expect(extractCommitMessages('git -C /tmp/repo commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git -c user.name=x commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git --git-dir=/tmp/.git commit -m hola')).toEqual(['hola'])
  })

  it('acepta una ruta absoluta a git', () => {
    expect(extractCommitMessages('/usr/bin/git commit -m hola')).toEqual(['hola'])
  })

  it('un --amend con -m si trae mensaje en linea', () => {
    expect(extractCommitMessages('git commit --amend -m nuevo')).toEqual(['nuevo'])
  })

  // Los NEGATIVOS son los que importan: bloquear el camino feliz es el fallo caro.
  it('gh pr create no es un commit y no aporta nada', () => {
    expect(extractCommitMessages('gh pr create --body "Closes #42"')).toEqual([])
  })

  it('un commit encadenado con un gh pr create solo aporta lo suyo', () => {
    expect(extractCommitMessages('git commit -m limpio && gh pr create --body "Closes #1"')).toEqual(['limpio'])
  })

  it('git sin subcomando commit no aporta nada', () => {
    expect(extractCommitMessages('git log -m cosa')).toEqual([])
    expect(extractCommitMessages('git push origin main')).toEqual([])
  })

  it('un commit sin -m no aporta nada (el mensaje lo pone el editor)', () => {
    expect(extractCommitMessages('git commit --amend --no-edit')).toEqual([])
    expect(extractCommitMessages('git commit -F mensaje.txt')).toEqual([])
  })

  it('lo que va detras de -- es pathspec, no mensaje', () => {
    expect(extractCommitMessages('git commit -m real -- -m falso')).toEqual(['real'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: FAIL — `extractCommitMessages is not a function`.

- [ ] **Step 3: Write minimal implementation**

Añade a `scripts/closing-keywords.js`:

```js
// Opciones GLOBALES de git (las que van ANTES del subcomando) que consumen el
// token siguiente. Sin esta lista, `git -C /tmp/repo commit -m x` leería
// `/tmp/repo` como subcomando y el commit pasaría sin registrar.
const GIT_GLOBAL_TAKES_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

const isGitBinary = (tok) => tok === 'git' || tok.endsWith('/git')

/**
 * messagesFromSegment: los mensajes de UN sub-comando, o `[]` si ese
 * sub-comando no es un `git commit` con mensaje en línea.
 *
 * Lo que NO devuelve, y es deliberado: un `git commit` sin `-m` (abre
 * `$EDITOR`), un `-F <fichero>` (el texto está en disco) y un `--amend
 * --no-edit` (reutiliza un mensaje que no viaja en el comando). En esos tres el
 * mensaje no está aquí, así que afirmar cualquier cosa sobre él sería
 * inventarlo.
 */
function messagesFromSegment(tokens) {
  let i = 0
  if (!tokens.length || !isGitBinary(tokens[0])) return []
  i = 1
  while (i < tokens.length && tokens[i].startsWith('-')) {
    const t = tokens[i]
    if (t.includes('=')) { i += 1; continue }
    i += GIT_GLOBAL_TAKES_VALUE.has(t) ? 2 : 1
  }
  if (tokens[i] !== 'commit') return []
  i += 1

  const out = []
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    // Todo lo que va detrás de `--` es pathspec, nunca mensaje.
    if (t === '--') break
    if (t === '-m' || t === '--message') { if (i + 1 < tokens.length) out.push(tokens[++i]); continue }
    if (t.startsWith('--message=')) { out.push(t.slice('--message='.length)); continue }
    // Forma pegada `-mTEXTO`. Se excluye `--…` para no tragarse `--mixed` y
    // parecidos: sólo una opción corta puede llevar el valor pegado.
    if (t.startsWith('-m') && t.length > 2 && !t.startsWith('--')) { out.push(t.slice(2)); continue }
  }
  return out
}

/**
 * extractCommitMessages: de una línea de shell entera, SOLO los trozos que van
 * a acabar siendo mensaje de commit. Todo lo demás del comando —incluido el
 * `--body` de un `gh pr create`, que el contrato del loop EXIGE que lleve el
 * cierre— queda fuera por construcción.
 */
export function extractCommitMessages(command) {
  return tokenizeSegments(command).flatMap(messagesFromSegment)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: PASS.

- [ ] **Step 5: Verifica que los negativos PUEDEN fallar (lección 5)**

Rompe a propósito: en `messagesFromSegment`, quita la guarda `if (tokens[i] !== 'commit') return []`. El test de `gh pr create` y el de `git log` tienen que ponerse **rojos**. Deshaz. Verde.

- [ ] **Step 6: Commit**

```bash
git add scripts/closing-keywords.js __tests__/f27-closing-keywords.test.js
git commit -m "F27: extraer solo lo que git va a usar como mensaje

Reconoce el binario (incluida ruta absoluta), salta las opciones globales que
consumen valor, exige el subcomando commit, y recoge -m, -mX, --message= y
--message. Lo que va detras de -- es pathspec.

Los tres casos en los que el mensaje NO viaja en el comando (sin -m, -F fichero,
--amend --no-edit) devuelven vacio a proposito: afirmar algo sobre un texto que
no esta delante seria inventarlo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Encontrar las closing keywords

**Files:**
- Modify: `scripts/closing-keywords.js`
- Test: `__tests__/f27-closing-keywords.test.js`

**Interfaces:**
- Consumes: nada (función independiente).
- Produces: `findClosingKeywords(text: string): Array<{ keyword: string, ref: string }>`

- [ ] **Step 1: Write the failing test**

```js
import { findClosingKeywords, CLOSING_KEYWORDS } from '../scripts/closing-keywords.js'

describe('F27 — findClosingKeywords', () => {
  it('las NUEVE keywords de GitHub, ni una mas ni una menos', () => {
    expect(CLOSING_KEYWORDS).toEqual([
      'close', 'closes', 'closed',
      'fix', 'fixes', 'fixed',
      'resolve', 'resolves', 'resolved',
    ])
  })

  it('cada una de las nueve dispara', () => {
    for (const k of CLOSING_KEYWORDS) {
      expect(findClosingKeywords(`${k} #7`)).toHaveLength(1)
    }
  })

  it('es insensible a mayusculas y admite dos puntos', () => {
    expect(findClosingKeywords('CLOSES #10')).toHaveLength(1)
    expect(findClosingKeywords('Closes: #10')).toHaveLength(1)
    expect(findClosingKeywords('Fixes:#10')).toHaveLength(1)
  })

  it('acepta la forma owner/repo#N', () => {
    const f = findClosingKeywords('Fixes octo-org/octo-repo#100')
    expect(f).toHaveLength(1)
    expect(f[0].ref).toBe('octo-org/octo-repo#100')
  })

  it('devuelve la keyword y la referencia encontradas', () => {
    expect(findClosingKeywords('Closes #451')).toEqual([{ keyword: 'Closes', ref: '#451' }])
  })

  it('caza la keyword dentro de una frase entrecomillada — las comillas NO protegen', () => {
    // Es, palabra por palabra, la forma del commit que cerro el #451 en campo.
    const f = findClosingKeywords('Dos observaciones sobre el kickoff: no dice "Closes #451", y el agente no recibe el spec.')
    expect(f).toEqual([{ keyword: 'Closes', ref: '#451' }])
  })

  // NEGATIVOS
  it('una referencia sin keyword no dispara', () => {
    expect(findClosingKeywords('mira el #42 cuando puedas')).toEqual([])
  })

  it('una keyword sin referencia no dispara', () => {
    expect(findClosingKeywords('closes the door')).toEqual([])
    expect(findClosingKeywords('fixed the flaky test')).toEqual([])
  })

  it('la keyword tiene que ser palabra entera', () => {
    expect(findClosingKeywords('prefix #42')).toEqual([])
    expect(findClosingKeywords('foreclosed #42')).toEqual([])
  })

  it('entrada no-string devuelve lista vacia', () => {
    expect(findClosingKeywords(undefined)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: FAIL — `findClosingKeywords is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// Las closing keywords que GitHub reconoce, verbatim de su documentación. No se
// añade ninguna forma que no esté ahí: una keyword de más aquí es un bloqueo de
// un commit legítimo.
export const CLOSING_KEYWORDS = [
  'close', 'closes', 'closed',
  'fix', 'fixes', 'fixed',
  'resolve', 'resolves', 'resolved',
]

// `\b` a los dos lados: sin él, `prefix #42` y `foreclosed #42` dispararían.
// Los dos puntos son opcionales porque GitHub acepta `Closes: #10` igual que
// `Closes #10`. La referencia es `#N` o `owner/repo#N`.
const CLOSING_RE = new RegExp(
  String.raw`\b(${CLOSING_KEYWORDS.join('|')})\b\s*:?\s*(#\d+|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+)`,
  'gi',
)

/**
 * findClosingKeywords: los pares (keyword, referencia) que GitHub interpretaría
 * como orden de cierre.
 *
 * Devuelve la keyword TAL COMO ESTÁ ESCRITA, no normalizada: el mensaje de la
 * puerta cita el texto del usuario, y «CLOSES» citado como «closes» se lee como
 * si el aviso hablara de otra cosa.
 */
export function findClosingKeywords(text) {
  const src = typeof text === 'string' ? text : ''
  const out = []
  for (const m of src.matchAll(CLOSING_RE)) out.push({ keyword: m[1], ref: m[2] })
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: PASS.

- [ ] **Step 5: Verifica que los negativos PUEDEN fallar (lección 5)**

Rompe a propósito: quita los dos `\b` del regex. El test de «palabra entera» tiene que ponerse **rojo**. Deshaz. Verde.

- [ ] **Step 6: Commit**

```bash
git add scripts/closing-keywords.js __tests__/f27-closing-keywords.test.js
git commit -m "F27: las nueve closing keywords, de la doc de GitHub

Insensibles a mayusculas, con dos puntos opcionales, sobre #N y owner/repo#N.
Palabra entera a los dos lados: sin eso, prefix #42 disparaba.

El test que fija el caso de campo reproduce la frase exacta del commit que cerro
el #451 estando entrecomillada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: El predicado de «repo gobernado»

**Files:**
- Create: `scripts/governed-repo.js`
- Test: `__tests__/f27-closing-keywords.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `probeGovernedRepo(cwd: string): { governed: boolean } | { error: string }` y `CONTRACT_MARKER: string`.

**Lo que hay que no romper:** en un worktree de slice, `.git` es un **fichero**, no un directorio. Un predicado que sólo mirase directorios funcionaría para el coordinador y fallaría en silencio para **todos** los agentes despachados.

- [ ] **Step 1: Write the failing test**

```js
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeGovernedRepo, CONTRACT_MARKER } from '../scripts/governed-repo.js'

describe('F27 — probeGovernedRepo', () => {
  const hechos = []
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'f27-')); hechos.push(d); return d }
  afterAll(() => { for (const d of hechos) { try { chmodSync(d, 0o755) } catch {} ; rmSync(d, { recursive: true, force: true }) } })

  it('un repo con AGENTS.md que lleva el marcador esta gobernado', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), `# AGENTS\n${CONTRACT_MARKER}\ncosas\n`)
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })

  // La mitad de la cobertura de la puerta son los agentes despachados, y todos
  // trabajan en un worktree, donde .git es un FICHERO.
  it('un worktree, cuyo .git es un FICHERO, se reconoce igual', () => {
    const d = tmp()
    writeFileSync(join(d, '.git'), 'gitdir: /otro/sitio/.git/worktrees/2\n')
    writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })

  it('sube desde un subdirectorio hasta la raiz', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
    const sub = join(d, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    expect(probeGovernedRepo(sub)).toEqual({ governed: true })
  })

  it('un repo sin AGENTS.md NO esta gobernado', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    expect(probeGovernedRepo(d)).toEqual({ governed: false })
  })

  it('un AGENTS.md sin el marcador NO esta gobernado', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), '# AGENTS\nsin marcador\n')
    expect(probeGovernedRepo(d)).toEqual({ governed: false })
  })

  it('lo que no es un repo git NO esta gobernado', () => {
    expect(probeGovernedRepo(tmp())).toEqual({ governed: false })
  })

  it('un AGENTS.md ilegible es ERROR, nunca "no gobernado"', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    const f = join(d, 'AGENTS.md')
    writeFileSync(f, CONTRACT_MARKER)
    chmodSync(f, 0o000)
    const r = probeGovernedRepo(d)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('un cwd que no existe es ERROR, nunca "no gobernado"', () => {
    const r = probeGovernedRepo(join(tmpdir(), 'f27-no-existe-jamas', 'x'))
    expect(r.error).toBeTruthy()
  })
})
```

> Nota para el implementador: el test de `chmod 0o000` no discrimina si corres como **root** (root lee igual). Si la suite corre como root, márcalo y dilo; no lo borres en silencio.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: FAIL — no existe `scripts/governed-repo.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// ============================================================================
// governed-repo.js — ¿CORRE ESTE LOOP EN EL REPO DE ESTE cwd?
//
// Es el único sitio de la puerta de closing keywords que toca el disco, y por
// eso vive aparte de closing-keywords.js, que es puro y se testea sin ficheros.
//
// La señal es el marcador que /ct-init siembra en el AGENTS.md del repo: si
// está, este repo tiene el contrato del loop y sus issues los gobierna el loop.
// No se usa `git rev-parse`: subir con `fs` no depende de que `git` esté en el
// PATH ni paga un subproceso.
// ============================================================================
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const CONTRACT_MARKER = '<!-- ct-init:slices-contract -->'

const AGENTS = 'AGENTS.md'

// `.git` puede ser un DIRECTORIO (checkout normal) o un FICHERO con un
// `gitdir:` dentro (worktree). Los agentes despachados trabajan SIEMPRE en un
// worktree, así que mirar sólo directorios dejaría fuera la mitad de la
// cobertura de la puerta, y en silencio.
function isRepoRoot(dir) {
  try { statSync(join(dir, '.git')); return true } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return false
    throw e
  }
}

/**
 * probeGovernedRepo: `{ governed }` cuando se puede afirmar, `{ error }` cuando
 * no se ha podido mirar.
 *
 * La distinción es la que importa: quien llama tiene que poder tratar «no lo
 * sé» distinto de «no». Un `{ governed: false }` inventado sobre una lectura
 * que falló dejaría pasar exactamente el commit que esta puerta existe para
 * parar.
 */
export function probeGovernedRepo(cwd) {
  let dir
  try { dir = resolve(String(cwd || '')) } catch (e) { return { error: `cwd invalido: ${e.message}` } }
  try {
    statSync(dir)
  } catch (e) {
    return { error: `no se ha podido leer el directorio de trabajo (${e.code || e.message})` }
  }
  try {
    for (;;) {
      if (isRepoRoot(dir)) {
        let texto
        try {
          texto = readFileSync(join(dir, AGENTS), 'utf8')
        } catch (e) {
          // Que no HAYA AGENTS.md es una respuesta: este repo no lleva el
          // contrato. Que no se pueda LEER no lo es.
          if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return { governed: false }
          return { error: `no se ha podido leer ${AGENTS} (${e.code || e.message})` }
        }
        return { governed: texto.includes(CONTRACT_MARKER) }
      }
      const padre = dirname(dir)
      if (padre === dir) return { governed: false }
      dir = padre
    }
  } catch (e) {
    return { error: `no se ha podido determinar la raiz del repo (${e.code || e.message})` }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f27-closing-keywords.test.js`
Expected: PASS.

- [ ] **Step 5: Verifica que el caso del worktree PUEDE fallar (lección 5)**

Rompe a propósito: en `isRepoRoot`, cambia `statSync` por una comprobación que exija directorio (`statSync(...).isDirectory()`). El test del worktree tiene que ponerse **rojo**. Deshaz. Verde.

- [ ] **Step 6: Commit**

```bash
git add scripts/governed-repo.js __tests__/f27-closing-keywords.test.js
git commit -m "F27: el predicado de repo gobernado, y el .git que es un fichero

Sube con fs desde el cwd hasta el .git, sin git rev-parse: no depende del PATH
ni paga un subproceso. La senal es el marcador que ct-init siembra en AGENTS.md.

En un worktree .git es un FICHERO, no un directorio, y los agentes despachados
trabajan siempre en un worktree: mirar solo directorios habria dejado fuera la
mitad de la cobertura, y en silencio.

Una lectura que falla devuelve error, nunca \"no gobernado\": inventar el no
dejaria pasar justo el commit que esto existe para parar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: El hook — decisión y mensajes

**Files:**
- Create: `hooks/commit-keyword-guard.js`
- Test: `__tests__/f27-commit-keyword-guard.test.js`

**Interfaces:**
- Consumes: `extractCommitMessages`, `findClosingKeywords`, `probeGovernedRepo`, `CONTRACT_MARKER`.
- Produces: un ejecutable que lee JSON por stdin y escribe `{hookSpecificOutput:{hookEventName,permissionDecision,permissionDecisionReason}}` por stdout, o nada.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTRACT_MARKER } from '../scripts/governed-repo.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = join(root, 'hooks/commit-keyword-guard.js')

const hechos = []
function repoGobernado() {
  const d = mkdtempSync(join(tmpdir(), 'f27g-')); hechos.push(d)
  mkdirSync(join(d, '.git'))
  writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
  return d
}
function repoNormal() {
  const d = mkdtempSync(join(tmpdir(), 'f27n-')); hechos.push(d)
  mkdirSync(join(d, '.git'))
  return d
}
afterAll(() => { for (const d of hechos) { try { chmodSync(d, 0o755) } catch {} ; rmSync(d, { recursive: true, force: true }) } })

function correr(command, cwd, bin = hook) {
  const r = spawnSync('node', [bin], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
  })
  const out = (r.stdout || '').trim()
  return { status: r.status, out, json: out ? JSON.parse(out) : null }
}

describe('F27 — el hook', () => {
  it('repo gobernado + commit con keyword => DENY, nombrando keyword y referencia', () => {
    const r = correr('git commit -m "no dice \\"Closes #451\\" el kickoff"', repoGobernado())
    expect(r.status).toBe(0)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
    const motivo = r.json.hookSpecificOutput.permissionDecisionReason
    expect(motivo).toContain('Closes')
    expect(motivo).toContain('#451')
    expect(motivo).toContain('cuerpo del PR')
  })

  it('repo NO gobernado => sin decision', () => {
    const r = correr('git commit -m "Closes #451"', repoNormal())
    expect(r.status).toBe(0)
    expect(r.out).toBe('')
  })

  // El camino feliz que el contrato EXIGE.
  it('gh pr create con el cierre en el cuerpo => sin decision', () => {
    const r = correr('gh pr create --body "Closes #42"', repoGobernado())
    expect(r.out).toBe('')
  })

  it('commit limpio encadenado con gh pr create => sin decision', () => {
    const r = correr('git commit -m limpio && gh pr create --body "Closes #1"', repoGobernado())
    expect(r.out).toBe('')
  })

  it('un commit sin keyword => sin decision', () => {
    const r = correr('git commit -m "arregla el parser"', repoGobernado())
    expect(r.out).toBe('')
  })

  it('una herramienta que no es Bash => sin decision', () => {
    const r = spawnSync('node', [hook], {
      input: JSON.stringify({ tool_name: 'Write', tool_input: { command: 'git commit -m "Closes #1"' }, cwd: repoGobernado() }),
      encoding: 'utf8',
    })
    expect((r.stdout || '').trim()).toBe('')
  })

  it('stdin malformado => salida vacia, exit 0 (no crash)', () => {
    const r = spawnSync('node', [hook], { input: 'no-json{', encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('')
  })

  // LA propiedad del orden de evaluacion, por efecto y en las DOS direcciones.
  it('camino comun: con un cwd ilegible, un `ls` sale limpio (no se toco el disco)', () => {
    const d = mkdtempSync(join(tmpdir(), 'f27x-')); hechos.push(d)
    const dentro = join(d, 'dentro'); mkdirSync(dentro)
    chmodSync(d, 0o000)
    const r = correr('ls -la', dentro)
    expect(r.status).toBe(0)
    expect(r.out).toBe('')
  })

  it('control: con el MISMO cwd ilegible, un commit con keyword sale ASK (nunca silencio)', () => {
    const d = mkdtempSync(join(tmpdir(), 'f27y-')); hechos.push(d)
    const dentro = join(d, 'dentro'); mkdirSync(dentro)
    chmodSync(d, 0o000)
    const r = correr('git commit -m "Closes #7"', dentro)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('ask')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/f27-commit-keyword-guard.test.js`
Expected: FAIL — no existe `hooks/commit-keyword-guard.js`.

- [ ] **Step 3: Write minimal implementation**

```js
#!/usr/bin/env node
// ============================================================================
// commit-keyword-guard.js — LA PUERTA: UN COMMIT NO SE LLEVA POR DELANTE UN
// ISSUE POR MENCIONAR UNA CLOSING KEYWORD.
//
// GitHub cierra un issue con una closing keyword que aparezca en CUALQUIER
// mensaje de commit que llegue a la rama por defecto, y las comillas NO
// protegen. En un repo real, un commit de DOCUMENTACIÓN cuyo cuerpo mencionaba
// `Closes #451` —dentro de una frase que explicaba que el kickoff no la
// llevaba— cerró ese issue. Nadie quiso cerrar nada.
//
// ES UNA PUERTA Y NO UN AVISO, a propósito: una comprobación cuyo resultado no
// puede detener la acción siguiente es decoración. Y no hay caso legítimo que
// se pierda — el contrato del loop manda el cierre al CUERPO DEL PR, nunca a un
// mensaje de commit.
//
// EL ORDEN DE EVALUACIÓN DE ABAJO NO ES COSMÉTICO. Este hook corre en CADA
// comando Bash de CADA sesión con el plugin cargado. Las dos primeras
// preguntas son parseo puro, sin una sola lectura de disco; sólo el comando que
// ya resultó ser un commit CON keyword paga el I/O de averiguar si el repo está
// gobernado. Un `ls` no toca el disco por culpa de este fichero.
//
// LO QUE NO VE, y está dicho también en el contrato §9: un `git commit`
// tecleado fuera de Claude, uno sin `-m` (abre el editor), un `-F <fichero>` y
// un `--amend --no-edit`. Para todo eso sigue estando el aviso de /ct-next
// sobre issues cerrados por un commit suelto: esto caza la CAUSA, aquello el
// EFECTO, y ninguno de los dos afirma ser completo.
// ============================================================================
import { readFileSync } from 'node:fs'
import { extractCommitMessages, findClosingKeywords } from '../scripts/closing-keywords.js'
import { probeGovernedRepo } from '../scripts/governed-repo.js'

// Un stdin que no es JSON no permite saber ni qué comando es. Salir en silencio
// es lo único honesto: bloquear cada Bash por un fallo de parseo dejaría la
// sesión inservible por un motivo que no es el de esta puerta.
let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }

if (input?.tool_name !== 'Bash') process.exit(0)
const command = input?.tool_input?.command
if (typeof command !== 'string' || !command) process.exit(0)

// (1) y (2): parseo puro, cero I/O.
const mensajes = extractCommitMessages(command)
if (!mensajes.length) process.exit(0)
const hallazgos = mensajes.flatMap(findClosingKeywords)
if (!hallazgos.length) process.exit(0)

// (3): la única lectura de disco, y sólo para un comando que ya es peligroso.
const sonda = probeGovernedRepo(input.cwd || process.cwd())

const decidir = (permissionDecision, permissionDecisionReason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason },
  }))
  process.exit(0)
}

const citado = hallazgos.map((h) => `\`${h.keyword} ${h.ref}\``).join(', ')

if (sonda.error) {
  decidir('ask', `Este mensaje de commit lleva ${citado}, y NO se ha podido comprobar si el loop Control Tower gobierna los issues de este repo: ${sonda.error}. Si los gobierna, ese commit cerrara ${hallazgos.length > 1 ? 'esos issues' : 'ese issue'} al llegar a la rama por defecto, sin que nadie revise ni mergee nada. Decide tu: reformula la frase para que no lleve la cadena literal, o continua si sabes que este repo no esta gobernado.`)
}

if (!sonda.governed) process.exit(0)

decidir(
  'deny',
  `Este mensaje de commit lleva ${citado}. GitHub aplica las closing keywords de CUALQUIER mensaje de commit que llegue a la rama por defecto, y LAS COMILLAS NO PROTEGEN: un commit de documentacion que solo MENCIONABA la cadena cerro el issue en un repo real. En este repo el loop Control Tower gobierna los issues, asi que cerrarlo asi lo daria por entregado sin que nadie haya revisado ni mergeado nada, y liberaria sus dependencias sobre trabajo que puede no existir.\n\n` +
  `El cierre del slice va en el CUERPO DEL PR, no en el mensaje del commit.\n\n` +
  `Que hacer: reescribe la frase sin la cadena literal (por ejemplo «el kickoff no lleva la keyword de cierre» en vez de nombrarla). Si de verdad quieres cerrar el issue, hazlo explicito: \`gh issue close <n> --reason completed\`.`,
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/f27-commit-keyword-guard.test.js`
Expected: PASS.

- [ ] **Step 5: Verifica que la propiedad del orden PUEDE fallar (lección 5)**

Rompe a propósito: mueve la línea `const sonda = probeGovernedRepo(...)` **arriba del todo**, justo detrás de la comprobación de `tool_name`. El test de «con un cwd ilegible, un `ls` sale limpio» tiene que ponerse **rojo**. Deshaz. Verde.

Si NO se pone rojo, párate: significa que el test no está midiendo lo que dice, y hay que arreglar el test antes de seguir.

- [ ] **Step 6: Commit**

```bash
git add hooks/commit-keyword-guard.js __tests__/f27-commit-keyword-guard.test.js
git commit -m "F27: la puerta que deniega el commit con closing keyword

Es una puerta y no un aviso a proposito: una comprobacion cuyo resultado no
puede detener la accion siguiente es decoracion. Y no se pierde ningun caso
legitimo, porque el contrato manda el cierre al cuerpo del PR.

El orden de evaluacion es la parte que importa: las dos primeras preguntas son
parseo puro y solo el comando que ya resulto ser un commit CON keyword paga el
I/O. Hay un test de efecto que lo fija en las dos direcciones, con un cwd
ilegible.

Cuando no se puede saber si el repo esta gobernado la decision es ask, nunca
silencio.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Cableado — `hooks.json`, build, `dist/`, y el test que no podía fallar

**Files:**
- Modify: `hooks/hooks.json`
- Modify: `scripts/build.mjs:23`
- Modify: `__tests__/hooks-json.test.js`
- Create: `dist/commit-keyword-guard.js` (generado)
- Test: `__tests__/f27-commit-keyword-guard.test.js`

**Interfaces:**
- Consumes: el hook de la Task 5.
- Produces: el hook registrado y bundleado, ejecutándose de verdad.

- [ ] **Step 1: Write the failing test**

Primero, hacer genérico el test de `hooks.json` — hoy aplana **sólo** `SessionStart` y `Stop`, así que un hook nuevo cuyo `dist/` no existiera pasaría igual. Reemplaza el `it` de la línea 14 por:

```js
  it('usa ${CLAUDE_PLUGIN_ROOT} y apunta a ficheros existentes', () => {
    // Genérico sobre TODOS los eventos del fichero, no sobre una lista escrita a
    // mano: enumerarlos aquí hacía que un hook nuevo quedara sin comprobar y el
    // test siguiera verde — es decir, un test que no podía fallar.
    const cmds = Object.values(h.hooks).flat().flatMap((e) => e.hooks).map((x) => x.command)
    expect(cmds.length).toBeGreaterThan(0)
    for (const c of cmds) {
      expect(c).toContain('${CLAUDE_PLUGIN_ROOT}')
      const rel = c.replace('node ${CLAUDE_PLUGIN_ROOT}/', '').trim()
      expect(existsSync(join(root, rel))).toBe(true)
    }
  })
```

Y añade al final de `__tests__/hooks-json.test.js`:

```js
  it('registra el PreToolUse de la puerta de closing keywords, sobre Bash', () => {
    const pre = h.hooks.PreToolUse
    expect(pre).toBeTruthy()
    const sobreBash = pre.filter((e) => e.matcher === 'Bash')
    expect(sobreBash.length).toBeGreaterThan(0)
    expect(JSON.stringify(sobreBash)).toContain('commit-keyword-guard.js')
  })
```

Y añade al fichero de test del hook un caso end-to-end contra el **bundle**:

```js
  it('el BUNDLE de produccion decide igual que el fuente', () => {
    const bundle = join(root, 'dist/commit-keyword-guard.js')
    const r = correr('git commit -m "Closes #451"', repoGobernado(), bundle)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/hooks-json.test.js __tests__/f27-commit-keyword-guard.test.js`
Expected: FAIL — no hay `PreToolUse` en `hooks.json` y no existe `dist/commit-keyword-guard.js`.

- [ ] **Step 3: Write minimal implementation**

`hooks/hooks.json` — añade el evento:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/commit-keyword-guard.js", "timeout": 5 } ] }
    ],
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact",
        "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/session-start.js" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node ${CLAUDE_PLUGIN_ROOT}/dist/stop.js", "timeout": 10 } ] }
    ]
  }
}
```

`scripts/build.mjs:23` — añade el entry point:

```js
  entryPoints: ['hooks/session-start.js', 'hooks/stop.js', 'hooks/commit-keyword-guard.js'],
```

Construye:

```bash
npm run build
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run __tests__/hooks-json.test.js __tests__/f27-commit-keyword-guard.test.js __tests__/bundle.test.js __tests__/dist-coherente-con-fuentes.test.js > /tmp/f27-t6.log 2>&1; echo $?
```
Lee `/tmp/f27-t6.log`. Expected: todo verde. `bundle.test.js` confirma que el bundle sólo importa builtins `node:*`; `dist-coherente-con-fuentes.test.js` confirma que el `dist/` commiteado corresponde a los fuentes.

- [ ] **Step 5: Verifica que el test genérico PUEDE fallar (lección 5)**

Rompe a propósito: en `hooks.json`, cambia el comando del guard a `dist/no-existe.js`. El test genérico tiene que ponerse **rojo** (con la versión vieja, escrita a mano, habría seguido verde — que es justo el defecto que se corrige). Deshaz, reconstruye si hace falta, verde.

- [ ] **Step 6: Commit**

```bash
git add hooks/hooks.json scripts/build.mjs dist/commit-keyword-guard.js __tests__/hooks-json.test.js __tests__/f27-commit-keyword-guard.test.js
git commit -m "F27: registrar y bundlear la puerta, y arreglar un test que no podia fallar

hooks-json.test.js aplanaba SOLO SessionStart y Stop para comprobar que cada
comando apunta a un dist existente. Con un hook nuevo habria pasado igual aunque
su bundle no existiera. Ahora recorre todos los eventos del fichero.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: El contrato §9 — la regla de las puertas, v12 → v13

**Files:**
- Modify: `scripts/ct-init.sh` (bloque del contrato; `SLICES_CONTRACT_VERSION:272`; `SLICES_PRISTINE_HASHES:308-328`; la advertencia de `:623-629`)
- Test: `__tests__/ct-init.test.js` (los que ya existen; no hay que escribir autovigilancias nuevas)

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces: contrato v13 en el `AGENTS.md` de todo repo que se actualice.

- [ ] **Step 1: Escribe la regla en el contrato**

En el bloque del contrato, el último bullet termina hoy diciendo que el loop no impide mergear un PR con su gate sin cerrar, y «El que cierra el gate eres tú.» Añade justo detrás, dentro del mismo bullet:

```
  **Y por eso tus comprobaciones previas al merge tienen que ser PUERTAS.**
  Verifica el EFECTO, nunca el exit code: si el resultado de una comprobación no
  puede detener el merge, no es una comprobación, es decoración. En campo, una
  comprobación de contaminación del estado imprimió `1` y el merge entró igual —
  hubo que arreglar la rama por defecto a posteriori—; la misma comprobación,
  convertida en puerta, paró el siguiente. Vale para todo lo que mires antes de
  mergear, no sólo para los gates: si lo compruebas a mano, que el resultado
  mande.
```

- [ ] **Step 2: Barre la advertencia que este cambio vuelve incompleta**

`scripts/ct-init.sh:628-629` dice hoy «Cuidado con escribir esas keywords en cualquier commit, aunque sea entrecomillándolas.» Escrito cuando nada protegía. Sustitúyelo por:

```
    Cuidado con escribir esas keywords en cualquier commit, aunque sea
    entrecomillándolas. El plugin **bloquea** el commit cuando la keyword viaja
    en el mensaje (`-m`) de un `git commit` lanzado desde una sesión de Claude,
    en un repo que tenga esta sección en su `AGENTS.md`. Lo que esa puerta **no
    ve**, y por tanto sigue siendo tuyo: un `git commit` tecleado fuera de
    Claude, uno **sin** `-m` (el mensaje lo pone el editor), un `-F <fichero>` y
    un `--amend --no-edit`. Para lo que se escape sigue estando el aviso de
    `/ct-next` de aquí arriba: eso caza el EFECTO, la puerta caza la CAUSA, y
    ninguno de los dos lo caza todo.
```

- [ ] **Step 3: Sube la versión y documenta el porqué**

En `scripts/ct-init.sh:272`, `SLICES_CONTRACT_VERSION=13`. Y añade encima, siguiendo el estilo de los bloques de F23/F22, un comentario que diga **qué deduce mal quien se quede en la v12**:

```
# F27 sube de 12 a 13, y por el mismo criterio de siempre: el v12 no describe mal
# el flujo, CALLA dos cosas que ahora existen. (a) No dice que las comprobaciones
# previas al merge tienen que ser puertas — la regla más útil del periodo de
# campo, que salió de un merge que entró con la comprobación imprimiendo `1`.
# (b) Dice «cuidado con escribir esas keywords en cualquier commit» como si nada
# protegiera, cuando el plugin ya bloquea el caso mayoritario, y no dice cuáles
# son los cuatro que se le escapan. Un repo con el v12 no puede deducir ninguna
# de las dos, y la segunda es peor que el silencio: lee «vigila tú» donde ya hay
# una puerta, y no sabe dónde NO la hay.
```

- [ ] **Step 4: Corre los tests del contrato y deja que te dicten el hash**

```bash
npx vitest run __tests__/ct-init.test.js > /tmp/f27-t7.log 2>&1; echo $?
```

Lee `/tmp/f27-t7.log`. Va a fallar el test «el hash del bloque que se siembra HOY está registrado en SLICES_PRISTINE_HASHES», y **el mensaje del fallo trae el hash**. No lo calcules a ojo ni te lo inventes.

- [ ] **Step 5: Añade el hash nuevo, sin sustituir ninguno**

Al final de `SLICES_PRISTINE_HASHES` (después de la línea de la v12), añade una línea con el formato de las demás:

```
<hash-que-dio-el-test>  v13, <N> líneas — F27 (las comprobaciones previas al merge son puertas; la puerta de closing keywords y sus límites)
```

**Nunca sustituyas un hash viejo.** Sin el de una variante anterior, los repos sembrados con ella dejan de reconocerse y `--update-slices-contract` los acusa de haber editado el bloque a mano.

- [ ] **Step 6: Verifica el mecanismo entero**

```bash
npx vitest run __tests__/ct-init.test.js > /tmp/f27-t7b.log 2>&1; echo $?
```

Expected: verde, incluidos «TODO bloque que ct-init emitió alguna vez, intacto, se actualiza con `--update-slices-contract` sin `--force` y sin acusar a nadie», «todo bloque que ct-init emitió alguna vez en la historia está registrado» y «SLICES_PRISTINE_HASHES no registra hashes de bloques que no existieron nunca».

- [ ] **Step 7: Commit**

```bash
git add scripts/ct-init.sh
git commit -m "F27: el contrato dice que las comprobaciones previas al merge son puertas (v13)

Es el punto 3 del 7.3 del feedback: la regla en el sitio donde el coordinador va
a leerla. Estaba escrita en commands/ct-next.md, pero como justificacion de una
puerta del despacho, y el fallo real fue mergeando. No estaba en el contrato, que
es lo que llega al AGENTS.md del repo gobernado.

Se ancla al final del bullet que ya dice que el loop no impide mergear un PR con
su gate sin cerrar: la regla se deduce de esa frase.

Y se barre la advertencia sobre closing keywords, que pedia una vigilancia que ya
no toca entera y callaba que ahora hay una puerta — mas los cuatro casos que esa
puerta no ve.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: El segundo sitio y el resto del barrido

**Files:**
- Modify: `commands/ct-status.md:41`
- Modify: `.claude-plugin/plugin.json`
- Test: la suite entera

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la ronda cerrada y coherente.

- [ ] **Step 1: La regla en `/ct-status`, donde se decide mergear**

En `commands/ct-status.md`, el bloque `ENTREGADO, ESPERANDO MERGE` acaba diciendo que lo único que hay que hacer con ese bloque es mergear los PRs. Añade a continuación, dentro del mismo párrafo:

```
Y una regla que este informe no puede aplicar por ti: **lo que compruebes antes de mergear tiene que poder detener el merge.** Este comando imprime; no bloquea nada. Si lo usas como paso previo a un merge, el que decide eres tú — y una comprobación cuyo resultado no detiene la acción siguiente es decoración, no comprobación.
```

- [ ] **Step 2: `plugin.json` — descripción y versión**

La `description` enumera lo que hace el plugin y no menciona la puerta. Sustituye el fichero por:

```json
{
  "name": "control-tower-loop",
  "description": "Loop agéntico portable: hidratación por SessionStart, estado en .agent/ (STATE.md la coordinadora, SLICE.md cada slice), gates, dispatch, informe de estado del loop (/ct-status: qué está en vuelo, qué ha entregado y qué es residuo) y una puerta que impide que un mensaje de commit cierre un issue por mencionar una closing keyword. Sistema Control Tower.",
  "version": "0.26.0",
  "author": { "name": "José Agüera" },
  "license": "MIT"
}
```

- [ ] **Step 3: Barre la zona entera, no la línea señalada**

Busca frases que esta ronda haya vuelto falsas y que nadie haya tocado todavía:

```bash
grep -rn -i "closing keyword\|Closes #" commands/ scripts/ hooks/ __tests__/ --include="*.md" --include="*.js" --include="*.mjs" --include="*.sh" > /tmp/f27-barrido.txt 2>&1
grep -rn "manifest\|version" __tests__/manifest.test.js >> /tmp/f27-barrido.txt 2>&1
```

Lee `/tmp/f27-barrido.txt` y comprueba una por una: ¿alguna afirma que **nada** comprueba las closing keywords, o enumera los hooks del plugin sin el nuevo? Arregla las que lo hagan. Presta atención especial a `__tests__/f18-lo-que-desaparece.test.js`, que fija texto del contrato, y a `__tests__/manifest.test.js`, que puede fijar la versión.

- [ ] **Step 4: Suite completa, sin tubería**

```bash
npx vitest run > /tmp/f27-final.log 2>&1; echo "EXIT=$?"
tail -6 /tmp/f27-final.log
```

Expected: **exit 0**, y el número de ficheros y tests **por encima** de la línea base (57 / 1595). Si algún test viejo se pone rojo, no lo toques hasta entender **qué frase** volviste falsa: es el defecto que más veces aparece en este repo.

- [ ] **Step 5: Commit**

```bash
git add commands/ct-status.md .claude-plugin/plugin.json
git commit -m "F27: la regla en el segundo antes del merge, y la descripcion al dia

ct-status es donde el coordinador esta parado justo antes de mergear, y el
comando solo imprime: si se usa como paso previo, quien decide es el humano. Eso
se dice ahi mismo.

Y la description del plugin enumeraba lo que hace sin la puerta nueva.

Plugin 0.26.0.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Cierre de la ronda

- [ ] **Suite verde completa, medida sin tubería**, por encima de la línea base 57/1595.
- [ ] **`npm run build` limpio** y `dist/` commiteado y coherente (`dist-coherente-con-fuentes.test.js`).
- [ ] **Review de rama completa** (`superpowers:requesting-code-review`): en F26 encontró un defecto que ninguna review de tarea vio, ni el plan, ni la suite. No la saltes.
- [ ] **Verifica tú las reproducciones** de lo que traiga la review antes de arreglar nada, y **vuelve a reproducir después** de arreglar: en F26, una seguía rota en un caso que el informe daba por cerrado.
- [ ] **Si un implementador discrepa de una medición, escúchalo.** Acertó las tres veces en F25 y las dos de F26.
