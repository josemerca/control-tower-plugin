import { describe, it, expect } from 'vitest'
import { githubSlug, inlineText, documentHeadings, headingAbove } from '../scripts/anchor.js'
import { analyzeSlicesTable } from '../scripts/slices.js'

// Todos los pares de este fichero salen de una corrida de verificación contra
// el renderizador REAL de GitHub, no de leer su documentación: tres ficheros
// markdown empujados a josemerca/ct-loop-sandbox y recuperados con
// `gh api repos/<o>/<r>/contents/<ruta> -H "Accept: application/vnd.github.html"`,
// que devuelve el HTML tal cual lo pinta GitHub, con el
// `<a id="user-content-<slug>" class="anchor">` de cada encabezado. Los ~50
// encabezados de esa corrida coinciden hoy uno a uno con lo que produce
// scripts/anchor.js.
//
// Se guardan como pares literales A PROPÓSITO: si mañana alguien "simplifica"
// el slug, lo que falla es la comparación contra lo que GitHub hizo de verdad,
// no contra otra implementación nuestra.

describe('githubSlug — el ancla que GitHub genera para el texto de un encabezado (pares observados contra el renderizador real)', () => {
  const OBSERVADOS = [
    // el caso que origina F10: el enlace decía "#9", el ancla real es otra
    ['9. Slices', '9-slices'],
    ['10. Riesgos & Mitigaciones', '10-riesgos--mitigaciones'],
    ['Desglose en slices (§9) — tabla', 'desglose-en-slices-9--tabla'],
    ['Slices: parseo + validación', 'slices-parseo--validación'],
    ['¿Qué entrega? Diseño técnico', 'qué-entrega-diseño-técnico'],
    ['9.1. Sub-slices / detalle', '91-sub-slices--detalle'],
    ['Ámbito, límites y "excepciones"', 'ámbito-límites-y-excepciones'],
    // el espacio NO se colapsa: cada uno deja su guion
    ['Sección con  dobles   espacios', 'sección-con--dobles---espacios'],
    // fuera: emoji, símbolos, puntuación
    ['Emoji 🚀 en cabecera', 'emoji--en-cabecera'],
    ['a+b', 'ab'], ['a=b', 'ab'], ['a~b', 'ab'], ['a·b', 'ab'], ['a°b', 'ab'],
    ['100%', '100'], ['v1.2.3', 'v123'], ["a's b", 'as-b'], ['$var', 'var'],
    ['9 – Slices', '9--slices'], ['9 — Slices', '9--slices'],
    // dentro: guion bajo, guion (incluso al principio o al final), letras y
    // dígitos de cualquier alfabeto, y la ª (que es letra, no símbolo)
    ['a_b c', 'a_b-c'],
    ['-leading hyphen', '-leading-hyphen'],
    ['trailing hyphen -', 'trailing-hyphen--'],
    ['日本語 セクション', '日本語-セクション'],
    ['Sección с кириллицей', 'sección-с-кириллицей'],
    ['ñ Ñ Ü', 'ñ-ñ-ü'],
    ['ªb', 'ªb'],
    // ni el tabulador ni el NBSP cuentan como espacio: se caen enteros
    ['a\tb', 'ab'],
    ['9. Slices', '9slices'],
  ]
  for (const [texto, ancla] of OBSERVADOS) {
    it(`${JSON.stringify(texto)} → ${JSON.stringify(ancla)}`, () => {
      expect(githubSlug(texto)).toBe(ancla)
    })
  }

  // El caso que obliga a que "sin ancla" sea un resultado de primera clase:
  // GitHub emitió `id=""` y `href="#"` para "## ...". Emitir "#" a secas en un
  // enlace sería exactamente el enlace roto que F10 arregla, con otra cara.
  it('un encabezado sin ningún carácter que sobreviva ("...") → cadena vacía, NUNCA "#"', () => {
    expect(githubSlug('...')).toBe('')
    expect(githubSlug('')).toBe('')
    expect(githubSlug(null)).toBe('')
  })

  // Un texto en NFD (macOS lo produce con facilidad) conserva su marca
  // combinante en el id de GitHub — comprobado byte a byte en el HTML real.
  // Normalizar a NFC aquí produciría un ancla que no está en el documento.
  it('texto en NFD conserva la marca combinante (el id de GitHub también la conserva)', () => {
    const nfd = 'Śeccion'.normalize('NFD')
    expect(githubSlug(nfd)).toContain('́')
    expect(githubSlug(nfd)).toBe(nfd.toLowerCase())
  })
})

