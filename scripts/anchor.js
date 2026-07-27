// Anclas de encabezado tal y como las genera GitHub (F10).
//
// Por qué existe este fichero: hasta F10, el enlace al spec que /ct-groom
// escribe en el cuerpo de CADA issue usaba como ancla el NÚMERO de sección
// que llegara por `--section` ("spec.md#9"). Ese ancla no existe: el
// encabezado real del spec es "## 9. Slices" y el id que GitHub genera para
// él es "9-slices". Verificado contra el renderizador REAL, no deducido —
// `gh api repos/<o>/<r>/contents/<path> -H "Accept: application/vnd.github.html"`
// sobre un fichero de prueba empujado a josemerca/ct-loop-sandbox devuelve
// `id="user-content-9-slices"` para ese encabezado.
//
// Todo lo que hay aquí sale de esa misma corrida de verificación (tres
// ficheros de prueba, ~50 encabezados). Cada regla lleva su caso observado
// al lado; ninguna está deducida de la documentación de GitHub.
import { normalizeToLF } from './gh-issue-map.js'

// SLUG_DROP_RE: qué caracteres NO sobreviven al slug. Observado, uno a uno:
//   "a+b" -> "ab"      (+ fuera)          "a=b" -> "ab"   (= fuera)
//   "a~b" -> "ab"      (~ fuera)          "a·b" -> "ab"   (· fuera)
//   "a°b" -> "ab"      (° fuera)          "100%" -> "100" (% fuera)
//   "v1.2.3" -> "v123" (. fuera)          "$var" -> "var" ($ fuera)
//   "a's b" -> "as-b"  (' fuera)          "Slices §9" -> "slices-9"
//   "9 – Slices"/"9 — Slices" -> "9--slices" (en/em dash fuera, el espacio
//     de cada lado SÍ deja su guion: por eso salen dos)
//   "Emoji 🚀 en cabecera" -> "emoji--en-cabecera" (emoji fuera)
//   "9.&nbsp;Slices" -> "9slices" (U+00A0 fuera: NO cuenta como espacio)
//   "a\tb" -> "ab" (tabulador fuera: tampoco cuenta como espacio)
// Y qué SÍ sobrevive:
//   letras y dígitos unicode de cualquier alfabeto — "日本語 セクション" ->
//     "日本語-セクション", "Sección с кириллицей" -> "sección-с-кириллицей",
//     "ñ Ñ Ü" -> "ñ-ñ-ü", "ªb" -> "ªb" (U+00AA es letra, categoría Lo)
//   marcas combinantes — un texto en NFD ("e" + U+0301) conserva el U+0301
//     en el id (comprobado byte a byte en el HTML devuelto por GitHub), así
//     que este slug NO normaliza a NFC: hacerlo produciría un ancla distinta
//     de la del documento cuando el documento está en NFD.
//   el guion bajo — "a_b c" -> "a_b-c"
//   el guion — "-leading hyphen" -> "-leading-hyphen",
//     "trailing hyphen -" -> "trailing-hyphen--"
//   el espacio, que se convierte en guion (ver SPACE_RE) — y NO se colapsa:
//     "Sección con  dobles   espacios" -> "sección-con--dobles---espacios".
const SLUG_DROP_RE = /[^\p{L}\p{N}\p{M}_\- ]/gu
// SPACE_RE: solo U+0020. Ni tabulador ni NBSP (ambos observados como
// "carácter que se cae", no como separador) — de ahí que sea un literal y no
// `\s`.
const SPACE_RE = / /g

// githubSlug: texto YA renderizado (sin marcado inline) -> ancla de GitHub.
// Devuelve '' cuando no queda nada — no es un caso teórico: un encabezado
// "## ..." produce en GitHub `id=""` y `href="#"`, es decir, NINGÚN ancla
// utilizable (observado). Quien llame tiene que tratar '' como "este
// encabezado no se puede enlazar", nunca emitir "#" a secas.
export function githubSlug(renderedText) {
  return (renderedText || '').toLowerCase().replace(SLUG_DROP_RE, '').replace(SPACE_RE, '-')
}

