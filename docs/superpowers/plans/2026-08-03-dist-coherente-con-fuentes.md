# F24 — el `dist/` commiteado corresponde a los fuentes: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la suite falle cuando el `dist/` commiteado no sea lo que producen los fuentes commiteados — hoy nada lo comprueba, y `npm test` reconstruye antes de correr, así que la suite queda verde sobre un bundle obsoleto.

**Architecture:** un test que reconstruye los fuentes de HEAD en un directorio temporal y compara con el `dist/` de HEAD. No lee el árbol de trabajo en ningún punto. La configuración de build se **importa** del `build.mjs` de HEAD en vez de duplicarse, lo que exige exportarla — la única modificación de producción de F24.

**Tech Stack:** Node ESM, vitest, esbuild, git (`archive`, `show`, `ls-tree`, `log`, `diff`).

**Spec:** `docs/superpowers/specs/2026-08-03-dist-coherente-con-fuentes-design.md`

## Global Constraints

- **Worktree:** todo el trabajo va en `/Users/jpereag/Documents/control-tower-plugin-f24`, rama `f24-coherencia-dist`. NUNCA sobre `main`.
- **Idioma: castellano** en todo comentario, mensaje de usuario, descripción de test y mensaje de commit. Convención del repo entero, sin excepciones.
- **Los comentarios son documentación con carga estructural.** Nunca nombres un fichero, función, línea o conducta que no hayas leído y verificado. Si un comentario de este plan cita algo, compruébalo antes de copiarlo; si no existe, párate y repórtalo. En la ronda anterior esto costó tres fix rounds, dos de ellos porque el propio plan afirmaba conductas inexistentes.
- **Verifica el efecto, nunca el exit code.** Una comprobación que no puede detener la acción siguiente es decoración.
- **Audita por propiedad, nunca por lista.** Es literalmente el objeto de este test: compara el directorio `dist/` entero en las dos direcciones, no una lista de dos ficheros.
- **Nunca un skip silencioso.** Cuando el test no pueda responder, falla nombrando el motivo.
- Suite: `npx vitest run` desde la raíz del worktree. Estado de partida: **51 ficheros, 1428 tests, verde**.

## Hechos verificados empíricamente (no los re-deduzcas, pero puedes re-comprobarlos)

Se prototipó la mecánica antes de escribir este plan. Cinco hallazgos, tres de ellos habrían hecho fracasar una implementación ingenua:

1. **`git archive HEAD | tar -x -C <tmp>` funciona** y extrae también `dist/`. Hay que **borrar `<tmp>/dist` después del archive**: si no, los ficheros que HEAD tiene y el build ya no produce seguirían ahí y la comparación de conjunto no detectaría un sobrante.
2. **`node_modules` hay que COPIARLO, no enlazarlo.** esbuild empotra las rutas de los inputs dentro del bundle (como comentarios `// node_modules/yaml/...` y como claves del shim `__commonJS`). Con un symlink, esbuild resuelve a la ruta real fuera del temporal y el bundle sale con `../../../../../../../Users/...` incrustado: **10 KB de diferencia** sobre 273 KB, y la comparación byte a byte es imposible. `cp -R` de los 45 MB tarda **0,66 s**.
3. **`preserveSymlinks: true` también produce salida idéntica, y aun así se descarta**: es una opción que el build real no tiene, hoy es inocua por casualidad, y el día que exista una dependencia enlazada legítima el test compararía dos configuraciones distintas afirmando identidad byte a byte.
4. **`absWorkingDir` + `metafile: true` no alteran la salida**: con `node_modules` copiado, los DOS bundles salen byte a byte idénticos a los de HEAD. El test será verde sobre el HEAD actual.
5. **El guard de CLI necesita `process.argv[1] &&`**: con `node -e`, `process.argv[1]` es `undefined` y `pathToFileURL(undefined)` lanza `ERR_INVALID_ARG_TYPE`.

