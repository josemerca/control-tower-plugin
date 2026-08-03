import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, cpSync, mkdirSync, writeFileSync } from 'node:fs'
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
    //    identidad. Un repo que no tenga node_modules no necesita la copia: sin
    //    dependencias npm que resolver, esbuild no empotra ninguna ruta de
    //    paquete en el bundle.
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
    // algo nuevo, la lista de aquí se actualiza — pero nada más depende de
    // ella: la lista de inputs que usa el diagnóstico sale del metafile en
    // cada corrida, no de este literal.
    expect(inputs).toEqual([
      'hooks/session-start.js',
      'hooks/stop.js',
      'scripts/state-paths.js',
      'scripts/state.js',
    ])
  }, 60_000)
})

// repoDeMentira: un repo git mínimo y COHERENTE, para poder romperlo a
// propósito. Su scripts/build.mjs no importa esbuild en el tope (a diferencia
// del real): así el comprobador puede importarlo sin que el temporal necesite
// node_modules, y estos cuatro tests no pagan la copia de 45 MB. El camino que
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

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect(difieren).toEqual(['a.js'])
      expect({ faltan, sobran }).toEqual({ faltan: [], sobran: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('un fichero que HEAD tiene en dist/ y el build ya no produce → sale como SOBRANTE', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    writeFileSync(join(dir, 'dist/huerfano.js'), '// bundle de un entry point que ya no existe\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'con un sobrante'], { stdio: 'ignore' })

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect(sobran).toEqual(['huerfano.js'])
      expect({ faltan, difieren }).toEqual({ faltan: [], difieren: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect(faltan).toEqual(['b.js'])
      expect({ sobran, difieren }).toEqual({ sobran: [], difieren: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect({ faltan, sobran, difieren }).toEqual({ faltan: [], sobran: [], difieren: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
