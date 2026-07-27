// Resolución del enlace al spec que /ct-groom escribe en cada issue (F10).
//
// El defecto que cierra: hasta aquí, la línea era
// "Spec: [docs/x-design.md#9](docs/x-design.md#9)" — una ruta RELATIVA con un
// ancla NUMÉRICA. Las dos mitades están rotas, y las dos se comprobaron
// contra GitHub antes de tocar nada:
//
//   1. La ruta relativa. `gh api /markdown -X POST` con `mode: gfm` y
//      `context: owner/repo` devuelve el href TAL CUAL:
//      `<a href="docs/x-design.md#9">`. En un fichero del repo (un README)
//      resolvería bien; en la página de un issue
//      (github.com/owner/repo/issues/N) resuelve contra ESA url y da 404.
//      Un issue es justo donde vive esta línea.
//   2. El ancla. "#<número de sección>" no existe: el encabezado real es
//      "## 9. Slices" y GitHub le asigna "9-slices" (ver scripts/anchor.js,
//      donde está la verificación completa contra el renderizador real).
//
// Este módulo produce una URL ABSOLUTA y verificada, o ninguna. Deliberado:
// una URL absoluta que apunta a algo no publicado es el mismo defecto con
// otra cara, así que "no se pudo construir un enlace bueno" es un resultado
// de primera clase (`reason`), nunca un enlace a medias.

// ---------------------------------------------------------------------------
// Qué referencia se emite, y por qué esa.
//
// Se emite la RAMA POR DEFECTO del repo donde vive el spec
// (`https://<host>/<owner>/<repo>/blob/<rama-por-defecto>/<ruta>#<ancla>`),
// no un sha ni la rama desde la que se invoca. Tres razones, en orden de
// peso:
//
//   - Frente a un sha (permalink): el spec es un documento VIVO y
//     /ct-groom lo trata como tal — la detección de divergencia de F5
//     compara cada issue contra la §9 de HOY. Un permalink congelaría el
//     enlace en una §9 que puede haber dejado de ser la que la herramienta
//     compara, así que el humano que abre el issue y la máquina que lo
//     reconcilia estarían mirando documentos distintos. Se paga el precio
//     conocido: si el fichero se MUEVE, el enlace muere — pero eso ahora se
//     detecta (ver la nota sobre la comparación en scripts/reconcile.js).
//   - Frente a la rama actual: la rama actual no es una propiedad del
//     repositorio sino de QUIÉN invoca. Dos invocaciones legítimas desde
//     ramas distintas producirían dos líneas distintas para el mismo slice
//     y --reconcile las reescribiría una sobre otra indefinidamente — el
//     ping-pong que la comparación "solo por el ancla" evitaba antes a
//     costa de no detectar nada más. La rama por defecto es la misma se
//     invoque desde donde se invoque.
//   - Y porque una rama de feature se borra al mergear: el enlace del issue
//     moriría justo cuando el epic termina.
// ---------------------------------------------------------------------------