// ---------------------------------------------------------------------------
// De marcado inline a texto renderizado.
//
// El slug de arriba trabaja sobre el TEXTO que GitHub acaba pintando dentro
// del <h2>, no sobre la línea markdown cruda. La mayoría del marcado inline
// se cae solo (asteriscos, tildes y backticks no sobreviven a SLUG_DROP_RE,
// así que "`parseo`" ya da "parseo" sin hacer nada). Solo cuatro
// construcciones cambian el RESULTADO si no se tratan — y las cuatro están
// verificadas contra GitHub:
//   1. imágenes: "![img](url) alt heading" -> "-alt-heading". El alt NO
//      entra (un <img> no aporta texto); sin tratarlas, el slug se comería
//      la URL entera.
//   2. enlaces: "[link](https://example.com) heading" -> "link-heading" —
//      se queda el texto, se va el destino.
//   3. HTML crudo: "<b>html</b> heading" -> "html-heading"; "a<br>b" ->
//      "ab" (la etiqueta desaparece SIN dejar espacio).
//   4. entidades: "a &amp; b" -> "a--b" (la entidad se resuelve a "&", que
//      luego se cae, dejando los dos espacios -> dos guiones).
// Y una quinta, el guion bajo de énfasis, porque `_` es de los pocos
// caracteres de puntuación que SÍ sobreviven al slug: "__x__" tiene que dar
// "x", no "__x__".
// ---------------------------------------------------------------------------

