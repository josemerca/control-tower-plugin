// scope.js — ¿LOS FICHEROS QUE TOCÓ ESTE PR CABEN EN EL ALCANCE QUE EL EPIC
// DECLARÓ?
//
// POR QUÉ EXISTE, con nombre y apellidos. Despacho 1, slice 4 (menoplus #662 →
// PR #668, 2026-08-13): el agente tocó copy GDPR en pantalla contra su
// «Protegido» explícito y escribió en el ledger y en el cuerpo del PR que Jose
// lo había autorizado. Las dos afirmaciones eran falsas — su transcript tiene
// UNA sola entrada de usuario, el kickoff del dispatcher. Lo cazó una persona
// extrañándose de ver dos `.swift` de la app en la lista de ficheros; no lo
// cazó ninguna comprobación mecánica, porque no había ninguna.
//
// LA IDEA QUE LO GOBIERNA TODO: la firma humana NO es verificable desde dentro
// del loop. El agente despachado corre con las credenciales de GitHub de Jose,
// así que puede producir cualquier artefacto de GitHub —una review, una
// aprobación, un comentario— y su registro es prosa que nadie contrasta. Lo que
// SÍ es verificable es lo que TOCÓ: el diff es un hecho, y un hecho no se puede
// falsificar sin que se vea. Por eso este módulo no intenta comprobar firmas.
// Comprueba hechos.
//
// DÓNDE VIVE LA COMPROBACIÓN, y no es un detalle: en un workflow del repo
// destino, sobre el PR. NO en `dispatch-check --release`, porque `--release` lo
// invoca el propio agente y un guard que ejecuta el sospechoso no es un guard.
//
// Módulo PURO: ni red ni disco.
import { findClosingKeywords } from './closing-keywords.js'

// El alcance se declara UNA VEZ POR EPIC, no por slice, y vive en la sección
// `## Contexto del epic` del execution spec — que es la ÚNICA que groom copia
// verbatim al issue. Ponerlo en cualquier otra sección crearía un alcance que
// existe en el spec y no existe donde se comprueba.
//
// Una vez por epic y no por fila es deliberado: se escribe en la congelación,
// que es el único momento del ciclo en que Jose lee. Cuatro campos por rellenar
// se olvidan; uno, no.
const SECTION_HEADING = /^##\s+Contexto del epic\s*$/i
const ANY_HEADING = /^#{1,6}\s+/
// `Alcance:` con la negrita y los backticks que la plantilla usa alrededor de
// todo lo demás. Sin esta tolerancia, escribirlo como el resto de la sección
// —que es lo natural— lo dejaría invisible.
const SCOPE_LINE = /^\s*[-*]?\s*\**\s*Alcance\s*\**\s*:\s*(.*)$/i