Datos de hoy, útiles para reconocer si algo se ha movido bajo los pies:
- inputs reales del bundle, sin `node_modules`: **`hooks/session-start.js`, `hooks/stop.js`, `scripts/state-paths.js`, `scripts/state.js`** — y sólo esos cuatro. Un diagnóstico que mirase `scripts/` entero daría falsos positivos.
- último commit que tocó `dist/`: **`86e92af`** (de F22 — F23 tocó cinco ficheros de `scripts/` y ninguno entra al bundle).

---

### Task 1: `scripts/build.mjs` exporta su configuración

**Files:**
- Modify: `scripts/build.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `export const buildOptions` — el objeto de opciones que hoy está inline en la llamada a `build()`. Mismo contenido, sin añadir ni quitar campos. El módulo sigue construyendo cuando se ejecuta como CLI (`node scripts/build.mjs`), y **no** construye cuando se importa.

- [ ] **Step 1: Leer el fichero entero antes de tocarlo**

`scripts/build.mjs` tiene un comentario de cabecera largo que explica por qué el banner `createRequire` es imprescindible (la librería `yaml` usa `require()` internamente y el bundle ESM revienta sin él). **Ese comentario se conserva íntegro.**

- [ ] **Step 2: Aplicar el refactor**

El fichero pasa a:

```js
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'

// buildOptions se exporta (F24) para que haya UNA sola fuente de verdad de la
// configuración de build. __tests__/dist-coherente-con-fuentes.test.js la
// importa para reconstruir los fuentes de HEAD y comparar el resultado con el
// `dist/` commiteado; si el test llevara su propia copia de estas opciones,
// esa copia se quedaría atrás en silencio y daría verde sobre una
// configuración que ya no es la del proyecto.
export const buildOptions = {
  entryPoints: ['hooks/session-start.js', 'hooks/stop.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
}

// Construye solo al EJECUTARSE (`npm run build`), nunca al importarse — el
// test importa este módulo y no debe disparar un build como efecto colateral.
// La guarda de `process.argv[1]` no es defensiva de más: bajo `node -e` ese
// valor es `undefined` y `pathToFileURL` lanza ERR_INVALID_ARG_TYPE.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build(buildOptions)
}
```

El comentario de cabecera existente (el del banner) se queda donde está, encima de todo.

- [ ] **Step 3: Verificar el EFECTO del refactor, no que no dé error**

Run:
```bash
npm run build && git status --porcelain dist/
```
Expected: la segunda orden no imprime **nada**. Eso demuestra que el build sigue produciendo exactamente los mismos bytes que ya estaban commiteados. Un `npm run build` que sale 0 no prueba nada por sí solo.

- [ ] **Step 4: Verificar que importar NO construye**

Run:
```bash
rm -f /tmp/f24-probe.txt && node --input-type=module -e "
import { buildOptions } from './scripts/build.mjs'
console.log('exports ok:', Array.isArray(buildOptions.entryPoints), buildOptions.entryPoints.join(','))
"
```
Expected: imprime `exports ok: true hooks/session-start.js,hooks/stop.js` y **no** reconstruye nada. Confírmalo con `git status --porcelain dist/` inmediatamente después: sigue vacío.

- [ ] **Step 5: La suite completa sigue verde**

Run: `npx vitest run`
Expected: 51 ficheros, 1428 tests, verde. `bundle.test.js` sigue pasando (construye vía `npm test`… ojo: `npx vitest run` **no** reconstruye; si `bundle.test.js` fallara, es señal de que el refactor rompió el build, no de un fallo del test).

- [ ] **Step 6: Commit**

```bash
git add scripts/build.mjs
git commit -m "F24: build.mjs exporta su configuración, y solo construye como CLI

Una sola fuente de verdad para las opciones de build: el test de coherencia de
F24 las importa en vez de duplicarlas, porque una copia se queda atrás en
silencio y da verde sobre una configuración que ya no es la del proyecto.