// Un code span se procesa APARTE y su contenido se protege del resto de
// transformaciones (CommonMark: dentro de un code span no hay ni enlaces ni
// HTML ni entidades). Sin esta protección, "`<b>`" perdería su "b" al pasar
// por el barrido de etiquetas HTML.
const CODE_SPAN_RE = /(`+)([\s\S]*?)\1/g
// PLACEHOLDER_OPEN/CLOSE: marcadores de sustitución para el contenido de
// los code spans mientras se aplican el resto de transformaciones. NUL y
// SOH no pueden aparecer en un encabezado markdown real, y aunque
// aparecieran el slug los tiraría igual: no hay colisión posible con el
// texto del autor.
const PLACEHOLDER_OPEN = '\u0000'
const PLACEHOLDER_CLOSE = '\u0001'

const IMAGE_RE = /!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g
const LINK_RE = /\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g
const HTML_TAG_RE = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/g
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
const ENTITY_RE = /&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g
// UNDERSCORE_EMPHASIS_RE: `_x_` / `__x__` donde los delimitadores NO están
// dentro de una palabra — la restricción "intraword" de CommonMark para el
// guion bajo es justo lo que hace que "__init__.py" siga siendo literal
// mientras "__negrita__" es énfasis. Es la misma distinción que
// slices.js#PAIRED_UNDERSCORE_RE hace para los tokens de label, por el mismo
// motivo (`_layout.tsx`, `__init__.py` son nombres de fichero corrientes).
const UNDERSCORE_EMPHASIS_RE = /(^|[^\p{L}\p{N}_])(_{1,3})(?!\s)([\s\S]+?)(?<!\s)\2(?![\p{L}\p{N}_])/gu

function decodeEntity(_match, body) {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X'
      ? parseInt(body.slice(2), 16)
      : parseInt(body.slice(1), 10)
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return _match
    try { return String.fromCodePoint(code) } catch { return _match }
  }
  const named = NAMED_ENTITIES[body]
  return named === undefined ? _match : named
}

// inlineText: línea de contenido de un encabezado (markdown inline) -> el
// texto que GitHub pinta dentro del <h2>.
export function inlineText(md) {
  const src = md || ''
  // 1. code spans fuera del alcance del resto (se restauran al final).
  const codes = []
  let out = src.replace(CODE_SPAN_RE, (_m, _ticks, body) => {
    codes.push(body.trim())
    return `${PLACEHOLDER_OPEN}${codes.length - 1}${PLACEHOLDER_CLOSE}`
  })
  // 2. imágenes ANTES que enlaces: "![a](b)" también matchea LINK_RE si se
  //    hace al revés, y dejaría un "!" suelto con el alt dentro.
  out = out.replace(IMAGE_RE, '')
  // 3. enlaces: se queda el texto. Dos pasadas para enlaces anidados de un
  //    nivel (p.ej. un enlace cuyo texto ya venía de otra sustitución).
  out = out.replace(LINK_RE, '$1').replace(LINK_RE, '$1')
  // 4. HTML crudo (etiquetas y comentarios) fuera, sin dejar hueco.
  out = out.replace(HTML_TAG_RE, '')
  // 5. entidades resueltas a su carácter.
  out = out.replace(ENTITY_RE, decodeEntity)
  // 6. énfasis de guion bajo (el resto de marcadores de énfasis no
  //    sobreviven al slug, así que no hace falta tocarlos).
  out = out.replace(UNDERSCORE_EMPHASIS_RE, '$1$3').replace(UNDERSCORE_EMPHASIS_RE, '$1$3')
  // 7. code spans de vuelta.
  out = out.replace(new RegExp(`${PLACEHOLDER_OPEN}(\\d+)${PLACEHOLDER_CLOSE}`, 'g'), (_m, i) => codes[Number(i)])
  return out
}

// ---------------------------------------------------------------------------
// Localización de encabezados en el documento.
// ---------------------------------------------------------------------------

// ATX_RE: CommonMark. Hasta 3 espacios de indentación ("   ## Indentada tres
// espacios" -> "indentada-tres-espacios", observado), 1-6 almohadillas, y o
// bien fin de línea o al menos un espacio/tabulador antes del contenido
// ("##foo" NO es cabecera). Los espacios de cola se caen ("## Con trailing
// espacios   " -> "con-trailing-espacios", observado).
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
// ATX_CLOSING_RE: la serie de cierre opcional ("## 9. Slices ##" ->
// "9-slices", observado — el "##" final no entra en el ancla).
const ATX_CLOSING_RE = /(?:^|[ \t])#+$/
// SETEXT_UNDERLINE_RE: el subrayado de una cabecera setext. NO es teórico:
// "Setext nueve. Slices" subrayado con guiones produjo
// `id="user-content-setext-nueve-slices"` en el mismo fichero de prueba. Un
// spec escrito así, sin este caso, haría que el buscador de "el encabezado
// que hay encima de la tabla" se saltara la cabecera real y cogiera la
// ANTERIOR — un ancla válida apuntando al sitio equivocado, que es
// exactamente el modo de fallo que F10 viene a eliminar.
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/
// Una línea que NO puede ser el texto de una cabecera setext: en blanco, ya
// es una cabecera ATX, es otro subrayado, o abre un bloque con su propio
// significado (cita, tabla, item de lista). Conservador a propósito: un
// falso positivo aquí desplaza el contador de duplicados de TODO el
// documento (ver dedupe más abajo).
const NOT_SETEXT_TEXT_RE = /^\s*$|^ {0,3}#{1,6}([ \t]|$)|^\s*[|>]|^ {0,3}([-*+]|\d+[.)])[ \t]/

const FENCE_DELIM_RE = /^ {0,3}(`{3,}|~{3,})/

// stripFrontMatter: devuelve el índice de la primera línea de CONTENIDO. Un
// bloque de front matter YAML ("---" en la línea 0, hasta el "---"/"..." de
// cierre) no es markdown: GitHub lo pinta como metadatos, no como cuerpo.
// Sin saltarlo, su línea de cierre "---" parecería el subrayado setext de la
// última línea del YAML y se contaría como una cabecera que no existe.
function frontMatterEnd(lines) {
  if (lines[0] !== '---') return 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---' || lines[i] === '...') return i + 1
  }
  return 0 // sin cierre: no era front matter, no se salta nada
}