describe('inlineText — el texto que GitHub pinta dentro del <h2>, no el markdown crudo', () => {
  it('enlace: se queda el texto, se va el destino (observado: "link-heading")', () => {
    expect(githubSlug(inlineText('[link](https://example.com) heading'))).toBe('link-heading')
  })
  it('imagen: no aporta NADA, ni siquiera el alt — y el espacio que deja delante sí cuenta (observado: "-alt-heading")', () => {
    expect(githubSlug(inlineText('![img](https://example.com/a.png) alt heading'))).toBe('-alt-heading')
  })
  it('HTML crudo: la etiqueta desaparece sin dejar hueco (observado: "html-heading", "ab")', () => {
    expect(githubSlug(inlineText('<b>html</b> heading'))).toBe('html-heading')
    expect(githubSlug(inlineText('a<br>b'))).toBe('ab')
  })
  it('entidad: se resuelve al carácter, que luego puede caerse (observado: "a--b")', () => {
    expect(githubSlug(inlineText('a &amp; b'))).toBe('a--b')
  })
  it('code span: el contenido se conserva y los backticks se caen (observado: "slices-parseo--validación")', () => {
    expect(githubSlug(inlineText('Slices: `parseo` + validación'))).toBe('slices-parseo--validación')
  })
  it('code span protege su contenido del barrido de HTML (una etiqueta citada como código no se borra)', () => {
    expect(githubSlug(inlineText('etiqueta `<br>` citada'))).toBe('etiqueta-br-citada')
  })
  it('negrita/cursiva con asteriscos (observado: "bold-heading")', () => {
    expect(githubSlug(inlineText('**bold** heading'))).toBe('bold-heading')
  })
  // El guion bajo es el único marcador de énfasis que SOBREVIVE al slug, así
  // que es el único que hay que resolver de verdad — y hay que resolverlo sin
  // romper los nombres de fichero que empiezan o terminan por guion bajo, el
  // mismo cuidado que slices.js tiene con los tokens de label.
  it('guion bajo de énfasis emparejado → fuera', () => {
    expect(githubSlug(inlineText('__negrita__ y _cursiva_'))).toBe('negrita-y-cursiva')
  })
  // OJO: esta era una suposición mía, y GitHub la desmintió. Yo daba por
  // hecho que "__init__.py" se conservaba entero (es lo que hace
  // slices.js#PAIRED_UNDERSCORE_RE con los tokens de label, y por buenas
  // razones). El HTML real dice otra cosa: "__init__.py y _layout.tsx"
  // produce `id="initpy-y-_layouttsx"` — el "__init__" SÍ es énfasis fuerte
  // para CommonMark (el "__" de cierre va seguido de un punto, que es
  // puntuación, así que puede cerrar), mientras que el "_" de "_layout.tsx",
  // sin pareja, se queda. Se deja el par tal cual lo observó GitHub, no tal
  // como yo esperaba que fuera.
  it('guion bajo: "__init__" SÍ es énfasis (observado), "_layout.tsx" sin pareja se conserva', () => {
    expect(githubSlug(inlineText('__init__.py y _layout.tsx'))).toBe('initpy-y-_layouttsx')
  })
})