La guarda de process.argv[1] no es defensiva de más: bajo \`node -e\` ese valor
es undefined y pathToFileURL lanza ERR_INVALID_ARG_TYPE.

Verificado por efecto: npm run build deja git status --porcelain dist/ vacío.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: el comprobador y el camino verde

**Files:**
- Create: `__tests__/dist-coherente-con-fuentes.test.js`

**Interfaces:**
- Consumes: `buildOptions` de la Tarea 1 (importado desde el `build.mjs` **del temporal**, no del árbol).
- Produces: dentro del propio fichero de test,
  `async function comprobarDist(root) -> { faltan: string[], sobran: string[], difieren: string[], inputs: string[] }`
  - `faltan`: ficheros que el build produce y que `HEAD:dist/` no tiene.
  - `sobran`: ficheros que `HEAD:dist/` tiene y el build no produce.
  - `difieren`: ficheros presentes en ambos cuyo contenido no coincide byte a byte.
  - `inputs`: rutas relativas de los ficheros del propio repo que entran al bundle (las de `metafile.inputs` que no contienen `node_modules`), ordenadas.
  - Coherente ⇔ los tres primeros arrays vacíos.
  - Lanza (no devuelve) cuando no puede responder: `root` no es un repo git, el archive falla, `scripts/build.mjs` no exporta `buildOptions`, o el build revienta.

- [ ] **Step 1: Escribir el test que falla**

Crear `__tests__/dist-coherente-con-fuentes.test.js`:

```js
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// comprobarDist: responde UNA pregunta — ¿el `dist/` de HEAD es exactamente lo
// que producen los fuentes de HEAD?
//
// El árbol de trabajo no se lee en ningún punto, ni para comparar ni para
// decidir si saltar. De ahí las dos conductas que hacen este test usable:
// verde mientras editas sin commitear (HEAD sigue siendo coherente consigo
// mismo) y rojo en cuanto existe un commit con el bundle obsoleto — que es el
// estado que el defecto produce y que `npm test` enmascara, porque reconstruye
// `dist/` antes de lanzar vitest.
async function comprobarDist(root) {
  const tmp = mkdtempSync(join(tmpdir(), 'ct-dist-'))
  try {
    // 1. Los fuentes de HEAD: TODO lo trackeado, sin lista de rutas. Una lista
    //    es algo que mantener, y se queda atrás en cuanto el bundle empiece a
    //    importar un fichero que nadie añadió a ella.
    execFileSync('sh', ['-c', `git -C "${root}" archive HEAD | tar -x -C "${tmp}"`], { stdio: ['ignore', 'ignore', 'pipe'] })

    // 2. El `dist/` que vino en el archive estorba: lo que quede aquí después
    //    del build tiene que ser EXACTAMENTE lo que el build produce, o un
    //    fichero que HEAD tiene y el build ya no emite pasaría por bueno.
    rmSync(join(tmp, 'dist'), { recursive: true, force: true })

    // 3. node_modules se COPIA, no se enlaza. esbuild empotra la ruta de cada
    //    input dentro del bundle (comentarios y claves del shim __commonJS);
    //    con un symlink resuelve a la ruta real fuera del temporal y el bundle
    //    sale con "../../../..//Users/..." incrustado — 10 KB de diferencia
    //    sobre 273 KB, medidos. `preserveSymlinks: true` también daría bytes
    //    idénticos hoy, y se descartó: es una opción que el build real no
    //    tiene, así que compararía dos configuraciones distintas afirmando
    //    identidad. Un repo sin node_modules (los fabricados de los tests de
    //    más abajo) no necesita la copia.
    const nm = join(root, 'node_modules')
    if (existsSync(nm)) cpSync(nm, join(tmp, 'node_modules'), { recursive: true })

    // 4. La configuración de build de HEAD, IMPORTADA y no duplicada: así, un
    //    cambio en build.mjs sin reconstruir también sale rojo.
    const mod = await import(pathToFileURL(join(tmp, 'scripts/build.mjs')).href)
    if (!mod.buildOptions) throw new Error(`scripts/build.mjs de HEAD no exporta buildOptions`)

    const res = await build({ ...mod.buildOptions, absWorkingDir: tmp, metafile: true })

    // 5. Comparación de CONJUNTO en las dos direcciones, no de una lista.
    const construido = readdirSync(join(tmp, 'dist')).sort()
    const enHead = execFileSync('git', ['-C', root, 'ls-tree', '--name-only', 'HEAD', 'dist/'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).map((p) => p.replace(/^dist\//, '')).sort()

    const faltan = construido.filter((f) => !enHead.includes(f))
    const sobran = enHead.filter((f) => !construido.includes(f))
    const difieren = []
    for (const f of construido.filter((f) => enHead.includes(f))) {
      const nuevo = readFileSync(join(tmp, 'dist', f))
      const viejo = execFileSync('git', ['-C', root, 'show', `HEAD:dist/${f}`], { maxBuffer: 256 * 1024 * 1024 })
      if (Buffer.compare(nuevo, viejo) !== 0) difieren.push(f)
    }

    const inputs = Object.keys(res.metafile.inputs).filter((k) => !k.includes('node_modules')).sort()
    return { faltan, sobran, difieren, inputs }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

describe('el dist/ commiteado corresponde a los fuentes commiteados (F24)', () => {
  it('HEAD es coherente: el bundle commiteado es lo que producen los fuentes commiteados', async () => {
    const { faltan, sobran, difieren } = await comprobarDist(root)
    expect({ faltan, sobran, difieren }).toEqual({ faltan: [], sobran: [], difieren: [] })
  }, 60_000)

  it('los inputs del bundle salen del metafile real, no de una lista escrita a mano', async () => {
    const { inputs } = await comprobarDist(root)
    // Los cuatro de hoy. Si este test se pone rojo porque el bundle importa
    // algo nuevo, la lista de aquí se actualiza — pero el DIAGNÓSTICO de la
    // Tarea 4 no depende de ella: sale del metafile en cada corrida.
    expect(inputs).toEqual([
      'hooks/session-start.js',
      'hooks/stop.js',
      'scripts/state-paths.js',
      'scripts/state.js',
    ])
  }, 60_000)
})
```

- [ ] **Step 2: Ver el comprobador en rojo antes de fiarte de su verde**

Este test **no** tiene un RED clásico: la Tarea 1 ya dejó `buildOptions` exportado y el árbol es coherente, así que en cuanto lo escribas pasa. Un verde que nunca se ha visto rojo no demuestra nada, así que fuérzalo una vez, a mano:

Rompe temporalmente la comparación — cambia `Buffer.compare(nuevo, viejo) !== 0` por `true` — y corre:

Run: `npx vitest run __tests__/dist-coherente-con-fuentes.test.js -t "HEAD es coherente"`
Expected: FAIL, nombrando `session-start.js` y `stop.js` como divergentes. **Deshaz el cambio inmediatamente** y anota en tu informe la salida real del rojo.

La demostración completa de que el comprobador detecta cada modo de fallo por separado es la Tarea 3; esto sólo evita fiarte de un verde que podría venir de un comprobador que no compara nada.

- [ ] **Step 3: Correr y verificar que pasa**

Run: `npx vitest run __tests__/dist-coherente-con-fuentes.test.js`
Expected: PASS, 2 tests. Anota cuánto tarda: se espera ~1-2 s (0,66 s de copia de `node_modules` + ~0,3 s de build).

- [ ] **Step 4: La suite completa**

Run: `npx vitest run`
Expected: 51+1 = **52 ficheros, 1430 tests**, verde.

- [ ] **Step 5: Commit**

```bash
git add __tests__/dist-coherente-con-fuentes.test.js
git commit -m "F24: el dist commiteado se compara contra un build de los fuentes commiteados

hooks.json ejecuta dist/, dist/ está trackeado, y \`npm test\` reconstruye antes
de lanzar vitest: la suite quedaba verde con un bundle commiteado obsoleto. Ya
pasó en F22 y en F23 hubo que comprobarlo cinco veces a mano.

El comprobador no lee el árbol de trabajo en ningún punto, ni para comparar ni
para decidir si saltar: verde mientras editas sin commitear, rojo en cuanto
existe un commit con el bundle obsoleto.

node_modules se copia y no se enlaza: esbuild empotra la ruta de cada input
dentro del bundle, y un symlink resuelve fuera del temporal metiendo 10 KB de
rutas absolutas. Medido.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: demostrar que falla cuando debe

Un test que sólo se ha visto pasar no ha demostrado nada. Esta tarea construye repos git de mentira y comprueba que el comprobador los caza.

**Files:**
- Modify: `__tests__/dist-coherente-con-fuentes.test.js`

**Interfaces:**
- Consumes: `comprobarDist(root)` de la Tarea 2.
- Produces: `function repoDeMentira()` — crea un repo git temporal con un `scripts/build.mjs` que exporta `buildOptions`, un fuente trivial y su bundle, todo commiteado y coherente. Devuelve la ruta. El llamante la borra.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al mismo fichero:

```js
// repoDeMentira: un repo git mínimo y COHERENTE, para poder romperlo a
// propósito. Su scripts/build.mjs no importa esbuild en el tope (a diferencia
// del real): así el comprobador puede importarlo sin que el temporal necesite
// node_modules, y estos tres tests no pagan la copia de 45 MB. El camino que
// sí importa un build.mjs con dependencias reales lo cubre el test de HEAD.
function repoDeMentira() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-falso-'))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'scripts/build.mjs'), [
    "export const buildOptions = {",
    "  entryPoints: ['src/a.js'],",
    "  bundle: true, platform: 'node', format: 'esm', outdir: 'dist',",
    "}",
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'src/a.js'), 'export const x = 1\nconsole.log(x)\n')
  return dir
}

// construirEnRepo: genera el dist del repo de mentira con la MISMA
// configuración que el comprobador leerá después, para que el punto de partida
// sea coherente de verdad y no por casualidad.
async function construirEnRepo(dir) {
  const mod = await import(pathToFileURL(join(dir, 'scripts/build.mjs')).href + `?v=${Date.now()}`)
  await build({ ...mod.buildOptions, absWorkingDir: dir })
}

describe('el comprobador falla cuando debe (F24)', () => {
  it('un fuente cambiado sin regenerar el bundle → lo detecta y nombra el fichero', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })

    // El defecto de F22, reproducido: se cambia el fuente y se commitea SIN
    // regenerar el bundle.
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 999\nconsole.log(x)\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'fuente sin rebuild'], { stdio: 'ignore' })

    const { faltan, sobran, difieren } = await comprobarDist(dir)
    expect(difieren).toEqual(['a.js'])
    expect({ faltan, sobran }).toEqual({ faltan: [], sobran: [] })
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('un fichero que HEAD tiene en dist/ y el build ya no produce → sale como SOBRANTE', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    writeFileSync(join(dir, 'dist/huerfano.js'), '// bundle de un entry point que ya no existe\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'con un sobrante'], { stdio: 'ignore' })

    const { faltan, sobran, difieren } = await comprobarDist(dir)
    expect(sobran).toEqual(['huerfano.js'])
    expect({ faltan, difieren }).toEqual({ faltan: [], difieren: [] })
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('un fichero que el build produce y HEAD no tiene commiteado → sale como FALTANTE', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })

    // Se añade un segundo entry point al build y se commitea sin generar su bundle.
    writeFileSync(join(dir, 'src/b.js'), 'console.log("b")\n')
    writeFileSync(join(dir, 'scripts/build.mjs'), [
      "export const buildOptions = {",
      "  entryPoints: ['src/a.js', 'src/b.js'],",
      "  bundle: true, platform: 'node', format: 'esm', outdir: 'dist',",
      "}",
      '',
    ].join('\n'))
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'entry point nuevo sin bundle'], { stdio: 'ignore' })

    const { faltan, sobran, difieren } = await comprobarDist(dir)
    expect(faltan).toEqual(['b.js'])
    expect({ sobran, difieren }).toEqual({ sobran: [], difieren: [] })
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('el árbol de trabajo sucio NO pone nada rojo: HEAD sigue siendo coherente consigo mismo', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })

    // Edición SIN commitear — el ciclo rojo-verde normal. El test no debe
    // interferir con él: es la conducta que hace este test usable a diario, y
    // sin este caso nadie sabría que se preservó.
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 12345\nconsole.log(x)\n')

    const { faltan, sobran, difieren } = await comprobarDist(dir)
    expect({ faltan, sobran, difieren }).toEqual({ faltan: [], sobran: [], difieren: [] })
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})
```

Añade `mkdirSync, writeFileSync` al import de `node:fs` del principio del fichero.

- [ ] **Step 2: Correr y verificar que fallan por la razón correcta**

Antes de nada, comprueba que fallan si el comprobador fuera trivialmente permisivo. Comenta temporalmente el cuerpo de `difieren` (haz que devuelva `[]` siempre) y corre:

Run: `npx vitest run __tests__/dist-coherente-con-fuentes.test.js -t "sin regenerar el bundle"`
Expected: FAIL — `expected [] to deeply equal [ 'a.js' ]`. **Deshaz el cambio temporal inmediatamente.**

Esto no es ceremonia: un test de detección que nunca se ha visto rojo no ha demostrado que detecte.

- [ ] **Step 3: Correr y verificar que pasan**

Run: `npx vitest run __tests__/dist-coherente-con-fuentes.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 4: La suite completa**

