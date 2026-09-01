import { describe, it, expect } from 'vitest'
import { parseRemote, buildBlobUrl, renderedHtmlHasAnchor, resolveSpecRef, SPEC_REF_REASONS } from '../scripts/spec-link.js'
import { renderSpecLink } from '../scripts/groom.js'

// F10 — la capa que decide QUÉ enlace se escribe en el issue, y cuándo NO se
// escribe ninguno. `run` se inyecta, así que todas las ramas (incluidas las
// de degradación, que en la vida real dependen de que el spec esté o no
// empujado) se prueban sin red y sin repo.

describe('parseRemote — las formas en que git puede devolver el mismo repo', () => {
  const CASOS = [
    ['https://github.com/o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['https://github.com/o/r', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['https://github.com/o/r/', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['https://token@github.com/o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['git@github.com:o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['git@github.com:o/r', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['ssh://git@github.com/o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    // GitHub Enterprise: misma forma de URL de blob. Hardcodear github.com
    // convertiría un enlace perfectamente construible en una degradación.
    ['git@ghe.empresa.com:equipo/proyecto.git', { host: 'ghe.empresa.com', owner: 'equipo', repo: 'proyecto' }],
  ]
  for (const [url, esperado] of CASOS) {
    it(`${url} → ${esperado.owner}/${esperado.repo} en ${esperado.host}`, () => {
      expect(parseRemote(url)).toEqual(esperado)
    })
  }
  it('un remoto que no es una URL reconocible → null (no se adivina)', () => {
    expect(parseRemote('')).toBeNull()
    expect(parseRemote(null)).toBeNull()
    expect(parseRemote('/ruta/local/sin/host')).toBeNull()
  })
})

describe('buildBlobUrl — la URL, y qué se codifica', () => {
  it('la forma normal', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'docs/spec.md', anchor: '9-slices' }))
      .toBe('https://github.com/o/r/blob/main/docs/spec.md#9-slices')
  })
  it('sin ancla, no se emite "#" a secas (un "#" colgante no lleva a ninguna parte)', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'spec.md', anchor: null }))
      .toBe('https://github.com/o/r/blob/main/spec.md')
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'spec.md', anchor: '' }))
      .toBe('https://github.com/o/r/blob/main/spec.md')
  })
  // El paréntesis es EL carácter que rompe la sintaxis `[texto](destino)` de
  // un enlace markdown, y encodeURIComponent no lo escapa por su cuenta.
  // Verificado contra GitHub: con %28/%29 el href sale entero.
  it('espacios y paréntesis en la ruta se codifican (si no, el enlace markdown se corta ahí)', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'docs/plan (v2)/spec.md', anchor: 'a' }))
      .toBe('https://github.com/o/r/blob/main/docs/plan%20%28v2%29/spec.md#a')
  })
  it('la barra de la ruta y de la rama NO se codifica (son separadores, no contenido)', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'release/1.0', path: 'a/b/c.md', anchor: null }))
      .toBe('https://github.com/o/r/blob/release/1.0/a/b/c.md')
  })
})