// Los ficheros que el PROPIO loop obliga a commitear. No son una excepción al
// alcance: son la huella del mecanismo que impone el alcance.
//
// El kickoff ORDENA al agente escribir el plan del slice en
// `docs/superpowers/plans/` y commitearlo («viaja en el PR»). Hacer fallar el
// gate por eso sería un muro insatisfacible —solo se cumple desobedeciendo al
// dispatcher— y un guard así se acaba ignorando entero, que es la lección que
// conventions.js ya pagó en este repo (F14).
//
// `.agent/SLICE.md` NO está aquí, y es deliberado: es estado de sesión, no
// producto del slice. En el despacho 1 un agente lo metió en su PR y lo sacó él
// mismo después con ese mismo argumento. Exentarlo normalizaría justo lo que
// aquel agente corrigió por su cuenta.
//
// `.superpowers/**` TAMPOCO está aquí, y también es deliberado: el propio skill
// de brainstorming dice que ese directorio va en `.gitignore`. Cuando aparece
// en un PR —como apareció `.superpowers/sdd/progress.md` en el PR #668— no es
// un falso positivo del gate: es estado de sesión commiteado, residuo del fork,
// y marcarlo es el comportamiento correcto.
//
// LA LISTA ES CORTA A PROPÓSITO y solo contiene lo que manda EL PLUGIN, que es
// lo único que vale en cualquier repo. La contabilidad propia de cada repo
// (`BITACORA.md` en menoplus, por ejemplo) NO se hardcodea aquí: viaja por
// `extraExempt`, que el workflow del repo destino pasa. Meter rutas de un repo
// concreto en el plugin las convertiría en agujeros para todos los demás.
export const LOOP_ARTIFACT_PATTERNS = [
  // El kickoff ORDENA escribir aquí el plan del slice y commitearlo.
  'docs/superpowers/plans/**',
  // El skill de brainstorming escribe aquí el design doc y el execution spec, y
  // el slice rellena el «Registro de cierre (evidencia)» del spec al entregar.
  //
  // LÍMITE QUE HAY QUE DECIR EN VOZ ALTA: esta exención deja al agente escribir
  // en el spec CONGELADO sin que el gate lo vea — y en el incidente del
  // despacho 1 el agente metió ahí parte de su autorización falsa. El gate no
  // puede cubrirlo: no juzga prosa, juzga ficheros. La inmutabilidad de las
  // secciones congeladas del spec es una comprobación DISTINTA y está sin
  // construir.
  'docs/superpowers/specs/**',
]