Run: `npx vitest run`
Expected: 52 ficheros, **1434 tests**, verde.

- [ ] **Step 5: Commit**

```bash
git add __tests__/dist-coherente-con-fuentes.test.js
git commit -m "F24: demostrar que el comprobador falla cuando debe

Un test que sólo se ha visto pasar no ha demostrado nada. Sobre repos git
fabricados: el defecto de F22 reproducido (fuente commiteado sin regenerar el
bundle), un sobrante en dist/, un entry point nuevo sin su bundle, y el caso
que hace el test usable a diario — un árbol sucio no pone nada rojo, porque
HEAD sigue siendo coherente consigo mismo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: el diagnóstico y los fallos con motivo

**Files:**
- Modify: `__tests__/dist-coherente-con-fuentes.test.js`

**Interfaces:**
- Consumes: `comprobarDist(root)` (Tarea 2), `repoDeMentira()` y `construirEnRepo(dir)` (Tarea 3).
- Produces: `function explicarIncoherencia(root, { faltan, sobran, difieren, inputs }) -> string` — el mensaje que lee un humano. Distingue **falta un rebuild** de **se movió el toolchain** sin heurística, y termina con el comando exacto que arregla los dos casos.

- [ ] **Step 1: Escribir los tests que fallan**

```js
describe('el diagnóstico distingue las dos causas (F24)', () => {
  it('si algún input cambió desde el último commit que tocó dist/ → dice que falta un rebuild y nombra los ficheros', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 999\nconsole.log(x)\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'fuente sin rebuild'], { stdio: 'ignore' })

    const r = await comprobarDist(dir)
    const msg = explicarIncoherencia(dir, r)
    expect(msg).toMatch(/falta un rebuild/i)
    expect(msg).toMatch(/src\/a\.js/)
    expect(msg).toMatch(/npm run build/)
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('si ningún input cambió → dice que se movió el toolchain y nombra la versión de esbuild', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })
    // Se corrompe el bundle commiteado sin tocar ningún fuente: desde el punto
    // de vista del diagnóstico es indistinguible de "esbuild produce otra cosa".
    writeFileSync(join(dir, 'dist/a.js'), '// bytes que ningún build produce\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'bundle tocado a mano'], { stdio: 'ignore' })

    const r = await comprobarDist(dir)
    expect(r.difieren).toEqual(['a.js'])
    const msg = explicarIncoherencia(dir, r)
    expect(msg).toMatch(/toolchain/i)
    expect(msg).toMatch(/esbuild/)
    expect(msg).not.toMatch(/falta un rebuild/i)
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})