// GITHUB_REMOTE_RES: las formas en que `git remote get-url origin` puede
// devolver el mismo repo. Se cubren las cuatro que produce git/gh en la
// práctica (https, https con credencial embebida, ssh scp-like, ssh://) —
// el `.git` final es opcional en todas.
const GITHUB_REMOTE_RES = [
  /^https?:\/\/(?:[^@/]*@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  /^ssh:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  /^(?:[^@]+@)?([^:/]+):([^/]+)\/(.+?)(?:\.git)?\/?$/,
]

// parseRemote: URL de remoto -> { host, owner, repo }, o null si no se
// reconoce. NO se exige que el host sea github.com: un GitHub Enterprise
// self-hosted tiene la misma forma de URL de blob, y hardcodear github.com
// convertiría un enlace perfectamente construible en una degradación.
export function parseRemote(remoteUrl) {
  const url = (remoteUrl || '').trim()
  if (!url) return null
  for (const re of GITHUB_REMOTE_RES) {
    const m = re.exec(url)
    if (m && m[1] && m[2] && m[3]) return { host: m[1], owner: m[2], repo: m[3] }
  }
  return null
}

// encodePathSegment: `encodeURIComponent` NO escapa `!'()*`, y el paréntesis
// es precisamente el carácter que rompe la sintaxis `[texto](destino)` de un
// enlace markdown — un spec en "docs/plan (v2)/x.md" produciría un enlace
// truncado en el paréntesis. Verificado contra GitHub: con `%28`/`%29` el
// href sale entero.
function encodePathSegment(seg) {
  return encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29')
}
function encodePath(path) {
  return path.split('/').map(encodePathSegment).join('/')
}

// buildBlobUrl: la URL de "ver este fichero en esta rama", con ancla si la
// hay. El ancla NO se codifica: un slug de GitHub solo puede contener
// letras, dígitos, marcas combinantes, `_` y `-` (ver anchor.js#SLUG_DROP_RE),
// ninguno de los cuales rompe ni la URL ni la sintaxis del enlace markdown.
export function buildBlobUrl({ host, owner, repo, ref, path, anchor }) {
  const base = `https://${host}/${encodePathSegment(owner)}/${encodePathSegment(repo)}/blob/${encodePath(ref)}/${encodePath(path)}`
  return anchor ? `${base}#${anchor}` : base
}

// ANCHOR_ID_PREFIX: GitHub emite el id del encabezado prefijado
// (`id="user-content-9-slices"`) y el href sin prefijar (`href="#9-slices"`);
// su propio JS traduce uno en otro. Para COMPROBAR que el ancla existe hay
// que buscar la forma prefijada, que es la que aparece en el HTML.
const ANCHOR_ID_PREFIX = 'user-content-'
export function renderedHtmlHasAnchor(html, anchor) {
  if (!anchor) return false
  return (html || '').includes(`id="${ANCHOR_ID_PREFIX}${anchor}"`)
}

// SPEC_REF_REASONS: los motivos por los que puede no haber enlace. Son
// cadenas fijas porque ACABAN EN EL CUERPO DEL ISSUE (ver
// groom.js#renderSpecLink): si cambiaran de corrida en corrida, la detección
// de divergencia de F5 reportaría un cambio que no lo es. Ninguna contiene
// "#<dígitos>" a propósito — un "#N" desnudo en el body lo autoenlaza GitHub
// al issue N del repo (verificado: en josemerca/ct-loop-sandbox, un "#3"
// desnudo sale como `<a href=".../issues/3">`, y solo NO se autoenlaza si
// ese issue no existe — o sea, que no autoenlace hoy no significa que no
// vaya a hacerlo mañana).
export const SPEC_REF_REASONS = {
  notInRepo: 'el spec no está dentro de un repositorio git',
  outsideRepo: 'el spec queda fuera del árbol del repositorio git',
  noRemote: 'el repositorio del spec no tiene remoto "origin"',
  unparsableRemote: 'el remoto "origin" del repositorio del spec no es una URL de GitHub reconocible',
  noDefaultBranch: 'no se pudo resolver la rama por defecto del repositorio del spec',
  notPublished: 'el spec no está publicado en la rama por defecto del repositorio',
}

// resolveSpecRef: de "la ruta que me han pasado en argv" a "la referencia que
// se puede escribir en un issue". `run(cmd, args)` devuelve stdout y lanza si
// el comando falla — inyectado para poder probar TODAS las ramas de
// degradación sin red y sin repo (ver __tests__/spec-link.test.js).
//
// `heading` es { text, anchor } (scripts/anchor.js, vía el reporte de
// slices.js) o null si la tabla §9 no vive bajo ningún encabezado.
//
// Devuelve { ref, warnings }:
//   - ref: lo que se renderiza en el body. `url` no nulo significa
//     "verificado que existe": el fichero se ha pedido de verdad a GitHub en
//     esa rama, y si hay ancla se ha comprobado que el HTML renderizado trae
//     su id. Sin esa comprobación, "absoluta" solo cambiaría la FORMA del
//     enlace roto.
//   - warnings: líneas para stderr. NUNCA vacío cuando `url` es null — que
//     el enlace se caiga en silencio es el defecto original.
// `specFile` llega YA absoluto y con los enlaces simbólicos resueltos (lo
// hace ct-groom.mjs): `git -C <dir>` necesita un directorio real, y la ruta
// relativa al root del repo solo se puede calcular entre dos rutas del mismo
// tipo. `displayPath` es la ruta TAL COMO se escribió en argv, y es lo que se
// enseña en el body cuando ni siquiera se llega a saber cuál es el repo — en
// ese caso una ruta absoluta de la máquina de quien invocó no le dice nada a
// quien lee el issue.
export function resolveSpecRef({ specFile, displayPath, heading, run, relativize }) {
  const warnings = []
  const headingText = heading && heading.text ? heading.text : null
  const anchor = heading && heading.anchor ? heading.anchor : null
  const degraded = (reason, path = (displayPath || specFile)) => ({
    ref: { path, heading: headingText, url: null, reason },
    warnings: [
      `aviso: el enlace al spec de cada issue se queda SIN enlace — ${reason}. Los issues nacerán con una referencia de texto (ruta + sección) en vez de un enlace pinchable, y /ct-groom NO lo corrige en corridas posteriores sin --reconcile (marcado EXPERIMENTAL): si quieres el enlace, arregla esto y vuelve a correr ANTES de la corrida real.`,
    ],
  })

  let root
  try {
    root = run('git', ['-C', dirOf(specFile), 'rev-parse', '--show-toplevel'])
  } catch {
    return degraded(SPEC_REF_REASONS.notInRepo)
  }
  const relPath = relativize(root, specFile)
  if (!relPath || relPath.startsWith('..')) return degraded(SPEC_REF_REASONS.outsideRepo)

  let remoteUrl
  try {
    remoteUrl = run('git', ['-C', root, 'remote', 'get-url', 'origin'])
  } catch {
    return degraded(SPEC_REF_REASONS.noRemote, relPath)
  }
  const remote = parseRemote(remoteUrl)
  if (!remote) return degraded(SPEC_REF_REASONS.unparsableRemote, relPath)
  const slug = `${remote.owner}/${remote.repo}`

  let branch
  try {
    branch = run('gh', ['repo', 'view', slug, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'])
  } catch {
    return degraded(SPEC_REF_REASONS.noDefaultBranch, relPath)
  }
  if (!branch) return degraded(SPEC_REF_REASONS.noDefaultBranch, relPath)

  // La comprobación que convierte "absoluto" en "usable": se pide el fichero
  // RENDERIZADO, en esa rama, al propio GitHub. Un 404 aquí es el caso más
  // común de todos en la vida real — el spec recién escrito y todavía sin
  // empujar — y es exactamente el que producía un enlace roto sin decir nada.
  let html
  try {
    html = run('gh', ['api', `repos/${slug}/contents/${encodePath(relPath)}?ref=${encodeURIComponent(branch)}`,
      '-H', 'Accept: application/vnd.github.html'])
  } catch {
    return degraded(`${SPEC_REF_REASONS.notPublished} (${slug}, rama ${branch})`, relPath)
  }

  const url = buildBlobUrl({ ...remote, ref: branch, path: relPath, anchor })
  if (!anchor) {
    warnings.push(headingText === null
      ? `aviso: la tabla §9 no vive bajo ningún encabezado del spec — el enlace de cada issue apunta al fichero entero, no a la sección; pon la tabla bajo un encabezado ("## 9. Slices") para que el enlace aterrice donde toca.`
      : `aviso: el encabezado "${headingText}" no produce ningún ancla en GitHub (se queda vacío al quitarle la puntuación) — el enlace de cada issue apunta al fichero entero, no a la sección.`)
    return { ref: { path: relPath, heading: headingText, url, reason: null }, warnings }
  }
  if (!renderedHtmlHasAnchor(html, anchor)) {
    // El ancla se calcula sobre el fichero LOCAL; el enlace apunta a la copia
    // PUBLICADA. Si no coinciden es que la publicada es otra (spec editado y
    // sin empujar, típicamente) — enlazar al ancla igualmente sería inventar.
    warnings.push(`aviso: el ancla "${anchor}" (del encabezado "${headingText}") no existe en la copia de ${relPath} publicada en ${slug}@${branch} — el enlace de cada issue apunta al fichero entero, no a la sección; empuja la versión actual del spec y vuelve a correr.`)
    return { ref: { path: relPath, heading: headingText, url: buildBlobUrl({ ...remote, ref: branch, path: relPath, anchor: null }), reason: null }, warnings }
  }
  return { ref: { path: relPath, heading: headingText, url, reason: null }, warnings }
}

// dirOf: `dirname` sin importar node:path — este módulo se mantiene puro y
// sin dependencias para poder probarse sin tocar disco. Una ruta sin ninguna
// barra vive en el directorio actual.
function dirOf(p) {
  const i = (p || '').lastIndexOf('/')
  return i === -1 ? '.' : (i === 0 ? '/' : p.slice(0, i))
}