// documentHeadings: TODOS los encabezados visibles del documento, en orden,
// con el ancla que GitHub les asignaría — sufijo de colisión incluido.
//
// El sufijo NO es un detalle: observado en un mismo documento, "## 9.
// Slices", "### 9. Slices" y "#### 9. Slices" producen "9-slices",
// "9-slices-1" y "9-slices-2". El contador es del DOCUMENTO y es común a
// todos los niveles, así que no hay forma de saber el ancla de "la sección
// §9" sin recorrer el documento entero desde el principio. También observado:
// un encabezado dentro de una valla de código, o dentro de un comentario
// HTML, NO genera ancla NI consume número de colisión — por eso este escáner
// arrastra el mismo estado de valla/comentario que usa el escáner de bodies
// de issues (gh-issue-map.js#stepLine).
//
// Devuelve [{ line, text, anchor }] — `anchor` es '' cuando el encabezado no
// tiene ancla utilizable (ver githubSlug).
export function documentHeadings(specMd) {
  const lines = normalizeToLF(specMd || '').split('\n')
  const start = frontMatterEnd(lines)
  const headings = []
  const seen = new Map()
  let inFence = false
  let fenceChar = null
  let fenceLen = 0
  let inComment = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    const fenceMatch = FENCE_DELIM_RE.exec(line)
    if (inFence) {
      if (fenceMatch && fenceMatch[1][0] === fenceChar && fenceMatch[1].length >= fenceLen &&
          /^\s*$/.test(line.slice(fenceMatch.index + fenceMatch[0].length))) {
        inFence = false; fenceChar = null; fenceLen = 0
      }
      continue
    }
    if (fenceMatch) {
      inFence = true; fenceChar = fenceMatch[1][0]; fenceLen = fenceMatch[1].length
      continue
    }
    const openIdx = line.indexOf('<!--')
    if (openIdx !== -1 && line.indexOf('-->', openIdx + 4) === -1) { inComment = true; continue }

    let headingLine = -1
    let raw = null
    const atx = ATX_RE.exec(line)
    if (atx) {
      headingLine = i
      raw = (atx[2] || '').replace(ATX_CLOSING_RE, '').trim()
    } else if (SETEXT_UNDERLINE_RE.test(line) && i > start) {
      const prev = lines[i - 1]
      if (!NOT_SETEXT_TEXT_RE.test(prev) && !FENCE_DELIM_RE.test(prev) && !SETEXT_UNDERLINE_RE.test(prev)) {
        headingLine = i - 1
        raw = prev.trim()
      }
    }
    if (headingLine === -1) continue

    // OJO al trim: el recorte se hace sobre el markdown CRUDO (arriba, al
    // extraer el contenido de la cabecera ATX/setext), NUNCA sobre el texto
    // ya renderizado. Verificado contra GitHub: "## ![img](url) alt heading"
    // produce `id="-alt-heading"` — con guion inicial — porque la imagen no
    // aporta texto y el espacio que deja delante SÍ cuenta para el slug. La
    // primera versión de esta función hacía `.trim()` aquí y era el único de
    // los ~50 encabezados de la corrida de verificación que salía distinto
    // ("alt-heading" en vez de "-alt-heading"): un ancla inexistente, o sea
    // el mismo defecto que F10 arregla, reintroducido por un trim de más.
    const rendered = inlineText(raw)
    const base = githubSlug(rendered)
    const text = rendered.trim()
    let anchor = base
    if (base) {
      const n = seen.get(base) || 0
      seen.set(base, n + 1)
      if (n > 0) anchor = `${base}-${n}`
    }
    headings.push({ line: headingLine, text, anchor })
  }
  return headings
}

// headingAbove: el encabezado bajo el que vive la línea `lineIndex` — o
// null si esa línea está por encima de cualquier encabezado del documento.
// Es lo que convierte "la tabla §9 está en la línea 42" en "esa tabla vive
// bajo `## 9. Slices`, cuyo ancla es `9-slices`".
export function headingAbove(specMd, lineIndex) {
  const headings = documentHeadings(specMd)
  let found = null
  for (const h of headings) {
    if (h.line < lineIndex) found = h
    else break
  }
  return found
}