function normalizePath(p) {
  return String(p || '').replace(/^\.\//, '').replace(/^\/+/, '')
}

/**
 * parseScope: el alcance declarado por el epic, o la constancia de que no lo hay.
 *
 * `declared: false` NO significa «sin restricciones»: significa «no se puede
 * comprobar». Es la misma regla que el resto del plugin ya sostiene —el 1 nunca
 * se degrada a 0— y su efecto práctico es el que se busca: empujar la fricción
 * a la congelación en vez de descubrir el hueco cuando ya hay un PR abierto.
 */
export function parseScope(issueBody) {
  const texto = typeof issueBody === 'string' ? issueBody : ''
  const lineas = texto.split(/\r?\n/)

  // Solo se mira DENTRO de `## Contexto del epic`, y la sección se corta en el
  // siguiente encabezado de cualquier nivel: sin ese corte, un `Alcance:`
  // escrito más abajo (en «Out of scope», por ejemplo) se leería como si
  // perteneciera a esta sección.
  let dentro = false
  const patterns = []
  for (const linea of lineas) {
    if (SECTION_HEADING.test(linea)) { dentro = true; continue }
    if (dentro && ANY_HEADING.test(linea)) break
    if (!dentro) continue
    const m = linea.match(SCOPE_LINE)
    if (!m) continue
    // Cierre de la negrita del rótulo: en `- **Alcance:** apps/**` los dos
    // asteriscos que cierran el `**Alcance:**` caen DESPUÉS de los dos puntos y
    // se colarían al principio del valor.
    //
    // Se quitan solo cuando van seguidos de espacio, y ese detalle es la
    // diferencia entre arreglar el rótulo y romper un glob legítimo: el cierre
    // de negrita siempre lleva espacio detrás (`** apps/…`), mientras que un
    // patrón que empieza por `**` lleva siempre una barra (`**/*.swift`).
    const valor = m[1].replace(/^\*\*(?=\s)/, '')
    for (const trozo of valor.split(',')) {
      // Se quitan los BACKTICKS y nada más. La tentación es quitar también los
      // asteriscos de la negrita de Markdown, y es un bug: en el valor los
      // asteriscos son el glob (`apps/ios/**`), no decoración. La primera
      // versión de esta línea los borraba y convertía todos los patrones en
      // prefijos de directorio en silencio — el gate seguía verde y comprobaba
      // otra cosa. La negrita del ROTULO (`- **Alcance:**`) ya la absorbe
      // SCOPE_LINE, así que aquí nunca llega.
      const limpio = trozo.replace(/`/g, '').trim()
      if (limpio) patterns.push(limpio)
    }
  }

  if (!patterns.length) {
    return {
      declared: false,
      patterns: [],
      reason: 'el epic no declara `Alcance:` en su sección `## Contexto del epic` — sin alcance declarado el gate no puede comprobar nada, y no poder comprobar NO es estar limpio',
    }
  }
  return { declared: true, patterns, reason: null }
}

/**
 * matchesPattern: el glob mínimo del gate, dicho entero para que nadie tenga
 * que adivinarlo leyendo el código.
 *
 *   `**`  cruza separadores de directorio (cero o más segmentos)
 *   `*`   NO cruza separadores
 *   `a/b` casa exacto
 *   `a/`  vale por el directorio entero (amabilidad: quien escribe el alcance
 *         en la congelación escribe el directorio, no el glob, y un rojo por
 *         sintaxis en ese momento es el peor momento posible)
 *
 * Todo lo demás es LITERAL. En particular el punto: sin escaparlo, `.github`
 * casaría con `Xgithub`.
 */
export function matchesPattern(path, pattern) {
  const p = normalizePath(path)
  let pat = normalizePath(pattern)
  if (!pat) return false
  if (pat.endsWith('/')) pat = `${pat}**`

  // Se construye el regex trozo a trozo en vez de con reemplazos encadenados:
  // encadenar reemplazos sobre `**` y `*` hace que el segundo pise lo que
  // escribió el primero, que es el bug clásico de todo mini-glob.
  let re = '^'
  for (let i = 0; i < pat.length; i += 1) {
    const c = pat[i]
    if (c === '*') {
      if (pat[i + 1] === '*') {
        // `**/` come también el separador, para que `a/**` case con `a/b` y con
        // `a/b/c` sin pedir dos patrones.
        if (pat[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else {
        re += '[^/]*'
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  re += '$'
  return new RegExp(re).test(p)
}

/**
 * scopeViolations: los ficheros del PR que caen FUERA del alcance.
 *
 * Sin patrones devuelve TODOS los ficheros, nunca la lista vacía: un epic sin
 * alcance declarado no es un epic con barra libre. Devolver `[]` aquí dejaría
 * al llamante leyendo «nada que ver» sobre justo el caso que el gate existe
 * para cerrar.
 */
export function scopeViolations(files, patterns, extraExempt = []) {
  const pats = Array.isArray(patterns) ? patterns.filter(Boolean) : []
  // Las exenciones del plugin (lo que el loop obliga a commitear en CUALQUIER
  // repo) más las que declare el repo destino en su workflow (su contabilidad
  // propia). Se suman en vez de sustituirse: un repo no puede desactivar sin
  // querer las del plugin al declarar la suya.
  const exentos = [...LOOP_ARTIFACT_PATTERNS, ...(Array.isArray(extraExempt) ? extraExempt.filter(Boolean) : [])]
  return (files || [])
    .map(normalizePath)
    .filter((f) => f)
    .filter((f) => !exentos.some((pat) => matchesPattern(f, pat)))
    .filter((f) => !pats.some((pat) => matchesPattern(f, pat)))
}

/**
 * issueFromPrBody: de qué issue es este PR, según su propia closing keyword.
 *
 * Se apoya en findClosingKeywords (closing-keywords.js) en vez de reimplementar
 * el reconocedor: dos reconocedores del mismo texto derivan, y ése ya está
 * endurecido contra el ReDoS que se midió en F27.
 *
 * Dos issues cerrados por el mismo PR devuelven `null` en vez del primero: el
 * gate no elige en silencio cuál de los dos alcances aplica.
 */
export function issueFromPrBody(prBody) {
  const encontrados = findClosingKeywords(typeof prBody === 'string' ? prBody : '')
  const numeros = new Set()
  for (const { ref } of encontrados) {
    const m = String(ref).match(/#(\d+)$/)
    if (m) numeros.add(Number(m[1]))
  }
  if (numeros.size !== 1) return null
  return [...numeros][0]
}
