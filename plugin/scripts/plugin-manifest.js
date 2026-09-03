import { readFileSync } from 'node:fs'

export class PluginManifest {
  static PATH = new URL('../package.json', import.meta.url)

  #path

  constructor(path) {
    this.#path = path
    Object.freeze(this)
  }

  static installed() {
    return new PluginManifest(PluginManifest.PATH)
  }

  get version() {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(this.#path, 'utf8'))
    } catch {
      return null
    }
    const { version } = manifest
    return typeof version === 'string' && version.length > 0 ? version : null
  }
}
