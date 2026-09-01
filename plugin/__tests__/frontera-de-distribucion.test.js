import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

class Frontier {
  static ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  static SKIPPED_DIRECTORIES = ['node_modules', '.git']
  static SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs']
  static README = 'README.md'
  static LICENSE = 'LICENSE'

  static #SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"])([^'"]+)\1/g
  static #LINK = /\[[^\]]*\]\(([^)\s]+)\)/g
  static #EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i

  static filesUnder(directory = Frontier.ROOT) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        return Frontier.SKIPPED_DIRECTORIES.includes(entry.name) ? [] : Frontier.filesUnder(full)
      }
      return [relative(Frontier.ROOT, full)]
    })
  }

  static sourcesUnder() {
    return Frontier.filesUnder().filter((file) =>
      Frontier.SOURCE_EXTENSIONS.includes(extname(file))
    )
  }

  static #specifiersIn(source) {
    return [...source.matchAll(Frontier.#SPECIFIER)].map((found) => found[2])
  }

  static escapingSpecifiersInSource(source, from) {
    return Frontier.#specifiersIn(source).filter((specifier) => {
      if (specifier.startsWith('/')) return true
      if (!specifier.startsWith('.')) return false
      return relative(Frontier.ROOT, resolve(join(Frontier.ROOT, from), specifier)).startsWith('..')
    })
  }

  static escapesIn(file) {
    return Frontier.escapingSpecifiersInSource(
      readFileSync(join(Frontier.ROOT, file), 'utf8'),
      dirname(file)
    )
  }

  static #targetsIn(source) {
    return [...source.matchAll(Frontier.#LINK)]
      .map((found) => found[1])
      .filter((target) => !Frontier.#EXTERNAL.test(target))
      .map((target) => target.split('#')[0])
      .filter((target) => target !== '')
  }

  static unreachableLinksInSource(source) {
    return [...new Set(Frontier.#targetsIn(source))].filter(
      (target) => !existsSync(join(Frontier.ROOT, target))
    )
  }

  static unreachableLinksInReadme() {
    return Frontier.unreachableLinksInSource(
      readFileSync(join(Frontier.ROOT, Frontier.README), 'utf8')
    )
  }

  static shippedLicenseMatchesTheRepositoryOne() {
    return Buffer.compare(
      readFileSync(join(Frontier.ROOT, Frontier.LICENSE)),
      readFileSync(join(Frontier.ROOT, '..', Frontier.LICENSE))
    ) === 0
  }
}

describe('what the marketplace ships has to stand on its own', () => {
  const sources = Frontier.sourcesUnder()

  it('the census walks the tree so a new source is covered without anyone listing it', () => {
    expect(sources).toContain(join('scripts', 'ct-next.mjs'))
    expect(sources).toContain(join('scripts', 'state.js'))
    expect(sources).toContain(join('dist', 'session-start.js'))
    expect(sources).toContain(join('__tests__', 'frontera-de-distribucion.test.js'))
  })

  it('no source imports anything living outside the shipped subtree', () => {
    const escaping = sources
      .flatMap((file) => Frontier.escapesIn(file).map((specifier) => `${file} -> ${specifier}`))

    expect(escaping, 'those imports resolve outside the plugin and break on every install').toEqual([])
  })

  it('the import detector really fires on a climb out of the subtree', () => {
    expect(Frontier.escapingSpecifiersInSource("import { Api } from '" + "../../backend/src/api-server.js'", 'scripts'))
      .toEqual(['../../backend/src/api-server.js'])
    expect(Frontier.escapingSpecifiersInSource("import { parseState } from './state.js'", 'scripts'))
      .toEqual([])
    expect(Frontier.escapingSpecifiersInSource("import { readFileSync } from 'node:fs'", 'scripts'))
      .toEqual([])
  })

  it('the import detector really fires on an absolute path, which no install can honour', () => {
    expect(Frontier.escapingSpecifiersInSource("const state = require('" + "/Users/someone/repo/scripts/state.js')", 'hooks'))
      .toEqual(['/Users/someone/repo/scripts/state.js'])
  })

  it('every relative link of the shipped README lands on something that ships with it', () => {
    expect(
      Frontier.unreachableLinksInReadme(),
      'those links point outside the plugin: they are dead on GitHub and dead in every install'
    ).toEqual([])
  })

  it('the license that ships is the very one the repository declares, byte for byte', () => {
    expect(
      Frontier.shippedLicenseMatchesTheRepositoryOne(),
      'the plugin travels alone and MIT asks it to carry its own copy, so the two exist on purpose: what they cannot do is drift'
    ).toBe(true)
  })

  it('the link detector really fires on a target left behind by the move', () => {
    expect(Frontier.unreachableLinksInSource('see [the long one](docs/loop/control-tower-loop.pdf)'))
      .toEqual(['docs/loop/control-tower-loop.pdf'])
    expect(Frontier.unreachableLinksInSource('see [the fork](skills/FORK.md)')).toEqual([])
    expect(Frontier.unreachableLinksInSource('see [the repo](https://github.com/josemerca/control-tower-plugin)'))
      .toEqual([])
  })
})
