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