describe('renderedHtmlHasAnchor — se busca la forma PREFIJADA, que es la que GitHub emite', () => {
  // GitHub emite `id="user-content-9-slices"` y `href="#9-slices"`; su propio
  // JS traduce uno en otro. Buscar la forma sin prefijo en el HTML no
  // encontraría el id.
  const HTML = '<a id="user-content-9-slices" class="anchor" href="#9-slices"></a>'
  it('encuentra el ancla presente', () => {
    expect(renderedHtmlHasAnchor(HTML, '9-slices')).toBe(true)
  })
  it('no encuentra una que no está', () => {
    expect(renderedHtmlHasAnchor(HTML, '9-slices-revisado')).toBe(false)
  })
  it('un ancla que es PREFIJO de otra no cuenta como presente (la comparación es del id completo)', () => {
    expect(renderedHtmlHasAnchor(HTML, '9-slice')).toBe(false)
  })
  it('sin ancla → false (nunca "cualquier cosa vale")', () => {
    expect(renderedHtmlHasAnchor(HTML, '')).toBe(false)
    expect(renderedHtmlHasAnchor(HTML, null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveSpecRef: la secuencia completa, y cada punto en el que se rinde.
// ---------------------------------------------------------------------------

const HEADING = { text: '9. Slices', anchor: '9-slices' }
const OK_HTML = '<a id="user-content-9-slices" class="anchor" href="#9-slices"></a>'

// fakeRun: responde a los cuatro comandos de la secuencia. `fallos` nombra en
// cuál se rinde el intento (el mismo punto en el que se rendiría de verdad:
// spec fuera de repo, sin remoto, gh caído, spec sin empujar).
function fakeRun({ fallos = {}, remote = 'https://github.com/o/r.git', branch = 'main', html = OK_HTML, log = [] } = {}) {
  return (cmd, args) => {
    log.push([cmd, ...args].join(' '))
    if (cmd === 'git' && args.includes('--show-toplevel')) {
      if (fallos.toplevel) throw new Error('not a git repository')
      return '/repo'
    }
    if (cmd === 'git' && args.includes('get-url')) {
      if (fallos.remote) throw new Error('No such remote')
      return remote
    }
    if (cmd === 'gh' && args[0] === 'repo') {
      if (fallos.branch) throw new Error('gh: not found')
      return branch
    }
    if (cmd === 'gh' && args[0] === 'api') {
      if (fallos.contents) throw new Error('gh: Not Found (HTTP 404)')
      return html
    }
    throw new Error(`comando inesperado: ${cmd} ${args.join(' ')}`)
  }
}

const relativize = (root, file) => file.startsWith(`${root}/`) ? file.slice(root.length + 1) : '../fuera.md'

function resolve(opts = {}) {
  const { fallos, remote, branch, html, heading = HEADING, specFile = '/repo/docs/spec.md', log } = opts
  return resolveSpecRef({
    specFile,
    displayPath: 'docs/spec.md',
    heading,
    run: fakeRun({ fallos, remote, branch, html, log }),
    relativize,
  })
}

describe('resolveSpecRef — el camino normal', () => {
  it('spec en un repo con remoto de GitHub, publicado en la rama por defecto, con el ancla presente → URL absoluta con ancla, sin avisos', () => {
    const { ref, warnings } = resolve()
    expect(ref).toEqual({
      path: 'docs/spec.md',
      heading: '9. Slices',
      url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices',
      reason: null,
    })
    expect(warnings).toEqual([])
  })

  // El enlace es a la RAMA POR DEFECTO, no a un sha: el spec es un documento
  // vivo y la detección de divergencia de F5 compara cada issue contra la §9
  // de HOY — un permalink congelaría el enlace en una §9 que puede haber
  // dejado de ser la que la herramienta compara.
  it('la rama es la que declara el repo, no "main" a ciegas', () => {
    const { ref } = resolve({ branch: 'develop' })
    expect(ref.url).toBe('https://github.com/o/r/blob/develop/docs/spec.md#9-slices')
  })

  it('la secuencia de comandos es la esperada: dos de git (locales) y dos de gh (lecturas), en ese orden', () => {
    const log = []
    resolve({ log })
    expect(log).toEqual([
      'git -C /repo/docs rev-parse --show-toplevel',
      'git -C /repo remote get-url origin',
      'gh repo view o/r --json defaultBranchRef -q .defaultBranchRef.name',
      'gh api repos/o/r/contents/docs/spec.md?ref=main -H Accept: application/vnd.github.html',
    ])
  })
})

describe('resolveSpecRef — cuando NO se puede construir un enlace bueno, se dice: nunca se emite uno roto', () => {
  const RENDIDAS = [
    ['el spec no está en un repo git', { fallos: { toplevel: true } }, SPEC_REF_REASONS.notInRepo],
    ['el repo no tiene remoto origin', { fallos: { remote: true } }, SPEC_REF_REASONS.noRemote],
    ['el remoto no es una URL de GitHub reconocible', { remote: '/ruta/local' }, SPEC_REF_REASONS.unparsableRemote],
    ['no se puede resolver la rama por defecto', { fallos: { branch: true } }, SPEC_REF_REASONS.noDefaultBranch],
    ['la rama por defecto viene vacía', { branch: '' }, SPEC_REF_REASONS.noDefaultBranch],
  ]
  for (const [caso, opts, motivo] of RENDIDAS) {
    it(`${caso} → sin url, con motivo y con aviso`, () => {
      const { ref, warnings } = resolve(opts)
      expect(ref.url).toBeNull()
      expect(ref.reason).toBe(motivo)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(motivo)
    })
  }

  // El caso más común de la vida real, con diferencia: el spec escrito y
  // todavía sin empujar. Era exactamente el que producía un enlace roto sin
  // decir nada.
  it('el spec no está publicado en la rama por defecto → sin url, y el motivo nombra repo y rama', () => {
    const { ref, warnings } = resolve({ fallos: { contents: true } })
    expect(ref.url).toBeNull()
    expect(ref.reason).toBe(`${SPEC_REF_REASONS.notPublished} (o/r, rama main)`)
    expect(warnings[0]).toMatch(/sin publicar|no está publicado/i)
  })

  it('el spec queda fuera del árbol del repo → sin url', () => {
    const { ref } = resolve({ specFile: '/otro/sitio/spec.md' })
    expect(ref.url).toBeNull()
    expect(ref.reason).toBe(SPEC_REF_REASONS.outsideRepo)
  })

  // Regla dura: si no hay url, hay aviso. Que el enlace se caiga en silencio
  // ES el defecto original.
  it('NINGUNA degradación es silenciosa', () => {
    for (const [, opts] of [...RENDIDAS, ['no publicado', { fallos: { contents: true } }], ['fuera', { specFile: '/otro/spec.md' }]]) {
      const { ref, warnings } = resolve(opts)
      if (ref.url === null) expect(warnings.length).toBeGreaterThan(0)
    }
  })

  // Cuando el motivo del aviso acaba en el cuerpo del issue, tiene que decir
  // también que /ct-groom NO lo va a arreglar solo en la siguiente corrida
  // (F5 es idempotente por existencia): el momento de arreglarlo es ANTES.
  it('el aviso dice que una corrida posterior no lo corrige sin --reconcile', () => {
    const { warnings } = resolve({ fallos: { toplevel: true } })
    expect(warnings[0]).toMatch(/--reconcile/)
    expect(warnings[0]).toMatch(/ANTES de la corrida real/)
  })
})

describe('resolveSpecRef — cuando hay enlace pero no ancla: se enlaza el fichero y se dice por qué', () => {
  it('el ancla local no está en la copia PUBLICADA (spec editado y sin empujar) → url al fichero, sin fragmento, con aviso', () => {
    const { ref, warnings } = resolve({ html: '<a id="user-content-otra-cosa" class="anchor"></a>' })
    expect(ref.url).toBe('https://github.com/o/r/blob/main/docs/spec.md')
    expect(ref.reason).toBeNull()
    expect(warnings[0]).toContain('9-slices')
    expect(warnings[0]).toMatch(/empuja la versión actual del spec/)
  })
  it('la tabla §9 no vive bajo ningún encabezado → url al fichero, con aviso que dice cómo arreglarlo', () => {
    const { ref, warnings } = resolve({ heading: null })
    expect(ref.url).toBe('https://github.com/o/r/blob/main/docs/spec.md')
    expect(ref.heading).toBeNull()
    expect(warnings[0]).toMatch(/no vive bajo ningún encabezado/)
  })
  it('el encabezado no produce ancla utilizable ("## ...") → url al fichero, con aviso', () => {
    const { ref, warnings } = resolve({ heading: { text: '...', anchor: '' } })
    expect(ref.url).toBe('https://github.com/o/r/blob/main/docs/spec.md')
    expect(warnings[0]).toMatch(/no produce ningún ancla/)
  })
})

// ---------------------------------------------------------------------------
// Cómo se escribe cada caso en el body. Lo que se comprueba aquí es que la
// referencia degradada sea HONESTA (no un enlace a medias) y que no reintroduzca
// por la puerta de atrás el otro defecto que F6 arregló: un "#N" desnudo en el
// body lo autoenlaza GitHub al issue N del repo (verificado en el sandbox: un
// "#3" desnudo sale como <a href=".../issues/3">, y dentro de un code span o
// del texto de un enlace, no).
// ---------------------------------------------------------------------------

describe('renderSpecLink — cómo se escribe cada caso', () => {
  const SLICE = { n: 3 }
  it('con url: enlace markdown con la ruta y la sección como texto', () => {
    const line = renderSpecLink(SLICE, { path: 'docs/spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices', reason: null })
    expect(line).toBe('> Slice `#3` del epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)')
  })
  it('sin encabezado: solo la ruta', () => {
    const line = renderSpecLink(SLICE, { path: 'spec.md', heading: null, url: 'https://github.com/o/r/blob/main/spec.md', reason: null })
    expect(line).toBe('> Slice `#3` del epic. Spec: [spec.md](https://github.com/o/r/blob/main/spec.md)')
  })
  it('sin url: referencia de texto con el motivo, y NINGÚN enlace markdown', () => {
    const line = renderSpecLink(SLICE, { path: 'docs/spec.md', heading: '9. Slices', url: null, reason: 'el spec no está dentro de un repositorio git' })
    expect(line).toBe('> Slice `#3` del epic. Spec: `docs/spec.md` § `9. Slices` — sin enlace: el spec no está dentro de un repositorio git')
    expect(line).not.toMatch(/\]\(/)
  })
  // Un encabezado puede citar un issue ("## 9. Slices (ver #3)"). En el texto
  // de un enlace eso NO se autoenlaza (verificado); en texto plano SÍ. La
  // forma degradada, que es texto plano, tiene que protegerlo.
  it('un "#N" del encabezado nunca queda como texto plano en la forma degradada', () => {
    const line = renderSpecLink(SLICE, { path: 'spec.md', heading: '9. Slices (ver #12)', url: null, reason: 'motivo' })
    expect(line).toContain('`9. Slices (ver #12)`')
    // Quitando los code spans no puede quedar NINGUNA referencia "#<dígitos>"
    // suelta — ni la del encabezado ni el propio orden del slice.
    expect(line.replace(/(`+)[\s\S]*?\1/g, '')).not.toMatch(/#\d/)
  })
  it('corchetes en el texto del enlace se escapan (si no, cortarían el enlace en seco)', () => {
    const line = renderSpecLink(SLICE, { path: 'docs/[wip]/spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/x', reason: null })
    expect(line).toContain('docs/\\[wip\\]/spec.md')
  })
  it('un backtick en la ruta no rompe el código inline de la forma degradada', () => {
    const line = renderSpecLink(SLICE, { path: 'do`c.md', heading: null, url: null, reason: 'motivo' })
    expect(line).toContain('``do`c.md``')
  })
})
