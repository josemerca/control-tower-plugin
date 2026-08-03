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
    //
    //    Va por un fichero .tar intermedio y NO por una tubería `git archive |
    //    tar -x`, a propósito. En una tubería el exit code que ve el shell es
    //    el de `tar`, no el de `git`: si `root` no es un repo git, `git
    //    archive` falla pero `tar -x` recibe una entrada vacía y sale con 0, y
    //    el pipeline entero informa éxito. El temporal queda vacío y quien
    //    acaba lanzando más abajo es el `import` de scripts/build.mjs, con un
    //    "no encuentro el módulo" que apunta a la causa equivocada. Eso se
    //    arreglaba con `set -o pipefail`, pero `pipefail` NO es POSIX y bajo
    //    dash —que es el `/bin/sh` de Debian y de Ubuntu— aborta con "Illegal
    //    option -o pipefail" y exit 2, tumbando el fichero de tests ENTERO en
    //    esas máquinas, incluido el test que afirma que HEAD es coherente. En
    //    macOS no se notaba: ahí `/bin/sh` es bash en modo sh y sí lo acepta.
    //    Con dos órdenes separadas cada exit code se comprueba
    //    por su cuenta, no hace falta shell alguno (ni interpolar `root` en un
    //    string de shell), y el fallo de `git` llega tal cual al llamante. No
    //    lo "simplifiques" de vuelta a una tubería.
    const tar = join(tmp, 'head.tar')
    execFileSync('git', ['-C', root, 'archive', '--format=tar', '-o', tar, 'HEAD'], { stdio: ['ignore', 'ignore', 'pipe'] })
    execFileSync('tar', ['-xf', tar, '-C', tmp], { stdio: ['ignore', 'ignore', 'pipe'] })
    // El .tar se escribió DENTRO de `tmp`, que es donde va a correr el build:
    // se borra antes de nada para no dejar un intruso en el directorio que
    // luego se compara.
    rmSync(tar, { force: true })

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

// explicarIncoherencia: el mensaje que lee un humano. Un fallo tiene dos
// causas posibles y el arreglo es el mismo, pero saber cuál cambia lo que el
// lector cree que ha hecho mal — así que se distinguen sin adivinar.
//
// La lista de inputs sale del metafile REAL de la corrida, no de `scripts/`
// entero: los hooks solo importan scripts/state.js y scripts/state-paths.js,
// así que un cambio en cualquier otro fichero de scripts/ no entra al bundle.
// Mirar el directorio entero habría dado un falso positivo con cualquier
// cambio en esos otros ficheros, aunque el bundle no dependa de ellos.
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
      const v = esbuildVersion(root)
      partes.push(`  ningún input del bundle cambió desde el último commit que tocó dist/ (${ultimoDist.slice(0, 7)}) — lo que se movió es el toolchain (esbuild ${v} instalado), o alguien editó el bundle a mano`)
    }
  } else {
    // Nunca un skip silencioso, tampoco aquí: cuando el guard corta, el
    // mensaje DICE que no puede dar la causa y por qué, en vez de limitarse a
    // omitirla. Sin esta línea el lector no distingue "se investigó la causa y
    // no salió nada" de "no se pudo investigar".
    const motivo = ultimoDist ? 'el build no declaró ningún input' : 'dist/ no tiene historia en este repo'
    partes.push(`  no se puede determinar la causa: ${motivo}`)
  }
  partes.push('  arreglo, en los dos casos: npm run build && git add dist/ && git commit')
  return partes.join('\n')
}

function esbuildVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules/esbuild/package.json'), 'utf8')).version
  } catch {
    return '(versión no legible)'
  }
}

describe('el dist/ commiteado corresponde a los fuentes commiteados (F24)', () => {
  it('HEAD es coherente: el bundle commiteado es lo que producen los fuentes commiteados', async () => {
    const r = await comprobarDist(root)
    const incoherente = r.faltan.length || r.sobran.length || r.difieren.length
    expect(incoherente ? explicarIncoherencia(root, r) : 'coherente').toBe('coherente')
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

describe('el diagnóstico distingue las dos causas (F24)', () => {
  it('si algún input cambió desde el último commit que tocó dist/ → dice que falta un rebuild y nombra los ficheros', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 999\nconsole.log(x)\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'fuente sin rebuild'], { stdio: 'ignore' })

    try {
      const r = await comprobarDist(dir)
      const msg = explicarIncoherencia(dir, r)
      expect(msg).toMatch(/falta un rebuild/i)
      expect(msg).toMatch(/src\/a\.js/)
      expect(msg).toMatch(/npm run build/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

    try {
      const r = await comprobarDist(dir)
      expect(r.difieren).toEqual(['a.js'])

      // El esbuild de mentira se planta DESPUÉS de comprobarDist y después del
      // último commit, a propósito: así ni entra en el archive de git ni paga
      // la copia de node_modules que comprobarDist hace cuando existe. Lo
      // único que tiene que verlo es esbuildVersion, que corre dentro de
      // explicarIncoherencia.
      //
      // Sin él, la aserción de la versión no valdría nada: la palabra
      // "esbuild" está en el texto fijo de la plantilla del mensaje, así que
      // `toMatch(/esbuild/)` casa igual con "(versión no legible)" —que es lo
      // que salía— y la rama feliz de esbuildVersion se quedaba sin cobertura
      // en ninguna parte, con un `catch` que se traga cualquier error. Exigir
      // el número 9.9.9 sólo puede casar leyendo el package.json de abajo, y
      // de paso demuestra que esbuildVersion lee del repo DIAGNOSTICADO y no
      // del repo real (que tiene otra versión bien distinta).
      mkdirSync(join(dir, 'node_modules/esbuild'), { recursive: true })
      writeFileSync(join(dir, 'node_modules/esbuild/package.json'), JSON.stringify({ version: '9.9.9' }))

      const msg = explicarIncoherencia(dir, r)
      expect(msg).toMatch(/toolchain/i)
      expect(msg).toMatch(/esbuild 9\.9\.9/)
      expect(msg).not.toMatch(/falta un rebuild/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('cuando no puede responder, falla con motivo (F24)', () => {
  it('un directorio que no es repo git → lanza nombrando el motivo, no devuelve "coherente"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-nogit-'))
    try {
      // No basta con "lanza": si el paso 1 dejara escapar el fallo de `git`
      // (como haría una tubería `git archive | tar -x`, cuyo exit code es el de
      // `tar`), este mismo directorio también lanzaría, pero por "Cannot find
      // module .../scripts/build.mjs" — un motivo que apunta a un fichero que
      // falta, no a que `root` no es un repo git. La aserción tiene que
      // distinguir el motivo correcto del que lo enmascara.
      await expect(comprobarDist(dir)).rejects.toThrow(/not a git repository/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('un repo cuyo scripts/build.mjs no exporta buildOptions → lanza diciéndolo', async () => {
    const dir = repoDeMentira()
    writeFileSync(join(dir, 'scripts/build.mjs'), '// sin export\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'build.mjs sin export'], { stdio: 'ignore' })
    try {
      await expect(comprobarDist(dir)).rejects.toThrow(/buildOptions/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
