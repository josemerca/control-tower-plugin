import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('plugin manifest', () => {
  it('plugin.json tiene name y version', () => {
    const m = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    expect(m.name).toBe('control-tower-loop')
    expect(m.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
  // La versión vive en DOS ficheros porque dos consumidores distintos la leen:
  // Claude Code lee `.claude-plugin/plugin.json` y npm lee `package.json`. Nada
  // en el runtime obliga a que coincidan, y durante mucho tiempo no coincidieron
  // (0.1.0 contra 0.2x): quien abría el repo y miraba el `package.json` primero
  // se llevaba una versión que no era la del plugin. Este test es lo que hace
  // que el duplicado no pueda divergir en silencio — si hay que repetir una
  // verdad en dos sitios, algo tiene que atarlos.
  it('package.json y plugin.json declaran la MISMA version', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.version).toBe(plugin.version)
  })
  // TERCER SITIO donde vive la misma version, y por el mismo motivo que los dos
  // de arriba: `.release-please-manifest.json` es el estado desde el que
  // release-please calcula el siguiente numero. Si ese fichero dijera una
  // version distinta de la que el plugin declara, la primera release posterior
  // saltaria desde un punto que nunca existio — y lo haria en silencio, porque
  // release-please no lee `plugin.json`, lo ESCRIBE. El manifiesto vive en la
  // raiz del repo, fuera de lo que se distribuye, igual que marketplace.json.
  it('el manifiesto de release-please parte de la version que el plugin declara', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(join(root, '..', '.release-please-manifest.json'), 'utf8'))
    expect(manifest.plugin).toBe(plugin.version)
  })
  // Y un CUARTO fichero del propio plugin la repite: `package-lock.json` copia
  // la version de `package.json` en dos sitios, y npm no la sincroniza sola —
  // se quedo en 0.54.0 mientras el plugin ya iba por la 0.56.0, dos releases
  // por detras, sin que nada se quejara. A release-please le da igual (reescribe
  // los tres), pero un lockfile que miente es lo que lee quien clona el repo
  // hoy, antes de la primera release.
  it('el lockfile copia la version del package.json que lo genero', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
  })
  it('el README que se distribuye anuncia la version que se instala', () => {
    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
    const readme = readFileSync(join(root, 'README.md'), 'utf8')
    expect(
      readme.includes(`\`${plugin.version}\``),
      `README.md no nombra la version ${plugin.version}: quien lo lee se lleva otra`
    ).toBe(true)
  })
  // El marketplace vive en la RAÍZ DEL REPO, no en la del plugin: desde que el
  // plugin se mudó a `plugin/`, el `source` de su entrada es LO QUE DECIDE qué
  // se distribuye (el subdir entero, y nada fuera de él). backend/ y frontend/
  // quedan fuera de la instalación precisamente porque ese campo dice
  // "./plugin" — si alguien lo devuelve a "./", cada instalación volvería a
  // llevarse el repo completo, y este test es el único que lo notaría.
  it('marketplace.json referencia el plugin y distribuye solo plugin/', () => {
    const mk = JSON.parse(readFileSync(join(root, '..', '.claude-plugin/marketplace.json'), 'utf8'))
    const entry = mk.plugins.find((p) => p.name === 'control-tower-loop')
    expect(entry).toBeDefined()
    expect(entry.source).toBe('./plugin')
  })
})
