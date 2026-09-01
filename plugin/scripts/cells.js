// cells.js — los primitivos de CELDA de la tabla §9 ("Desglose en slices"),
// separados del parser completo (slices.js). Existe como fichero propio para
// que gates.js pueda trocear una celda (splitEscapedCommas) y reconocer un
// marcador de "sin valor" (NO_VALUE_MARKERS/isNoValueCell) SIN importar
// slices.js — el parser entero, que kickoff.js no depende de él hoy y no
// debe empezar a hacerlo (kickoff.js importa gates.js). Por eso este módulo
// no importa nada: cualquier import aquí sería justo lo que gates.js necesita
// no arrastrar.
//
// isNoValueCell arrastra consigo cleanEmphasis/stripPairedUnderscore/sus dos
// regexes: son su implementación, no primitivos aparte, y no se pueden
// separar de la función que los usa. stripPairedUnderscore se reexporta
// porque slices.js también lo usa por su cuenta (Área/Toca), fuera de
// isNoValueCell.

// NO_VALUE_MARKERS: valores de celda que significan "vacío"/"sin valor" —
// guion (-), en dash (–, U+2013) y em dash (—, U+2014) son variantes
// tipográficas razonables de la misma intención que un editor de texto
// (Word, Notion, un móvil con autocorrección…) puede sustituir sin que el
// autor lo note. CRITICAL de la review de F1: la tabla REAL que originó
// esta feature usa DELIBERADAMENTE un em dash en la fila S1 para "sin
// dependencias" — reconocer solo "–"/"-" significa que arreglar la columna
// "#" (como pide nuestro propio mensaje de error) hace que esa misma celda,
// que siempre significó "sin dependencias" correctamente, dispare el abort
// de "Dep malformado" pidiéndole al autor que escriba "#N" para una celda
// que no necesita ninguna referencia. Un solo criterio de "vacío",
// compartido entre Dep/Acepta/Área/Toca (antes cada campo repetía su propia
// comparación `!== '–' && !== '-'`, con el mismo hueco cuatro veces).
// NBSP alrededor del carácter (p.ej. copiado de un editor que lo inserta
// automáticamente) ya lo elimina `String#trim()` de forma nativa —
// verificado (`' — '.trim() === '—'`) — así que no hace falta
// tratarlo aparte aquí.
export const NO_VALUE_MARKERS = new Set(['-', '–', '—', '―', '−', '--'])
// isNoValueCell corre `cleanEmphasis` ANTES de comparar (review round 2,
// punto c): envolver el marcador en marcado inline ("`–`", "**–**") es la
// MISMA forma que el CRITICAL del em dash — un autor que ya demostró
// envolver valores en negrita/backticks (F1: "**S1**") envuelve igual de
// fácil el marcador de "nada". Sin este strip, `isNoValueCell` comparaba la
// celda cruda contra el Set y "`–`"/"**–**" no matcheaban nada, así que el
// autor recibía "si no hay dependencias, escribe –" por haber escrito
// exactamente eso, solo que envuelto. También se amplía el propio conjunto:
// el signo menos matemático (−, U+2212) y el doble-guion ("--") son
// salidas plausibles de autocorrección, igual que el em dash.
// Exportada (además de usarse internamente arriba): groom.js#buildIssueBody
// la necesita para tratar "Protegido" con el mismo criterio de "sin valor"
// que ya usan Dep/Acepta/Área/Toca — ver el fix correspondiente en groom.js.
export function isNoValueCell(trimmedCell) {
  return NO_VALUE_MARKERS.has(cleanEmphasis(trimmedCell))
}