describe('documentHeadings — orden, sufijo de colisión, y qué NO es un encabezado', () => {
  it('el contador de colisión es del DOCUMENTO y común a todos los niveles (observado: 9-slices, -1, -2)', () => {
    const md = '## 9. Slices\n\n### 9. Slices\n\n#### 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices', '9-slices-1', '9-slices-2'])
  })
  it('un encabezado dentro de una valla de código NI genera ancla NI consume número de colisión (observado)', () => {
    const md = '## 9. Slices\n\n```\n## 9. Slices\n```\n\n## 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices', '9-slices-1'])
  })
  it('un encabezado dentro de un comentario HTML multilínea, igual (observado)', () => {
    const md = '## 9. Slices\n\n<!--\n## 9. Slices\n-->\n\n## 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices', '9-slices-1'])
  })
  it('cabecera setext (subrayada) también genera ancla (observado: "setext-nueve-slices")', () => {
    const md = 'Setext nueve. Slices\n--------------------\n'
    expect(documentHeadings(md)).toEqual([{ line: 0, text: 'Setext nueve. Slices', anchor: 'setext-nueve-slices' }])
  })
  it('indentación de hasta 3 espacios sigue siendo cabecera; "##foo" sin espacio NO lo es', () => {
    expect(documentHeadings('   ## Indentada tres espacios\n').map((h) => h.anchor)).toEqual(['indentada-tres-espacios'])
    expect(documentHeadings('##foo\n')).toEqual([])
  })
  it('la serie de cierre de una cabecera ATX no entra en el ancla (observado: "## 9. Slices ##" → "9-slices")', () => {
    expect(documentHeadings('## 9. Slices ##\n').map((h) => h.anchor)).toEqual(['9-slices'])
  })
  // El front matter YAML no es markdown: GitHub lo pinta como metadatos. Su
  // "---" de cierre, si se contara como subrayado setext, inventaría una
  // cabecera y desplazaría el contador de colisión de TODO el documento —
  // un ancla válida apuntando al sitio equivocado.
  it('el front matter YAML no produce cabeceras fantasma', () => {
    const md = '---\ntitle: Plan\n---\n\n## 9. Slices\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices'])
  })
  it('un "---" que NO cierra front matter (sin apertura en la línea 0) sigue siendo un subrayado setext normal', () => {
    const md = 'Intro\n\nNueve\n-----\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['nueve'])
  })
  it('una fila separadora de tabla ("|---|---|") no es un subrayado setext', () => {
    const md = '## 9. Slices\n\n| # | Slice |\n|---|---|\n| 1 | x |\n'
    expect(documentHeadings(md).map((h) => h.anchor)).toEqual(['9-slices'])
  })
})

describe('headingAbove — bajo qué encabezado vive una línea concreta', () => {
  const MD = [
    '# Plan',            // 0
    '',                  // 1
    '## 8. Contexto',    // 2
    '',                  // 3
    '## 9. Slices',      // 4
    '',                  // 5
    '| # | Slice |',     // 6
  ].join('\n')
  it('devuelve el encabezado inmediatamente anterior, no el primero del documento', () => {
    expect(headingAbove(MD, 6)).toEqual({ line: 4, text: '9. Slices', anchor: '9-slices' })
  })
  it('una línea por encima de cualquier encabezado → null', () => {
    expect(headingAbove('| # | Slice |\n## 9. Slices\n', 0)).toBeNull()
  })
})

describe('analyzeSlicesTable — el reporte trae el encabezado real bajo el que vive la tabla §9 (F10)', () => {
  // El parser SIEMPRE localizó la tabla por su cabecera de columnas, nunca
  // por un número de sección. Lo que le faltaba era saber bajo qué
  // encabezado estaba — la única forma de construir un ancla que exista.
  const SPEC = [
    '# Plan actual vs propuestas',
    '',
    '## 8. Contexto',
    '',
    'Texto.',
    '',
    '## 9. Slices',
    '',
    '| # | Slice | Dep |',
    '|---|---|---|',
    '| 1 | login | – |',
    '',
    '## 10. Riesgos',
  ].join('\n')

  it('encuentra "9. Slices" y su ancla real "9-slices" (no "9")', () => {
    expect(analyzeSlicesTable(SPEC).sectionHeading).toEqual({ line: 6, text: '9. Slices', anchor: '9-slices' })
  })
  it('el encabezado NO tiene por qué llamarse "9" ni ser el noveno: la tabla se localiza por su cabecera de columnas', () => {
    const otro = SPEC.replace('## 9. Slices', '## Desglose en slices')
    expect(analyzeSlicesTable(otro).sectionHeading.anchor).toBe('desglose-en-slices')
  })
  it('tabla sin ningún encabezado encima → sectionHeading null (no se inventa un ancla)', () => {
    const sinCabecera = '| # | Slice | Dep |\n|---|---|---|\n| 1 | login | – |\n'
    expect(analyzeSlicesTable(sinCabecera).sectionHeading).toBeNull()
  })
  it('encabezado sin ancla utilizable ("## ...") → anchor cadena vacía, nunca "#"', () => {
    const raro = SPEC.replace('## 9. Slices', '## ...')
    expect(analyzeSlicesTable(raro).sectionHeading).toEqual({ line: 6, text: '...', anchor: '' })
  })
  it('sin tabla §9 no hay encabezado que reportar', () => {
    expect(analyzeSlicesTable('# Solo prosa\n\nnada.').sectionHeading).toBeNull()
  })
})