describe('cuando no puede responder, falla con motivo (F24)', () => {
  it('un directorio que no es repo git → lanza nombrando el motivo, no devuelve "coherente"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-nogit-'))
    await expect(comprobarDist(dir)).rejects.toThrow()
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)

  it('un repo cuyo scripts/build.mjs no exporta buildOptions → lanza diciéndolo', async () => {
    const dir = repoDeMentira()
    writeFileSync(join(dir, 'scripts/build.mjs'), '// sin export\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'build.mjs sin export'], { stdio: 'ignore' })
    await expect(comprobarDist(dir)).rejects.toThrow(/buildOptions/)
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run __tests__/dist-coherente-con-fuentes.test.js -t "diagnóstico"`
Expected: FAIL — `explicarIncoherencia is not defined`.

- [ ] **Step 3: Implementar el diagnóstico**

Añadir al fichero, junto a `comprobarDist`:

```js
// explicarIncoherencia: el mensaje que lee un humano. Un fallo tiene dos
// causas posibles y el arreglo es el mismo, pero saber cuál cambia lo que el
// lector cree que ha hecho mal — así que se distinguen sin adivinar.
//
// La lista de inputs sale del metafile REAL de la corrida, no de `scripts/`
// entero: los hooks solo importan scripts/state.js y scripts/state-paths.js,
// así que un cambio en cualquier otro fichero de scripts/ no entra al bundle.
// F23 tocó cinco ficheros de scripts/ y ninguno de ellos; mirar el directorio
// entero habría dicho "cambiaron los fuentes" en falso.
function explicarIncoherencia(root, { faltan, sobran, difieren, inputs }) {
  const partes = ['el dist/ commiteado NO corresponde a los fuentes commiteados:']
  if (faltan.length) partes.push(`  el build produce ficheros que HEAD no tiene commiteados: ${faltan.join(', ')}`)
  if (sobran.length) partes.push(`  HEAD tiene ficheros en dist/ que el build ya no produce: ${sobran.join(', ')}`)
  if (difieren.length) partes.push(`  difieren en contenido: ${difieren.join(', ')}`)

  const ultimoDist = execFileSync('git', ['-C', root, 'log', '-1', '--format=%H', '--', 'dist/'], { encoding: 'utf8' }).trim()
  // `inputs` vacío no puede pasar hoy (el metafile siempre trae al menos los
  // entry points), pero un `git diff -- ` SIN rutas diffea el repo ENTERO, y
  // eso convertiría cualquier commit de documentación en un falso "falta un
  // rebuild". Se corta aquí en vez de confiar en que nunca ocurra.
  if (ultimoDist && inputs.length) {
    const cambiados = execFileSync('git', ['-C', root, 'diff', '--name-only', `${ultimoDist}..HEAD`, '--', ...inputs], { encoding: 'utf8' })
      .split('\n').filter(Boolean)
    if (cambiados.length) {
      partes.push(`  falta un rebuild: estos inputs del bundle cambiaron desde el último commit que tocó dist/ (${ultimoDist.slice(0, 7)}): ${cambiados.join(', ')}`)
    } else {
      const v = esbuildVersion()
      partes.push(`  ningún input del bundle cambió desde el último commit que tocó dist/ (${ultimoDist.slice(0, 7)}) — lo que se movió es el toolchain (esbuild ${v} instalado), o alguien editó el bundle a mano`)
    }
  }
  partes.push('  arreglo, en los dos casos: npm run build && git add dist/ && git commit')
  return partes.join('\n')
}

function esbuildVersion() {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules/esbuild/package.json'), 'utf8')).version
  } catch {
    return '(versión no legible)'
  }
}
```

- [ ] **Step 4: Enganchar el diagnóstico al test de HEAD**

En el test `'HEAD es coherente: …'` de la Tarea 2, sustituir la aserción por una que imprima el diagnóstico cuando falla — un test que dice «expected [] to deeply equal ['stop.js']» no le dice a nadie qué hacer:

```js
  it('HEAD es coherente: el bundle commiteado es lo que producen los fuentes commiteados', async () => {
    const r = await comprobarDist(root)
    const incoherente = r.faltan.length || r.sobran.length || r.difieren.length
    expect(incoherente ? explicarIncoherencia(root, r) : 'coherente').toBe('coherente')
  }, 60_000)
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run __tests__/dist-coherente-con-fuentes.test.js`
Expected: PASS, 10 tests.

- [ ] **Step 6: Comprobar el diagnóstico A MANO sobre el repo real**

No basta con que los tests del repo de mentira pasen. Rompe el `dist/` de verdad, mira el mensaje, y deshaz:

```bash
node --input-type=module -e "
import { execFileSync } from 'node:child_process'
console.log(execFileSync('git', ['log','-1','--format=%h','--','dist/'], {encoding:'utf8'}))
"
```
Luego, en una rama de usar y tirar: cambia una línea de `hooks/stop.js`, commitea sin reconstruir, corre el test, **pega el mensaje real en tu informe**, y borra la rama. El mensaje tiene que nombrar `hooks/stop.js` y decir que falta un rebuild.

- [ ] **Step 7: La suite completa**

Run: `npx vitest run`
Expected: 52 ficheros, **1438 tests**, verde.

- [ ] **Step 8: Commit**

```bash
git add __tests__/dist-coherente-con-fuentes.test.js
git commit -m "F24: el diagnóstico distingue \"falta un rebuild\" de \"se movió el toolchain\"

Sin heurística: la lista de inputs sale del metafile real de la corrida, y se
diffean SÓLO esos inputs entre el último commit que tocó dist/ y HEAD. Mirar
scripts/ entero habría dado falsos positivos — los hooks solo importan
state.js y state-paths.js, y F23 tocó cinco ficheros de scripts/ sin que
ninguno entrara al bundle.

Y cuando no puede responder, lanza: sin repo git, o con un build.mjs que no
exporta buildOptions. Nunca un skip silencioso — este test nace precisamente
de que la suite se quedó verde sin haber comprobado.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: verificación final por propiedad

**Files:** ninguno, salvo lo que las comprobaciones destapen.

- [ ] **Step 1: Suite completa**

Run: `npx vitest run`
Expected: 52 ficheros, 1438 tests, verde. Anota el número real.

- [ ] **Step 2: `npm test` completo, que es lo que corre de verdad**

Run: `npm test`
Expected: verde. Este comando reconstruye `dist/` antes de vitest — es justo el que enmascaraba el defecto, y el test nuevo tiene que seguir siendo verde bajo él (porque no mira el árbol de trabajo).

- [ ] **Step 3: El coste no se ha disparado**

Compara la duración de la suite con la de partida (~100 s). El test nuevo debería añadir ~2-8 s (cada llamada a `comprobarDist` sobre el repo real copia 45 MB de `node_modules`; las de los repos de mentira no copian nada).

Si el aumento es mayor de ~15 s, **repórtalo**: hay dos llamadas a `comprobarDist(root)` sobre el repo real (los dos tests de la Tarea 2) y quizá convenga fusionarlas en una. No lo hagas por tu cuenta sin medir primero.

- [ ] **Step 4: Coherencia `dist/` ↔ fuentes, a mano, por última vez**

Run: `npm run build && git status --porcelain dist/`
Expected: vacío. Es la comprobación que este test viene a sustituir; que coincida con el veredicto del test es la prueba de que el test dice la verdad.

- [ ] **Step 5: Barrido por propiedad**

Run: `grep -rn "dist/" __tests__ scripts hooks package.json | grep -v node_modules`
Expected: enumera **todos** los resultados y confirma que ninguno hace una afirmación sobre `dist/` que este test contradiga, y que ningún otro sitio dependa de que `build.mjs` tuviera sus opciones inline. Cualquier hallazgo que no esté previsto se anota, no se ignora.

- [ ] **Step 6: Commit de cierre si algo cambió**

Si los pasos 1-5 no destaparon nada, no hay commit y es el resultado esperado.