// EMPHASIS_CHARS_RE / PAIRED_UNDERSCORE_RE / cleanEmphasis (review round 4
// — segunda mitad del rediseño de la round 3, no un parche encima): la
// round 3 ya invirtió el enfoque de backtick/asterisco (quitarlos siempre,
// sin intentar detectar "pares que envuelven"), pero para guion bajo
// conservó `^_+`/`_+$` — una eliminación ASIMÉTRICA que no distingue un PAR
// de énfasis real (`_x_`, `__x__`, el cierre es la MISMA cadena que la
// apertura) de un guion bajo inicial o final SIN pareja. Y eso es
// exactamente cómo empiezan "_layout.tsx"/"_app.tsx" (Expo Router, Next.js)
// o "__init__.py" (Python), y cómo puede terminar "trailing_" — nombres de
// fichero de lo más normales en una columna "Toca". El token ES la clave de
// colisión de claim.js#tokensOf (comparación exacta): corromper
// "_layout.tsx" en "layout.tsx" produce colisiones falsas entre slices que
// no colisionan de verdad.
//
// PAIRED_UNDERSCORE_RE exige que el cierre sea la MISMA cadena que la
// apertura (backreference `\1`) — verificado explícitamente carácter por
// carácter contra la matriz completa antes de escribir el fix:
// "_layout.tsx"/"_app.tsx"/"__init__.py"/"trailing_" NO matchean (no
// terminan en guion bajo, o no tienen pareja simétrica) y quedan intactos;
// "_x_"/"__x__" SÍ matchean y se reducen a "x".
const PAIRED_UNDERSCORE_RE = /^(_{1,3})(.+?)\1$/
export function stripPairedUnderscore(s) {
  const m = PAIRED_UNDERSCORE_RE.exec(s)
  return m ? m[2] : s
}
// EMPHASIS_CHARS_RE: backtick/asterisco no tienen ningún significado
// legítimo dentro de un token de label — se quitan sin condición.
const EMPHASIS_CHARS_RE = /[`*]/g
// cleanEmphasis: limpieza para valores de UNA SOLA celda sin estructura de
// lista (Dep/Acepta/Entrega, vía isNoValueCell) — no hay split por comas de
// por medio, así que quitar backtick/asterisco de toda la celda y el par
// de guion bajo (si lo hay) es seguro y no corrompe nada.
function cleanEmphasis(raw) {
  const trimmed = raw.trim()
  const withoutPairedUnderscore = stripPairedUnderscore(trimmed)
  return withoutPairedUnderscore.replace(EMPHASIS_CHARS_RE, '').trim()
}

// splitEscapedCommas (F6, importante 3): divide una celda por comas que NO
// vengan escapadas con una barra invertida (`\,`), y devuelve cada trozo con
// esos escapes ya resueltos a una coma literal.
//
// El problema que cierra: "Acepta" se troceaba con un `String#split(',')` a
// secas, así que una coma DENTRO de un criterio lo partía en dos en silencio
// — y la cabecera que este mismo pipeline genera para esa sección es
// literalmente "Acceptance criteria (EARS, 1:1 con tests)": la forma EARS
// ("Cuando <disparador>, el sistema debe <respuesta>") lleva coma casi
// siempre. No era un caso raro: era la forma natural de rellenar la columna,
// y el autor solo lo descubría leyendo el issue ya creado.
//
// Se aplica SOLO a "Acepta" (comprobado columna por columna): "Protegido" no
// se trocea por comas en absoluto, "Dep" extrae sus referencias con una regex
// `#N` (una coma dentro no cambia nada), y "Área"/"Toca" sí se trocean pero
// sus valores son tokens de label de los que `normalizeToken` descarta la
// coma igualmente — un escape ahí prometería algo que la normalización
// deshace acto seguido.
//
// Una barra invertida que NO precede a una coma se conserva tal cual (p.ej.
// una ruta de Windows en un criterio): solo la secuencia exacta `\,` es un
// escape.
export function splitEscapedCommas(cell) {
  const parts = []
  let current = ''
  const src = cell || ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\' && src[i + 1] === ',') {
      current += ','
      i++
      continue
    }
    if (ch === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}
